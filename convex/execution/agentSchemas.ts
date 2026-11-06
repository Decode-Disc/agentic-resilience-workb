import { conversationValidationSchemas } from "@convex/domain/conversationValidationContracts";
import { validationSchemas } from "@convex/domain/executionValidationContracts";
import { savedMaterialSchemas } from "@convex/domain/savedMaterialOperations";
import { sourcesSchemas } from "@convex/domain/sourcesContracts";
import { workbenchSchemas } from "@convex/domain/workbenchContracts";
import { v } from "convex/values";
import { historyReadPinValidator } from "./operationContracts";

// Pure schema registration stays independent of runtime bindings and generated function types.
const registeredSchemas = [
    sourcesSchemas,
    workbenchSchemas,
    savedMaterialSchemas,
    validationSchemas,
    conversationValidationSchemas,
] as const;
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
    reference: v.optional(v.id("agentExecutionEvents")),
    cursor: v.optional(v.string()),
});
export const consultConversationInputValidator = v.object({
    cursor: v.optional(v.string()),
});
export const consultRunStateInputValidator = v.object({});
export const operationInputValidator = v.union(
    v.object({
        kind: v.literal("consult_conversation"),
        ...consultConversationInputValidator.fields,
    }),
    v.object({
        kind: v.literal("consult_run_state"),
        ...consultRunStateInputValidator.fields,
    }),
    v.object({
        kind: v.literal("consult_mission_state"),
        ...consultMissionStateInputValidator.fields,
    }),
    ...registeredSchemas.map((schema) => schema.operation),
);
export const operationPinValidator = v.union(
    historyReadPinValidator,
    v.object({ kind: v.literal("run_state"), stateHash: v.string() }),
    v.object({ kind: v.literal("mission_history") }),
    ...registeredSchemas.map((schema) => schema.pin),
);
export const agentOperationSuccessValidator = v.union(
    ...registeredSchemas.map((schema) => schema.success),
);
