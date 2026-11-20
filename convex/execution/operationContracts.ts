import type { QueryCtx } from "@convex/_generated/server";
import { researchStateValidator } from "@convex/domain/researchStateContracts";
import {
    executionStatusValidator,
    researchRunLifecycleValidator,
} from "@convex/domain/validators";
import { MAX_VALIDATION_FEEDBACK_FIELD_CHARS } from "@convex/resourcePolicy";
import type { Validator } from "convex/values";
import { type Infer, v } from "convex/values";
import { type ValidationError, validate } from "convex-helpers/validators";

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
    receivedAt: v.optional(v.string()),
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

const legacyRunStateResultValidator = v.object({
    lifecycleState: researchRunLifecycleValidator,
    executionStatus: executionStatusValidator,
    executionGeneration: v.number(),
});
export const currentRunStateResultValidator =
    legacyRunStateResultValidator.extend({ research: researchStateValidator });
export const runStateResultValidator = v.union(
    currentRunStateResultValidator,
    legacyRunStateResultValidator,
);
type FeedbackSchema = Validator<unknown, "required" | "optional", string>;
type FeedbackFailure = { path: string; expected: string; depth: number };

function joinFeedbackPath(prefix: string, key: string) {
    return prefix ? `${prefix}.${key}` : key;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value))
        return false;
    const prototype = Object.getPrototypeOf(value);
    return (
        prototype === null ||
        prototype === Object.prototype ||
        prototype?.constructor?.name === "Object"
    );
}

function describeSchema(validator: FeedbackSchema): string {
    if (validator.kind === "id" && "tableName" in validator)
        return `Id<${validator.tableName}>`;
    if (validator.kind === "union" && "members" in validator)
        return [
            ...new Set(
                (validator.members as FeedbackSchema[]).map(describeSchema),
            ),
        ].join(" | ");
    if (validator.kind === "literal" && "value" in validator)
        return String(validator.value);
    return validator.kind === "float64"
        ? "number"
        : validator.kind === "record"
          ? "object"
          : validator.kind;
}

function matchesDiscriminatorLiterals(
    member: FeedbackSchema,
    value: Record<string, unknown>,
): boolean {
    if (member.kind !== "object" || !("fields" in member)) return false;
    const fields = member.fields as Record<string, FeedbackSchema>;
    let hasDiscriminator = false;
    for (const [key, field] of Object.entries(fields)) {
        if (field.kind === "literal" && "value" in field) {
            hasDiscriminator = true;
            if (value[key] !== field.value) return false;
        }
    }
    return hasDiscriminator;
}

function resolveFeedbackFailure(
    validator: FeedbackSchema,
    value: unknown,
    path: string,
    depth: number,
    db?: QueryCtx["db"],
): FeedbackFailure | undefined {
    if (value === undefined) {
        if (validator.isOptional === "optional") return undefined;
        return { path, expected: describeSchema(validator), depth };
    }
    if (validator.kind === "union" && "members" in validator) {
        const members = validator.members as FeedbackSchema[];
        if (members.some((member) => validate(member, value, { db })))
            return undefined;
        const candidates = isPlainObject(value)
            ? members.filter((member) =>
                  matchesDiscriminatorLiterals(member, value),
              )
            : [];
        const pool = candidates.length ? candidates : members;
        const failures = pool.flatMap((member) => {
            const failure = resolveFeedbackFailure(
                member,
                value,
                path,
                depth,
                db,
            );
            return failure ? [failure] : [];
        });
        if (!failures.length)
            return { path, expected: describeSchema(validator), depth };
        const maxDepth = Math.max(...failures.map((f) => f.depth));
        const deepest = failures.filter((f) => f.depth === maxDepth);
        const first = deepest[0];
        if (!first) return { path, expected: describeSchema(validator), depth };
        const samePath = deepest.filter((f) => f.path === first.path);
        return {
            path: first.path,
            expected: [
                ...new Set(samePath.map((failure) => failure.expected)),
            ].join(" | "),
            depth: first.depth,
        };
    }
    if (validator.kind === "object" && "fields" in validator) {
        if (!isPlainObject(value)) return { path, expected: "object", depth };
        const fields = validator.fields as Record<string, FeedbackSchema>;
        for (const [key, child] of Object.entries(fields)) {
            if (!validate(child, value[key], { db }))
                return resolveFeedbackFailure(
                    child,
                    value[key],
                    joinFeedbackPath(path, key),
                    depth + 1,
                    db,
                );
        }
        for (const key of Object.keys(value)) {
            if (fields[key] === undefined && value[key] !== undefined)
                return {
                    path: joinFeedbackPath(path, key),
                    expected: "nothing",
                    depth: depth + 1,
                };
        }
        return undefined;
    }
    if (validator.kind === "array" && "element" in validator) {
        if (!Array.isArray(value)) return { path, expected: "array", depth };
        const element = validator.element as FeedbackSchema;
        for (const [index, item] of value.entries()) {
            if (!validate(element, item, { db }))
                return resolveFeedbackFailure(
                    element,
                    item,
                    `${path}[${index}]`,
                    depth + 1,
                    db,
                );
        }
        return undefined;
    }
    if (
        validator.kind === "record" &&
        "key" in validator &&
        "value" in validator
    ) {
        if (!isPlainObject(value)) return { path, expected: "object", depth };
        const keyValidator = validator.key as FeedbackSchema;
        const valueValidator = validator.value as FeedbackSchema;
        for (const [key, item] of Object.entries(value)) {
            if (item === undefined) continue;
            const entryPath = joinFeedbackPath(path, key);
            if (!validate(keyValidator, key, { db }))
                return {
                    path: entryPath,
                    expected: describeSchema(keyValidator),
                    depth: depth + 1,
                };
            if (!validate(valueValidator, item, { db }))
                return resolveFeedbackFailure(
                    valueValidator,
                    item,
                    entryPath,
                    depth + 1,
                    db,
                );
        }
        return undefined;
    }
    return { path, expected: describeSchema(validator), depth };
}

/** Error paths locate the canonical type; received prototype names are not expected types. */
export function operationInputFeedback(
    schema: FeedbackSchema,
    error: ValidationError,
    value?: unknown,
    db?: QueryCtx["db"],
): Infer<typeof validationFeedbackValidator> {
    if (value !== undefined) {
        const resolved = resolveFeedbackFailure(schema, value, "", 0, db);
        if (resolved)
            return {
                path: resolved.path.slice(
                    0,
                    MAX_VALIDATION_FEEDBACK_FIELD_CHARS,
                ),
                expected: resolved.expected.slice(
                    0,
                    MAX_VALIDATION_FEEDBACK_FIELD_CHARS,
                ),
            };
    }
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
    const expected =
        [...new Set(locate(schema, parts).map(describeSchema))].join(" | ") ||
        String(error.expected);
    return {
        path: path.slice(0, MAX_VALIDATION_FEEDBACK_FIELD_CHARS),
        expected: expected.slice(0, MAX_VALIDATION_FEEDBACK_FIELD_CHARS),
    };
}
