import { v } from "convex/values";
export const REQUEST_APPROVAL_FIXTURE_CAUSE = "fixture-request-approval";

export const conversationValidationSchemas = {
    id: v.literal("conversation_validation_v1"),
    scope: v.object({ kind: v.literal("conversation_validation_v1") }),
    state: v.object({ kind: v.literal("conversation_validation_v1") }),
    result: v.object({
        kind: v.literal("conversation_validation_v1"),
        text: v.string(),
    }),
    completion: v.object({
        kind: v.literal("complete"),
        text: v.string(),
        workingNotes: v.optional(v.string()),
    }),
    operation: v.union(
        v.object({ kind: v.literal("wait_fixture_result"), value: v.number() }),
        v.object({
            kind: v.literal("request_fixture_validation"),
            values: v.array(v.number()),
        }),
    ),
    pin: v.union(
        v.object({ kind: v.literal("fixture_wait"), value: v.number() }),
        v.object({
            kind: v.literal("fixture_child"),
            values: v.array(v.number()),
        }),
    ),
    success: v.object({ kind: v.literal("success"), valueJson: v.string() }),
};
