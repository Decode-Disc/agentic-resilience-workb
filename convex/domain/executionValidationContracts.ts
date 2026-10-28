import { v } from "convex/values";

export const validationScopeValidator = v.object({
    kind: v.literal("execution_validation_v1"),
    values: v.array(v.number()),
});
export const validationStateValidator = v.object({
    kind: v.literal("execution_validation_v1"),
    checkedIndices: v.array(v.number()),
});
export const validationResultValidator = v.object({
    kind: v.literal("execution_validation_v1"),
    total: v.number(),
});
export const validationCompletionValidator = v.object({
    kind: v.literal("complete"),
    total: v.number(),
    workingNotes: v.optional(v.string()),
});
export const checkValueInputValidator = v.object({ index: v.number() });
export const validationOperationValidator = v.object({
    kind: v.literal("check_fixture_value"),
    ...checkValueInputValidator.fields,
});

export const validationPinValidator = v.object({
    kind: v.literal("execution_validation_v1"),
    value: v.number(),
});
export const validationOperationSuccessValidator = v.object({
    kind: v.literal("success"),
    valueJson: v.string(),
    progressKey: v.optional(v.string()),
    progressKeys: v.optional(v.array(v.string())),
});
export const validationSchemas = {
    id: validationScopeValidator.fields.kind,
    scope: validationScopeValidator,
    state: validationStateValidator,
    result: validationResultValidator,
    completion: validationCompletionValidator,
    operation: validationOperationValidator,
    pin: validationPinValidator,
    success: validationOperationSuccessValidator,
};
