/// <reference types="vite/client" />

import { lookup } from "node:dns/promises";
import { internal } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { reproducePassage } from "@convex/domain/sourcePassages";
import {
    clearPdfFixtures,
    registerPdfFixture,
    retrieveAndNormalizePublicPdf,
} from "@convex/integrations/publicPdfEvidence";
import schema from "@convex/schema";
// Workflow's deterministic test environment temporarily removes process.
// Load Node action dependencies before scheduled workflows begin executing.
import "@convex/evidenceActions";
import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import rateLimiterTest from "../integrations/rate-limiter-test-register.js";
import workflowTest from "../workflows/workflow-test-register.js";

const { exaGetContents, mockPinnedRequest } = vi.hoisted(() => ({
    exaGetContents: vi.fn(),
    mockPinnedRequest: vi.fn(),
}));

vi.mock("exa-js", () => ({
    default: class MockExa {
        getContents(...args: unknown[]) {
            return exaGetContents(...args);
        }
    },
}));

vi.mock("@convex/sourceActions", async (importOriginal) => {
    const actual =
        await importOriginal<typeof import("@convex/sourceActions")>();
    return {
        ...actual,
        requestPinnedPublicSource: (...args: unknown[]) =>
            (mockPinnedRequest as any)(...args),
    };
});

vi.mock("node:dns/promises", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:dns/promises")>();
    const lookupMock = vi.fn(async () => [
        { address: "93.184.216.34", family: 4 },
    ]);
    return {
        ...actual,
        default: {
            ...((actual as any).default ?? {}),
            lookup: lookupMock,
        },
        lookup: lookupMock,
    };
});

const modules = import.meta.glob("/convex/**/*.ts");

const startPhase5 = makeFunctionReference<
    "mutation",
    { runId: Id<"researchRuns">; requestKey: string },
    { acceptedSourceCount: number; executionGeneration: number }
>("evidenceExecution:start");

const retrieveAndNormalizeExaSource = makeFunctionReference<
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
>("evidenceActions:retrieveAndNormalizeExaSource");

const retrieveAndNormalizePublicPdfSource = makeFunctionReference<
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
>("evidenceActions:retrieveAndNormalizePublicPdfSource");

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

type ScenarioSourceInput = {
    url: string;
    title: string;
    origin: "sec" | "exa" | "analyst_url";
    providerReference?: string;
    secAccessionNumber?: string;
    secForm?: string;
    secPrimaryDocument?: string;
    decisions: Array<"accepted" | "rejected" | "pending">;
};

async function createApprovedCorpusScenario(
    t: ReturnType<typeof convexTest>,
    options: {
        sources?: ScenarioSourceInput[];
        companyCik?: string;
    } = {},
) {
    const data = await t.run(async (ctx) => {
        const userId = await ctx.db.insert("users", { isAnonymous: true });
        const invitationId = await ctx.db.insert("invitations", {
            slotKey: "analyst-phase-5-web-pdf",
            role: "analyst",
            codeDigest: "digest-web-pdf",
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
                url: "https://example.com/analysis/ccc-architecture",
                title: "CCC Architecture Analysis",
                origin: "exa",
                providerReference: "exa-item-1",
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
                origin: src.origin,
                category: "analyst_research",
                secAccessionNumber: src.secAccessionNumber,
                secForm: src.secForm,
                secPrimaryDocument: src.secPrimaryDocument,
                providerReference: src.providerReference ?? `ref-${index}`,
                createdAt: timeOffset++,
            });

            let lastDecisionId: Id<"sourceDecisions"> | undefined;
            let lastDecisionValue: "accepted" | "rejected" | "pending" =
                "pending";

            for (const dec of src.decisions) {
                const decTime = timeOffset++;
                lastDecisionValue = dec;
                lastDecisionId = await ctx.db.insert("sourceDecisions", {
                    runId,
                    corpusRevisionId,
                    sourceId,
                    decisionKey: `dec:${sourceId}:${decTime}`,
                    decision: dec,
                    reviewerVisitorId: visitorId,
                    ...(lastDecisionId
                        ? { supersedesDecisionId: lastDecisionId }
                        : {}),
                    occurredAt: decTime,
                });
            }

            if (!lastDecisionId) {
                throw new Error("Source must have at least one decision");
            }

            await ctx.db.insert("sourceReviewItems", {
                runId,
                corpusRevisionId,
                sourceId,
                decision: lastDecisionValue,
                decisionRank: index,
                sourceCreatedAt: 100,
                latestDecisionId: lastDecisionId,
                decisionOccurredAt: timeOffset++,
            });

            createdSources.push({
                sourceId,
                lastDecisionId,
                finalDecision: lastDecisionValue,
                origin: src.origin,
                url: src.url,
            });
        }

        return {
            userId,
            invitationId,
            visitorId,
            companyId,
            runId,
            corpusRevisionId,
            sources: createdSources,
        };
    });

    const firstAccepted = data.sources.find(
        (s) => s.finalDecision === "accepted",
    );
    if (!firstAccepted) {
        throw new Error("Fixture scenario missing accepted source");
    }

    const asOwner = t.withIdentity({ subject: String(data.userId) });
    return {
        ...data,
        asOwner,
        firstAccepted,
    };
}

describe("Phase 5 Exa and Safe Public PDF Provenance Tracers", () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
        vi.useFakeTimers();
        clearPdfFixtures();
        exaGetContents.mockReset();
        mockPinnedRequest.mockReset();
        vi.mocked(lookup).mockClear();
    });

    afterEach(() => {
        process.env = { ...originalEnv };
        clearPdfFixtures();
        vi.useRealTimers();
    });

    describe("Exa Contents Provenance Tracer", () => {
        test("manual format routing completes through its action boundary", async () => {
            vi.useFakeTimers();
            process.env.EXA_API_KEY = "test-exa-key";
            const t = convexTest(schema, modules);
            rateLimiterTest.register(t);
            workflowTest.register(t);
            const canonicalUrl = "https://example.com/integration-guide";
            const scenario = await createApprovedCorpusScenario(t, {
                sources: [
                    {
                        url: canonicalUrl,
                        title: "Integration guide",
                        origin: "analyst_url",
                        decisions: ["accepted"],
                    },
                ],
            });
            mockPinnedRequest.mockResolvedValueOnce(
                new Response("<title>Integration guide</title>", {
                    headers: { "content-type": "text/html" },
                }),
            );
            exaGetContents.mockResolvedValueOnce({
                results: [
                    {
                        id: "manual-guide",
                        url: canonicalUrl,
                        text: "The documented platform connects public integration APIs with company claims workflows.",
                    },
                ],
            });
            const { executionGeneration } = await scenario.asOwner.mutation(
                startPhase5,
                { runId: scenario.runId, requestKey: "manual-web-direct" },
            );
            const result = await t.action(
                internal.evidenceActions.retrieveAndNormalizeManualSource,
                {
                    runId: scenario.runId,
                    corpusRevisionId: scenario.corpusRevisionId,
                    sourceId: scenario.firstAccepted.sourceId,
                    acceptedDecisionId: scenario.firstAccepted.lastDecisionId,
                    executionGeneration,
                    workerKey: "manual-worker",
                },
            );
            expect(result).toMatchObject({ status: "succeeded" });
            expect(
                await t.action(
                    internal.evidenceActions.retrieveAndNormalizeManualSource,
                    {
                        runId: scenario.runId,
                        corpusRevisionId: scenario.corpusRevisionId,
                        sourceId: scenario.firstAccepted.sourceId,
                        acceptedDecisionId:
                            scenario.firstAccepted.lastDecisionId,
                        executionGeneration,
                    },
                ),
            ).toMatchObject({
                status: "succeeded",
                sourceVersionId: result.sourceVersionId,
                reused: true,
            });
            expect(mockPinnedRequest).toHaveBeenCalledTimes(1);
            expect(exaGetContents).toHaveBeenCalledTimes(1);
        });

        test("manual extensionless PDFs use PDF retrieval after safe redirects", async () => {
            vi.useFakeTimers();
            const t = convexTest(schema, modules);
            rateLimiterTest.register(t);
            workflowTest.register(t);
            const canonicalUrl = "https://example.com/download";
            const finalUrl = "https://reports.example.com/public-document";
            const bytes = "%PDF-1.4 extensionless PDF fixture";
            registerPdfFixture({
                bytes,
                pages: [
                    {
                        pageNumber: 1,
                        text: "The platform public documentation describes its integration and workflow APIs.",
                    },
                ],
            });
            const scenario = await createApprovedCorpusScenario(t, {
                sources: [
                    {
                        url: canonicalUrl,
                        title: "Public document",
                        origin: "analyst_url",
                        decisions: ["accepted"],
                    },
                ],
            });
            const { executionGeneration } = await scenario.asOwner.mutation(
                startPhase5,
                { runId: scenario.runId, requestKey: "manual-pdf-format" },
            );
            mockPinnedRequest.mockImplementation(
                async (
                    url: string,
                    _address: string,
                    options?: { allowPdfBody?: boolean },
                ) =>
                    url === canonicalUrl
                        ? new Response(null, {
                              status: 302,
                              headers: { location: finalUrl },
                          })
                        : new Response(options?.allowPdfBody ? bytes : null, {
                              headers: {
                                  "content-type":
                                      "application/pdf; version=1.4",
                              },
                          }),
            );
            const args = {
                runId: scenario.runId,
                corpusRevisionId: scenario.corpusRevisionId,
                sourceId: scenario.firstAccepted.sourceId,
                acceptedDecisionId: scenario.firstAccepted.lastDecisionId,
                executionGeneration,
            };
            const result = await t.action(
                internal.evidenceActions.retrieveAndNormalizeManualSource,
                args,
            );
            expect(result.status).toBe("succeeded");
            const sourceVersionId = result.sourceVersionId;
            if (!sourceVersionId) throw new Error("Expected PDF version");
            expect(
                await t.run((ctx) => ctx.db.get(sourceVersionId)),
            ).toMatchObject({
                retrievalVersion: "pdf-direct-v1",
                canonicalUrl: finalUrl,
                pageCount: 1,
            });
            expect(exaGetContents).not.toHaveBeenCalled();
            expect(
                mockPinnedRequest.mock.calls.every(
                    (call) => call[1] === "93.184.216.34",
                ),
            ).toBe(true);
        });

        test.each([
            "cancelled",
            "private redirect",
            "unsupported format",
        ])("manual format inspection rejects %s before content retrieval", async (condition) => {
            vi.useFakeTimers();
            const t = convexTest(schema, modules);
            rateLimiterTest.register(t);
            workflowTest.register(t);
            const scenario = await createApprovedCorpusScenario(t, {
                sources: [
                    {
                        url: "https://example.com/reference",
                        title: "Reference",
                        origin: "analyst_url",
                        decisions: ["accepted"],
                    },
                ],
            });
            const { executionGeneration } = await scenario.asOwner.mutation(
                startPhase5,
                { runId: scenario.runId, requestKey: "manual-guard" },
            );
            if (condition === "cancelled")
                await t.run((ctx) =>
                    ctx.db.patch(scenario.runId, {
                        executionStatus: "cancelled",
                    }),
                );
            mockPinnedRequest.mockResolvedValueOnce(
                condition === "private redirect"
                    ? new Response(null, {
                          status: 302,
                          headers: { location: "https://127.0.0.1/private" },
                      })
                    : new Response(null, {
                          headers: {
                              "content-type": "application/octet-stream",
                          },
                      }),
            );
            const result = await t.action(
                internal.evidenceActions.retrieveAndNormalizeManualSource,
                {
                    runId: scenario.runId,
                    corpusRevisionId: scenario.corpusRevisionId,
                    sourceId: scenario.firstAccepted.sourceId,
                    acceptedDecisionId: scenario.firstAccepted.lastDecisionId,
                    executionGeneration,
                },
            );
            expect(result.status).toBe("failed");
            expect(mockPinnedRequest).toHaveBeenCalledTimes(
                condition === "cancelled" ? 0 : 1,
            );
            if (condition === "cancelled")
                expect(lookup).not.toHaveBeenCalled();
            expect(exaGetContents).not.toHaveBeenCalled();
            expect(
                await t.run((ctx) =>
                    ctx.db
                        .query("sourceVersions")
                        .withIndex("by_run", (q) =>
                            q.eq("runId", scenario.runId),
                        )
                        .take(1),
                ),
            ).toEqual([]);
        });
        test.each([
            "text/html; charset=utf-8",
            "application/xhtml+xml",
        ])("workflow retrieves approved manual %s through Exa", async (contentType) => {
            vi.useFakeTimers();
            process.env.EXA_API_KEY = "test-exa-key";
            const t = convexTest(schema, modules);
            rateLimiterTest.register(t);
            workflowTest.register(t);
            const canonicalUrl = "https://example.com/integration-guide";
            const scenario = await createApprovedCorpusScenario(t, {
                sources: [
                    {
                        url: canonicalUrl,
                        title: "Integration guide",
                        origin: "analyst_url",
                        decisions: ["accepted"],
                    },
                ],
            });
            mockPinnedRequest.mockResolvedValueOnce(
                new Response("<title>Integration guide</title>", {
                    headers: { "content-type": contentType },
                }),
            );
            exaGetContents.mockResolvedValueOnce({
                results: [
                    {
                        id: "manual-guide",
                        url: canonicalUrl,
                        text: "The documented platform connects public integration APIs with company claims workflows.",
                    },
                ],
            });
            const { executionGeneration } = await scenario.asOwner.mutation(
                startPhase5,
                { runId: scenario.runId, requestKey: "manual-web-workflow" },
            );
            await t.finishAllScheduledFunctions(vi.runAllTimers);
            const statuses = await t.run((ctx) =>
                ctx.db
                    .query("evidenceSourceStatuses")
                    .withIndex("by_run_and_execution_generation", (q) =>
                        q
                            .eq("runId", scenario.runId)
                            .eq("executionGeneration", executionGeneration),
                    )
                    .take(2),
            );
            expect(statuses[0]?.status).toBe("succeeded");
            expect(exaGetContents).toHaveBeenCalledTimes(1);
            const versions = await t.run((ctx) =>
                ctx.db
                    .query("sourceVersions")
                    .withIndex("by_run", (q) => q.eq("runId", scenario.runId))
                    .take(2),
            );
            expect(versions[0]?.retrievalVersion).toBe("exa-contents-v1");
            expect(
                await t.run((ctx) =>
                    ctx.db.get(scenario.firstAccepted.sourceId),
                ),
            ).toMatchObject({ origin: "analyst_url" });
        });

        test("authorized Exa happy path: retrieves text, normalizes, stores blob, commits SourceVersion and WebLocator passages with exact replay", async () => {
            process.env.EXA_API_KEY = "test-exa-key";
            const t = convexTest(schema, modules);
            rateLimiterTest.register(t);
            workflowTest.register(t);

            const scenario = await createApprovedCorpusScenario(t, {
                sources: [
                    {
                        url: "https://analyst-notes.example.com/ccc-insurance-cloud",
                        title: "CCC Cloud Architecture Review",
                        origin: "exa",
                        providerReference: "exa-item-123",
                        decisions: ["accepted"],
                    },
                ],
            });

            const startRes = await scenario.asOwner.mutation(startPhase5, {
                runId: scenario.runId,
                requestKey: "req-start-exa-1",
            });
            expect(startRes.acceptedSourceCount).toBe(1);
            expect(startRes.executionGeneration).toBe(2);

            const mockArticleText = `# CCC Insurance Architecture Overview\n\nCCC Intelligent Solutions operates a multi-tenant cloud platform connecting insurers and repair facilities.\n\n## Core Integration\n\nDirect carrier API gateways mediate workflow orchestration and parts inventory valuation.`;

            exaGetContents.mockResolvedValueOnce({
                results: [
                    {
                        id: "exa-item-123",
                        url: "https://analyst-notes.example.com/ccc-insurance-cloud",
                        title: "CCC Cloud Architecture Review",
                        text: mockArticleText,
                    },
                ],
                searchTime: 45,
                costDollars: { total: 0.005 },
            });

            const retrievalResult = await t.action(
                retrieveAndNormalizeExaSource,
                {
                    runId: scenario.runId,
                    corpusRevisionId: scenario.corpusRevisionId,
                    sourceId: scenario.firstAccepted.sourceId,
                    acceptedDecisionId: scenario.firstAccepted.lastDecisionId,
                    executionGeneration: 2,
                },
            );

            expect(retrievalResult.status).toBe("succeeded");
            expect(retrievalResult.sourceVersionId).toBeDefined();
            const sourceVersionId = retrievalResult.sourceVersionId;
            if (!sourceVersionId) {
                throw new Error("Expected sourceVersionId to be defined");
            }

            expect(exaGetContents).toHaveBeenCalledWith(
                ["https://analyst-notes.example.com/ccc-insurance-cloud"],
                expect.objectContaining({
                    text: { maxCharacters: 1_000_000 },
                }),
            );

            const version = await t.run(async (ctx) =>
                ctx.db.get(sourceVersionId),
            );
            if (!version) {
                throw new Error("Expected committed SourceVersion");
            }
            expect(version).toMatchObject({
                runId: scenario.runId,
                corpusRevisionId: scenario.corpusRevisionId,
                sourceId: scenario.firstAccepted.sourceId,
                acceptedDecisionId: scenario.firstAccepted.lastDecisionId,
                mediaType: "text/plain",
                normalizerVersion: "exa-text-v1",
                retrievalVersion: "exa-contents-v1",
                canonicalUrl:
                    "https://analyst-notes.example.com/ccc-insurance-cloud",
                executionGeneration: 2,
            });

            const storedBlob = await t.run(async (ctx) => {
                const blob = await ctx.storage.get(version.storageId);
                return blob ? await blob.text() : null;
            });
            expect(storedBlob).toBe(mockArticleText);
            if (!storedBlob) {
                throw new Error("Expected stored blob text");
            }

            const passages = await t.query(listSourcePassages, {
                sourceVersionId,
            });
            expect(passages.length).toBeGreaterThanOrEqual(2);
            for (const passage of passages) {
                expect(passage.locator.kind).toBe("web");
                expect(passage.locator.sourceVersionHash).toBe(
                    version.contentHash,
                );
                const replayed = await reproducePassage(
                    storedBlob,
                    passage.locator,
                );
                expect(replayed).toBe(passage.exactQuotation);
            }

            const statusDoc = await t.run(async (ctx) =>
                ctx.db
                    .query("evidenceSourceStatuses")
                    .withIndex(
                        "by_run_and_execution_generation_and_source",
                        (q) =>
                            q
                                .eq("runId", scenario.runId)
                                .eq("executionGeneration", 2)
                                .eq(
                                    "sourceId",
                                    scenario.firstAccepted.sourceId,
                                ),
                    )
                    .unique(),
            );
            expect(statusDoc?.status).toBe("succeeded");
        });

        test("Exa missing API key: records failed attempt, marks status failed with typed failureReason, creates no SourceVersion", async () => {
            delete process.env.EXA_API_KEY;
            const t = convexTest(schema, modules);
            rateLimiterTest.register(t);
            workflowTest.register(t);

            const scenario = await createApprovedCorpusScenario(t);
            await scenario.asOwner.mutation(startPhase5, {
                runId: scenario.runId,
                requestKey: "req-start-no-key",
            });

            const result = await t.action(retrieveAndNormalizeExaSource, {
                runId: scenario.runId,
                corpusRevisionId: scenario.corpusRevisionId,
                sourceId: scenario.firstAccepted.sourceId,
                acceptedDecisionId: scenario.firstAccepted.lastDecisionId,
                executionGeneration: 2,
            });

            expect(result.status).toBe("failed");
            expect(result.failureReason).toMatch(/not configured/i);

            const versionCount = await t.query(getCommittedSourceVersionCount, {
                sourceId: scenario.firstAccepted.sourceId,
                contentHash: "any",
                normalizerVersion: "exa-text-v1",
            });
            expect(versionCount).toBe(0);

            const statusDoc = await t.run(async (ctx) =>
                ctx.db
                    .query("evidenceSourceStatuses")
                    .withIndex(
                        "by_run_and_execution_generation_and_source",
                        (q) =>
                            q
                                .eq("runId", scenario.runId)
                                .eq("executionGeneration", 2)
                                .eq(
                                    "sourceId",
                                    scenario.firstAccepted.sourceId,
                                ),
                    )
                    .unique(),
            );
            expect(statusDoc?.status).toBe("failed");
        });

        test("Exa paid work disabled: records failed attempt, marks status failed with paid_work_disabled, creates no SourceVersion", async () => {
            process.env.EXA_API_KEY = "test-key";
            const t = convexTest(schema, modules);
            rateLimiterTest.register(t);
            workflowTest.register(t);

            await t.run(async (ctx) => {
                await ctx.db.insert("paidWorkControls", {
                    key: "global",
                    enabled: false,
                    updatedAt: 100,
                });
            });

            const scenario = await createApprovedCorpusScenario(t);
            await scenario.asOwner.mutation(startPhase5, {
                runId: scenario.runId,
                requestKey: "req-start-paid-disabled",
            });

            const result = await t.action(retrieveAndNormalizeExaSource, {
                runId: scenario.runId,
                corpusRevisionId: scenario.corpusRevisionId,
                sourceId: scenario.firstAccepted.sourceId,
                acceptedDecisionId: scenario.firstAccepted.lastDecisionId,
                executionGeneration: 2,
            });

            expect(result.status).toBe("failed");

            const statusDoc = await t.run(async (ctx) =>
                ctx.db
                    .query("evidenceSourceStatuses")
                    .withIndex(
                        "by_run_and_execution_generation_and_source",
                        (q) =>
                            q
                                .eq("runId", scenario.runId)
                                .eq("executionGeneration", 2)
                                .eq(
                                    "sourceId",
                                    scenario.firstAccepted.sourceId,
                                ),
                    )
                    .unique(),
            );
            expect(statusDoc?.status).toBe("failed");
        });

        test("Exa retry exhaustion on 500 error: records two attempts, marks status failed, creates no SourceVersion", async () => {
            process.env.EXA_API_KEY = "test-key";
            const t = convexTest(schema, modules);
            rateLimiterTest.register(t);
            workflowTest.register(t);

            const scenario = await createApprovedCorpusScenario(t);
            await scenario.asOwner.mutation(startPhase5, {
                runId: scenario.runId,
                requestKey: "req-start-500",
            });

            exaGetContents.mockImplementation(async () => {
                const err: any = new Error("500 Server Error");
                err.status = 500;
                err.name = "ExaServerError";
                throw err;
            });

            const result = await t.action(retrieveAndNormalizeExaSource, {
                runId: scenario.runId,
                corpusRevisionId: scenario.corpusRevisionId,
                sourceId: scenario.firstAccepted.sourceId,
                acceptedDecisionId: scenario.firstAccepted.lastDecisionId,
                executionGeneration: 2,
            });

            expect(result.status).toBe("failed");
            expect(exaGetContents).toHaveBeenCalledTimes(2);

            const calls = await t.run(async (ctx) =>
                ctx.db
                    .query("providerCalls")
                    .withIndex("by_operation_key", (q) =>
                        q.eq(
                            "operationKey",
                            `run:${scenario.runId}:gen:2:source:${scenario.firstAccepted.sourceId}:get_contents:${scenario.firstAccepted.url}`,
                        ),
                    )
                    .collect(),
            );
            expect(calls.length).toBe(2);
            expect(calls.every((c) => c.status === "failed")).toBe(true);
        });
    });

    describe("Safe Public PDF Provenance Tracer", () => {
        test("registered OCR limitations survive PDF commit and replay", async () => {
            vi.useFakeTimers();
            const t = convexTest(schema, modules);
            rateLimiterTest.register(t);
            workflowTest.register(t);
            const bytes = "%PDF-1.4 partially scanned fixture";
            registerPdfFixture({
                bytes,
                pages: [
                    {
                        pageNumber: 1,
                        text: "The documented platform provides a public integration API for claims workflows.",
                    },
                    { pageNumber: 2, text: "" },
                ],
                ocrUnavailablePages: 1,
            });
            const scenario = await createApprovedCorpusScenario(t, {
                sources: [
                    {
                        url: "https://example.com/partly-scanned.pdf",
                        title: "Partly scanned",
                        origin: "analyst_url",
                        decisions: ["accepted"],
                    },
                ],
            });
            const { executionGeneration } = await scenario.asOwner.mutation(
                startPhase5,
                { runId: scenario.runId, requestKey: "ocr-limitation" },
            );
            mockPinnedRequest.mockResolvedValueOnce(
                new Response(bytes, {
                    headers: { "content-type": "application/pdf" },
                }),
            );
            const args = {
                runId: scenario.runId,
                corpusRevisionId: scenario.corpusRevisionId,
                sourceId: scenario.firstAccepted.sourceId,
                acceptedDecisionId: scenario.firstAccepted.lastDecisionId,
                executionGeneration,
            };
            const result = await t.action(
                retrieveAndNormalizePublicPdfSource,
                args,
            );
            expect(result.status).toBe("partial");
            expect(result.failureReason).toBe(
                "pdf_acquisition_partial: 1 of 2 pages had no extractable text",
            );
            const sourceVersionId = result.sourceVersionId;
            if (!sourceVersionId)
                throw new Error("Expected committed partial version");
            const version = await t.run((ctx) => ctx.db.get(sourceVersionId));
            expect(version?.pageCount).toBe(2);
            const passages = await t.query(listSourcePassages, {
                sourceVersionId,
            });
            expect(passages).toHaveLength(1);
            expect(passages[0]?.locator).toMatchObject({
                kind: "pdf",
                pageNumber: 1,
            });
            expect(
                await t.action(retrieveAndNormalizePublicPdfSource, args),
            ).toMatchObject({ ...result, reused: true });
            expect(mockPinnedRequest).toHaveBeenCalledTimes(1);
        });

        test("authorized fixture PDF happy path: normalizes fixture PDF pages, stores blob, commits SourceVersion with pageCount, commits SourcePassages with PdfLocator, and exact replay succeeds", async () => {
            const t = convexTest(schema, modules);
            rateLimiterTest.register(t);
            workflowTest.register(t);

            const fixtureBytes = new TextEncoder().encode(
                "%PDF-1.4 mock pdf fixture data for CCC whitepaper",
            );
            const fixturePages = [
                {
                    pageNumber: 1,
                    text: "# Executive Summary\n\nCCC Intelligent Solutions cloud platform architectures provide fault-isolated claims routing.",
                    headingPath: ["Executive Summary"],
                },
                {
                    pageNumber: 2,
                    text: "# Architectural Resilience\n\nWorkflows decouple carrier estimate ingestion from repair shop telemetry.",
                    headingPath: ["Architectural Resilience"],
                },
            ];

            registerPdfFixture("ccc-whitepaper-fixture", {
                bytes: fixtureBytes,
                pages: fixturePages,
            });

            const scenario = await createApprovedCorpusScenario(t, {
                sources: [
                    {
                        url: "https://analyst-whitepapers.example.com/ccc-whitepaper.pdf",
                        title: "CCC Architecture Whitepaper",
                        origin: "analyst_url",
                        decisions: ["accepted"],
                    },
                ],
            });

            await scenario.asOwner.mutation(startPhase5, {
                runId: scenario.runId,
                requestKey: "req-start-pdf-1",
            });

            mockPinnedRequest.mockResolvedValueOnce(
                new Response(fixtureBytes, {
                    status: 200,
                    headers: {
                        "content-type": "application/pdf",
                        "content-length": String(fixtureBytes.byteLength),
                    },
                }),
            );

            const result = await t.action(retrieveAndNormalizePublicPdfSource, {
                runId: scenario.runId,
                corpusRevisionId: scenario.corpusRevisionId,
                sourceId: scenario.firstAccepted.sourceId,
                acceptedDecisionId: scenario.firstAccepted.lastDecisionId,
                executionGeneration: 2,
            });

            expect(result.status).toBe("succeeded");
            expect(result.sourceVersionId).toBeDefined();
            const sourceVersionId = result.sourceVersionId;
            if (!sourceVersionId) {
                throw new Error("Expected sourceVersionId to be defined");
            }

            const version = await t.run(async (ctx) =>
                ctx.db.get(sourceVersionId),
            );
            if (!version) {
                throw new Error("Expected committed SourceVersion");
            }
            expect(version).toMatchObject({
                runId: scenario.runId,
                corpusRevisionId: scenario.corpusRevisionId,
                sourceId: scenario.firstAccepted.sourceId,
                pageCount: 2,
                mediaType: "text/plain",
                normalizerVersion: "pdf-fixture-v1",
                retrievalVersion: "pdf-direct-v1",
                canonicalUrl:
                    "https://analyst-whitepapers.example.com/ccc-whitepaper.pdf",
                executionGeneration: 2,
            });

            const storedBlob = await t.run(async (ctx) => {
                const blob = await ctx.storage.get(version.storageId);
                return blob ? await blob.text() : null;
            });
            expect(storedBlob).toContain("\f\n");
            if (!storedBlob) {
                throw new Error("Expected stored blob text");
            }

            const passages = await t.query(listSourcePassages, {
                sourceVersionId,
            });
            expect(passages.length).toBe(2);
            for (const passage of passages) {
                expect(passage.locator.kind).toBe("pdf");
                expect(passage.locator.sourceVersionHash).toBe(
                    version.contentHash,
                );
                expect([1, 2]).toContain(passage.locator.pageNumber);
                const replayed = await reproducePassage(
                    storedBlob,
                    passage.locator,
                );
                expect(replayed).toBe(passage.exactQuotation);
            }
        });

        test("non-fixture PDF: returns normalizer_unavailable, creates no SourceVersion, performs no Unstructured call", async () => {
            const t = convexTest(schema, modules);
            rateLimiterTest.register(t);
            workflowTest.register(t);

            const unknownPdfBytes = new TextEncoder().encode(
                "%PDF-1.4 unknown arbitrary pdf bytes",
            );

            const scenario = await createApprovedCorpusScenario(t, {
                sources: [
                    {
                        url: "https://unknown.example.com/arbitrary.pdf",
                        title: "Arbitrary PDF",
                        origin: "analyst_url",
                        decisions: ["accepted"],
                    },
                ],
            });

            await scenario.asOwner.mutation(startPhase5, {
                runId: scenario.runId,
                requestKey: "req-start-pdf-unknown",
            });

            mockPinnedRequest.mockResolvedValueOnce(
                new Response(unknownPdfBytes, {
                    status: 200,
                    headers: {
                        "content-type": "application/pdf",
                        "content-length": String(unknownPdfBytes.byteLength),
                    },
                }),
            );

            const result = await t.action(retrieveAndNormalizePublicPdfSource, {
                runId: scenario.runId,
                corpusRevisionId: scenario.corpusRevisionId,
                sourceId: scenario.firstAccepted.sourceId,
                acceptedDecisionId: scenario.firstAccepted.lastDecisionId,
                executionGeneration: 2,
            });

            expect(result.status).toBe("failed");
            expect(result.failureReason).toMatch(
                /normalizer is unavailable|normalizer_unavailable/i,
            );

            const versionCount = await t.query(getCommittedSourceVersionCount, {
                sourceId: scenario.firstAccepted.sourceId,
                contentHash: "any",
                normalizerVersion: "pdf-fixture-v1",
            });
            expect(versionCount).toBe(0);

            const statusDoc = await t.run(async (ctx) =>
                ctx.db
                    .query("evidenceSourceStatuses")
                    .withIndex(
                        "by_run_and_execution_generation_and_source",
                        (q) =>
                            q
                                .eq("runId", scenario.runId)
                                .eq("executionGeneration", 2)
                                .eq(
                                    "sourceId",
                                    scenario.firstAccepted.sourceId,
                                ),
                    )
                    .unique(),
            );
            expect(statusDoc?.status).toBe("failed");
        });

        test("PDF oversize: fails when content exceeds 16 MiB limit", async () => {
            const t = convexTest(schema, modules);
            rateLimiterTest.register(t);
            workflowTest.register(t);

            const scenario = await createApprovedCorpusScenario(t, {
                sources: [
                    {
                        url: "https://oversize.example.com/massive.pdf",
                        title: "Massive PDF",
                        origin: "analyst_url",
                        decisions: ["accepted"],
                    },
                ],
            });

            await scenario.asOwner.mutation(startPhase5, {
                runId: scenario.runId,
                requestKey: "req-start-pdf-oversize",
            });

            mockPinnedRequest.mockRejectedValueOnce(
                new Error("Manual source intake failed (response_too_large)"),
            );

            const result = await t.action(retrieveAndNormalizePublicPdfSource, {
                runId: scenario.runId,
                corpusRevisionId: scenario.corpusRevisionId,
                sourceId: scenario.firstAccepted.sourceId,
                acceptedDecisionId: scenario.firstAccepted.lastDecisionId,
                executionGeneration: 2,
            });

            expect(result.status).toBe("failed");
        });

        test("PDF page limit: fails when fixture exceeds 400 pages", async () => {
            const t = convexTest(schema, modules);
            rateLimiterTest.register(t);
            workflowTest.register(t);

            const pages = Array.from({ length: 401 }, (_, i) => ({
                pageNumber: i + 1,
                text: `Page ${i + 1} content`,
            }));
            const fixtureBytes = new TextEncoder().encode(
                "%PDF-1.4 401 pages fixture",
            );
            registerPdfFixture("oversized-pages-fixture", {
                bytes: fixtureBytes,
                pages,
            });

            const scenario = await createApprovedCorpusScenario(t, {
                sources: [
                    {
                        url: "https://pages.example.com/oversized.pdf",
                        title: "Oversized Pages PDF",
                        origin: "analyst_url",
                        decisions: ["accepted"],
                    },
                ],
            });

            await scenario.asOwner.mutation(startPhase5, {
                runId: scenario.runId,
                requestKey: "req-start-pdf-pages",
            });

            mockPinnedRequest.mockResolvedValueOnce(
                new Response(fixtureBytes, {
                    status: 200,
                    headers: {
                        "content-type": "application/pdf",
                        "content-length": String(fixtureBytes.byteLength),
                    },
                }),
            );

            const result = await t.action(retrieveAndNormalizePublicPdfSource, {
                runId: scenario.runId,
                corpusRevisionId: scenario.corpusRevisionId,
                sourceId: scenario.firstAccepted.sourceId,
                acceptedDecisionId: scenario.firstAccepted.lastDecisionId,
                executionGeneration: 2,
            });

            expect(result.status).toBe("failed");
            expect(result.failureReason).toMatch(
                /exceeds maximum limit of 400 pages/i,
            );
        });
    });

    describe("Mixed Sources Workflow & Execution Fences", () => {
        test("mixed sources workflow execution: one source fails while another succeeds, both end terminal, workflow finishes cleanly", async () => {
            vi.useFakeTimers();
            process.env.EXA_API_KEY = "test-key";
            const t = convexTest(schema, modules);
            rateLimiterTest.register(t);
            workflowTest.register(t);

            const fixtureBytes = new TextEncoder().encode(
                "%PDF-1.4 valid ccc report",
            );
            registerPdfFixture("valid-report", {
                bytes: fixtureBytes,
                pages: [
                    {
                        pageNumber: 1,
                        text: "# Report\n\nValid report content.",
                    },
                ],
            });

            const scenario = await createApprovedCorpusScenario(t, {
                sources: [
                    {
                        url: "https://analyst.example.com/succeeding-exa-analysis",
                        title: "Succeeding Exa Source",
                        origin: "exa",
                        decisions: ["accepted"],
                    },
                    {
                        url: "https://unknown.example.com/failing-unknown.pdf",
                        title: "Failing Non-Fixture PDF Source",
                        origin: "analyst_url",
                        decisions: ["accepted"],
                    },
                ],
            });

            const startRes = await scenario.asOwner.mutation(startPhase5, {
                runId: scenario.runId,
                requestKey: "req-start-mixed",
            });
            expect(startRes.acceptedSourceCount).toBe(2);
            expect(startRes.executionGeneration).toBe(2);

            exaGetContents.mockResolvedValueOnce({
                results: [
                    {
                        id: "exa-mixed-1",
                        url: "https://analyst.example.com/succeeding-exa-analysis",
                        title: "Succeeding Exa Source",
                        text: "# Exa Succeeded\n\nText content here.",
                    },
                ],
            });

            // Convex-test cannot safely model concurrent action storage
            // transactions. Task 8's production-used fan-out helper has a
            // separate barrier regression, so this Task 5 integration drives
            // both source branches sequentially through their real actions.
            const succeededSource = scenario.sources[0];
            const failedSource = scenario.sources[1];
            if (!succeededSource || !failedSource) {
                throw new Error("Missing mixed-source fixtures");
            }
            const succeeded = await t.action(retrieveAndNormalizeExaSource, {
                runId: scenario.runId,
                corpusRevisionId: scenario.corpusRevisionId,
                sourceId: succeededSource.sourceId,
                acceptedDecisionId: succeededSource.lastDecisionId,
                executionGeneration: 2,
            });
            expect(succeeded.status).toBe("succeeded");

            mockPinnedRequest.mockResolvedValueOnce(
                new Response(new TextEncoder().encode("%PDF-1.4 unknown"), {
                    status: 200,
                    headers: {
                        "content-type": "application/pdf",
                        "content-length": "16",
                    },
                }),
            );
            const failed = await t.action(retrieveAndNormalizePublicPdfSource, {
                runId: scenario.runId,
                corpusRevisionId: scenario.corpusRevisionId,
                sourceId: failedSource.sourceId,
                acceptedDecisionId: failedSource.lastDecisionId,
                executionGeneration: 2,
            });
            expect(failed.status).toBe("failed");

            const statuses = await t.run(async (ctx) =>
                ctx.db
                    .query("evidenceSourceStatuses")
                    .withIndex("by_run_and_execution_generation", (q) =>
                        q
                            .eq("runId", scenario.runId)
                            .eq("executionGeneration", 2),
                    )
                    .collect(),
            );

            expect(statuses.length).toBe(2);
            const succeededStatus = statuses.find(
                (s) => s.sourceId === scenario.sources[0]?.sourceId,
            );
            const failedStatus = statuses.find(
                (s) => s.sourceId === scenario.sources[1]?.sourceId,
            );

            expect(succeededStatus?.status).toBe("succeeded");
            expect(failedStatus?.status).toBe("failed");
        });

        test("post-fetch generation advance rejects finalize, orphans lease, and deletes storage blob", async () => {
            process.env.EXA_API_KEY = "test-key";
            const t = convexTest(schema, modules);
            rateLimiterTest.register(t);
            workflowTest.register(t);

            const scenario = await createApprovedCorpusScenario(t);
            await scenario.asOwner.mutation(startPhase5, {
                runId: scenario.runId,
                requestKey: "req-start-fence-test",
            });

            exaGetContents.mockImplementation(async () => {
                await t.run(async (ctx) => {
                    await ctx.db.patch(scenario.runId, {
                        executionGeneration: 3,
                    });
                });
                return {
                    results: [
                        {
                            id: "exa-stale",
                            url: scenario.firstAccepted.url,
                            text: "# Late Exa content",
                        },
                    ],
                };
            });

            const result = await t.action(retrieveAndNormalizeExaSource, {
                runId: scenario.runId,
                corpusRevisionId: scenario.corpusRevisionId,
                sourceId: scenario.firstAccepted.sourceId,
                acceptedDecisionId: scenario.firstAccepted.lastDecisionId,
                executionGeneration: 2,
            });

            expect(result.status).toBe("failed");
            expect(result.failureReason).toMatch(
                /fence violation|Finalize failure/i,
            );

            const versionCount = await t.query(getCommittedSourceVersionCount, {
                sourceId: scenario.firstAccepted.sourceId,
                contentHash: "any",
                normalizerVersion: "exa-text-v1",
            });
            expect(versionCount).toBe(0);
        });

        test("H1 & M9: missing Exa API key records failed providerCall row and issues zero SDK dispatches", async () => {
            delete process.env.EXA_API_KEY;
            const t = convexTest(schema, modules);
            rateLimiterTest.register(t);
            workflowTest.register(t);

            const scenario = await createApprovedCorpusScenario(t);
            await scenario.asOwner.mutation(startPhase5, {
                runId: scenario.runId,
                requestKey: "req-missing-key",
            });

            const result = await t.action(retrieveAndNormalizeExaSource, {
                runId: scenario.runId,
                corpusRevisionId: scenario.corpusRevisionId,
                sourceId: scenario.firstAccepted.sourceId,
                acceptedDecisionId: scenario.firstAccepted.lastDecisionId,
                executionGeneration: 2,
            });

            expect(result.status).toBe("failed");
            expect(result.failureReason).toMatch(
                /Exa API key is not configured/i,
            );
            expect(exaGetContents).toHaveBeenCalledTimes(0);

            const opKey = `run:${scenario.runId}:gen:2:source:${scenario.firstAccepted.sourceId}:get_contents:${scenario.firstAccepted.url}`;
            const call = await t.run(async (ctx) =>
                ctx.db
                    .query("providerCalls")
                    .withIndex("by_operation_key", (q) =>
                        q.eq("operationKey", opKey),
                    )
                    .first(),
            );
            expect(call).not.toBeNull();
            expect(call?.status).toBe("failed");
            expect(call?.errorCode).toBe("missing_api_key");
        });

        test("H1: stale/cancelled run before Exa SDK dispatch issues zero SDK calls", async () => {
            process.env.EXA_API_KEY = "test-key";
            const t = convexTest(schema, modules);
            rateLimiterTest.register(t);
            workflowTest.register(t);

            const scenario = await createApprovedCorpusScenario(t);
            await scenario.asOwner.mutation(startPhase5, {
                runId: scenario.runId,
                requestKey: "req-cancel-before-exa",
            });

            // Cancel run before action executes
            await t.run(async (ctx) => {
                await ctx.db.patch(scenario.runId, { executionStatus: "idle" });
            });

            const result = await t.action(retrieveAndNormalizeExaSource, {
                runId: scenario.runId,
                corpusRevisionId: scenario.corpusRevisionId,
                sourceId: scenario.firstAccepted.sourceId,
                acceptedDecisionId: scenario.firstAccepted.lastDecisionId,
                executionGeneration: 2,
            });

            expect(result.status).toBe("failed");
            expect(exaGetContents).toHaveBeenCalledTimes(0);
        });

        test("H3: PDF rejects initial private IP without making HTTP request", async () => {
            const t = convexTest(schema, modules);
            rateLimiterTest.register(t);
            workflowTest.register(t);

            const dnsPromises = await import("node:dns/promises");
            (dnsPromises.lookup as any).mockResolvedValueOnce([
                { address: "127.0.0.1", family: 4 },
            ]);

            const scenario = await createApprovedCorpusScenario(t, {
                sources: [
                    {
                        url: "https://private.example.com/doc.pdf",
                        title: "Private PDF",
                        origin: "analyst_url",
                        decisions: ["accepted"],
                    },
                ],
            });

            await scenario.asOwner.mutation(startPhase5, {
                runId: scenario.runId,
                requestKey: "req-pdf-private-dns",
            });

            const result = await t.action(retrieveAndNormalizePublicPdfSource, {
                runId: scenario.runId,
                corpusRevisionId: scenario.corpusRevisionId,
                sourceId: scenario.firstAccepted.sourceId,
                acceptedDecisionId: scenario.firstAccepted.lastDecisionId,
                executionGeneration: 2,
            });

            expect(result.status).toBe("failed");
            expect(result.failureReason).toMatch(
                /public network|non_public_destination/i,
            );
            expect(mockPinnedRequest).toHaveBeenCalledTimes(0);
        });

        test("H3: PDF rejects redirect to private IP without making HTTP request to redirect target", async () => {
            const t = convexTest(schema, modules);
            rateLimiterTest.register(t);
            workflowTest.register(t);

            const dnsPromises = await import("node:dns/promises");
            // First hop resolves to public IP
            (dnsPromises.lookup as any).mockResolvedValueOnce([
                { address: "93.184.216.34", family: 4 },
            ]);
            // Redirect hop resolves to private IP
            (dnsPromises.lookup as any).mockResolvedValueOnce([
                { address: "192.168.1.1", family: 4 },
            ]);

            const scenario = await createApprovedCorpusScenario(t, {
                sources: [
                    {
                        url: "https://initial.example.com/redirect.pdf",
                        title: "Redirect PDF",
                        origin: "analyst_url",
                        decisions: ["accepted"],
                    },
                ],
            });

            await scenario.asOwner.mutation(startPhase5, {
                runId: scenario.runId,
                requestKey: "req-pdf-redirect-private",
            });

            mockPinnedRequest.mockResolvedValueOnce(
                new Response(null, {
                    status: 302,
                    headers: {
                        location: "https://rebinding.example.com/target.pdf",
                    },
                }),
            );

            const result = await t.action(retrieveAndNormalizePublicPdfSource, {
                runId: scenario.runId,
                corpusRevisionId: scenario.corpusRevisionId,
                sourceId: scenario.firstAccepted.sourceId,
                acceptedDecisionId: scenario.firstAccepted.lastDecisionId,
                executionGeneration: 2,
            });

            expect(result.status).toBe("failed");
            expect(result.failureReason).toMatch(
                /public network|non_public_destination/i,
            );
            // HTTP was only called for hop 1, NOT for redirect target
            expect(mockPinnedRequest).toHaveBeenCalledTimes(1);
        });

        test("H5: PDF fixture lookup by SHA-256 only; marker strings and 1-byte mutations return normalizer_unavailable", async () => {
            const t = convexTest(schema, modules);
            rateLimiterTest.register(t);
            workflowTest.register(t);

            const exactBytes = new TextEncoder().encode(
                "%PDF-1.4 EXACT FIXTURE CONTENT FOR SHA CHECK",
            );
            registerPdfFixture("exact-fixture-key", {
                bytes: exactBytes,
                pages: [{ pageNumber: 1, text: "# Page\n\nExact content." }],
            });

            const mutatedBytes = new Uint8Array(exactBytes);
            const lastByte = mutatedBytes[mutatedBytes.length - 1] ?? 0;
            mutatedBytes[mutatedBytes.length - 1] = lastByte ^ 0xff;

            const scenario = await createApprovedCorpusScenario(t, {
                sources: [
                    {
                        url: "https://mutated.example.com/mutated.pdf",
                        title: "Mutated PDF",
                        origin: "analyst_url",
                        decisions: ["accepted"],
                    },
                ],
            });

            await scenario.asOwner.mutation(startPhase5, {
                runId: scenario.runId,
                requestKey: "req-pdf-mutated",
            });

            mockPinnedRequest.mockResolvedValueOnce(
                new Response(mutatedBytes, {
                    status: 200,
                    headers: {
                        "content-type": "application/pdf",
                        "content-length": String(mutatedBytes.byteLength),
                    },
                }),
            );

            const result = await t.action(retrieveAndNormalizePublicPdfSource, {
                runId: scenario.runId,
                corpusRevisionId: scenario.corpusRevisionId,
                sourceId: scenario.firstAccepted.sourceId,
                acceptedDecisionId: scenario.firstAccepted.lastDecisionId,
                executionGeneration: 2,
            });

            expect(result.status).toBe("failed");
            expect(result.failureReason).toMatch(
                /normalizer is unavailable|normalizer_unavailable/i,
            );
        });

        test("Task5: beforeResolve fence blocks DNS resolution and HTTP calls if cancelled immediately before DNS", async () => {
            const resolveAddresses = vi.fn(async () => ["93.184.216.34"]);
            const request = vi.fn(async () => new Response("dummy"));
            const beforeResolve = vi.fn(async () => {
                throw new Error(
                    "Research execution fence violation: run is cancelled",
                );
            });

            const result = await retrieveAndNormalizePublicPdf(
                {
                    beforeResolve,
                    resolveAddresses,
                    request: request as any,
                },
                {
                    runId: "run1" as any,
                    corpusRevisionId: "rev1" as any,
                    sourceId: "src1" as any,
                    acceptedDecisionId: "dec1" as any,
                    executionGeneration: 1,
                    canonicalUrl: "https://example.com/cancelled.pdf",
                    origin: "analyst_url",
                },
            );

            expect(result.status).toBe("failed");
            expect(beforeResolve).toHaveBeenCalledTimes(1);
            expect(resolveAddresses).toHaveBeenCalledTimes(0);
            expect(request).toHaveBeenCalledTimes(0);
        });

        test("Task5: beforeResolve fence blocks redirect hop DNS and HTTP if revoked between hops", async () => {
            let hopCount = 0;
            const beforeResolve = vi.fn(async () => {
                hopCount += 1;
                if (hopCount > 1) {
                    throw new Error(
                        "Research execution fence violation: decision revoked before redirect DNS",
                    );
                }
            });
            const resolveAddresses = vi.fn(async () => ["93.184.216.34"]);
            const request = vi.fn(
                async () =>
                    new Response(null, {
                        status: 302,
                        headers: {
                            location:
                                "https://redirect-target.example.com/target.pdf",
                        },
                    }),
            );

            const result = await retrieveAndNormalizePublicPdf(
                {
                    beforeResolve,
                    resolveAddresses,
                    request: request as any,
                },
                {
                    runId: "run1" as any,
                    corpusRevisionId: "rev1" as any,
                    sourceId: "src1" as any,
                    acceptedDecisionId: "dec1" as any,
                    executionGeneration: 1,
                    canonicalUrl: "https://example.com/initial.pdf",
                    origin: "analyst_url",
                },
            );

            expect(result.status).toBe("failed");
            expect(beforeResolve).toHaveBeenCalledTimes(2);
            // DNS and HTTP only called on hop 1, NOT on hop 2
            expect(resolveAddresses).toHaveBeenCalledTimes(1);
            expect(request).toHaveBeenCalledTimes(1);
        });

        test("Task5: retrieveAndNormalizePublicPdfSource issues 0 DNS and 0 HTTP calls when run cancelled before DNS", async () => {
            const t = convexTest(schema, modules);
            rateLimiterTest.register(t);
            workflowTest.register(t);

            const dnsPromises = await import("node:dns/promises");
            (dnsPromises.lookup as any).mockClear();
            mockPinnedRequest.mockClear();

            const scenario = await createApprovedCorpusScenario(t, {
                sources: [
                    {
                        url: "https://example.com/fence-test.pdf",
                        title: "Fence PDF",
                        origin: "analyst_url",
                        decisions: ["accepted"],
                    },
                ],
            });

            await scenario.asOwner.mutation(startPhase5, {
                runId: scenario.runId,
                requestKey: "req-pdf-fence-cancel",
            });

            // Cancel the run
            await t.run(async (ctx) => {
                await ctx.db.patch(scenario.runId, { executionStatus: "idle" });
            });

            const result = await t.action(retrieveAndNormalizePublicPdfSource, {
                runId: scenario.runId,
                corpusRevisionId: scenario.corpusRevisionId,
                sourceId: scenario.firstAccepted.sourceId,
                acceptedDecisionId: scenario.firstAccepted.lastDecisionId,
                executionGeneration: 2,
            });

            expect(result.status).toBe("failed");
            expect(dnsPromises.lookup as any).toHaveBeenCalledTimes(0);
            expect(mockPinnedRequest).toHaveBeenCalledTimes(0);
        });

        test("Task5: retrieveAndNormalizePublicPdfSource issues 0 DNS and 0 HTTP calls when source decision revoked before DNS", async () => {
            const t = convexTest(schema, modules);
            rateLimiterTest.register(t);
            workflowTest.register(t);

            const dnsPromises = await import("node:dns/promises");
            (dnsPromises.lookup as any).mockClear();
            mockPinnedRequest.mockClear();

            const scenario = await createApprovedCorpusScenario(t, {
                sources: [
                    {
                        url: "https://example.com/fence-test-revoke.pdf",
                        title: "Fence Revoke PDF",
                        origin: "analyst_url",
                        decisions: ["accepted"],
                    },
                ],
            });

            await scenario.asOwner.mutation(startPhase5, {
                runId: scenario.runId,
                requestKey: "req-pdf-fence-revoke",
            });

            // Revoke source decision
            await t.run(async (ctx) => {
                const revId = await ctx.db.insert("sourceDecisions", {
                    runId: scenario.runId,
                    corpusRevisionId: scenario.corpusRevisionId,
                    sourceId: scenario.firstAccepted.sourceId,
                    decision: "rejected",
                    decisionKey: `dec-${scenario.firstAccepted.sourceId}-rev`,
                    occurredAt: 200,
                });
                const item = await ctx.db
                    .query("sourceReviewItems")
                    .withIndex("by_revision_and_source", (q) =>
                        q
                            .eq("corpusRevisionId", scenario.corpusRevisionId)
                            .eq("sourceId", scenario.firstAccepted.sourceId),
                    )
                    .unique();
                if (item) {
                    await ctx.db.patch(item._id, {
                        decision: "rejected",
                        latestDecisionId: revId,
                    });
                }
            });

            const result = await t.action(retrieveAndNormalizePublicPdfSource, {
                runId: scenario.runId,
                corpusRevisionId: scenario.corpusRevisionId,
                sourceId: scenario.firstAccepted.sourceId,
                acceptedDecisionId: scenario.firstAccepted.lastDecisionId,
                executionGeneration: 2,
            });

            expect(result.status).toBe("failed");
            expect(dnsPromises.lookup as any).toHaveBeenCalledTimes(0);
            expect(mockPinnedRequest).toHaveBeenCalledTimes(0);
        });

        test("Task5: PDF retry taxonomy: retries on typed 501 and 505 status codes", async () => {
            for (const statusCode of [501, 505]) {
                let attempts = 0;
                const resolveAddresses = vi.fn(async () => ["93.184.216.34"]);
                const request = vi.fn(async () => {
                    attempts += 1;
                    if (attempts === 1) {
                        return new Response("Server error", {
                            status: statusCode,
                            headers: { "content-type": "text/plain" },
                        });
                    }
                    const fixtureBytes = new TextEncoder().encode(
                        "%PDF-1.4 retry recovered bytes",
                    );
                    return new Response(fixtureBytes, {
                        status: 200,
                        headers: {
                            "content-type": "application/pdf",
                            "content-length": String(fixtureBytes.byteLength),
                        },
                    });
                });

                registerPdfFixture("retry-recovered-key", {
                    bytes: "%PDF-1.4 retry recovered bytes",
                    pages: [{ pageNumber: 1, text: "Recovered page text" }],
                });

                const result = await retrieveAndNormalizePublicPdf(
                    {
                        resolveAddresses,
                        request: request as any,
                    },
                    {
                        runId: "run1" as any,
                        corpusRevisionId: "rev1" as any,
                        sourceId: "src1" as any,
                        acceptedDecisionId: "dec1" as any,
                        executionGeneration: 1,
                        canonicalUrl: `https://example.com/retry-${statusCode}.pdf`,
                        origin: "analyst_url",
                    },
                );

                expect(result.status).toBe("succeeded");
                expect(request).toHaveBeenCalledTimes(2);
            }
        });

        test("Task5: PDF retry taxonomy: does NOT retry on arbitrary error message containing 500 without typed status", async () => {
            const resolveAddresses = vi.fn(async () => ["93.184.216.34"]);
            const request = vi.fn(async () => {
                throw new Error(
                    "HTTP 500 Internal Server Error in downstream proxy",
                );
            });

            const result = await retrieveAndNormalizePublicPdf(
                {
                    resolveAddresses,
                    request: request as any,
                },
                {
                    runId: "run1" as any,
                    corpusRevisionId: "rev1" as any,
                    sourceId: "src1" as any,
                    acceptedDecisionId: "dec1" as any,
                    executionGeneration: 1,
                    canonicalUrl: "https://example.com/untyped-500.pdf",
                    origin: "analyst_url",
                },
            );

            expect(result.status).toBe("failed");
            // Must NOT retry arbitrary untyped error message
            expect(request).toHaveBeenCalledTimes(1);
        });

        test("Task5 defect 3: PDF retry taxonomy: ordinary TypeError not retried", async () => {
            const resolveAddresses = vi.fn(async () => ["93.184.216.34"]);
            const request = vi.fn(async () => {
                throw new TypeError("Cannot read properties of undefined");
            });

            const result = await retrieveAndNormalizePublicPdf(
                {
                    resolveAddresses,
                    request: request as any,
                },
                {
                    runId: "run1" as any,
                    corpusRevisionId: "rev1" as any,
                    sourceId: "src1" as any,
                    acceptedDecisionId: "dec1" as any,
                    executionGeneration: 1,
                    canonicalUrl: "https://example.com/type-error.pdf",
                    origin: "analyst_url",
                },
            );

            expect(result.status).toBe("failed");
            expect(request).toHaveBeenCalledTimes(1);
        });

        test("Task5 defect 3: PDF retry taxonomy: TypeError with ETIMEDOUT code is retried", async () => {
            let calls = 0;
            const resolveAddresses = vi.fn(async () => ["93.184.216.34"]);
            const request = vi.fn(async () => {
                calls += 1;
                if (calls === 1) {
                    const err = new TypeError("fetch failed");
                    (err as any).code = "ETIMEDOUT";
                    throw err;
                }
                return new Response("%PDF-1.4 pdf-timeout-recovered", {
                    status: 200,
                    headers: { "content-type": "application/pdf" },
                });
            });

            registerPdfFixture("pdf-timeout-recovered-key", {
                bytes: "%PDF-1.4 pdf-timeout-recovered",
                pages: [{ pageNumber: 1, text: "Recovered page text" }],
            });

            const result = await retrieveAndNormalizePublicPdf(
                {
                    resolveAddresses,
                    request: request as any,
                },
                {
                    runId: "run1" as any,
                    corpusRevisionId: "rev1" as any,
                    sourceId: "src1" as any,
                    acceptedDecisionId: "dec1" as any,
                    executionGeneration: 1,
                    canonicalUrl: "https://example.com/etimedout.pdf",
                    origin: "analyst_url",
                },
            );

            expect(result.status).toBe("succeeded");
            expect(request).toHaveBeenCalledTimes(2);
        });
    });
});
