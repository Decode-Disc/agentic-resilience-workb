import type { FunctionReference } from "convex/server";
import { makeFunctionReference } from "convex/server";
import { type Infer, v } from "convex/values";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import {
    env,
    internalAction,
    internalMutation,
    internalQuery,
} from "./_generated/server";
import { mergeRunCompanyMetadata } from "./domain/companyMetadata";
import { claimPausedRunExecution } from "./domain/executionClaim";
import { ASSESSMENT_DIMENSION_KEYS } from "./domain/researchPlan";
import {
    materializeSourceComparisonOutput,
    prepareSourceComparisonInput,
    SOURCE_COMPARISON_DISPOSITIONS,
    SOURCE_COMPARISON_VERSION,
} from "./domain/sourceComparison";
import {
    computePassageKey,
    extractPassagesFromNormalizedText,
    sha256Hex,
} from "./domain/sourcePassages";
import {
    materializeQualificationOutput,
    prepareQualificationInput,
    SOURCE_QUALIFICATION_VERSION,
    sourceQualificationValidator,
} from "./domain/sourceQualification";
import { classifySourceCandidate } from "./domain/sourceSelectionPolicy";
import { readPinnedSourceQualification } from "./domain/sourceUsage";
import { buildCccShowcaseManifest } from "./fixtures/cccShowcase";
import {
    MAX_PASSAGES_PER_SOURCE,
    SOURCE_PREPARATION_DEADLINE_MS,
    sourceCandidateLimit,
    sourcePreparationEnabled,
} from "./resourceLimits";
import schema from "./schema";
import { createSourceSelectionProposal } from "./sourceSelectionProposals";
import { corpusRevisionApproved, workflow } from "./workflow";

const sourceReviewFixtureResultValidator = v.object({
    runId: v.id("researchRuns"),
    corpusRevisionId: v.id("corpusRevisions"),
    proposalId: v.id("sourceSelectionProposals"),
    proposalVersion: v.number(),
    sourceIds: v.array(v.id("sources")),
});
type SourceReviewFixtureResult = Infer<
    typeof sourceReviewFixtureResultValidator
>;

export const sourceReviewWorkflow = workflow
    .define({
        args: {
            runId: v.id("researchRuns"),
        },
        returns: v.null(),
    })
    .handler(async (step, args): Promise<null> => {
        const approval = await step.awaitEvent(corpusRevisionApproved);
        await step.runMutation(
            internal.e2eFixtures.completeSourceReviewScenario,
            {
                runId: args.runId,
                corpusRevisionId: approval.corpusRevisionId,
                decisionId: approval.decisionId,
                expectedExecutionGeneration: approval.executionGeneration,
            },
        );
        return null;
    });

export const completeSourceReviewScenario = internalMutation({
    args: {
        runId: v.id("researchRuns"),
        corpusRevisionId: v.id("corpusRevisions"),
        decisionId: v.id("checkpointDecisions"),
        expectedExecutionGeneration: v.number(),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        if (env.E2E_FIXTURES_ENABLED !== "true")
            throw new Error("E2E fixtures are disabled");
        const fixtureRun = await ctx.db.get(args.runId);
        if (
            !fixtureRun?.reservationKey?.startsWith("e2e:") ||
            !(
                fixtureRun.companySnapshot?.cik.startsWith("e2e-") ||
                (fixtureRun.reservationKey.startsWith("e2e:utility-") &&
                    fixtureRun.companySnapshot?.legalName.endsWith(
                        "· Recorded review",
                    ))
            )
        ) {
            throw new Error("E2E source review scenario not found");
        }
        await ctx.runMutation(
            internal.evidenceExecution.completeSourceReview,
            args,
        );
        const run = await ctx.db.get(args.runId);
        if (run?.executionStatus !== "running") return null;
        // Prepared proposals use the captured-byte path, including explicit
        // missing-capture failures. Legacy fixture URLs must never reach a provider.
        const sources = await ctx.runQuery(
            internal.evidenceArtifacts.listFrozenSourcesForRun,
            {
                runId: run._id,
                executionGeneration: run.executionGeneration,
            },
        );
        for (const source of sources) {
            const prepared = await ctx.runQuery(
                internal.evidenceArtifacts.getFrozenSourceForExecution,
                {
                    runId: run._id,
                    corpusRevisionId: source.corpusRevisionId,
                    sourceId: source.sourceId,
                    acceptedDecisionId: source.acceptedDecisionId,
                    executionGeneration: run.executionGeneration,
                },
            );
            if (prepared?.preparedCapture !== undefined) continue;
            await ctx.runMutation(
                internal.evidenceArtifacts.updateEvidenceSourceStatus,
                {
                    runId: run._id,
                    corpusRevisionId: source.corpusRevisionId,
                    sourceId: source.sourceId,
                    acceptedDecisionId: source.acceptedDecisionId,
                    executionGeneration: run.executionGeneration,
                    status: "failed",
                    failureReason: "e2e_fixture_acquisition_unavailable",
                },
            );
        }
        return null;
    },
});

const recordedSourceMetadata = {
    canonicalUrl: v.string(),
    title: v.string(),
    origin: v.union(
        v.literal("sec"),
        v.literal("exa"),
        v.literal("analyst_url"),
    ),
    category: v.string(),
    secForm: v.optional(v.string()),
};
export const seedSourceReviewScenario = internalMutation({
    args: {
        slotKey: v.string(),
        fixtureKey: v.string(),
        recoveryScenario: v.optional(v.boolean()),
        legacySelectionReasons: v.optional(v.boolean()),
        recordedScenario: v.optional(
            v.object({
                companyName: v.string(),
                companyCik: v.string(),
                ticker: v.string(),
                websiteUrl: v.string(),
                researchAngle: v.string(),
                sources: v.array(v.object(recordedSourceMetadata)),
            }),
        ),
    },
    returns: sourceReviewFixtureResultValidator,
    handler: async (
        ctx,
        args,
    ): Promise<{
        runId: Id<"researchRuns">;
        corpusRevisionId: Id<"corpusRevisions">;
        proposalId: Id<"sourceSelectionProposals">;
        proposalVersion: number;
        sourceIds: Array<Id<"sources">>;
    }> => {
        if (env.E2E_FIXTURES_ENABLED !== "true") {
            throw new Error("E2E fixtures are disabled");
        }
        if (
            args.recordedScenario &&
            (args.recoveryScenario ||
                args.recordedScenario.sources.length < 1 ||
                args.recordedScenario.sources.length > 8 ||
                !["127.0.0.1", "localhost"].includes(
                    new URL(env.CONVEX_CLOUD_URL).hostname,
                ))
        )
            throw new Error("Invalid local recorded review scenario");
        const slotKey = args.slotKey.trim();
        const fixtureKey = args.fixtureKey.trim();
        if (!slotKey || !fixtureKey || fixtureKey.length > 80) {
            throw new Error("Invalid E2E fixture identifier");
        }
        const invitation = await ctx.db
            .query("invitations")
            .withIndex("by_slot_key", (query) => query.eq("slotKey", slotKey))
            .unique();
        if (
            invitation?.status !== "claimed" ||
            !invitation.claimedByVisitorId
        ) {
            throw new Error("Claimed E2E invitation not found");
        }
        const visitor = await ctx.db.get(invitation.claimedByVisitorId);
        if (
            visitor?.status !== "active" ||
            visitor.invitationId !== invitation._id
        ) {
            throw new Error("Active E2E visitor not found");
        }
        const reservationKey = `e2e:${fixtureKey}`;
        const existingRun = await ctx.db
            .query("researchRuns")
            .withIndex("by_owner_and_reservation_key", (query) =>
                query
                    .eq("ownerVisitorId", visitor._id)
                    .eq("reservationKey", reservationKey),
            )
            .unique();
        if (existingRun?.activeCorpusRevisionId) {
            const revision = await ctx.db.get(
                existingRun.activeCorpusRevisionId,
            );
            const proposal = revision?.sourceSelectionProposalId
                ? await ctx.db.get(revision.sourceSelectionProposalId)
                : null;
            const sources = await ctx.db
                .query("sources")
                .withIndex("by_run_and_url", (query) =>
                    query.eq("runId", existingRun._id),
                )
                .collect();
            if (
                revision &&
                proposal &&
                sources.length ===
                    (args.recordedScenario?.sources.length ??
                        (args.recoveryScenario ? sourceCandidateLimit() : 3))
            ) {
                if (
                    args.recordedScenario &&
                    (existingRun.companySnapshot?.cik !==
                        args.recordedScenario.companyCik ||
                        existingRun.companySnapshot?.legalName !==
                            args.recordedScenario.companyName ||
                        existingRun.researchAngle !==
                            args.recordedScenario.researchAngle ||
                        args.recordedScenario.sources.some(
                            (expected) =>
                                !sources.some(
                                    (actual) =>
                                        actual.canonicalUrl ===
                                            expected.canonicalUrl &&
                                        actual.title === expected.title &&
                                        actual.origin === expected.origin &&
                                        actual.category === expected.category &&
                                        actual.secForm === expected.secForm,
                                ),
                        ))
                )
                    throw new Error("Recorded fixture replay mismatch");
                return {
                    runId: existingRun._id,
                    corpusRevisionId: revision._id,
                    proposalId: proposal._id,
                    proposalVersion: proposal.version,
                    sourceIds: args.recordedScenario
                        ? args.recordedScenario.sources.map((expected) => {
                              const source = sources.find(
                                  (s) =>
                                      s.canonicalUrl === expected.canonicalUrl,
                              );
                              if (!source)
                                  throw new Error("Recorded source missing");
                              return source._id;
                          })
                        : sources.map(({ _id }) => _id),
                };
            }
        }

        const now = Date.now();
        const existingCompany = args.recordedScenario
            ? await ctx.db
                  .query("companies")
                  .withIndex("by_cik", (q) =>
                      q.eq("cik", args.recordedScenario?.companyCik ?? ""),
                  )
                  .unique()
            : null;
        const companyId =
            existingCompany?._id ??
            (await ctx.db.insert("companies", {
                cik: args.recordedScenario?.companyCik ?? `e2e-${fixtureKey}`,
                legalName:
                    args.recordedScenario?.companyName.replace(
                        " · Recorded review",
                        "",
                    ) ?? "Reactive Systems Test Company",
                ticker: args.recordedScenario?.ticker ?? "RXT",
                exchange: "NASDAQ",
                websiteUrl:
                    args.recordedScenario?.websiteUrl ?? "https://example.com/",
                canonicalizedAt: now,
            }));
        const runId = await ctx.db.insert("researchRuns", {
            ownerVisitorId: visitor._id,
            reservationKey,
            reservationStatus: "consumed",
            companyId,
            companySnapshot: {
                cik: args.recordedScenario?.companyCik ?? `e2e-${fixtureKey}`,
                legalName:
                    args.recordedScenario?.companyName ??
                    "Reactive Systems Test Company",
                ticker: args.recordedScenario?.ticker ?? "RXT",
                exchange: "NASDAQ",
                websiteUrl:
                    args.recordedScenario?.websiteUrl ?? "https://example.com/",
            },
            coveragePreset: "balanced",
            researchAngle:
                args.recordedScenario?.researchAngle ??
                "Reactive source review verification",
            lifecycleState: "discovering_sources",
            executionStatus: "running",
            executionGeneration: 1,
            nextEventSequence: 1,
            workflowVersion: 1,
            createdAt: now,
            updatedAt: now,
        });
        const corpusRevisionId = await ctx.db.insert("corpusRevisions", {
            runId,
            revision: 1,
            status: "draft",
            createdAt: now,
        });
        await ctx.db.patch(runId, { activeCorpusRevisionId: corpusRevisionId });
        await ctx.runMutation(internal.researchPlanning.createForRun, {
            runId,
            expectedExecutionGeneration: 1,
        });
        const sourceInputs = args.recordedScenario?.sources ?? [
            {
                canonicalUrl: "https://example.com/e2e/annual-report",
                title: "Annual report",
                origin: "analyst_url" as const,
                category: "analyst_supplied",
            },
            {
                canonicalUrl: "https://example.com/e2e/product-architecture",
                title: "Product architecture overview",
                origin: "analyst_url" as const,
                category: "analyst_supplied",
            },
            {
                canonicalUrl:
                    "https://www.morningstar.com/stocks/opaque-e2e-analysis",
                title: "Reactive Systems Test Company analysis",
                origin: "exa" as const,
                category: "counter_evidence",
            },
        ];
        if (args.recoveryScenario) {
            sourceInputs[0] = {
                canonicalUrl: "https://example.com/docs/platform.html",
                title: "Official product documentation",
                origin: "exa",
                category: "official_product",
            };
            for (
                let index = sourceInputs.length;
                index < sourceCandidateLimit();
                index += 1
            )
                sourceInputs.push({
                    canonicalUrl: `https://example.com/e2e/reference-${index}`,
                    title: `Fixture reference ${index}`,
                    origin: "exa",
                    category: "official_product",
                });
        }
        const sourceIds = [];
        for (const [index, source] of sourceInputs.entries()) {
            const sourceId = await ctx.db.insert("sources", {
                runId,
                canonicalUrl: source.canonicalUrl,
                title: source.title,
                origin: source.origin,
                category: source.category,
                secForm: "secForm" in source ? source.secForm : undefined,
                providerReference: `e2e:${fixtureKey}:${index}`,
                createdAt: now + index,
            });
            sourceIds.push(sourceId);
        }
        const proposal: {
            proposalId: Id<"sourceSelectionProposals">;
            version: number;
        } = await ctx.runMutation(
            internal.sourceSelectionProposals.generateForRun,
            { runId, expectedExecutionGeneration: 1 },
        );
        if (args.recoveryScenario)
            await ctx.db.patch(proposal.proposalId, {
                rebuildOutcome: "partial",
                failedDiscoveryFamilies: ["official_product"],
            });
        if (args.legacySelectionReasons) {
            const items = await ctx.db
                .query("sourceSelectionProposalItems")
                .withIndex("by_proposal_and_rank_and_source", (q) =>
                    q.eq("proposalId", proposal.proposalId),
                )
                .take(sourceIds.length);
            for (const item of items)
                await ctx.db.patch(item._id, { selectionRationale: undefined });
        }
        const workflowId = await workflow.start(
            ctx,
            internal.e2eFixtures.sourceReviewWorkflow,
            { runId },
        );
        await ctx.db.patch(runId, { workflowId });
        await ctx.runMutation(internal.researchRuns.transition, {
            runId,
            expectedExecutionGeneration: 1,
            lifecycleState: "awaiting_source_review",
            executionStatus: "paused",
            stepKey: "source_review",
        });
        return {
            runId,
            corpusRevisionId,
            proposalId: proposal.proposalId,
            proposalVersion: proposal.version,
            sourceIds,
        };
    },
});

export const inspectSourceReviewScenario = internalQuery({
    args: {
        runId: v.id("researchRuns"),
        fixtureKey: v.string(),
    },
    returns: v.object({
        preparationEnabled: v.boolean(),
        lifecycleState: v.string(),
        executionStatus: v.string(),
        revisionStatus: v.string(),
        decisions: v.array(
            v.object({
                title: v.string(),
                decision: v.union(
                    v.literal("accepted"),
                    v.literal("pending"),
                    v.literal("rejected"),
                ),
            }),
        ),
        providerCallCount: v.number(),
        preparation: v.optional(
            v.object({
                preparationId: v.id("sourceSelectionProposalRebuilds"),
                executionGeneration: v.number(),
                deadlineAt: v.optional(v.number()),
            }),
        ),
        sourceReading: v.optional(
            v.object({
                sourceId: v.id("sources"),
                sourceCaptureId: v.id("sourceCaptures"),
                qualificationTaskId: v.id("aiTaskResults"),
                comparisonOutcome: v.optional(
                    v.union(
                        ...SOURCE_COMPARISON_DISPOSITIONS.map((value) =>
                            v.literal(value),
                        ),
                    ),
                ),
                contentHash: v.optional(v.string()),
                storageId: v.optional(v.id("_storage")),
                materializedVersion: v.optional(
                    v.object({
                        sourceVersionId: v.id("sourceVersions"),
                        contentHash: v.string(),
                        storageId: v.id("_storage"),
                        passageCount: v.number(),
                    }),
                ),
            }),
        ),
    }),
    handler: async (ctx, args) => {
        if (env.E2E_FIXTURES_ENABLED !== "true") {
            throw new Error("E2E fixtures are disabled");
        }
        const reservationKey = `e2e:${args.fixtureKey.trim()}`;
        const run = await ctx.db.get(args.runId);
        if (
            !run?.activeCorpusRevisionId ||
            run.reservationKey !== reservationKey
        ) {
            throw new Error("E2E source review scenario not found");
        }
        const revision = await ctx.db.get(run.activeCorpusRevisionId);
        if (!revision) {
            throw new Error("E2E corpus revision not found");
        }
        const reviewItems = await ctx.db
            .query("sourceReviewItems")
            .withIndex("by_revision_and_queue", (query) =>
                query.eq("corpusRevisionId", revision._id),
            )
            .collect();
        const decisions = [];
        for (const item of reviewItems) {
            const source = await ctx.db.get(item.sourceId);
            if (!source) {
                throw new Error("E2E source not found");
            }
            decisions.push({ title: source.title, decision: item.decision });
        }
        const providerCalls = await ctx.db
            .query("providerCalls")
            .withIndex("by_run", (query) => query.eq("runId", run._id))
            .take(100);
        const capture = await ctx.db
            .query("sourceCaptures")
            .withIndex("by_capture_key", (q) =>
                q.eq("captureKey", `e2e:${run._id}:source-reading`),
            )
            .unique();
        const preparation = run.sourcePreparationId
            ? await ctx.db.get(run.sourcePreparationId)
            : null;
        const proposalItem =
            capture && revision.sourceSelectionProposalId
                ? await ctx.db
                      .query("sourceSelectionProposalItems")
                      .withIndex("by_proposal_and_source", (q) =>
                          q
                              .eq(
                                  "proposalId",
                                  revision.sourceSelectionProposalId as Id<"sourceSelectionProposals">,
                              )
                              .eq("sourceId", capture.sourceId),
                      )
                      .unique()
                : null;
        const pinned = proposalItem
            ? await readPinnedSourceQualification(ctx.db, proposalItem)
            : null;
        const comparisonTasks = await Promise.all(
            (proposalItem?.comparisonTaskIds ?? []).map((id) => ctx.db.get(id)),
        );
        const fixtureComparison = comparisonTasks.find(
            (task) =>
                task?.executionMode === "showcase" &&
                task.adapterVersion === "e2e-illustrative-comparison-v1" &&
                task.output.kind === "source_comparison",
        );
        const comparisonOutcome =
            fixtureComparison?.output.kind === "source_comparison"
                ? fixtureComparison.output.findings[0]?.disposition
                : undefined;
        const versions = capture
            ? await ctx.db
                  .query("sourceVersions")
                  .withIndex("by_revision_and_source", (q) =>
                      q
                          .eq("corpusRevisionId", revision._id)
                          .eq("sourceId", capture.sourceId),
                  )
                  .order("desc")
                  .take(2)
            : [];
        const version = versions.find(
            (item) =>
                item.runId === run._id && item.sourceCaptureId === capture?._id,
        );
        const passages = version
            ? await ctx.db
                  .query("sourcePassages")
                  .withIndex("by_source_version_and_order", (q) =>
                      q.eq("sourceVersionId", version._id),
                  )
                  .take(MAX_PASSAGES_PER_SOURCE + 1)
            : [];
        return {
            preparationEnabled: sourcePreparationEnabled(),
            lifecycleState: run.lifecycleState,
            executionStatus: run.executionStatus,
            revisionStatus: revision.status,
            decisions,
            providerCallCount: providerCalls.length,
            ...(preparation
                ? {
                      preparation: {
                          preparationId: preparation._id,
                          executionGeneration: preparation.executionGeneration,
                          deadlineAt: preparation.deadlineAt,
                      },
                  }
                : {}),
            ...(pinned && capture
                ? {
                      sourceReading: {
                          sourceId: capture.sourceId,
                          sourceCaptureId: pinned.sourceCaptureId,
                          qualificationTaskId: pinned.qualificationTaskId,
                          ...(comparisonOutcome ? { comparisonOutcome } : {}),
                          contentHash: capture.contentHash,
                          storageId: capture.storageId,
                          ...(version
                              ? {
                                    materializedVersion: {
                                        sourceVersionId: version._id,
                                        contentHash: version.contentHash,
                                        storageId: version.storageId,
                                        passageCount: passages.length,
                                    },
                                }
                              : {}),
                      },
                  }
                : {}),
        };
    },
});

type InternalQueryRef = FunctionReference<"query", "internal">;
type InternalMutationRef = FunctionReference<"mutation", "internal">;

const evidenceWorkflowRun = makeFunctionReference(
    "evidenceWorkflow:run",
) as unknown as InternalMutationRef;
const evidenceWorkflowOnComplete = makeFunctionReference(
    "evidenceWorkflow:onComplete",
) as unknown as InternalMutationRef;
const getNormalizedClaimInputRef = makeFunctionReference(
    "claimGeneration:getNormalizedClaimInput",
) as unknown as InternalQueryRef;
const registerFixtureManifestEntryRef = makeFunctionReference(
    "fixtureManifestStore:registerFixtureManifestEntry",
) as unknown as InternalMutationRef;
const commitEvidenceMatrixSeedRef = makeFunctionReference(
    "e2eFixtures:commitEvidenceMatrixSeed",
) as unknown as InternalMutationRef;

// The single committed normalized artifact for the evidence-matrix fixture.
const FIXTURE_PASSAGES = [
    "CCC connects approximately 30,000 repair facilities and 300+ insurance carriers across its workflow network.",
    "The company processes over 28 million auto physical damage claims annually.",
    "OEM direct vehicle telematics could bypass traditional estimating network intermediaries.",
    "Adoption velocity of third-party multi-modal foundation models versus proprietary estimating logic remains undetermined.",
];
const FIXTURE_ARTIFACT_TEXT = FIXTURE_PASSAGES.join("\n\n");
const SOURCE_READING_FIXTURE_TEXT =
    "# Illustrative source\n\nThe author argues that agents could change the economics of workflow software at Reactive Systems Test Company. This is illustrative material for interface verification.";
const SOURCE_COMPARISON_FIXTURE_TEXT = [
    "# Illustrative source comparison",
    "The author argues that Reactive Systems Test Company has no outstanding borrowing and can therefore fund its strategy without borrowing costs. This is illustrative material for interface verification.",
    "The author argues that agents could change the economics of workflow software at Reactive Systems Test Company. This is a separate illustrative argument for interface verification.",
].join("\n\n");

function assertSourceReadingFixtureReplay(
    actual: string | undefined,
    requested: string | undefined,
) {
    if (actual !== requested)
        throw new Error("E2E reading scenario replay mismatch");
}

function sourceComparisonFixturePrimaryText(
    outcome: "no_conflict_observed" | "possible_conflict",
) {
    return [
        outcome === "possible_conflict"
            ? "Reactive Systems Test Company reports outstanding borrowing. This is illustrative evidence for interface verification."
            : "Reactive Systems Test Company reports no outstanding borrowing. This is illustrative evidence for interface verification.",
        "Reactive Systems Test Company describes agents as an opportunity to change the economics of workflow software. This is illustrative evidence for interface verification.",
    ].join("\n\n");
}

async function findSeededRun(
    ctx: MutationCtx,
    visitorId: Id<"visitors">,
    fixtureKey: string,
    scenarioKind: "showcase" | "unavailable",
): Promise<{
    runId: Id<"researchRuns">;
    sourceIds: Array<Id<"sources">>;
    executionGeneration: number;
    scenarioKind: "showcase" | "unavailable";
} | null> {
    const oppositeKind =
        scenarioKind === "showcase" ? "unavailable" : "showcase";
    const oppositeReservationKey = `e2e:${fixtureKey}:${oppositeKind}`;
    const oppositeRun = await ctx.db
        .query("researchRuns")
        .withIndex("by_owner_and_reservation_key", (query) =>
            query
                .eq("ownerVisitorId", visitorId)
                .eq("reservationKey", oppositeReservationKey),
        )
        .unique();
    if (oppositeRun) {
        throw new Error(
            `Conflicting E2E scenario kind replay mismatch for fixture key "${fixtureKey}"`,
        );
    }

    const sameReservationKey = `e2e:${fixtureKey}:${scenarioKind}`;
    const existing = await ctx.db
        .query("researchRuns")
        .withIndex("by_owner_and_reservation_key", (query) =>
            query
                .eq("ownerVisitorId", visitorId)
                .eq("reservationKey", sameReservationKey),
        )
        .unique();
    if (!existing?.activeCorpusRevisionId) {
        return null;
    }
    const statuses = await ctx.db
        .query("evidenceSourceStatuses")
        .withIndex("by_run_and_execution_generation", (query) =>
            query
                .eq("runId", existing._id)
                .eq("executionGeneration", existing.executionGeneration),
        )
        .take(50);
    if (statuses.length === 0) {
        return null;
    }
    return {
        runId: existing._id,
        sourceIds: statuses.map((status) => status.sourceId),
        executionGeneration: existing.executionGeneration,
        scenarioKind,
    };
}

export type EvidenceMatrixSeedPipelineDependencies = {
    storeBlob: (blob: Blob) => Promise<Id<"_storage">>;
    deleteBlob: (storageId: Id<"_storage">) => Promise<void>;
    commitSeed: (args: {
        slotKey: string;
        fixtureKey: string;
        scenarioKind: "showcase" | "unavailable";
        storageId: Id<"_storage">;
        contentHash: string;
        byteCount: number;
    }) => Promise<{
        runId: Id<"researchRuns">;
        corpusRevisionId: Id<"corpusRevisions">;
        sourceIds: Array<Id<"sources">>;
        scenarioKind: "showcase" | "unavailable";
        executionGeneration: number;
        reused: boolean;
    }>;
};

export async function executeEvidenceMatrixSeedPipeline(
    args: {
        slotKey: string;
        fixtureKey: string;
        scenarioKind: "showcase" | "unavailable";
    },
    deps: EvidenceMatrixSeedPipelineDependencies,
): Promise<{
    runId: Id<"researchRuns">;
    corpusRevisionId: Id<"corpusRevisions">;
    sourceIds: Array<Id<"sources">>;
    scenarioKind: "showcase" | "unavailable";
    executionGeneration: number;
}> {
    const slotKey = args.slotKey.trim();
    const fixtureKey = args.fixtureKey.trim();
    if (!slotKey || !fixtureKey || fixtureKey.length > 80) {
        throw new Error("Invalid E2E fixture identifier");
    }
    const result = await storeFixtureArtifact(FIXTURE_ARTIFACT_TEXT, {
        storeBlob: deps.storeBlob,
        deleteBlob: deps.deleteBlob,
        commitSeed: (artifact) =>
            deps.commitSeed({
                slotKey,
                fixtureKey,
                scenarioKind: args.scenarioKind,
                ...artifact,
            }),
    });
    return {
        runId: result.runId,
        corpusRevisionId: result.corpusRevisionId,
        sourceIds: result.sourceIds,
        scenarioKind: result.scenarioKind,
        executionGeneration: result.executionGeneration,
    };
}

async function storeFixtureArtifact<Result extends { reused: boolean }>(
    content: string,
    deps: Pick<
        EvidenceMatrixSeedPipelineDependencies,
        "storeBlob" | "deleteBlob"
    > & {
        commitSeed: (
            artifact: Pick<
                Parameters<
                    EvidenceMatrixSeedPipelineDependencies["commitSeed"]
                >[0],
                "storageId" | "contentHash" | "byteCount"
            >,
        ) => Promise<Result>;
    },
): Promise<Result> {
    const contentHash = sha256Hex(content);
    const byteCount = new TextEncoder().encode(content).length;
    const storageId = await deps.storeBlob(
        new Blob([content], { type: "text/plain; charset=utf-8" }),
    );
    try {
        const result = await deps.commitSeed({
            storageId,
            contentHash,
            byteCount,
        });
        if (result.reused) {
            try {
                await deps.deleteBlob(storageId);
            } catch (cleanupError) {
                const message =
                    cleanupError instanceof Error
                        ? cleanupError.message
                        : String(cleanupError);
                throw new Error(
                    `Failed to clean up duplicate storage blob on scenario reuse: ${message}`,
                );
            }
        }
        return result;
    } catch (error) {
        let cleanupFailure: unknown = null;
        try {
            await deps.deleteBlob(storageId);
        } catch (cleanupError) {
            cleanupFailure = cleanupError;
        }
        if (cleanupFailure) {
            const cleanupMessage =
                cleanupFailure instanceof Error
                    ? cleanupFailure.message
                    : String(cleanupFailure);
            if (error instanceof Error) {
                Object.defineProperty(error, "cleanupError", {
                    value: cleanupMessage,
                    enumerable: true,
                    configurable: true,
                });
            }
        }
        throw error;
    }
}

/** Seeds a labelled reading in the existing protected source-review fixture. */
export const seedInspectedSourceReviewScenario = internalAction({
    args: {
        slotKey: v.string(),
        fixtureKey: v.string(),
        comparisonOutcome: v.optional(
            v.union(
                v.literal("no_conflict_observed"),
                v.literal("possible_conflict"),
            ),
        ),
    },
    returns: sourceReviewFixtureResultValidator,
    handler: async (ctx, args): Promise<SourceReviewFixtureResult> => {
        if (env.E2E_FIXTURES_ENABLED !== "true")
            throw new Error("E2E fixtures are disabled");
        const base = await ctx.runMutation(
            internal.e2eFixtures.seedSourceReviewScenario,
            { slotKey: args.slotKey, fixtureKey: args.fixtureKey },
        );
        const existing = await ctx.runQuery(
            internal.e2eFixtures.inspectSourceReviewScenario,
            {
                runId: base.runId,
                fixtureKey: args.fixtureKey,
            },
        );
        if (existing.sourceReading) {
            assertSourceReadingFixtureReplay(
                existing.sourceReading.comparisonOutcome,
                args.comparisonOutcome,
            );
            return base;
        }
        const storage = {
            storeBlob: (blob: Blob) => ctx.storage.store(blob),
            deleteBlob: (storageId: Id<"_storage">) =>
                ctx.storage.delete(storageId),
        };
        const commit = (artifact: {
            storageId: Id<"_storage">;
            contentHash: string;
            byteCount: number;
        }) => {
            const comparisonOutcome = args.comparisonOutcome;
            const baseInput = {
                runId: base.runId,
                fixtureKey: args.fixtureKey,
                ...artifact,
            };
            return comparisonOutcome
                ? storeFixtureArtifact(
                      sourceComparisonFixturePrimaryText(comparisonOutcome),
                      {
                          ...storage,
                          commitSeed: (primary) =>
                              ctx.runMutation(
                                  internal.e2eFixtures
                                      .commitSourceReadingFixture,
                                  {
                                      ...baseInput,
                                      comparison: {
                                          outcome: comparisonOutcome,
                                          ...primary,
                                      },
                                  },
                              ),
                      },
                  )
                : ctx.runMutation(
                      internal.e2eFixtures.commitSourceReadingFixture,
                      baseInput,
                  );
        };
        const result = await storeFixtureArtifact(
            args.comparisonOutcome
                ? SOURCE_COMPARISON_FIXTURE_TEXT
                : SOURCE_READING_FIXTURE_TEXT,
            { ...storage, commitSeed: commit },
        );
        return {
            runId: result.runId,
            corpusRevisionId: result.corpusRevisionId,
            proposalId: result.proposalId,
            proposalVersion: result.proposalVersion,
            sourceIds: result.sourceIds,
        };
    },
});

export const commitSourceReadingFixture = internalMutation({
    args: {
        runId: v.id("researchRuns"),
        fixtureKey: v.string(),
        storageId: v.id("_storage"),
        contentHash: v.string(),
        byteCount: v.number(),
        comparison: v.optional(
            v.object({
                outcome: v.union(
                    v.literal("no_conflict_observed"),
                    v.literal("possible_conflict"),
                ),
                storageId: v.id("_storage"),
                contentHash: v.string(),
                byteCount: v.number(),
            }),
        ),
    },
    returns: v.object({
        ...sourceReviewFixtureResultValidator.fields,
        reused: v.boolean(),
    }),
    handler: async (
        ctx,
        args,
    ): Promise<SourceReviewFixtureResult & { reused: boolean }> => {
        if (env.E2E_FIXTURES_ENABLED !== "true")
            throw new Error("E2E fixtures are disabled");
        const existing = await ctx.runQuery(
            internal.e2eFixtures.inspectSourceReviewScenario,
            {
                runId: args.runId,
                fixtureKey: args.fixtureKey,
            },
        );
        const run = await ctx.db.get(args.runId);
        const revision = run?.activeCorpusRevisionId
            ? await ctx.db.get(run.activeCorpusRevisionId)
            : null;
        const proposal = revision?.sourceSelectionProposalId
            ? await ctx.db.get(revision.sourceSelectionProposalId)
            : null;
        if (
            !run ||
            !revision ||
            !proposal ||
            run.companySnapshot?.cik !== `e2e-${args.fixtureKey.trim()}`
        )
            throw new Error("E2E source review scenario not found");
        const sources = await ctx.db
            .query("sources")
            .withIndex("by_run_and_url", (q) => q.eq("runId", run._id))
            .take(4);
        const source = sources[0];
        if (!source || sources.length !== 3)
            throw new Error("E2E source collection changed");
        const result = {
            runId: run._id,
            corpusRevisionId: revision._id,
            sourceIds: sources.map((item) => item._id),
        };
        if (existing.sourceReading) {
            assertSourceReadingFixtureReplay(
                existing.sourceReading.comparisonOutcome,
                args.comparison?.outcome,
            );
            return {
                ...result,
                proposalId: proposal._id,
                proposalVersion: proposal.version,
                reused: true,
            };
        }
        if (
            revision.status !== "draft" ||
            run.sourcePreparationId ||
            run.executionGeneration !== 1 ||
            run.lifecycleState !== "awaiting_source_review" ||
            run.executionStatus !== "paused"
        )
            throw new Error("E2E reading fixture is no longer editable");
        const fixtureText = args.comparison
            ? SOURCE_COMPARISON_FIXTURE_TEXT
            : SOURCE_READING_FIXTURE_TEXT;
        const artifact = await ctx.db.system.get("_storage", args.storageId);
        if (
            !artifact ||
            artifact.size !== args.byteCount ||
            args.byteCount !== new TextEncoder().encode(fixtureText).length ||
            args.contentHash !== sha256Hex(fixtureText)
        )
            throw new Error("E2E reading artifact does not match the fixture");
        if (args.comparison) {
            const primaryText = sourceComparisonFixturePrimaryText(
                args.comparison.outcome,
            );
            const primaryArtifact = await ctx.db.system.get(
                "_storage",
                args.comparison.storageId,
            );
            if (
                !primaryArtifact ||
                primaryArtifact.size !== args.comparison.byteCount ||
                args.comparison.byteCount !==
                    new TextEncoder().encode(primaryText).length ||
                args.comparison.contentHash !== sha256Hex(primaryText)
            )
                throw new Error(
                    "E2E primary artifact does not match the fixture",
                );
        }
        const now = Date.now();
        const title = "Illustrative workflow argument";
        const researchAngle = "Illustrative source preparation";
        await ctx.db.patch(source._id, { title });
        await ctx.db.patch(run._id, {
            lifecycleState: "discovering_sources",
            executionStatus: "running",
            researchAngle,
        });
        const preparationId = await ctx.runMutation(
            internal.sourcePreparation.claimForDiscovery,
            {
                runId: run._id,
                corpusRevisionId: revision._id,
                expectedExecutionGeneration: 1,
            },
        );
        const preparation = await ctx.db.get(preparationId);
        if (!preparation) throw new Error("E2E preparation was not created");
        const prepared = prepareQualificationInput({
            company: run.companySnapshot,
            canonicalUrl: source.canonicalUrl,
            title,
            asOfTime: preparation.createdAt,
            text: fixtureText,
            researchAngle,
            retrievalCompleteness: "partial",
        });
        if (prepared.request.document.contentHash !== args.contentHash)
            throw new Error("E2E reading normalization changed");
        const readingPassages = prepared.request.document.passages.filter(
            (item) => item.text.startsWith("The author argues that"),
        );
        const passage = readingPassages[0];
        if (!passage) throw new Error("E2E reading passage is unavailable");
        const quotation = {
            passageKey: passage.passageKey,
            quotation: passage.text,
        };
        const sourceCaptureId = await ctx.db.insert("sourceCaptures", {
            runId: run._id,
            corpusRevisionId: revision._id,
            sourceId: source._id,
            preparationId,
            executionGeneration: 1,
            captureKey: `e2e:${run._id}:source-reading`,
            requestInputHash: sha256Hex(`e2e:${run._id}:source-reading`),
            status: "committed",
            requestedUrl: source.canonicalUrl,
            resolvedUrl: source.canonicalUrl,
            storageId: args.storageId,
            contentHash: args.contentHash,
            byteCount: args.byteCount,
            mediaType: "text/plain",
            normalizerVersion: prepared.normalizerVersion,
            retrievalVersion: "e2e-illustrative-source-v1",
            readingCompleteness: "partial",
            omittedPassageCount: 0,
            createdAt: now,
            updatedAt: now,
        });
        const taskId = await ctx.db.insert("aiTaskResults", {
            runId: run._id,
            corpusRevisionId: revision._id,
            sourceId: source._id,
            sourceCaptureId,
            taskType: "source_qualification",
            executionMode: "showcase",
            schemaVersion: SOURCE_QUALIFICATION_VERSION,
            adapterVersion: "e2e-illustrative-source-v1",
            inputHash: prepared.inputHash,
            createdAt: now,
            output: {
                kind: "source_qualification",
                sourceCaptureId,
                contentHash: args.contentHash,
                readingCompleteness: "partial",
                omittedPassageCount: 0,
                selectedPassages: prepared.request.document.passages.map(
                    ({ passageKey, startOffset, endOffset }) => ({
                        passageKey,
                        startOffset,
                        endOffset,
                    }),
                ),
                qualification: {
                    companyMatch: "subject",
                    companyPassages: [quotation],
                    documentKind: "independent_analysis",
                    reportingPeriodEnd: null,
                    reportingPeriodPassages: [],
                    findings: readingPassages.map((item, index) => ({
                        role:
                            index === 0
                                ? ("counter_evidence_primary" as const)
                                : ("independent_analysis_primary" as const),
                        kind: "attributed_argument" as const,
                        summary: item.text,
                        passages: [
                            {
                                passageKey: item.passageKey,
                                quotation: item.text,
                            },
                        ],
                        period: "unspecified" as const,
                        periodPassages: [],
                        dependsOnFlaggedAssertion: false,
                    })),
                    limitations: [
                        {
                            code: "partial_reading",
                            explanation:
                                "Illustrative partial reading for interface verification.",
                            passages: [],
                        },
                    ],
                },
            },
        });
        if (args.comparison) {
            const primarySource = sources[1];
            if (!primarySource)
                throw new Error("E2E primary source is unavailable");
            const primaryText = sourceComparisonFixturePrimaryText(
                args.comparison.outcome,
            );
            const primaryTitle = "Illustrative primary company report";
            await ctx.db.patch(primarySource._id, {
                title: primaryTitle,
                origin: "exa",
                category: "official_product",
            });
            const primaryCaptureId = await ctx.db.insert("sourceCaptures", {
                runId: run._id,
                corpusRevisionId: revision._id,
                sourceId: primarySource._id,
                preparationId,
                executionGeneration: 1,
                captureKey: `e2e:${run._id}:source-reading-primary`,
                requestInputHash: sha256Hex(
                    `e2e:${run._id}:source-reading-primary`,
                ),
                status: "committed",
                requestedUrl: primarySource.canonicalUrl,
                resolvedUrl: primarySource.canonicalUrl,
                storageId: args.comparison.storageId,
                contentHash: args.comparison.contentHash,
                byteCount: args.comparison.byteCount,
                mediaType: "text/plain",
                normalizerVersion: prepared.normalizerVersion,
                retrievalVersion: "e2e-illustrative-source-v1",
                readingCompleteness: "complete",
                omittedPassageCount: 0,
                createdAt: now,
                updatedAt: now,
            });
            const targetTask = await ctx.db.get(taskId);
            if (targetTask?.output.kind !== "source_qualification")
                throw new Error("E2E qualification is unavailable");
            const comparisonInput = prepareSourceComparisonInput({
                company: run.companySnapshot,
                target: {
                    runId: run._id,
                    corpusRevisionId: revision._id,
                    sourceId: source._id,
                    captureId: sourceCaptureId,
                    contentHash: args.contentHash,
                    qualificationTaskId: taskId,
                    title,
                    canonicalUrl: source.canonicalUrl,
                    text: fixtureText,
                    selectedPassages: targetTask.output.selectedPassages,
                    qualification: targetTask.output.qualification,
                },
                primaryCandidates: [
                    {
                        sourceId: primarySource._id,
                        captureId: primaryCaptureId,
                        contentHash: args.comparison.contentHash,
                        title: primaryTitle,
                        canonicalUrl: primarySource.canonicalUrl,
                        authorityTier: "company_primary",
                        documentKind: "official_product_documentation",
                        reportingPeriodEnd: null,
                        text: primaryText,
                        passages: extractPassagesFromNormalizedText({
                            text: primaryText,
                            canonicalUrl: primarySource.canonicalUrl,
                            sourceVersionHash: args.comparison.contentHash,
                        }).map((item) => ({
                            passageKey: `p${item.order}`,
                            quotation: item.exactQuotation,
                            startOffset: item.locator.startOffset ?? 0,
                            endOffset: item.locator.endOffset ?? 0,
                            headingPath: item.headingPath ?? [],
                        })),
                    },
                ],
            });
            const response = {
                findings: comparisonInput.request.findings.map((finding) => {
                    const reference =
                        comparisonInput.request.primaryPassages.find(
                            (item) =>
                                finding.primaryPassageKeys.includes(
                                    item.referenceKey,
                                ) &&
                                item.quotation.includes(
                                    finding.findingIndex === 0
                                        ? "outstanding borrowing"
                                        : "describes agents",
                                ),
                        );
                    if (!reference)
                        throw new Error(
                            "E2E comparison context is unavailable",
                        );
                    return {
                        findingIndex: finding.findingIndex,
                        disposition:
                            finding.findingIndex === 0
                                ? args.comparison?.outcome
                                : "no_conflict_observed",
                        explanation:
                            finding.findingIndex === 0 &&
                            args.comparison?.outcome === "possible_conflict"
                                ? "The illustrative report records borrowing, which conflicts with the premise in this passage."
                                : "The illustrative report addresses the same premise within the compared passages.",
                        comparableDimensions: [
                            "entity",
                            "concept",
                            "period",
                            "unit_basis",
                            "argument_effect",
                        ],
                        targetPassageKeys: finding.targetPassages.map(
                            (item) => item.referenceKey,
                        ),
                        primaryPassageKeys: [reference.referenceKey],
                    };
                }),
            };
            const comparison = materializeSourceComparisonOutput(
                comparisonInput,
                response,
            );
            if (comparison.status !== "valid")
                throw new Error("E2E comparison result is invalid");
            await ctx.db.insert("aiTaskResults", {
                runId: run._id,
                corpusRevisionId: revision._id,
                sourceId: source._id,
                sourceCaptureId,
                taskType: "source_comparison",
                executionMode: "showcase",
                schemaVersion: SOURCE_COMPARISON_VERSION,
                adapterVersion: "e2e-illustrative-comparison-v1",
                inputHash: comparisonInput.inputHash,
                output: comparison.output,
                createdAt: now,
            });
        }
        for (const item of sources)
            await ctx.runMutation(internal.sourcePreparation.recordResult, {
                preparationId,
                outcome: {
                    sourceId: item._id,
                    result:
                        item._id === source._id
                            ? { status: "qualified", sourceCaptureId, taskId }
                            : {
                                  status: "unavailable",
                                  reasonCode: "illustrative_source_not_read",
                              },
                },
            });
        const completed = await ctx.runMutation(
            internal.sourcePreparation.finish,
            {
                preparationId,
                expectedExecutionGeneration: 1,
            },
        );
        await ctx.runMutation(internal.researchRuns.transition, {
            runId: run._id,
            expectedExecutionGeneration: 1,
            lifecycleState: "awaiting_source_review",
            executionStatus: "paused",
            stepKey: "source_review",
        });
        return {
            ...result,
            proposalId: completed.proposalId,
            proposalVersion: completed.version,
            reused: false,
        };
    },
});

/**
 * Local-only E2E seed. Ownership derives exclusively from a claimed invitation
 * slot + bounded fixture key; visitor/auth IDs are never accepted. Showcase
 * seeds a real-looking artifact with exact passage hashes, registers the
 * deterministic durable CCC manifest, and starts the REAL evidence workflow
 * with terminal source statuses so retrieval dispatches zero I/O. Unavailable
 * seeds the same committed corpus but registers no manifest, so the workflow
 * pauses at claim_generation_unavailable with zero claims. No claim, policy,
 * lifecycle, or evidence_ready row is ever hand-inserted: those come only from
 * the production workflow.
 *
 * This is an internalAction only because Convex File Storage writes are
 * actions-only; all database seeding and the guarded workflow start run inside
 * the commitEvidenceMatrixSeed mutation in one transaction.
 */
export const seedEvidenceMatrixScenario = internalAction({
    args: {
        slotKey: v.string(),
        fixtureKey: v.string(),
        scenarioKind: v.union(v.literal("showcase"), v.literal("unavailable")),
    },
    returns: v.object({
        runId: v.id("researchRuns"),
        corpusRevisionId: v.id("corpusRevisions"),
        sourceIds: v.array(v.id("sources")),
        scenarioKind: v.union(v.literal("showcase"), v.literal("unavailable")),
        executionGeneration: v.number(),
    }),
    handler: async (ctx, args) => {
        if (env.E2E_FIXTURES_ENABLED !== "true") {
            throw new Error("E2E fixtures are disabled");
        }
        return executeEvidenceMatrixSeedPipeline(
            {
                slotKey: args.slotKey,
                fixtureKey: args.fixtureKey,
                scenarioKind: args.scenarioKind,
            },
            {
                storeBlob: (blob) => ctx.storage.store(blob),
                deleteBlob: (storageId) => ctx.storage.delete(storageId),
                commitSeed: async (commitArgs) =>
                    ctx.runMutation(commitEvidenceMatrixSeedRef, commitArgs),
            },
        );
    },
});

/**
 * Guarded mutation that seeds all evidence-matrix fixture rows and starts the
 * real Phase 5 workflow. Never accepts visitor/auth IDs; ownership is derived
 * exclusively from the claimed invitation slot + bounded fixture key.
 */
export const commitEvidenceMatrixSeed = internalMutation({
    args: {
        slotKey: v.string(),
        fixtureKey: v.string(),
        scenarioKind: v.union(v.literal("showcase"), v.literal("unavailable")),
        storageId: v.id("_storage"),
        contentHash: v.string(),
        byteCount: v.number(),
    },
    returns: v.object({
        runId: v.id("researchRuns"),
        corpusRevisionId: v.id("corpusRevisions"),
        sourceIds: v.array(v.id("sources")),
        scenarioKind: v.union(v.literal("showcase"), v.literal("unavailable")),
        executionGeneration: v.number(),
        reused: v.boolean(),
    }),
    handler: async (ctx, args) => {
        if (env.E2E_FIXTURES_ENABLED !== "true") {
            throw new Error("E2E fixtures are disabled");
        }
        const slotKey = args.slotKey.trim();
        const fixtureKey = args.fixtureKey.trim();
        if (!slotKey || !fixtureKey || fixtureKey.length > 80) {
            throw new Error("Invalid E2E fixture identifier");
        }
        const invitation = await ctx.db
            .query("invitations")
            .withIndex("by_slot_key", (query) => query.eq("slotKey", slotKey))
            .unique();
        if (
            invitation?.status !== "claimed" ||
            !invitation.claimedByVisitorId
        ) {
            throw new Error("Claimed E2E invitation not found");
        }
        const visitor = await ctx.db.get(invitation.claimedByVisitorId);
        if (
            visitor?.status !== "active" ||
            visitor.invitationId !== invitation._id
        ) {
            throw new Error("Active E2E visitor not found");
        }

        // Idempotent replay: same slot + fixture key returns the existing run
        // and never duplicates runs, artifacts, claims, events, or workflows.
        const seededRun = await findSeededRun(
            ctx,
            visitor._id,
            fixtureKey,
            args.scenarioKind,
        );
        if (seededRun) {
            return {
                runId: seededRun.runId,
                corpusRevisionId: (await ctx.db.get(seededRun.runId))
                    ?.activeCorpusRevisionId as Id<"corpusRevisions">,
                sourceIds: seededRun.sourceIds,
                scenarioKind: seededRun.scenarioKind,
                executionGeneration: seededRun.executionGeneration,
                reused: true,
            };
        }

        const now = Date.now();
        const reservationKey = `e2e:${fixtureKey}:${args.scenarioKind}`;
        const companyId = await ctx.db.insert("companies", {
            cik: `e2e-${fixtureKey}`,
            legalName: "CCC Intelligent Solutions Holdings Inc.",
            ticker: "CCCS",
            exchange: "NASDAQ",
            websiteUrl: "https://example.com/",
            canonicalizedAt: now,
        });
        const runId = await ctx.db.insert("researchRuns", {
            ownerVisitorId: visitor._id,
            reservationKey,
            reservationStatus: "consumed",
            companyId,
            companySnapshot: {
                cik: `e2e-${fixtureKey}`,
                legalName: "CCC Intelligent Solutions Holdings Inc.",
                ticker: "CCCS",
                exchange: "NASDAQ",
                websiteUrl: "https://example.com/",
            },
            coveragePreset: "balanced",
            lifecycleState: "extracting_evidence",
            executionStatus: "running",
            executionGeneration: 1,
            nextEventSequence: 1,
            workflowVersion: 2,
            createdAt: now,
            updatedAt: now,
        });
        const corpusRevisionId = await ctx.db.insert("corpusRevisions", {
            runId,
            revision: 1,
            status: "approved",
            approvedByVisitorId: visitor._id,
            approvedAt: now,
            createdAt: now,
        });
        await ctx.db.patch(runId, { activeCorpusRevisionId: corpusRevisionId });

        // Research plan + dimension questions (no research angle -> 10 keys).
        const planId = await ctx.db.insert("researchPlans", {
            runId,
            version: 2,
            coveragePreset: "balanced",
            queries: [],
            createdAt: now,
        });
        for (const dimensionKey of ASSESSMENT_DIMENSION_KEYS) {
            await ctx.db.insert("researchPlanQuestions", {
                runId,
                researchPlanId: planId,
                planVersion: 2,
                questionKey: `dimension:${dimensionKey}`,
                prompt: `What public evidence addresses ${dimensionKey} for CCC Intelligent Solutions Holdings Inc.?`,
                dimensionKeys: [dimensionKey],
                createdAt: now,
            });
        }

        const sourceId = await ctx.db.insert("sources", {
            runId,
            canonicalUrl: `https://fixture.example/${fixtureKey}/ccc-10k`,
            title: "CCC 10-K Annual Report",
            origin: "analyst_url",
            category: "analyst_supplied",
            providerReference: `e2e:${fixtureKey}`,
            createdAt: now,
        });
        const decisionId = await ctx.db.insert("sourceDecisions", {
            runId,
            corpusRevisionId,
            sourceId,
            decisionKey: `e2e:${fixtureKey}:accepted`,
            decision: "accepted",
            reviewerVisitorId: visitor._id,
            occurredAt: now,
        });
        await ctx.db.insert("sourceReviewItems", {
            runId,
            corpusRevisionId,
            sourceId,
            decision: "accepted",
            decisionRank: 0,
            sourceCreatedAt: now,
            latestDecisionId: decisionId,
            decisionOccurredAt: now,
        });
        const storedArtifact = args;
        const contentHash = storedArtifact.contentHash;
        const sourceVersionId = await ctx.db.insert("sourceVersions", {
            runId,
            corpusRevisionId,
            sourceId,
            acceptedDecisionId: decisionId,
            contentHash,
            normalizerVersion: "sec-html-v1",
            storageId: storedArtifact.storageId,
            mediaType: "text/html",
            byteCount: storedArtifact.byteCount,
            canonicalUrl: `https://fixture.example/${fixtureKey}/ccc-10k`,
            retrievalVersion: "sec-v1",
            executionGeneration: 1,
            createdAt: now,
        });
        await ctx.db.insert("evidenceSourceStatuses", {
            runId,
            corpusRevisionId,
            sourceId,
            sourceVersionId,
            acceptedDecisionId: decisionId,
            executionGeneration: 1,
            status: "succeeded",
            createdAt: now,
            updatedAt: now,
        });

        // Committed passages with exact quotation hashes and passage keys.
        let runningOffset = 0;
        for (let index = 0; index < FIXTURE_PASSAGES.length; index++) {
            const text = FIXTURE_PASSAGES[index];
            if (text === undefined) throw new Error("Fixture passage missing");
            const startOffset = FIXTURE_ARTIFACT_TEXT.indexOf(
                text,
                runningOffset,
            );
            runningOffset = startOffset + text.length;
            const locator = {
                kind: "web" as const,
                canonicalUrl: `https://fixture.example/${fixtureKey}/ccc-10k`,
                sourceVersionHash: contentHash,
                exactQuotation: text,
                startOffset,
                endOffset: startOffset + text.length,
                boundingText: text,
            };
            const quotationHash = sha256Hex(text);
            await ctx.db.insert("sourcePassages", {
                sourceVersionId,
                locatorVersion: "web-v1",
                passageKey: computePassageKey({
                    sourceId,
                    sourceVersionHash: contentHash,
                    locatorVersion: "web-v1",
                    locator,
                    order: index,
                    quotationHash,
                }),
                quotationHash,
                order: index,
                exactQuotation: text,
                locator,
                createdAt: now,
            });
        }

        // Proposal projection so the policy path has authorityTier/documentKind.
        const proposalId = await ctx.db.insert("sourceSelectionProposals", {
            runId,
            corpusRevisionId,
            version: 1,
            policyVersion: "source-selection-v6",
            coveragePreset: "balanced",
            recommendedTarget: 1,
            candidateFingerprint: `e2e:${fixtureKey}`,
            status: "ready",
            counts: { recommended: 1, needsAttention: 0, alternative: 0 },
            gaps: [],
            createdAt: now,
        });
        await ctx.db.insert("sourceSelectionProposalItems", {
            runId,
            corpusRevisionId,
            proposalId,
            sourceId,
            disposition: "recommended",
            sourceFamily: "analyst_supplied",
            documentKind: "regulatory_annual",
            authorityTier: "analyst_supplied",
            companyLinkageBasis: "structural",
            coverageContributions: ["regulatory_annual"],
            rank: 0,
            reasonCodes: ["added_by_analyst"],
            createdAt: now,
        });
        await ctx.db.patch(corpusRevisionId, {
            sourceSelectionProposalId: proposalId,
        });

        if (args.scenarioKind === "showcase") {
            // Compute the exact normalized claim input to register the CCC
            // manifest keyed by its durable input hash. Only showcase registers
            // a manifest; arbitrary non-manifest input stays unavailable.
            const normalized = await ctx.runQuery(getNormalizedClaimInputRef, {
                runId,
                executionGeneration: 1,
            });
            if (!normalized) {
                throw new Error("Showcase normalized claim input unavailable");
            }
            const manifest = buildCccShowcaseManifest(
                normalized.normalizedInput,
            );
            await ctx.runMutation(registerFixtureManifestEntryRef, {
                inputHash: manifest.inputHash,
                fixtureId: manifest.fixtureId,
                fixtureVersion: manifest.fixtureVersion,
                schemaVersion: manifest.schemaVersion,
                adapterVersion: manifest.adapterVersion,
                claims: manifest.claims,
            });
        }

        // Guarded fixture start: the REAL Phase 5 workflow. All source statuses
        // are already terminal, so retrieval fan-out dispatches zero branches;
        // claim generation, policy, and the strong evidence_ready handoff run
        // through the unmodified production code.
        const workflowId = await workflow.start(
            ctx,
            evidenceWorkflowRun,
            { runId, executionGeneration: 1 },
            {
                startAsync: true,
                onComplete: evidenceWorkflowOnComplete,
                context: { runId },
            },
        );
        await ctx.db.patch(runId, {
            workflowId,
            nextEventSequence: 2,
            updatedAt: now,
        });
        await ctx.db.insert("runEvents", {
            runId,
            sequence: 1,
            type: "corpus_revision_approved",
            lifecycleState: "extracting_evidence",
            executionStatus: "running",
            stepKey: "extract_evidence",
            occurredAt: now,
        });
        await ctx.db.insert("workflowSteps", {
            runId,
            key: "extract_evidence",
            state: "running",
            attempt: 1,
            startedAt: now,
            updatedAt: now,
        });
        return {
            runId,
            corpusRevisionId,
            sourceIds: [sourceId],
            scenarioKind: args.scenarioKind,
            executionGeneration: 1,
            reused: false,
        };
    },
});

/**
 * Bounded inspector. Only lifecycle/execution/runId/counts/showcase flag,
 * claim identity/statements, providerCallCount, workflowId presence. Never
 * returns secrets, raw bodies, or internal hashes. Requires an exact
 * reservationKey match and the local-only gate.
 */
export const inspectEvidenceMatrixScenario = internalQuery({
    args: {
        runId: v.id("researchRuns"),
        fixtureKey: v.string(),
    },
    returns: v.object({
        runId: v.id("researchRuns"),
        fixtureKey: v.string(),
        lifecycleState: v.string(),
        executionStatus: v.string(),
        pauseReason: v.optional(v.string()),
        showcase: v.boolean(),
        providerCallCount: v.number(),
        workflowIdPresent: v.boolean(),
        sourceCount: v.number(),
        passageCount: v.number(),
        claimCount: v.number(),
        claimIds: v.array(v.id("claims")),
        claimStatements: v.array(v.string()),
        policyEvaluationCount: v.number(),
    }),
    handler: async (ctx, args) => {
        if (env.E2E_FIXTURES_ENABLED !== "true") {
            throw new Error("E2E fixtures are disabled");
        }
        const fixtureKey = args.fixtureKey.trim();
        const expectedShowcaseKey = `e2e:${fixtureKey}:showcase`;
        const expectedUnavailableKey = `e2e:${fixtureKey}:unavailable`;
        const run = await ctx.db.get(args.runId);
        if (
            !run?.activeCorpusRevisionId ||
            (run.reservationKey !== expectedShowcaseKey &&
                run.reservationKey !== expectedUnavailableKey)
        ) {
            throw new Error("E2E evidence matrix scenario not found");
        }
        const nativeRun = await ctx.db.get(run._id);
        if (!nativeRun) throw new Error("E2E evidence matrix run not found");
        const corpusRevisionId = nativeRun.activeCorpusRevisionId;
        if (!corpusRevisionId) {
            throw new Error("E2E evidence matrix revision missing");
        }
        const providerCalls = await ctx.db
            .query("providerCalls")
            .withIndex("by_run", (query) => query.eq("runId", run._id))
            .take(100);
        const sourceVersions = await ctx.db
            .query("sourceVersions")
            .withIndex("by_run", (query) => query.eq("runId", run._id))
            .take(50);
        let passageCount = 0;
        for (const version of sourceVersions) {
            const passages = await ctx.db
                .query("sourcePassages")
                .withIndex("by_source_version_and_order", (query) =>
                    query.eq("sourceVersionId", version._id),
                )
                .take(50);
            passageCount += passages.length;
        }
        const claims = await ctx.db
            .query("claims")
            .withIndex("by_run_and_corpus", (query) =>
                query
                    .eq("runId", run._id)
                    .eq("corpusRevisionId", corpusRevisionId),
            )
            .take(130);
        const evaluations = await ctx.db
            .query("policyEvaluations")
            .withIndex("by_run_and_corpus_revision", (query) =>
                query
                    .eq("runId", run._id)
                    .eq("corpusRevisionId", corpusRevisionId),
            )
            .take(130);
        return {
            runId: run._id,
            fixtureKey: args.fixtureKey.trim(),
            lifecycleState: run.lifecycleState,
            executionStatus: run.executionStatus,
            ...(run.pauseReason ? { pauseReason: run.pauseReason } : {}),
            showcase: run.lifecycleState === "evidence_ready",
            providerCallCount: providerCalls.length,
            workflowIdPresent: run.workflowId !== undefined,
            sourceCount: sourceVersions.length,
            passageCount,
            claimCount: claims.length,
            claimIds: claims.map((claim) => claim._id),
            claimStatements: claims.map((claim) => claim.statement),
            policyEvaluationCount: evaluations.length,
        };
    },
});

const recordedReadingValidator = v.object({
    ...recordedSourceMetadata,
    storageId: v.id("_storage"),
    contentHash: v.string(),
    byteCount: v.number(),
    inputHash: v.string(),
    responseHash: v.string(),
    normalizerVersion: v.string(),
    readingCompleteness: v.union(v.literal("complete"), v.literal("partial")),
    omittedPassageCount: v.number(),
    selectedPassages: v.array(
        v.object({
            passageKey: v.string(),
            startOffset: v.number(),
            endOffset: v.number(),
        }),
    ),
    qualification: v.optional(sourceQualificationValidator),
    failureReason: v.optional(v.string()),
});

/** Reconstructs recorded qualifications against their exact original inputs, never against the new dossier angle. */
export const seedRecordedSourceReview = internalAction({
    args: {
        slotKey: v.string(),
        fixtureKey: v.string(),
        company: v.object({
            cik: v.string(),
            legalName: v.string(),
            ticker: v.string(),
        }),
        websiteUrl: v.string(),
        researchAngle: v.string(),
        sources: v.array(
            v.object({
                ...recordedSourceMetadata,
                text: v.string(),
                contentHash: v.string(),
                originalInputHash: v.string(),
                asOfTime: v.number(),
                originalResearchAngle: v.string(),
                responseJson: v.string(),
            }),
        ),
    },
    returns: sourceReviewFixtureResultValidator,
    handler: async (ctx, args): Promise<SourceReviewFixtureResult> => {
        if (
            env.E2E_FIXTURES_ENABLED !== "true" ||
            !["localhost", "127.0.0.1"].includes(
                new URL(env.CONVEX_CLOUD_URL).hostname,
            )
        )
            throw new Error("Local recorded fixtures are disabled");
        if (
            args.sources.length < 1 ||
            args.sources.length > 8 ||
            new TextEncoder().encode(JSON.stringify(args)).length >
                12 * 1024 * 1024
        )
            throw new Error("Recorded scenario exceeds fixture bounds");
        const prepared = args.sources.map((source) => {
            const input = prepareQualificationInput({
                company: args.company,
                canonicalUrl: source.canonicalUrl,
                title: source.title,
                asOfTime: source.asOfTime,
                researchAngle: source.originalResearchAngle,
                text: source.text,
            });
            if (
                sha256Hex(source.text) !== source.contentHash ||
                input.request.document.contentHash !== source.contentHash ||
                input.inputHash !== source.originalInputHash
            )
                throw new Error("Recorded qualification input changed");
            return {
                source,
                input,
                result: materializeQualificationOutput(
                    input,
                    JSON.parse(source.responseJson),
                ),
            };
        });
        const stored: Id<"_storage">[] = [];
        try {
            const readings: Infer<typeof recordedReadingValidator>[] = [];
            for (const { source, input, result } of prepared) {
                const storageId = await ctx.storage.store(
                    new Blob([source.text], { type: "text/plain" }),
                );
                stored.push(storageId);
                readings.push({
                    canonicalUrl: source.canonicalUrl,
                    title: source.title,
                    origin: source.origin,
                    category: source.category,
                    secForm: source.secForm,
                    storageId,
                    contentHash: source.contentHash,
                    byteCount: new TextEncoder().encode(source.text).length,
                    inputHash: input.inputHash,
                    responseHash: sha256Hex(source.responseJson),
                    normalizerVersion: input.normalizerVersion,
                    readingCompleteness: input.readingCompleteness,
                    omittedPassageCount: input.omittedPassageCount,
                    selectedPassages: input.request.document.passages.map(
                        ({ passageKey, startOffset, endOffset }) => ({
                            passageKey,
                            startOffset,
                            endOffset,
                        }),
                    ),
                    ...(result.status === "valid"
                        ? { qualification: result.qualification }
                        : { failureReason: result.reason }),
                });
            }
            const result = await ctx.runMutation(
                internal.e2eFixtures.commitRecordedSourceReview,
                {
                    slotKey: args.slotKey,
                    fixtureKey: args.fixtureKey,
                    companyName: `${args.company.legalName} · Recorded review`,
                    companyCik: args.company.cik,
                    ticker: args.company.ticker,
                    websiteUrl: args.websiteUrl,
                    researchAngle: args.researchAngle,
                    readings,
                },
            );
            if (result.reused)
                for (const id of stored) await ctx.storage.delete(id);
            return {
                runId: result.runId,
                corpusRevisionId: result.corpusRevisionId,
                proposalId: result.proposalId,
                proposalVersion: result.proposalVersion,
                sourceIds: result.sourceIds,
            };
        } catch (error) {
            for (const id of stored) await ctx.storage.delete(id);
            throw error;
        }
    },
});

export const commitRecordedSourceReview = internalMutation({
    args: {
        slotKey: v.string(),
        fixtureKey: v.string(),
        companyName: v.string(),
        companyCik: v.string(),
        ticker: v.string(),
        websiteUrl: v.string(),
        researchAngle: v.string(),
        readings: v.array(recordedReadingValidator),
    },
    returns: v.object({
        ...sourceReviewFixtureResultValidator.fields,
        reused: v.boolean(),
    }),
    handler: async (
        ctx,
        args,
    ): Promise<SourceReviewFixtureResult & { reused: boolean }> => {
        if (
            env.E2E_FIXTURES_ENABLED !== "true" ||
            !["localhost", "127.0.0.1"].includes(
                new URL(env.CONVEX_CLOUD_URL).hostname,
            ) ||
            args.readings.length < 1 ||
            args.readings.length > 8
        )
            throw new Error("Local recorded fixtures are disabled");
        const base = await ctx.runMutation(
            internal.e2eFixtures.seedSourceReviewScenario,
            {
                slotKey: args.slotKey,
                fixtureKey: args.fixtureKey,
                recordedScenario: {
                    companyName: args.companyName,
                    companyCik: args.companyCik,
                    ticker: args.ticker,
                    websiteUrl: args.websiteUrl,
                    researchAngle: args.researchAngle,
                    sources: args.readings.map(
                        ({
                            canonicalUrl,
                            title,
                            origin,
                            category,
                            secForm,
                        }) => ({
                            canonicalUrl,
                            title,
                            origin,
                            category,
                            secForm,
                        }),
                    ),
                },
            },
        );
        const run = await ctx.db.get(base.runId);
        const revision = await ctx.db.get(base.corpusRevisionId);
        if (!run?.ownerVisitorId || !revision)
            throw new Error("Recorded fixture is missing");
        // Recorded source previews must not invoke the local renderer or fetch a public page.
        const preview = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="300"><rect width="800" height="300" fill="#f4f4f4"/><text x="32" y="145" font-size="22">Recorded fixture. Open Source details to inspect passages.</text></svg>')}`;
        for (const sourceId of base.sourceIds)
            await ctx.runMutation(
                internal.browserPreviewInternals.storePreview,
                {
                    sourceId,
                    dataUrl: preview,
                    visitorId: run.ownerVisitorId,
                    sizeBytes: new TextEncoder().encode(preview).length,
                    expiresAt: Date.now() + 24 * 60 * 60 * 1000,
                },
            );
        if (run.sourcePreparationId) {
            const captures = await ctx.db
                .query("sourceCaptures")
                .withIndex("by_preparation_and_source", (q) =>
                    q.eq(
                        "preparationId",
                        run.sourcePreparationId as Id<"sourceSelectionProposalRebuilds">,
                    ),
                )
                .take(9);
            if (
                captures.length !== args.readings.length ||
                captures.some(
                    (capture) =>
                        !args.readings.some(
                            (reading) =>
                                reading.canonicalUrl === capture.requestedUrl &&
                                reading.contentHash === capture.contentHash &&
                                reading.inputHash ===
                                    capture.requestInputHash &&
                                capture.captureKey.endsWith(
                                    `:${reading.responseHash}`,
                                ),
                        ),
                )
            )
                throw new Error("Recorded fixture replay mismatch");
            return { ...base, reused: true };
        }
        if (revision.status !== "draft")
            throw new Error("Recorded fixture already approved");
        await ctx.db.patch(base.runId, {
            lifecycleState: "discovering_sources",
            executionStatus: "running",
        });
        const preparationId = await ctx.runMutation(
            internal.sourcePreparation.claimForDiscovery,
            {
                runId: base.runId,
                corpusRevisionId: base.corpusRevisionId,
                expectedExecutionGeneration: 1,
            },
        );
        const now = Date.now();
        for (const [index, reading] of args.readings.entries()) {
            const sourceId = base.sourceIds[index];
            if (!sourceId) throw new Error("Recorded source missing");
            const artifact = await ctx.db.system.get(
                "_storage",
                reading.storageId,
            );
            if (!artifact || artifact.size !== reading.byteCount)
                throw new Error("Recorded artifact missing");
            const sourceCaptureId = await ctx.db.insert("sourceCaptures", {
                runId: base.runId,
                corpusRevisionId: base.corpusRevisionId,
                sourceId,
                preparationId,
                executionGeneration: 1,
                captureKey: `recorded:${base.runId}:${index}:${reading.responseHash}`,
                requestInputHash: reading.inputHash,
                status: "committed",
                requestedUrl: reading.canonicalUrl,
                resolvedUrl: reading.canonicalUrl,
                storageId: reading.storageId,
                contentHash: reading.contentHash,
                byteCount: reading.byteCount,
                mediaType: "text/plain",
                normalizerVersion: reading.normalizerVersion,
                retrievalVersion: "recorded-utility-v1",
                readingCompleteness: reading.readingCompleteness,
                omittedPassageCount: reading.omittedPassageCount,
                createdAt: now,
                updatedAt: now,
            });
            const taskId = reading.qualification
                ? await ctx.db.insert("aiTaskResults", {
                      runId: base.runId,
                      corpusRevisionId: base.corpusRevisionId,
                      sourceId,
                      sourceCaptureId,
                      taskType: "source_qualification",
                      executionMode: "showcase",
                      schemaVersion: SOURCE_QUALIFICATION_VERSION,
                      adapterVersion: "recorded-utility-v1",
                      inputHash: reading.inputHash,
                      createdAt: now,
                      output: {
                          kind: "source_qualification",
                          sourceCaptureId,
                          contentHash: reading.contentHash,
                          readingCompleteness: reading.readingCompleteness,
                          omittedPassageCount: reading.omittedPassageCount,
                          selectedPassages: reading.selectedPassages,
                          qualification: reading.qualification,
                      },
                  })
                : undefined;
            await ctx.runMutation(internal.sourcePreparation.recordResult, {
                preparationId,
                outcome: {
                    sourceId,
                    result: taskId
                        ? { status: "qualified", sourceCaptureId, taskId }
                        : {
                              status: "unavailable",
                              sourceCaptureId,
                              reasonCode:
                                  reading.failureReason ??
                                  "recorded_qualification_unavailable",
                          },
                },
            });
        }
        const proposal = await ctx.runMutation(
            internal.sourcePreparation.finish,
            { preparationId, expectedExecutionGeneration: 1 },
        );
        await ctx.runMutation(internal.researchRuns.transition, {
            runId: base.runId,
            expectedExecutionGeneration: 1,
            lifecycleState: "awaiting_source_review",
            executionStatus: "paused",
            stepKey: "source_review",
        });
        return {
            ...base,
            proposalId: proposal.proposalId,
            proposalVersion: proposal.version,
            reused: false,
        };
    },
});

/** Bounded inspection of recorded review fixtures, including omissions rather than only selected sources. */
export const inspectRecordedSourceReview = internalQuery({
    args: { runId: v.id("researchRuns"), fixtureKey: v.string() },
    returns: v.object({
        sources: v.array(schema.doc("sources")),
        items: v.array(schema.doc("sourceSelectionProposalItems")),
        tasks: v.array(schema.doc("aiTaskResults")),
        providerCalls: v.number(),
        revisionStatus: v.string(),
    }),
    handler: async (ctx, args) => {
        if (
            env.E2E_FIXTURES_ENABLED !== "true" ||
            !["localhost", "127.0.0.1"].includes(
                new URL(env.CONVEX_CLOUD_URL).hostname,
            )
        )
            throw new Error("Local recorded fixtures are disabled");
        const run = await ctx.db.get(args.runId);
        if (
            !run?.activeCorpusRevisionId ||
            run.reservationKey !== `e2e:${args.fixtureKey}` ||
            !run.companySnapshot?.legalName.endsWith("· Recorded review")
        )
            throw new Error("Recorded fixture not found");
        const revision = await ctx.db.get(run.activeCorpusRevisionId);
        if (!revision?.sourceSelectionProposalId)
            throw new Error("Recorded proposal not found");
        return {
            sources: await ctx.db
                .query("sources")
                .withIndex("by_run_and_url", (q) => q.eq("runId", run._id))
                .take(8),
            items: await ctx.db
                .query("sourceSelectionProposalItems")
                .withIndex("by_proposal_and_rank_and_source", (q) =>
                    q.eq(
                        "proposalId",
                        revision.sourceSelectionProposalId as Id<"sourceSelectionProposals">,
                    ),
                )
                .take(8),
            tasks: await ctx.db
                .query("aiTaskResults")
                .withIndex("by_run", (q) => q.eq("runId", run._id))
                .take(8),
            providerCalls: (
                await ctx.db
                    .query("providerCalls")
                    .withIndex("by_run", (q) => q.eq("runId", run._id))
                    .take(1)
            ).length,
            revisionStatus: revision.status,
        };
    },
});

/** Stages a local-only interrupted manual reading that cannot reach any external provider. */
export const stageSourcePreparationRecoveryFixture = internalMutation({
    args: {
        runId: v.id("researchRuns"),
        fixtureKey: v.string(),
        slotKey: v.string(),
    },
    returns: sourceReviewFixtureResultValidator,
    handler: async (ctx, args) => {
        if (
            env.E2E_FIXTURES_ENABLED !== "true" ||
            !["127.0.0.1", "localhost"].includes(
                new URL(env.CONVEX_CLOUD_URL).hostname,
            )
        )
            throw new Error("Local recovery fixtures are disabled");
        const run = await ctx.db.get(args.runId);
        const invitation = await ctx.db
            .query("invitations")
            .withIndex("by_slot_key", (q) => q.eq("slotKey", args.slotKey))
            .unique();
        const revision = run?.activeCorpusRevisionId
            ? await ctx.db.get(run.activeCorpusRevisionId)
            : null;
        const preparation = run?.sourcePreparationId
            ? await ctx.db.get(run.sourcePreparationId)
            : null;
        if (
            !run ||
            run.reservationKey !== `e2e:${args.fixtureKey.trim()}` ||
            invitation?.status !== "claimed" ||
            invitation.claimedByVisitorId !== run.ownerVisitorId ||
            revision?.status !== "draft" ||
            run.executionStatus !== "paused" ||
            preparation?.kind !== "preparation"
        )
            throw new Error("Owned recovery fixture is unavailable");
        const sources = await ctx.db
            .query("sources")
            .withIndex("by_run_and_url", (q) => q.eq("runId", run._id))
            .take(4);
        const reading = await ctx.db
            .query("sourceCaptures")
            .withIndex("by_capture_key", (q) =>
                q.eq("captureKey", `e2e:${run._id}:source-reading`),
            )
            .unique();
        if (!reading || sources.length !== 3)
            throw new Error("Inspected recovery fixture is unavailable");
        const unavailableUrl = "https://127.0.0.1/illustrative-unavailable";
        const queued =
            sources.find(
                (source) =>
                    source._id !== reading.sourceId &&
                    source.canonicalUrl === unavailableUrl,
            ) ?? sources.find((source) => source._id !== reading.sourceId);
        if (!queued) throw new Error("Missing recovery source");
        const sourceIds = sources.map((source) => source._id).sort();
        if (queued.canonicalUrl === unavailableUrl) {
            const proposal = revision.sourceSelectionProposalId
                ? await ctx.db.get(revision.sourceSelectionProposalId)
                : null;
            if (!proposal) throw new Error("Missing recovery proposal");
            return {
                runId: run._id,
                corpusRevisionId: revision._id,
                proposalId: proposal._id,
                proposalVersion: proposal.version,
                sourceIds,
            };
        }
        if (queued.canonicalUrl !== unavailableUrl) {
            await ctx.db.patch(queued._id, { canonicalUrl: unavailableUrl });
            await ctx.db.patch(preparation._id, {
                entryPoint: "manual_addition",
                manualSourceIds: [queued._id],
                readingSourceIds: undefined,
                status: "partial",
                stopCode: "missing_configuration",
                deadlineAt: Date.now() - 1,
                leaseExpiresAt: Date.now() - 1,
                sourceOutcomes: preparation.sourceOutcomes?.filter(
                    (outcome) => outcome.sourceId !== queued._id,
                ),
            });
        }
        const proposal = await createSourceSelectionProposal(ctx, {
            run,
            revision,
        });
        return {
            runId: run._id,
            corpusRevisionId: revision._id,
            proposalId: proposal.proposalId,
            proposalVersion: proposal.version,
            sourceIds,
        };
    },
});

/** Stages illustrative workflow boundaries through the real projections and completion fence, without external I/O. */
export const advanceSourcePreparationFixture = internalMutation({
    args: {
        runId: v.id("researchRuns"),
        fixtureKey: v.string(),
        slotKey: v.string(),
        phase: v.union(
            v.literal("reading"),
            v.literal("comparison"),
            v.literal("comparison_progress"),
            v.literal("supplement"),
            v.literal("additional_reading"),
            v.literal("proposal"),
            v.literal("complete"),
        ),
    },
    returns: v.literal(true),
    handler: async (ctx, args): Promise<true> => {
        if (
            env.E2E_FIXTURES_ENABLED !== "true" ||
            !["localhost", "127.0.0.1"].includes(
                new URL(env.CONVEX_CLOUD_URL).hostname,
            )
        )
            throw new Error("Local progress fixtures are disabled");
        const run = await ctx.db.get(args.runId);
        const invitation = await ctx.db
            .query("invitations")
            .withIndex("by_slot_key", (q) => q.eq("slotKey", args.slotKey))
            .unique();
        const revision = run?.activeCorpusRevisionId
            ? await ctx.db.get(run.activeCorpusRevisionId)
            : null;
        const preparation = run?.sourcePreparationId
            ? await ctx.db.get(run.sourcePreparationId)
            : null;
        const visitor = run?.ownerVisitorId
            ? await ctx.db.get(run.ownerVisitorId)
            : null;
        if (
            !run ||
            run.reservationKey !== `e2e:${args.fixtureKey.trim()}` ||
            invitation?.status !== "claimed" ||
            invitation.claimedByVisitorId !== run.ownerVisitorId ||
            visitor?.status !== "active" ||
            revision?.status !== "draft" ||
            !revision.sourceSelectionProposalId ||
            preparation?.kind !== "preparation"
        )
            throw new Error("Owned progress fixture is unavailable");
        const capture = await ctx.db
            .query("sourceCaptures")
            .withIndex("by_capture_key", (q) =>
                q.eq("captureKey", `e2e:${run._id}:source-reading`),
            )
            .unique();
        if (!capture)
            throw new Error("Inspected progress fixture is unavailable");
        const operationKey = `e2e:${run._id}:live-progress`;
        if (args.phase === "reading") {
            if (preparation.operationKey === operationKey) return true;
            const now = Date.now();
            const executionGeneration = await claimPausedRunExecution(ctx, {
                run,
                visitor,
                checkpoint: {
                    lifecycleState: "awaiting_source_review",
                    pauseReason: "source_review",
                },
                now,
            });
            await ctx.db.patch(preparation._id, {
                operationKey,
                executionGeneration,
                entryPoint: "source_review",
                status: "started",
                stopCode: undefined,
                completedAt: undefined,
                deadlineAt: now + SOURCE_PREPARATION_DEADLINE_MS,
                leaseExpiresAt: now + SOURCE_PREPARATION_DEADLINE_MS,
                progress: { phase: "reading", updatedAt: now },
                sourceOutcomes: preparation.sourceOutcomes?.filter(
                    (outcome) => outcome.sourceId !== capture.sourceId,
                ),
            });
            const source = await ctx.db.get(capture.sourceId);
            if (!source) throw new Error("Missing illustrative source");
            const classification = classifySourceCandidate(
                { ...source, sourceId: source._id },
                mergeRunCompanyMetadata(
                    run.companySnapshot,
                    run.companyId ? await ctx.db.get(run.companyId) : null,
                ),
            );
            const proposalId = revision.sourceSelectionProposalId;
            const item = await ctx.db
                .query("sourceSelectionProposalItems")
                .withIndex("by_proposal_and_source", (q) =>
                    q.eq("proposalId", proposalId).eq("sourceId", source._id),
                )
                .unique();
            if (!item) throw new Error("Missing illustrative proposal item");
            await ctx.db.patch(item._id, {
                sourceCaptureId: undefined,
                qualificationTaskId: undefined,
                comparisonTaskIds: undefined,
                comparisonOutcomes: undefined,
                inspectionStatus: undefined,
                roleAvailability: classification.roleAvailability,
                coverageContributions: classification.coverageContributions,
                eligibleCoverageRoles: classification.eligibleCoverageRoles,
            });
            return true;
        }
        if (preparation.operationKey !== operationKey)
            throw new Error("Progress fixture was not started");
        if (args.phase === "complete") {
            if (preparation.status !== "started") return true;
            await ctx.runMutation(internal.sourcePreparation.finish, {
                preparationId: preparation._id,
                expectedExecutionGeneration: run.executionGeneration,
            });
            return true;
        }
        if (
            args.phase === "comparison_progress" ||
            args.phase === "supplement" ||
            args.phase === "additional_reading"
        ) {
            await ctx.runMutation(internal.sourcePreparation.recordProgress, {
                preparationId: preparation._id,
                phase:
                    args.phase === "comparison_progress"
                        ? "comparison"
                        : args.phase === "additional_reading"
                          ? "reading"
                          : "supplement",
                ...(args.phase === "comparison_progress"
                    ? { current: 1, total: 1 }
                    : {}),
            });
            return true;
        }
        if (args.phase === "comparison") {
            const tasks = await ctx.db
                .query("aiTaskResults")
                .withIndex("by_run_and_task_type_and_input_hash", (q) =>
                    q
                        .eq("runId", run._id)
                        .eq("taskType", "source_qualification"),
                )
                .take(8);
            const task = tasks.find(
                (task) => task.sourceCaptureId === capture._id,
            );
            if (!task) throw new Error("Missing illustrative qualification");
            await ctx.runMutation(internal.sourcePreparation.recordResult, {
                preparationId: preparation._id,
                outcome: {
                    sourceId: capture.sourceId,
                    result: {
                        status: "qualified",
                        sourceCaptureId: capture._id,
                        taskId: task._id,
                    },
                },
            });
            await ctx.runMutation(internal.sourcePreparation.recordProgress, {
                preparationId: preparation._id,
                phase: "comparison",
                current: 0,
                total: 1,
            });
        } else
            await ctx.runMutation(internal.sourcePreparation.recordProgress, {
                preparationId: preparation._id,
                phase: "proposal",
            });
        return true;
    },
});
