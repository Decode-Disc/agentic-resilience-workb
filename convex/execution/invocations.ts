import { internal } from "@convex/_generated/api";
import type { Doc } from "@convex/_generated/dataModel";
import {
    internalMutation,
    internalQuery,
    type MutationCtx,
    type QueryCtx,
} from "@convex/_generated/server";
import { SOURCE_COMPARISON_MAX_OUTPUT_BYTES } from "@convex/domain/sourceComparison";
import { stableStringify } from "@convex/domain/sourcePassages";
import {
    assertPreparationComparisonFence,
    assertPreparationExecutionFence,
} from "@convex/domain/sourcePreparationAuthority";
import { providerAttemptValidator } from "@convex/providerCalls";
import schema from "@convex/schema";
import { ConvexError, type Infer, v } from "convex/values";
import { validate } from "convex-helpers/validators";
import {
    canAdoptRetainedResponse,
    executionError,
    executionFailureCode,
    recordInvocationEvent,
    recordMissionEvent,
    requireMissionAuthority,
} from "./authority";
import { buildMissionContext } from "./context";
import {
    invocationReplyValidator,
    invocationResponseValidator,
    invocationStructureError,
    MAX_CONTEXT_BYTES,
    MAX_NO_PROGRESS_TURNS,
    MAX_OBSERVABLE_OUTPUT_BYTES,
    MAX_OPERATION_RESULT_BYTES,
    MAX_WORKING_NOTES_BYTES,
} from "./contracts";
import { getAgentDefinition } from "./definitions";
import { hasKnownNonDispatch, retainInvocationPayload } from "./journal";
import { persistOperationRequest } from "./operations";

async function settleReceiptObservation(
    ctx: MutationCtx,
    invocation: Doc<"agentInvocations">,
    attempt: Infer<typeof providerAttemptValidator>,
    observableReplyJson?: string,
) {
    if (
        attempt.status === "started" ||
        attempt.runId !== invocation.runId ||
        attempt.executionGeneration !== invocation.generation
    )
        throw executionError("invocation_receipt_invalid");
    const settled = await ctx.runMutation(
        internal.providerCalls.recordAttempt,
        attempt,
    );
    if (settled.providerCallId !== invocation.providerCallId)
        throw executionError("invocation_receipt_invalid");
    await retainInvocationPayload(
        ctx,
        invocation,
        "reply",
        observableReplyJson,
        attempt.dispatchOutcome === "unknown"
            ? "attempt_outcome_unknown"
            : attempt.dispatchOutcome === "not_dispatched"
              ? "not_dispatched"
              : "observable_reply_unavailable",
    );
}

async function requireDispatchAuthority(
    ctx: QueryCtx,
    invocationId: Doc<"agentInvocations">["_id"],
    expectedGeneration: number,
) {
    const invocation = await ctx.db.get(invocationId);
    if (
        !invocation ||
        invocation.generation !== expectedGeneration ||
        invocation.status !== "started"
    )
        throw executionError("invocation_unavailable");
    if (invocation.missionId) {
        await requireMissionAuthority(
            ctx,
            invocation.missionId,
            expectedGeneration,
        );
    } else {
        const receipt = invocation.providerCallId
            ? await ctx.db.get(invocation.providerCallId)
            : null;
        if (
            !receipt?.preparationId ||
            receipt.invocationId !== invocation._id ||
            receipt.status !== "started"
        )
            throw executionError("provider_receipt_required");
        if (receipt.operation === "source_comparison") {
            if (!receipt.sourceId)
                throw executionError("provider_receipt_required");
            await assertPreparationComparisonFence(ctx.db, {
                preparationId: receipt.preparationId,
                sourceId: receipt.sourceId,
                now: Date.now(),
            });
        } else {
            await assertPreparationExecutionFence(ctx.db, {
                preparationId: receipt.preparationId,
                sourceId: receipt.sourceId,
                now: Date.now(),
            });
        }
    }
    return invocation;
}

/** Rechecks current authority after the request transaction has been acknowledged. */
export const authorizeDispatch = internalQuery({
    args: {
        invocationId: v.id("agentInvocations"),
        expectedGeneration: v.number(),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        const invocation = await requireDispatchAuthority(
            ctx,
            args.invocationId,
            args.expectedGeneration,
        );
        const request = await ctx.db
            .query("agentInvocationPayloads")
            .withIndex("by_invocation_and_part", (q) =>
                q.eq("invocationId", invocation._id).eq("part", "request"),
            )
            .unique();
        if (request?.state !== "complete")
            throw executionError("journal_request_unavailable");
        return null;
    },
});

export const retainRequest = internalMutation({
    args: {
        invocationId: v.id("agentInvocations"),
        expectedGeneration: v.number(),
        requestJson: v.string(),
    },
    returns: v.union(
        v.object({ kind: v.literal("ready") }),
        v.object({ kind: v.literal("blocked"), code: v.string() }),
    ),
    handler: async (ctx, args) => {
        const invocation = await requireDispatchAuthority(
            ctx,
            args.invocationId,
            args.expectedGeneration,
        );
        const payload = await retainInvocationPayload(
            ctx,
            invocation,
            "request",
            args.requestJson,
        );
        return payload.state === "complete"
            ? { kind: "ready" as const }
            : {
                  kind: "blocked" as const,
                  code: payload.code ?? "journal_request_unavailable",
              };
    },
});

export const begin = internalMutation({
    args: {
        missionId: v.id("agentMissions"),
        expectedGeneration: v.number(),
        taskKey: v.string(),
        provenance: v.union(v.literal("live"), v.literal("simulation")),
    },
    returns: v.union(
        v.object({
            kind: v.literal("ready"),
            invocationId: v.id("agentInvocations"),
            inputJson: v.string(),
        }),
        v.object({ kind: v.literal("blocked"), code: v.string() }),
    ),
    handler: async (ctx, args) => {
        const { mission } = await requireMissionAuthority(
            ctx,
            args.missionId,
            args.expectedGeneration,
        );
        if (mission.provenance && mission.provenance !== args.provenance)
            throw executionError("invocation_identity_conflict");
        if (!/^[a-zA-Z0-9._:-]{1,160}$/.test(args.taskKey))
            throw executionError("invalid_task_key");
        const existing = await ctx.db
            .query("agentInvocations")
            .withIndex("by_run_and_task_key", (q) =>
                q
                    .eq("runId", mission.runId)
                    .eq("taskKey", `${mission._id}:${args.taskKey}`),
            )
            .unique();
        if (existing) {
            if (
                existing.provenance !== args.provenance ||
                existing.missionId !== mission._id ||
                existing.generation !== args.expectedGeneration
            )
                throw executionError("invocation_identity_conflict");
            return {
                kind: "ready" as const,
                invocationId: existing._id,
                inputJson: existing.inputJson,
            };
        }
        const pending = await ctx.db
            .query("agentOperationRequests")
            .withIndex("by_mission_and_status", (q) =>
                q.eq("missionId", mission._id).eq("status", "pending"),
            )
            .first();
        const running = await ctx.db
            .query("agentOperationRequests")
            .withIndex("by_mission_and_status", (q) =>
                q.eq("missionId", mission._id).eq("status", "running"),
            )
            .first();
        if (pending || running)
            return { kind: "blocked" as const, code: "pending_operations" };
        const previousInvocation = mission.lastInvocationId
            ? await ctx.db.get(mission.lastInvocationId)
            : null;
        if (previousInvocation?.status === "started")
            return { kind: "blocked" as const, code: "invocation_pending" };
        const context = await buildMissionContext(
            ctx,
            mission._id,
            args.expectedGeneration,
        );
        if (context.kind === "blocked") {
            await ctx.db.patch(mission._id, {
                status: "blocked",
                blockCode: context.code,
            });
            await recordMissionEvent(ctx, mission, {
                kind: "invocation_blocked",
                cause: args.taskKey,
                code: context.code,
            });
            return context;
        }
        const invocationId = await ctx.db.insert("agentInvocations", {
            journalVersion: 1,
            missionId: mission._id,
            runId: mission.runId,
            corpusRevisionId: mission.corpusRevisionId,
            generation: mission.generation,
            definitionVersion: mission.definitionVersion,
            taskKey: `${mission._id}:${args.taskKey}`,
            provenance: args.provenance,
            status: "started",
            inputJson: context.inputJson,
            progressCount: mission.progressKeys.length,
            createdAt: Date.now(),
        });
        await ctx.db.patch(mission._id, {
            lastInvocationId: invocationId,
            status: "running",
            provenance: args.provenance,
        });
        await recordMissionEvent(ctx, mission, {
            kind: "invocation_started",
            cause: args.taskKey,
            invocationId,
        });
        return {
            kind: "ready" as const,
            invocationId,
            inputJson: context.inputJson,
        };
    },
});

export const forExecution = internalQuery({
    args: {
        invocationId: v.id("agentInvocations"),
        expectedGeneration: v.number(),
    },
    returns: v.object({
        invocation: schema.doc("agentInvocations"),
        mission: schema.doc("agentMissions"),
    }),
    handler: async (ctx, args) => {
        const invocation = await ctx.db.get(args.invocationId);
        if (
            !invocation?.missionId ||
            invocation.generation !== args.expectedGeneration ||
            invocation.status !== "started"
        )
            throw executionError("invocation_unavailable");
        const { mission } = await requireMissionAuthority(
            ctx,
            invocation.missionId,
            args.expectedGeneration,
        );
        return { invocation, mission };
    },
});

export const retainOutput = internalMutation({
    args: {
        invocationId: v.id("agentInvocations"),
        expectedGeneration: v.number(),
        responseJson: v.string(),
        rawOutputJson: v.optional(v.string()),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        const invocation = await ctx.db.get(args.invocationId);
        if (!invocation || invocation.generation !== args.expectedGeneration)
            throw executionError("invocation_unavailable");
        if (
            new TextEncoder().encode(args.responseJson).length >
                MAX_OPERATION_RESULT_BYTES ||
            new TextEncoder().encode(args.rawOutputJson ?? "").length >
                MAX_OBSERVABLE_OUTPUT_BYTES
        )
            throw executionError("response_capacity");
        const receivedOutputJson = stableStringify(
            JSON.parse(args.responseJson),
        );
        if (
            invocation.receivedOutputJson &&
            invocation.receivedOutputJson !== receivedOutputJson
        )
            throw executionError("invocation_result_conflict");
        if (invocation.providerCallId) {
            const receipt = await ctx.db.get(invocation.providerCallId);
            if (
                receipt?.invocationId !== invocation._id ||
                receipt.status === "started"
            )
                throw executionError("provider_receipt_required");
        }
        if (invocation.provenance === "simulation")
            await retainInvocationPayload(
                ctx,
                invocation,
                "reply",
                JSON.stringify({
                    version: 1,
                    provenance: "simulation",
                    response: JSON.parse(args.responseJson),
                }),
            );
        else if (hasKnownNonDispatch({ ...invocation, receivedOutputJson })) {
            for (const part of ["request", "reply"] as const)
                await retainInvocationPayload(
                    ctx,
                    invocation,
                    part,
                    undefined,
                    "not_dispatched",
                );
        }
        let receivedWhileAuthorized = invocation.receivedWhileAuthorized;
        if (!invocation.receivedOutputJson && invocation.missionId) {
            try {
                await requireMissionAuthority(
                    ctx,
                    invocation.missionId,
                    args.expectedGeneration,
                );
                receivedWhileAuthorized = true;
            } catch (error) {
                if (!executionFailureCode(error)) throw error;
                receivedWhileAuthorized = false;
            }
        }
        await ctx.db.patch(invocation._id, {
            receivedOutputJson,
            ...(receivedWhileAuthorized !== undefined
                ? { receivedWhileAuthorized }
                : {}),
            ...(args.rawOutputJson
                ? { rawOutputJson: args.rawOutputJson }
                : {}),
        });
        if (invocation.missionId) {
            const mission = await ctx.db.get(invocation.missionId);
            if (mission && !invocation.receivedOutputJson)
                await recordMissionEvent(ctx, mission, {
                    kind: "invocation_output_observed",
                    cause: invocation.taskKey,
                    invocationId: invocation._id,
                });
        }
        return null;
    },
});

/** Receipt settlement and its observation commit together; business adoption remains a separate authority check. */
export const recordModelReply = internalMutation({
    args: {
        attempt: providerAttemptValidator,
        reply: invocationReplyValidator,
        observableReplyJson: v.optional(v.string()),
    },
    returns: v.null(),
    handler: async (
        ctx,
        { attempt, reply, observableReplyJson },
    ): Promise<null> => {
        if (
            !attempt.missionId ||
            !attempt.invocationId ||
            attempt.executionGeneration === undefined ||
            attempt.status === "started"
        )
            throw executionError("invocation_receipt_invalid");
        const invocation = await ctx.db.get(attempt.invocationId);
        if (!invocation) throw executionError("invocation_unavailable");
        await settleReceiptObservation(
            ctx,
            invocation,
            attempt,
            observableReplyJson,
        );
        await ctx.runMutation(internal.execution.invocations.retainOutput, {
            invocationId: attempt.invocationId,
            expectedGeneration: attempt.executionGeneration,
            responseJson: JSON.stringify(reply.response),
            ...(reply.rawOutputJson !== undefined
                ? { rawOutputJson: reply.rawOutputJson }
                : {}),
        });
        return null;
    },
});

export const beginOneShot = internalMutation({
    args: { providerCallId: v.id("providerCalls"), inputJson: v.string() },
    returns: v.id("agentInvocations"),
    handler: async (ctx, args) => {
        const receipt = await ctx.db.get(args.providerCallId);
        if (
            receipt?.service !== "model" ||
            !receipt.preparationId ||
            !receipt.runId ||
            !receipt.corpusRevisionId ||
            receipt.executionGeneration === undefined ||
            receipt.status !== "started" ||
            !["source_qualification", "source_comparison"].includes(
                receipt.operation,
            )
        )
            throw executionError("one_shot_not_authorized");
        if (receipt.operation === "source_comparison" && receipt.sourceId)
            await assertPreparationComparisonFence(ctx.db, {
                preparationId: receipt.preparationId,
                sourceId: receipt.sourceId,
                now: Date.now(),
            });
        else
            await assertPreparationExecutionFence(ctx.db, {
                preparationId: receipt.preparationId,
                sourceId: receipt.sourceId,
                now: Date.now(),
            });
        if (new TextEncoder().encode(args.inputJson).length > MAX_CONTEXT_BYTES)
            throw executionError("context_capacity");
        const runId = receipt.runId;
        const existing = await ctx.db
            .query("agentInvocations")
            .withIndex("by_run_and_task_key", (q) =>
                q.eq("runId", runId).eq("taskKey", receipt.operationKey),
            )
            .unique();
        if (existing) {
            if (
                existing.inputJson !== args.inputJson ||
                existing.providerCallId !== receipt._id
            )
                throw executionError("invocation_identity_conflict");
            return existing._id;
        }
        const id = await ctx.db.insert("agentInvocations", {
            journalVersion: 1,
            runId: receipt.runId,
            corpusRevisionId: receipt.corpusRevisionId,
            generation: receipt.executionGeneration,
            definitionVersion: receipt.workflowVersion ?? 1,
            taskKey: receipt.operationKey,
            provenance: "live",
            status: "started",
            inputJson: args.inputJson,
            providerCallId: receipt._id,
            createdAt: Date.now(),
        });
        await ctx.db.patch(receipt._id, { invocationId: id });
        const invocation = await ctx.db.get(id);
        if (!invocation) throw executionError("invocation_unavailable");
        await recordInvocationEvent(ctx, invocation, {
            kind: "invocation_started",
        });
        return id;
    },
});

export const finishOneShot = internalMutation({
    args: {
        invocationId: v.id("agentInvocations"),
        outputJson: v.string(),
        attempt: v.optional(providerAttemptValidator),
        observableReplyJson: v.optional(v.string()),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        const invocation = await ctx.db.get(args.invocationId);
        if (!invocation || invocation.missionId)
            throw executionError("invocation_unavailable");
        if (args.attempt)
            await settleReceiptObservation(
                ctx,
                invocation,
                args.attempt,
                args.observableReplyJson,
            );
        const receipt = invocation?.providerCallId
            ? await ctx.db.get(invocation.providerCallId)
            : null;
        if (
            !invocation ||
            invocation.missionId ||
            receipt?.invocationId !== invocation._id ||
            receipt.status === "started"
        )
            throw executionError("provider_receipt_required");
        if (
            new TextEncoder().encode(args.outputJson).length >
            SOURCE_COMPARISON_MAX_OUTPUT_BYTES + 1024
        )
            throw executionError("response_capacity");
        if (
            invocation.outputJson !== undefined &&
            invocation.outputJson !== args.outputJson
        )
            throw executionError("invocation_result_conflict");
        await ctx.db.patch(invocation._id, {
            outputJson: args.outputJson,
            status: "returned",
            completedAt: Date.now(),
        });
        return null;
    },
});

export const settle = internalMutation({
    args: {
        invocationId: v.id("agentInvocations"),
        expectedGeneration: v.number(),
    },
    returns: v.object({
        kind: v.union(
            v.literal("ready"),
            v.literal("waiting"),
            v.literal("blocked"),
        ),
        code: v.optional(v.string()),
    }),
    handler: async (ctx, args) => {
        const invocation = await ctx.db.get(args.invocationId);
        if (!invocation?.missionId || invocation.status !== "returned")
            throw executionError("invocation_pending");
        const { mission } = await requireMissionAuthority(
            ctx,
            invocation.missionId,
            args.expectedGeneration,
        );
        if (mission.lastInvocationId !== invocation._id)
            throw executionError("stale_invocation");
        if (mission.lastSettledInvocationId === invocation._id)
            return { kind: "ready" as const };
        for (const id of invocation.requestIds ?? []) {
            const request = await ctx.db.get(id);
            if (
                !request ||
                request.missionId !== mission._id ||
                request.status !== "completed"
            )
                return { kind: "waiting" as const };
        }
        const noProgressTurns =
            mission.progressKeys.length > (invocation.progressCount ?? 0)
                ? 0
                : mission.noProgressTurns + 1;
        const stopped = noProgressTurns >= MAX_NO_PROGRESS_TURNS;
        await ctx.db.patch(mission._id, {
            lastSettledInvocationId: invocation._id,
            noProgressTurns,
            status: stopped ? "blocked" : "ready",
            blockCode: stopped ? "repetition_stop" : undefined,
        });
        await recordMissionEvent(ctx, mission, {
            kind: stopped ? "repetition_stopped" : "continuation_ready",
            cause: invocation.taskKey,
            invocationId: invocation._id,
            ...(stopped ? { code: "repetition_stop" } : {}),
        });
        return stopped
            ? { kind: "blocked" as const, code: "repetition_stop" }
            : { kind: "ready" as const };
    },
});

export const finish = internalMutation({
    args: {
        invocationId: v.id("agentInvocations"),
        expectedGeneration: v.number(),
        response: invocationResponseValidator,
        rawOutputJson: v.optional(v.string()),
    },
    returns: v.object({
        kind: v.union(
            v.literal("waiting"),
            v.literal("completed"),
            v.literal("blocked"),
        ),
        requestIds: v.array(v.id("agentOperationRequests")),
        code: v.optional(v.string()),
    }),
    handler: async (ctx, args) => {
        const invocation = await ctx.db.get(args.invocationId);
        if (
            !invocation?.missionId ||
            (invocation.adoptionGeneration ?? invocation.generation) !==
                args.expectedGeneration
        )
            throw executionError("invocation_unavailable");
        const outputJson = stableStringify(args.response);
        if (
            invocation.receivedOutputJson &&
            invocation.receivedOutputJson !== outputJson
        )
            throw executionError("invocation_result_conflict");
        if (
            new TextEncoder().encode(outputJson).length >
                MAX_OPERATION_RESULT_BYTES ||
            new TextEncoder().encode(args.rawOutputJson ?? "").length >
                MAX_OBSERVABLE_OUTPUT_BYTES
        )
            throw executionError("response_capacity");
        if (invocation.status === "returned") {
            if (invocation.outputJson !== outputJson)
                throw executionError("invocation_result_conflict");
            return {
                kind: invocation.blockCode
                    ? ("blocked" as const)
                    : args.response.kind === "complete"
                      ? ("completed" as const)
                      : ("waiting" as const),
                requestIds: invocation.requestIds ?? [],
                ...(invocation.blockCode ? { code: invocation.blockCode } : {}),
            };
        }
        await ctx.db.patch(invocation._id, {
            status: "returned",
            outputJson,
            ...(args.rawOutputJson
                ? { rawOutputJson: args.rawOutputJson }
                : {}),
            completedAt: Date.now(),
        });
        const mission = await ctx.db.get(invocation.missionId);
        if (!mission) throw executionError("mission_unavailable");
        const block = async (code: string, terminal = false) => {
            await ctx.db.patch(invocation._id, { blockCode: code });
            if (terminal)
                await ctx.db.patch(mission._id, {
                    status: "blocked",
                    blockCode: code,
                });
            await recordMissionEvent(ctx, mission, {
                kind: "invocation_refused",
                cause: invocation.taskKey,
                invocationId: invocation._id,
                code,
            });
            return { kind: "blocked" as const, requestIds: [], code };
        };
        try {
            await requireMissionAuthority(
                ctx,
                mission._id,
                args.expectedGeneration,
            );
        } catch (error) {
            if (
                !(error instanceof ConvexError) ||
                typeof error.data !== "object" ||
                !error.data ||
                !("code" in error.data) ||
                typeof error.data.code !== "string"
            )
                throw error;
            return block(error.data.code);
        }
        if (
            invocation.receivedOutputJson &&
            !canAdoptRetainedResponse(mission, invocation)
        )
            return block("retained_response_not_reusable", true);
        if (args.response.kind === "blocked")
            return block(args.response.code, true);
        if (invocation.provenance === "live") {
            const receipt = invocation.providerCallId
                ? await ctx.db.get(invocation.providerCallId)
                : null;
            if (
                receipt?.status !== "succeeded" ||
                receipt.invocationId !== invocation._id ||
                receipt.dispatchOutcome !== "response_received"
            )
                return block("provider_receipt_required", true);
        }
        const notes = [mission.workingNotes, args.response.workingNotes]
            .filter(Boolean)
            .join("\n\n");
        if (new TextEncoder().encode(notes).length > MAX_WORKING_NOTES_BYTES)
            return block("working_memory_capacity", true);
        await ctx.db.patch(mission._id, { workingNotes: notes });
        if (args.response.kind === "complete") {
            const completion = await getAgentDefinition(
                mission.definitionId,
                mission.definitionVersion,
            ).complete(ctx, mission, args.response);
            if (completion.kind === "blocked") return block(completion.code);
            await ctx.db.patch(mission._id, {
                status: "completed",
                completionRefs: completion.completionRefs,
            });
            await recordMissionEvent(ctx, mission, {
                kind: "mission_completed",
                cause: invocation.taskKey,
                invocationId: invocation._id,
            });
            return { kind: "completed" as const, requestIds: [] };
        }
        const structureError = invocationStructureError(args.response);
        if (structureError) return block(structureError, true);
        const requestIds = [];
        for (const request of args.response.requests) {
            let decoded: unknown;
            try {
                decoded = JSON.parse(request.inputJson);
            } catch {
                decoded = null;
            }
            const input =
                decoded &&
                typeof decoded === "object" &&
                !Array.isArray(decoded) &&
                !("kind" in decoded)
                    ? { ...decoded, kind: request.name }
                    : null;
            const valid = validate(
                getAgentDefinition(
                    mission.definitionId,
                    mission.definitionVersion,
                ).operationValidator,
                input,
                {
                    db: ctx.db,
                },
            );
            requestIds.push(
                await persistOperationRequest(ctx, mission, {
                    invocationId: invocation._id,
                    actor: "agent",
                    cause: request.callId,
                    input: valid
                        ? input
                        : {
                              kind: "invalid" as const,
                              name: request.name,
                              inputJson: request.inputJson,
                          },
                }),
            );
        }
        await ctx.db.patch(invocation._id, { requestIds });
        await ctx.db.patch(mission._id, { status: "waiting" });
        await recordMissionEvent(ctx, mission, {
            kind: "invocation_returned",
            cause: invocation.taskKey,
            invocationId: invocation._id,
        });
        return { kind: "waiting" as const, requestIds };
    },
});
