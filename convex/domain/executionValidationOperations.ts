import type { AgentOperationDefinition } from "@convex/execution/executionProtocol";
import {
    missionScope,
    operationReuseIdentity,
} from "@convex/execution/missionData";
import { validate } from "convex-helpers/validators";
import {
    checkValueInputValidator,
    validationOperationSuccessValidator,
} from "./executionValidationContracts";
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
