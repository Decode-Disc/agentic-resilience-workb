import { internal } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { QueryCtx } from "@convex/_generated/server";
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
export async function requireFixtureScope(
    ctx: QueryCtx,
    runId: Id<"researchRuns">,
) {
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

export function fixtureResult(value: number) {
    if (!Number.isSafeInteger(value) || !Number.isSafeInteger(value * 2))
        throw executionError("fixture_value_invalid");
    return JSON.stringify({ value: value * 2 });
}

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
