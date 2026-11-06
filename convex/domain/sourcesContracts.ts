import { commonOperationSuccessValidator } from "@convex/execution/operationContracts";
import { operationResultValidator } from "@convex/execution/operationResults";
import { type Infer, v } from "convex/values";
import { sourceMaterialReferenceValidator } from "./sourceRetrievalPolicy";

export const observedDestinationValidator = v.object({
    url: v.string(),
    originText: v.string(),
    startOffset: v.number(),
    representationHash: v.string(),
});

export const SOURCES_PROTOCOL = "sources_mission_v1";
export const SOURCES_MAX_EVIDENCE_REFERENCES = 8;
export const sourcesEnvelopeValidator = v.object({
    version: v.literal(1),
    maxNeeds: v.number(),
    initialSearches: v.number(),
    complementSearches: v.number(),
    acquisitions: v.number(),
    controls: v.number(),
});
export const documentaryNeedValidator = v.object({
    id: v.string(),
    version: v.number(),
    information: v.string(),
    questionIds: v.array(v.string()),
    commonContext: v.boolean(),
});
export const documentaryQuoteValidator = v.object({
    captureId: sourceMaterialReferenceValidator.fields.captureId,
    passageOrder: v.number(),
    quotation: v.string(),
});
export const documentaryEvidenceSelectionValidator = v.object({
    readRequestId: v.id("agentOperationRequests"),
    passageOrder: v.number(),
});
export const documentaryContributionValidator = v.object({
    id: v.string(),
    version: v.number(),
    needIds: v.array(v.string()),
    statement: v.string(),
    period: v.string(),
    modality: v.string(),
    attribution: v.string(),
    kind: v.union(
        v.literal("asserted_fact"),
        v.literal("attributed_argument"),
        v.literal("forecast"),
        v.literal("context"),
    ),
    evidence: v.array(documentaryQuoteValidator),
});
export const documentaryFindingValidator = v.object({
    contributionId: v.string(),
    conclusion: v.union(
        v.literal("supported"),
        v.literal("documentary_conflict"),
        v.literal("not_established"),
    ),
    permittedUse: v.union(
        v.literal("documentary"),
        v.literal("attributed_argument_only"),
        v.literal("context_only"),
        v.literal("blocked"),
    ),
    diagnostic: v.string(),
});
export const documentaryControlValidator = v.object({
    findings: v.array(documentaryFindingValidator),
    coherence: v.boolean(),
    limitations: v.array(v.string()),
});
export const documentaryQualificationOutput = v.object({
    kind: v.literal("documentary_qualification"),
    preparationId: v.id("sourceSelectionProposalRebuilds"),
    captureId: sourceMaterialReferenceValidator.fields.captureId,
    contentHash: v.string(),
    version: v.number(),
    previousTaskId: v.optional(v.id("aiTaskResults")),
    contributions: v.array(documentaryContributionValidator),
    controlTaskId: v.id("aiTaskResults"),
});
export const documentaryControlOutput = v.object({
    kind: v.literal("documentary_control"),
    preparationId: v.id("sourceSelectionProposalRebuilds"),
    evidence: v.array(documentaryQuoteValidator),
    inputHash: v.string(),
    control: documentaryControlValidator,
});
export const needOutcomeValidator = v.object({
    needId: v.string(),
    gap: v.optional(v.string()),
    unfinished: v.array(v.string()),
    workRequestIds: v.array(v.id("agentOperationRequests")),
});
export const preparedDocumentValidator = v.object({
    sourceId: sourceMaterialReferenceValidator.fields.sourceId,
    captureId: sourceMaterialReferenceValidator.fields.captureId,
    contentHash: v.string(),
    qualificationTaskId: v.id("aiTaskResults"),
    qualificationVersion: v.number(),
    contributions: v.array(v.object({ id: v.string(), version: v.number() })),
});
export const preparedContributionReferenceValidator = v.object({
    qualificationTaskId: v.id("aiTaskResults"),
    contributionId: v.string(),
    version: v.number(),
    sourceId: v.optional(sourceMaterialReferenceValidator.fields.sourceId),
    captureId: v.optional(sourceMaterialReferenceValidator.fields.captureId),
    contentHash: v.optional(v.string()),
});
export const preparedNeedOutcomeValidator = v.object({
    ...needOutcomeValidator.fields,
    contributions: v.array(preparedContributionReferenceValidator),
});
export const preparedMaterialValidator = v.object({
    version: v.literal(1),
    needsRevision: v.number(),
    outcome: v.union(
        v.literal("complete"),
        v.literal("partial"),
        v.literal("blocked"),
    ),
    documents: v.array(preparedDocumentValidator),
    needs: v.array(preparedNeedOutcomeValidator),
    retentionAuthority: v.literal("system_mandate"),
    policyVersion: v.literal(SOURCES_PROTOCOL),
});
export const restrictedContributionValidator = v.object({
    qualificationTaskId: v.id("aiTaskResults"),
    contributionId: v.string(),
    version: v.number(),
    controlTaskId: v.id("aiTaskResults"),
    permittedUse: v.optional(documentaryFindingValidator.fields.permittedUse),
});
/** Reading exposes bounded status and exact references; full snapshots stay with their owners. */
export const documentaryStatusValidator = v.object({
    capture: v.object({
        _id: sourceMaterialReferenceValidator.fields.captureId,
        contentHash: v.string(),
        readingCompleteness: v.optional(
            v.union(v.literal("complete"), v.literal("partial")),
        ),
        representationCompleteness: v.optional(
            v.union(v.literal("complete"), v.literal("partial")),
        ),
        /** Absent on retained results; absence and null both mean unknown. */
        captureOmittedPassageCount: v.optional(v.union(v.number(), v.null())),
        observedDestinationCount: v.number(),
    }),
    observedDestinations: v.array(
        v.object({
            index: v.number(),
            urlPreview: v.string(),
            originPreview: v.string(),
        }),
    ),
    qualification: v.union(
        v.null(),
        v.object({
            taskId: v.id("aiTaskResults"),
            version: v.number(),
            controlTaskId: v.id("aiTaskResults"),
            coherence: v.boolean(),
            limitationsCount: v.number(),
            contributions: v.array(
                v.object({
                    id: v.string(),
                    version: v.number(),
                    permittedUse:
                        documentaryFindingValidator.fields.permittedUse,
                    diagnosticPreview: v.string(),
                    diagnosticComplete: v.boolean(),
                    restrictionCount: v.number(),
                }),
            ),
        }),
    ),
});
export const sourcesPreparationValidator = v.object({
    restrictedContributions: v.array(restrictedContributionValidator),
    protocol: v.literal(SOURCES_PROTOCOL),
    phase: v.union(v.literal("initial"), v.literal("investigation_complement")),
    needsRevision: v.number(),
    needs: v.array(documentaryNeedValidator),
    envelope: sourcesEnvelopeValidator,
    searches: v.number(),
    acquisitions: v.number(),
    controls: v.number(),
    captureIds: v.array(sourceMaterialReferenceValidator.fields.captureId),
    qualifications: v.array(v.id("aiTaskResults")),
    work: v.array(
        v.object({
            requestId: v.id("agentOperationRequests"),
            sourceId: v.optional(
                sourceMaterialReferenceValidator.fields.sourceId,
            ),
            kind: v.string(),
            needIds: v.array(v.string()),
        }),
    ),
    result: v.optional(preparedMaterialValidator),
});
const needInput = { needId: v.string() };
export const discoverSourcesInput = v.object({
    ...needInput,
    query: v.string(),
});
export const consultableSourceInput = v.object({
    ...needInput,
    sourceId: v.optional(sourceMaterialReferenceValidator.fields.sourceId),
    observedCaptureId: v.optional(
        sourceMaterialReferenceValidator.fields.captureId,
    ),
    observedLinkIndex: v.optional(v.number()),
});
export const materializedQualificationInput = v.object({
    sourceId: sourceMaterialReferenceValidator.fields.sourceId,
    captureId: sourceMaterialReferenceValidator.fields.captureId,
    expectedTaskId: v.union(v.id("aiTaskResults"), v.null()),
    changes: v.array(
        v.object({
            contributionId: v.optional(v.string()),
            expectedVersion: v.optional(v.number()),
            contribution: v.object({
                needIds: v.array(v.string()),
                statement: v.string(),
                period: v.string(),
                modality: v.string(),
                attribution: v.string(),
                kind: documentaryContributionValidator.fields.kind,
                evidence: v.array(documentaryQuoteValidator),
            }),
        }),
    ),
});
export const qualificationSubmissionInput = v.object({
    ...materializedQualificationInput.fields,
    changes: v.array(
        v.object({
            ...materializedQualificationInput.fields.changes.element.fields,
            contribution: v.object({
                ...materializedQualificationInput.fields.changes.element.fields
                    .contribution.fields,
                evidence: v.array(documentaryEvidenceSelectionValidator),
            }),
        }),
    ),
});
const materializedDocumentaryCheckInput = v.object({
    ...needInput,
    sourceId: sourceMaterialReferenceValidator.fields.sourceId,
    proposition: v.string(),
    evidence: v.array(documentaryQuoteValidator),
    targets: v.optional(
        v.array(
            v.object({
                qualificationTaskId: v.id("aiTaskResults"),
                contributionId: v.string(),
                version: v.number(),
            }),
        ),
    ),
});
export const documentaryCheckInput = v.object({
    ...materializedDocumentaryCheckInput.fields,
    evidence: v.array(documentaryEvidenceSelectionValidator),
});
export const sourcesOperationValidator = v.union(
    v.object({
        kind: v.literal("discover_sources_for_need"),
        ...discoverSourcesInput.fields,
    }),
    v.object({
        kind: v.literal("make_source_consultable"),
        ...consultableSourceInput.fields,
    }),
    v.object({
        kind: v.literal("submit_documentary_qualification"),
        ...qualificationSubmissionInput.fields,
    }),
    v.object({
        kind: v.literal("request_documentary_check"),
        ...documentaryCheckInput.fields,
    }),
);
export const sourcesScopeValidator = v.object({
    kind: v.literal("sources_v1"),
    preparationId: v.id("sourceSelectionProposalRebuilds"),
});
export const sourcesStateValidator = v.object({
    kind: v.literal("sources_v1"),
});
export const sourcesCompletionValidator = v.object({
    kind: v.literal("complete"),
    needsRevision: v.number(),
    needs: v.array(needOutcomeValidator),
    workingNotes: v.optional(v.string()),
});
export const sourcesCompletionProposalValidator = v.object({
    kind: v.literal("complete"),
    needs: v.array(
        v.object({
            needId: needOutcomeValidator.fields.needId,
            gap: needOutcomeValidator.fields.gap,
            unfinished: needOutcomeValidator.fields.unfinished,
            readRequestIds: v.optional(v.array(v.id("agentOperationRequests"))),
        }),
    ),
    workingNotes: v.optional(v.string()),
});
export const sourcesResultValidator = v.object({
    kind: v.literal("sources_v1"),
    preparationId: v.id("sourceSelectionProposalRebuilds"),
    material: preparedMaterialValidator,
});
export const sourcesSchemas = {
    id: v.literal("sources_v1"),
    scope: sourcesScopeValidator,
    state: sourcesStateValidator,
    completion: v.union(
        sourcesCompletionProposalValidator,
        sourcesCompletionValidator,
    ),
    result: sourcesResultValidator,
    // Historical requests retain their original bytes; current operation bindings admit selections only.
    operation: v.union(
        ...sourcesOperationValidator.members,
        v.object({
            kind: v.literal("submit_documentary_qualification"),
            ...materializedQualificationInput.fields,
        }),
        v.object({
            kind: v.literal("request_documentary_check"),
            ...materializedDocumentaryCheckInput.fields,
        }),
    ),
    pin: v.object({
        kind: v.literal("sources_v1"),
        preparationId: v.id("sourceSelectionProposalRebuilds"),
        needsRevision: v.number(),
    }),
    success: commonOperationSuccessValidator,
};
export type SourcesOperation = Infer<typeof sourcesOperationValidator>;
export type SourcesPreparation = Infer<typeof sourcesPreparationValidator>;
export type DocumentaryContribution = Infer<
    typeof documentaryContributionValidator
>;

export const consultableSourceResult = operationResultValidator(
    v.union(
        v.object({
            ...sourceMaterialReferenceValidator.fields,
            status: v.union(v.literal("complete"), v.literal("partial")),
        }),
        v.object({
            sourceId: sourceMaterialReferenceValidator.fields.sourceId,
            captureId: v.optional(
                sourceMaterialReferenceValidator.fields.captureId,
            ),
            status: v.literal("unavailable"),
            reasonCode: v.string(),
        }),
    ),
);
export const discoveryResult = operationResultValidator(
    v.object({
        needId: v.string(),
        query: v.string(),
        inserted: v.number(),
        total: v.number(),
    }),
);
export const documentarySubmissionResult = operationResultValidator(
    v.object({
        taskId: v.id("aiTaskResults"),
        control: documentaryControlValidator,
    }),
);
