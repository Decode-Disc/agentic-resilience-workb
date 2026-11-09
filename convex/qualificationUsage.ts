import type { Doc, Id } from "@convex/_generated/dataModel";
import type { MutationCtx, QueryCtx } from "@convex/_generated/server";
import {
    preparationFailureClass,
    sourcePreparationError,
} from "@convex/domain/sourcePreparationAuthority";
import {
    type CampaignLimits,
    emptyCampaignLimits,
} from "@convex/qualificationCampaignPolicy";

export const qualificationCategory = (
    call: Pick<Doc<"providerCalls">, "service" | "operation">,
) =>
    call.service === "model"
        ? "model"
        : call.operation === "source_need_search"
          ? "search"
          : ["get_contents", "retrieve_filing_html"].includes(call.operation)
            ? "acquisition"
            : "technical";
const empty = () => ({
    usage: emptyCampaignLimits(),
    technical: 0,
    pending: 0,
    unknown: 0,
    overruns: 0,
});
export function qualificationReceiptUsage(call: Doc<"providerCalls">) {
    const value = empty();
    const kind = qualificationCategory(call);
    if (kind === "technical") value.technical++;
    else value.usage[kind]++;
    value.usage.costUsd = Math.max(
        call.qualificationReservationUsd ?? 0,
        call.reportedCost ?? 0,
    );
    if (
        call.costAccountingPolicy === "known_final_v1" &&
        call.reportedCost !== undefined &&
        (call.reportedCostFinal || call.billing?.state === "confirmed") &&
        call.billing?.state !== "conflict"
    )
        value.usage.costUsd = call.reportedCost;
    value.pending = call.status === "started" ? 1 : 0;
    value.unknown =
        call.status !== "started" && preparationFailureClass(call) === "unknown"
            ? 1
            : 0;
    value.overruns =
        (call.reportedCost ?? 0) > (call.qualificationReservationUsd ?? 0)
            ? 1
            : 0;
    return value;
}
export async function initializeQualificationUsage(
    ctx: MutationCtx,
    contextId: Id<"browserTestContexts">,
    runIds: Id<"researchRuns">[],
) {
    for (const runId of [undefined, ...runIds]) {
        const existing = await readQualificationUsage(ctx, contextId, runId);
        if (!existing)
            await ctx.db.insert("qualificationUsage", {
                contextId,
                runId,
                ...empty(),
            });
    }
}
export function readQualificationUsage(
    ctx: QueryCtx,
    contextId: Id<"browserTestContexts">,
    runId?: Id<"researchRuns">,
) {
    return ctx.db
        .query("qualificationUsage")
        .withIndex("by_context_and_run", (q) =>
            q.eq("contextId", contextId).eq("runId", runId),
        )
        .unique();
}
/** A projection updated in the receipt transaction; no inspection page size becomes a spending limit. */
export async function updateQualificationUsage(
    ctx: MutationCtx,
    before: Doc<"providerCalls"> | null,
    after: Doc<"providerCalls">,
) {
    const contextId = after.qualificationContextId;
    if (!contextId) return;
    if (!after.runId) throw new Error("Qualification receipt run required");
    const previous = before ? qualificationReceiptUsage(before) : empty();
    const next = qualificationReceiptUsage(after);
    for (const runId of [undefined, after.runId]) {
        const row = await readQualificationUsage(ctx, contextId, runId);
        if (!row) throw new Error("Qualification usage unavailable");
        const usage = { ...row.usage };
        for (const key of [
            "model",
            "search",
            "acquisition",
            "costUsd",
        ] as const)
            usage[key] += next.usage[key] - previous.usage[key];
        await ctx.db.patch(row._id, {
            usage,
            technical: row.technical + next.technical - previous.technical,
            pending: row.pending + next.pending - previous.pending,
            unknown: row.unknown + next.unknown - previous.unknown,
            overruns: row.overruns + next.overruns - previous.overruns,
        });
    }
}
/** Reservation, including an optional case cap, is atomic with the actual provider receipt. */
export async function assertQualificationAllowance(
    ctx: MutationCtx,
    contextId: Id<"browserTestContexts">,
    runId: Id<"researchRuns">,
    call: Pick<Doc<"providerCalls">, "service" | "operation">,
    reservationUsd: number,
) {
    const context = await ctx.db.get(contextId);
    const lot = context?.campaignLotId
        ? await ctx.db.get(context.campaignLotId)
        : null;
    const campaign = lot ? await ctx.db.get(lot.campaignId) : null;
    if (
        !context ||
        !lot ||
        campaign?.manifest.version !== 2 ||
        !context.paidQualification?.scenarios
    )
        throw new Error("Configurable qualification grant required");
    const binding = context.paidQualification.scenarios.find(
        (s) => s.runId === runId,
    );
    const scenario = campaign.manifest.scenarios.find(
        (s) => s.id === binding?.id,
    );
    if (!scenario) throw new Error("Campaign scenario binding unavailable");
    const expired = await ctx.db
        .query("providerCalls")
        .withIndex("by_qualification_context_and_status_and_lease", (q) =>
            q
                .eq("qualificationContextId", contextId)
                .eq("status", "started")
                .lte("leaseExpiresAt", Date.now()),
        )
        .first();
    if (expired)
        throw sourcePreparationError("qualification_outcome_unresolved");
    const kind = qualificationCategory(call);
    for (const [scopedRunId, limits] of [
        [
            undefined,
            {
                ...lot.allocation,
                model: Math.min(
                    lot.allocation.model,
                    context.paidQualification.maximumRequests,
                ),
                costUsd: Math.min(
                    lot.allocation.costUsd,
                    context.paidQualification.maximumCostUsd,
                ),
            },
        ],
        [runId, scenario.limits ?? {}],
    ] as const) {
        const row = await readQualificationUsage(ctx, contextId, scopedRunId);
        if (!row) throw new Error("Qualification usage unavailable");
        if (row.unknown)
            throw sourcePreparationError("qualification_outcome_unresolved");
        const ceiling: Partial<CampaignLimits> = limits;
        if (
            row.overruns ||
            (kind !== "technical" &&
                row.usage[kind] + 1 > (ceiling[kind] ?? Infinity)) ||
            row.usage.costUsd + reservationUsd > (ceiling.costUsd ?? Infinity)
        )
            throw sourcePreparationError("qualification_budget_exhausted");
    }
}

/** Keep accounting projections in the same transaction as every factual receipt update, including late billing. */
export async function patchQualificationReceipt(
    ctx: MutationCtx,
    call: Doc<"providerCalls">,
    patch: Partial<Omit<Doc<"providerCalls">, "_id" | "_creationTime">>,
) {
    await updateQualificationUsage(ctx, call, { ...call, ...patch });
    await ctx.db.patch(call._id, patch);
}
