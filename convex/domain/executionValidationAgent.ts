import type { AgentDefinition } from "@convex/execution/agentDefinition";
import { executionError } from "@convex/execution/errors";
import type { AgentOperationDefinition } from "@convex/execution/executionProtocol";
import {
    missionScope,
    missionState,
    operationReuseIdentity,
} from "@convex/execution/missionData";
import {
    BROWSER_TEST_SLOT,
    requireBrowserFixtureContext,
    requireBrowserTestOwner,
} from "@convex/runWorkspace";
import { validate } from "convex-helpers/validators";
import {
    checkValueInputValidator,
    validationCompletionValidator,
    validationOperationSuccessValidator,
    validationResultValidator,
    validationScopeValidator,
    validationStateValidator,
} from "./executionValidationContracts";

/** Local contract probe: no research authority, external I/O or provider route. */
export const validationOperationBehavior: Pick<
    AgentOperationDefinition,
    "pin" | "execute" | "validateOutcome" | "identity"
> = {
    identity: operationReuseIdentity,
    async pin(_ctx, mission, input) {
        if (!mission) return { kind: "unavailable", code: "mission_required" };
        const scope = missionScope(mission);
        if (
            scope.kind !== "execution_validation_v1" ||
            input.kind !== "check_fixture_value" ||
            !Number.isInteger(input.index) ||
            input.index < 0 ||
            input.index >= scope.values.length
        )
            return { kind: "unavailable", code: "validation_index_invalid" };
        const value = scope.values[input.index];
        if (value === undefined)
            return { kind: "unavailable", code: "validation_index_invalid" };
        return {
            kind: "available",
            pin: { kind: "execution_validation_v1", value },
        };
    },
    async execute(ctx, args) {
        if (!args.missionId)
            return { kind: "refused", code: "mission_required" };
        // Dispatch has already claimed the authorized request; read immutable scope again at the boundary.
        const { internal } = await import("@convex/_generated/api");
        const context = await ctx.runQuery(internal.execution.context.build, {
            missionId: args.missionId,
            expectedGeneration: args.expectedGeneration,
        });
        if (context.kind !== "ready")
            return { kind: "unavailable", code: context.code };
        const input: unknown = JSON.parse(context.inputJson);
        if (
            args.input.kind !== "check_fixture_value" ||
            !input ||
            typeof input !== "object" ||
            !("validationValues" in input) ||
            !Array.isArray(input.validationValues)
        )
            return { kind: "refused", code: "validation_index_invalid" };
        const value: unknown = input.validationValues[args.input.index];
        if (typeof value !== "number")
            return { kind: "refused", code: "validation_index_invalid" };
        return {
            kind: "success",
            valueJson: JSON.stringify({ index: args.input.index, value }),
            progressKey: `checked:${args.input.index}`,
        };
    },
    validateOutcome(request, outcome) {
        if (outcome.kind !== "success") return outcome;
        if (!validate(validationOperationSuccessValidator, outcome))
            return { kind: "refused", code: "validation_result_invalid" };
        let value: unknown;
        try {
            value = JSON.parse(outcome.valueJson);
        } catch {
            return { kind: "refused", code: "validation_result_invalid" };
        }
        if (
            request.input.kind !== "check_fixture_value" ||
            request.pin?.kind !== "execution_validation_v1" ||
            !value ||
            typeof value !== "object" ||
            !("index" in value) ||
            !("value" in value) ||
            value.index !== request.input.index ||
            value.value !== request.pin.value
        )
            return { kind: "refused", code: "validation_result_invalid" };
        return {
            kind: "success",
            valueJson: outcome.valueJson,
            progressKey: `checked:${request.input.index}`,
        };
    },
};

export const validationOperations: Record<string, AgentOperationDefinition> = {
    check_fixture_value: {
        ...validationOperationBehavior,
        version: 1,
        description: "Inspect one deterministic fixture value.",
        inputValidator: checkValueInputValidator,
    },
};

export const executionValidationDefinition: AgentDefinition & {
    id: "execution_validation_v1";
} = {
    id: "execution_validation_v1",
    version: 1,
    authority: "local_fixture_validation_only",
    instructions:
        "Simulation only. Check each supplied fixture value, then report their total.",
    scopeValidator: validationScopeValidator,
    stateValidator: validationStateValidator,
    resultValidator: validationResultValidator,
    completionValidator: validationCompletionValidator,
    operations: validationOperations,
    initialState(scope) {
        if (
            scope.kind !== "execution_validation_v1" ||
            scope.values.length < 1 ||
            scope.values.length > 8 ||
            scope.values.some((value) => !Number.isSafeInteger(value)) ||
            !Number.isSafeInteger(
                scope.values.reduce((sum, value) => sum + value, 0),
            )
        )
            throw executionError("validation_scope_invalid");
        return {
            objectiveKey: `validation:${JSON.stringify(scope.values)}`,
            state: { kind: "execution_validation_v1", checkedIndices: [] },
            obligations: ["check_all_values"],
        };
    },
    async requireAuthority(ctx, mission, run) {
        const visitor = await requireBrowserTestOwner(ctx, BROWSER_TEST_SLOT);
        const contextId = await requireBrowserFixtureContext(ctx, visitor);
        if (
            run.purpose !== "browser_test" ||
            mission.ownerVisitorId !== visitor._id ||
            run.browserTestContextId !== contextId
        )
            throw executionError("simulation_not_authorized");
    },
    async context(_ctx, mission) {
        const scope = missionScope(mission);
        const state = missionState(mission);
        if (
            scope.kind !== "execution_validation_v1" ||
            state.kind !== "execution_validation_v1"
        )
            throw executionError("mission_contract_invalid");
        return {
            kind: "ready",
            context: {
                validationValues: scope.values,
                activeWork: { checkedIndices: state.checkedIndices },
            },
        };
    },
    progress(mission, outcome) {
        if (
            outcome.kind !== "success" ||
            !("progressKey" in outcome) ||
            !outcome.progressKey
        )
            return {};
        const state = missionState(mission);
        const scope = missionScope(mission);
        if (
            state.kind !== "execution_validation_v1" ||
            scope.kind !== "execution_validation_v1"
        )
            throw executionError("mission_contract_invalid");
        const index = Number(outcome.progressKey.slice("checked:".length));
        const checkedIndices = [...new Set([...state.checkedIndices, index])];
        return {
            state: { kind: "execution_validation_v1", checkedIndices },
            progressKeys: checkedIndices.map((i) => `checked:${i}`),
            obligations:
                checkedIndices.length === scope.values.length
                    ? []
                    : ["check_all_values"],
        };
    },
    async complete(_ctx, mission, response) {
        const scope = missionScope(mission);
        const state = missionState(mission);
        if (
            scope.kind !== "execution_validation_v1" ||
            state.kind !== "execution_validation_v1" ||
            !("total" in response) ||
            state.checkedIndices.length !== scope.values.length ||
            mission.obligations.length ||
            response.total !==
                scope.values.reduce((sum, value) => sum + value, 0)
        )
            return { kind: "blocked", code: "validation_incomplete" };
        return {
            kind: "completed",
            result: { kind: "execution_validation_v1", total: response.total },
        };
    },
    simulate(input) {
        if (
            !input ||
            typeof input !== "object" ||
            !("validationValues" in input) ||
            !Array.isArray(input.validationValues) ||
            !("activeWork" in input) ||
            !input.activeWork ||
            typeof input.activeWork !== "object" ||
            !("checkedIndices" in input.activeWork) ||
            !Array.isArray(input.activeWork.checkedIndices)
        )
            return { kind: "blocked", code: "simulation_context_invalid" };
        const index = input.activeWork.checkedIndices.length;
        if (index < input.validationValues.length)
            return {
                kind: "operations",
                requests: [
                    {
                        callId: `check-${index}`,
                        name: "check_fixture_value",
                        inputJson: JSON.stringify({ index }),
                    },
                ],
            };
        const scope = {
            kind: "execution_validation_v1",
            values: input.validationValues,
        };
        if (!validate(validationScopeValidator, scope))
            return { kind: "blocked", code: "simulation_context_invalid" };
        return {
            kind: "complete",
            total: scope.values.reduce((sum, value) => sum + value, 0),
        };
    },
};
