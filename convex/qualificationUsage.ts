import type { Doc, Id } from "@convex/_generated/dataModel";
import type { MutationCtx, QueryCtx } from "@convex/_generated/server";
import {
    PREPARATION_BUDGET_VERSION,
    preparationBudgetOutcome,
    preparationFailureClass,
    readPreparationBudget,
    sourcePreparationError,
} from "@convex/domain/sourcePreparationAuthority";
import {
    type CampaignLimits,
    emptyCampaignLimits,
} from "@convex/qualificationCampaignPolicy";

import {
    MODEL_MAX_INPUT_PRICE_PER_MILLION,
    MODEL_MAX_OUTPUT_PRICE_PER_MILLION,
} from "@convex/resourcePolicy";

/** Charges maximum approved prices against the applicable full-context reservation. */
export function qualificationModelReservationUsd(capacity: {
    contextWindow: number;
    maxTokens: number;
}) {
    return (
        (capacity.contextWindow * MODEL_MAX_INPUT_PRICE_PER_MILLION +
            capacity.maxTokens * MODEL_MAX_OUTPUT_PRICE_PER_MILLION) /
        1_000_000
    );
}

export function qualificationModelScopes(
    lot: Pick<CampaignLimits, "model" | "costUsd">,
    grant: Pick<CampaignLimits, "model" | "costUsd">,
) {
    return {
        model: Math.min(lot.model, grant.model),
        costUsd: Math.min(lot.costUsd, grant.costUsd),
    };
}

/** Remaining headroom is tested the same way during planning and atomic dispatch. */
export function exceededQualificationAllowance(
    limits: Partial<CampaignLimits>,
    usage: CampaignLimits,
    kind: keyof Omit<CampaignLimits, "costUsd"> | "technical",
    reservationUsd: number,
) {
    if (kind !== "technical" && usage[kind] + 1 > (limits[kind] ?? Infinity))
        return {
            resource: kind,
            required: usage[kind] + 1,
            available: limits[kind] ?? Infinity,
        };
    const required = usage.costUsd + reservationUsd;
    const available = limits.costUsd ?? Infinity;
    if (required > available)
        return { resource: "costUsd" as const, required, available };
}

export const qualificationCategory = (
    call: Pick<Doc<"providerCalls">, "service" | "operation">,
) =>
    call.service === "model"
        ? "model"
        : ["source_need_search", "framing_context_search"].includes(
                call.operation,
            )
          ? "search"
          : [
                  "get_contents",
                  "retrieve_filing_html",
                  "framing_context_read",
              ].includes(call.operation)
            ? "acquisition"
            : "technical";
const empty = () => ({
    usage: emptyCampaignLimits(),
    technical: 0,
    pending: 0,
    unknown: 0,
    overruns: 0,
    conflicts: 0,
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
    if (call.status !== "started" && call.dispatchOutcome === "not_dispatched")
        value.usage.costUsd = 0;
    value.conflicts = call.billing?.state === "conflict" ? 1 : 0;
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
                projectionVersion: PREPARATION_BUDGET_VERSION,
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
            conflicts:
                row.conflicts === undefined
                    ? undefined
                    : row.conflicts + next.conflicts - previous.conflicts,
        });
    }
}
/** Missing legacy conflict counters preserve uncertainty until an explicit reconciliation. */
export function qualificationUsageResolved(
    row: Doc<"qualificationUsage"> | null,
) {
    return !!row && row.unknown === 0 && row.conflicts === 0;
}

export function qualificationAllowanceScopes(
    context: Doc<"browserTestContexts"> | null,
    lot: Doc<"qualificationLots"> | null,
    campaign: Doc<"qualificationCampaigns"> | null,
    runId: Id<"researchRuns">,
) {
    if (
        !context ||
        !lot ||
        !campaign ||
        campaign.manifest.version === 1 ||
        !context.paidQualification?.scenarios
    )
        return null;
    const binding = context.paidQualification.scenarios.find(
        (s) => s.runId === runId,
    );
    const scenario = campaign.manifest.scenarios.find(
        (s) => s.id === binding?.id,
    );
    if (!scenario) return null;
    return [
        [
            undefined,
            {
                ...lot.allocation,
                ...qualificationModelScopes(lot.allocation, {
                    model: context.paidQualification.maximumRequests,
                    costUsd: context.paidQualification.maximumCostUsd,
                }),
            },
        ],
        [runId, scenario.limits ?? {}],
    ] as const;
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
    const scopes = qualificationAllowanceScopes(context, lot, campaign, runId);
    if (!scopes)
        throw new Error(
            "Configurable qualification grant and scenario binding required",
        );
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
    for (const [scopedRunId, limits] of scopes) {
        const row = await readQualificationUsage(ctx, contextId, scopedRunId);
        if (!row) throw new Error("Qualification usage unavailable");
        if (!qualificationUsageResolved(row))
            throw sourcePreparationError("qualification_outcome_unresolved");
        if (
            row.overruns ||
            exceededQualificationAllowance(
                limits,
                row.usage,
                kind,
                reservationUsd,
            )
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
    const next = { ...call, ...patch };
    const before = preparationBudgetOutcome(call);
    const after = preparationBudgetOutcome(next);
    if (
        call.service === "model" &&
        (call.preparationId || call.missionId) &&
        call.operation !== "source_embedding"
    ) {
        const run = call.runId ? await ctx.db.get(call.runId) : null;
        if (!run) throw sourcePreparationError("stale_execution");
        if (!run.sourcePreparationBudget)
            throw sourcePreparationError(
                "preparation_budget_conversion_required",
            );
        if (before !== after) {
            const preparation = call.preparationId
                ? await ctx.db.get(call.preparationId)
                : null;
            if (!preparation && !call.missionId)
                throw sourcePreparationError("stale_execution");
            const budget = await readPreparationBudget(
                ctx.db,
                run,
                preparation ?? undefined,
            );
            if (before !== "released") budget[before]--;
            if (after !== "released") budget[after]++;
            else {
                budget.dispatches--;
                if (preparation)
                    await ctx.db.patch(preparation._id, {
                        modelAttemptCount: Math.max(
                            0,
                            (preparation.modelAttemptCount ?? 0) - 1,
                        ),
                    });
            }
            await ctx.db.patch(run._id, {
                sourcePreparationBudget: budget,
                sourceQualificationAttemptCount: budget.dispatches,
            });
        }
    }
    await updateQualificationUsage(ctx, call, next);
    await ctx.db.patch(call._id, patch);
}
