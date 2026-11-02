import type { Doc, Id } from "@convex/_generated/dataModel";
import {
    internalMutation,
    type MutationCtx,
    type QueryCtx,
} from "@convex/_generated/server";
import { sha256Hex, stableStringify } from "@convex/domain/sourcePassages";
import { type Infer, v } from "convex/values";
import { recordInvocationEvent, requireMissionAuthority } from "./authority";
import { executionError } from "./errors";
import {
    HISTORY_PAGE_SIZE,
    MAX_OBSERVABLE_OUTPUT_BYTES,
} from "./executionProtocol";
import {
    isCommonConsultation,
    type retainedPayloadValidator,
} from "./operationContracts";

type RetainedPayload = Infer<typeof retainedPayloadValidator>;

function retainablePayload(
    contentJson: string | undefined,
    capacityCode: string,
    missingCode: string,
): RetainedPayload {
    const json =
        contentJson === undefined
            ? undefined
            : stableStringify(JSON.parse(contentJson));
    const sizeBytes = new TextEncoder().encode(json ?? "").length;
    const contentHash = json === undefined ? undefined : sha256Hex(json);
    const complete =
        json !== undefined && sizeBytes <= MAX_OBSERVABLE_OUTPUT_BYTES;
    return {
        version: 1,
        state: complete ? "complete" : "incomplete",
        ...(complete ? { json } : {}),
        ...(contentHash ? { contentHash } : {}),
        sizeBytes,
        ...(!complete
            ? { code: json === undefined ? missingCode : capacityCode }
            : {}),
    };
}

const OPERATION_OBSERVATIONS = new Set([
    "operation_requested",
    "operation_refused",
    "operation_reused",
    "operation_effect_applied",
    "operation_observed",
    "operation_completed",
]);

/** Each immutable snapshot captures the input/result known at its own observation boundary. */
export function operationEventObservation(
    request: Doc<"agentOperationRequests">,
    kind: string,
    admissionOutcome?: Doc<"agentExecutionEvents">["admissionOutcome"],
): unknown | undefined {
    if (!OPERATION_OBSERVATIONS.has(kind)) return undefined;
    return kind === "operation_effect_applied"
        ? { input: request.input, effect: request.effect }
        : {
              input: request.input,
              pin: request.pin,
              outcome: admissionOutcome ?? request.outcome,
          };
}

/** Append-only event content is written in the same transaction as its observed effect/result. */
export async function retainExecutionEventPayload(
    ctx: MutationCtx,
    eventId: Id<"agentExecutionEvents">,
    value: unknown,
): Promise<void> {
    const event = await ctx.db.get(eventId);
    if (!event) throw executionError("journal_event_unavailable");
    const payload = retainablePayload(
        JSON.stringify(value),
        "journal_operation_capacity",
        "operation_observation_unavailable",
    );
    if (event.payload) {
        if (stableStringify(event.payload) !== stableStringify(payload))
            throw executionError("journal_payload_conflict");
        return;
    }
    await ctx.db.patch(eventId, { payload });
}

function observablePayload(payload: RetainedPayload) {
    if (payload.state === "incomplete") return payload;
    if (
        payload.json === undefined ||
        payload.contentHash !== sha256Hex(payload.json) ||
        payload.sizeBytes !== new TextEncoder().encode(payload.json).length ||
        payload.sizeBytes > MAX_OBSERVABLE_OUTPUT_BYTES
    )
        throw executionError("journal_payload_invalid");
    const value: unknown = JSON.parse(payload.json);
    return { state: "complete", value };
}

/** Historical fragments never join the current mutable execution documents. */
export async function projectMissionHistoryEvent(
    ctx: QueryCtx,
    event: Doc<"agentExecutionEvents">,
): Promise<{ json: string; contentHash: string }> {
    const metadata = { ...event };
    delete metadata.payload;
    delete metadata.historySourceSequence;
    delete metadata.protectedDiagnostic;
    const part =
        event.kind === "invocation_request_recorded"
            ? "request"
            : event.kind === "invocation_reply_recorded"
              ? "reply"
              : undefined;
    const invocationId = event.invocationId;
    const invocationPayload = event.invocationPayloadId
        ? await ctx.db.get(event.invocationPayloadId)
        : part && invocationId
          ? await ctx.db
                .query("agentInvocationPayloads")
                .withIndex("by_invocation_and_part", (q) =>
                    q.eq("invocationId", invocationId).eq("part", part),
                )
                .unique()
          : null;
    if ((part || event.invocationPayloadId) && !invocationPayload)
        throw executionError("journal_payload_unavailable");
    if (
        invocationPayload &&
        (invocationPayload.runId !== event.runId ||
            invocationPayload.invocationId !== event.invocationId)
    )
        throw executionError("journal_payload_invalid");
    const json = stableStringify({
        version: 1,
        event: metadata,
        ...(event.payload
            ? { observation: observablePayload(event.payload) }
            : event.requestId && OPERATION_OBSERVATIONS.has(event.kind)
              ? {
                    observation: {
                        state: "incomplete",
                        code: "operation_observation_unavailable",
                    },
                }
              : {}),
        ...(part || event.invocationPayloadId
            ? {
                  invocation: invocationPayload
                      ? observablePayload(invocationPayload)
                      : {
                            state: "incomplete",
                            code: "invocation_observation_unavailable",
                        },
              }
            : {}),
    });
    return { json, contentHash: sha256Hex(json) };
}

/** Without provider admission, a retained live response is a known local refusal. */
export function hasKnownNonDispatch(invocation: Doc<"agentInvocations">) {
    return (
        invocation.journalVersion === 1 &&
        invocation.provenance === "live" &&
        !invocation.providerCallId &&
        invocation.receivedOutputJson !== undefined
    );
}

/** Stores immutable, bounded observations separately from model continuation state. */
export async function retainInvocationPayload(
    ctx: MutationCtx,
    invocation: Doc<"agentInvocations">,
    part: "request" | "reply",
    contentJson?: string,
    missingCode = "observable_reply_unavailable",
) {
    const payload = retainablePayload(
        contentJson,
        `journal_${part}_capacity`,
        missingCode,
    );
    const { contentHash, code } = payload;
    const existing = await ctx.db
        .query("agentInvocationPayloads")
        .withIndex("by_invocation_and_part", (q) =>
            q.eq("invocationId", invocation._id).eq("part", part),
        )
        .unique();
    if (existing) {
        if (existing.contentHash !== contentHash || existing.code !== code)
            throw executionError("journal_payload_conflict");
        return {
            state: existing.state,
            ...(existing.code ? { code: existing.code } : {}),
        };
    }
    await ctx.db.insert("agentInvocationPayloads", {
        invocationId: invocation._id,
        runId: invocation.runId,
        part,
        ...payload,
        createdAt: Date.now(),
    });
    await recordInvocationEvent(ctx, invocation, {
        kind: `invocation_${part}_recorded`,
        ...(code ? { code } : {}),
    });
    return {
        state: payload.state,
        ...(code ? { code } : {}),
    };
}

/** Advances a fixed pre-upgrade cutoff; caller strings are never used as paginator positions. */
export const indexRetainedHistory = internalMutation({
    args: {
        missionId: v.id("agentMissions"),
        expectedGeneration: v.number(),
        throughSequence: v.number(),
        cursor: v.optional(v.string()),
    },
    returns: v.object({
        done: v.boolean(),
        cursor: v.union(v.string(), v.null()),
    }),
    handler: async (ctx, args) => {
        const { mission } = await requireMissionAuthority(
            ctx,
            args.missionId,
            args.expectedGeneration,
        );
        let projection = mission.historyProjection;
        if (projection?.ready) return { done: true, cursor: null };
        if (!projection) {
            if (
                args.cursor !== undefined ||
                !Number.isSafeInteger(args.throughSequence) ||
                args.throughSequence !== mission.nextEventSequence - 1
            )
                throw executionError("history_projection_conflict");
            projection = {
                version: 1,
                throughSequence: args.throughSequence,
                cursor: null,
                ready: false,
            };
        }
        if (projection.throughSequence !== args.throughSequence)
            throw executionError("history_projection_conflict");
        if ((args.cursor ?? null) !== projection.cursor)
            return { done: false, cursor: projection.cursor };
        const page = await ctx.db
            .query("agentExecutionEvents")
            .withIndex("by_mission_and_sequence", (q) =>
                q
                    .eq("missionId", mission._id)
                    .lte("sequence", projection.throughSequence),
            )
            .paginate({
                numItems: HISTORY_PAGE_SIZE,
                cursor: projection.cursor,
            });
        for (const event of page.page) {
            if (event.sequence === undefined)
                throw executionError("mission_history_invalid");
            if (event.historySourceSequence === undefined)
                await ctx.db.patch(event._id, {
                    historySourceSequence: event.sequence,
                });
        }
        const cursor = page.isDone ? null : page.continueCursor;
        await ctx.db.patch(mission._id, {
            historyProjection: { ...projection, cursor, ready: page.isDone },
        });
        return { done: page.isDone, cursor };
    },
});

/** Capture application observations without substituting backend continuation state for a model reply. */
export async function invocationEventObservation(
    ctx: QueryCtx,
    invocation: Doc<"agentInvocations">,
    response: Infer<
        typeof import("./executionProtocol").invocationResponseValidator
    >,
    rawOutputJson?: string,
) {
    const reply = await ctx.db
        .query("agentInvocationPayloads")
        .withIndex("by_invocation_and_part", (q) =>
            q.eq("invocationId", invocation._id).eq("part", "reply"),
        )
        .unique();
    const consultationOnly =
        response.kind === "operations" &&
        response.requests.length > 0 &&
        response.requests.every((request) =>
            isCommonConsultation(request.name),
        );
    return {
        historySource: consultationOnly ? undefined : ("observation" as const),
        invocationPayloadId: reply?._id,
        observation: {
            provenance: invocation.provenance,
            response,
            ...(invocation.provenance === "simulation" &&
            rawOutputJson !== undefined
                ? { rawOutputJson }
                : {}),
        },
    };
}
