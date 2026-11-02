import { type Infer, v } from "convex/values";

/** Shared observations cannot depend on a particular agent's business result schema. */
export const commonOperationSuccessValidator = v.object({
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
        afterMessageId: v.union(v.id("agentMessageDeliveries"), v.null()),
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
    next: v.union(historyPositionValidator, v.null()),
});

export type HistoryReadReceipt = Infer<typeof historyReadReceiptValidator>;

export const historyReadPinValidator = v.object({
    kind: v.literal("history_read"),
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

export const dispatchFailureValidator = v.object({
    category: v.union(
        v.literal("authority"),
        v.literal("incident"),
        v.literal("uncertain_effect"),
    ),
    code: v.string(),
});

/** Bounded immutable journal content; absent historical detail is never reconstructed. */
export const retainedPayloadValidator = v.object({
    version: v.literal(1),
    state: v.union(v.literal("complete"), v.literal("incomplete")),
    json: v.optional(v.string()),
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
