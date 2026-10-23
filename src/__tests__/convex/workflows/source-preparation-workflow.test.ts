import { lookup } from "node:dns/promises";
import { api, internal } from "@convex/_generated/api";
import { sha256Hex } from "@convex/domain/sourcePassages";
import { upsertSourceReviewItem } from "@convex/domain/sourceReviewProjection";
import { SOURCE_COVERAGE_ROLES } from "@convex/domain/sourceSelectionPolicy";
import { workflow } from "@convex/workflow";
import "@convex/sourcePreparationActions";
import { afterEach, expect, test, vi } from "vitest";
import { seedSourcePreparation } from "@/__tests__/setup/source-preparation";
import rateLimiterTest from "../integrations/rate-limiter-test-register.js";
import workflowTest from "./workflow-test-register.js";

vi.mock("node:dns/promises", () => {
    const lookup = vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]);
    return { lookup, default: { lookup } };
});

const prepareWorkflow = internal.sourcePreparationWorkflow.run;

afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.useRealTimers();
});

async function capturedWorkflowCandidate(
    text = "ServiceNow provides workflow software.",
    sourceOverride?: {
        canonicalUrl: string;
        title: string;
        category: string;
    },
) {
    const fixture = await seedSourcePreparation();
    const { t, runId, corpusRevisionId, sourceId } = fixture;
    workflowTest.register(t);
    await t.mutation(internal.researchPlanning.createForRun, {
        runId,
        expectedExecutionGeneration: 3,
    });
    const preparationId = await t.mutation(
        internal.sourcePreparation.claimForDiscovery,
        { runId, corpusRevisionId, expectedExecutionGeneration: 3 },
    );
    if (sourceOverride)
        await t.run((ctx) => ctx.db.patch(sourceId, sourceOverride));
    const { capture } = await t.mutation(
        internal.sourceCaptures.reserveUpload,
        { preparationId, sourceId },
    );
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob([text])));
    await t.mutation(internal.sourceCaptures.attachStorage, {
        preparationId,
        captureId: capture._id,
        storageId,
    });
    await t.mutation(internal.sourceCaptures.finalize, {
        preparationId,
        captureId: capture._id,
        contentHash: sha256Hex(text),
        byteCount: text.length,
        resolvedUrl: capture.requestedUrl,
        normalizerVersion: capture.normalizerVersion,
        retrievalVersion: "workflow-fixture",
        readingCompleteness: "complete",
        omittedPassageCount: 0,
        retrievedAt: Date.now(),
    });
    await t.run(async (ctx) => {
        await ctx.db.patch(preparationId, { entryPoint: "source_review" });
        await ctx.db.patch(runId, {
            lifecycleState: "awaiting_source_review",
            workflowId: "existing-main-approval-handle",
        });
    });
    return { ...fixture, preparationId, sourceCaptureId: capture._id };
}

function providerResponse(output: unknown) {
    return new Response(
        JSON.stringify({
            id: "workflow-source-comparison",
            created: 1,
            model: "fixture-model",
            provider: "Reka",
            choices: [
                {
                    index: 0,
                    message: {
                        role: "assistant",
                        content: JSON.stringify(output),
                    },
                    finish_reason: "stop",
                },
            ],
            usage: {
                prompt_tokens: 120,
                completion_tokens: 40,
                total_tokens: 160,
            },
        }),
        { headers: { "Content-Type": "application/json" } },
    );
}

function uncertainResponse() {
    return new Response(
        JSON.stringify({
            id: "workflow-qualification",
            created: 1,
            model: "fixture-model",
            choices: [
                {
                    index: 0,
                    message: {
                        role: "assistant",
                        content: JSON.stringify({
                            companyMatch: "uncertain",
                            companyPassageKeys: [],
                            documentKind: "unknown",
                            reportingPeriodEnd: null,
                            reportingPeriodPassageKeys: [],
                            contributions: Object.fromEntries(
                                SOURCE_COVERAGE_ROLES.map((role) => [
                                    role,
                                    null,
                                ]),
                            ),
                            limitations: [],
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
        }),
        { headers: { "Content-Type": "application/json" } },
    );
}

test.each([
    "rejected",
    "deadline_elapsed",
] as const)("late qualification after %s cannot strand preparation or contribute evidence", async (mode) => {
    vi.useFakeTimers();
    vi.stubEnv("OPENROUTER_API_KEY", "test-only-key");
    const { t, runId, corpusRevisionId, userId, sourceId, preparationId } =
        await capturedWorkflowCandidate();
    const preparation = await t.run((ctx) => ctx.db.get(preparationId));
    const request = vi.fn<typeof fetch>(async () => {
        if (mode === "rejected")
            await t
                .withIdentity({ subject: userId })
                .mutation(api.sources.decide, {
                    runId,
                    corpusRevisionId,
                    sourceId,
                    decision: "rejected",
                    decisionKey: "reject-during-model-call",
                });
        else {
            if (!preparation?.deadlineAt) throw new Error("Missing deadline");
            vi.setSystemTime(preparation.deadlineAt + 1);
        }
        return uncertainResponse();
    });
    vi.stubGlobal("fetch", request);
    const handle = await t.run((ctx) =>
        workflow.start(ctx, prepareWorkflow, { preparationId }),
    );
    let completed = false;
    for (let pump = 0; pump < 100; pump++) {
        await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(100));
        const status = await t.run((ctx) => workflow.status(ctx, handle));
        if (status.type !== "inProgress") {
            expect(status).toMatchObject({ type: "completed" });
            completed = true;
            break;
        }
    }
    expect(completed).toBe(true);
    const state = await t.run(async (ctx) => ({
        run: await ctx.db.get(runId),
        revision: await ctx.db.get(corpusRevisionId),
        preparation: await ctx.db.get(preparationId),
        qualifications: await ctx.db.query("aiTaskResults").take(2),
        versions: await ctx.db.query("sourceVersions").take(2),
        claims: await ctx.db.query("claims").take(2),
    }));
    expect(state.run?.executionStatus).toBe("paused");
    expect(state.preparation?.status).toBe("blocked");
    if (mode === "rejected")
        expect(state.preparation?.stopCode).toBe("missing_configuration");
    expect(state.preparation?.sourceOutcomes ?? []).toHaveLength(0);
    expect(state.revision?.status).toBe("draft");
    expect(state.qualifications).toHaveLength(0);
    expect(state.versions).toHaveLength(0);
    expect(state.claims).toHaveLength(0);
    expect(request).toHaveBeenCalledOnce();
});

test("valid uncertainty finishes without fallback and durable replay repeats no provider request", async () => {
    vi.useFakeTimers();
    vi.stubEnv("OPENROUTER_API_KEY", "test-only-key");
    const { t, runId, corpusRevisionId, preparationId } =
        await capturedWorkflowCandidate();
    const request = vi.fn<typeof fetch>(async () => uncertainResponse());
    vi.stubGlobal("fetch", request);
    const handle = await t.run((ctx) =>
        workflow.start(ctx, prepareWorkflow, { preparationId }),
    );
    let completed = false;
    for (let pump = 0; pump < 100; pump++) {
        await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(100));
        const status = await t.run((ctx) => workflow.status(ctx, handle));
        if (status.type !== "inProgress") {
            expect(status).toMatchObject({ type: "completed" });
            completed = true;
            break;
        }
    }
    expect(completed).toBe(true);
    await t.run((ctx) => workflow.restart(ctx, handle));
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(100));
    expect(await t.run((ctx) => workflow.status(ctx, handle))).toMatchObject({
        type: "completed",
    });
    const state = await t.run(async (ctx) => ({
        run: await ctx.db.get(runId),
        revision: await ctx.db.get(corpusRevisionId),
        preparation: await ctx.db.get(preparationId),
        tasks: await ctx.db.query("aiTaskResults").take(4),
        calls: await ctx.db.query("providerCalls").take(2),
        proposals: await ctx.db.query("sourceSelectionProposals").take(2),
        progress: (await ctx.db.query("runEvents").take(10)).filter(
            (event) => event.type === "source_preparation_progress",
        ),
    }));
    expect(state.preparation).toMatchObject({
        status: "partial",
        stopCode: "missing_configuration",
    });
    expect(state.preparation?.sourceOutcomes).toHaveLength(1);
    expect(state.tasks).toHaveLength(2);
    expect(state.tasks[0]?.output).toMatchObject({
        kind: "source_qualification",
        qualification: { companyMatch: "uncertain", findings: [] },
    });
    expect(state.tasks[1]?.output).toMatchObject({
        kind: "source_comparison",
        checkStatus: "not_run",
        findings: [],
    });
    expect(state.calls).toHaveLength(1);
    expect(state.proposals).toHaveLength(1);
    expect(state.progress).toHaveLength(1);
    expect(state.revision?.status).toBe("draft");
    expect(state.run?.executionStatus).toBe("paused");
    expect(request).toHaveBeenCalledOnce();
});

test("compares an early attributed contribution after a later SEC capture is available", async () => {
    vi.useFakeTimers();
    vi.stubEnv("OPENROUTER_API_KEY", "test-only-key");
    const targetText =
        "For ServiceNow, the analysis argues that competitors' bundled workflow products could pressure pricing and position.";
    const primaryText =
        "ServiceNow competes with enterprise software providers that bundle workflow products into broader subscriptions, which can affect pricing.";
    const { t, runId, corpusRevisionId, userId, sourceId, preparationId } =
        await capturedWorkflowCandidate(targetText, {
            canonicalUrl: "https://research.example/workflow-analysis",
            title: "Independent workflow analysis",
            category: "independent_analysis",
        });
    rateLimiterTest.register(t);
    const { fillerSourceId, primarySourceId } = await t.run(async (ctx) => {
        const createPendingSource = async (source: {
            canonicalUrl: string;
            title: string;
            origin: "exa" | "sec";
            category: string;
            secForm?: string;
        }) => {
            const createdAt = Date.now();
            const id = await ctx.db.insert("sources", {
                runId,
                ...source,
                createdAt,
            });
            const decisionId = await ctx.db.insert("sourceDecisions", {
                runId,
                corpusRevisionId,
                sourceId: id,
                decisionKey: `pending-${id}`,
                decision: "pending",
                occurredAt: createdAt,
            });
            await upsertSourceReviewItem(ctx, {
                runId,
                corpusRevisionId,
                sourceId: id,
                decision: "pending",
                sourceCreatedAt: createdAt,
                latestDecisionId: decisionId,
                decisionOccurredAt: createdAt,
            });
            return id;
        };
        return {
            fillerSourceId: await createPendingSource({
                canonicalUrl: "https://research.example/market-overview",
                title: "Market overview",
                origin: "exa",
                category: "independent_analysis",
            }),
            primarySourceId: await createPendingSource({
                canonicalUrl:
                    "https://www.sec.gov/Archives/edgar/data/1373715/000137371526000005/annual-report.htm",
                title: "Annual report",
                origin: "sec",
                category: "regulatory_annual",
                secForm: "10-K",
            }),
        };
    });
    await t.run((ctx) =>
        ctx.db.patch(preparationId, {
            manualSourceIds: [sourceId, fillerSourceId, primarySourceId],
        }),
    );
    const firstBatch = await t.mutation(internal.sourcePreparation.nextBatch, {
        preparationId,
    });
    expect(firstBatch.sourceIds).toEqual([sourceId, fillerSourceId]);
    const fillerText = "The overview describes enterprise software markets.";
    const filler = await t.mutation(internal.sourceCaptures.reserveUpload, {
        preparationId,
        sourceId: fillerSourceId,
    });
    const fillerStorageId = await t.run((ctx) =>
        ctx.storage.store(new Blob([fillerText], { type: "text/plain" })),
    );
    await t.mutation(internal.sourceCaptures.attachStorage, {
        preparationId,
        captureId: filler.capture._id,
        storageId: fillerStorageId,
    });
    await t.mutation(internal.sourceCaptures.finalize, {
        preparationId,
        captureId: filler.capture._id,
        contentHash: sha256Hex(fillerText),
        byteCount: new TextEncoder().encode(fillerText).byteLength,
        resolvedUrl: filler.source.canonicalUrl,
        normalizerVersion: filler.capture.normalizerVersion,
        retrievalVersion: "workflow-fixture",
        readingCompleteness: "complete",
        omittedPassageCount: 0,
        retrievedAt: Date.now(),
    });

    const comparisonRequests: Array<Record<string, unknown>> = [];
    const request = vi.fn<typeof fetch>(async (url, init) => {
        const requestUrl =
            typeof url === "string"
                ? url
                : url instanceof URL
                  ? url.href
                  : url.url;
        if (requestUrl.includes("/Archives/edgar/"))
            return new Response(`<h1>Competition</h1><p>${primaryText}</p>`, {
                headers: { "Content-Type": "text/html" },
            });
        const body = JSON.parse(String(init?.body)) as {
            messages?: Array<{ content?: string }>;
        };
        const promptText = body.messages?.at(-1)?.content ?? "{}";
        const prompt = JSON.parse(promptText) as Record<string, unknown>;
        if (prompt.comparisonVersion) {
            comparisonRequests.push(prompt);
            const findings = Array.isArray(prompt.findings)
                ? prompt.findings.map((raw) => {
                      const finding = raw as {
                          findingIndex: number;
                          targetPassages: Array<{ referenceKey: string }>;
                          primaryPassageKeys: string[];
                      };
                      return {
                          findingIndex: finding.findingIndex,
                          disposition: finding.primaryPassageKeys.length
                              ? "no_conflict_observed"
                              : "inconclusive",
                          explanation:
                              "The comparison is limited to the supplied passage references.",
                          comparableDimensions: finding.primaryPassageKeys
                              .length
                              ? [
                                    "entity",
                                    "concept",
                                    "period",
                                    "unit_basis",
                                    "argument_effect",
                                ]
                              : [],
                          targetPassageKeys: finding.targetPassages.map(
                              (passage) => passage.referenceKey,
                          ),
                          primaryPassageKeys: finding.primaryPassageKeys,
                      };
                  })
                : [];
            return providerResponse({ findings });
        }
        const isTargetQualification = promptText.includes(targetText);
        const contributions = Object.fromEntries(
            SOURCE_COVERAGE_ROLES.map((role) => [
                role,
                isTargetQualification && role === "counter_evidence_primary"
                    ? [
                          {
                              kind: "attributed_argument",
                              passageKeys: ["p0"],
                              period: "unspecified",
                              periodPassageKeys: [],
                              dependsOnFlaggedAssertion: false,
                          },
                      ]
                    : null,
            ]),
        );
        return providerResponse({
            companyMatch: isTargetQualification ? "subject" : "uncertain",
            companyPassageKeys: isTargetQualification ? ["p0"] : [],
            documentKind: isTargetQualification
                ? "independent_analysis"
                : "unknown",
            reportingPeriodEnd: null,
            reportingPeriodPassageKeys: [],
            contributions,
            limitations: [],
        });
    });
    vi.stubGlobal("fetch", request);

    const handle = await t.run((ctx) =>
        workflow.start(ctx, prepareWorkflow, { preparationId }),
    );
    let completed = false;
    for (let pump = 0; pump < 100; pump++) {
        await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(100));
        const status = await t.run((ctx) => workflow.status(ctx, handle));
        if (status.type !== "inProgress") {
            expect(status).toMatchObject({ type: "completed" });
            completed = true;
            break;
        }
    }
    expect(completed).toBe(true);
    expect(lookup).toHaveBeenCalledWith("www.sec.gov", {
        all: true,
        verbatim: true,
    });
    expect(comparisonRequests).toHaveLength(1);
    const comparedInput = comparisonRequests[0];
    expect(comparedInput?.primaryPassages).toEqual(
        expect.arrayContaining([
            expect.objectContaining({
                quotation: expect.stringContaining(primaryText),
            }),
        ]),
    );
    const comparisonTasks = await t.run(async (ctx) =>
        ctx.db
            .query("aiTaskResults")
            .withIndex("by_source_and_task_type_and_created_at", (q) =>
                q.eq("sourceId", sourceId).eq("taskType", "source_comparison"),
            )
            .order("desc")
            .take(10),
    );
    expect(comparisonTasks).toHaveLength(1);
    const comparisonTask = comparisonTasks[0];
    expect(comparisonTask?.output).toMatchObject({
        kind: "source_comparison",
        checkStatus: "compared",
        findings: [{ disposition: "no_conflict_observed" }],
    });
    const proposalItem = await t.run(async (ctx) => {
        const revision = await ctx.db.get(corpusRevisionId);
        const proposalId = revision?.sourceSelectionProposalId;
        if (!proposalId) return null;
        return ctx.db
            .query("sourceSelectionProposalItems")
            .withIndex("by_proposal_and_source", (q) =>
                q.eq("proposalId", proposalId).eq("sourceId", sourceId),
            )
            .unique();
    });
    expect(proposalItem?.comparisonTaskIds).toContain(comparisonTask?._id);
    expect(proposalItem?.comparisonOutcomes).toEqual([
        { findingIndex: 0, disposition: "no_conflict_observed" },
    ]);

    await t.withIdentity({ subject: userId }).mutation(api.sources.decide, {
        runId,
        corpusRevisionId,
        sourceId: primarySourceId,
        decision: "rejected",
        decisionKey: "reject-compared-primary-before-approval",
        reason: "The primary document is not approved for this corpus",
    });
    const proposal = await t.run(async (ctx) => {
        const revision = await ctx.db.get(corpusRevisionId);
        await ctx.db.patch(runId, { workflowId: handle });
        return revision?.sourceSelectionProposalId
            ? await ctx.db.get(revision.sourceSelectionProposalId)
            : null;
    });
    if (!proposal) throw new Error("Missing prepared source proposal");
    await expect(
        t
            .withIdentity({ subject: userId })
            .mutation(api.sourceSelectionProposals.approveProposedCorpus, {
                runId,
                corpusRevisionId,
                proposalId: proposal._id,
                proposalVersion: proposal.version,
                decisionKey: "approve-after-primary-rejection",
            }),
    ).rejects.toThrow("Source selection proposal is stale");
});

test("legacy preparation journal without a comparison snapshot skips comparison steps", async () => {
    vi.useFakeTimers();
    vi.stubEnv("OPENROUTER_API_KEY", "test-only-key");
    const targetText =
        "For ServiceNow, the analysis argues that bundled workflow products could pressure pricing.";
    const { t, sourceId, preparationId } =
        await capturedWorkflowCandidate(targetText);
    await t.run((ctx) =>
        ctx.db.patch(preparationId, {
            comparisonVersion: undefined,
            manualSourceIds: [sourceId],
        }),
    );
    const contributions = Object.fromEntries(
        SOURCE_COVERAGE_ROLES.map((role) => [
            role,
            role === "counter_evidence_primary"
                ? [
                      {
                          kind: "attributed_argument",
                          passageKeys: ["p0"],
                          period: "unspecified",
                          periodPassageKeys: [],
                          dependsOnFlaggedAssertion: false,
                      },
                  ]
                : null,
        ]),
    );
    const request = vi.fn<typeof fetch>(async () =>
        providerResponse({
            companyMatch: "subject",
            companyPassageKeys: ["p0"],
            documentKind: "independent_analysis",
            reportingPeriodEnd: null,
            reportingPeriodPassageKeys: [],
            contributions,
            limitations: [],
        }),
    );
    vi.stubGlobal("fetch", request);

    const handle = await t.run((ctx) =>
        workflow.start(ctx, prepareWorkflow, { preparationId }),
    );
    for (let pump = 0; pump < 100; pump++) {
        await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(100));
        const status = await t.run((ctx) => workflow.status(ctx, handle));
        if (status.type !== "inProgress") {
            expect(status).toMatchObject({ type: "completed" });
            break;
        }
    }
    const tasks = await t.run((ctx) =>
        ctx.db
            .query("aiTaskResults")
            .withIndex("by_source_and_task_type_and_created_at", (q) =>
                q.eq("sourceId", sourceId),
            )
            .take(10),
    );
    expect(
        tasks.filter((task) => task.taskType === "source_comparison"),
    ).toHaveLength(0);
    expect(tasks).toEqual(
        expect.arrayContaining([
            expect.objectContaining({
                taskType: "source_qualification",
                output: expect.objectContaining({
                    kind: "source_qualification",
                    qualification: expect.objectContaining({
                        findings: [
                            expect.objectContaining({
                                kind: "attributed_argument",
                            }),
                        ],
                    }),
                }),
            }),
        ]),
    );
    expect(request).toHaveBeenCalledOnce();
});

test.each([
    "cancelled",
    "generation_changed",
] as const)("%s during a model call cannot persist a qualification, publish a proposal or retry the call", async (mode) => {
    vi.useFakeTimers();
    vi.stubEnv("OPENROUTER_API_KEY", "test-only-key");
    const { t, runId, preparationId } = await capturedWorkflowCandidate();
    const request = vi.fn<typeof fetch>(async () => {
        await t.run((ctx) =>
            ctx.db.patch(
                runId,
                mode === "cancelled"
                    ? { executionStatus: "cancelled" }
                    : { executionGeneration: 4 },
            ),
        );
        return uncertainResponse();
    });
    vi.stubGlobal("fetch", request);
    const handle = await t.run((ctx) =>
        workflow.start(ctx, prepareWorkflow, { preparationId }),
    );
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(100));
    expect(await t.run((ctx) => workflow.status(ctx, handle))).toMatchObject({
        type: "failed",
        error: expect.stringContaining("stale_execution"),
    });
    const state = await t.run(async (ctx) => ({
        run: await ctx.db.get(runId),
        tasks: await ctx.db.query("aiTaskResults").take(2),
        proposals: await ctx.db.query("sourceSelectionProposals").take(2),
    }));
    expect(state.tasks).toHaveLength(0);
    expect(state.proposals).toHaveLength(0);
    expect(state.run?.executionStatus).toBe(
        mode === "cancelled" ? "cancelled" : "running",
    );
    expect(request).toHaveBeenCalledOnce();
});

test("missing model configuration stops before acquisition and preserves an unapproved proposal", async () => {
    vi.useFakeTimers();
    vi.stubEnv("EXA_API_KEY", "");
    vi.stubEnv("OPENROUTER_API_KEY", "");
    const request = vi.fn<typeof fetch>(async () => {
        throw new Error("Unexpected external request");
    });
    vi.stubGlobal("fetch", request);
    const { t, runId, corpusRevisionId } = await seedSourcePreparation();
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
        await ctx.db.patch(preparationId, { entryPoint: "source_review" });
        await ctx.db.patch(runId, {
            lifecycleState: "awaiting_source_review",
            workflowId: "existing-main-approval-handle",
        });
        for (const suffix of ["second", "third"]) {
            const sourceId = await ctx.db.insert("sources", {
                runId,
                canonicalUrl: `https://www.servicenow.com/${suffix}`,
                title: suffix,
                origin: "exa",
                category: "official_product",
                createdAt: Date.now(),
            });
            const decisionId = await ctx.db.insert("sourceDecisions", {
                runId,
                corpusRevisionId,
                sourceId,
                decisionKey: `pending-${suffix}`,
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
    });
    const handle = await t.run((ctx) =>
        workflow.start(ctx, prepareWorkflow, { preparationId }),
    );
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(100));
    expect(await t.run((ctx) => workflow.status(ctx, handle))).toMatchObject({
        type: "completed",
    });
    const state = await t.run(async (ctx) => ({
        preparation: await ctx.db.get(preparationId),
        run: await ctx.db.get(runId),
        revision: await ctx.db.get(corpusRevisionId),
        captures: await ctx.db.query("sourceCaptures").take(4),
        proposals: await ctx.db.query("sourceSelectionProposals").take(2),
        versions: await ctx.db.query("sourceVersions").take(2),
        calls: await ctx.db.query("providerCalls").take(2),
    }));
    expect(state.preparation).toMatchObject({
        status: "blocked",
        stopCode: "missing_configuration",
    });
    expect(state.preparation?.sourceOutcomes ?? []).toHaveLength(0);
    expect(state.captures).toHaveLength(0);
    expect(state.proposals).toHaveLength(1);
    expect(state.run).toMatchObject({
        workflowId: "existing-main-approval-handle",
        executionStatus: "paused",
    });
    expect(state.revision?.status).toBe("draft");
    expect(state.versions).toHaveLength(0);
    expect(state.calls).toHaveLength(0);
    expect(request).not.toHaveBeenCalled();
});

test("reads existing candidates before one three-search supplement and replay cannot repeat it", async () => {
    vi.useFakeTimers();
    vi.stubEnv("OPENROUTER_API_KEY", "test-only-key");
    vi.stubEnv("EXA_API_KEY", "test-only-exa-key");
    const { t, preparationId } = await capturedWorkflowCandidate();
    const order: string[] = [];
    const request = vi.fn<typeof fetch>(async (url) => {
        if (String(url).includes("openrouter.ai")) {
            order.push("model");
            return uncertainResponse();
        }
        if (String(url) === "https://api.exa.ai/search") {
            order.push("search");
            return Response.json({ results: [] });
        }
        throw new Error("Unexpected external boundary");
    });
    vi.stubGlobal("fetch", request);
    const handle = await t.run((ctx) =>
        workflow.start(ctx, prepareWorkflow, { preparationId }),
    );
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(100));
    expect(await t.run((ctx) => workflow.status(ctx, handle))).toMatchObject({
        type: "completed",
    });
    expect(order).toEqual(["model", "search", "search", "search"]);
    await t.run((ctx) => workflow.restart(ctx, handle, { from: 0 }));
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(100));
    expect(request).toHaveBeenCalledTimes(4);
});
