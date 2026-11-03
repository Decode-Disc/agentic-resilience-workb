import { internal } from "@convex/_generated/api";
import { sha256Hex } from "@convex/domain/sourcePassages";
import { SOURCE_QUALIFICATION_VERSION } from "@convex/domain/sourceQualification";
import { upsertSourceReviewItem } from "@convex/domain/sourceReviewProjection";
import { workflow } from "@convex/workflow";
import "@convex/sourcePreparationActions";
import { afterEach, expect, test, vi } from "vitest";
import { seedSourcePreparation } from "@/__tests__/setup/source-preparation";
import workflowTest from "./workflow-test-register.js";

afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.useRealTimers();
});

test.each([
    2, 4,
])("eight qualified targets receive eight final comparisons at concurrency %s after three supplemental searches", async (concurrency) => {
    vi.stubEnv("SOURCE_PREPARATION_MAX_CONCURRENCY", String(concurrency));
    vi.useFakeTimers();
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    vi.stubEnv("EXA_API_KEY", "test-exa-key");
    const {
        t,
        runId,
        corpusRevisionId,
        sourceId: primaryId,
    } = await seedSourcePreparation({ models: true });
    workflowTest.register(t);
    await t.mutation(internal.researchPlanning.createForRun, {
        runId,
        expectedExecutionGeneration: 3,
    });
    const preparationId = await t.mutation(
        internal.sourcePreparation.claimForDiscovery,
        { runId, corpusRevisionId, expectedExecutionGeneration: 3 },
    );
    await t.run(async (ctx) => {
        const outcomes = [];
        for (let index = 0; index < 9; index++) {
            const primary = index === 0;
            const url = primary
                ? "https://www.sec.gov/Archives/edgar/data/1373715/000137371526000005/report.htm"
                : `https://research-${index}.example/servicenow`;
            const sourceId = primary
                ? primaryId
                : await ctx.db.insert("sources", {
                      runId,
                      canonicalUrl: url,
                      title: `ServiceNow argument ${index}`,
                      origin: "exa",
                      category: "independent_analysis",
                      createdAt: Date.now(),
                  });
            if (primary)
                await ctx.db.patch(sourceId, {
                    canonicalUrl: url,
                    title: "ServiceNow annual report",
                    origin: "sec",
                    secForm: "10-K",
                    category: "regulatory_annual",
                });
            else {
                const decisionId = await ctx.db.insert("sourceDecisions", {
                    runId,
                    corpusRevisionId,
                    sourceId,
                    decisionKey: `target-${index}`,
                    decision: "pending",
                    occurredAt: Date.now(),
                });
                await upsertSourceReviewItem(ctx, {
                    runId,
                    corpusRevisionId,
                    sourceId,
                    decision: "pending",
                    sourceCreatedAt: Date.now(),
                    latestDecisionId: decisionId,
                    decisionOccurredAt: Date.now(),
                });
            }
            const text = primary
                ? "ServiceNow competes with bundled workflow providers."
                : `ServiceNow workflow pricing could face pressure from bundled competitors: argument ${index}.`;
            const storageId = await ctx.storage.store(new Blob([text]));
            const captureId = await ctx.db.insert("sourceCaptures", {
                runId,
                corpusRevisionId,
                sourceId,
                preparationId,
                executionGeneration: 3,
                captureKey: `final-pass-${index}`,
                requestInputHash: sha256Hex(url),
                status: "committed",
                requestedUrl: url,
                resolvedUrl: url,
                storageId,
                contentHash: sha256Hex(text),
                byteCount: text.length,
                normalizerVersion: "fixture",
                readingCompleteness: "complete",
                omittedPassageCount: 0,
                retrievedAt: Date.now(),
                createdAt: Date.now(),
                updatedAt: Date.now(),
            });
            const passage = { passageKey: "p0", quotation: text };
            const taskId = await ctx.db.insert("aiTaskResults", {
                runId,
                corpusRevisionId,
                sourceId,
                sourceCaptureId: captureId,
                taskType: "source_qualification",
                executionMode: "live",
                schemaVersion: SOURCE_QUALIFICATION_VERSION,
                adapterVersion: "fixture",
                inputHash: sha256Hex(`qualified-${url}`),
                output: {
                    kind: "source_qualification",
                    sourceCaptureId: captureId,
                    contentHash: sha256Hex(text),
                    readingCompleteness: "complete",
                    omittedPassageCount: 0,
                    selectedPassages: [
                        {
                            passageKey: "p0",
                            startOffset: 0,
                            endOffset: text.length,
                        },
                    ],
                    qualification: {
                        companyMatch: "subject",
                        companyPassages: [passage],
                        documentKind: primary
                            ? "regulatory_annual"
                            : "independent_analysis",
                        reportingPeriodEnd: null,
                        reportingPeriodPassages: [],
                        findings: primary
                            ? []
                            : [
                                  {
                                      role: "counter_evidence_primary",
                                      kind: "attributed_argument",
                                      summary: `Pricing argument ${index}`,
                                      passages: [passage],
                                      period: "unspecified",
                                      periodPassages: [],
                                      dependsOnFlaggedAssertion: false,
                                  },
                              ],
                        limitations: [],
                    },
                },
                createdAt: Date.now(),
            });
            outcomes.push({
                sourceId,
                result: {
                    status: "qualified" as const,
                    taskId,
                    sourceCaptureId: captureId,
                },
            });
        }
        await ctx.db.patch(preparationId, { sourceOutcomes: outcomes });
    });
    const order: string[] = [];
    vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>(async (url, init) => {
            if (String(url) === "https://api.exa.ai/search") {
                order.push("search");
                return Response.json({ results: [] });
            }
            if (!String(url).includes("openrouter.ai"))
                throw Error("Unexpected external boundary");
            order.push("comparison");
            const body = JSON.parse(String(init?.body));
            const prompt = JSON.parse(body.messages.at(-1).content);
            return Response.json({
                id: "final-pass-response",
                created: 1,
                model: "fixture-model",
                choices: [
                    {
                        index: 0,
                        message: {
                            role: "assistant",
                            content: JSON.stringify({
                                findings: prompt.findings.map(
                                    (finding: {
                                        findingIndex: number;
                                        targetPassages: Array<{
                                            referenceKey: string;
                                        }>;
                                    }) => ({
                                        findingIndex: finding.findingIndex,
                                        disposition: "inconclusive",
                                        explanation:
                                            "Captured context does not resolve this argument.",
                                        comparableDimensions: [],
                                        targetPassageKeys:
                                            finding.targetPassages.map(
                                                (p) => p.referenceKey,
                                            ),
                                        primaryPassageKeys: [],
                                    }),
                                ),
                            }),
                        },
                        finish_reason: "stop",
                    },
                ],
                usage: {
                    prompt_tokens: 100,
                    completion_tokens: 50,
                    total_tokens: 150,
                },
            });
        }),
    );
    const handle = await t.run((ctx) =>
        workflow.start(ctx, internal.sourcePreparationWorkflow.run, {
            preparationId,
        }),
    );
    const scheduler = t as typeof t & {
        finishAllScheduledFunctions(
            advance: () => void,
            maximumIterations: number,
        ): Promise<void>;
    };
    async function finishWorkflow() {
        for (let pump = 0; pump < 100; pump++) {
            await scheduler.finishAllScheduledFunctions(
                () => vi.advanceTimersByTime(100),
                500,
            );
            const status = await t.run((ctx) => workflow.status(ctx, handle));
            if (status.type !== "inProgress") {
                expect(status).toMatchObject({ type: "completed" });
                return;
            }
        }
        throw new Error(
            "Preparation did not complete within the bounded scheduler window",
        );
    }
    await finishWorkflow();
    expect(order).toEqual([
        ...Array<string>(3).fill("search"),
        ...Array<string>(8).fill("comparison"),
    ]);
    const state = await t.run(async (ctx) => ({
        preparation: await ctx.db.get(preparationId),
        revision: await ctx.db.get(corpusRevisionId),
        tasks: await ctx.db
            .query("aiTaskResults")
            .withIndex("by_run", (q) => q.eq("runId", runId))
            .take(30),
        calls: await ctx.db
            .query("providerCalls")
            .withIndex("by_run", (q) => q.eq("runId", runId))
            .take(20),
    }));
    expect(state.preparation?.status).not.toBe("started");
    expect(state.revision?.status).toBe("draft");
    const comparisons = state.tasks.filter(
        (t) =>
            t.output.kind === "source_comparison" &&
            t.output.checkStatus === "compared",
    );
    expect(comparisons).toHaveLength(8);
    expect(new Set(comparisons.map((t) => t.sourceId)).size).toBe(8);
    expect(
        state.calls.filter((c) => c.operation === "source_comparison"),
    ).toHaveLength(8);
    expect(state.calls.every((c) => c.status === "succeeded")).toBe(true);
    await t.run((ctx) => workflow.restart(ctx, handle, { from: 0 }));
    await finishWorkflow();
    expect(order).toHaveLength(11);
}, 15_000);
