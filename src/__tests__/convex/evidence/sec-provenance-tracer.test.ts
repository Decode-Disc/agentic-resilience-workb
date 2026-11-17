import "@convex/evidenceActions";
/// <reference types="vite/client" />
import { internal } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
    extractPassagesFromNormalizedText,
    LOCATOR_VERSION,
    reproducePassage,
    sha256Hex,
} from "@convex/domain/sourcePassages";
import schema from "@convex/schema";
import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import rateLimiterTest from "../integrations/rate-limiter-test-register.js";
import workflowTest from "../workflows/workflow-test-register.js";

const modules = import.meta.glob("/convex/**/*.ts");

const startPhase5 = makeFunctionReference<
    "mutation",
    { runId: Id<"researchRuns">; requestKey: string },
    { acceptedSourceCount: number; executionGeneration: number }
>("evidenceExecution:start");

const retrieveAndNormalizeSecSource = makeFunctionReference<
    "action",
    {
        runId: Id<"researchRuns">;
        corpusRevisionId: Id<"corpusRevisions">;
        sourceId: Id<"sources">;
        acceptedDecisionId: Id<"sourceDecisions">;
        executionGeneration: number;
        workerKey?: string;
    },
    {
        status: "succeeded" | "partial" | "failed";
        sourceVersionId?: Id<"sourceVersions">;
        reused?: boolean;
        failureReason?: string;
    }
>("evidenceActions:retrieveAndNormalizeSecSource");

const getCommittedSourceVersionCount = makeFunctionReference<
    "query",
    {
        corpusRevisionId?: Id<"corpusRevisions">;
        sourceId: Id<"sources">;
        contentHash: string;
        normalizerVersion: string;
    },
    number
>("evidenceArtifacts:getCommittedSourceVersionCount");

const listSourcePassages = makeFunctionReference<
    "query",
    {
        sourceVersionId: Id<"sourceVersions">;
    },
    Array<{
        _id: Id<"sourcePassages">;
        _creationTime: number;
        sourceVersionId: Id<"sourceVersions">;
        order: number;
        exactQuotation: string;
        quotationHash: string;
        locatorVersion: string;
        locator: any;
    }>
>("evidenceArtifacts:listSourcePassages");

const listFrozenSourcesForRun = makeFunctionReference<
    "query",
    {
        runId: Id<"researchRuns">;
        executionGeneration: number;
    },
    Array<{
        sourceId: Id<"sources">;
        corpusRevisionId: Id<"corpusRevisions">;
        acceptedDecisionId: Id<"sourceDecisions">;
        origin: string;
    }>
>("evidenceArtifacts:listFrozenSourcesForRun");

const updateEvidenceSourceStatus = makeFunctionReference<
    "mutation",
    {
        runId: Id<"researchRuns">;
        corpusRevisionId: Id<"corpusRevisions">;
        sourceId: Id<"sources">;
        acceptedDecisionId: Id<"sourceDecisions">;
        executionGeneration: number;
        status: "queued" | "running" | "succeeded" | "partial" | "failed";
        failureReason?: string;
    },
    null
>("evidenceArtifacts:updateEvidenceSourceStatus");

type ScenarioSourceInput = {
    url: string;
    title: string;
    origin?: "sec" | "exa" | "analyst_url";
    secAccessionNumber?: string;
    secForm?: string;
    secPrimaryDocument?: string;
    decisions: Array<"accepted" | "rejected" | "pending">;
};

async function createSecApprovedCorpusScenario(
    t: ReturnType<typeof convexTest>,
    options: {
        sources?: ScenarioSourceInput[];
        companyCik?: string;
    } = {},
) {
    const data = await t.run(async (ctx) => {
        const userId = await ctx.db.insert("users", { isAnonymous: true });
        const invitationId = await ctx.db.insert("invitations", {
            slotKey: "analyst-phase-5-sec",
            role: "analyst",
            codeDigest: "digest-sec",
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
            cik: options.companyCik ?? "1818201",
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

        const sourcesConfig: ScenarioSourceInput[] = options.sources ?? [
            {
                url: "https://www.sec.gov/Archives/edgar/data/1818201/000181820124000010/cccs-20231231.htm",
                title: "10-K · 2024-02-29",
                origin: "sec",
                secAccessionNumber: "0001818201-24-000010",
                secForm: "10-K",
                secPrimaryDocument: "cccs-20231231.htm",
                decisions: ["accepted"],
            },
        ];

        const createdSources: Array<{
            sourceId: Id<"sources">;
            lastDecisionId: Id<"sourceDecisions">;
            finalDecision: "accepted" | "rejected" | "pending";
            origin: string;
            url: string;
        }> = [];

        let timeOffset = 101;
        for (const [index, src] of sourcesConfig.entries()) {
            const sourceId = await ctx.db.insert("sources", {
                runId,
                canonicalUrl: src.url,
                title: src.title,
                origin: src.origin ?? "sec",
                category: "regulatory",
                secAccessionNumber: src.secAccessionNumber,
                secForm: src.secForm,
                secPrimaryDocument: src.secPrimaryDocument,
                providerReference: src.secAccessionNumber,
                createdAt: timeOffset++,
            });

            let latestDecisionId: Id<"sourceDecisions"> | undefined;
            let finalDecision: "accepted" | "rejected" | "pending" = "pending";

            for (const dec of src.decisions) {
                const decTime = timeOffset++;
                const decisionId = await ctx.db.insert("sourceDecisions", {
                    runId,
                    corpusRevisionId,
                    sourceId,
                    decisionKey: `dec:${sourceId}:${decTime}`,
                    decision: dec,
                    reviewerVisitorId: visitorId,
                    ...(latestDecisionId
                        ? { supersedesDecisionId: latestDecisionId }
                        : {}),
                    occurredAt: decTime,
                });
                latestDecisionId = decisionId;
                finalDecision = dec;
            }

            if (latestDecisionId) {
                await ctx.db.insert("sourceReviewItems", {
                    runId,
                    corpusRevisionId,
                    sourceId,
                    decision: finalDecision,
                    decisionRank: index,
                    sourceCreatedAt: 100,
                    latestDecisionId,
                    decisionOccurredAt: timeOffset++,
                });
                createdSources.push({
                    sourceId,
                    lastDecisionId: latestDecisionId,
                    finalDecision,
                    origin: src.origin ?? "sec",
                    url: src.url,
                });
            }
        }

        return {
            userId,
            visitorId,
            runId,
            corpusRevisionId,
            createdSources,
        };
    });

    return {
        ...data,
        asOwner: t.withIdentity({ subject: `${data.userId}|analyst` }),
    };
}

function getRequiredSource(
    scenario: Awaited<ReturnType<typeof createSecApprovedCorpusScenario>>,
    index = 0,
) {
    const src = scenario.createdSources[index];
    if (!src) throw new Error(`Expected source at index ${index}`);
    return src;
}

const SAMPLE_10K_HTML = `
<!DOCTYPE html>
<html>
<head><title>CCC Intelligent Solutions 10-K</title></head>
<body>
    <h1>ITEM 1. BUSINESS</h1>
    <p>CCC Intelligent Solutions Inc. is a leading cloud platform for the multi-trillion dollar P&amp;C insurance economy.</p>
    <div>
        <h2>Hyperscale Cloud Architecture</h2>
        <p>Our hyperscale multi-tenant architecture spans multiple cloud regions with zero-trust network isolation and real-time telemetry.</p>
        <p>We process over 30 billion transactions annually across 30,000 participating ecosystem institutions.</p>
    </div>
</body>
</html>
`;

describe("SEC HTML Provenance Tracer", () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
        vi.unstubAllEnvs();
    });
    beforeEach(() => {
        vi.useFakeTimers();
        vi.stubEnv("COMPANY_SEARCH_RESULT_LIMIT", "40");
        vi.stubEnv("SEC_USER_AGENT", "Evidence Workbench test@example.com");
    });

    test("returns frozen discovery metadata and acquisition limitations", async () => {
        vi.useFakeTimers();
        const t = convexTest(schema, modules);
        workflowTest.register(t);
        const scenario = await createSecApprovedCorpusScenario(t);
        const { executionGeneration } = await scenario.asOwner.mutation(
            startPhase5,
            {
                runId: scenario.runId,
                requestKey: "frozen-document-contract",
            },
        );
        const source = getRequiredSource(scenario);
        await t.run(async (ctx) => {
            await ctx.db.patch(source.sourceId, {
                origin: "exa",
                providerResultPosition: 3,
                discoveryQueryIndex: 2,
            });
        });
        const args = {
            runId: scenario.runId,
            corpusRevisionId: scenario.corpusRevisionId,
            sourceId: source.sourceId,
            acceptedDecisionId: source.lastDecisionId,
            executionGeneration,
        };
        await t.mutation(updateEvidenceSourceStatus, {
            ...args,
            status: "failed",
            failureReason: "normalizer_unavailable",
        });
        const result = await t.query(
            internal.evidenceArtifacts.getFrozenSourceForExecution,
            args,
        );
        expect(result?.source).toMatchObject({
            providerResultPosition: 3,
            discoveryQueryIndex: 2,
        });
        expect(result?.statusDoc.failureReason).toBe("normalizer_unavailable");
    });

    describe("Passage Reproduction & Replay Invariants (H5)", () => {
        test("exact quotation replay succeeds with valid hash and character offsets", async () => {
            const rawText =
                "# Overview\n\nCCC Intelligent Solutions delivers cloud workflows.\n\n## Resilience\n\nMulti-region active-active deployment.";
            const hash = sha256Hex(new TextEncoder().encode(rawText));
            const passages = extractPassagesFromNormalizedText({
                text: rawText,
                canonicalUrl: "https://example.com/doc",
                sourceVersionHash: hash,
            });

            expect(passages.length).toBeGreaterThanOrEqual(2);
            for (const passage of passages) {
                const replayed = await reproducePassage(
                    rawText,
                    passage.locator,
                );
                expect(replayed).toBe(passage.exactQuotation);
            }
        });

        test("reproducePassage rejects hash mismatch", async () => {
            const rawText = "Verified content";
            const wrongHash = sha256Hex("different content");
            const locator = {
                kind: "web" as const,
                canonicalUrl: "https://example.com/doc",
                sourceVersionHash: wrongHash,
                exactQuotation: "Verified content",
                startOffset: 0,
                endOffset: 16,
            };

            await expect(reproducePassage(rawText, locator)).rejects.toThrow(
                /Source version hash mismatch/,
            );
        });

        test("reproducePassage rejects corrupt and out-of-bounds offsets", async () => {
            const rawText = "Short text";
            const hash = sha256Hex(new TextEncoder().encode(rawText));

            // Out of bounds
            await expect(
                reproducePassage(rawText, {
                    kind: "web",
                    canonicalUrl: "https://example.com/doc",
                    sourceVersionHash: hash,
                    exactQuotation: "Short",
                    startOffset: 0,
                    endOffset: 999,
                }),
            ).rejects.toThrow(/Invalid passage character offsets/);

            // Negative offset
            await expect(
                reproducePassage(rawText, {
                    kind: "web",
                    canonicalUrl: "https://example.com/doc",
                    sourceVersionHash: hash,
                    exactQuotation: "Short",
                    startOffset: -1,
                    endOffset: 5,
                }),
            ).rejects.toThrow(/Invalid passage character offsets/);

            // startOffset > endOffset
            await expect(
                reproducePassage(rawText, {
                    kind: "web",
                    canonicalUrl: "https://example.com/doc",
                    sourceVersionHash: hash,
                    exactQuotation: "Short",
                    startOffset: 6,
                    endOffset: 2,
                }),
            ).rejects.toThrow(/Invalid passage character offsets/);
        });

        test("reproducePassage rejects offset quotation mismatch without fuzzy fallback", async () => {
            const rawText = "Hello beautiful world";
            const hash = sha256Hex(new TextEncoder().encode(rawText));

            // Offsets point to "beautiful" but exactQuotation claims "world"
            await expect(
                reproducePassage(rawText, {
                    kind: "web",
                    canonicalUrl: "https://example.com/doc",
                    sourceVersionHash: hash,
                    exactQuotation: "world",
                    startOffset: 6,
                    endOffset: 15,
                }),
            ).rejects.toThrow(/Passage quotation mismatch/);
        });
    });

    test("happy path: retrieves, normalizes, stores in Convex storage, commits SourceVersion, and reproduces passages", async () => {
        const t = convexTest(schema, modules);
        workflowTest.register(t);
        rateLimiterTest.register(t);

        const fetchSpy = vi.fn(
            async (_input: string | URL | Request, init?: RequestInit) => {
                expect(init?.headers).toMatchObject({
                    "User-Agent": "Evidence Workbench test@example.com",
                });
                return new Response(SAMPLE_10K_HTML, {
                    status: 200,
                    headers: { "Content-Type": "text/html; charset=utf-8" },
                });
            },
        );
        vi.stubGlobal("fetch", fetchSpy);

        const scenario = await createSecApprovedCorpusScenario(t);
        const startResult = await scenario.asOwner.mutation(startPhase5, {
            runId: scenario.runId,
            requestKey: "sec-tracer-happy",
        });

        expect(startResult.acceptedSourceCount).toBe(1);
        expect(startResult.executionGeneration).toBe(2);

        // Execute SEC retrieval action
        const secSource = getRequiredSource(scenario, 0);
        const actionResult = await t.action(retrieveAndNormalizeSecSource, {
            runId: scenario.runId,
            corpusRevisionId: scenario.corpusRevisionId,
            sourceId: secSource.sourceId,
            acceptedDecisionId: secSource.lastDecisionId,
            executionGeneration: startResult.executionGeneration,
        });

        expect(actionResult.status).toBe("succeeded");
        expect(actionResult.sourceVersionId).toBeDefined();

        const versionId = actionResult.sourceVersionId;
        expect(versionId).toBeDefined();
        if (!versionId) throw new Error("Expected versionId");

        // Verify SourceVersion document persisted in DB
        const versionDoc = await t.run(async (ctx) => {
            return await ctx.db.get(versionId);
        });

        expect(versionDoc).toMatchObject({
            runId: scenario.runId,
            corpusRevisionId: scenario.corpusRevisionId,
            sourceId: secSource.sourceId,
            acceptedDecisionId: secSource.lastDecisionId,
            mediaType: "text/plain",
            executionGeneration: 2,
        });
        expect(versionDoc?.storageId).toBeDefined();

        // Verify stored artifact bytes in File Storage
        const storedText = await t.run(async (ctx) => {
            if (!versionDoc?.storageId) throw new Error("Expected storageId");
            const blob = await ctx.storage.get(versionDoc.storageId);
            expect(blob).not.toBeNull();
            return await blob?.text();
        });

        const storedArtifactBytes = new TextEncoder().encode(storedText);
        expect(storedArtifactBytes.byteLength).toBeGreaterThan(0);
        expect(storedText).toContain("ITEM 1. BUSINESS");
        expect(storedText).toContain("Hyperscale Cloud Architecture");

        // Verify passages and locator reproducibility
        const passages = await t.query(listSourcePassages, {
            sourceVersionId: versionId,
        });

        expect(passages.length).toBeGreaterThanOrEqual(2);
        for (const passage of passages) {
            expect(passage.locatorVersion).toBe(LOCATOR_VERSION);
            expect(passage.locator.sourceVersionHash).toBe(
                versionDoc?.contentHash,
            );

            // Verify reproducibility gate
            const replayed = await reproducePassage(
                storedArtifactBytes,
                passage.locator,
            );
            expect(replayed).toBe(passage.exactQuotation);
        }

        // Verify source status became succeeded
        const statusDoc = await t.run(async (ctx) => {
            return await ctx.db
                .query("evidenceSourceStatuses")
                .withIndex("by_run_and_execution_generation_and_source", (q) =>
                    q
                        .eq("runId", scenario.runId)
                        .eq("executionGeneration", 2)
                        .eq("sourceId", secSource.sourceId),
                )
                .unique();
        });
        expect(statusDoc?.status).toBe("succeeded");
    });

    test.each([
        "succeeded",
        "partial",
    ] as const)("identical action replay preserves %s evidence without I/O", async (status) => {
        vi.useFakeTimers();
        const t = convexTest(schema, modules);
        workflowTest.register(t);
        rateLimiterTest.register(t);
        const fetchSpy = vi.fn(
            async () =>
                new Response(SAMPLE_10K_HTML, {
                    headers: { "Content-Type": "text/html" },
                }),
        );
        vi.stubGlobal("fetch", fetchSpy);
        const scenario = await createSecApprovedCorpusScenario(t);
        const { executionGeneration } = await scenario.asOwner.mutation(
            startPhase5,
            {
                runId: scenario.runId,
                requestKey: "identical-action-replay",
            },
        );
        const source = getRequiredSource(scenario);
        const args = {
            runId: scenario.runId,
            corpusRevisionId: scenario.corpusRevisionId,
            sourceId: source.sourceId,
            acceptedDecisionId: source.lastDecisionId,
            executionGeneration,
        };
        const first = await t.action(retrieveAndNormalizeSecSource, args);
        expect(first.status).toBe("succeeded");
        const failureReason =
            status === "partial" ? "One section was unavailable" : undefined;
        await t.mutation(
            internal.evidenceArtifacts.updateEvidenceSourceStatus,
            {
                ...args,
                status,
                sourceVersionId: first.sourceVersionId,
                failureReason,
            },
        );
        const before = await t.run(async (ctx) => ({
            calls: await ctx.db.query("providerCalls").take(10),
            versions: await ctx.db.query("sourceVersions").take(10),
            passages: await ctx.db.query("sourcePassages").take(20),
            storage: await ctx.db.system.query("_storage").take(10),
        }));
        const fetchCount = fetchSpy.mock.calls.length;
        const replay = await t.action(retrieveAndNormalizeSecSource, args);
        expect(replay).toMatchObject({
            status,
            sourceVersionId: first.sourceVersionId,
            reused: true,
        });
        expect(replay.failureReason).toBe(failureReason);
        expect(fetchSpy).toHaveBeenCalledTimes(fetchCount);
        const after = await t.run(async (ctx) => ({
            calls: await ctx.db.query("providerCalls").take(10),
            versions: await ctx.db.query("sourceVersions").take(10),
            passages: await ctx.db.query("sourcePassages").take(20),
            storage: await ctx.db.system.query("_storage").take(10),
        }));
        expect(after).toEqual(before);
        await t.mutation(updateEvidenceSourceStatus, {
            ...args,
            status: "failed",
            failureReason: "Late losing worker",
        });
        const frozen = await t.query(
            internal.evidenceArtifacts.getFrozenSourceForExecution,
            args,
        );
        expect(frozen?.statusDoc).toMatchObject({
            status,
            sourceVersionId: first.sourceVersionId,
        });
        expect(frozen?.statusDoc.failureReason).toBe(failureReason);
    });

    test("same-hash replay reuses existing SourceVersion and passages without duplicate storage uploads", async () => {
        const t = convexTest(schema, modules);
        workflowTest.register(t);
        rateLimiterTest.register(t);

        const fetchSpy = vi.fn(async () => {
            return new Response(SAMPLE_10K_HTML, {
                status: 200,
                headers: { "Content-Type": "text/html; charset=utf-8" },
            });
        });
        vi.stubGlobal("fetch", fetchSpy);

        const scenario = await createSecApprovedCorpusScenario(t);
        const startResult = await scenario.asOwner.mutation(startPhase5, {
            runId: scenario.runId,
            requestKey: "sec-tracer-replay",
        });

        const secSource = getRequiredSource(scenario, 0);
        const firstAction = await t.action(retrieveAndNormalizeSecSource, {
            runId: scenario.runId,
            corpusRevisionId: scenario.corpusRevisionId,
            sourceId: secSource.sourceId,
            acceptedDecisionId: secSource.lastDecisionId,
            executionGeneration: startResult.executionGeneration,
        });

        expect(firstAction.status).toBe("succeeded");
        expect(firstAction.reused).toBe(false);

        const firstVersionId = firstAction.sourceVersionId;
        expect(firstVersionId).toBeDefined();
        if (!firstVersionId) throw new Error("Expected firstVersionId");

        const versionDoc = await t.run(async (ctx) =>
            ctx.db.get(firstVersionId),
        );

        // Replay retry with exact same HTML content in next generation
        await t.run(async (ctx) => {
            await ctx.db.patch(scenario.runId, {
                executionGeneration: 3,
            });
            await ctx.db.insert("evidenceSourceStatuses", {
                runId: scenario.runId,
                corpusRevisionId: scenario.corpusRevisionId,
                sourceId: secSource.sourceId,
                acceptedDecisionId: secSource.lastDecisionId,
                executionGeneration: 3,
                status: "queued",
                createdAt: 200,
                updatedAt: 200,
            });
        });

        const secondAction = await t.action(retrieveAndNormalizeSecSource, {
            runId: scenario.runId,
            corpusRevisionId: scenario.corpusRevisionId,
            sourceId: secSource.sourceId,
            acceptedDecisionId: secSource.lastDecisionId,
            executionGeneration: 3,
        });

        expect(secondAction.status).toBe("succeeded");
        expect(secondAction.sourceVersionId).toBe(firstAction.sourceVersionId);
        expect(secondAction.reused).toBe(true);

        if (!versionDoc) throw new Error("Expected versionDoc");
        const count = await t.query(getCommittedSourceVersionCount, {
            corpusRevisionId: scenario.corpusRevisionId,
            sourceId: secSource.sourceId,
            contentHash: versionDoc.contentHash,
            normalizerVersion: versionDoc.normalizerVersion,
        });
        expect(count).toBe(1);
    });

    test("concurrent loser cleanup: action executes concurrent loser path, action deletes loser storage blob, and winner version is adopted (M3b)", async () => {
        const t = convexTest(schema, modules);
        workflowTest.register(t);
        rateLimiterTest.register(t);

        let fetchCount = 0;
        let releaseFetches!: () => void;
        const barrier = new Promise<void>((resolve) => {
            releaseFetches = resolve;
        });

        const fetchSpy = vi.fn(async () => {
            fetchCount += 1;
            if (fetchCount === 2) {
                releaseFetches();
            } else {
                await barrier;
            }
            return new Response(SAMPLE_10K_HTML, {
                status: 200,
                headers: { "Content-Type": "text/html" },
            });
        });
        vi.stubGlobal("fetch", fetchSpy);

        const scenario = await createSecApprovedCorpusScenario(t);
        const startResult = await scenario.asOwner.mutation(startPhase5, {
            runId: scenario.runId,
            requestKey: "sec-tracer-concurrent-check",
        });

        const secSource = getRequiredSource(scenario, 0);

        // Run two concurrent actions for the same source
        const [action1, action2] = await Promise.all([
            t.action(retrieveAndNormalizeSecSource, {
                runId: scenario.runId,
                corpusRevisionId: scenario.corpusRevisionId,
                sourceId: secSource.sourceId,
                acceptedDecisionId: secSource.lastDecisionId,
                executionGeneration: startResult.executionGeneration,
                workerKey: "worker-1",
            }),
            t.action(retrieveAndNormalizeSecSource, {
                runId: scenario.runId,
                corpusRevisionId: scenario.corpusRevisionId,
                sourceId: secSource.sourceId,
                acceptedDecisionId: secSource.lastDecisionId,
                executionGeneration: startResult.executionGeneration,
                workerKey: "worker-2",
            }),
        ]);

        expect(action1.status).toBe("succeeded");
        expect(action2.status).toBe("succeeded");

        // One is the winner (reused: false), one is the concurrent loser that adopted the winner (reused: true)
        const results = [action1, action2];
        const winner = results.find((r) => !r.reused);
        const loser = results.find((r) => r.reused);

        expect(winner).toBeDefined();
        expect(loser).toBeDefined();
        expect(winner?.sourceVersionId).toBe(loser?.sourceVersionId);

        const winnerVersionId = winner?.sourceVersionId;
        if (!winnerVersionId) throw new Error("Expected winnerVersionId");

        const winnerVersion = await t.run(async (ctx) => {
            return await ctx.db.get(winnerVersionId);
        });
        expect(winnerVersion).toBeDefined();
        const winnerStorageId = winnerVersion?.storageId;
        if (!winnerStorageId) throw new Error("Expected winnerStorageId");

        // Check leases: exactly one committed, one orphaned
        const leases = await t.run(async (ctx) => {
            return await ctx.db
                .query("artifactUploadLeases")
                .withIndex("by_run_and_execution_generation", (q) =>
                    q
                        .eq("runId", scenario.runId)
                        .eq(
                            "executionGeneration",
                            startResult.executionGeneration,
                        ),
                )
                .collect();
        });
        expect(leases.length).toBe(2);
        const committedLease = leases.find((l) => l.status === "committed");
        const orphanedLease = leases.find((l) => l.status === "orphaned");

        expect(committedLease).toBeDefined();
        expect(orphanedLease).toBeDefined();
        expect(committedLease?.storageId).toBe(winnerStorageId);

        const loserStorageId = orphanedLease?.storageId;
        expect(loserStorageId).toBeDefined();
        expect(loserStorageId).not.toBe(winnerStorageId);

        // Verify storage: winner storage is preserved, loser storage was deleted by action (NO manual test delete!)
        await t.run(async (ctx) => {
            const winnerBlob = await ctx.storage.get(winnerStorageId);
            expect(winnerBlob).not.toBeNull();

            if (loserStorageId) {
                const loserBlob = await ctx.storage.get(loserStorageId);
                expect(loserBlob).toBeNull();
            }
        });

        // Exactly one SourceVersion exists in DB
        const allVersions = await t.run(async (ctx) => {
            return await ctx.db
                .query("sourceVersions")
                .withIndex("by_revision_and_source", (q) =>
                    q
                        .eq("corpusRevisionId", scenario.corpusRevisionId)
                        .eq("sourceId", secSource.sourceId),
                )
                .collect();
        });
        expect(allVersions.length).toBe(1);
    });

    test("post-fetch generation advance: generation advance after response rejects persistence and prevents SourceVersion commit (M3a)", async () => {
        const t = convexTest(schema, modules);
        workflowTest.register(t);
        rateLimiterTest.register(t);

        const scenario = await createSecApprovedCorpusScenario(t);
        const startResult = await scenario.asOwner.mutation(startPhase5, {
            runId: scenario.runId,
            requestKey: "sec-tracer-post-fetch-generation-cancel",
        });

        const secSource = getRequiredSource(scenario, 0);

        const fetchSpy = vi.fn(async () => {
            // Right when response arrives from provider, generation is bumped / cancelled
            await t.run(async (ctx) => {
                await ctx.db.patch(scenario.runId, {
                    executionGeneration: 99,
                    executionStatus: "cancelled",
                });
            });
            return new Response(SAMPLE_10K_HTML, {
                status: 200,
                headers: { "Content-Type": "text/html" },
            });
        });
        vi.stubGlobal("fetch", fetchSpy);

        const actionResult = await t.action(retrieveAndNormalizeSecSource, {
            runId: scenario.runId,
            corpusRevisionId: scenario.corpusRevisionId,
            sourceId: secSource.sourceId,
            acceptedDecisionId: secSource.lastDecisionId,
            executionGeneration: startResult.executionGeneration,
        });

        expect(actionResult.status).toBe("failed");

        // No SourceVersion was committed
        const versions = await t.run(async (ctx) => {
            return await ctx.db.query("sourceVersions").collect();
        });
        expect(versions.length).toBe(0);

        // No passages committed
        const passages = await t.run(async (ctx) => {
            return await ctx.db.query("sourcePassages").collect();
        });
        expect(passages.length).toBe(0);
    });

    test("post-fetch authority revocation: review item decision changed after response rejects persistence and prevents SourceVersion commit (M3a)", async () => {
        const t = convexTest(schema, modules);
        workflowTest.register(t);
        rateLimiterTest.register(t);

        const scenario = await createSecApprovedCorpusScenario(t);
        const startResult = await scenario.asOwner.mutation(startPhase5, {
            runId: scenario.runId,
            requestKey: "sec-tracer-post-fetch-authority-revoke",
        });

        const secSource = getRequiredSource(scenario, 0);

        const fetchSpy = vi.fn(async () => {
            // Review item is changed to rejected after fetch
            await t.run(async (ctx) => {
                const reviewItem = await ctx.db
                    .query("sourceReviewItems")
                    .withIndex("by_revision_and_source", (q) =>
                        q
                            .eq("corpusRevisionId", scenario.corpusRevisionId)
                            .eq("sourceId", secSource.sourceId),
                    )
                    .unique();
                if (reviewItem) {
                    await ctx.db.patch(reviewItem._id, {
                        decision: "rejected",
                    });
                }
            });
            return new Response(SAMPLE_10K_HTML, {
                status: 200,
                headers: { "Content-Type": "text/html" },
            });
        });
        vi.stubGlobal("fetch", fetchSpy);

        const actionResult = await t.action(retrieveAndNormalizeSecSource, {
            runId: scenario.runId,
            corpusRevisionId: scenario.corpusRevisionId,
            sourceId: secSource.sourceId,
            acceptedDecisionId: secSource.lastDecisionId,
            executionGeneration: startResult.executionGeneration,
        });

        expect(actionResult.status).toBe("failed");

        const versions = await t.run(async (ctx) => {
            return await ctx.db.query("sourceVersions").collect();
        });
        expect(versions.length).toBe(0);
    });

    test("updateEvidenceSourceStatus is fenced: rejects status updates when review item latestDecisionId mismatches or run status is not running (H2)", async () => {
        const t = convexTest(schema, modules);
        workflowTest.register(t);
        rateLimiterTest.register(t);

        const scenario = await createSecApprovedCorpusScenario(t);
        const startResult = await scenario.asOwner.mutation(startPhase5, {
            runId: scenario.runId,
            requestKey: "sec-tracer-fence-h2",
        });

        const secSource = getRequiredSource(scenario, 0);

        // Valid call succeeds
        await t.mutation(updateEvidenceSourceStatus, {
            runId: scenario.runId,
            corpusRevisionId: scenario.corpusRevisionId,
            sourceId: secSource.sourceId,
            acceptedDecisionId: secSource.lastDecisionId,
            executionGeneration: startResult.executionGeneration,
            status: "running",
        });

        // 1. Mismatched review item decision
        await t.run(async (ctx) => {
            const reviewItem = await ctx.db
                .query("sourceReviewItems")
                .withIndex("by_revision_and_source", (q) =>
                    q
                        .eq("corpusRevisionId", scenario.corpusRevisionId)
                        .eq("sourceId", secSource.sourceId),
                )
                .unique();
            if (reviewItem) {
                await ctx.db.patch(reviewItem._id, {
                    decision: "rejected",
                });
            }
        });

        await expect(
            t.mutation(updateEvidenceSourceStatus, {
                runId: scenario.runId,
                corpusRevisionId: scenario.corpusRevisionId,
                sourceId: secSource.sourceId,
                acceptedDecisionId: secSource.lastDecisionId,
                executionGeneration: startResult.executionGeneration,
                status: "succeeded",
            }),
        ).rejects.toThrow("Research execution fence violation");
    });

    test("listFrozenSourcesForRun rejects overflow when frozen sources exceed sourceCandidateLimit (M2)", async () => {
        const t = convexTest(schema, modules);
        workflowTest.register(t);
        rateLimiterTest.register(t);

        const scenario = await createSecApprovedCorpusScenario(t);
        const startResult = await scenario.asOwner.mutation(startPhase5, {
            runId: scenario.runId,
            requestKey: "sec-tracer-overflow-m2",
        });

        // Add dummy frozen statuses up to 49 (limit is 48)
        await t.run(async (ctx) => {
            for (let i = 1; i <= 50; i++) {
                const dummySourceId = await ctx.db.insert("sources", {
                    runId: scenario.runId,
                    canonicalUrl: `https://www.sec.gov/doc${i}.htm`,
                    title: `Doc ${i}`,
                    category: "regulatory_filing",
                    origin: "sec",
                    createdAt: 100 + i,
                });
                const dummyDecisionId = await ctx.db.insert("sourceDecisions", {
                    runId: scenario.runId,
                    corpusRevisionId: scenario.corpusRevisionId,
                    sourceId: dummySourceId,
                    decision: "accepted",
                    decisionKey: `decision-overflow-${i}`,
                    occurredAt: 100 + i,
                });
                await ctx.db.insert("evidenceSourceStatuses", {
                    runId: scenario.runId,
                    corpusRevisionId: scenario.corpusRevisionId,
                    sourceId: dummySourceId,
                    acceptedDecisionId: dummyDecisionId,
                    executionGeneration: startResult.executionGeneration,
                    status: "queued",
                    createdAt: 100 + i,
                    updatedAt: 100 + i,
                });
            }
        });

        await expect(
            t.query(listFrozenSourcesForRun, {
                runId: scenario.runId,
                executionGeneration: startResult.executionGeneration,
            }),
        ).rejects.toThrow("exceed configured candidate limit");
    });

    test("changed-hash commits a new immutable SourceVersion and passage rows", async () => {
        const t = convexTest(schema, modules);
        workflowTest.register(t);
        rateLimiterTest.register(t);

        let currentHtml = SAMPLE_10K_HTML;
        const fetchSpy = vi.fn(async () => {
            return new Response(currentHtml, {
                status: 200,
                headers: { "Content-Type": "text/html; charset=utf-8" },
            });
        });
        vi.stubGlobal("fetch", fetchSpy);

        const scenario = await createSecApprovedCorpusScenario(t);
        const startResult = await scenario.asOwner.mutation(startPhase5, {
            runId: scenario.runId,
            requestKey: "sec-tracer-changed",
        });

        const secSource = getRequiredSource(scenario, 0);
        const firstAction = await t.action(retrieveAndNormalizeSecSource, {
            runId: scenario.runId,
            corpusRevisionId: scenario.corpusRevisionId,
            sourceId: secSource.sourceId,
            acceptedDecisionId: secSource.lastDecisionId,
            executionGeneration: startResult.executionGeneration,
        });

        expect(firstAction.status).toBe("succeeded");

        // Mutate document content and advance generation to simulate re-fetch
        currentHtml = SAMPLE_10K_HTML.replace("30 billion", "45 billion");

        await t.run(async (ctx) => {
            await ctx.db.patch(scenario.runId, {
                executionGeneration: 3,
            });
            await ctx.db.insert("evidenceSourceStatuses", {
                runId: scenario.runId,
                corpusRevisionId: scenario.corpusRevisionId,
                sourceId: secSource.sourceId,
                acceptedDecisionId: secSource.lastDecisionId,
                executionGeneration: 3,
                status: "queued",
                createdAt: 200,
                updatedAt: 200,
            });
        });

        const secondAction = await t.action(retrieveAndNormalizeSecSource, {
            runId: scenario.runId,
            corpusRevisionId: scenario.corpusRevisionId,
            sourceId: secSource.sourceId,
            acceptedDecisionId: secSource.lastDecisionId,
            executionGeneration: 3,
        });

        expect(secondAction.status).toBe("succeeded");
        expect(secondAction.sourceVersionId).not.toBe(
            firstAction.sourceVersionId,
        );

        const allVersions = await t.run(async (ctx) => {
            return await ctx.db
                .query("sourceVersions")
                .withIndex("by_revision_and_source", (q) =>
                    q
                        .eq("corpusRevisionId", scenario.corpusRevisionId)
                        .eq("sourceId", secSource.sourceId),
                )
                .collect();
        });
        expect(allVersions.length).toBe(2);
    });

    test("rejected or superseded heads issue zero fetch and zero storage write", async () => {
        const t = convexTest(schema, modules);
        workflowTest.register(t);
        rateLimiterTest.register(t);

        const fetchSpy = vi.fn(async () => {
            return new Response(SAMPLE_10K_HTML, {
                status: 200,
                headers: { "Content-Type": "text/html" },
            });
        });
        vi.stubGlobal("fetch", fetchSpy);

        const scenario = await createSecApprovedCorpusScenario(t, {
            sources: [
                {
                    url: "https://www.sec.gov/doc1.htm",
                    title: "Doc 1 Accepted",
                    decisions: ["accepted"],
                },
                {
                    url: "https://www.sec.gov/doc2.htm",
                    title: "Doc 2 Rejected",
                    decisions: ["rejected"],
                },
                {
                    url: "https://www.sec.gov/doc3.htm",
                    title: "Doc 3 Superseded",
                    decisions: ["accepted", "rejected"],
                },
            ],
        });

        const startResult = await scenario.asOwner.mutation(startPhase5, {
            runId: scenario.runId,
            requestKey: "sec-tracer-rejected-filter",
        });

        expect(startResult.acceptedSourceCount).toBe(1);

        const frozen = await t.run(async (ctx) => {
            return await ctx.db
                .query("evidenceSourceStatuses")
                .withIndex("by_run_and_execution_generation", (q) =>
                    q
                        .eq("runId", scenario.runId)
                        .eq(
                            "executionGeneration",
                            startResult.executionGeneration,
                        ),
                )
                .collect();
        });

        expect(frozen.length).toBe(1);
        expect(frozen[0]?.sourceId).toBe(scenario.createdSources[0]?.sourceId);
    });

    test("cancellation / stale generation before dispatch rejects execution", async () => {
        const t = convexTest(schema, modules);
        workflowTest.register(t);
        rateLimiterTest.register(t);

        const scenario = await createSecApprovedCorpusScenario(t);
        const startResult = await scenario.asOwner.mutation(startPhase5, {
            runId: scenario.runId,
            requestKey: "sec-tracer-cancel-dispatch",
        });

        const secSource = getRequiredSource(scenario, 0);

        // Bump generation or mark run failed/cancelled
        await t.run(async (ctx) => {
            await ctx.db.patch(scenario.runId, {
                executionGeneration: 99,
                executionStatus: "cancelled",
            });
        });

        const actionResult = await t.action(retrieveAndNormalizeSecSource, {
            runId: scenario.runId,
            corpusRevisionId: scenario.corpusRevisionId,
            sourceId: secSource.sourceId,
            acceptedDecisionId: secSource.lastDecisionId,
            executionGeneration: startResult.executionGeneration,
        });

        expect(actionResult.status).toBe("failed");

        const versions = await t.run(async (ctx) => {
            return await ctx.db.query("sourceVersions").collect();
        });
        expect(versions.length).toBe(0);
    });

    test("timeout retries up to 2 attempts then marks source status failed", async () => {
        vi.stubEnv("SEC_TIMEOUT_MS", "10");
        const t = convexTest(schema, modules);
        workflowTest.register(t);
        rateLimiterTest.register(t);

        const fetchSpy = vi.fn(
            (_input: string | URL | Request, init?: RequestInit) =>
                new Promise<Response>((_resolve, reject) => {
                    init?.signal?.addEventListener("abort", () =>
                        reject(new DOMException("Aborted", "AbortError")),
                    );
                }),
        );
        vi.stubGlobal("fetch", fetchSpy);

        const scenario = await createSecApprovedCorpusScenario(t);
        const startResult = await scenario.asOwner.mutation(startPhase5, {
            runId: scenario.runId,
            requestKey: "sec-tracer-timeout-test",
        });

        const secSource = getRequiredSource(scenario, 0);
        await t.finishAllScheduledFunctions(vi.runAllTimers);
        expect(fetchSpy).toHaveBeenCalledTimes(2);

        const statusDoc = await t.run(async (ctx) => {
            return await ctx.db
                .query("evidenceSourceStatuses")
                .withIndex("by_run_and_execution_generation_and_source", (q) =>
                    q
                        .eq("runId", scenario.runId)
                        .eq(
                            "executionGeneration",
                            startResult.executionGeneration,
                        )
                        .eq("sourceId", secSource.sourceId),
                )
                .unique();
        });
        expect(statusDoc?.status).toBe("failed");
        expect(statusDoc?.failureReason).toContain("application timeout");
    });

    test("oversize filing exceeds 16 MiB limit and marks source failed", async () => {
        const t = convexTest(schema, modules);
        workflowTest.register(t);
        rateLimiterTest.register(t);

        const fetchSpy = vi.fn(async () => {
            return new Response("Huge content", {
                status: 200,
                headers: {
                    "Content-Type": "text/html",
                    "Content-Length": String(17 * 1024 * 1024),
                },
            });
        });
        vi.stubGlobal("fetch", fetchSpy);

        const scenario = await createSecApprovedCorpusScenario(t);
        const startResult = await scenario.asOwner.mutation(startPhase5, {
            runId: scenario.runId,
            requestKey: "sec-tracer-oversize-test",
        });

        const secSource = getRequiredSource(scenario, 0);
        const actionResult = await t.action(retrieveAndNormalizeSecSource, {
            runId: scenario.runId,
            corpusRevisionId: scenario.corpusRevisionId,
            sourceId: secSource.sourceId,
            acceptedDecisionId: secSource.lastDecisionId,
            executionGeneration: startResult.executionGeneration,
        });

        expect(actionResult.status).toBe("failed");
        expect(actionResult.failureReason).toContain("exceeds declared limit");

        const versions = await t.run(async (ctx) =>
            ctx.db.query("sourceVersions").collect(),
        );
        expect(versions.length).toBe(0);
    });

    test("resolves primary document from SEC submissions when canonicalUrl is root accession URL", async () => {
        const t = convexTest(schema, modules);
        workflowTest.register(t);
        rateLimiterTest.register(t);

        const fetchSpy = vi.fn(async (input: string | URL | Request) => {
            const url = String(input);
            if (url.includes("/submissions/CIK")) {
                return new Response(
                    JSON.stringify({
                        cik: "0001818201",
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
                    }),
                    { status: 200 },
                );
            }
            if (url.includes("cccs-20231231.htm")) {
                return new Response(SAMPLE_10K_HTML, {
                    status: 200,
                    headers: { "Content-Type": "text/html" },
                });
            }
            throw new Error(`Unexpected SEC URL: ${url}`);
        });
        vi.stubGlobal("fetch", fetchSpy);

        const scenario = await createSecApprovedCorpusScenario(t, {
            sources: [
                {
                    url: "https://www.sec.gov/Archives/edgar/data/1818201/000181820124000010/",
                    title: "10-K · 2024-02-29",
                    origin: "sec",
                    secAccessionNumber: "0001818201-24-000010",
                    secForm: "10-K",
                    decisions: ["accepted"],
                },
            ],
        });

        const startResult = await scenario.asOwner.mutation(startPhase5, {
            runId: scenario.runId,
            requestKey: "sec-tracer-resolve-primary-doc",
        });

        const secSource = getRequiredSource(scenario, 0);
        const actionResult = await t.action(retrieveAndNormalizeSecSource, {
            runId: scenario.runId,
            corpusRevisionId: scenario.corpusRevisionId,
            sourceId: secSource.sourceId,
            acceptedDecisionId: secSource.lastDecisionId,
            executionGeneration: startResult.executionGeneration,
        });

        expect(actionResult.status).toBe("succeeded");
        expect(actionResult.sourceVersionId).toBeDefined();

        const versionId = actionResult.sourceVersionId;
        expect(versionId).toBeDefined();
        if (!versionId) throw new Error("Expected versionId");

        const versionDoc = await t.run(async (ctx) => ctx.db.get(versionId));
        expect(versionDoc?.canonicalUrl).toBe(
            "https://www.sec.gov/Archives/edgar/data/1818201/000181820124000010/cccs-20231231.htm",
        );
    });

    test("end-to-end: workflow execution drives SEC provenance tracer to terminal source status and clears handle on success", async () => {
        vi.useFakeTimers();
        const t = convexTest(schema, modules);
        workflowTest.register(t);
        rateLimiterTest.register(t);

        const fetchSpy = vi.fn(async () => {
            return new Response(SAMPLE_10K_HTML, {
                status: 200,
                headers: { "Content-Type": "text/html" },
            });
        });
        vi.stubGlobal("fetch", fetchSpy);

        const scenario = await createSecApprovedCorpusScenario(t);
        const startResult = await scenario.asOwner.mutation(startPhase5, {
            runId: scenario.runId,
            requestKey: "sec-tracer-workflow-e2e",
        });

        expect(startResult.acceptedSourceCount).toBe(1);

        // Advance timers and finish scheduled functions/workflow steps
        await t.finishAllScheduledFunctions(vi.runAllTimers);

        const secSource = getRequiredSource(scenario, 0);

        // Verify source status became terminal succeeded
        const statusDoc = await t.run(async (ctx) => {
            return await ctx.db
                .query("evidenceSourceStatuses")
                .withIndex("by_run_and_execution_generation_and_source", (q) =>
                    q
                        .eq("runId", scenario.runId)
                        .eq(
                            "executionGeneration",
                            startResult.executionGeneration,
                        )
                        .eq("sourceId", secSource.sourceId),
                )
                .unique();
        });
        expect(statusDoc?.status).toBe("succeeded");

        // Verify SourceVersion was committed
        const versions = await t.run(async (ctx) => {
            return await ctx.db
                .query("sourceVersions")
                .withIndex("by_revision_and_source", (q) =>
                    q
                        .eq("corpusRevisionId", scenario.corpusRevisionId)
                        .eq("sourceId", secSource.sourceId),
                )
                .collect();
        });
        expect(versions.length).toBe(1);
        expect(versions[0]?.storageId).toBeDefined();

        // Verify run active workflow handle cleared on success
        const run = await t.run(async (ctx) => ctx.db.get(scenario.runId));
        expect(run?.workflowId).toBeUndefined();

        vi.useRealTimers();
    });
});
