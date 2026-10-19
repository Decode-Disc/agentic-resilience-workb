/// <reference types="vite/client" />
import type { Id } from "@convex/_generated/dataModel";
import { ASSESSMENT_DIMENSION_KEYS } from "@convex/domain/researchPlan";
import {
    clearShowcaseManifests,
    CLAIM_SCHEMA_VERSION,
    SHOWCASE_ADAPTER_VERSION,
    SHOWCASE_FIXTURE_VERSION,
    registerShowcaseManifest,
    type ShowcaseClaimOutput,
} from "@convex/domain/showcaseManifest";
import { computePassageKey } from "@convex/domain/sourcePassages";
import schema from "@convex/schema";
import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import rateLimiterTest from "../integrations/rate-limiter-test-register.js";
import workflowTest from "../workflows/workflow-test-register.js";

const modules = import.meta.glob("/convex/**/*.ts");

const getNormalizedClaimInput = makeFunctionReference<
    "query",
    { runId: Id<"researchRuns">; executionGeneration: number },
    { normalizedInput: any; inputHash: string } | null
>("claimGeneration:getNormalizedClaimInput");

const getRun = makeFunctionReference<"query", { runId: string }, any>(
    "researchRuns:get",
);

const updateEvidenceSourceStatus = makeFunctionReference<
    "mutation",
    {
        runId: Id<"researchRuns">;
        corpusRevisionId: Id<"corpusRevisions">;
        sourceId: Id<"sources">;
        acceptedDecisionId: Id<"sourceDecisions">;
        executionGeneration: number;
        status: "queued" | "running" | "succeeded" | "partial" | "failed";
        sourceVersionId?: Id<"sourceVersions">;
        failureReason?: string;
    },
    null
>("evidenceArtifacts:updateEvidenceSourceStatus");

const listEvents = makeFunctionReference<
    "query",
    { runId: Id<"researchRuns"> },
    Array<{
        sequence: number;
        type: string;
        lifecycleState: string;
        executionStatus: string;
    }>
>("researchRuns:listEvents");

const pauseForClaimGenerationUnavailable = makeFunctionReference<
    "mutation",
    { runId: Id<"researchRuns">; expectedExecutionGeneration: number },
    null
>("researchRuns:pauseForClaimGenerationUnavailable");

const clearActiveWorkflowHandleOnSuccess = makeFunctionReference<
    "mutation",
    { runId: Id<"researchRuns">; workflowId: string },
    null
>("evidenceWorkflow:clearActiveWorkflowHandleOnSuccess");

const retryClaimGeneration = makeFunctionReference<
    "mutation",
    { runId: Id<"researchRuns"> },
    { status: string; executionGeneration: number }
>("evidenceExecution:retryClaimGeneration");

const generateClaimsForRun = makeFunctionReference<
    "mutation",
    { runId: Id<"researchRuns">; executionGeneration: number },
    { status: string; claimCount: number; reason?: string; reused: boolean }
>("claimGeneration:generateClaimsForRun");

const evaluatePolicyForRun = makeFunctionReference<
    "action",
    { runId: Id<"researchRuns">; executionGeneration: number },
    {
        evaluationCount: number;
        blockedCount: number;
        needsReviewCount: number;
        passCount: number;
    }
>("policyEvaluations:evaluatePolicyForRun");

async function createUnavailablePauseScenario(
    t: ReturnType<typeof convexTest>,
) {
    return await t.run(async (ctx) => {
        const userId = await ctx.db.insert("users", { isAnonymous: true });
        const invitationId = await ctx.db.insert("invitations", {
            slotKey: "analyst-unavail-test",
            role: "analyst",
            codeDigest: "digest-unavail",
            status: "claimed",
            createdAt: 100,
        });
        const visitorId = await ctx.db.insert("visitors", {
            authUserId: userId,
            invitationId,
            role: "analyst",
            status: "active",
            analysesReserved: 1,
            admittedAt: 100,
        });

        const companyId = await ctx.db.insert("companies", {
            cik: "1818201",
            legalName: "CCC Intelligent Solutions Holdings Inc.",
            ticker: "CCCS",
            exchange: "NASDAQ",
            canonicalizedAt: 100,
        });

        const runId = await ctx.db.insert("researchRuns", {
            ownerVisitorId: visitorId,
            companyId,
            coveragePreset: "balanced",
            lifecycleState: "extracting_evidence",
            executionStatus: "running",
            executionGeneration: 1,
            nextEventSequence: 1,
            workflowId: "wf_test_123",
            createdAt: 100,
            updatedAt: 100,
        });

        const corpusRevisionId = await ctx.db.insert("corpusRevisions", {
            runId,
            revision: 1,
            status: "approved",
            approvedByVisitorId: visitorId,
            approvedAt: 100,
            createdAt: 100,
        });

        await ctx.db.patch(runId, { activeCorpusRevisionId: corpusRevisionId });

        // Seed research plan and questions
        const planId = await ctx.db.insert("researchPlans", {
            runId,
            version: 2,
            coveragePreset: "balanced",
            queries: [],
            createdAt: 100,
        });

        for (const dimensionKey of ASSESSMENT_DIMENSION_KEYS) {
            await ctx.db.insert("researchPlanQuestions", {
                runId,
                researchPlanId: planId,
                planVersion: 2,
                questionKey: `dimension:${dimensionKey}`,
                prompt: `What public evidence addresses ${dimensionKey}?`,
                dimensionKeys: [dimensionKey],
                createdAt: 100,
            });
        }

        // Seed a source with version and passages
        const storageId = (await ctx.storage.store(
            new Blob(["test content"]),
        )) as Id<"_storage">;

        const sourceId = await ctx.db.insert("sources", {
            runId,
            canonicalUrl: "https://example.com/sec/ccc-10k",
            title: "CCC 10-K Annual Report",
            origin: "sec",
            category: "regulatory_filing",
            createdAt: 100,
        });

        const decisionId = await ctx.db.insert("sourceDecisions", {
            runId,
            corpusRevisionId,
            sourceId,
            decisionKey: `dec:${sourceId}:100`,
            decision: "accepted",
            reviewerVisitorId: visitorId,
            occurredAt: 100,
        });

        await ctx.db.insert("sourceReviewItems", {
            runId,
            corpusRevisionId,
            sourceId,
            decisionRank: 0,
            sourceCreatedAt: 100,
            decision: "accepted",
            latestDecisionId: decisionId,
            decisionOccurredAt: 100,
        });

        const versionHash = "hash_version_unavail";
        const sourceVersionId = await ctx.db.insert("sourceVersions", {
            runId,
            corpusRevisionId,
            sourceId,
            acceptedDecisionId: decisionId,
            contentHash: versionHash,
            normalizerVersion: "sec-html-v1",
            storageId,
            mediaType: "text/html",
            byteCount: 200,
            canonicalUrl: "https://example.com/sec/ccc-10k",
            retrievalVersion: "sec-v1",
            executionGeneration: 1,
            createdAt: 100,
        });

        await ctx.db.insert("evidenceSourceStatuses", {
            runId,
            corpusRevisionId,
            sourceId,
            acceptedDecisionId: decisionId,
            sourceVersionId,
            executionGeneration: 1,
            status: "succeeded",
            createdAt: 100,
            updatedAt: 100,
        });

        const passageText =
            "CCC connects approximately 30,000 repair facilities.";
        const quotationHash = "qhash_unavail_0";
        const locator = {
            kind: "web" as const,
            canonicalUrl: "https://example.com/sec/ccc-10k",
            sourceVersionHash: versionHash,
            exactQuotation: passageText,
            startOffset: 0,
            endOffset: passageText.length,
        };
        const passageKey = computePassageKey({
            sourceId,
            sourceVersionHash: versionHash,
            locatorVersion: "web-v1",
            locator,
            order: 0,
            quotationHash,
        });
        await ctx.db.insert("sourcePassages", {
            sourceVersionId,
            locatorVersion: "web-v1",
            passageKey,
            quotationHash,
            order: 0,
            exactQuotation: passageText,
            locator,
            createdAt: 100,
        });

        return {
            runId,
            corpusRevisionId,
            visitorId,
            userId,
            sourceId,
            decisionId,
        };
    });
}

describe("Claim Generation Unavailable Pause and Retry", () => {
    beforeEach(() => {
        clearShowcaseManifests();
    });

    afterEach(() => {
        clearShowcaseManifests();
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    test("pause keeps workflowId until completing workflow compare-clears it", async () => {
        const t = convexTest(schema, modules);
        rateLimiterTest.register(t);
        workflowTest.register(t);

        const scenario = await createUnavailablePauseScenario(t);

        // Compute normalized input but do NOT register a manifest for it
        const inputData = await t.query(getNormalizedClaimInput, {
            runId: scenario.runId,
            executionGeneration: 1,
        });
        expect(inputData).toBeDefined();

        // Pause the run (simulating the workflow calling pauseForClaimGenerationUnavailable)
        await t.mutation(pauseForClaimGenerationUnavailable, {
            runId: scenario.runId,
            expectedExecutionGeneration: 1,
        });

        // Verify exact paused tuple
        const run = await t.query(getRun, { runId: scenario.runId });
        expect(run.lifecycleState).toBe("extracting_evidence");
        expect(run.executionStatus).toBe("paused");
        expect(run.pauseReason).toBe("claim_generation_unavailable");

        expect(run.workflowId).toBe("wf_test_123");
        await t.mutation(pauseForClaimGenerationUnavailable, {
            runId: scenario.runId,
            expectedExecutionGeneration: 1,
        });
        await t.run(async (ctx) => {
            await ctx.db.patch(scenario.runId, { workflowId: "wf_newer" });
        });
        await t.mutation(clearActiveWorkflowHandleOnSuccess, {
            runId: scenario.runId,
            workflowId: "wf_test_123",
        });
        expect(
            (await t.query(getRun, { runId: scenario.runId })).workflowId,
        ).toBe("wf_newer");
        await t.mutation(clearActiveWorkflowHandleOnSuccess, {
            runId: scenario.runId,
            workflowId: "wf_newer",
        });

        // Verify pause event and step are idempotent.
        const events = await t.query(listEvents, { runId: scenario.runId });
        const pauseEvent = events.find(
            (e) => e.type === "claim_generation_paused",
        );
        expect(pauseEvent).toBeDefined();
        expect(pauseEvent?.executionStatus).toBe("paused");
        expect(
            events.filter((event) => event.type === "claim_generation_paused"),
        ).toHaveLength(1);
        await t.run(async (ctx) => {
            const steps = await ctx.db
                .query("workflowSteps")
                .withIndex("by_run_and_key", (query) =>
                    query
                        .eq("runId", scenario.runId)
                        .eq("key", "generate_claims"),
                )
                .take(2);
            expect(steps).toHaveLength(1);
            expect(steps[0]?.state).toBe("needs_review");
        });
    });

    test("unavailable retry returns without state change, event, generation increment, or I/O", async () => {
        const t = convexTest(schema, modules);
        rateLimiterTest.register(t);
        workflowTest.register(t);

        const scenario = await createUnavailablePauseScenario(t);

        // First pause the run
        await t.mutation(pauseForClaimGenerationUnavailable, {
            runId: scenario.runId,
            expectedExecutionGeneration: 1,
        });

        await t.mutation(clearActiveWorkflowHandleOnSuccess, {
            runId: scenario.runId,
            workflowId: "wf_test_123",
        });
        const runBefore = await t.query(getRun, {
            runId: scenario.runId,
        });
        const genBefore = runBefore.executionGeneration;
        const eventsBefore = await t.query(listEvents, {
            runId: scenario.runId,
        });

        // Retry — manifest is NOT registered, so capability check fails
        const asOwner = t.withIdentity({ subject: scenario.userId });
        const result = await asOwner.mutation(retryClaimGeneration, {
            runId: scenario.runId,
        });

        expect(result.status).toBe("unavailable");

        // Verify NO state changes
        const runAfter = await t.query(getRun, { runId: scenario.runId });
        expect(runAfter.executionGeneration).toBe(genBefore);
        expect(runAfter.executionStatus).toBe("paused");
        expect(runAfter.pauseReason).toBe("claim_generation_unavailable");

        // Verify NO new events
        const eventsAfter = await t.query(listEvents, {
            runId: scenario.runId,
        });
        expect(eventsAfter.length).toBe(eventsBefore.length);

        // Verify NO new workflow started
        expect(runAfter.workflowId).toBeUndefined();
    });

    test("newly available retry atomically claims slot, increments generation, and reuses artifacts", async () => {
        const t = convexTest(schema, modules);
        rateLimiterTest.register(t);
        workflowTest.register(t);

        const scenario = await createUnavailablePauseScenario(t);

        // Get normalized input and register the manifest
        const inputData = await t.query(getNormalizedClaimInput, {
            runId: scenario.runId,
            executionGeneration: 1,
        });
        if (!inputData) throw new Error("Missing inputData");

        const manifestClaims: ShowcaseClaimOutput[] = [
            {
                statement: "CCC connects 30,000 repair facilities.",
                classification: "Fact",
                evidence: [
                    {
                        quotationHash:
                            inputData.normalizedInput.passages[0].quotationHash,
                        passageKey:
                            inputData.normalizedInput.passages[0].passageKey,
                        sourceVersionHash:
                            inputData.normalizedInput.passages[0]
                                .sourceVersionHash,
                        relation: "supporting",
                    },
                ],
                dimensionLinks: [
                    {
                        dimensionKey: "workflow_control",
                        rationale: "Network integration",
                    },
                ],
            },
        ];

        registerShowcaseManifest({
            fixtureId: "test-fixture",
            fixtureVersion: SHOWCASE_FIXTURE_VERSION,
            schemaVersion: CLAIM_SCHEMA_VERSION,
            adapterVersion: SHOWCASE_ADAPTER_VERSION,
            inputHash: inputData.inputHash,
            claims: manifestClaims,
        });

        // Pause completes before retry, so completion compare-clears old handle.
        await t.mutation(pauseForClaimGenerationUnavailable, {
            runId: scenario.runId,
            expectedExecutionGeneration: 1,
        });
        await t.mutation(clearActiveWorkflowHandleOnSuccess, {
            runId: scenario.runId,
            workflowId: "wf_test_123",
        });

        const genBefore = (await t.query(getRun, { runId: scenario.runId }))
            .executionGeneration;

        const countsBefore = await t.run(async (ctx) => ({
            sourceVersions: (
                await ctx.db
                    .query("sourceVersions")
                    .withIndex("by_run", (query) =>
                        query.eq("runId", scenario.runId),
                    )
                    .take(49)
            ).length,
            passages: (await ctx.db.query("sourcePassages").take(513)).length,
            providerCalls: (await ctx.db.query("providerCalls").take(100))
                .length,
            storage: (await ctx.db.system.query("_storage").take(100)).length,
        }));
        const fetchSpy = vi.fn();
        vi.stubGlobal("fetch", fetchSpy);
        vi.useFakeTimers();

        // Retry — capability now available
        const asOwner = t.withIdentity({ subject: scenario.userId });
        const result = await asOwner.mutation(retryClaimGeneration, {
            runId: scenario.runId,
        });

        expect(result.status).toBe("retried");
        expect(result.executionGeneration).toBe(genBefore + 1);

        // Verify run state: running, generation bumped, pauseReason cleared
        const runAfter = await t.query(getRun, { runId: scenario.runId });
        expect(runAfter.executionStatus).toBe("running");
        expect(runAfter.executionGeneration).toBe(genBefore + 1);
        expect(runAfter.pauseReason).toBeUndefined();

        // Verify new workflow started, then drain it without retrieval I/O.
        expect(runAfter.workflowId).toBeDefined();
        await t.finishAllScheduledFunctions(vi.runAllTimers);
        const countsAfter = await t.run(async (ctx) => ({
            sourceVersions: (
                await ctx.db
                    .query("sourceVersions")
                    .withIndex("by_run", (query) =>
                        query.eq("runId", scenario.runId),
                    )
                    .take(49)
            ).length,
            passages: (await ctx.db.query("sourcePassages").take(513)).length,
            providerCalls: (await ctx.db.query("providerCalls").take(100))
                .length,
            storage: (await ctx.db.system.query("_storage").take(100)).length,
        }));
        expect(countsAfter).toEqual(countsBefore);
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    test("structural block: Unknown without question fails in claim generation", async () => {
        const t = convexTest(schema, modules);
        rateLimiterTest.register(t);
        workflowTest.register(t);

        const scenario = await createUnavailablePauseScenario(t);

        const inputData = await t.query(getNormalizedClaimInput, {
            runId: scenario.runId,
            executionGeneration: 1,
        });
        if (!inputData) throw new Error("Missing inputData");

        // Register manifest with Unknown claim missing questionKey
        registerShowcaseManifest({
            fixtureId: "test-fixture",
            fixtureVersion: SHOWCASE_FIXTURE_VERSION,
            schemaVersion: CLAIM_SCHEMA_VERSION,
            adapterVersion: SHOWCASE_ADAPTER_VERSION,
            inputHash: inputData.inputHash,
            claims: [
                {
                    statement: "This is unknown without question.",
                    classification: "Unknown",
                    evidence: [
                        {
                            quotationHash:
                                inputData.normalizedInput.passages[0]
                                    .quotationHash,
                            passageKey:
                                inputData.normalizedInput.passages[0]
                                    .passageKey,
                            sourceVersionHash:
                                inputData.normalizedInput.passages[0]
                                    .sourceVersionHash,
                            relation: "context",
                        },
                    ],
                    dimensionLinks: [],
                    // No questionKey — should trigger structural block
                },
            ],
        });

        // Use generateClaimsForRun directly since we're not testing pause
        const generateClaimsForRun = makeFunctionReference<
            "mutation",
            { runId: Id<"researchRuns">; executionGeneration: number },
            { status: string; claimCount: number; reason?: string }
        >("claimGeneration:generateClaimsForRun");

        // Structural validation blocks → throws
        await expect(
            t.mutation(generateClaimsForRun, {
                runId: scenario.runId,
                executionGeneration: 1,
            }),
        ).rejects.toThrow(/Structural validation blocked/);

        // Verify zero claims
        await t.run(async (ctx) => {
            const claims = await ctx.db.query("claims").collect();
            expect(claims).toHaveLength(0);
        });
    });

    test("structural block: Unknown with question but no context evidence fails", async () => {
        const t = convexTest(schema, modules);
        rateLimiterTest.register(t);
        workflowTest.register(t);

        const scenario = await createUnavailablePauseScenario(t);

        const inputData = await t.query(getNormalizedClaimInput, {
            runId: scenario.runId,
            executionGeneration: 1,
        });
        if (!inputData) throw new Error("Missing inputData");

        registerShowcaseManifest({
            fixtureId: "test-fixture",
            fixtureVersion: SHOWCASE_FIXTURE_VERSION,
            schemaVersion: CLAIM_SCHEMA_VERSION,
            adapterVersion: SHOWCASE_ADAPTER_VERSION,
            inputHash: inputData.inputHash,
            claims: [
                {
                    statement: "Unknown with question but no context evidence.",
                    classification: "Unknown",
                    evidence: [
                        {
                            quotationHash:
                                inputData.normalizedInput.passages[0]
                                    .quotationHash,
                            passageKey:
                                inputData.normalizedInput.passages[0]
                                    .passageKey,
                            sourceVersionHash:
                                inputData.normalizedInput.passages[0]
                                    .sourceVersionHash,
                            relation: "supporting", // NOT context
                        },
                    ],
                    dimensionLinks: [],
                    questionKey: "dimension:model_platform_dependency",
                },
            ],
        });

        const generateClaimsForRun = makeFunctionReference<
            "mutation",
            { runId: Id<"researchRuns">; executionGeneration: number },
            { status: string; claimCount: number }
        >("claimGeneration:generateClaimsForRun");

        await expect(
            t.mutation(generateClaimsForRun, {
                runId: scenario.runId,
                executionGeneration: 1,
            }),
        ).rejects.toThrow(/Structural validation blocked/);
    });

    test("selection gap alone creates no Unknown and no question coverage mutation", async () => {
        const t = convexTest(schema, modules);
        rateLimiterTest.register(t);
        workflowTest.register(t);

        const scenario = await createUnavailablePauseScenario(t);

        // Persist the selection gap on the proposal: discovery families that
        // failed and coverage gaps that remain unfilled.
        await t.run(async (ctx) => {
            await ctx.db.insert("sourceSelectionProposals", {
                runId: scenario.runId,
                corpusRevisionId: scenario.corpusRevisionId,
                version: 1,
                policyVersion: "source-selection-v6",
                coveragePreset: "balanced",
                recommendedTarget: 12,
                candidateFingerprint: "gap-fixture",
                status: "ready",
                counts: { recommended: 1, needsAttention: 0, alternative: 0 },
                gaps: [],
                failedDiscoveryFamilies: [
                    "investor_relations",
                    "counter_evidence",
                ],
                coverageGaps: ["investor_presentation"],
                createdAt: 100,
            });
        });
        const questionsBefore = await t.run(async (ctx) => {
            const questions = await ctx.db
                .query("researchPlanQuestions")
                .withIndex("by_run", (query) =>
                    query.eq("runId", scenario.runId),
                )
                .take(129);
            return questions.map((question) => ({
                _id: question._id,
                planVersion: question.planVersion,
                questionKey: question.questionKey,
                prompt: question.prompt,
            }));
        });

        const inputData = await t.query(getNormalizedClaimInput, {
            runId: scenario.runId,
            executionGeneration: 1,
        });
        if (!inputData) throw new Error("Missing inputData");

        // Valid manifest containing only Fact/Inference claims: the persisted
        // discovery/coverage gap must not synthesize Unknown claims or any
        // question coverage.
        registerShowcaseManifest({
            fixtureId: "gap-fixture",
            fixtureVersion: SHOWCASE_FIXTURE_VERSION,
            schemaVersion: CLAIM_SCHEMA_VERSION,
            adapterVersion: SHOWCASE_ADAPTER_VERSION,
            inputHash: inputData.inputHash,
            claims: [
                {
                    statement:
                        "CCC connects approximately 30,000 repair facilities.",
                    classification: "Fact",
                    evidence: [
                        {
                            quotationHash:
                                inputData.normalizedInput.passages[0]
                                    .quotationHash,
                            passageKey:
                                inputData.normalizedInput.passages[0]
                                    .passageKey,
                            sourceVersionHash:
                                inputData.normalizedInput.passages[0]
                                    .sourceVersionHash,
                            relation: "supporting",
                        },
                    ],
                    dimensionLinks: [],
                },
                {
                    statement:
                        "OEM telematics may bypass traditional estimating networks.",
                    classification: "Inference",
                    evidence: [
                        {
                            quotationHash:
                                inputData.normalizedInput.passages[0]
                                    .quotationHash,
                            passageKey:
                                inputData.normalizedInput.passages[0]
                                    .passageKey,
                            sourceVersionHash:
                                inputData.normalizedInput.passages[0]
                                    .sourceVersionHash,
                            relation: "supporting",
                        },
                    ],
                    dimensionLinks: [],
                },
            ],
        });

        const generation = await t.mutation(generateClaimsForRun, {
            runId: scenario.runId,
            executionGeneration: 1,
        });
        expect(generation.status).toBe("succeeded");
        expect(generation.claimCount).toBe(2);

        await t.run(async (ctx) => {
            const allClaims = await ctx.db
                .query("claims")
                .withIndex("by_run", (query) =>
                    query.eq("runId", scenario.runId),
                )
                .take(129);
            expect(allClaims).toHaveLength(2);
            expect(
                allClaims.filter((claim) => claim.classification === "Unknown"),
            ).toHaveLength(0);
            expect(
                allClaims.every(
                    (claim) =>
                        claim.classification === "Fact" ||
                        claim.classification === "Inference",
                ),
            ).toBe(true);

            // Zero Unknown claims therefore zero question coverage, and the
            // question rows are untouched (coverage is derived, never stored).
            const questionsAfter = await ctx.db
                .query("researchPlanQuestions")
                .withIndex("by_run", (query) =>
                    query.eq("runId", scenario.runId),
                )
                .take(129);
            expect(
                questionsAfter.map((question) => ({
                    _id: question._id,
                    planVersion: question.planVersion,
                    questionKey: question.questionKey,
                    prompt: question.prompt,
                })),
            ).toEqual(questionsBefore);
            expect(
                questionsAfter.every((question) => !("coverage" in question)),
            ).toBe(true);
        });
    });

    test("failed status with sourceVersionId is excluded from claim input, coverage, and retry with exact failureReason carry", async () => {
        const t = convexTest(schema, modules);
        rateLimiterTest.register(t);
        workflowTest.register(t);

        const scenario = await createUnavailablePauseScenario(t);
        const failureReason = "exa_rate_limited: quota exhausted for provider";
        await t.run(async (ctx) => {
            const statusRow = await ctx.db
                .query("evidenceSourceStatuses")
                .withIndex("by_run_corpus_generation_source", (query) =>
                    query
                        .eq("runId", scenario.runId)
                        .eq("corpusRevisionId", scenario.corpusRevisionId)
                        .eq("executionGeneration", 1)
                        .eq("sourceId", scenario.sourceId),
                )
                .unique();
            if (!statusRow) throw new Error("Missing status row");
            await ctx.db.patch(statusRow._id, {
                status: "failed",
                failureReason,
            });
        });

        // Failed rows cannot produce claim input or question coverage.
        const inputData = await t.query(getNormalizedClaimInput, {
            runId: scenario.runId,
            executionGeneration: 1,
        });
        expect(inputData).toBeNull();
        const generation = await t.mutation(generateClaimsForRun, {
            runId: scenario.runId,
            executionGeneration: 1,
        });
        expect(generation.status).toBe("unavailable");
        expect(generation.reason).toBe("no_committed_passages");
        const policy = await t.action(evaluatePolicyForRun, {
            runId: scenario.runId,
            executionGeneration: 1,
        });
        expect(policy.evaluationCount).toBe(0);
        expect(policy.blockedCount).toBe(0);

        // Pause tuple, then retry: strict no-op, no mutation, no I/O.
        await t.mutation(pauseForClaimGenerationUnavailable, {
            runId: scenario.runId,
            expectedExecutionGeneration: 1,
        });
        await t.mutation(clearActiveWorkflowHandleOnSuccess, {
            runId: scenario.runId,
            workflowId: "wf_test_123",
        });
        const runBefore = await t.query(getRun, { runId: scenario.runId });
        const eventsBefore = await t.query(listEvents, {
            runId: scenario.runId,
        });
        const statusesBefore = await t.run(async (ctx) => {
            const rows = await ctx.db.query("evidenceSourceStatuses").take(100);
            return rows.length;
        });

        const fetchSpy = vi.fn();
        vi.stubGlobal("fetch", fetchSpy);
        const asOwner = t.withIdentity({ subject: scenario.userId });
        const result = await asOwner.mutation(retryClaimGeneration, {
            runId: scenario.runId,
        });

        expect(result.status).toBe("unavailable");
        const runAfter = await t.query(getRun, { runId: scenario.runId });
        expect(runAfter.executionGeneration).toBe(
            runBefore.executionGeneration,
        );
        expect(runAfter.executionStatus).toBe("paused");
        expect(runAfter.pauseReason).toBe("claim_generation_unavailable");
        const eventsAfter = await t.query(listEvents, {
            runId: scenario.runId,
        });
        expect(eventsAfter.length).toBe(eventsBefore.length);
        const statusesAfter = await t.run(async (ctx) => {
            const rows = await ctx.db.query("evidenceSourceStatuses").take(100);
            return rows.length;
        });
        expect(statusesAfter).toBe(statusesBefore);
        expect(fetchSpy).not.toHaveBeenCalled();

        // Limitation metadata is carried exactly, never rewritten.
        const finalStatus = await t.run(async (ctx) => {
            const rows = await ctx.db
                .query("evidenceSourceStatuses")
                .withIndex("by_run_corpus_generation_source", (query) =>
                    query
                        .eq("runId", scenario.runId)
                        .eq("corpusRevisionId", scenario.corpusRevisionId)
                        .eq("executionGeneration", 1)
                        .eq("sourceId", scenario.sourceId),
                )
                .unique();
            if (!rows) throw new Error("Missing status row");
            return { status: rows.status, failureReason: rows.failureReason };
        });
        expect(finalStatus.status).toBe("failed");
        expect(finalStatus.failureReason).toBe(failureReason);
    });

    test("partial status is claim-input terminal and failureReason is carried exactly through policy", async () => {
        const t = convexTest(schema, modules);
        rateLimiterTest.register(t);
        workflowTest.register(t);

        const scenario = await createUnavailablePauseScenario(t);
        const failureReason = "retrieval_partial: 2 of 4 sections retrieved";
        await t.run(async (ctx) => {
            const statusRow = await ctx.db
                .query("evidenceSourceStatuses")
                .withIndex("by_run_corpus_generation_source", (query) =>
                    query
                        .eq("runId", scenario.runId)
                        .eq("corpusRevisionId", scenario.corpusRevisionId)
                        .eq("executionGeneration", 1)
                        .eq("sourceId", scenario.sourceId),
                )
                .unique();
            if (!statusRow) throw new Error("Missing status row");
            await ctx.db.patch(statusRow._id, {
                status: "partial",
                failureReason,
            });
            // The policy snapshot needs the accepted proposal projection to
            // treat the partial source as evidence-bearing.
            const proposalId = await ctx.db.insert("sourceSelectionProposals", {
                runId: scenario.runId,
                corpusRevisionId: scenario.corpusRevisionId,
                version: 1,
                policyVersion: "source-selection-v6",
                coveragePreset: "balanced",
                recommendedTarget: 12,
                candidateFingerprint: "partial-fixture",
                status: "ready",
                counts: { recommended: 1, needsAttention: 0, alternative: 0 },
                gaps: [],
                createdAt: 100,
            });
            await ctx.db.insert("sourceSelectionProposalItems", {
                runId: scenario.runId,
                corpusRevisionId: scenario.corpusRevisionId,
                proposalId,
                sourceId: scenario.sourceId,
                disposition: "recommended",
                sourceFamily: "regulatory",
                documentKind: "regulatory_annual",
                authorityTier: "regulator_primary",
                companyLinkageBasis: "structural",
                coverageContributions: ["regulatory_annual"],
                rank: 0,
                reasonCodes: [],
                createdAt: 100,
            });
            await ctx.db.patch(scenario.corpusRevisionId, {
                sourceSelectionProposalId: proposalId,
            });
        });

        const inputData = await t.query(getNormalizedClaimInput, {
            runId: scenario.runId,
            executionGeneration: 1,
        });
        if (!inputData) throw new Error("Missing inputData");
        registerShowcaseManifest({
            fixtureId: "partial-fixture",
            fixtureVersion: SHOWCASE_FIXTURE_VERSION,
            schemaVersion: CLAIM_SCHEMA_VERSION,
            adapterVersion: SHOWCASE_ADAPTER_VERSION,
            inputHash: inputData.inputHash,
            claims: [
                {
                    statement:
                        "CCC connects approximately 30,000 repair facilities.",
                    classification: "Fact",
                    evidence: [
                        {
                            quotationHash:
                                inputData.normalizedInput.passages[0]
                                    .quotationHash,
                            passageKey:
                                inputData.normalizedInput.passages[0]
                                    .passageKey,
                            sourceVersionHash:
                                inputData.normalizedInput.passages[0]
                                    .sourceVersionHash,
                            relation: "supporting",
                        },
                    ],
                    dimensionLinks: [],
                },
            ],
        });
        const generation = await t.mutation(generateClaimsForRun, {
            runId: scenario.runId,
            executionGeneration: 1,
        });
        expect(generation.status).toBe("succeeded");
        expect(generation.claimCount).toBe(1);
        const policy = await t.action(evaluatePolicyForRun, {
            runId: scenario.runId,
            executionGeneration: 1,
        });
        expect(policy.evaluationCount).toBe(1);
        const finalStatus = await t.run(async (ctx) => {
            const rows = await ctx.db
                .query("evidenceSourceStatuses")
                .withIndex("by_run_corpus_generation_source", (query) =>
                    query
                        .eq("runId", scenario.runId)
                        .eq("corpusRevisionId", scenario.corpusRevisionId)
                        .eq("executionGeneration", 1)
                        .eq("sourceId", scenario.sourceId),
                )
                .unique();
            if (!rows) throw new Error("Missing status row");
            return { status: rows.status, failureReason: rows.failureReason };
        });
        expect(finalStatus.status).toBe("partial");
        expect(finalStatus.failureReason).toBe(failureReason);
    });

    test("queued and running statuses with sourceVersionId are rejected and never authorize claims", async () => {
        const t = convexTest(schema, modules);
        rateLimiterTest.register(t);
        workflowTest.register(t);

        for (const status of ["queued", "running"] as const) {
            const scenario = await createUnavailablePauseScenario(t);
            await t.run(async (ctx) => {
                const statusRow = await ctx.db
                    .query("evidenceSourceStatuses")
                    .withIndex("by_run_corpus_generation_source", (query) =>
                        query
                            .eq("runId", scenario.runId)
                            .eq("corpusRevisionId", scenario.corpusRevisionId)
                            .eq("executionGeneration", 1)
                            .eq("sourceId", scenario.sourceId),
                    )
                    .unique();
                if (!statusRow) throw new Error("Missing status row");
                await ctx.db.patch(statusRow._id, { status });
            });

            await expect(
                t.query(getNormalizedClaimInput, {
                    runId: scenario.runId,
                    executionGeneration: 1,
                }),
            ).rejects.toThrow(/non-terminal and cannot authorize claims/);
            await expect(
                t.mutation(generateClaimsForRun, {
                    runId: scenario.runId,
                    executionGeneration: 1,
                }),
            ).rejects.toThrow(/non-terminal and cannot authorize claims/);

            // No claim input was authorized, so the policy snapshot has no
            // claims to evaluate and no coverage can be derived from them.
            const policy = await t.action(evaluatePolicyForRun, {
                runId: scenario.runId,
                executionGeneration: 1,
            });
            expect(policy.evaluationCount).toBe(0);
            expect(policy.blockedCount).toBe(0);
        }
    });

    test("real partial boundary preserves exact failureReason and available retry clones it with zero retrieval", async () => {
        const t = convexTest(schema, modules);
        rateLimiterTest.register(t);
        workflowTest.register(t);

        const scenario = await createUnavailablePauseScenario(t);
        const failureReason = "retrieval_partial: 2 of 4 sections retrieved";
        const sourceVersionId = await t.run(async (ctx) => {
            const statusRow = await ctx.db
                .query("evidenceSourceStatuses")
                .withIndex("by_run_corpus_generation_source", (query) =>
                    query
                        .eq("runId", scenario.runId)
                        .eq("corpusRevisionId", scenario.corpusRevisionId)
                        .eq("executionGeneration", 1)
                        .eq("sourceId", scenario.sourceId),
                )
                .unique();
            if (!statusRow?.sourceVersionId) {
                throw new Error("Missing source version");
            }
            return statusRow.sourceVersionId;
        });

        // Drive the REAL internal update boundary: a partial transition with a
        // sourceVersionId must keep the exact acquisition limitation.
        await t.mutation(updateEvidenceSourceStatus, {
            runId: scenario.runId,
            corpusRevisionId: scenario.corpusRevisionId,
            sourceId: scenario.sourceId,
            acceptedDecisionId: scenario.decisionId,
            executionGeneration: 1,
            status: "partial",
            sourceVersionId,
            failureReason,
        });
        const stored = await t.run(async (ctx) => {
            const row = await ctx.db
                .query("evidenceSourceStatuses")
                .withIndex("by_run_corpus_generation_source", (query) =>
                    query
                        .eq("runId", scenario.runId)
                        .eq("corpusRevisionId", scenario.corpusRevisionId)
                        .eq("executionGeneration", 1)
                        .eq("sourceId", scenario.sourceId),
                )
                .unique();
            return row
                ? { status: row.status, failureReason: row.failureReason }
                : null;
        });
        expect(stored?.status).toBe("partial");
        expect(stored?.failureReason).toBe(failureReason);

        // Make retry available and prepare a check that it performs no
        // retrieval I/O while cloning the terminal partial row.
        const inputData = await t.query(getNormalizedClaimInput, {
            runId: scenario.runId,
            executionGeneration: 1,
        });
        if (!inputData) throw new Error("Missing inputData");
        registerShowcaseManifest({
            fixtureId: "partial-retry-fixture",
            fixtureVersion: SHOWCASE_FIXTURE_VERSION,
            schemaVersion: CLAIM_SCHEMA_VERSION,
            adapterVersion: SHOWCASE_ADAPTER_VERSION,
            inputHash: inputData.inputHash,
            claims: [
                {
                    statement: "CCC connects 30,000 repair facilities.",
                    classification: "Fact",
                    evidence: [
                        {
                            quotationHash:
                                inputData.normalizedInput.passages[0]
                                    .quotationHash,
                            passageKey:
                                inputData.normalizedInput.passages[0]
                                    .passageKey,
                            sourceVersionHash:
                                inputData.normalizedInput.passages[0]
                                    .sourceVersionHash,
                            relation: "supporting",
                        },
                    ],
                    dimensionLinks: [],
                },
            ],
        });
        await t.mutation(pauseForClaimGenerationUnavailable, {
            runId: scenario.runId,
            expectedExecutionGeneration: 1,
        });
        await t.mutation(clearActiveWorkflowHandleOnSuccess, {
            runId: scenario.runId,
            workflowId: "wf_test_123",
        });

        const countsBefore = await t.run(async (ctx) => ({
            providerCalls: (await ctx.db.query("providerCalls").take(100))
                .length,
            sourceVersions: (
                await ctx.db
                    .query("sourceVersions")
                    .withIndex("by_run", (query) =>
                        query.eq("runId", scenario.runId),
                    )
                    .take(49)
            ).length,
        }));
        const fetchSpy = vi.fn();
        vi.stubGlobal("fetch", fetchSpy);
        vi.useFakeTimers();

        const asOwner = t.withIdentity({ subject: scenario.userId });
        const result = await asOwner.mutation(retryClaimGeneration, {
            runId: scenario.runId,
        });
        expect(result.status).toBe("retried");
        await t.finishAllScheduledFunctions(vi.runAllTimers);

        // The cloned partial row on the new generation carries the byte-identical
        // reason and remains claim-input terminal; no provider I/O happened.
        const clone = await t.run(async (ctx) => {
            const row = await ctx.db
                .query("evidenceSourceStatuses")
                .withIndex("by_run_corpus_generation_source", (query) =>
                    query
                        .eq("runId", scenario.runId)
                        .eq("corpusRevisionId", scenario.corpusRevisionId)
                        .eq("executionGeneration", 2)
                        .eq("sourceId", scenario.sourceId),
                )
                .unique();
            return row
                ? {
                      status: row.status,
                      failureReason: row.failureReason,
                      sourceVersionId: row.sourceVersionId,
                  }
                : null;
        });
        expect(clone?.status).toBe("partial");
        expect(clone?.failureReason).toBe(failureReason);
        expect(clone?.sourceVersionId).toBe(sourceVersionId);
        const countsAfter = await t.run(async (ctx) => ({
            providerCalls: (await ctx.db.query("providerCalls").take(100))
                .length,
            sourceVersions: (
                await ctx.db
                    .query("sourceVersions")
                    .withIndex("by_run", (query) =>
                        query.eq("runId", scenario.runId),
                    )
                    .take(49)
            ).length,
        }));
        expect(countsAfter).toEqual(countsBefore);
        expect(fetchSpy).not.toHaveBeenCalled();
    });
});
