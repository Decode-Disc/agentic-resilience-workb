import { internal } from "@convex/_generated/api";
import { internalMutation, internalQuery } from "@convex/_generated/server";
import { savedMaterialOperationValidator } from "@convex/domain/savedMaterialOperations";
import { SOURCE_COMPARISON_MAX_OUTPUT_BYTES } from "@convex/domain/sourceComparison";
import { stableStringify } from "@convex/domain/sourcePassages";
import {
    assertPreparationComparisonFence,
    assertPreparationExecutionFence,
} from "@convex/domain/sourcePreparationAuthority";
import schema from "@convex/schema";
import { ConvexError, v } from "convex/values";
import { validate } from "convex-helpers/validators";
import {
    executionError,
    recordMissionEvent,
    requireMissionAuthority,
} from "./authority";
import { buildMissionContext } from "./context";
import {
    invocationResponseValidator,
    MAX_BATCH_REQUESTS,
    MAX_CONTEXT_BYTES,
    MAX_NO_PROGRESS_TURNS,
    MAX_OBSERVABLE_OUTPUT_BYTES,
    MAX_OPERATION_RESULT_BYTES,
    MAX_WORKING_NOTES_BYTES,
} from "./contracts";
import { persistOperationRequest } from "./operations";

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
        await ctx.db.patch(invocation._id, {
            receivedOutputJson,
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
        return id;
    },
});

export const finishOneShot = internalMutation({
    args: { invocationId: v.id("agentInvocations"), outputJson: v.string() },
    returns: v.null(),
    handler: async (ctx, args) => {
        const invocation = await ctx.db.get(args.invocationId);
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
            invocation.generation !== args.expectedGeneration
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
            if (
                mission.obligations.length ||
                !args.response.captureIds.length ||
                args.response.captureIds.some(
                    (id) => !mission.inspectedCaptureIds.includes(id),
                )
            )
                return block("completion_requirements_missing");
            for (const id of args.response.captureIds) {
                const capture = await ctx.db.get(id);
                if (
                    capture?.runId !== mission.runId ||
                    capture.status !== "committed" ||
                    !capture.storageId ||
                    !(await ctx.db.system.get("_storage", capture.storageId))
                )
                    return block("completion_artifact_unavailable");
                try {
                    const allowed = await ctx.runQuery(
                        internal.sourceRetrieval.approvedCaptureForMission,
                        {
                            missionId: mission._id,
                            expectedGeneration: args.expectedGeneration,
                            sourceId: capture.sourceId,
                        },
                    );
                    if (
                        allowed.status !== "available" ||
                        allowed.capture._id !== id ||
                        allowed.capture.contentHash !== capture.contentHash
                    )
                        return block("completion_artifact_unavailable");
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
            }
            await ctx.db.patch(mission._id, {
                status: "completed",
                completionRefs: args.response.captureIds,
            });
            await recordMissionEvent(ctx, mission, {
                kind: "mission_completed",
                cause: invocation.taskKey,
                invocationId: invocation._id,
            });
            return { kind: "completed" as const, requestIds: [] };
        }
        if (args.response.requests.length > MAX_BATCH_REQUESTS)
            return block("operation_batch_limit", true);
        const callIds = args.response.requests.map((request) => request.callId);
        if (
            callIds.some((id) => id.length < 1 || id.length > 160) ||
            new Set(callIds).size !== callIds.length
        )
            return block("invalid_tool_correlation", true);
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
            const valid = validate(savedMaterialOperationValidator, input, {
                db: ctx.db,
            });
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
