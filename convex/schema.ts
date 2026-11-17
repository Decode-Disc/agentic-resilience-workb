import { framingContentValidator } from "@convex/domain/framingContracts";
import { coverageRoleValidator } from "@convex/domain/sourceDiscoveryRecovery";
import {
    retrievalMetadataValidator,
    SOURCE_RETRIEVAL_RANKING_POLICY,
} from "@convex/domain/sourceRetrievalPolicy";
import {
    documentaryControlOutput,
    documentaryQualificationOutput,
    observedDestinationValidator,
    sourcesEnvelopeValidator,
    sourcesPreparationValidator,
} from "@convex/domain/sourcesContracts";
import { responseControlPolicy } from "@convex/domain/workbenchResponseControlContracts";
import { authTables } from "@convex-dev/auth/server";
import { vWorkflowId } from "@convex-dev/workflow";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { zodToConvex } from "convex-helpers/server/zod4";
import {
    aiTaskExecutionModeValidator,
    claimClassificationValidator,
    claimDimensionLinkOriginValidator,
    evidenceRelationValidator,
} from "./domain/claims";
import { assessmentDimensionKeyValidator } from "./domain/researchPlan";
import { runPurposeValidator } from "./domain/runPurpose";
import { showcaseClaimOutputValidator } from "./domain/showcaseManifest";
import {
    sourceComparisonOutcomesSchema,
    sourceComparisonOutputSchema,
} from "./domain/sourceComparison";
import {
    recoveryReasonValidator,
    recoveryTargetValidator,
} from "./domain/sourceDiscoveryRecovery";
import { sourceLocatorValidator } from "./domain/sourcePassages";
import {
    preparationBudgetValidator,
    preparationDispatchOutcomeValidator,
    preparationModelLimitsValidator,
    sourcePreparationExecutionPlanValidator,
    sourcePreparationOutcomeValidator,
    sourcePreparationProgressValidator,
    sourcePreparationStopCodeValidator,
} from "./domain/sourcePreparationAuthority";
import {
    qualificationSelectionStrategyValidator,
    SOURCE_QUALIFICATION_INPUT_POLICY,
    sourceQualificationValidator,
} from "./domain/sourceQualification";
import {
    sourceAuthorityTierValidator,
    sourceCoverageRoleValidator,
    sourceDocumentKindValidator,
    sourceFamilyValidator,
    sourceRoleAvailabilityValidator,
    sourceSelectionRationaleValidator,
    sourceSelectionReasonCodeValidator,
} from "./domain/sourceSelectionPolicy";
import {
    auditActorValidator,
    auditEventActionValidator,
    companySnapshotValidator,
    coveragePresetValidator,
    executionStatusValidator,
    invitationStatusValidator,
    researchRunLifecycleValidator,
    runEventTypeValidator,
    runPauseReasonValidator,
    sourceDecisionValidator,
    visitorRoleValidator,
    workflowStepKeyValidator,
    workflowStepStateValidator,
} from "./domain/validators";
import { workbenchInstructionTransmissionStatus } from "./domain/workbenchContracts";
import { protectedDiagnosticValidator } from "./execution/operationContracts";
import { executionTables } from "./execution/schema";
import {
    modelConfigurationTables,
    qualificationReasoningSelection,
} from "./modelConfigurationSchema";
import {
    analysisProviderSchema,
    analysisReceiptSchema,
    campaignLimitsSchema,
    campaignManifestSchema,
} from "./qualificationCampaignPolicy";
import { SOURCE_EMBEDDING_DIMENSIONS } from "./resourcePolicy";
import { preparationStudyEnvelopeValidator } from "./sourcePreparationStudyPolicy";

const sourceDiscoveryQueriesValidator = v.array(
    v.object({
        query: v.string(),
        category: v.string(),
        discoveryIntent: v.optional(v.string()),
        includeDomains: v.optional(v.array(v.string())),
        dimensionKeys: v.array(v.string()),
    }),
);

export default defineSchema({
    ...authTables,
    ...executionTables,
    ...modelConfigurationTables,
    invitations: defineTable({
        slotKey: v.string(),
        role: visitorRoleValidator,
        codeDigest: v.string(),
        status: invitationStatusValidator,
        claimedByVisitorId: v.optional(v.id("visitors")),
        claimedAt: v.optional(v.number()),
        revokedAt: v.optional(v.number()),
        createdAt: v.number(),
    })
        .index("by_slot_key", ["slotKey"])
        .index("by_code_digest", ["codeDigest"]),
    visitors: defineTable({
        authUserId: v.id("users"),
        invitationId: v.id("invitations"),
        role: visitorRoleValidator,
        status: v.union(v.literal("active"), v.literal("revoked")),
        analysesReserved: v.number(),
        admittedAt: v.number(),
        revokedAt: v.optional(v.number()),
    })
        .index("by_auth_user_id", ["authUserId"])
        .index("by_invitation_id", ["invitationId"]),
    companies: defineTable({
        cik: v.string(),
        legalName: v.string(),
        ticker: v.string(),
        exchange: v.string(),
        investorRelationsUrl: v.optional(v.string()),
        websiteUrl: v.optional(v.string()),
        websiteUrlSource: v.optional(
            v.union(v.literal("sec_ir"), v.literal("exa"), v.literal("probe")),
        ),
        websiteResolvedAt: v.optional(v.number()),
        canonicalizedAt: v.number(),
    }).index("by_cik", ["cik"]),
    companyPreflights: defineTable({
        ownerAuthUserId: v.optional(v.id("users")),
        ownerVisitorId: v.optional(v.id("visitors")),
        query: v.string(),
        companyId: v.id("companies"),
        companySnapshot: v.optional(companySnapshotValidator),
        resolverVersion: v.string(),
        status: v.union(v.literal("resolved"), v.literal("consumed")),
        expiresAt: v.number(),
        createdAt: v.number(),
    })
        .index("by_owner_auth_user_and_status", ["ownerAuthUserId", "status"])
        .index("by_owner_and_status", ["ownerVisitorId", "status"]),
    manualSourcePreparations: defineTable({
        ownerAuthUserId: v.id("users"),
        collectionKey: v.string(),
        requestKey: v.string(),
        inputDigest: v.string(),
        canonicalUrl: v.string(),
        title: v.string(),
        providerReference: v.string(),
        expiresAt: v.number(),
        consumedAt: v.optional(v.number()),
        createdAt: v.number(),
    })
        .index("by_owner_auth_user_and_collection_key_and_request_key", [
            "ownerAuthUserId",
            "collectionKey",
            "requestKey",
        ])
        .index("by_owner_auth_user_and_canonical_url", [
            "ownerAuthUserId",
            "canonicalUrl",
        ]),
    qualificationCampaigns: defineTable({
        resourcePolicy: v.optional(v.string()),
        key: v.string(),
        manifest: zodToConvex(campaignManifestSchema),
        manifestHash: v.string(),
        configurationHash: v.optional(v.string()),
        configurationHashes: v.optional(
            v.array(v.object({ id: v.string(), hash: v.string() })),
        ),
        lastCandidateHash: v.optional(v.string()),
        ownerVisitorId: v.id("visitors"),
        status: v.union(v.literal("active"), v.literal("closed")),
        allocated: zodToConvex(campaignLimitsSchema),
        analysisAllocated: v.optional(
            v.object({ requests: v.number(), costMicros: v.number() }),
        ),
        lots: v.number(),
        createdAt: v.number(),
        activeLotId: v.optional(v.id("qualificationLots")),
    }).index("by_owner_and_key", ["ownerVisitorId", "key"]),
    qualificationUsage: defineTable({
        contextId: v.id("browserTestContexts"),
        runId: v.optional(v.id("researchRuns")),
        usage: zodToConvex(campaignLimitsSchema),
        technical: v.number(),
        pending: v.number(),
        unknown: v.number(),
        overruns: v.number(),
    }).index("by_context_and_run", ["contextId", "runId"]),
    qualificationAnalysisAttempts: defineTable({
        campaignId: v.id("qualificationCampaigns"),
        lotId: v.id("qualificationLots"),
        attemptKey: v.string(),
        evidenceHash: v.string(),
        provider: zodToConvex(analysisProviderSchema),
        model: v.string(),
        reservationMicros: v.optional(v.number()),
        status: v.union(v.literal("reserved"), v.literal("settled")),
        costMicros: v.optional(v.number()),
        receipt: v.optional(zodToConvex(analysisReceiptSchema)),
        createdAt: v.number(),
    }).index("by_lot_and_attempt", ["lotId", "attemptKey"]),
    qualificationCoverage: defineTable({
        campaignId: v.id("qualificationCampaigns"),
        candidateHash: v.string(),
        configurationId: v.string(),
        attempts: v.number(),
        passed: v.boolean(),
    }).index("by_campaign_and_candidate_and_configuration", [
        "campaignId",
        "candidateHash",
        "configurationId",
    ]),
    qualificationLots: defineTable({
        campaignId: v.id("qualificationCampaigns"),
        key: v.string(),
        candidateHash: v.string(),
        configurationId: v.optional(v.string()),
        correction: v.optional(v.string()),
        changedPaths: v.array(v.string()),
        status: v.union(
            v.literal("running"),
            v.literal("closing"),
            v.literal("review"),
            v.literal("finished"),
        ),
        allocation: zodToConvex(campaignLimitsSchema),
        analysisAllocated: v.optional(
            v.object({ requests: v.number(), costMicros: v.number() }),
        ),
        createdAt: v.number(),
        contextId: v.optional(v.id("browserTestContexts")),
        contextKey: v.optional(v.string()),
        assessmentHash: v.optional(v.string()),
        verdict: v.optional(
            v.union(
                v.literal("passed"),
                v.literal("failed"),
                v.literal("inconclusive"),
            ),
        ),
        configurationHash: v.optional(v.string()),
    })
        .index("by_campaign_and_key", ["campaignId", "key"])
        .index("by_campaign", ["campaignId"]),
    browserTestContexts: defineTable({
        campaignLotId: v.optional(v.id("qualificationLots")),
        simulatedScenarios: v.optional(
            v.array(v.object({ id: v.string(), runId: v.id("researchRuns") })),
        ),
        paidQualification: v.optional(
            v.object({
                resourcePolicy: v.optional(v.string()),
                runId: v.id("researchRuns"),
                modelRevisionId: v.id("modelRevisions"),
                sourcesModelRevisionId: v.optional(v.id("modelRevisions")),
                reasoningSelection: v.optional(qualificationReasoningSelection),
                relayOrigin: v.optional(v.string()),
                maximumSearchAttempts: v.optional(v.number()),
                maximumAcquisitions: v.optional(v.number()),
                costAccountingPolicy: v.optional(
                    v.union(
                        v.literal("conservative_v1"),
                        v.literal("known_final_v1"),
                    ),
                ),
                maximumRequests: v.number(),
                maximumCostUsd: v.number(),
                authorizedAt: v.number(),
                sourcesLot: v.optional(v.array(v.id("researchRuns"))),
                scenarios: v.optional(
                    v.array(
                        v.object({
                            id: v.string(),
                            runId: v.id("researchRuns"),
                        }),
                    ),
                ),
                responseControl: v.optional(responseControlPolicy),
            }),
        ),
        ownerVisitorId: v.id("visitors"),
        authUserId: v.id("users"),
        contextKey: v.string(),
        status: v.union(v.literal("active"), v.literal("closed")),
        expiresAt: v.number(),
        createdAt: v.number(),
        closedAt: v.optional(v.number()),
    })
        .index("by_owner_and_context_key", ["ownerVisitorId", "contextKey"])
        .index("by_auth_user_id_and_status", ["authUserId", "status"]),
    workbenchInstructions: defineTable({
        needId: v.optional(v.string()),
        runId: v.id("researchRuns"),
        requestId: v.id("agentOperationRequests"),
        messageId: v.id("agentMessageDeliveries"),
        interpretedNeed: v.string(),
        framingRevisionId: v.id("framingRevisions"),
        coverageRole: v.optional(coverageRoleValidator),
        status: workbenchInstructionTransmissionStatus,
        outcome: v.string(),
        preparationId: v.optional(v.id("sourceSelectionProposalRebuilds")),
        createdAt: v.number(),
    })
        .index("by_request", ["requestId"])
        .index("by_run", ["runId"])
        .index("by_run_and_status", ["runId", "status"]),
    framingRevisions: defineTable({
        runId: v.id("researchRuns"),
        revision: v.number(),
        content: framingContentValidator,
        requestKey: v.string(),
        contentHash: v.string(),
        origin: v.union(
            v.literal("analyst"),
            v.literal("workbench"),
            v.literal("initial"),
        ),
        createdAt: v.number(),
    })
        .index("by_run_and_key", ["runId", "requestKey"])
        .index("by_run_and_revision", ["runId", "revision"]),
    researchRuns: defineTable({
        sourcesProtocol: v.optional(v.literal("sources_mission_v1")),
        sourcesEnvelope: v.optional(sourcesEnvelopeValidator),
        currentFramingRevisionId: v.optional(v.id("framingRevisions")),
        fixedFramingRevisionId: v.optional(v.id("framingRevisions")),
        researchStartRequestKey: v.optional(v.string()),
        agentExecutionVersion: v.optional(v.literal(3)),
        startMode: v.optional(v.literal("framed")),
        researchPauseRequested: v.optional(v.boolean()),
        researchControlRevision: v.optional(v.number()),
        researchStartedAt: v.optional(v.number()),
        purpose: runPurposeValidator,
        browserTestContextId: v.optional(v.id("browserTestContexts")),
        ownerVisitorId: v.optional(v.id("visitors")),
        reservationKey: v.optional(v.string()),
        reservationStatus: v.optional(
            v.union(v.literal("consumed"), v.literal("restored")),
        ),
        quotaRestoredAt: v.optional(v.number()),
        withdrawnAt: v.optional(v.number()),
        companyId: v.optional(v.id("companies")),
        companySnapshot: v.optional(companySnapshotValidator),
        companyPreflightId: v.optional(v.id("companyPreflights")),
        coveragePreset: v.optional(coveragePresetValidator),
        researchAngle: v.optional(v.string()),
        activeCorpusRevisionId: v.optional(v.id("corpusRevisions")),
        completionOutcome: v.optional(
            v.union(
                v.literal("completed_assessment"),
                v.literal("insufficient_public_evidence"),
            ),
        ),
        executionGeneration: v.number(),
        lifecycleState: researchRunLifecycleValidator,
        executionStatus: executionStatusValidator,
        pauseReason: v.optional(runPauseReasonValidator),
        nextEventSequence: v.number(),
        workflowId: v.optional(v.string()),
        workflowVersion: v.optional(v.number()),
        sourceQualificationAttemptCount: v.optional(v.number()),
        sourcePreparationBudget: v.optional(preparationBudgetValidator),
        executionHarnessDeadlineAt: v.optional(v.number()),
        sourceEmbeddingReservedBytes: v.optional(v.number()),
        sourceEmbeddingAttemptCount: v.optional(v.number()),
        sourcePreparationId: v.optional(
            v.id("sourceSelectionProposalRebuilds"),
        ),
        automaticSupplementOperationId: v.optional(
            v.id("sourceSelectionProposalRebuilds"),
        ),
        evidenceStartRequestKey: v.optional(v.string()),
        retryCount: v.optional(v.number()),
        createdAt: v.number(),
        updatedAt: v.number(),
    })
        .index("by_owner_and_purpose_and_context_and_updated_at", [
            "ownerVisitorId",
            "purpose",
            "browserTestContextId",
            "updatedAt",
        ])
        .index("by_purpose_and_updated_at", ["purpose", "updatedAt"])
        .index("by_purpose_lifecycle_execution_reservation_created_at", [
            "purpose",
            "lifecycleState",
            "executionStatus",
            "reservationStatus",
            "createdAt",
        ])
        .index("by_owner_and_reservation_key", [
            "ownerVisitorId",
            "reservationKey",
        ])
        .index("by_owner_and_execution_status", [
            "ownerVisitorId",
            "executionStatus",
        ])
        .index("by_owner_purpose_context_withdrawn_updated_at", [
            "ownerVisitorId",
            "purpose",
            "browserTestContextId",
            "withdrawnAt",
            "updatedAt",
        ]),
    evidenceAvailabilityEvaluations: defineTable({
        runId: v.id("researchRuns"),
        policyVersion: v.string(),
        secFilingCount: v.number(),
        investorRelationsPresent: v.boolean(),
        manualCandidateCount: v.number(),
        outcome: v.union(v.literal("sufficient"), v.literal("insufficient")),
        reasons: v.array(v.string()),
        createdAt: v.number(),
    }).index("by_run", ["runId"]),
    researchPlans: defineTable({
        runId: v.id("researchRuns"),
        version: v.number(),
        coveragePreset: coveragePresetValidator,
        researchAngle: v.optional(v.string()),
        queries: sourceDiscoveryQueriesValidator,
        createdAt: v.number(),
    }).index("by_run_and_version", ["runId", "version"]),
    // Stable, versioned semantic questions derived from the confirmed company
    // snapshot and bounded research angle. Immutably created with the plan.
    researchPlanQuestions: defineTable({
        runId: v.id("researchRuns"),
        researchPlanId: v.id("researchPlans"),
        planVersion: v.number(),
        questionKey: v.string(),
        prompt: v.string(),
        dimensionKeys: v.array(v.string()),
        createdAt: v.number(),
    })
        .index("by_plan_and_key", ["researchPlanId", "questionKey"])
        .index("by_run", ["runId"]),
    sources: defineTable({
        runId: v.id("researchRuns"),
        canonicalUrl: v.string(),
        title: v.string(),
        origin: v.union(
            v.literal("sec"),
            v.literal("exa"),
            v.literal("analyst_url"),
        ),
        category: v.string(),
        publishedAt: v.optional(v.number()),
        providerReference: v.optional(v.string()),
        secForm: v.optional(v.string()),
        secAccessionNumber: v.optional(v.string()),
        secPrimaryDocument: v.optional(v.string()),
        providerResultPosition: v.optional(v.number()),
        discoveryQueryIndex: v.optional(v.number()),
        reviewSearchId: v.optional(v.id("sourceSelectionProposalRebuilds")),
        createdAt: v.number(),
    }).index("by_run_and_url", ["runId", "canonicalUrl"]),
    previewCaches: defineTable({
        sourceId: v.id("sources"),
        dataUrl: v.string(),
        sizeBytes: v.number(),
        createdAt: v.number(),
        expiresAt: v.number(),
    })
        .index("by_source", ["sourceId"])
        .index("by_expires_at", ["expiresAt"]),
    sourceSearchCaptures: defineTable({
        scopeKey: v.string(),
        captureId: v.id("sourceCaptures"),
        contentHash: v.string(),
        candidateCount: v.number(),
        embeddedCount: v.optional(v.number()),
        embeddingDegradationReason: v.optional(v.string()),
        embeddingProfile: v.optional(v.string()),
    }).index("by_scope_and_capture", ["scopeKey", "captureId"]),
    sourceEmbeddingCache: defineTable({
        profile: v.string(),
        textHash: v.string(),
        vector: v.array(v.float64()),
    }).index("by_profile_and_hash", ["profile", "textHash"]),
    sourceSearchPassages: defineTable({
        scopeKey: v.string(),
        captureId: v.id("sourceCaptures"),
        sourceId: v.id("sources"),
        contentHash: v.string(),
        policyVersion: v.string(),
        order: v.number(),
        startOffset: v.number(),
        endOffset: v.number(),
        quotation: v.string(),
        quotationHash: v.string(),
        headingPath: v.array(v.string()),
        searchText: v.string(),
        embedding: v.optional(v.array(v.float64())),
        embeddingProfile: v.optional(v.string()),
        embeddingScopeKey: v.optional(v.string()),
    })
        .index("by_scope_capture_order", ["scopeKey", "captureId", "order"])
        .searchIndex("search_text", {
            searchField: "searchText",
            filterFields: ["scopeKey", "captureId"],
        })
        .vectorIndex("search_embedding", {
            vectorField: "embedding",
            dimensions: SOURCE_EMBEDDING_DIMENSIONS,
            filterFields: ["embeddingScopeKey"],
        }),
    sourceCaptures: defineTable({
        observedDestinations: v.optional(v.array(observedDestinationValidator)),
        representationCompleteness: v.optional(
            v.union(v.literal("complete"), v.literal("partial")),
        ),
        qualificationInputPolicy: v.optional(
            v.literal(SOURCE_QUALIFICATION_INPUT_POLICY),
        ),
        runId: v.id("researchRuns"),
        corpusRevisionId: v.id("corpusRevisions"),
        sourceId: v.id("sources"),
        preparationId: v.id("sourceSelectionProposalRebuilds"),
        executionGeneration: v.number(),
        captureKey: v.string(),
        requestInputHash: v.string(),
        status: v.union(
            v.literal("reserved"),
            v.literal("uploaded"),
            v.literal("committed"),
            v.literal("unavailable"),
            v.literal("orphaned"),
            v.literal("reconciled"),
        ),
        requestedUrl: v.string(),
        resolvedUrl: v.optional(v.string()),
        storageId: v.optional(v.id("_storage")),
        contentHash: v.optional(v.string()),
        byteCount: v.optional(v.number()),
        mediaType: v.optional(v.string()),
        retrievalVersion: v.optional(v.string()),
        normalizerVersion: v.string(),
        retrievedAt: v.optional(v.number()),
        readingCompleteness: v.optional(
            v.union(v.literal("complete"), v.literal("partial")),
        ),
        omittedPassageCount: v.optional(v.number()),
        failureCode: v.optional(v.string()),
        reconciledAt: v.optional(v.number()),
        createdAt: v.number(),
        updatedAt: v.number(),
    })
        .index("by_capture_key", ["captureKey"])
        .index("by_source_and_input_hash_and_status", [
            "sourceId",
            "requestInputHash",
            "status",
        ])
        .index("by_preparation_and_source", ["preparationId", "sourceId"])
        .index("by_source_and_updated_at", ["sourceId", "updatedAt"])
        .index("by_source_and_status_and_updated_at", [
            "sourceId",
            "status",
            "updatedAt",
        ])
        .index("by_storage_id", ["storageId"])
        .index("by_storage_id_and_status_and_updated_at", [
            "storageId",
            "status",
            "updatedAt",
        ])
        .index("by_status_and_updated_at", ["status", "updatedAt"]),
    corpusRevisions: defineTable({
        runId: v.id("researchRuns"),
        revision: v.number(),
        status: v.union(v.literal("draft"), v.literal("approved")),
        approvedByVisitorId: v.optional(v.id("visitors")),
        approvedAt: v.optional(v.number()),
        sourceSelectionProposalId: v.optional(v.id("sourceSelectionProposals")),
        createdAt: v.number(),
    }).index("by_run_and_revision", ["runId", "revision"]),
    sourceSelectionProposals: defineTable({
        documentaryCoverageGaps: v.optional(
            v.array(sourceCoverageRoleValidator),
        ),
        runId: v.id("researchRuns"),
        corpusRevisionId: v.id("corpusRevisions"),
        sourcePreparationId: v.optional(
            v.id("sourceSelectionProposalRebuilds"),
        ),
        version: v.number(),
        policyVersion: v.string(),
        coveragePreset: coveragePresetValidator,
        researchAngle: v.optional(v.string()),
        recommendedTarget: v.number(),
        recommendationCeiling: v.optional(v.number()),
        publisherRegistryVersion: v.optional(v.string()),
        rebuildOutcome: v.optional(
            v.union(
                v.literal("complete"),
                v.literal("partial"),
                v.literal("blocked"),
            ),
        ),
        failedDiscoveryFamilies: v.optional(v.array(sourceFamilyValidator)),
        candidateFingerprint: v.string(),
        status: v.union(v.literal("ready"), v.literal("failed")),
        failureCode: v.optional(v.string()),
        counts: v.object({
            recommended: v.number(),
            needsAttention: v.number(),
            alternative: v.number(),
        }),
        gaps: v.array(sourceFamilyValidator),
        coverageGaps: v.optional(v.array(sourceCoverageRoleValidator)),
        createdAt: v.number(),
    }).index("by_corpus_revision_id_and_version", [
        "corpusRevisionId",
        "version",
    ]),
    sourceSelectionProposalRebuilds: defineTable({
        resourcePolicy: v.optional(v.string()),
        /** The analyst chose to use prepared material after a Sources time limit. */
        settlementRequestedAt: v.optional(v.number()),
        sourcesMission: v.optional(sourcesPreparationValidator),
        modelRevisionId: v.optional(v.id("modelRevisions")),
        executionPlanVersion: v.optional(
            sourcePreparationExecutionPlanValidator,
        ),
        maxConcurrentSources: v.optional(v.number()),
        preparationStudy: v.optional(
            v.object({
                envelope: v.optional(preparationStudyEnvelopeValidator),
                manifestSha256: v.string(),
                sourceRunId: v.id("researchRuns"),
                qualificationReferencePreparationId: v.optional(
                    v.id("sourceSelectionProposalRebuilds"),
                ),
                phase: v.union(
                    v.literal("replay"),
                    v.literal("reading"),
                    v.literal("comparison"),
                ),
                workflowId: v.optional(vWorkflowId),
            }),
        ),
        progress: v.optional(sourcePreparationProgressValidator),
        initialReadingsCompletedAt: v.optional(v.number()),
        runId: v.id("researchRuns"),
        corpusRevisionId: v.id("corpusRevisions"),
        expectedProposalId: v.optional(v.id("sourceSelectionProposals")),
        kind: v.optional(v.literal("preparation")),
        resumesPreparationId: v.optional(
            v.id("sourceSelectionProposalRebuilds"),
        ),
        configurationCheck: v.optional(
            v.object({
                available: v.boolean(),
                checkedAt: v.number(),
            }),
        ),
        entryPoint: v.optional(
            v.union(
                v.literal("initial_discovery"),
                v.literal("source_review"),
                v.literal("manual_addition"),
                v.literal("targeted_search"),
            ),
        ),
        workflowId: v.optional(v.string()),
        workflowVersion: v.optional(v.number()),
        qualificationVersion: v.optional(v.string()),
        comparisonVersion: v.optional(v.string()),
        retrievalVersion: v.optional(v.string()),
        retrievalRankingPolicy: v.optional(
            v.literal(SOURCE_RETRIEVAL_RANKING_POLICY),
        ),
        retrievalMode: v.optional(
            v.union(v.literal("lexical"), v.literal("hybrid")),
        ),
        deadlineAt: v.optional(v.number()),
        asOfTime: v.optional(v.number()),
        manualSourceIds: v.optional(v.array(v.id("sources"))),
        readingSourceIds: v.optional(v.array(v.id("sources"))),
        documentaryNeed: v.optional(v.string()),
        supplementQueries: v.optional(sourceDiscoveryQueriesValidator),
        supplementClaimedQueryIndexes: v.optional(v.array(v.number())),
        supplementSourceIds: v.optional(v.array(v.id("sources"))),
        modelAttemptCount: v.optional(v.number()),
        modelLimits: v.optional(preparationModelLimitsValidator),
        sourceOutcomes: v.optional(v.array(sourcePreparationOutcomeValidator)),
        stopCode: v.optional(sourcePreparationStopCodeValidator),
        executionGeneration: v.number(),
        policyVersion: v.string(),
        operationKey: v.string(),
        cycle: v.optional(v.number()),
        requestId: v.optional(v.string()),
        target: v.optional(recoveryTargetValidator),
        reason: v.optional(recoveryReasonValidator),
        insertedCount: v.optional(v.number()),
        status: v.union(
            v.literal("started"),
            v.literal("complete"),
            v.literal("partial"),
            v.literal("blocked"),
        ),
        failedDiscoveryFamilies: v.array(sourceFamilyValidator),
        proposalId: v.optional(v.id("sourceSelectionProposals")),
        proposalVersion: v.optional(v.number()),
        leaseExpiresAt: v.number(),
        createdAt: v.number(),
        completedAt: v.optional(v.number()),
    })
        .index("by_operation_key", ["operationKey"])
        .index("by_revision_and_status_and_lease", [
            "corpusRevisionId",
            "status",
            "leaseExpiresAt",
        ])
        .index("by_revision_and_created_at", ["corpusRevisionId", "createdAt"]),
    sourceSelectionProposalItems: defineTable({
        runId: v.id("researchRuns"),
        corpusRevisionId: v.id("corpusRevisions"),
        proposalId: v.id("sourceSelectionProposals"),
        sourceId: v.id("sources"),
        sourceCaptureId: v.optional(v.id("sourceCaptures")),
        qualificationTaskId: v.optional(v.id("aiTaskResults")),
        comparisonTaskIds: v.optional(v.array(v.id("aiTaskResults"))),
        comparisonOutcomes: v.optional(
            zodToConvex(sourceComparisonOutcomesSchema),
        ),
        roleAvailability: v.optional(sourceRoleAvailabilityValidator),
        selectionRationale: v.optional(sourceSelectionRationaleValidator),
        inspectionStatus: v.optional(
            v.union(
                v.literal("complete"),
                v.literal("partial"),
                v.literal("unavailable"),
            ),
        ),
        disposition: v.union(
            v.literal("recommended"),
            v.literal("needs_attention"),
            v.literal("alternative"),
        ),
        sourceFamily: v.union(
            sourceFamilyValidator,
            v.literal("unrecognized"),
            v.literal("analyst_supplied"),
        ),
        documentKind: v.optional(sourceDocumentKindValidator),
        authorityTier: v.optional(sourceAuthorityTierValidator),
        companyLinkageBasis: v.optional(
            v.union(
                v.literal("structural"),
                v.literal("discovery_metadata"),
                v.literal("unverified"),
                v.literal("not_evaluated"),
                v.literal("inspected_content"),
            ),
        ),
        coverageContributions: v.optional(v.array(v.string())),
        recommendationContributions: v.optional(v.array(v.string())),
        declaredCoverageRoles: v.optional(v.array(sourceCoverageRoleValidator)),
        eligibleCoverageRoles: v.optional(v.array(sourceCoverageRoleValidator)),
        duplicateOfSourceId: v.optional(v.id("sources")),
        rank: v.number(),
        reasonCodes: v.array(sourceSelectionReasonCodeValidator),
        createdAt: v.number(),
    })
        .index("by_proposal_and_disposition_and_rank_and_source", [
            "proposalId",
            "disposition",
            "rank",
            "sourceId",
        ])
        .index("by_proposal_and_source", ["proposalId", "sourceId"])
        .index("by_proposal_and_rank_and_source", [
            "proposalId",
            "rank",
            "sourceId",
        ]),
    sourceDecisions: defineTable({
        runId: v.id("researchRuns"),
        corpusRevisionId: v.id("corpusRevisions"),
        sourceId: v.id("sources"),
        decisionKey: v.string(),
        decision: sourceDecisionValidator,
        reviewerVisitorId: v.optional(v.id("visitors")),
        supersedesDecisionId: v.optional(v.id("sourceDecisions")),
        reason: v.optional(v.string()),
        occurredAt: v.number(),
    })
        .index("by_revision_and_source", ["corpusRevisionId", "sourceId"])
        .index("by_revision_source_and_occurred_at", [
            "corpusRevisionId",
            "sourceId",
            "occurredAt",
        ])
        .index("by_run_and_decision_key", ["runId", "decisionKey"]),
    sourceReviewItems: defineTable({
        runId: v.id("researchRuns"),
        corpusRevisionId: v.id("corpusRevisions"),
        sourceId: v.id("sources"),
        decision: sourceDecisionValidator,
        decisionRank: v.number(),
        sourceCreatedAt: v.number(),
        latestDecisionId: v.id("sourceDecisions"),
        decisionOccurredAt: v.number(),
        reason: v.optional(v.string()),
    })
        .index("by_revision_and_source", ["corpusRevisionId", "sourceId"])
        .index("by_revision_and_queue", [
            "corpusRevisionId",
            "decisionRank",
            "sourceCreatedAt",
            "sourceId",
        ])
        .index("by_revision_decision_and_order", [
            "corpusRevisionId",
            "decision",
            "sourceCreatedAt",
            "sourceId",
        ]),
    evidenceSourceStatuses: defineTable({
        runId: v.id("researchRuns"),
        corpusRevisionId: v.id("corpusRevisions"),
        sourceId: v.id("sources"),
        sourceVersionId: v.optional(v.id("sourceVersions")),
        acceptedDecisionId: v.id("sourceDecisions"),
        executionGeneration: v.number(),
        status: v.union(
            v.literal("queued"),
            v.literal("running"),
            v.literal("succeeded"),
            v.literal("partial"),
            v.literal("failed"),
        ),
        requestKey: v.optional(v.string()),
        failureReason: v.optional(v.string()),
        createdAt: v.number(),
        updatedAt: v.number(),
    })
        .index("by_run_and_execution_generation", [
            "runId",
            "executionGeneration",
        ])
        .index("by_run_and_execution_generation_and_source", [
            "runId",
            "executionGeneration",
            "sourceId",
        ])
        .index("by_run_corpus_generation_source", [
            "runId",
            "corpusRevisionId",
            "executionGeneration",
            "sourceId",
        ])
        .index("by_run_and_request_key", ["runId", "requestKey"]),
    artifactUploadLeases: defineTable({
        runId: v.id("researchRuns"),
        corpusRevisionId: v.id("corpusRevisions"),
        sourceId: v.id("sources"),
        acceptedDecisionId: v.id("sourceDecisions"),
        contentHash: v.string(),
        normalizerVersion: v.string(),
        executionGeneration: v.number(),
        status: v.union(
            v.literal("reserved"),
            v.literal("uploaded"),
            v.literal("committed"),
            v.literal("orphaned"),
            v.literal("reconciled"),
        ),
        storageId: v.optional(v.id("_storage")),
        reconciledAt: v.optional(v.number()),
        createdAt: v.number(),
        updatedAt: v.number(),
    })
        .index("by_full_identity", [
            "corpusRevisionId",
            "sourceId",
            "acceptedDecisionId",
            "contentHash",
            "normalizerVersion",
        ])
        .index("by_run_and_execution_generation", [
            "runId",
            "executionGeneration",
        ])
        .index("by_source_and_content_hash", [
            "sourceId",
            "contentHash",
            "normalizerVersion",
        ])
        .index("by_status", ["status"])
        .index("by_status_and_updated_at", ["status", "updatedAt"])
        .index("by_storage_id", ["storageId"]),
    sourceVersions: defineTable({
        sourceCaptureId: v.optional(v.id("sourceCaptures")),
        runId: v.id("researchRuns"),
        corpusRevisionId: v.id("corpusRevisions"),
        sourceId: v.id("sources"),
        acceptedDecisionId: v.id("sourceDecisions"),
        contentHash: v.string(),
        normalizerVersion: v.string(),
        storageId: v.id("_storage"),
        mediaType: v.string(),
        byteCount: v.number(),
        pageCount: v.optional(v.number()),
        canonicalUrl: v.string(),
        retrievalVersion: v.string(),
        retrievalMetadata: v.optional(
            v.object({
                secAccessionNumber: v.optional(v.string()),
                secForm: v.optional(v.string()),
                companyCik: v.optional(v.string()),
                primaryDocument: v.optional(v.string()),
                providerReference: v.optional(v.string()),
                searchTime: v.optional(v.number()),
                costDollars: v.optional(v.number()),
                contentType: v.optional(v.string()),
                pageCount: v.optional(v.number()),
                pdfFingerprint: v.optional(v.string()),
            }),
        ),
        executionGeneration: v.number(),
        createdAt: v.number(),
    })
        .index("by_full_identity", [
            "corpusRevisionId",
            "sourceId",
            "acceptedDecisionId",
            "contentHash",
            "normalizerVersion",
        ])
        .index("by_source_and_hash", [
            "sourceId",
            "contentHash",
            "normalizerVersion",
        ])
        .index("by_revision_and_source", ["corpusRevisionId", "sourceId"])
        .index("by_run", ["runId"])
        .index("by_run_and_execution_generation", [
            "runId",
            "executionGeneration",
        ])
        .index("by_storage_id", ["storageId"]),
    sourcePassages: defineTable({
        sourceVersionId: v.id("sourceVersions"),
        locatorVersion: v.string(),
        passageKey: v.optional(v.string()),
        quotationHash: v.string(),
        order: v.number(),
        exactQuotation: v.string(),
        locator: sourceLocatorValidator,
        contextBefore: v.optional(v.string()),
        contextAfter: v.optional(v.string()),
        headingPath: v.optional(v.array(v.string())),
        createdAt: v.number(),
    })
        .index("by_source_version_and_order", ["sourceVersionId", "order"])
        .index("by_source_version_and_quotation_hash", [
            "sourceVersionId",
            "quotationHash",
        ])
        .index("by_passage_key", ["passageKey"]),
    providerCalls: defineTable({
        modelContextWindowTokens: v.optional(v.number()),
        reservedMaxOutputTokens: v.optional(v.number()),
        operationRequestId: v.optional(v.id("agentOperationRequests")),
        qualificationReservationUsd: v.optional(v.number()),
        costAccountingPolicy: v.optional(
            v.union(v.literal("conservative_v1"), v.literal("known_final_v1")),
        ),
        reportedCostFinal: v.optional(v.boolean()),
        qualificationContextId: v.optional(v.id("browserTestContexts")),
        missionId: v.optional(v.id("agentMissions")),
        invocationId: v.optional(v.id("agentInvocations")),
        inputHash: v.optional(v.string()),
        runId: v.optional(v.id("researchRuns")),
        corpusRevisionId: v.optional(v.id("corpusRevisions")),
        sourceId: v.optional(v.id("sources")),
        preparationId: v.optional(v.id("sourceSelectionProposalRebuilds")),
        executionGeneration: v.optional(v.number()),
        workflowVersion: v.optional(v.number()),
        stepKey: v.optional(v.string()),
        service: v.union(
            v.literal("model"),
            v.literal("sec"),
            v.literal("exa"),
            v.literal("url_metadata"),
            v.literal("pdf"),
        ),
        operation: v.string(),
        operationKey: v.string(),
        status: v.union(
            v.literal("started"),
            v.literal("succeeded"),
            v.literal("partial"),
            v.literal("failed"),
        ),
        attempt: v.number(),
        latencyMs: v.optional(v.number()),
        usage: v.optional(v.any()),
        reportedCost: v.optional(v.number()),
        providerObservation: v.optional(
            v.object({
                cancelled: v.optional(v.literal(true)),
                generationId: v.optional(v.string()),
                observedAt: v.number(),
                httpStatus: v.optional(v.number()),
                requestId: v.optional(v.string()),
            }),
        ),
        transportDiagnostic: v.optional(protectedDiagnosticValidator),
        billing: v.optional(
            v.object({
                state: v.union(
                    v.literal("pending"),
                    v.literal("checking"),
                    v.literal("confirmed"),
                    v.literal("unavailable"),
                    v.literal("conflict"),
                ),
                attempt: v.number(),
                updatedAt: v.number(),
                reason: v.optional(
                    v.union(
                        v.literal("missing_configuration"),
                        v.literal("not_found"),
                        v.literal("http_error"),
                        v.literal("timeout"),
                        v.literal("response_too_large"),
                        v.literal("invalid_response"),
                        v.literal("transport_error"),
                        v.literal("amount_conflict"),
                    ),
                ),
                retryAt: v.optional(v.number()),
                httpStatus: v.optional(v.number()),
                latencyMs: v.optional(v.number()),
            }),
        ),
        errorCode: v.optional(v.string()),
        diagnostic: v.optional(
            v.object({
                reason: v.string(),
                finishReason: v.optional(v.string()),
                output: v.optional(v.string()),
                originalBytes: v.number(),
                truncated: v.boolean(),
            }),
        ),
        retryable: v.optional(v.boolean()),
        dispatchOutcome: v.optional(preparationDispatchOutcomeValidator),
        httpStatus: v.optional(v.number()),
        retryAfterAt: v.optional(v.number()),
        recoveryOfProviderCallId: v.optional(v.id("providerCalls")),
        leaseExpiresAt: v.optional(v.number()),
        createdAt: v.number(),
        completedAt: v.optional(v.number()),
    })
        .index("by_operation_key", ["operationKey"])
        .index("by_qualification_context_and_status_and_lease", [
            "qualificationContextId",
            "status",
            "leaseExpiresAt",
        ])
        .index("by_qualification_context", ["qualificationContextId"])
        .index("by_run_operation_input_and_attempt", [
            "runId",
            "operation",
            "inputHash",
            "attempt",
        ])
        .index("by_run", ["runId"])
        .index("by_run_and_status_and_created_at", [
            "runId",
            "status",
            "createdAt",
        ])
        .index("by_run_source_operation", ["runId", "sourceId", "operation"])
        .index("by_created_at", ["createdAt"]),
    paidWorkControls: defineTable({
        key: v.literal("global"),
        enabled: v.boolean(),
        updatedByVisitorId: v.optional(v.id("visitors")),
        reason: v.optional(v.string()),
        updatedAt: v.number(),
    }).index("by_key", ["key"]),
    workflowSteps: defineTable({
        runId: v.id("researchRuns"),
        key: workflowStepKeyValidator,
        state: workflowStepStateValidator,
        attempt: v.number(),
        startedAt: v.optional(v.number()),
        completedAt: v.optional(v.number()),
        updatedAt: v.number(),
    }).index("by_run_and_key", ["runId", "key"]),
    runEvents: defineTable({
        runId: v.id("researchRuns"),
        sequence: v.number(),
        type: runEventTypeValidator,
        lifecycleState: researchRunLifecycleValidator,
        executionStatus: executionStatusValidator,
        stepKey: v.optional(workflowStepKeyValidator),
        messageKey: v.optional(v.string()),
        current: v.optional(v.number()),
        total: v.optional(v.number()),
        failureCode: v.optional(v.string()),
        occurredAt: v.number(),
    }).index("by_run_and_sequence", ["runId", "sequence"]),
    auditEvents: defineTable({
        actor: auditActorValidator,
        action: auditEventActionValidator,
        targetType: v.string(),
        targetId: v.string(),
        reason: v.optional(v.string()),
        occurredAt: v.number(),
    }).index("by_target", ["targetType", "targetId"]),
    checkpointDecisions: defineTable({
        runId: v.id("researchRuns"),
        checkpoint: v.union(
            v.literal("evidence_sufficiency_review"),
            v.literal("source_review"),
            v.literal("assessment_review"),
        ),
        decisionKey: v.string(),
        reviewerVisitorId: v.id("visitors"),
        decision: v.union(
            v.literal("approved"),
            v.literal("recheck"),
            v.literal("force_continue"),
            v.literal("complete_insufficient"),
        ),
        reason: v.optional(v.string()),
        occurredAt: v.number(),
    })
        .index("by_run_and_checkpoint", ["runId", "checkpoint"])
        .index("by_run_and_decision_key", ["runId", "decisionKey"])
        .index("by_occurred_at", ["occurredAt"]),
    aiTaskResults: defineTable({
        comparisonContextHash: v.optional(v.string()),
        sourceId: v.optional(v.id("sources")),
        sourceCaptureId: v.optional(v.id("sourceCaptures")),
        runId: v.id("researchRuns"),
        corpusRevisionId: v.id("corpusRevisions"),
        taskType: v.union(
            v.literal("source_qualification"),
            v.literal("source_comparison"),
            v.literal("showcase_claim_extraction"),
            v.literal("semantic_verification"),
            v.literal("documentary_qualification"),
            v.literal("documentary_control"),
        ),
        executionMode: aiTaskExecutionModeValidator,
        fixtureId: v.optional(v.string()),
        fixtureVersion: v.optional(v.string()),
        schemaVersion: v.string(),
        adapterVersion: v.string(),
        inputHash: v.string(),
        output: v.union(
            documentaryQualificationOutput,
            documentaryControlOutput,
            v.object({
                kind: v.literal("source_qualification"),
                selectionStrategy: v.optional(
                    qualificationSelectionStrategyValidator,
                ),
                retrieval: v.optional(retrievalMetadataValidator),
                sourceCaptureId: v.id("sourceCaptures"),
                qualification: sourceQualificationValidator,
                contentHash: v.string(),
                readingCompleteness: v.union(
                    v.literal("complete"),
                    v.literal("partial"),
                ),
                omittedPassageCount: v.number(),
                selectedPassages: v.array(
                    v.object({
                        passageKey: v.string(),
                        startOffset: v.number(),
                        endOffset: v.number(),
                    }),
                ),
            }),
            zodToConvex(sourceComparisonOutputSchema),
            v.object({
                kind: v.literal("claim_extraction"),
                claimCount: v.number(),
                claimIds: v.array(v.id("claims")),
            }),
            v.object({
                kind: v.literal("semantic_verification"),
                label: v.union(
                    v.literal("entailed"),
                    v.literal("contradicted"),
                    v.literal("mixed"),
                ),
                evidenceReferences: v.array(
                    v.object({
                        sourcePassageId: v.id("sourcePassages"),
                        passageKey: v.string(),
                    }),
                ),
            }),
        ),
        providerCallId: v.optional(v.id("providerCalls")),
        createdAt: v.number(),
    })
        .index("by_run_and_task_type_and_input_hash", [
            "runId",
            "taskType",
            "inputHash",
        ])
        .index("by_source_and_task_type_and_created_at", [
            "sourceId",
            "taskType",
            "createdAt",
        ])
        .index("by_run", ["runId"])
        .index("by_corpus_revision", ["corpusRevisionId"]),
    claims: defineTable({
        runId: v.id("researchRuns"),
        corpusRevisionId: v.id("corpusRevisions"),
        statement: v.string(),
        canonicalText: v.string(),
        classification: claimClassificationValidator,
        inputHash: v.optional(v.string()),
        proposingTaskId: v.id("aiTaskResults"),
        researchPlanQuestionId: v.optional(v.id("researchPlanQuestions")),
        schemaVersion: v.string(),
        createdAt: v.number(),
    })
        .index("by_revision_and_canonical", [
            "corpusRevisionId",
            "canonicalText",
            "classification",
        ])
        .index("by_revision_input_hash_and_canonical", [
            "corpusRevisionId",
            "inputHash",
            "canonicalText",
            "classification",
        ])
        .index("by_run", ["runId"])
        .index("by_run_and_corpus", ["runId", "corpusRevisionId"])
        .index("by_task", ["proposingTaskId"]),
    claimEvidence: defineTable({
        claimId: v.id("claims"),
        sourcePassageId: v.id("sourcePassages"),
        relation: evidenceRelationValidator,
        proposingTaskId: v.id("aiTaskResults"),
        createdAt: v.number(),
    })
        .index("by_claim", ["claimId"])
        .index("by_claim_and_passage", ["claimId", "sourcePassageId"])
        .index("by_claim_and_passage_and_relation", [
            "claimId",
            "sourcePassageId",
            "relation",
        ])
        .index("by_passage", ["sourcePassageId"]),
    claimDimensionLinks: defineTable({
        claimId: v.id("claims"),
        runId: v.id("researchRuns"),
        corpusRevisionId: v.id("corpusRevisions"),
        dimensionKey: assessmentDimensionKeyValidator,
        proposalRevision: v.number(),
        origin: claimDimensionLinkOriginValidator,
        proposingTaskId: v.optional(v.id("aiTaskResults")),
        rationale: v.optional(v.string()),
        createdAt: v.number(),
    })
        .index("by_claim", ["claimId"])
        .index("by_claim_and_dimension", ["claimId", "dimensionKey"])
        .index("by_run_and_corpus_and_dimension", [
            "runId",
            "corpusRevisionId",
            "dimensionKey",
        ])
        .index("by_corpus_and_claim_and_dimension_and_origin", [
            "corpusRevisionId",
            "claimId",
            "dimensionKey",
            "origin",
        ]),
    // Local Convex E2E durable manifest bridge: a gate-protected, deployable
    // copy of the showcase manifest keyed by exact input hash. The fixture
    // writes it so the claim adapter can resolve the identical claims across
    // separate function invocations in a real local deployment. Every read and
    // write is gated on E2E_FIXTURES_ENABLED; with the gate disabled this table
    // stays empty and the in-memory showcase manifest remains the only source.
    showcaseManifestEntries: defineTable({
        inputHash: v.string(),
        fixtureId: v.string(),
        fixtureVersion: v.string(),
        schemaVersion: v.string(),
        adapterVersion: v.string(),
        claims: v.array(showcaseClaimOutputValidator),
        createdAt: v.number(),
    }).index("by_input_hash", ["inputHash"]),
    policyEvaluations: defineTable({
        runId: v.id("researchRuns"),
        corpusRevisionId: v.id("corpusRevisions"),
        claimId: v.id("claims"),
        policyVersion: v.string(),
        normalizedInputs: v.object({
            classification: claimClassificationValidator,
            asOfTime: v.number(),
            supportingSourceIds: v.optional(v.array(v.string())),
            sources: v.array(
                v.object({
                    sourceId: v.string(),
                    origin: v.union(
                        v.literal("sec"),
                        v.literal("exa"),
                        v.literal("analyst_url"),
                    ),
                    category: v.string(),
                    secForm: v.optional(v.string()),
                    publisherIdentity: v.string(),
                    authorityTier: sourceAuthorityTierValidator,
                    documentKind: sourceDocumentKindValidator,
                    publishedAt: v.optional(v.number()),
                }),
            ),
            supportingEvidenceCount: v.number(),
            counterEvidenceCount: v.number(),
            contextEvidenceCount: v.number(),
            distinctSourceCount: v.number(),
            distinctPublisherCount: v.number(),
            distinctPassageCount: v.number(),
            unresolvedCounterCount: v.number(),
            coveredQuestionCount: v.number(),
            totalQuestionCount: v.number(),
            currentPlanQuestionCovered: v.boolean(),
        }),
        structuralResult: v.union(
            v.object({ status: v.literal("valid") }),
            v.object({
                status: v.literal("blocked"),
                ruleId: v.string(),
            }),
        ),
        rules: v.array(
            v.object({
                ruleId: v.string(),
                outcome: v.union(
                    v.literal("pass"),
                    v.literal("needs_review"),
                    v.literal("blocked"),
                ),
                reasonCode: v.string(),
            }),
        ),
        reasonCodes: v.array(v.string()),
        result: v.union(
            v.literal("pass"),
            v.literal("needs_review"),
            v.literal("blocked"),
        ),
        inputHash: v.string(),
        verifierTaskId: v.optional(v.id("aiTaskResults")),
        createdAt: v.number(),
    })
        .index("by_run", ["runId"])
        .index("by_claim", ["claimId"])
        .index("by_claim_and_input_hash", ["claimId", "inputHash"])
        .index("by_run_and_corpus_revision", ["runId", "corpusRevisionId"]),
});
