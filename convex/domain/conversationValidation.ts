import { internal } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { internalMutation, type QueryCtx } from "@convex/_generated/server";
import type { AgentDefinition } from "@convex/execution/agentDefinition";
import { executionError } from "@convex/execution/errors";
import type { AgentOperationDefinition } from "@convex/execution/executionProtocol";
import { operationReuseIdentity } from "@convex/execution/missionData";
import {
    BROWSER_TEST_SLOT,
    localBrowserFixturesEnabled,
    requireBrowserFixtureContext,
    requireBrowserTestOwner,
} from "@convex/runWorkspace";
import { v } from "convex/values";
import { conversationValidationSchemas as schemas } from "./conversationValidationContracts";

async function requireFixtureScope(ctx: QueryCtx, runId: Id<"researchRuns">) {
    if (!localBrowserFixturesEnabled())
        throw executionError("simulation_not_authorized");
    const run = await ctx.db.get(runId);
    if (run?.purpose !== "browser_test")
        throw executionError("simulation_not_authorized");
    const visitor = await requireBrowserTestOwner(ctx, BROWSER_TEST_SLOT);
    const contextId = await requireBrowserFixtureContext(ctx, visitor);
    if (
        run.ownerVisitorId !== visitor._id ||
        run.browserTestContextId !== contextId
    )
        throw executionError("simulation_not_authorized");
}

/** Local protocol fixture only; no provider route or analyst-facing business capability. */
export const conversationValidationOperations: Record<
    string,
    AgentOperationDefinition
> = {
    request_fixture_validation: {
        identity: operationReuseIdentity,
        version: 1,
        description: "Request one bounded local validation mission.",
        inputValidator: v.object({ values: v.array(v.number()) }),
        async pin(ctx, mission, input, runId) {
            const scopedRunId = mission?.runId ?? runId;
            if (!scopedRunId) throw executionError("simulation_not_authorized");
            await requireFixtureScope(ctx, scopedRunId);
            return input.kind === "request_fixture_validation"
                ? {
                      kind: "available",
                      pin: { kind: "fixture_child", values: input.values },
                  }
                : { kind: "unavailable", code: "invalid_fixture" };
        },
        childMission(request) {
            if (request.input.kind !== "request_fixture_validation")
                throw executionError("invalid_fixture");
            return {
                definitionId: "execution_validation_v1",
                scope: {
                    kind: "execution_validation_v1",
                    values: request.input.values,
                },
                maxRequests: 1,
            };
        },
        async execute(ctx, args) {
            if (!args.requestId) throw executionError("request_unavailable");
            return ctx.runMutation(internal.execution.handoffs.startChild, {
                requestId: args.requestId,
                expectedGeneration: args.expectedGeneration,
            });
        },
        validateOutcome(_request, outcome) {
            return outcome;
        },
    },
    wait_fixture_result: {
        nativeAuthority: "dossier",
        identity: operationReuseIdentity,
        version: 1,
        description: "Local deterministic deferred fixture.",
        inputValidator: v.object({ value: v.number() }),
        async pin(ctx, mission, input, runId) {
            const scopedRunId = mission?.runId ?? runId;
            if (!scopedRunId) throw executionError("simulation_not_authorized");
            await requireFixtureScope(ctx, scopedRunId);
            if (input.kind === "wait_fixture_result")
                fixtureResult(input.value);
            return input.kind === "wait_fixture_result"
                ? {
                      kind: "available",
                      pin: { kind: "fixture_wait", value: input.value },
                  }
                : { kind: "unavailable", code: "invalid_fixture" };
        },
        async execute(_ctx, args) {
            if (!args.requestId) throw executionError("request_unavailable");
            return { kind: "waiting", reference: args.requestId };
        },
        validateOutcome(request, outcome) {
            if (outcome.kind !== "success") return outcome;
            return request.input.kind === "wait_fixture_result" &&
                outcome.valueJson === fixtureResult(request.input.value)
                ? outcome
                : { kind: "refused", code: "fixture_result_invalid" };
        },
    },
};

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

function fixtureResult(value: number) {
    if (!Number.isSafeInteger(value) || !Number.isSafeInteger(value * 2))
        throw executionError("fixture_value_invalid");
    return JSON.stringify({ value: value * 2 });
}
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
