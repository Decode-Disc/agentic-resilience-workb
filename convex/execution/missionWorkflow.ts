import { internal } from "@convex/_generated/api";
import { internalMutation } from "@convex/_generated/server";
import { workflow } from "@convex/workflow";
import {
    type EventId,
    vResultValidator,
    vWorkflowId,
} from "@convex-dev/workflow";
import type { FunctionReturnType } from "convex/server";
import { v } from "convex/values";
import { validate } from "convex-helpers/validators";
import {
    canAdoptRetainedResponse,
    executionError,
    executionFailureCode,
    recordMissionEvent,
    requireMissionAuthority,
} from "./authority";
import {
    operationOutcomeValidator as importOutcomeValidator,
    invocationResponseValidator,
} from "./executionProtocol";

const nextValidator = v.union(
    v.object({ kind: v.literal("wait"), eventId: v.string() }),
    v.object({
        kind: v.literal("adoptOperation"),
        requestId: v.id("agentOperationRequests"),
        outcome: importOutcomeValidator,
    }),
    v.object({ kind: v.literal("stopped") }),
    v.object({
        kind: v.literal("dispatch"),
        requestId: v.id("agentOperationRequests"),
    }),
    v.object({
        kind: v.literal("settle"),
        invocationId: v.id("agentInvocations"),
    }),
    v.object({
        kind: v.literal("invoke"),
        invocationId: v.id("agentInvocations"),
    }),
    v.object({
        kind: v.literal("adopt"),
        invocationId: v.id("agentInvocations"),
        response: invocationResponseValidator,
        rawOutputJson: v.optional(v.string()),
    }),
    v.object({ kind: v.literal("begin"), taskKey: v.string() }),
);

export const next = internalMutation({
    args: { missionId: v.id("agentMissions"), expectedGeneration: v.number() },
    returns: nextValidator,
    handler: async (ctx, args) => {
        const mission = await ctx.db.get(args.missionId);
        if (
            !mission ||
            mission.generation !== args.expectedGeneration ||
            ["blocked", "completed", "cancelled"].includes(mission.status)
        )
            return { kind: "stopped" as const };
        const invocation = mission.lastInvocationId
            ? await ctx.db.get(mission.lastInvocationId)
            : null;
        try {
            await requireMissionAuthority(
                ctx,
                mission._id,
                args.expectedGeneration,
            );
            if (
                invocation?.status === "started" &&
                invocation.receivedOutputJson &&
                !canAdoptRetainedResponse(mission, invocation)
            )
                throw executionError("retained_response_not_reusable");
        } catch (error) {
            const code = executionFailureCode(error);
            if (!code) throw error;
            const run = await ctx.db.get(mission.runId);
            if (
                "protocolVersion" in mission &&
                mission.protocolVersion === 3 &&
                mission.executionScope !== "conversation" &&
                run?.executionStatus === "paused"
            ) {
                await ctx.db.patch(mission._id, { status: "waiting" });
                return { kind: "stopped" as const };
            }
            await ctx.db.patch(mission._id, {
                status: "blocked",
                blockCode: code,
            });
            await recordMissionEvent(ctx, mission, {
                kind: "mission_blocked",
                cause: "continuation",
                code,
            });
            return { kind: "stopped" as const };
        }
        const running = await ctx.db
            .query("agentOperationRequests")
            .withIndex("by_mission_and_status", (q) =>
                q.eq("missionId", mission._id).eq("status", "running"),
            )
            .first();
        const pending = await ctx.db
            .query("agentOperationRequests")
            .withIndex("by_mission_and_status", (q) =>
                q.eq("missionId", mission._id).eq("status", "pending"),
            )
            .first();
        const request = running ?? pending;
        if (running?.waitEventId && !running.outcome)
            return { kind: "wait" as const, eventId: running.waitEventId };
        if (request)
            return {
                kind: "dispatch" as const,
                requestId: request._id,
            };
        const observedOperation = await ctx.db
            .query("agentOperationRequests")
            .withIndex("by_mission_and_status", (q) =>
                q.eq("missionId", mission._id).eq("status", "observed"),
            )
            .first();
        if (observedOperation?.outcome)
            return {
                kind: "adoptOperation" as const,
                requestId: observedOperation._id,
                outcome: observedOperation.outcome,
            };
        const waitingOperation = await ctx.db
            .query("agentOperationRequests")
            .withIndex("by_mission_and_status", (q) =>
                q.eq("missionId", mission._id).eq("status", "waiting"),
            )
            .first();
        if (waitingOperation) {
            if (!waitingOperation.waitEventId)
                throw executionError("continuation_unavailable");
            return {
                kind: "wait" as const,
                eventId: waitingOperation.waitEventId,
            };
        }
        if (invocation?.status === "started") {
            if (invocation.receivedOutputJson) {
                const response: unknown = JSON.parse(
                    invocation.receivedOutputJson,
                );
                if (
                    !validate(invocationResponseValidator, response, {
                        db: ctx.db,
                    })
                )
                    throw executionError("retained_response_invalid");
                return {
                    kind: "adopt" as const,
                    invocationId: invocation._id,
                    response,
                    ...(invocation.rawOutputJson
                        ? { rawOutputJson: invocation.rawOutputJson }
                        : {}),
                };
            }
            if (invocation.providerCallId) {
                await ctx.db.patch(mission._id, {
                    status: "blocked",
                    blockCode: "attempt_outcome_unknown",
                });
                await recordMissionEvent(ctx, mission, {
                    kind: "mission_blocked",
                    cause: invocation.taskKey,
                    invocationId: invocation._id,
                    code: "attempt_outcome_unknown",
                });
                return { kind: "stopped" as const };
            }
            return { kind: "invoke" as const, invocationId: invocation._id };
        }
        if (
            invocation?.status === "returned" &&
            mission.lastSettledInvocationId !== invocation._id
        )
            return { kind: "settle" as const, invocationId: invocation._id };
        return {
            kind: "begin" as const,
            taskKey: `turn-${mission.nextEventSequence}`,
        };
    },
});

export const onComplete = internalMutation({
    args: {
        workflowId: vWorkflowId,
        result: vResultValidator,
        context: v.object({ missionId: v.id("agentMissions") }),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        const mission = await ctx.db.get(args.context.missionId);
        if (!mission || mission.workflowId !== args.workflowId) return null;
        await ctx.db.patch(mission._id, { workflowId: undefined });
        if (
            args.result.kind !== "success" &&
            !["completed", "cancelled", "blocked"].includes(mission.status)
        ) {
            await ctx.db.patch(mission._id, {
                status: "blocked",
                blockCode: "execution_interrupted",
            });
            await recordMissionEvent(ctx, mission, {
                kind: "mission_blocked",
                cause: "workflow_completion",
                code: "execution_interrupted",
            });
        }
        if (mission.parentRequestId || mission.completionEventId)
            await ctx.runMutation(internal.execution.handoffs.finishChild, {
                missionId: mission._id,
            });
        return null;
    },
});

// Step names are persisted by Workflow; keep these references stable across module renames.
const workflowDefinition = workflow
    .define({
        args: {
            missionId: v.id("agentMissions"),
            expectedGeneration: v.number(),
            simulation: v.boolean(),
        },
        returns: v.null(),
    })
    .handler(async (step, args): Promise<null> => {
        while (true) {
            const nextStep: FunctionReturnType<
                typeof internal.execution.missionWorkflow.next
            > = await step.runMutation(
                internal.execution.missionWorkflow.next,
                {
                    missionId: args.missionId,
                    expectedGeneration: args.expectedGeneration,
                },
            );
            switch (nextStep.kind) {
                case "wait":
                    await step.awaitEvent({ id: nextStep.eventId as EventId });
                    break;
                case "adoptOperation":
                    await step.runMutation(
                        internal.execution.operations.recordResult,
                        {
                            requestId: nextStep.requestId,
                            expectedGeneration: args.expectedGeneration,
                            outcome: nextStep.outcome,
                        },
                    );
                    break;
                case "stopped":
                    return null;
                case "dispatch":
                    await step.runAction(
                        internal.execution.operations.dispatch,
                        {
                            requestId: nextStep.requestId,
                            expectedGeneration: args.expectedGeneration,
                        },
                        { retry: false },
                    );
                    break;
                case "settle":
                    await step.runMutation(
                        internal.execution.invocations.settle,
                        {
                            invocationId: nextStep.invocationId,
                            expectedGeneration: args.expectedGeneration,
                        },
                    );
                    break;
                case "begin": {
                    const begun = await step.runMutation(
                        internal.execution.invocations.begin,
                        {
                            missionId: args.missionId,
                            expectedGeneration: args.expectedGeneration,
                            taskKey: nextStep.taskKey,
                            provenance: args.simulation ? "simulation" : "live",
                        },
                    );
                    if (begun.kind !== "ready")
                        throw executionError(begun.code);
                    break;
                }
                case "adopt":
                    await step.runMutation(
                        internal.execution.invocations.finish,
                        {
                            invocationId: nextStep.invocationId,
                            expectedGeneration: args.expectedGeneration,
                            response: nextStep.response,
                            ...(nextStep.rawOutputJson
                                ? { rawOutputJson: nextStep.rawOutputJson }
                                : {}),
                        },
                    );
                    break;
                case "invoke": {
                    const reply = await step.runAction(
                        internal.execution.modelActions.invoke,
                        {
                            invocationId: nextStep.invocationId,
                            expectedGeneration: args.expectedGeneration,
                        },
                        { retry: false },
                    );
                    await step.runMutation(
                        internal.execution.invocations.finish,
                        {
                            invocationId: nextStep.invocationId,
                            expectedGeneration: args.expectedGeneration,
                            response: reply.response,
                            ...(reply.rawOutputJson
                                ? { rawOutputJson: reply.rawOutputJson }
                                : {}),
                        },
                    );
                    break;
                }
            }
        }
    });

// Existing Workflow references remain registered; new executions pin the evolved driver.
export const run = workflowDefinition;
export const runV3 = workflowDefinition;
