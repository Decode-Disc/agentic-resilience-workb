import {
    type AgentDefinition,
    domainSnapshot,
} from "@convex/execution/agentDefinition";
import { executionError } from "@convex/execution/errors";
import { missionScope, missionState } from "@convex/execution/missionData";
import {
    requireBrowserFixtureContext,
    requireBrowserTestRunOwner,
} from "@convex/runWorkspace";
import { validate } from "convex-helpers/validators";
import {
    validationCompletionValidator,
    validationResultValidator,
    validationScopeValidator,
    validationStateValidator,
} from "./executionValidationContracts";
import { validationOperations } from "./executionValidationOperations";

export const executionValidationV2Definition: AgentDefinition & {
    id: "execution_validation_v1";
} = {
    id: "execution_validation_v1",
    identity: "workbench",
    version: 2,
    contextRendering: "separated_v1",
    executionScope: "research",
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
        const visitor = await requireBrowserTestRunOwner(ctx, run);
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
            facts: [outcome.progressKey],
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
        input = domainSnapshot(input);
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

export const executionValidationV3Definition: AgentDefinition & {
    id: "execution_validation_v1";
} = {
    ...executionValidationV2Definition,
    version: 3,
    completionTransport: "native_tool",
    instructions:
        "Simulation only. Check each supplied fixture value, then call submit_completion alone with their total.",
};

export const executionValidationDefinition = executionValidationV3Definition;
