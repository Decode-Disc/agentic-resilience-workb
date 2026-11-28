import { defineTable, docValidator } from "convex/server";
import { v } from "convex/values";
export const nativeInputBodyValidator = v.union(
    v.object({ messageId: v.id("agentMessageDeliveries"), text: v.string() }),
    v.object({
        messageId: v.id("agentMessageDeliveries"),
        contentHash: v.string(),
    }),
);

export const nativeInputsValidator = v.array(
    v.object({
        requestId: v.string(),
        nativeInputSequence: v.number(),
        instructionVersion: v.number(),
        messages: v.array(nativeInputBodyValidator),
    }),
);

export const piCommitsTable = defineTable({
    sessionId: v.id("piSessions"),
    sequence: v.number(),
    key: v.string(),
    payload: v.optional(v.string()),
    textId: v.optional(v.id("retainedTexts")),
})
    .index("by_session_and_sequence", ["sessionId", "sequence"])
    .index("by_session_and_key", ["sessionId", "key"]);
export const piCommitDocument = docValidator("piCommits", piCommitsTable);
export const nativeContextObservationValidator = v.optional(
    v.object({
        version: v.literal(1),
        key: v.string(),
        topic: v.union(
            v.literal("framing"),
            v.literal("research"),
            v.literal("documentary"),
            v.literal("analyst_request"),
            v.literal("analyst_decision"),
        ),
        textId: v.id("retainedTexts"),
    }),
);
export const executionEventActorValidator = v.optional(
    v.union(
        v.object({ type: v.literal("system") }),
        v.object({
            type: v.literal("agent"),
            missionId: v.id("agentMissions"),
        }),
        v.object({
            type: v.literal("visitor"),
            visitorId: v.id("visitors"),
        }),
    ),
);
