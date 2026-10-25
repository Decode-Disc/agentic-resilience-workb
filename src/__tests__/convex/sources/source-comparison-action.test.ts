import { api, internal } from "@convex/_generated/api";
import type { ActionCtx } from "@convex/_generated/server";
import {
    materializeSourceComparisonOutput,
    type PreparedSourceComparisonInput,
    SOURCE_COMPARISON_VERSION,
} from "@convex/domain/sourceComparison";
import { sha256Hex } from "@convex/domain/sourcePassages";
import {
    SOURCE_QUALIFICATION_VERSION,
    type SourceQualification,
} from "@convex/domain/sourceQualification";
import { upsertSourceReviewItem } from "@convex/domain/sourceReviewProjection";
import { compareSource } from "@convex/sourcePreparationActions";
import {
    type FunctionArgs,
    type FunctionReturnType,
    getFunctionName,
} from "convex/server";
import { afterEach, expect, test, vi } from "vitest";
import { seedSourcePreparation } from "@/__tests__/setup/source-preparation";

afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.useRealTimers();
});

test("stores a local not-run result when no comparable primary passage exists", async () => {
    const { t, runId, corpusRevisionId, sourceId } =
        await seedSourcePreparation();
    const preparationId = await t.mutation(
        internal.sourcePreparation.claimForDiscovery,
        { runId, corpusRevisionId, expectedExecutionGeneration: 3 },
    );
    const text = "ServiceNow provides workflow software for enterprise teams.";
    const storageId = await t.run((ctx) =>
        ctx.storage.store(new Blob([text], { type: "text/plain" })),
    );
    const { sourceCaptureId, qualificationTaskId } = await t.run(
        async (ctx) => {
            const captureId = await ctx.db.insert("sourceCaptures", {
                runId,
                corpusRevisionId,
                sourceId,
                preparationId,
                executionGeneration: 3,
                captureKey: "comparison-target-no-primary",
                requestInputHash: sha256Hex("comparison-target-no-primary"),
                status: "committed",
                requestedUrl:
                    "https://www.servicenow.com/products/workflows.html",
                resolvedUrl:
                    "https://www.servicenow.com/products/workflows.html",
                storageId,
                contentHash: sha256Hex(text),
                byteCount: new TextEncoder().encode(text).byteLength,
                mediaType: "text/plain",
                retrievalVersion: "fixture-v1",
                normalizerVersion: "fixture-v1",
                retrievedAt: Date.now(),
                readingCompleteness: "complete",
                omittedPassageCount: 0,
                createdAt: Date.now(),
                updatedAt: Date.now(),
            });
            const qualification: SourceQualification = {
                companyMatch: "uncertain",
                companyPassages: [],
                documentKind: "unknown",
                reportingPeriodEnd: null,
                reportingPeriodPassages: [],
                findings: [],
                limitations: [],
            };
            const qualificationTaskId = await ctx.db.insert("aiTaskResults", {
                runId,
                corpusRevisionId,
                sourceId,
                sourceCaptureId: captureId,
                taskType: "source_qualification",
                executionMode: "live",
                schemaVersion: SOURCE_QUALIFICATION_VERSION,
                adapterVersion: "fixture",
                inputHash: sha256Hex("qualification-input"),
                output: {
                    kind: "source_qualification",
                    sourceCaptureId: captureId,
                    contentHash: sha256Hex(text),
                    qualification,
                    readingCompleteness: "complete",
                    omittedPassageCount: 0,
                    selectedPassages: [
                        {
                            passageKey: "p0",
                            startOffset: 0,
                            endOffset: text.length,
                        },
                    ],
                },
                createdAt: Date.now(),
            });
            return { sourceCaptureId: captureId, qualificationTaskId };
        },
    );
    const request = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", request);

    const result = await t.action(
        internal.sourcePreparationActions.compareSource,
        { preparationId, sourceCaptureId, qualificationTaskId },
    );

    expect(result.status).toBe("not_run");
    expect(request).not.toHaveBeenCalled();
    const tasks = await t.run((ctx) =>
        ctx.db
            .query("aiTaskResults")
            .withIndex("by_run_and_task_type_and_input_hash", (q) =>
                q.eq("runId", runId).eq("taskType", "source_comparison"),
            )
            .take(2),
    );
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
        taskType: "source_comparison",
        schemaVersion: SOURCE_COMPARISON_VERSION,
        output: {
            kind: "source_comparison",
            checkStatus: "not_run",
            targetSourceId: sourceId,
            targetCaptureId: sourceCaptureId,
        },
    });
    expect(await t.run((ctx) => ctx.db.query("providerCalls").take(2))).toEqual(
        [],
    );
    expect(
        (await t.run((ctx) => ctx.db.get(preparationId)))?.modelAttemptCount,
    ).toBe(0);
});

async function capturedComparison(
    primaryText = "The company competes in enterprise workflow software. Competitors may bundle workflow products into broader subscriptions, which can affect how customers evaluate separate applications and platform pricing.",
) {
    const fixture = await seedSourcePreparation();
    const { t, runId, corpusRevisionId, sourceId } = fixture;
    const preparationId = await t.mutation(
        internal.sourcePreparation.claimForDiscovery,
        { runId, corpusRevisionId, expectedExecutionGeneration: 3 },
    );
    const targetText =
        "Management argues that customers can rely on a unified workflow platform combining service management, automation and employee experiences instead of assembling separate point solutions, helping the company defend its competitive position.";
    const {
        sourceCaptureId,
        qualificationTaskId,
        primarySourceId,
        primaryCaptureId,
    } = await t.run(async (ctx) => {
        const targetStorageId = await ctx.storage.store(
            new Blob([targetText], { type: "text/plain" }),
        );
        const sourceCaptureId = await ctx.db.insert("sourceCaptures", {
            runId,
            corpusRevisionId,
            sourceId,
            preparationId,
            executionGeneration: 3,
            captureKey: "comparison-target-with-primary",
            requestInputHash: sha256Hex("comparison-target-with-primary"),
            status: "committed",
            requestedUrl: "https://www.servicenow.com/products/workflows.html",
            resolvedUrl: "https://www.servicenow.com/products/workflows.html",
            storageId: targetStorageId,
            contentHash: sha256Hex(targetText),
            byteCount: new TextEncoder().encode(targetText).byteLength,
            mediaType: "text/plain",
            retrievalVersion: "fixture-v1",
            normalizerVersion: "fixture-v1",
            retrievedAt: Date.now(),
            readingCompleteness: "complete",
            omittedPassageCount: 0,
            createdAt: Date.now(),
            updatedAt: Date.now(),
        });
        const qualification: SourceQualification = {
            companyMatch: "subject",
            companyPassages: [],
            documentKind: "independent_analysis",
            reportingPeriodEnd: null,
            reportingPeriodPassages: [],
            findings: [
                {
                    role: "counter_evidence_primary",
                    kind: "attributed_argument",
                    summary: targetText,
                    passages: [{ passageKey: "p0", quotation: targetText }],
                    period: "current",
                    periodPassages: [],
                    dependsOnFlaggedAssertion: false,
                },
            ],
            limitations: [],
        };
        const qualificationTaskId = await ctx.db.insert("aiTaskResults", {
            runId,
            corpusRevisionId,
            sourceId,
            sourceCaptureId,
            taskType: "source_qualification",
            executionMode: "live",
            schemaVersion: SOURCE_QUALIFICATION_VERSION,
            adapterVersion: "fixture",
            inputHash: sha256Hex("argument-qualification-input"),
            output: {
                kind: "source_qualification",
                sourceCaptureId,
                contentHash: sha256Hex(targetText),
                qualification,
                readingCompleteness: "complete",
                omittedPassageCount: 0,
                selectedPassages: [
                    {
                        passageKey: "p0",
                        startOffset: 0,
                        endOffset: targetText.length,
                    },
                ],
            },
            createdAt: Date.now(),
        });
        const primarySourceId = await ctx.db.insert("sources", {
            runId,
            canonicalUrl:
                "https://www.sec.gov/Archives/edgar/data/1373715/000137371526000005/annual-report.htm",
            title: "Annual report",
            origin: "sec",
            category: "regulatory_annual",
            secForm: "10-K",
            createdAt: Date.now(),
        });
        const decisionId = await ctx.db.insert("sourceDecisions", {
            runId,
            corpusRevisionId,
            sourceId: primarySourceId,
            decisionKey: "comparison-primary-pending",
            decision: "pending",
            occurredAt: Date.now(),
        });
        await upsertSourceReviewItem(ctx, {
            runId,
            corpusRevisionId,
            sourceId: primarySourceId,
            decision: "pending",
            sourceCreatedAt: Date.now(),
            latestDecisionId: decisionId,
            decisionOccurredAt: Date.now(),
        });
        const primaryStorageId = await ctx.storage.store(
            new Blob([primaryText], { type: "text/plain" }),
        );
        const primaryCaptureId = await ctx.db.insert("sourceCaptures", {
            runId,
            corpusRevisionId,
            sourceId: primarySourceId,
            preparationId,
            executionGeneration: 3,
            captureKey: "comparison-primary-context",
            requestInputHash: sha256Hex("comparison-primary-context"),
            status: "committed",
            requestedUrl:
                "https://www.sec.gov/Archives/edgar/data/1373715/000137371526000005/annual-report.htm",
            resolvedUrl:
                "https://www.sec.gov/Archives/edgar/data/1373715/000137371526000005/annual-report.htm",
            storageId: primaryStorageId,
            contentHash: sha256Hex(primaryText),
            byteCount: new TextEncoder().encode(primaryText).byteLength,
            mediaType: "text/plain",
            retrievalVersion: "fixture-v1",
            normalizerVersion: "fixture-v1",
            retrievedAt: Date.now(),
            readingCompleteness: "complete",
            omittedPassageCount: 0,
            createdAt: Date.now(),
            updatedAt: Date.now(),
        });
        return {
            sourceCaptureId,
            qualificationTaskId,
            primarySourceId,
            primaryCaptureId,
        };
    });
    vi.stubEnv("OPENROUTER_API_KEY", "test-only-key");
    const primaryPassageKey = "primary:0";
    const response = {
        findings: [
            {
                findingIndex: 0,
                disposition: "no_conflict_observed",
                explanation:
                    "The cited annual report passage addresses the same workflow competition context.",
                comparableDimensions: [
                    "entity",
                    "concept",
                    "period",
                    "unit_basis",
                    "argument_effect",
                ],
                targetPassageKeys: ["target:0:p0"],
                primaryPassageKeys: [primaryPassageKey],
            },
        ],
    };
    return {
        ...fixture,
        preparationId,
        sourceCaptureId,
        qualificationTaskId,
        primarySourceId,
        primaryCaptureId,
        targetText,
        primaryText,
        primaryPassageKey,
        response,
    };
}

function comparisonResponse(
    response: Awaited<ReturnType<typeof capturedComparison>>["response"],
) {
    return new Response(
        JSON.stringify({
            id: "comparison-action-test",
            created: 1,
            model: "fixture-model",
            provider: "Reka",
            choices: [
                {
                    index: 0,
                    message: {
                        role: "assistant",
                        content: JSON.stringify(response),
                    },
                    finish_reason: "stop",
                },
            ],
            usage: {
                prompt_tokens: 250,
                completion_tokens: 80,
                total_tokens: 330,
                cost: 0.0001,
            },
        }),
        { headers: { "Content-Type": "application/json" } },
    );
}

async function completedComparison() {
    const fixture = await capturedComparison();
    vi.stubEnv("OPENROUTER_API_KEY", "test-only-key");
    const request = vi.fn<typeof fetch>(async () =>
        comparisonResponse(fixture.response),
    );
    vi.stubGlobal("fetch", request);
    const result = await fixture.t.action(
        internal.sourcePreparationActions.compareSource,
        {
            preparationId: fixture.preparationId,
            sourceCaptureId: fixture.sourceCaptureId,
            qualificationTaskId: fixture.qualificationTaskId,
        },
    );
    const taskId = result.taskId;
    if (!taskId) throw new Error("Missing completed comparison");
    const comparison = await fixture.t.run((ctx) => ctx.db.get(taskId));
    if (comparison?.output.kind !== "source_comparison")
        throw new Error("Invalid comparison fixture");
    return {
        ...fixture,
        comparison: { ...comparison, output: comparison.output },
        request,
    };
}

test("a current comparison reuses exact evidence without rebuilding its retrieval input", async () => {
    const { t, preparationId, sourceCaptureId, qualificationTaskId, response } =
        await capturedComparison();
    await t.run((ctx) =>
        ctx.db.patch(preparationId, {
            retrievalVersion: "structured-v1",
            retrievalMode: "lexical",
        }),
    );
    const request = vi.fn<typeof fetch>(async () =>
        comparisonResponse(response),
    );
    vi.stubGlobal("fetch", request);
    const first = await t.action(
        internal.sourcePreparationActions.compareSource,
        { preparationId, sourceCaptureId, qualificationTaskId },
    );
    expect(first.status).toBe("compared");
    await t.action(async (ctx) => {
        const queries = vi.spyOn(ctx, "runQuery");
        const actions = vi.spyOn(ctx, "runAction");
        try {
            const result = await (
                compareSource as unknown as {
                    _handler: (
                        ctx: ActionCtx,
                        args: FunctionArgs<
                            typeof internal.sourcePreparationActions.compareSource
                        >,
                    ) => Promise<
                        FunctionReturnType<
                            typeof internal.sourcePreparationActions.compareSource
                        >
                    >;
                }
            )._handler(ctx, {
                preparationId,
                sourceCaptureId,
                qualificationTaskId,
            });
            expect(result).toEqual({ status: "cached", taskId: first.taskId });
            expect(
                queries.mock.calls.map(([ref]) => getFunctionName(ref)),
            ).not.toContain("sourceRetrieval:searchBatch");
            expect(
                actions.mock.calls.map(([ref]) => getFunctionName(ref)),
            ).not.toContain("sourceRetrievalActions:indexCapture");
        } finally {
            queries.mockRestore();
            actions.mockRestore();
        }
    });
    expect(request).toHaveBeenCalledOnce();
    expect(
        (await t.run((ctx) => ctx.db.get(preparationId)))?.modelAttemptCount,
    ).toBe(1);
});

test.each([
    "missing_primary",
    "corrupt_target",
    "cancelled",
] as const)("cached comparison rejects %s without another provider request", async (change) => {
    const {
        t,
        preparationId,
        sourceCaptureId,
        qualificationTaskId,
        primaryCaptureId,
        runId,
        request,
    } = await completedComparison();
    await t.run(async (ctx) => {
        if (change === "cancelled") {
            await ctx.db.patch(runId, {
                executionGeneration: 4,
                executionStatus: "cancelled",
            });
        } else if (change === "missing_primary") {
            const primary = await ctx.db.get(primaryCaptureId);
            if (!primary?.storageId) throw new Error("Missing primary fixture");
            await ctx.storage.delete(primary.storageId);
        } else {
            const storageId = await ctx.storage.store(
                new Blob(["corrupt capture"]),
            );
            await ctx.db.patch(sourceCaptureId, { storageId });
        }
    });
    expect(
        await t.action(internal.sourcePreparationActions.compareSource, {
            preparationId,
            sourceCaptureId,
            qualificationTaskId,
        }),
    ).toMatchObject({ status: "unavailable" });
    expect(request).toHaveBeenCalledOnce();
    expect(
        (await t.run((ctx) => ctx.db.get(preparationId)))?.modelAttemptCount,
    ).toBe(1);
});

test("cancellation during cached evidence validation prevents reuse", async () => {
    const {
        t,
        preparationId,
        sourceCaptureId,
        qualificationTaskId,
        runId,
        request,
    } = await completedComparison();
    await t.action(async (ctx) => {
        const originalRead = ctx.storage.get.bind(ctx.storage);
        let reads = 0;
        const storage = vi
            .spyOn(ctx.storage, "get")
            .mockImplementation(async (id) => {
                const blob = await originalRead(id);
                if (++reads === 2)
                    await t.run((tx) =>
                        tx.db.patch(runId, {
                            executionGeneration: 4,
                            executionStatus: "cancelled",
                        }),
                    );
                return blob;
            });
        try {
            const result = await (
                compareSource as unknown as {
                    _handler: (
                        ctx: ActionCtx,
                        args: FunctionArgs<
                            typeof internal.sourcePreparationActions.compareSource
                        >,
                    ) => Promise<
                        FunctionReturnType<
                            typeof internal.sourcePreparationActions.compareSource
                        >
                    >;
                }
            )._handler(ctx, {
                preparationId,
                sourceCaptureId,
                qualificationTaskId,
            });
            expect(result).toMatchObject({
                status: "unavailable",
                reasonCode: "stale_execution",
            });
        } finally {
            storage.mockRestore();
        }
    });
    expect(request).toHaveBeenCalledOnce();
    expect(
        (await t.run((ctx) => ctx.db.get(preparationId)))?.modelAttemptCount,
    ).toBe(1);
});

test.each([
    "lookup",
    "replay",
] as const)("comparison %s retains a success after ten unavailable results", async (mode) => {
    vi.useFakeTimers();
    const {
        t,
        preparationId,
        sourceCaptureId,
        qualificationTaskId,
        comparison,
        request,
    } = await completedComparison();
    const latest = await t.run(async (ctx) => {
        const { _id, _creationTime, ...base } = comparison;
        const unavailable = {
            ...comparison.output,
            checkStatus: "provider_unavailable" as const,
            findings: [],
        };
        await ctx.db.patch(_id, {
            providerCallId: undefined,
            output: unavailable,
        });
        for (let index = 0; index < 9; index++) {
            vi.setSystemTime(Date.now() + 1);
            await ctx.db.insert("aiTaskResults", {
                ...base,
                providerCallId: undefined,
                output: unavailable,
                createdAt: Date.now(),
            });
        }
        vi.setSystemTime(Date.now() + 1);
        return ctx.db.insert("aiTaskResults", {
            ...base,
            createdAt: Date.now(),
        });
    });
    if (mode === "lookup") {
        expect(
            await t.query(internal.sourcePreparation.getComparison, {
                preparationId,
                sourceCaptureId,
                qualificationTaskId,
                inputHash: comparison.inputHash,
                now: Date.now(),
            }),
        ).toEqual({ status: "cached", taskId: latest });
    } else {
        expect(
            await t.mutation(internal.sourcePreparation.saveComparison, {
                preparationId,
                sourceCaptureId,
                qualificationTaskId,
                inputHash: comparison.inputHash,
                providerCallId: comparison.providerCallId,
                output: comparison.output,
            }),
        ).toBe(latest);
    }
    expect(
        await t.run((ctx) =>
            ctx.db
                .query("aiTaskResults")
                .withIndex("by_run_and_task_type_and_input_hash", (q) =>
                    q
                        .eq("runId", comparison.runId)
                        .eq("taskType", "source_comparison")
                        .eq("inputHash", comparison.inputHash),
                )
                .take(20),
        ),
    ).toHaveLength(11);
    expect(request).toHaveBeenCalledOnce();
});

test("publication and review retain comparison history beyond 120, including earlier conflicts", async () => {
    vi.stubEnv("SOURCE_QUALIFICATION_ENABLED", "true");
    vi.stubEnv("SOURCE_PREPARATION_WORK_LIMIT", "200");
    vi.stubEnv("SOURCE_PREPARATION_INCIDENT_LIMIT", "150");
    const {
        t,
        runId,
        corpusRevisionId,
        sourceId,
        userId,
        comparison,
        request,
    } = await completedComparison();
    const latest = await t.run(async (ctx) => {
        const { _id, _creationTime, ...base } = comparison;
        await ctx.db.patch(_id, {
            output: {
                ...comparison.output,
                findings: comparison.output.findings.map((finding) => ({
                    ...finding,
                    disposition: "possible_conflict" as const,
                })),
            },
        });
        let latestId = _id;
        for (let index = 0; index < 120; index++)
            latestId = await ctx.db.insert("aiTaskResults", {
                ...base,
                createdAt: Date.now() + index + 1,
            });
        return latestId;
    });
    const proposal = await t.mutation(
        internal.sourceSelectionProposals.generateForRun,
        { runId, expectedExecutionGeneration: 3 },
    );
    const item = await t.run((ctx) =>
        ctx.db
            .query("sourceSelectionProposalItems")
            .withIndex("by_proposal_and_source", (q) =>
                q
                    .eq("proposalId", proposal.proposalId)
                    .eq("sourceId", sourceId),
            )
            .unique(),
    );
    expect(item?.comparisonTaskIds).toHaveLength(121);
    expect(item?.comparisonTaskIds).toEqual(
        expect.arrayContaining([comparison._id, latest]),
    );
    expect(item?.comparisonOutcomes).toContainEqual({
        findingIndex: 0,
        disposition: "possible_conflict",
    });
    // Lower current limits cannot erase history from earlier, more generous executions.
    vi.stubEnv("SOURCE_PREPARATION_WORK_LIMIT", "40");
    expect(
        await t
            .withIdentity({ subject: userId })
            .query(api.sourceSelectionProposals.getCurrent, {
                runId,
                corpusRevisionId,
            }),
    ).toMatchObject({ proposalId: proposal.proposalId });
    expect(request).toHaveBeenCalledOnce();
});

test("invalid future limits preserve saved readings and block only the next preparation", async () => {
    vi.stubEnv("SOURCE_QUALIFICATION_ENABLED", "true");
    const {
        t,
        runId,
        corpusRevisionId,
        sourceId,
        userId,
        preparationId,
        sourceCaptureId,
        qualificationTaskId,
        request,
    } = await completedComparison();
    await t.mutation(internal.sourcePreparation.recordResult, {
        preparationId,
        outcome: {
            sourceId,
            result: {
                status: "qualified",
                sourceCaptureId,
                taskId: qualificationTaskId,
            },
        },
    });
    const finished = await t.mutation(internal.sourcePreparation.finish, {
        preparationId,
        expectedExecutionGeneration: 3,
        stopCode: "missing_configuration",
    });
    await t.run((ctx) =>
        ctx.db.patch(runId, {
            lifecycleState: "awaiting_source_review",
            executionStatus: "paused",
            pauseReason: "source_review",
        }),
    );
    const before = await t.run((ctx) => ctx.db.get(runId));
    vi.stubEnv("SOURCE_PREPARATION_WORK_LIMIT", "broken");
    const owned = t.withIdentity({ subject: userId });
    const current = await owned.query(api.sourceSelectionProposals.getCurrent, {
        runId,
        corpusRevisionId,
    });
    expect(current?.preparation?.assessed).toBeGreaterThan(0);
    expect(current?.preparationAction).toMatchObject({
        available: false,
        reason: "configuration_unavailable",
    });
    await expect(
        owned.mutation(api.sourcePreparation.startForReview, {
            runId,
            corpusRevisionId,
            expectedProposalId: finished.proposalId,
            requestId: "invalid-future-limits",
        }),
    ).rejects.toThrow("preparation_configuration_invalid");
    expect(await t.run((ctx) => ctx.db.get(runId))).toEqual(before);
    expect(request).toHaveBeenCalledOnce();
});

test("a targeted supplement rechecks pinned earlier arguments without reopening their reading", async () => {
    const {
        t,
        preparationId,
        runId,
        sourceId,
        sourceCaptureId,
        qualificationTaskId,
        primarySourceId,
        response,
    } = await capturedComparison();
    const proposal = await t.mutation(
        internal.sourceSelectionProposals.generateForRun,
        { runId, expectedExecutionGeneration: 3 },
    );
    await t.run(async (ctx) => {
        await ctx.db.patch(preparationId, {
            target: { kind: "coverage", role: "official_product_platform" },
            readingSourceIds: [primarySourceId],
            insertedCount: 1,
            expectedProposalId: proposal.proposalId,
            sourceOutcomes: [],
        });
    });
    const targets = await t.query(
        internal.sourcePreparation.comparisonTargets,
        { preparationId, now: Date.now() },
    );
    expect(targets).toContainEqual({
        sourceId,
        sourceCaptureId,
        qualificationTaskId,
    });
    await expect(
        t.query(internal.sourcePreparation.getForExecution, {
            preparationId,
            sourceId,
            now: Date.now(),
        }),
    ).rejects.toThrow("source_outside_preparation");
    vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>(async () => comparisonResponse(response)),
    );
    const result = await t.action(
        internal.sourcePreparationActions.compareSource,
        { preparationId, sourceCaptureId, qualificationTaskId },
    );
    expect(result).toMatchObject({ status: "compared" });
    expect(await t.run((ctx) => ctx.db.get(preparationId))).toMatchObject({
        modelAttemptCount: 1,
    });
    expect(
        await t.action(internal.sourcePreparationActions.compareSource, {
            preparationId,
            sourceCaptureId,
            qualificationTaskId,
        }),
    ).toMatchObject({ status: "cached", taskId: result.taskId });
    await t.run(async (ctx) => {
        await ctx.db.patch(preparationId, {
            readingSourceIds: [],
            insertedCount: 0,
        });
    });
    expect(
        await t.query(internal.sourcePreparation.comparisonTargets, {
            preparationId,
            now: Date.now(),
        }),
    ).toEqual([]);
});

test.each([
    "current",
    "legacy",
])("persists complete comparison explanations and reuses a %s result on replay", async (recordFormat) => {
    const {
        t,
        runId,
        corpusRevisionId,
        sourceId,
        preparationId,
        sourceCaptureId,
        qualificationTaskId,
        primarySourceId,
        primaryCaptureId,
        primaryText,
        primaryPassageKey,
        response,
    } = await capturedComparison();
    const finding = response.findings[0];
    if (!finding) throw new Error("Missing comparison finding");
    const explanation = finding.explanation.repeat(20);
    expect(explanation.length).toBeGreaterThan(600);
    finding.explanation = explanation;
    const request = vi.fn<typeof fetch>(async () =>
        comparisonResponse(response),
    );
    vi.stubGlobal("fetch", request);

    const result = await t.action(
        internal.sourcePreparationActions.compareSource,
        { preparationId, sourceCaptureId, qualificationTaskId },
    );
    const retainedTaskId = result.taskId;
    if (recordFormat === "legacy" && retainedTaskId)
        await t.run((ctx) =>
            ctx.db.patch(retainedTaskId, { comparisonContextHash: undefined }),
        );
    const replay = await t.action(
        internal.sourcePreparationActions.compareSource,
        { preparationId, sourceCaptureId, qualificationTaskId },
    );

    const providerRequest = JSON.parse(
        String(request.mock.calls[0]?.[1]?.body),
    );
    const requestValue = JSON.parse(providerRequest.messages[1].content);
    expect(requestValue.findings).toMatchObject([
        {
            targetPassages: [{ referenceKey: "target:0:p0" }],
            primaryPassageKeys: [primaryPassageKey],
        },
    ]);
    const materialized = materializeSourceComparisonOutput(
        {
            request: requestValue,
            omittedFindingIndexes:
                requestValue.completeness.omittedFindingIndexes,
            serializedRequestBytes: 0,
            inputHash: "0".repeat(64),
        } satisfies PreparedSourceComparisonInput,
        response,
    );
    expect(materialized, JSON.stringify(materialized)).toMatchObject({
        status: "valid",
    });
    expect(result).toMatchObject({ status: "compared" });
    expect(replay).toMatchObject({ status: "cached", taskId: result.taskId });
    expect(request).toHaveBeenCalledOnce();
    const state = await t.run(async (ctx) => ({
        tasks: await ctx.db
            .query("aiTaskResults")
            .withIndex("by_run_and_task_type_and_input_hash", (q) =>
                q.eq("runId", runId).eq("taskType", "source_comparison"),
            )
            .take(2),
        calls: await ctx.db.query("providerCalls").take(3),
        preparation: await ctx.db.get(preparationId),
    }));
    expect(state.tasks).toHaveLength(1);
    expect(state.tasks[0]?.comparisonContextHash).toMatch(/^[a-f0-9]{64}$/);
    expect(state.tasks[0]?.output).toMatchObject({
        kind: "source_comparison",
        checkStatus: "compared",
        runId,
        corpusRevisionId,
        targetSourceId: sourceId,
        targetCaptureId: sourceCaptureId,
        qualificationTaskId,
        findings: [
            {
                disposition: "no_conflict_observed",
                explanation,
                primaryPassages: [
                    {
                        sourceId: primarySourceId,
                        captureId: primaryCaptureId,
                        contentHash: sha256Hex(primaryText),
                    },
                ],
            },
        ],
    });
    expect(state.calls).toHaveLength(1);
    expect(state.calls[0]).toMatchObject({
        operation: "source_comparison",
        status: "succeeded",
        inputHash: state.tasks[0]?.inputHash,
        preparationId,
        sourceId,
        corpusRevisionId,
        executionGeneration: 3,
        workflowVersion: 1,
        stepKey: "source_preparation",
    });
    expect(state.preparation?.modelAttemptCount).toBe(1);
    expect(
        (await t.run((ctx) => ctx.db.get(runId)))
            ?.sourceQualificationAttemptCount,
    ).toBe(1);
});

test.each([
    "cancelled",
    "deadline",
    "primary_rejected",
] as const)("late comparison output after %s cannot publish or trigger fallback", async (change) => {
    const fixture = await capturedComparison();
    const {
        t,
        runId,
        corpusRevisionId,
        preparationId,
        sourceCaptureId,
        qualificationTaskId,
        primarySourceId,
        response,
    } = fixture;
    const request = vi.fn<typeof fetch>(async () => {
        await t.run(async (ctx) => {
            if (change === "cancelled") {
                await ctx.db.patch(runId, {
                    executionGeneration: 4,
                    executionStatus: "cancelled",
                });
            } else if (change === "deadline") {
                await ctx.db.patch(preparationId, {
                    deadlineAt: Date.now() - 1,
                });
            } else {
                const occurredAt = Date.now();
                const decisionId = await ctx.db.insert("sourceDecisions", {
                    runId,
                    corpusRevisionId,
                    sourceId: primarySourceId,
                    decisionKey: "primary-rejected-during-comparison",
                    decision: "rejected",
                    occurredAt,
                });
                await upsertSourceReviewItem(ctx, {
                    runId,
                    corpusRevisionId,
                    sourceId: primarySourceId,
                    decision: "rejected",
                    sourceCreatedAt: occurredAt,
                    latestDecisionId: decisionId,
                    decisionOccurredAt: occurredAt,
                });
            }
        });
        return comparisonResponse(response);
    });
    vi.stubGlobal("fetch", request);
    expect(
        await t.action(internal.sourcePreparationActions.compareSource, {
            preparationId,
            sourceCaptureId,
            qualificationTaskId,
        }),
    ).toMatchObject({ status: "unavailable" });
    expect(request).toHaveBeenCalledOnce();
    const state = await t.run(async (ctx) => ({
        tasks: await ctx.db
            .query("aiTaskResults")
            .withIndex("by_run_and_task_type_and_input_hash", (q) =>
                q.eq("runId", runId).eq("taskType", "source_comparison"),
            )
            .take(2),
        calls: await ctx.db.query("providerCalls").take(3),
    }));
    expect(state.tasks).toEqual([]);
    expect(state.calls).toHaveLength(1);
    expect(state.calls[0]).toMatchObject({
        status: "succeeded",
        reportedCost: 0.0001,
        usage: { inputTokens: 250, outputTokens: 80 },
    });
});

test("cancellation after a retryable provider failure prevents fallback", async () => {
    const { t, runId, preparationId, sourceCaptureId, qualificationTaskId } =
        await capturedComparison();
    const request = vi.fn<typeof fetch>(async () => {
        await t.run((ctx) =>
            ctx.db.patch(runId, {
                executionGeneration: 4,
                executionStatus: "cancelled",
            }),
        );
        return new Response('{"error":{"message":"Unavailable"}}', {
            status: 503,
        });
    });
    vi.stubGlobal("fetch", request);
    expect(
        await t.action(internal.sourcePreparationActions.compareSource, {
            preparationId,
            sourceCaptureId,
            qualificationTaskId,
        }),
    ).toMatchObject({ status: "unavailable", reasonCode: "stale_execution" });
    expect(request).toHaveBeenCalledOnce();
    const state = await t.run(async (ctx) => ({
        tasks: await ctx.db
            .query("aiTaskResults")
            .withIndex("by_run_and_task_type_and_input_hash", (q) =>
                q.eq("runId", runId).eq("taskType", "source_comparison"),
            )
            .take(2),
        calls: await ctx.db.query("providerCalls").take(3),
    }));
    expect(state.tasks).toEqual([]);
    expect(state.calls).toHaveLength(1);
    expect(state.calls[0]?.status).toBe("failed");
});

test("comparison shares the dossier model allowance and reserves nothing when exhausted", async () => {
    const {
        t,
        runId,
        preparationId,
        sourceCaptureId,
        qualificationTaskId,
        response,
    } = await capturedComparison();
    await t.run((ctx) =>
        ctx.db.patch(runId, {
            sourceQualificationAttemptCount: 120,
            sourcePreparationBudget: {
                version: 1,
                work: 120,
                incidents: 0,
                reserved: 0,
                dispatches: 120,
            },
        }),
    );
    const request = vi.fn<typeof fetch>(async () =>
        comparisonResponse(response),
    );
    vi.stubGlobal("fetch", request);
    expect(
        await t.action(internal.sourcePreparationActions.compareSource, {
            preparationId,
            sourceCaptureId,
            qualificationTaskId,
        }),
    ).toMatchObject({
        status: "unavailable",
        reasonCode: "work_budget_exhausted",
    });
    expect(request).not.toHaveBeenCalled();
    const state = await t.run(async (ctx) => ({
        calls: await ctx.db.query("providerCalls").take(1),
        run: await ctx.db.get(runId),
        preparation: await ctx.db.get(preparationId),
        tasks: await ctx.db
            .query("aiTaskResults")
            .withIndex("by_run_and_task_type_and_input_hash", (q) =>
                q.eq("runId", runId).eq("taskType", "source_comparison"),
            )
            .take(2),
    }));
    expect(state.calls).toEqual([]);
    expect(state.run?.sourceQualificationAttemptCount).toBe(120);
    expect(state.preparation?.modelAttemptCount).toBe(0);
    expect(state.tasks[0]?.output).toMatchObject({
        kind: "source_comparison",
        checkStatus: "provider_unavailable",
        findings: [{ disposition: "inconclusive" }],
    });
});

test("a manual target reuses an older same-dossier primary capture without reading other targets", async () => {
    const {
        t,
        runId,
        corpusRevisionId,
        sourceId,
        preparationId,
        sourceCaptureId,
        qualificationTaskId,
        primaryCaptureId,
        primaryText,
        response,
    } = await capturedComparison();
    const oldRevisionId = await t.run(async (ctx) => {
        await ctx.db.patch(corpusRevisionId, { revision: 2 });
        const oldRevisionId = await ctx.db.insert("corpusRevisions", {
            runId,
            revision: 1,
            status: "approved",
            createdAt: 1,
        });
        await ctx.db.patch(primaryCaptureId, {
            corpusRevisionId: oldRevisionId,
        });
        await ctx.db.patch(preparationId, { manualSourceIds: [sourceId] });
        return oldRevisionId;
    });
    const request = vi.fn<typeof fetch>(async () =>
        comparisonResponse(response),
    );
    vi.stubGlobal("fetch", request);
    expect(
        await t.action(internal.sourcePreparationActions.compareSource, {
            preparationId,
            sourceCaptureId,
            qualificationTaskId,
        }),
    ).toMatchObject({ status: "compared" });
    expect(request).toHaveBeenCalledOnce();
    const providerRequest = JSON.parse(
        String(request.mock.calls[0]?.[1]?.body),
    );
    expect(providerRequest.messages[1].content).toContain(primaryText);
    const state = await t.run(async (ctx) => ({
        capture: await ctx.db.get(primaryCaptureId),
        tasks: await ctx.db.query("aiTaskResults").take(5),
        captures: await ctx.db.query("sourceCaptures").take(5),
        preparation: await ctx.db.get(preparationId),
    }));
    expect(state.capture?.corpusRevisionId).toBe(oldRevisionId);
    expect(state.captures).toHaveLength(2);
    expect(
        state.tasks.filter((task) => task.taskType === "source_qualification"),
    ).toHaveLength(1);
    expect(
        state.tasks.filter((task) => task.taskType === "source_comparison"),
    ).toMatchObject([{ sourceId }]);
    expect(state.preparation?.manualSourceIds).toEqual([sourceId]);
});

test("versioned comparison delivers extra retrieved evidence to the provider, persists its exact citation and reuses the result", async () => {
    const primaryText = Array.from(
        { length: 12 },
        (_, i) =>
            `# Disclosure ${i}\n\nThe company competes in workflow software and subscription pricing. ${"Context about enterprise workflows. ".repeat(35)} Unique disclosure ${i}.`,
    ).join("\n\n");
    const fixture = await capturedComparison(primaryText);
    const { t, preparationId, sourceCaptureId, qualificationTaskId } = fixture;
    await t.run((ctx) =>
        ctx.db.patch(preparationId, {
            retrievalVersion: "structured-v1",
            retrievalMode: "lexical",
        }),
    );
    let cited:
        | PreparedSourceComparisonInput["request"]["primaryPassages"][number]
        | undefined;
    const request = vi.fn<typeof fetch>(async (_url, options) => {
        const envelope = JSON.parse(String(options?.body));
        const input = JSON.parse(
            envelope.messages[1].content,
        ) as PreparedSourceComparisonInput["request"];
        const finding = input.findings[0];
        if (!finding) throw new Error("Expected comparison finding");
        expect(input.primaryPassages.length).toBeGreaterThan(6);
        cited = input.primaryPassages.find(
            (p) => !finding.primaryPassageKeys.includes(p.referenceKey),
        );
        if (!cited)
            throw new Error(
                "Retrieved evidence was discarded after the shortlist",
            );
        expect(primaryText.slice(cited.startOffset, cited.endOffset)).toBe(
            cited.quotation,
        );
        const fixtureFinding = fixture.response.findings[0];
        if (!fixtureFinding) throw new Error("Missing fixture finding");
        return comparisonResponse({
            findings: [
                {
                    ...fixtureFinding,
                    primaryPassageKeys: [cited.referenceKey],
                },
            ],
        });
    });
    vi.stubGlobal("fetch", request);
    const args = { preparationId, sourceCaptureId, qualificationTaskId };
    const result = await t.action(
        internal.sourcePreparationActions.compareSource,
        args,
    );
    expect(result.status).toBe("compared");
    const replay = await t.action(
        internal.sourcePreparationActions.compareSource,
        args,
    );
    expect(replay).toMatchObject({ status: "cached", taskId: result.taskId });
    expect(request).toHaveBeenCalledOnce();
    const taskId = result.taskId;
    const task = taskId ? await t.run((ctx) => ctx.db.get(taskId)) : null;
    expect(task?.output).toMatchObject({
        kind: "source_comparison",
        findings: [
            {
                primaryPassages: [
                    {
                        quotation: cited?.quotation,
                        startOffset: cited?.startOffset,
                        endOffset: cited?.endOffset,
                        contentHash: sha256Hex(primaryText),
                    },
                ],
            },
        ],
    });
});

test.each([
    false,
    true,
])("explicit comparison recovery preserves the current failed input with earlier not-run result %s", async (earlierNotRun) => {
    vi.useFakeTimers();
    const { api } = await import("@convex/_generated/api");
    const { default: workflowTest } = await import(
        "@/__tests__/convex/workflows/workflow-test-register.js"
    );
    const {
        t,
        runId,
        corpusRevisionId,
        sourceId,
        userId,
        preparationId,
        sourceCaptureId,
        qualificationTaskId,
        response,
        primarySourceId,
        primaryCaptureId,
    } = await capturedComparison();
    workflowTest.register(t);
    vi.stubEnv("SOURCE_QUALIFICATION_ENABLED", "true");
    if (earlierNotRun) {
        await t.run((ctx) =>
            ctx.db.patch(primaryCaptureId, { status: "unavailable" }),
        );
        expect(
            await t.action(internal.sourcePreparationActions.compareSource, {
                preparationId,
                sourceCaptureId,
                qualificationTaskId,
            }),
        ).toMatchObject({ status: "not_run" });
        await t.run((ctx) =>
            ctx.db.patch(primaryCaptureId, { status: "committed" }),
        );
    }
    const request = vi.fn<typeof fetch>(
        async () =>
            new Response('{"error":{"message":"Unavailable"}}', {
                status: 503,
            }),
    );
    vi.stubGlobal("fetch", request);
    expect(
        await t.action(internal.sourcePreparationActions.compareSource, {
            preparationId,
            sourceCaptureId,
            qualificationTaskId,
        }),
    ).toMatchObject({ status: "unavailable" });
    expect(request).toHaveBeenCalledTimes(2);
    await t.mutation(internal.sourcePreparation.recordResult, {
        preparationId,
        outcome: {
            sourceId,
            result: {
                status: "qualified",
                sourceCaptureId,
                taskId: qualificationTaskId,
            },
        },
    });
    await t.mutation(internal.sourcePreparation.recordResult, {
        preparationId,
        outcome: {
            sourceId: primarySourceId,
            result: {
                status: "unavailable",
                reasonCode: "content_not_available",
            },
        },
    });
    const completed = await t.mutation(internal.sourcePreparation.finish, {
        preparationId,
        expectedExecutionGeneration: 3,
    });
    await t.run((ctx) =>
        ctx.db.patch(runId, {
            lifecycleState: "awaiting_source_review",
            executionStatus: "paused",
            pauseReason: "source_review",
        }),
    );
    expect(
        (
            await t
                .withIdentity({ subject: userId })
                .query(api.sourceSelectionProposals.getCurrent, {
                    runId,
                    corpusRevisionId,
                })
        )?.preparation,
    ).toMatchObject({ pendingComparisons: 1, status: "partial", failed: 1 });
    vi.setSystemTime(Date.now() + 15_001);
    const resumed = await t
        .withIdentity({ subject: userId })
        .mutation(api.sourcePreparation.startForReview, {
            runId,
            corpusRevisionId,
            expectedProposalId: completed.proposalId,
            requestId: "resume-comparison",
        });
    request.mockImplementation(async () => comparisonResponse(response));
    expect(
        await t.action(internal.sourcePreparationActions.compareSource, {
            preparationId: resumed.preparationId,
            sourceCaptureId,
            qualificationTaskId,
        }),
    ).toMatchObject({ status: "compared" });
    expect(request).toHaveBeenCalledTimes(3);
    const tasks = await t.run((ctx) =>
        ctx.db
            .query("aiTaskResults")
            .withIndex("by_source_and_task_type_and_created_at", (q) =>
                q.eq("sourceId", sourceId).eq("taskType", "source_comparison"),
            )
            .take(4),
    );
    expect(tasks).toHaveLength(earlierNotRun ? 3 : 2);
    expect(
        tasks.map((task) =>
            task.output.kind === "source_comparison"
                ? task.output.checkStatus
                : null,
        ),
    ).toEqual(
        earlierNotRun
            ? ["not_run", "provider_unavailable", "compared"]
            : ["provider_unavailable", "compared"],
    );
    vi.useRealTimers();
});

test("an exact legacy comparison can be revalidated at the model limit without provider work", async () => {
    vi.useFakeTimers();
    const { api } = await import("@convex/_generated/api");
    const { default: workflowTest } = await import(
        "@/__tests__/convex/workflows/workflow-test-register.js"
    );
    const {
        t,
        runId,
        corpusRevisionId,
        userId,
        sourceId,
        preparationId,
        sourceCaptureId,
        qualificationTaskId,
        primarySourceId,
        response,
    } = await capturedComparison();
    workflowTest.register(t);
    vi.stubEnv("SOURCE_QUALIFICATION_ENABLED", "true");
    const request = vi.fn<typeof fetch>(async () =>
        comparisonResponse(response),
    );
    vi.stubGlobal("fetch", request);
    const compared = await t.action(
        internal.sourcePreparationActions.compareSource,
        { preparationId, sourceCaptureId, qualificationTaskId },
    );
    if (!compared.taskId) throw Error("Missing retained comparison");
    const taskId = compared.taskId;
    const retained = await t.run((ctx) => ctx.db.get(taskId));
    await t.run(async (ctx) => {
        await ctx.db.patch(taskId, { comparisonContextHash: undefined });
        await ctx.db.patch(runId, {
            sourceQualificationAttemptCount: 120,
            sourcePreparationBudget: {
                version: 1,
                work: 120,
                incidents: 0,
                reserved: 0,
                dispatches: 120,
            },
        });
    });
    await t.mutation(internal.sourcePreparation.recordResult, {
        preparationId,
        outcome: {
            sourceId,
            result: {
                status: "qualified",
                sourceCaptureId,
                taskId: qualificationTaskId,
            },
        },
    });
    await t.mutation(internal.sourcePreparation.recordResult, {
        preparationId,
        outcome: {
            sourceId: primarySourceId,
            result: {
                status: "unavailable",
                reasonCode: "content_not_available",
            },
        },
    });
    const finished = await t.mutation(internal.sourcePreparation.finish, {
        preparationId,
        expectedExecutionGeneration: 3,
    });
    await t.run((ctx) =>
        ctx.db.patch(runId, {
            lifecycleState: "awaiting_source_review",
            executionStatus: "paused",
            pauseReason: "source_review",
        }),
    );
    const owned = t.withIdentity({ subject: userId });
    expect(
        (
            await owned.query(api.sourceSelectionProposals.getCurrent, {
                runId,
                corpusRevisionId,
            })
        )?.preparationAction,
    ).toMatchObject({ available: true });
    const resumed = await owned.mutation(api.sourcePreparation.startForReview, {
        runId,
        corpusRevisionId,
        expectedProposalId: finished.proposalId,
        requestId: "validate-retained-at-model-limit",
    });
    expect(resumed.status).toBe("started");
    expect(
        await t.action(internal.sourcePreparationActions.compareSource, {
            preparationId: resumed.preparationId,
            sourceCaptureId,
            qualificationTaskId,
        }),
    ).toMatchObject({ status: "cached", taskId });
    expect(request).toHaveBeenCalledOnce();
    expect(
        (await t.run((ctx) => ctx.db.get(runId)))
            ?.sourceQualificationAttemptCount,
    ).toBe(120);
    expect((await t.run((ctx) => ctx.db.get(taskId)))?.output).toEqual(
        retained?.output,
    );
    expect(
        await t.run((ctx) => ctx.db.query("providerCalls").take(3)),
    ).toHaveLength(1);
});

test("keeps a conflicted contribution inspectable without dispatching a paid comparison", async () => {
    const { t, preparationId, sourceCaptureId, qualificationTaskId } =
        await capturedComparison();
    await t.run(async (ctx) => {
        const task = await ctx.db.get(qualificationTaskId);
        if (task?.output.kind !== "source_qualification")
            throw new Error("Missing fixture qualification");
        await ctx.db.patch(qualificationTaskId, {
            output: {
                ...task.output,
                qualification: {
                    ...task.output.qualification,
                    limitations: [
                        {
                            code: "no_substantive_content",
                            explanation:
                                "This passage does not establish a substantive contribution.",
                            passages:
                                task.output.qualification.findings[0]
                                    ?.passages ?? [],
                            scope: {
                                kind: "passages",
                                passageKeys: ["p0"],
                                roles: null,
                            },
                        },
                    ],
                },
            },
        });
    });
    const request = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", request);
    const result = await t.action(
        internal.sourcePreparationActions.compareSource,
        { preparationId, sourceCaptureId, qualificationTaskId },
    );
    expect(result.status).toBe("not_run");
    expect(request).not.toHaveBeenCalled();
    expect(await t.run((ctx) => ctx.db.query("providerCalls").take(2))).toEqual(
        [],
    );
    const qualification = await t.run((ctx) => ctx.db.get(qualificationTaskId));
    expect(
        qualification?.output.kind === "source_qualification" &&
            qualification.output.qualification.findings,
    ).toHaveLength(1);
});

test("a scoped conflict does not add retrieval queries to an independent comparison", async () => {
    const { t, preparationId, sourceCaptureId, qualificationTaskId, response } =
        await capturedComparison();
    await t.run(async (ctx) => {
        await ctx.db.patch(preparationId, {
            retrievalVersion: "structured-v1",
            retrievalMode: "lexical",
            retrievalRankingPolicy: "stable-passages-v1",
        });
        const task = await ctx.db.get(qualificationTaskId);
        if (task?.output.kind !== "source_qualification")
            throw new Error("Missing fixture qualification");
        const first = task.output.qualification.findings[0];
        if (!first) throw new Error("Missing fixture finding");
        await ctx.db.patch(qualificationTaskId, {
            output: {
                ...task.output,
                qualification: {
                    ...task.output.qualification,
                    findings: [
                        first,
                        {
                            ...first,
                            role: "independent_analysis_primary",
                            summary: "Workflow competition may increase.",
                        },
                    ],
                    limitations: [
                        {
                            code: "no_substantive_content",
                            explanation:
                                "No substantive material for this need.",
                            passages: first.passages,
                            scope: { kind: "roles", roles: [first.role] },
                        },
                    ],
                },
            },
        });
    });
    const original = response.findings[0];
    if (!original) throw new Error("Missing comparison response");
    const request = vi.fn<typeof fetch>(async () =>
        comparisonResponse({
            findings: [
                {
                    ...original,
                    findingIndex: 1,
                    targetPassageKeys: ["target:1:p0"],
                },
            ],
        }),
    );
    vi.stubGlobal("fetch", request);
    await t.action(async (ctx) => {
        const queries = vi.spyOn(ctx, "runQuery");
        try {
            const result = await (
                compareSource as unknown as {
                    _handler: (
                        ctx: ActionCtx,
                        args: FunctionArgs<
                            typeof internal.sourcePreparationActions.compareSource
                        >,
                    ) => Promise<
                        FunctionReturnType<
                            typeof internal.sourcePreparationActions.compareSource
                        >
                    >;
                }
            )._handler(ctx, {
                preparationId,
                sourceCaptureId,
                qualificationTaskId,
            });
            expect(result.status).toBe("compared");
            const envelope = JSON.parse(
                String(request.mock.calls[0]?.[1]?.body),
            );
            const input = JSON.parse(
                envelope.messages[1].content,
            ) as PreparedSourceComparisonInput["request"];
            expect(
                input.findings.map((finding) => finding.findingIndex),
            ).toEqual([1]);
            expect(
                queries.mock.calls.filter(
                    ([ref]) =>
                        getFunctionName(ref) === "sourceRetrieval:searchBatch",
                ),
            ).toHaveLength(1);
        } finally {
            queries.mockRestore();
        }
    });
    expect(request).toHaveBeenCalledOnce();
    expect(
        (await t.run((ctx) => ctx.db.get(preparationId)))?.modelAttemptCount,
    ).toBe(1);
});
