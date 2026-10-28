import { validationSchemas } from "@convex/domain/executionValidationContracts";
import { savedMaterialSchemas } from "@convex/domain/savedMaterialOperations";
import { v } from "convex/values";

// Pure schema registration stays independent of runtime bindings and generated function types.
const registeredSchemas = [savedMaterialSchemas, validationSchemas] as const;
export const agentDefinitionIdValidator = v.union(
    ...registeredSchemas.map((schema) => schema.id),
);
export const agentDefinitionVersionValidator = v.number();
export const agentScopeValidator = v.union(
    ...registeredSchemas.map((schema) => schema.scope),
);
export const agentStateValidator = v.union(
    ...registeredSchemas.map((schema) => schema.state),
);
export const agentResultValidator = v.union(
    ...registeredSchemas.map((schema) => schema.result),
);
export const agentCompletionValidator = v.union(
    ...registeredSchemas.map((schema) => schema.completion),
);
export const consultMissionStateInputValidator = v.object({
    cursor: v.optional(v.string()),
});
export const operationInputValidator = v.union(
    v.object({
        kind: v.literal("consult_mission_state"),
        ...consultMissionStateInputValidator.fields,
    }),
    ...registeredSchemas.map((schema) => schema.operation),
);
export const operationPinValidator = v.union(
    v.object({ kind: v.literal("mission_history") }),
    ...registeredSchemas.map((schema) => schema.pin),
);
export const agentOperationSuccessValidator = v.union(
    ...registeredSchemas.map((schema) => schema.success),
);
