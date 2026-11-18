import { v } from "convex/values";

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

export const framingEventBasisInput = v.union(
    noEvent,
    openEvent,
    analystEvent,
    publicEvent,
);
export const framingEventBasis = v.union(
    noEvent,
    openEvent,
    analystEvent.extend({ messageId: v.id("agentMessageDeliveries") }),
    publicEvent,
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
