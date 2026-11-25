import type { Doc, Id } from "@convex/_generated/dataModel";
import { documentDatesValidator } from "@convex/domain/documentDates";
import { approvalActionValidator } from "@convex/execution/approvalContracts";
import { operationResultValidator } from "@convex/execution/operationResults";
import { type Infer, v } from "convex/values";
import { validate } from "convex-helpers/validators";
import {
    directedFramingEventBasisInput,
    documentaryFramingEventBasisInput,
    framingContentValidator,
    framingEventBasisInput,
    initialDirectedFramingEventBasisInput,
    initialDocumentaryFramingEventBasisInput,
    legacyFramingEventBasisInput,
    WORKBENCH_FRAMING_METHOD_VERSION,
    WORKBENCH_FRAMING_RECEIPT_VERSION,
} from "./framingContracts";
import { savedMaterialBinding } from "./savedMaterialOperations";
import { coverageRoleValidator } from "./sourceDiscoveryRecovery";
import { discoveryFocus } from "./sourcesContracts";
import {
    responseReviewInput,
    responseReviewPin,
} from "./workbenchResponseControlContracts";

export const workbenchOperationAdmission = v.object({
    toolAvailability: v.union(
        v.null(),
        v.object({
            single: v.boolean(),
            framing: v.union(
                v.literal(false),
                v.literal("initial"),
                v.literal("established"),
            ),
            approvals: v.boolean(),
            sourceRequest: v.union(
                v.literal("legacy"),
                v.literal("modern"),
                v.null(),
            ),
            savedMaterial: v.boolean(),
            preparedNeeds: v.boolean(),
        }),
    ),
    messageIds: v.array(v.string()),
    settledNeedIds: v.array(v.string()),
    framingRevision: v.optional(v.number()),
});
export type WorkbenchOperationAdmission = Infer<
    typeof workbenchOperationAdmission
>;

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
    eventBasis: v.optional(framingEventBasisInput),
});
export const nativeAdjustFramingInput = adjustFramingInput.extend({
    messageId: v.id("agentMessageDeliveries"),
});
export const legacyNativeAdjustFramingInput = nativeAdjustFramingInput.extend({
    eventBasis: v.optional(legacyFramingEventBasisInput),
});
export const directedNativeAdjustFramingInput = nativeAdjustFramingInput.extend(
    { eventBasis: v.optional(directedFramingEventBasisInput) },
);
export const initialNativeAdjustFramingInput = nativeAdjustFramingInput.extend({
    eventBasis: initialDirectedFramingEventBasisInput,
});
export const documentaryNativeAdjustFramingInput =
    nativeAdjustFramingInput.extend({
        eventBasis: v.optional(documentaryFramingEventBasisInput),
    });
export const initialDocumentaryNativeAdjustFramingInput =
    nativeAdjustFramingInput.extend({
        eventBasis: initialDocumentaryFramingEventBasisInput,
    });

export const controlResearchInput = v.object({
    action: v.union(v.literal("pause"), v.literal("resume")),
    messageId: v.id("agentMessageDeliveries"),
});
export const requestApprovalInput = v.object({
    action: approvalActionValidator,
    messageId: v.id("agentMessageDeliveries"),
});
export const requestApprovalResultValidator = v.union(
    v.object({
        status: v.literal("applied"),
        action: approvalActionValidator,
        requestId: v.id("approvalRequests"),
    }),
    v.object({
        status: v.literal("pending"),
        requestId: v.id("approvalRequests"),
    }),
    v.object({
        status: v.literal("unavailable"),
        reason: v.string(),
    }),
);

/** The adopted result of a `request_approval` operation; owned beside its validator so no caller parses operation JSON itself. */
export function requestApprovalResult(
    request: Doc<"agentOperationRequests">,
): Infer<typeof requestApprovalResultValidator> | undefined {
    if (
        request.input.kind !== "request_approval" ||
        request.outcome?.kind !== "success" ||
        request.adoptionRefusalCode
    )
        return undefined;
    let parsed: unknown;
    try {
        parsed = JSON.parse(request.outcome.valueJson);
    } catch {
        return undefined;
    }
    return validate(requestApprovalResultValidator, parsed)
        ? parsed
        : undefined;
}

export function approvalRequestIdFromOperation(
    request: Doc<"agentOperationRequests">,
): Id<"approvalRequests"> | undefined {
    const result = requestApprovalResult(request);
    return result && result.status !== "unavailable"
        ? result.requestId
        : undefined;
}

export const documentaryRequestTarget = v.union(
    v.object({ kind: v.literal("existing_need"), needId: v.string() }),
    v.object({
        kind: v.literal("new_need"),
        questionId: v.optional(v.string()),
    }),
);
export const sourceRequestInput = v.object({
    messageId: v.id("agentMessageDeliveries"),
    interpretedNeed: v.string(),
    target: v.optional(documentaryRequestTarget),
    coverageRole: v.optional(coverageRoleValidator),
});
export const nativeSourceRequestInput = sourceRequestInput
    .omit("coverageRole", "target")
    .extend({
        coverageRole: v.union(coverageRoleValidator, v.null()),
    });
export const modernSourceRequestInput = sourceRequestInput
    .omit("coverageRole")
    .extend({
        target: documentaryRequestTarget,
    });
export const consultPreparedMaterialInput = v.object({ needId: v.string() });
export const publicContextAllowanceValidator = v.object({
    searches: v.number(),
    readings: v.number(),
});
export const publicContextInput = v.object({
    messageId: v.id("agentMessageDeliveries"),
    query: v.string(),
});
export const publicSearchInput = publicContextInput.extend({
    focus: v.optional(discoveryFocus),
});
export const publicReadInput = v.object({
    continuation: v.optional(v.id("agentOperationRequests")),
    messageId: v.id("agentMessageDeliveries"),
    target: v.union(
        v.object({
            kind: v.literal("candidate"),
            searchId: v.id("agentOperationRequests"),
            index: v.number(),
        }),
        v.object({ kind: v.literal("supplied"), url: v.string() }),
    ),
});
export const publicReadResultValidator = v.object({
    replayCorpusHash: v.optional(v.string()),
    document: v.optional(
        v.object({
            readId: v.id("agentOperationRequests"),
            contentHash: v.string(),
            characters: v.number(),
            acquisitionCompleteness: v.union(
                v.literal("complete"),
                v.literal("partial"),
                v.literal("unknown"),
            ),
        }),
    ),
    range: v.optional(v.object({ start: v.number(), end: v.number() })),
    continuation: v.optional(v.id("agentOperationRequests")),
    readId: v.id("agentOperationRequests"),
    status: v.union(v.literal("observed"), v.literal("inconclusive")),
    reference: v.optional(
        v.object({
            url: v.string(),
            publisher: v.string(),
            excerpt: v.string(),
            publishedAt: v.optional(v.string()),
            eventAt: v.optional(v.string()),
            dates: v.optional(documentDatesValidator),
        }),
    ),
});
const publicSearchCandidate = v.object({
    url: v.string(),
    title: v.string(),
    publisher: v.string(),
    publishedAt: v.optional(v.string()),
});
export const publicSearchResultValidator = v.object({
    replayCorpusHash: v.optional(v.string()),
    searchId: v.id("agentOperationRequests"),
    candidates: v.array(publicSearchCandidate),
});
export const referencedPublicSearchResultValidator =
    publicSearchResultValidator.extend({
        candidates: v.array(
            publicSearchCandidate.extend({ reference: v.string() }),
        ),
    });
export const publicSearchOutcomeValidator = v.union(
    referencedPublicSearchResultValidator,
    publicSearchResultValidator,
);
const legacyPublicSearchResult = operationResultValidator(
    publicSearchResultValidator,
);
const referencedPublicSearchResult = operationResultValidator(
    referencedPublicSearchResultValidator,
);

export function publicSearchWireResult(version: number) {
    return savedMaterialBinding("workbench_v1", version) === "referenced"
        ? referencedPublicSearchResult
        : legacyPublicSearchResult;
}
export const publicContextResultValidator = v.object({
    status: v.union(v.literal("observed"), v.literal("inconclusive")),
    references: v.array(
        v.object({
            url: v.string(),
            publisher: v.string(),
            excerpt: v.string(),
            publishedAt: v.optional(v.number()),
            eventAt: v.optional(v.number()),
            dates: v.optional(documentDatesValidator),
        }),
    ),
});
/** Retained documentary authority survives agent draft saves, but not a new instruction. */
export function framingObservationRefusal(
    observation: Doc<"agentOperationRequests"> | null,
    authority: Pick<
        Doc<"agentOperationRequests">,
        "runId" | "missionId" | "instructionVersion"
    > & { messageId: Id<"agentMessageDeliveries"> | undefined },
): "source_reference_not_observed" | "framing_observation_stale" | undefined {
    if (
        !authority.messageId ||
        !observation ||
        observation.runId !== authority.runId ||
        observation.missionId !== authority.missionId ||
        (observation.pin?.kind !== "framing_revision" &&
            !(
                observation.pin?.kind === "documentary_v1" &&
                observation.pin.scope.kind === "framing"
            )) ||
        observation.status !== "completed" ||
        observation.adoptedAt === undefined ||
        observation.adoptionRefusalCode ||
        observation.outcome?.kind !== "success"
    )
        return "source_reference_not_observed";
    const cause =
        observation.pin.kind === "documentary_v1" &&
        observation.pin.scope.kind === "framing"
            ? observation.pin.scope.cause
            : {
                  messageId:
                      "messageId" in observation.input
                          ? observation.input.messageId
                          : undefined,
                  instructionVersion: observation.instructionVersion,
              };
    if (!cause.messageId) return "source_reference_not_observed";
    if (
        cause.messageId !== authority.messageId ||
        cause.instructionVersion !== authority.instructionVersion ||
        observation.instructionVersion !== authority.instructionVersion
    )
        return "framing_observation_stale";
    return undefined;
}

/** Only an adopted reading can be used as provenance. */
export function observedPublicContext(
    request: Doc<"agentOperationRequests"> | null,
) {
    if (
        request?.input.kind !== "verify_public_context" ||
        request.status !== "completed" ||
        request.adoptedAt === undefined ||
        request.adoptionRefusalCode ||
        request.outcome?.kind !== "success"
    )
        return undefined;
    const result: unknown = JSON.parse(request.outcome.valueJson);
    return validate(publicContextResultValidator, result) ? result : undefined;
}

export function adoptedPublicRead(
    request: Doc<"agentOperationRequests"> | null,
) {
    if (
        request?.input.kind !== "read_public_context" ||
        request.status !== "completed" ||
        request.adoptedAt === undefined ||
        request.adoptionRefusalCode ||
        request.outcome?.kind !== "success"
    )
        return undefined;
    const value: unknown = JSON.parse(request.outcome.valueJson);
    return validate(publicReadResultValidator, value) &&
        value.readId === request._id
        ? value
        : undefined;
}

/** Only an adopted, nonblank reading can support a public framing association. */
export function observedPublicRead(
    request: Doc<"agentOperationRequests"> | null,
) {
    const value = adoptedPublicRead(request);
    return value?.status === "observed" && value.reference?.excerpt.trim()
        ? value
        : undefined;
}

export const retainedPublicReadPage = v.object({
    readId: v.id("agentOperationRequests"),
    contentHash: v.string(),
    characters: v.number(),
    start: v.number(),
    end: v.number(),
    excerpt: v.string(),
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
            kind: v.literal("read_public_context"),
            ...publicReadInput.fields,
        }),
        v.object({
            kind: v.literal("search_public_context"),
            ...publicSearchInput.fields,
        }),
        v.object({
            kind: v.literal("verify_public_context"),
            ...publicContextInput.fields,
        }),
        v.object({
            kind: v.literal("consult_prepared_material"),
            ...consultPreparedMaterialInput.fields,
        }),
        v.object({
            kind: v.literal("check_response_coherence"),
            ...responseReviewInput.fields,
        }),
        v.object({
            kind: v.literal("adjust_framing"),
            ...adjustFramingInput.fields,
            eventBasisRequired: v.optional(v.literal(true)),
            messageId: v.optional(v.id("agentMessageDeliveries")),
        }),
        v.object({
            kind: v.literal("control_research"),
            ...controlResearchInput.fields,
        }),
        v.object({
            kind: v.literal("request_approval"),
            ...requestApprovalInput.fields,
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
        v.object({
            kind: v.literal("prepared_material"),
            preparationId: v.id("sourceSelectionProposalRebuilds"),
            hash: v.string(),
        }),
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

export const INITIAL_FRAMING_MESSAGE_KEY = "framing-intention";

/** Versions with separate public search/read and provisional framing provenance. */
export function supportsDirectedFraming(version: number): boolean {
    return (
        version === 5 ||
        version === 6 ||
        version === 7 ||
        version === 8 ||
        version === 9 ||
        savedMaterialBinding("workbench_v1", version) === "referenced"
    );
}

/** Versions explicitly preserving the corrected framing completion and discovery contract. */
export function supportsFramingContractCorrections(version: number): boolean {
    return (
        version === 6 ||
        version === 7 ||
        version === 8 ||
        version === 9 ||
        savedMaterialBinding("workbench_v1", version) === "referenced"
    );
}

/** State-specific model schemas are introduced without changing pinned historical declarations. */
export function supportsStatefulFramingSchema(version: number): boolean {
    return (
        version === 9 ||
        savedMaterialBinding("workbench_v1", version) === "referenced"
    );
}

export function supportsFramingWriteReceipt(
    version: number | undefined,
): boolean {
    return (
        version === WORKBENCH_FRAMING_RECEIPT_VERSION ||
        version === WORKBENCH_FRAMING_METHOD_VERSION
    );
}
