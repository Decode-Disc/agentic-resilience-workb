import type { Id } from "@convex/_generated/dataModel";
import { internalQuery, type QueryCtx } from "@convex/_generated/server";
import { type Infer, v } from "convex/values";
import {
    executionError,
    requireDossierAuthority,
    requireMissionAuthority,
} from "./authority";
import {
    invocationResponseManifest,
    matchInvocationResponse,
    retainedNativeCalls,
} from "./journalReads";
import { completionFeedbackValidator } from "./operationContracts";
import {
    loadVerifiedNativeCompletionInvocation,
    requireNativeSession,
} from "./piControl";
import {
    needsNativeSettlement,
    piLeaseValidator,
    sessionForMission,
} from "./piSession";
import { retainedTextFragment } from "./retainedText";
import {
    invocationDocument,
    missionDocument,
    operationRequestDocument,
} from "./tableValidators";

/** Original task identity survives worker restart; reading a terminal tail grants no progression authority. */
export const nativeInvocation = internalQuery({
    args: {
        missionId: v.id("agentMissions"),
        expectedGeneration: v.number(),
        sessionId: v.id("piSessions"),
        taskKey: v.string(),
    },
    returns: v.union(invocationDocument, v.null()),
    handler: async (ctx, args) => {
        const mission = await requireNativeSession(
            ctx,
            args.missionId,
            args.sessionId,
            args.expectedGeneration,
        );
        const invocation = await ctx.db
            .query("agentInvocations")
            .withIndex("by_run_and_task_key", (q) =>
                q
                    .eq("runId", mission.runId)
                    .eq("taskKey", `${args.sessionId}:${args.taskKey}`),
            )
            .unique();
        if (invocation && invocation.missionId !== mission._id)
            throw executionError("pi_task_mission_conflict");
        return invocation;
    },
});

export const state = internalQuery({
    args: { missionId: v.id("agentMissions"), expectedGeneration: v.number() },
    returns: missionDocument,
    handler: async (ctx, args) => {
        const mission = await ctx.db.get(args.missionId);
        if (
            mission &&
            mission.generation === args.expectedGeneration &&
            ["completed", "cancelled"].includes(mission.status) &&
            needsNativeSettlement(
                mission,
                await sessionForMission(ctx, mission),
            )
        ) {
            await requireDossierAuthority(ctx, mission.runId);
            return mission;
        }
        return (
            await requireMissionAuthority(
                ctx,
                args.missionId,
                args.expectedGeneration,
            )
        ).mission;
    },
});

const historicalCorrelation = v.object({
    kind: v.literal("historical"),
    invocation: invocationDocument,
});

export const operation = internalQuery({
    args: {
        missionId: v.id("agentMissions"),
        expectedGeneration: v.number(),
        callId: v.string(),
        historical: v.optional(
            v.object({
                invocationId: v.id("agentInvocations"),
                responseHash: v.string(),
                index: v.number(),
            }),
        ),
    },
    returns: v.union(operationRequestDocument, historicalCorrelation, v.null()),
    handler: async (ctx, args) => {
        const { mission } = await requireMissionAuthority(
            ctx,
            args.missionId,
            args.expectedGeneration,
        );
        const invocation = mission.lastInvocationId
            ? await ctx.db.get(mission.lastInvocationId)
            : null;
        if (!invocation) throw executionError("invocation_unavailable");
        if (invocation.missionId !== mission._id)
            throw executionError("operation_correlation_invalid");
        const recovered = args.historical;
        if (
            recovered &&
            (recovered.invocationId !== invocation._id ||
                !(await matchInvocationResponse(
                    ctx,
                    invocation,
                    "adopted",
                    recovered,
                )))
        )
            throw executionError("operation_correlation_invalid");
        const calls = await retainedNativeCalls(ctx, invocation);
        if (calls) {
            const index = calls.findIndex(
                (call) => call.callId === args.callId,
            );
            const requestId = invocation.requestIds?.[index];
            const request = requestId ? await ctx.db.get(requestId) : null;
            if (request && request.missionId !== mission._id)
                throw executionError("operation_correlation_invalid");
            return request;
        }
        if (!invocation.requestIds?.length) return null;
        // Retained historical responses must be reconstructed outside this transaction.
        if (!recovered && invocation.outputTextId)
            return { kind: "historical" as const, invocation };
        const response =
            !recovered && invocation.outputJson
                ? JSON.parse(invocation.outputJson)
                : null;
        const index =
            recovered?.index ??
            (response?.kind === "operations"
                ? response.requests.findIndex(
                      (r: { callId: string }) => r.callId === args.callId,
                  )
                : -1);
        if (!Number.isSafeInteger(index) || index < -1)
            throw executionError("operation_correlation_invalid");
        const id = invocation.requestIds[index];
        if (id) {
            const request = await ctx.db.get(id);
            if (request && request.missionId !== mission._id)
                throw executionError("operation_correlation_invalid");
            return request;
        }
        for (const requestId of invocation.requestIds) {
            const request = await ctx.db.get(requestId);
            if (
                request?.cause === args.callId &&
                request.missionId === mission._id
            )
                return request;
        }
        return null;
    },
});

const completionDispositionValidator = v.union(
    v.object({ kind: v.literal("accepted") }),
    v.object({
        kind: v.literal("operation"),
        requestId: v.id("agentOperationRequests"),
    }),
    v.object({ kind: v.literal("pending") }),
    v.object({
        kind: v.literal("refused"),
        code: v.string(),
        correction: v.optional(completionFeedbackValidator),
    }),
);

/** Resolves the retained disposition of a submit_completion tool call without re-running domain completion. */
export const completionDisposition = internalQuery({
    args: {
        ...piLeaseValidator.fields,
        callId: v.string(),
    },
    returns: v.union(completionDispositionValidator, historicalCorrelation),
    handler: async (ctx, args) => {
        const { callId, ...lease } = args;
        const verified = await loadVerifiedNativeCompletionInvocation(
            ctx,
            lease,
        );
        if (!verified) throw executionError("completion_correlation_invalid");
        if (verified.kind === "historical") return verified;
        const { mission, invocation, requests } = verified;
        if (requests) {
            await requireMissionAuthority(ctx, mission._id, lease.generation);
            const index = requests.findIndex(
                (request) => request.callId === callId && request.completion,
            );
            const requestId =
                index >= 0 ? invocation.requestIds?.[index] : undefined;
            const request = requestId ? await ctx.db.get(requestId) : null;
            if (!request || request.missionId !== mission._id)
                throw executionError("completion_correlation_invalid");
            return { kind: "operation" as const, requestId: request._id };
        }
        if (verified.callId === undefined || verified.callId !== callId)
            throw executionError("completion_correlation_invalid");
        if (mission.status === "completed" && !invocation.blockCode)
            return { kind: "accepted" as const };
        if (invocation.blockCode === "pending_operations")
            return { kind: "pending" as const };
        await requireMissionAuthority(ctx, mission._id, lease.generation);
        if (
            invocation.blockCode === "completion_correction_required" ||
            invocation.blockCode === "mission_context_changed" ||
            invocation.blockCode === "stale_instructions"
        )
            return {
                kind: "refused" as const,
                code: invocation.blockCode,
                ...(invocation.correction
                    ? { correction: invocation.correction }
                    : {}),
            };
        throw executionError(
            invocation.blockCode ?? "completion_correlation_invalid",
        );
    },
});

/** Confirms an accepted sole native completion from retained state for afterTools tail settlement. */
const recoveryInvocationValidator = v.object({
    invocationId: v.id("agentInvocations"),
    expectedGeneration: v.number(),
});

async function requireRecoveryInvocation(
    ctx: QueryCtx,
    {
        invocationId,
        expectedGeneration,
    }: Infer<typeof recoveryInvocationValidator>,
    sessionId?: Id<"piSessions">,
) {
    const invocation = await ctx.db.get(invocationId);
    if (!invocation?.missionId) throw executionError("invocation_unavailable");
    if (sessionId)
        await requireNativeSession(
            ctx,
            invocation.missionId,
            sessionId,
            expectedGeneration,
        );
    else {
        if (
            (invocation.adoptionGeneration ?? invocation.generation) !==
            expectedGeneration
        )
            throw executionError("invocation_unavailable");
        await requireMissionAuthority(
            ctx,
            invocation.missionId,
            expectedGeneration,
        );
    }
    return invocation;
}

export const invocation = internalQuery({
    args: recoveryInvocationValidator.fields,
    returns: invocationDocument,
    handler: (ctx, args) => requireRecoveryInvocation(ctx, args),
});

/** Reads one fragment of the response pinned by the invocation and recovery authority. */
export const invocationFragment = internalQuery({
    args: {
        ...recoveryInvocationValidator.fields,
        sessionId: v.optional(v.id("piSessions")),
        part: v.union(
            v.literal("received"),
            v.literal("adopted"),
            v.literal("raw"),
        ),
        textId: v.id("retainedTexts"),
        index: v.number(),
    },
    returns: v.object({
        content: v.string(),
        fragmentCount: v.number(),
        contentHash: v.string(),
        characters: v.number(),
        sizeBytes: v.number(),
    }),
    handler: async (ctx, args) => {
        const invocation = await requireRecoveryInvocation(
            ctx,
            args,
            args.sessionId,
        );
        const expected =
            args.part === "raw"
                ? invocation.rawOutputTextId
                : args.part === "adopted"
                  ? invocation.outputTextId
                  : invocation.receivedOutputTextId;
        if (expected !== args.textId)
            throw executionError("invocation_result_conflict");
        const text = await invocationResponseManifest(
            ctx,
            invocation,
            args.textId,
            args.part === "raw" ? "raw" : "response",
        );
        return {
            content: await retainedTextFragment(ctx, text, args.index),
            fragmentCount: text.fragmentHashes.length,
            contentHash: text.contentHash,
            characters: text.characters,
            sizeBytes: text.sizeBytes,
        };
    },
});

export const nextOperation = internalQuery({
    args: { missionId: v.id("agentMissions"), expectedGeneration: v.number() },
    returns: v.union(operationRequestDocument, v.null()),
    handler: async (ctx, args) => {
        await requireMissionAuthority(
            ctx,
            args.missionId,
            args.expectedGeneration,
        );
        for (const status of [
            "observed",
            "waiting",
            "running",
            "pending",
            "unknown",
        ] as const) {
            const request = await ctx.db
                .query("agentOperationRequests")
                .withIndex("by_mission_and_status", (q) =>
                    q.eq("missionId", args.missionId).eq("status", status),
                )
                .first();
            if (request) return request;
        }
        return null;
    },
});

export const terminalCompletionAccepted = internalQuery({
    args: piLeaseValidator.fields,
    returns: v.union(v.boolean(), historicalCorrelation),
    handler: async (ctx, lease) => {
        const verified = await loadVerifiedNativeCompletionInvocation(
            ctx,
            lease,
            { requireCompleted: true, requireNoBlock: true },
        );
        if (verified?.kind === "historical") return verified;
        return verified?.callId !== undefined;
    },
});
