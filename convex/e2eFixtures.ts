import type { FunctionReference } from "convex/server";
import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
    env,
    internalAction,
    internalMutation,
    internalQuery,
} from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { ASSESSMENT_DIMENSION_KEYS } from "./domain/researchPlan";
import { computePassageKey, sha256Hex } from "./domain/sourcePassages";
import { buildCccShowcaseManifest } from "./fixtures/cccShowcase";
import { sourceCandidateLimit } from "./resourceLimits";
import { corpusRevisionApproved, workflow } from "./workflow";

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
            !fixtureRun.companySnapshot?.cik.startsWith("e2e-")
        ) {
            throw new Error("E2E source review scenario not found");
        }
        await ctx.runMutation(
            internal.evidenceExecution.completeSourceReview,
            args,
        );
        const run = await ctx.db.get(args.runId);
        if (run?.executionStatus !== "running") return null;
        // Freeze explicit acquisition failures in the same transaction as the
        // real handoff so scheduled fixture work can never reach a provider.
        const sources = await ctx.runQuery(
            internal.evidenceArtifacts.listFrozenSourcesForRun,
            {
                runId: run._id,
                executionGeneration: run.executionGeneration,
            },
        );
        for (const source of sources) {
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

export const seedSourceReviewScenario = internalMutation({
    args: {
        slotKey: v.string(),
        fixtureKey: v.string(),
        recoveryScenario: v.optional(v.boolean()),
    },
    returns: v.object({
        runId: v.id("researchRuns"),
        corpusRevisionId: v.id("corpusRevisions"),
        proposalId: v.id("sourceSelectionProposals"),
        proposalVersion: v.number(),
        sourceIds: v.array(v.id("sources")),
    }),
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
                    (args.recoveryScenario ? sourceCandidateLimit() : 3)
            ) {
                return {
                    runId: existingRun._id,
                    corpusRevisionId: revision._id,
                    proposalId: proposal._id,
                    proposalVersion: proposal.version,
                    sourceIds: sources.map(({ _id }) => _id),
                };
            }
        }

        const now = Date.now();
        const companyId = await ctx.db.insert("companies", {
            cik: `e2e-${fixtureKey}`,
            legalName: "Reactive Systems Test Company",
            ticker: "RXT",
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
                legalName: "Reactive Systems Test Company",
                ticker: "RXT",
                exchange: "NASDAQ",
                websiteUrl: "https://example.com/",
            },
            coveragePreset: "balanced",
            researchAngle: "Reactive source review verification",
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
        const sourceInputs = [
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
        return {
            lifecycleState: run.lifecycleState,
            executionStatus: run.executionStatus,
            revisionStatus: revision.status,
            decisions,
            providerCallCount: providerCalls.length,
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
    const content = FIXTURE_ARTIFACT_TEXT;
    const contentHash = sha256Hex(content);
    const byteCount = new TextEncoder().encode(content).length;
    const storageId = await deps.storeBlob(
        new Blob([content], { type: "text/plain; charset=utf-8" }),
    );
    try {
        const result = await deps.commitSeed({
            slotKey,
            fixtureKey,
            scenarioKind: args.scenarioKind,
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
        return {
            runId: result.runId,
            corpusRevisionId: result.corpusRevisionId,
            sourceIds: result.sourceIds,
            scenarioKind: result.scenarioKind,
            executionGeneration: result.executionGeneration,
        };
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
