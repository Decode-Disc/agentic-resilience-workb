import { v } from "convex/values";
import { framingContentValidator } from "./framingContracts";
import { coverageRoleValidator } from "./sourceDiscoveryRecovery";
import {
    responseReviewInput,
    responseReviewPin,
} from "./workbenchResponseControlContracts";

export const workbenchCommand = v.union(
    v.literal("/pause"),
    v.literal("/resume"),
);
export const workbenchCommandOutcome = v.union(
    v.literal("applied"),
    v.literal("unchanged"),
    v.literal("refused"),
);

const framingProgram =
    "(?:(?:the|our|my|this) )?(?:saved )?(?:research )?(?:program|framing|plan)";
const framingPreservationCommands = [
    new RegExp(
        `^(?:please )?(?:keep|leave) ${framingProgram} (?:unchanged|as is)$`,
        "u",
    ),
    new RegExp(
        `^(?:please )?(?:do not|don't|don’t) (?:change|modify|edit|update|rewrite|refine) ${framingProgram}$`,
        "u",
    ),
    /^ne (?:modifie|change) pas (?:le|notre|mon|ce) (?:programme(?: de recherche)?|cadrage)$/u,
    /^(?:garde|conserve|laisse) (?:le|notre|mon|ce) (?:programme(?: de recherche)?|cadrage) (?:inchangé|en l’état|en l'état)$/u,
];

/** Closed whole-program commands; quote marks and partial-field constraints are not commands. */
export function explicitFramingPreservation(text: string): boolean {
    return text.split(/(?<=[.!?])\s+|[\r\n]+/u).some((sentence) => {
        const command = sentence
            .normalize("NFC")
            .trim()
            .toLowerCase()
            .replace(/[.!?]+$/u, "")
            .replace(/\s+/gu, " ");
        return framingPreservationCommands.some((pattern) =>
            pattern.test(command),
        );
    });
}

/** The operation and its confirmation accept exactly the same explicit command grammar. */
export function explicitResearchControl(
    text: string,
): "pause" | "resume" | undefined {
    const command = explicitResearchCommand(text);
    return command === "start" ? undefined : command;
}

/** Recognizes control-only messages; Start remains an analyst-owned button action. */
export function explicitResearchCommand(
    text: string,
): "start" | "pause" | "resume" | undefined {
    const normalized = text
        .trim()
        .toLowerCase()
        .replace(/[.!]+$/g, "")
        .replace(/\s+/g, " ");
    if (
        /^(please )?(start|launch|begin) (the |my |this )?research( now)?$|^(démarre|lance|commence) la recherche( maintenant)?$/.test(
            normalized,
        )
    )
        return "start";
    if (
        /^(please )?(pause|suspend|stop) (the |my |this )?research$|^(mets la recherche en pause|suspends la recherche)$/.test(
            normalized,
        )
    )
        return "pause";
    if (
        /^(please )?(resume|continue) (the |my |this )?research$|^(reprends la recherche|reprendre la recherche)$/.test(
            normalized,
        )
    )
        return "resume";
    return undefined;
}

export const adjustFramingInput = v.object({
    expectedRevision: v.number(),
    content: framingContentValidator,
});
export const nativeAdjustFramingInput = adjustFramingInput.extend({
    messageId: v.id("agentMessageDeliveries"),
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
export const nativeSourceRequestInput = sourceRequestInput
    .omit("coverageRole")
    .extend({
        coverageRole: v.union(coverageRoleValidator, v.null()),
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
            kind: v.literal("check_response_coherence"),
            ...responseReviewInput.fields,
        }),
        v.object({
            kind: v.literal("adjust_framing"),
            ...adjustFramingInput.fields,
            messageId: v.optional(v.id("agentMessageDeliveries")),
        }),
        v.object({
            kind: v.literal("control_research"),
            ...controlResearchInput.fields,
        }),
        v.object({
            kind: v.literal("transmit_source_request"),
            ...sourceRequestInput.fields,
            coverageRole: v.optional(
                nativeSourceRequestInput.fields.coverageRole,
            ),
        }),
    ),
    pin: v.union(
        responseReviewPin,
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

/** Transmission is a persisted receipt; later treatment is projected separately. */
export const workbenchInstructionTransmissionStatus = v.union(
    v.literal("waiting"),
    v.literal("transmitted"),
    v.literal("limited"),
    v.literal("blocked"),
);
