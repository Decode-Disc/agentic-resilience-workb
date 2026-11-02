import { internal } from "@convex/_generated/api";
import { internalMutation } from "@convex/_generated/server";
import type { AgentDefinition } from "@convex/execution/agentDefinition";
import { executionError } from "@convex/execution/errors";
import { localBrowserFixturesEnabled } from "@convex/runWorkspace";
import { v } from "convex/values";
import { conversationValidationSchemas as schemas } from "./conversationValidationContracts";
import {
    conversationValidationOperations,
    fixtureResult,
    requireFixtureScope,
} from "./conversationValidationOperations";

export const conversationValidationDefinition: AgentDefinition & {
    id: "conversation_validation_v1";
} = {
    id: "conversation_validation_v1",
    version: 1,
    executionScope: "conversation",
    authority: "local_fixture_conversation_only",
    instructions:
        "Simulation only. Reply to the explicitly supplied active messages; queued messages are excluded.",
    scopeValidator: schemas.scope,
    stateValidator: schemas.state,
    resultValidator: schemas.result,
    completionValidator: schemas.completion,
    operations: conversationValidationOperations,
    initialState() {
        return {
            objectiveKey: "conversation",
            state: { kind: "conversation_validation_v1" },
            obligations: [],
        };
    },
    async requireAuthority(ctx, _mission, run) {
        await requireFixtureScope(ctx, run._id);
    },
    async context() {
        return { kind: "ready", context: { activeWork: {} } };
    },
    progress() {
        return {};
    },
    async complete(_ctx, _mission, response) {
        if (!("text" in response) || !response.text.trim())
            return { kind: "blocked", code: "invalid_completion" };
        return {
            kind: "completed",
            result: { kind: "conversation_validation_v1", text: response.text },
        };
    },
    conversationReply(result) {
        if (result.kind !== "conversation_validation_v1")
            throw executionError("invalid_completion");
        return result.text;
    },
    simulate() {
        return {
            kind: "complete",
            text: "Simulation reply to the active request.",
        };
    },
};

export const completeDeferred = internalMutation({
    args: {
        requestId: v.id("agentOperationRequests"),
        expectedGeneration: v.number(),
    },
    returns: v.null(),
    handler: async (ctx, args): Promise<null> => {
        if (!localBrowserFixturesEnabled())
            throw executionError("simulation_not_authorized");
        const request = await ctx.db.get(args.requestId);
        const mission = request?.missionId
            ? await ctx.db.get(request.missionId)
            : null;
        const runId = mission?.runId ?? request?.runId;
        const run = runId ? await ctx.db.get(runId) : null;
        if (
            run?.purpose !== "browser_test" ||
            request?.input.kind !== "wait_fixture_result"
        )
            throw executionError("simulation_not_authorized");
        await ctx.runMutation(internal.execution.operations.recordResult, {
            ...args,
            outcome: {
                kind: "success",
                valueJson: fixtureResult(request.input.value),
            },
        });
        return null;
    },
});
