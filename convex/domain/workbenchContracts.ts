import { v } from "convex/values";
import { framingContentValidator } from "./framingContracts";
import { coverageRoleValidator } from "./sourceDiscoveryRecovery";

export const adjustFramingInput = v.object({
    expectedRevision: v.number(),
    content: framingContentValidator,
});
export const controlResearchInput = v.object({
    action: v.union(v.literal("pause"), v.literal("resume")),
    messageId: v.id("agentMessageDeliveries"),
});
export const sourceRequestInput = v.object({
    messageId: v.id("agentMessageDeliveries"),
    interpretedNeed: v.string(),
    coverageRole: v.optional(coverageRoleValidator),
});
export const workbenchSchemas = {
    id: v.literal("workbench_v1"),
    scope: v.object({ kind: v.literal("workbench_v1") }),
    state: v.object({ kind: v.literal("workbench_v1") }),
    result: v.object({ kind: v.literal("workbench_v1"), text: v.string() }),
    completion: v.object({
        kind: v.literal("complete"),
        text: v.string(),
        workingNotes: v.optional(v.string()),
    }),
    operation: v.union(
        v.object({
            kind: v.literal("adjust_framing"),
            ...adjustFramingInput.fields,
        }),
        v.object({
            kind: v.literal("control_research"),
            ...controlResearchInput.fields,
        }),
        v.object({
            kind: v.literal("transmit_source_request"),
            ...sourceRequestInput.fields,
        }),
    ),
    pin: v.union(
        v.object({
            kind: v.literal("framing_revision"),
            revisionId: v.id("framingRevisions"),
        }),
        v.object({
            kind: v.literal("workbench_instruction"),
            generation: v.number(),
            controlRevision: v.optional(v.number()),
            framingId: v.id("framingRevisions"),
        }),
    ),
    success: v.object({ kind: v.literal("success"), valueJson: v.string() }),
};
