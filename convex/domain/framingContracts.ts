import { type Infer, v } from "convex/values";

export const framingCitationPolicy = v.object({
    revision: v.number(),
    requireContextRead: v.boolean(),
});
export const DEFAULT_FRAMING_CITATION_POLICY = {
    revision: 0,
    requireContextRead: false,
} as const;

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
export const adoptedDocumentaryBasis = v.object({
    kind: v.literal("public"),
    references: v.array(v.string()),
});
const documentaryPublicEvent = adoptedDocumentaryBasis.extend({
    label: v.string(),
});
const openFramingActivity = openEvent.extend({
    activityExcerpt: v.optional(v.string()),
});
export const provisionalOpenEvent = openFramingActivity.extend({
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
const documentaryOpenEvent = openFramingActivity.extend({
    conditions: v.optional(
        v.array(
            v.object({
                questionId: v.string(),
                hypothesis: v.string(),
                basis: v.union(analystEvent, adoptedDocumentaryBasis),
            }),
        ),
    ),
});
export const supportedProvisionalOpenEvent = v.union(
    provisionalOpenEvent,
    documentaryOpenEvent,
);
export const documentaryFramingEventBasisInput = v.union(
    noEvent,
    documentaryOpenEvent,
    analystEvent,
    documentaryPublicEvent,
);
export const initialDocumentaryFramingEventBasisInput = v.union(
    noEvent,
    documentaryOpenEvent.extend({ activityExcerpt: v.string() }),
    analystEvent,
    documentaryPublicEvent,
);
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

/** Initial writes cannot inherit an activity anchor from an empty scope. */
export const initialDirectedFramingEventBasisInput = v.union(
    noEvent,
    provisionalOpenEvent.extend({ activityExcerpt: v.string() }),
    analystEvent,
    publicReadEvent,
);

export const framingEventBasisInput = v.union(
    noEvent,
    supportedProvisionalOpenEvent,
    analystEvent,
    publicEvent,
    publicReadEvent,
    documentaryPublicEvent,
);
export const framingEventBasis = v.union(
    noEvent,
    supportedProvisionalOpenEvent,
    analystEvent.extend({ messageId: v.id("agentMessageDeliveries") }),
    publicEvent,
    publicReadEvent,
    documentaryPublicEvent,
);

const savedCitationReference = v.union(
    v.string(),
    v.object({
        lookupRequestId: v.id("agentOperationRequests"),
        index: v.number(),
    }),
);

export const framingRevisionResult = v.object({
    revision: v.number(),
});

export const framingWriteReceipt = framingRevisionResult.extend({
    eventBasis: v.union(
        v.literal("open"),
        v.literal("public"),
        v.literal("analyst"),
        v.literal("none"),
        v.literal("unspecified"),
    ),
    publicCitations: v.object({
        event: v.array(savedCitationReference),
        conditions: v.array(
            v.object({
                questionId: v.string(),
                references: v.array(savedCitationReference),
            }),
        ),
    }),
});

export const FRAMING_RECEIPT_OPERATION_VERSION = 3;
export const WORKBENCH_FRAMING_RECEIPT_VERSION = 11;
export const WORKBENCH_FRAMING_METHOD_VERSION = 12;

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

/** Shared initial-write distinction for model projection and business validation. */
export function framingWriteState(
    content:
        | Pick<Infer<typeof framingContentValidator>, "scope">
        | null
        | undefined,
): "initial" | "established" {
    return content?.scope.trim() ? "established" : "initial";
}
