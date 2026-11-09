import {
    executionStatusValidator,
    researchRunLifecycleValidator,
} from "@convex/domain/validators";
import type { Validator } from "convex/values";
import { type Infer, v } from "convex/values";
import type { ValidationError } from "convex-helpers/validators";

/** Shared observations cannot depend on a particular agent's business result schema. */
export const commonOperationSuccessValidator = v.object({
    progressKeys: v.optional(v.array(v.string())),
    kind: v.literal("success"),
    valueJson: v.string(),
});

export const historyFrontierValidator = v.union(
    v.object({ source: v.literal("mission"), sequence: v.number() }),
    v.object({
        source: v.literal("conversation"),
        throughCreationTime: v.number(),
        throughMessageId: v.union(v.id("agentMessageDeliveries"), v.null()),
        publicationRevision: v.number(),
    }),
);

export const historyPositionValidator = v.union(
    v.object({
        source: v.literal("mission"),
        sequence: v.number(),
        offset: v.number(),
    }),
    v.object({
        source: v.literal("conversation"),
        cursor: v.union(v.string(), v.null()),
        offset: v.number(),
    }),
);

/** Private evidence of exactly which immutable fragments an authorized read exposed. */
export const historyReadReceiptValidator = v.object({
    version: v.literal(1),
    source: v.union(v.literal("conversation"), v.literal("mission")),
    runId: v.id("researchRuns"),
    missionId: v.id("agentMissions"),
    generation: v.number(),
    instructionVersion: v.optional(v.number()),
    frontier: historyFrontierValidator,
    fragmentIds: v.array(v.string()),
    restorable: v.optional(v.boolean()),
    next: v.union(historyPositionValidator, v.null()),
});

export type HistoryReadReceipt = Infer<typeof historyReadReceiptValidator>;

export const historyReadPinValidator = v.object({
    kind: v.literal("history_read"),
    reference: v.optional(v.id("agentExecutionEvents")),
    source: v.union(v.literal("conversation"), v.literal("mission")),
    frontier: v.optional(historyFrontierValidator),
});

const fragmentFields = {
    offset: v.number(),
    totalCharacters: v.number(),
    content: v.string(),
};
export const missionHistoryEntryValidator = v.object({
    sequence: v.number(),
    ...fragmentFields,
});
export const conversationHistoryEntryValidator = v.object({
    messageId: v.id("agentMessageDeliveries"),
    turnId: v.optional(v.id("agentConversationTurns")),
    role: v.union(v.literal("user"), v.literal("assistant")),
    ...fragmentFields,
});
export const historyPageValidator = v.object({
    entries: v.array(
        v.union(
            missionHistoryEntryValidator,
            conversationHistoryEntryValidator,
        ),
    ),
    continueCursor: v.union(v.string(), v.null()),
});

/** Administration-only cause, excluded from model and analyst projections. */
export const protectedDiagnosticValidator = v.object({
    phase: v.union(
        v.literal("before_callback"),
        v.literal("read_callback"),
        v.literal("effect_callback"),
        v.literal("validate_outcome"),
        v.literal("reduce_progress"),
        v.literal("provider_transport"),
    ),
    name: v.string(),
    message: v.string(),
    causeHash: v.string(),
});

export const dispatchFailureValidator = v.object({
    category: v.union(
        v.literal("authority"),
        v.literal("incident"),
        v.literal("uncertain_effect"),
    ),
    code: v.string(),
    diagnostic: v.optional(protectedDiagnosticValidator),
});

/** Bounded immutable journal content; absent historical detail is never reconstructed. */
export const retainedPayloadValidator = v.object({
    version: v.literal(1),
    state: v.union(v.literal("complete"), v.literal("incomplete")),
    json: v.optional(v.string()),
    textId: v.optional(v.id("retainedTexts")),
    contentHash: v.optional(v.string()),
    sizeBytes: v.number(),
    code: v.optional(v.string()),
});

/** Only the shared history declarations may issue private read receipts. */
export function historySourceFor(
    kind: string,
): "conversation" | "mission" | undefined {
    return kind === "consult_conversation"
        ? "conversation"
        : kind === "consult_mission_state"
          ? "mission"
          : undefined;
}

/** Consultation audit entries cannot manufacture new retained source material. */
export function isCommonConsultation(kind: string): boolean {
    return kind === "consult_run_state" || historySourceFor(kind) !== undefined;
}

export const validationFeedbackValidator = v.object({
    path: v.string(),
    expected: v.string(),
});
export const completionFeedbackValidator = v.object({
    code: v.string(),
    issues: v.array(validationFeedbackValidator),
});

export const runStateResultValidator = v.object({
    lifecycleState: researchRunLifecycleValidator,
    executionStatus: executionStatusValidator,
    executionGeneration: v.number(),
});

const MAX_VALIDATION_FEEDBACK_FIELD_CHARS = 256;
type FeedbackSchema = Validator<unknown, "required" | "optional", string>;

/** Error paths locate the canonical type; received prototype names are not expected types. */
export function operationInputFeedback(
    schema: FeedbackSchema,
    error: ValidationError,
): Infer<typeof validationFeedbackValidator> {
    const path = error.path ?? "";
    const parts = path
        .replace(/\[(\d+)\]/g, ".$1")
        .split(".")
        .filter(Boolean);
    const locate = (
        validator: FeedbackSchema,
        remaining: string[],
    ): FeedbackSchema[] => {
        if (!remaining.length) return [validator];
        if (validator.kind === "union" && "members" in validator)
            return (validator.members as FeedbackSchema[]).flatMap((member) =>
                locate(member, remaining),
            );
        const [head, ...tail] = remaining;
        if (validator.kind === "object" && "fields" in validator && head) {
            const child = (validator.fields as Record<string, FeedbackSchema>)[
                head
            ];
            return child ? locate(child, tail) : [];
        }
        if (
            validator.kind === "array" &&
            "element" in validator &&
            head &&
            /^\d+$/.test(head)
        )
            return locate(validator.element as FeedbackSchema, tail);
        if (validator.kind === "record" && "value" in validator)
            return locate(validator.value as FeedbackSchema, tail);
        return [];
    };
    const describe = (validator: FeedbackSchema): string => {
        if (validator.kind === "id" && "tableName" in validator)
            return `Id<${validator.tableName}>`;
        if (validator.kind === "union" && "members" in validator)
            return (validator.members as FeedbackSchema[])
                .map(describe)
                .join(" | ");
        if (validator.kind === "literal" && "value" in validator)
            return String(validator.value);
        return validator.kind === "float64"
            ? "number"
            : validator.kind === "record"
              ? "object"
              : validator.kind;
    };
    const expected =
        [...new Set(locate(schema, parts).map(describe))].join(" | ") ||
        String(error.expected);
    return {
        path: path.slice(0, MAX_VALIDATION_FEEDBACK_FIELD_CHARS),
        expected: expected.slice(0, MAX_VALIDATION_FEEDBACK_FIELD_CHARS),
    };
}
