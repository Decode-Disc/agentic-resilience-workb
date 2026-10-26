/// <reference types="vite/client" />
import type { Id } from "@convex/_generated/dataModel";
import { ASSESSMENT_DIMENSION_KEYS } from "@convex/domain/researchPlan";
import {
    clearShowcaseManifests,
    registerShowcaseManifest,
} from "@convex/domain/showcaseManifest";
import schema from "@convex/schema";
// Load Node dependencies before the workflow test environment removes process.
import "@convex/evidenceActions";
import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import rateLimiterTest from "../integrations/rate-limiter-test-register.js";
import workflowTest from "./workflow-test-register.js";

const modules = import.meta.glob("/convex/**/*.ts");

const startPhase5 = makeFunctionReference<
    "mutation",
    { runId: Id<"researchRuns">; requestKey: string },
    { acceptedSourceCount: number; executionGeneration: number }
>("evidenceExecution:start");

const retryClaimGeneration = makeFunctionReference<
    "mutation",
    { runId: Id<"researchRuns"> },
    { status: "unavailable" | "retried"; executionGeneration: number }
>("evidenceExecution:retryClaimGeneration");

const cancelRun = makeFunctionReference<
    "mutation",
    { runId: Id<"researchRuns"> },
    { cancelled: boolean }
>("workflowControls:cancel");

const getRun = makeFunctionReference<
    "query",
    { runId: Id<"researchRuns"> },
    any
>("researchRuns:get");

const listEvents = makeFunctionReference<
    "query",
    { runId: Id<"researchRuns"> },
    Array<any>
>("researchRuns:listEvents");

const getNormalizedClaimInput = makeFunctionReference<
    "query",
    { runId: Id<"researchRuns">; executionGeneration: number },
    { normalizedInput: any; inputHash: string } | null
>("claimGeneration:getNormalizedClaimInput");

const evidenceReadyHandoff = makeFunctionReference<
    "mutation",
    { runId: Id<"researchRuns">; executionGeneration: number },
    { outcome: "handed_off" | "failed_no_valid_claims" }
>("evidenceWorkflow:evidenceReadyHandoff");

const clearActiveWorkflowHandleOnSuccess = makeFunctionReference<
    "mutation",
    { runId: Id<"researchRuns">; workflowId: string },
    null
>("evidenceWorkflow:clearActiveWorkflowHandleOnSuccess");

type ScenarioSourceInput = {
    url: string;
    title: string;
    origin: "sec" | "exa" | "analyst_url";
    secAccessionNumber?: string;
    secForm?: string;
    secPrimaryDocument?: string;
};

async function createScenarioWithPlan(
    t: ReturnType<typeof convexTest>,
    options: { sources?: ScenarioSourceInput[] } = {},
) {
    const defaultSource: ScenarioSourceInput = {
        url: "https://www.sec.gov/Archives/edgar/data/1818201/000181820124000010/cccs-20231231.htm",
        title: "CCC 10-K",
        origin: "sec",
        secAccessionNumber: "0001818201-24-000010",
        secForm: "10-K",
        secPrimaryDocument: "cccs-20231231.htm",
    };
    const sources = options.sources?.length ? options.sources : [defaultSource];
    const data = await t.run(async (ctx) => {
        const userId = await ctx.db.insert("users", { isAnonymous: true });
        const invitationId = await ctx.db.insert("invitations", {
            slotKey: "analyst-p5wf",
            role: "analyst",
            codeDigest: "p5-digest",
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
            purpose: "research",
            ownerVisitorId: visitorId,
            companyId,
            coveragePreset: "balanced",
            lifecycleState: "corpus_approved",
            executionStatus: "idle",
            executionGeneration: 1,
            nextEventSequence: 1,
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
                prompt: `What public evidence addresses ${dimensionKey} for CCC?`,
                dimensionKeys: [dimensionKey],
                createdAt: 100,
            });
        }
        const sourceRecords = [];
        for (let index = 0; index < sources.length; index++) {
            const src = sources[index];
            if (!src) throw new Error("missing source");
            const sourceId = await ctx.db.insert("sources", {
                runId,
                canonicalUrl: src.url,
                title: src.title,
                origin: src.origin,
                category: "regulatory",
                secAccessionNumber: src.secAccessionNumber,
                secForm: src.secForm,
                secPrimaryDocument: src.secPrimaryDocument,
                providerReference: src.secAccessionNumber,
                createdAt: 101 + index,
            });
            const decisionId = await ctx.db.insert("sourceDecisions", {
                runId,
                corpusRevisionId,
                sourceId,
                decisionKey: `dec:p5wf:${sourceId}`,
                decision: "accepted",
                reviewerVisitorId: visitorId,
                occurredAt: 101 + index,
            });
            await ctx.db.insert("sourceReviewItems", {
                runId,
                corpusRevisionId,
                sourceId,
                decision: "accepted",
                decisionRank: index,
                sourceCreatedAt: 100,
                latestDecisionId: decisionId,
                decisionOccurredAt: 102 + index,
            });
            sourceRecords.push({ sourceId, decisionId, origin: src.origin });
        }
        const proposalId = await ctx.db.insert("sourceSelectionProposals", {
            runId,
            corpusRevisionId,
            version: 1,
            policyVersion: "source-selection-v6",
            coveragePreset: "balanced",
            recommendedTarget: 12,
            candidateFingerprint: "p5wf-fixture",
            status: "ready",
            counts: { recommended: 1, needsAttention: 0, alternative: 0 },
            gaps: [],
            createdAt: 100,
        });
        for (const record of sourceRecords) {
            await ctx.db.insert("sourceSelectionProposalItems", {
                runId,
                corpusRevisionId,
                proposalId,
                sourceId: record.sourceId,
                disposition: "recommended",
                sourceFamily: "regulatory",
                documentKind: "regulatory_annual",
                authorityTier: "regulator_primary",
                companyLinkageBasis: "structural",
                coverageContributions: ["regulatory_annual"],
                rank: 0,
                reasonCodes: ["required_family_coverage"],
                createdAt: 100,
            });
        }
        await ctx.db.patch(corpusRevisionId, {
            sourceSelectionProposalId: proposalId,
        });
        return {
            userId,
            visitorId,
            runId,
            corpusRevisionId,
            sourceRecords,
        };
    });
    return {
        ...data,
        asOwner: t.withIdentity({ subject: `${data.userId}|phase-5-session` }),
    };
}

const SAMPLE_10K_HTML = `
<!DOCTYPE html>
<html><head><title>CCC Intelligent Solutions 10-K</title></head>
<body>
    <h1>ITEM 1. BUSINESS</h1>
    <p>We process over 30 billion transactions annually across 30,000 participating ecosystem cornerstone institutions.</p>
    <p>Our multi-tenant cloud platform supports real-time claims routing and repair logistics.</p>
    <p>The company operates a proprietary historical claims database accumulated over decades.</p>
    <p>Disruption risk from OEM vehicle data capture depends on model adoption velocity which remains undetermined.</p>
</body>
</html>
`;

const SEC_SUBMISSIONS_JSON = JSON.stringify({
    csec: "0001818201",
    name: "CCC Intelligent Solutions Holdings Inc.",
    tickers: ["CCCS"],
    exchanges: ["Nasdaq"],
    filings: {
        recent: {
            accessionNumber: ["0001818201-24-000010"],
            form: ["10-K"],
            filingDate: ["2024-02-29"],
            primaryDocument: ["cccs-20231231.htm"],
        },
    },
});

function stubSecFetch() {
    return vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("/submissions/CIK")) {
            return new Response(SEC_SUBMISSIONS_JSON, {
                status: 200,
                headers: { "Content-Type": "application/json" },
            });
        }
        if (url.endsWith(".htm") || url.endsWith(".html")) {
            return new Response(SAMPLE_10K_HTML, {
                status: 200,
                headers: { "Content-Type": "text/html" },
            });
        }
        throw new Error(`Unexpected test URL: ${url}`);
    });
}

function stubSecFetchWithFailure(failUrls: Set<string>) {
    return vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("/submissions/CIK")) {
            return new Response(SEC_SUBMISSIONS_JSON, {
                status: 200,
                headers: { "Content-Type": "application/json" },
            });
        }
        if (failUrls.has(url)) {
            // Non-retryable upstream failure (404): the resolver surfaces a
            // terminal failed outcome without entering the retriable 5xx
            // back-off path, keeping the sibling branch's storage commit free
            // of retry-loop concurrency under the workflow test harness.
            return new Response("not found", {
                status: 404,
                headers: { "Content-Type": "text/html" },
            });
        }
        if (url.endsWith(".htm") || url.endsWith(".html")) {
            return new Response(SAMPLE_10K_HTML, {
                status: 200,
                headers: { "Content-Type": "text/html" },
            });
        }
        throw new Error(`Unexpected test URL: ${url}`);
    });
}

async function registerManifestAfterDispatch(
    t: ReturnType<typeof convexTest>,
    runId: Id<"researchRuns">,
    generation: number,
) {
    const input = await t.query(getNormalizedClaimInput, {
        runId,
        executionGeneration: generation,
    });
    if (!input) throw new Error("expected normalized claim input");
    const p0 = input.normalizedInput.passages[0];
    if (!p0) throw new Error("expected at least one passage");
    registerShowcaseManifest({
        fixtureId: "p5wf-fixture",
        fixtureVersion: "ccc-showcase-v1",
        schemaVersion: "claim-v1",
        adapterVersion: "showcase-adapter-v1",
        inputHash: input.inputHash,
        claims: [
            {
                statement:
                    "CCC processes over 30 billion transactions annually across its ecosystem.",
                classification: "Fact",
                evidence: [
                    {
                        quotationHash: p0.quotationHash,
                        passageKey: p0.passageKey,
                        sourceVersionHash: p0.sourceVersionHash,
                        relation: "supporting",
                    },
                ],
                dimensionLinks: [
                    { dimensionKey: "workflow_control", rationale: "" },
                ],
            },
        ],
    });
    return input;
}

describe("Phase 5 durable orchestration", () => {
    beforeEach(() => {
        process.env.SEC_USER_AGENT = "Evidence Workbench test@example.com";
        clearShowcaseManifests();
    });
    afterEach(() => {
        clearShowcaseManifests();
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    test("complete run reaches evidence_ready with a terminal claim pipeline and valid claim after durable retry", async () => {
        vi.useFakeTimers();
        const t = convexTest(schema, modules);
        workflowTest.register(t);
        rateLimiterTest.register(t);
        vi.stubGlobal("fetch", stubSecFetch());

        const scenario = await createScenarioWithPlan(t);
        const startRes = await scenario.asOwner.mutation(startPhase5, {
            runId: scenario.runId,
            requestKey: "p5wf-success",
        });

        // Phase 1: dispatch all frozen sources to terminal before claims. The
        // claim adapter is not yet authorized, so the first workflow pauses at
        // claim_generation_unavailable after the sources terminalize.
        await t.finishAllScheduledFunctions(vi.runAllTimers);

        // The claim input is now computable because every source committed a
        // reproducible passage; register the fixture adapter for that hash.
        await registerManifestAfterDispatch(
            t,
            scenario.runId,
            startRes.executionGeneration,
        );

        // Phase 2: durable resume exposes the claim+policy+strong-handoff path.
        const resume = await scenario.asOwner.mutation(retryClaimGeneration, {
            runId: scenario.runId,
        });
        expect(resume.status).toBe("retried");
        await t.finishAllScheduledFunctions(vi.runAllTimers);

        const run = await t.query(getRun, { runId: scenario.runId });
        expect(run.executionStatus).toBe("idle");
        expect(run.workflowId).toBeUndefined();
        const events = await t.query(listEvents, { runId: scenario.runId });
        expect(events.some((e) => e.type === "evidence_ready")).toBe(true);
        expect(events.some((e) => e.type === "claim_generation_paused")).toBe(
            true,
        );
        const statusRows = await t.run(async (ctx) =>
            ctx.db
                .query("evidenceSourceStatuses")
                .withIndex("by_run_and_execution_generation", (q) =>
                    q
                        .eq("runId", scenario.runId)
                        .eq("executionGeneration", resume.executionGeneration),
                )
                .take(49),
        );
        expect(statusRows.every((s) => s.status === "succeeded")).toBe(true);
    });

    test("one branch failed while another succeeds: pre-seeded failure + single success dispatch reaches ready", async () => {
        vi.useFakeTimers();
        const t = convexTest(schema, modules);
        workflowTest.register(t);
        rateLimiterTest.register(t);

        const okUrl =
            "https://www.sec.gov/Archives/edgar/data/1818201/000181820124000010/ok.htm";
        const failUrl =
            "https://www.sec.gov/Archives/edgar/data/1818201/000181820124000010/fail.htm";
        vi.stubGlobal("fetch", stubSecFetch());

        const scenario = await createScenarioWithPlan(t, {
            sources: [
                {
                    url: okUrl,
                    title: "CCC 10-K OK",
                    origin: "sec",
                    secAccessionNumber: "0001818201-24-000010",
                    secForm: "10-K",
                    secPrimaryDocument: "ok.htm",
                },
                {
                    url: failUrl,
                    title: "CCC 10-K FAIL",
                    origin: "sec",
                    secAccessionNumber: "0001818201-24-000011",
                    secForm: "10-K",
                    secPrimaryDocument: "fail.htm",
                },
            ],
        });
        const startRes = await scenario.asOwner.mutation(startPhase5, {
            runId: scenario.runId,
            requestKey: "p5wf-branch-fail",
        });
        expect(startRes.acceptedSourceCount).toBe(2);

        // Pre-seed one frozen branch as terminal failed before any dispatch
        // runs, so the workflow dispatches only the surviving source. This
        // exercises the mixed-terminal handoff path without launching two
        // concurrent storage writes under the convex-test harness.
        const failedRecord = scenario.sourceRecords[1];
        if (!failedRecord) throw new Error("expected a second source record");
        await t.run(async (ctx) => {
            const row = await ctx.db
                .query("evidenceSourceStatuses")
                .withIndex("by_run_and_execution_generation_and_source", (q) =>
                    q
                        .eq("runId", scenario.runId)
                        .eq("executionGeneration", startRes.executionGeneration)
                        .eq("sourceId", failedRecord.sourceId),
                )
                .unique();
            if (!row) throw new Error("expected frozen row for failed branch");
            await ctx.db.patch(row._id, {
                status: "failed",
                failureReason: "pre-seeded 404 from upstream",
                updatedAt: Date.now(),
            });
        });

        await t.finishAllScheduledFunctions(vi.runAllTimers);
        // One success branch committed passages, so claim input exists despite
        // the pre-seeded failed branch.
        await registerManifestAfterDispatch(
            t,
            scenario.runId,
            startRes.executionGeneration,
        );
        const resume = await scenario.asOwner.mutation(retryClaimGeneration, {
            runId: scenario.runId,
        });
        await t.finishAllScheduledFunctions(vi.runAllTimers);

        const run = await t.query(getRun, { runId: scenario.runId });
        expect(run.lifecycleState).toBe("evidence_ready");

        const statusRows = await t.run(async (ctx) =>
            ctx.db
                .query("evidenceSourceStatuses")
                .withIndex("by_run_and_execution_generation", (q) =>
                    q
                        .eq("runId", scenario.runId)
                        .eq("executionGeneration", resume.executionGeneration),
                )
                .take(49),
        );
        const statuses = statusRows.map((s) => s.status).sort();
        expect(
            statuses.every(
                (st) =>
                    st === "succeeded" || st === "failed" || st === "partial",
            ),
        ).toBe(true);
        expect(
            statuses.includes("failed") && statuses.includes("succeeded"),
        ).toBe(true);
    });

    test("all branches fail: typed failed/retryable outcome without claims", async () => {
        vi.useFakeTimers();
        const t = convexTest(schema, modules);
        workflowTest.register(t);
        rateLimiterTest.register(t);

        const failOne =
            "https://www.sec.gov/Archives/edgar/data/1818201/000181820124000010/fail-one.htm";
        const failTwo =
            "https://www.sec.gov/Archives/edgar/data/1818201/000181820124000010/fail-two.htm";
        vi.stubGlobal(
            "fetch",
            stubSecFetchWithFailure(new Set([failOne, failTwo])),
        );

        const scenario = await createScenarioWithPlan(t, {
            sources: [
                {
                    url: failOne,
                    title: "A",
                    origin: "sec",
                    secAccessionNumber: "0001818201-24-000012",
                    secForm: "10-K",
                    secPrimaryDocument: "fail-one.htm",
                },
                {
                    url: failTwo,
                    title: "B",
                    origin: "sec",
                    secAccessionNumber: "0001818201-24-000013",
                    secForm: "10-K",
                    secPrimaryDocument: "fail-two.htm",
                },
            ],
        });
        await scenario.asOwner.mutation(startPhase5, {
            runId: scenario.runId,
            requestKey: "p5wf-all-fail",
        });
        await t.finishAllScheduledFunctions(vi.runAllTimers);

        const run = await t.query(getRun, { runId: scenario.runId });
        expect(run.executionStatus).toBe("failed");
        expect(run.lifecycleState).toBe("extracting_evidence");
        expect(run.workflowId).toBeUndefined();
        const claimCount = await t.run(
            async (ctx) => (await ctx.db.query("claims").take(49)).length,
        );
        expect(claimCount).toBe(0);
        const events = await t.query(listEvents, { runId: scenario.runId });
        expect(events.some((e) => e.type === "run_failed")).toBe(true);
    });

    test("zero valid claims blocks handoff and routes to typed failed", async () => {
        vi.useFakeTimers();
        const t = convexTest(schema, modules);
        workflowTest.register(t);
        rateLimiterTest.register(t);
        vi.stubGlobal("fetch", stubSecFetch());

        const scenario = await createScenarioWithPlan(t);
        const startRes = await scenario.asOwner.mutation(startPhase5, {
            runId: scenario.runId,
            requestKey: "p5wf-zero-claims",
        });
        await t.finishAllScheduledFunctions(vi.runAllTimers);

        // Register a manifest whose only claim references a foreign quotation
        // hash so structural validation blocks it and zero claims commit.
        const input = await t.query(getNormalizedClaimInput, {
            runId: scenario.runId,
            executionGeneration: startRes.executionGeneration,
        });
        if (!input) throw new Error("expected input");
        registerShowcaseManifest({
            fixtureId: "p5wf-invalid",
            fixtureVersion: "ccc-showcase-v1",
            schemaVersion: "claim-v1",
            adapterVersion: "showcase-adapter-v1",
            inputHash: input.inputHash,
            claims: [
                {
                    statement: "Invalid claim, foreign evidence.",
                    classification: "Fact",
                    evidence: [
                        {
                            quotationHash: "foreign_nonexistent",
                            passageKey: "foreign_nonexistent",
                            sourceVersionHash: "foreign",
                            relation: "supporting",
                        },
                    ],
                    dimensionLinks: [{ dimensionKey: "context_ownership" }],
                },
            ],
        });
        const resume = await scenario.asOwner.mutation(retryClaimGeneration, {
            runId: scenario.runId,
        });
        // Retry itself succeeds in claiming the slot; the structural block
        // surfaces when the resumed workflow reaches claim generation.
        expect(resume.status).toBe("retried");
        await t.finishAllScheduledFunctions(vi.runAllTimers);

        const run = await t.query(getRun, { runId: scenario.runId });
        expect(run.executionStatus).toBe("failed");
        expect(run.lifecycleState).toBe("extracting_evidence");
        const claimCount = await t.run(
            async (ctx) => (await ctx.db.query("claims").take(49)).length,
        );
        expect(claimCount).toBe(0);
    });

    test("nonterminal branch blocks evidence handoff", async () => {
        vi.useFakeTimers();
        const t = convexTest(schema, modules);
        workflowTest.register(t);
        rateLimiterTest.register(t);

        const scenario = await createScenarioWithPlan(t);
        // Seed an extracting scope running with one queued (nonterminal) row.
        await t.run(async (ctx) => {
            await ctx.db.patch(scenario.runId, {
                lifecycleState: "extracting_evidence",
                executionStatus: "running",
                executionGeneration: 7,
            });
            const record = scenario.sourceRecords[0];
            if (!record) throw new Error("expected a source record");
            await ctx.db.insert("evidenceSourceStatuses", {
                runId: scenario.runId,
                corpusRevisionId: scenario.corpusRevisionId,
                sourceId: record.sourceId,
                acceptedDecisionId: record.decisionId,
                executionGeneration: 7,
                status: "queued",
                createdAt: 100,
                updatedAt: 100,
            });
        });
        await expect(
            t.mutation(evidenceReadyHandoff, {
                runId: scenario.runId,
                executionGeneration: 7,
            }),
        ).rejects.toThrow(/nonterminal/i);
    });

    test("cancellation before dispatch blocks evidence_ready and prevents late handoff", async () => {
        vi.useFakeTimers();
        const t = convexTest(schema, modules);
        workflowTest.register(t);
        rateLimiterTest.register(t);
        vi.stubGlobal("fetch", stubSecFetch());

        const scenario = await createScenarioWithPlan(t);
        await scenario.asOwner.mutation(startPhase5, {
            runId: scenario.runId,
            requestKey: "p5wf-cancel",
        });

        const cancelled = await scenario.asOwner.mutation(cancelRun, {
            runId: scenario.runId,
        });
        expect(cancelled.cancelled).toBe(true);
        // Drain the (now-cancelled) workflow; a stale run must never hand off.
        await t.finishAllScheduledFunctions(vi.runAllTimers);
        const run = await t.query(getRun, { runId: scenario.runId });
        expect(run.executionStatus).toBe("cancelled");
        expect(run.lifecycleState).not.toBe("evidence_ready");
        expect(run.workflowId).toBeUndefined();
    });

    test("stale generation cannot hand off", async () => {
        vi.useFakeTimers();
        const t = convexTest(schema, modules);
        const scenario = await createScenarioWithPlan(t);
        await t.run(async (ctx) => {
            await ctx.db.patch(scenario.runId, {
                lifecycleState: "extracting_evidence",
                executionStatus: "running",
                executionGeneration: 3,
            });
        });
        // A stale generation number while the run is on generation 3.
        await expect(
            t.mutation(evidenceReadyHandoff, {
                runId: scenario.runId,
                executionGeneration: 2,
            }),
        ).rejects.toThrow(/generation|extracting/i);
    });

    test("durable retry reuses the committed source version and storage; no new sourceVersion rows", async () => {
        vi.useFakeTimers();
        const t = convexTest(schema, modules);
        workflowTest.register(t);
        rateLimiterTest.register(t);
        vi.stubGlobal("fetch", stubSecFetch());

        const scenario = await createScenarioWithPlan(t);
        const startRes = await scenario.asOwner.mutation(startPhase5, {
            runId: scenario.runId,
            requestKey: "p5wf-dup",
        });
        await t.finishAllScheduledFunctions(vi.runAllTimers);
        await registerManifestAfterDispatch(
            t,
            scenario.runId,
            startRes.executionGeneration,
        );
        const countsBefore = await t.run(async (ctx) => ({
            sourceVersions: (
                await ctx.db
                    .query("sourceVersions")
                    .withIndex("by_run", (q) => q.eq("runId", scenario.runId))
                    .take(49)
            ).length,
            storage: (await ctx.db.system.query("_storage").take(100)).length,
        }));

        const resume2 = await scenario.asOwner.mutation(retryClaimGeneration, {
            runId: scenario.runId,
        });
        await t.finishAllScheduledFunctions(vi.runAllTimers);
        const run = await t.query(getRun, { runId: scenario.runId });
        expect(run.lifecycleState).toBe("evidence_ready");
        expect(resume2.status).toBe("retried");

        const countsAfter = await t.run(async (ctx) => ({
            sourceVersions: (
                await ctx.db
                    .query("sourceVersions")
                    .withIndex("by_run", (q) => q.eq("runId", scenario.runId))
                    .take(49)
            ).length,
            storage: (await ctx.db.system.query("_storage").take(100)).length,
        }));
        // The durable retry re-dispatches claim work while reusing the already
        // committed source version and storage object — never recreating them.
        expect(countsAfter).toEqual(countsBefore);
        expect(countsAfter.sourceVersions).toBe(1);
        expect(countsAfter.storage).toBe(1);
    });

    test("compare-and-clear does not erase a newer workflow handle", async () => {
        const t = convexTest(schema, modules);
        const scenario = await createScenarioWithPlan(t);
        await t.run(async (ctx) => {
            await ctx.db.patch(scenario.runId, { workflowId: "wf-newer" });
        });
        await t.mutation(clearActiveWorkflowHandleOnSuccess, {
            runId: scenario.runId,
            workflowId: "wf-older",
        });
        const run = await t.query(getRun, { runId: scenario.runId });
        expect(run.workflowId).toBe("wf-newer");
    });
});
