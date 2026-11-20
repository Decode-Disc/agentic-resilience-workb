import { type Infer, v } from "convex/values";

const noEvent = v.object({ kind: v.literal("none") });
const openEvent = v.object({ kind: v.literal("open") });
const publicEvent = v.object({
    kind: v.literal("public"),
    label: v.string(),
    lookupRequestId: v.id("agentOperationRequests"),
    referenceIndexes: v.array(v.number()),
});
const analystEvent = v.object({
    kind: v.literal("analyst"),
    excerpt: v.string(),
});

const publicReadEvent = v.object({
    kind: v.literal("public"),
    label: v.string(),
    readIds: v.array(v.id("agentOperationRequests")),
});
export const provisionalOpenEvent = v.object({
    kind: v.literal("open"),
    activityExcerpt: v.optional(v.string()),
    conditions: v.optional(
        v.array(
            v.object({
                questionId: v.string(),
                hypothesis: v.string(),
                basis: v.union(
                    analystEvent,
                    v.object({
                        kind: v.literal("public"),
                        readIds: v.array(v.id("agentOperationRequests")),
                    }),
                ),
            }),
        ),
    ),
});
export const legacyFramingEventBasisInput = v.union(
    noEvent,
    openEvent,
    analystEvent,
    publicEvent,
);
export const directedFramingEventBasisInput = v.union(
    noEvent,
    provisionalOpenEvent,
    analystEvent,
    publicReadEvent,
);

export const framingEventBasisInput = v.union(
    noEvent,
    provisionalOpenEvent,
    analystEvent,
    publicEvent,
    publicReadEvent,
);
export const framingEventBasis = v.union(
    noEvent,
    provisionalOpenEvent,
    analystEvent.extend({ messageId: v.id("agentMessageDeliveries") }),
    publicEvent,
    publicReadEvent,
);

export const framingQuestionValidator = v.object({
    id: v.string(),
    text: v.string(),
    rationale: v.string(),
    shortLabel: v.string(),
});
export const framingContentValidator = v.object({
    scope: v.string(),
    questions: v.array(framingQuestionValidator),
});

/** Structural program prerequisite shared by initial completion and analyst Start. */
export function hasFramingProgram(
    content: Infer<typeof framingContentValidator> | null | undefined,
): boolean {
    return Boolean(content?.scope.trim() && content.questions.length);
}
