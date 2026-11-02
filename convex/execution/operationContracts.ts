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
        throughTurnCreationTime: v.number(),
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
    next: v.union(historyPositionValidator, v.null()),
});

export type HistoryReadReceipt = Infer<typeof historyReadReceiptValidator>;

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

const COMMON_CONSULTATIONS: ReadonlySet<string> = new Set([
    "consult_conversation",
    "consult_mission_state",
    "consult_run_state",
]);

/** Consultation audit entries cannot manufacture new retained source material. */
export function isCommonConsultation(kind: string): boolean {
    return COMMON_CONSULTATIONS.has(kind);
}
