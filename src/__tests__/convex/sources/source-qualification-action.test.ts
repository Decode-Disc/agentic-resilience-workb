import { internal } from "@convex/_generated/api";
import {
    prepareQualificationInput,
    type SourceQualification,
} from "@convex/domain/sourceQualification";
import { SOURCE_COVERAGE_ROLES } from "@convex/domain/sourceSelectionPolicy";
import { afterEach, expect, test, vi } from "vitest";
import { seedSourcePreparation } from "@/__tests__/setup/source-preparation";

afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.useRealTimers();
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
const success = () =>
    new Response(
        JSON.stringify({
            id: "test-qualification",
            created: 1,
            model: "test-model",
            provider: "test-provider",
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
                cost: 0.0001,
            },
        }),
        { headers: { "Content-Type": "application/json" } },
    );

async function capturedCandidate(
    text = "ServiceNow provides workflow software.",
) {
    const fixture = await seedSourcePreparation();
    const { t, runId, corpusRevisionId, sourceId } = fixture;
    const preparationId = await t.mutation(
        internal.sourcePreparation.claimForDiscovery,
        { runId, corpusRevisionId, expectedExecutionGeneration: 3 },
    );
    const reserved = await t.mutation(internal.sourceCaptures.reserveUpload, {
        preparationId,
        sourceId,
    });
    const prepared = prepareQualificationInput({
        company: reserved.company,
        canonicalUrl: reserved.source.canonicalUrl,
        title: reserved.source.title,
        selectionPolicy: reserved.capture.qualificationInputPolicy,
        asOfTime: Date.now(),
        text,
    });
    const storageId = await t.run((ctx) =>
        ctx.storage.store(new Blob([prepared.normalizedText])),
    );
    await t.mutation(internal.sourceCaptures.attachStorage, {
        preparationId,
        captureId: reserved.capture._id,
        storageId,
    });
    await t.mutation(internal.sourceCaptures.finalize, {
        preparationId,
        captureId: reserved.capture._id,
        contentHash: prepared.request.document.contentHash,
        byteCount: new TextEncoder().encode(prepared.normalizedText).byteLength,
        resolvedUrl: reserved.source.canonicalUrl,
        retrievalVersion: "test-v1",
        normalizerVersion: reserved.capture.normalizerVersion,
        retrievedAt: Date.now(),
        readingCompleteness: "complete",
        omittedPassageCount: 0,
    });
    return {
        ...fixture,
        preparationId,
        sourceCaptureId: reserved.capture._id,
        prepared,
    };
}

test("persists valid uncertainty once without semantic escalation", async () => {
    const { t, preparationId, sourceCaptureId } = await capturedCandidate();
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    const request = vi.fn<typeof fetch>(async () => success());
    vi.stubGlobal("fetch", request);
    const result = await t.action(
        internal.sourcePreparationActions.qualifySource,
        { preparationId, sourceCaptureId },
    );
    expect(result).toMatchObject({ status: "qualified" });
    expect(
        await t.action(internal.sourcePreparationActions.qualifySource, {
            preparationId,
            sourceCaptureId,
        }),
    ).toEqual(result);
    expect(request).toHaveBeenCalledOnce();
    const state = await t.run(async (ctx) => ({
        tasks: await ctx.db.query("aiTaskResults").take(3),
        calls: await ctx.db.query("providerCalls").take(3),
        preparation: await ctx.db.get(preparationId),
    }));
    expect(state.tasks).toHaveLength(1);
    expect(state.tasks[0]).toMatchObject({
        taskType: "source_qualification",
        output: {
            kind: "source_qualification",
            qualification,
            sourceCaptureId,
        },
    });
    expect(state.calls[0]).toMatchObject({
        status: "succeeded",
        service: "model",
        reportedCost: 0.0001,
    });
    expect(state.preparation?.modelAttemptCount).toBe(1);
});

test("reads credentials from the current Node invocation after environment replacement", async () => {
    const { t, preparationId, sourceCaptureId } = await capturedCandidate();
    vi.stubEnv("OPENROUTER_API_KEY", "");
    expect(
        await t.action(internal.sourcePreparationActions.qualifySource, {
            preparationId,
            sourceCaptureId,
        }),
    ).toMatchObject({
        status: "unavailable",
        reasonCode: "missing_configuration",
    });
    vi.stubGlobal("process", {
        ...process,
        env: { ...process.env, OPENROUTER_API_KEY: "invocation-key" },
    });
    const request = vi.fn<typeof fetch>(async () => success());
    vi.stubGlobal("fetch", request);
    expect(
        await t.action(internal.sourcePreparationActions.qualifySource, {
            preparationId,
            sourceCaptureId,
        }),
    ).toMatchObject({ status: "qualified" });
    expect(
        await t.run((ctx) => ctx.db.query("aiTaskResults").take(2)),
    ).toHaveLength(1);
});

test("uses at most one technical fallback and records both attempts", async () => {
    const { t, preparationId, sourceCaptureId } = await capturedCandidate();
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    const request = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
            new Response('{"error":{"message":"Unavailable"}}', {
                status: 503,
            }),
        )
        .mockImplementation(async () => success());
    vi.stubGlobal("fetch", request);
    expect(
        await t.action(internal.sourcePreparationActions.qualifySource, {
            preparationId,
            sourceCaptureId,
        }),
    ).toMatchObject({ status: "qualified" });
    expect(request).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(request.mock.calls[1]?.[1]?.body)).model).toBe(
        "deepseek/deepseek-v4.1-flash-1017",
    );
    expect(
        await t.run((ctx) => ctx.db.query("providerCalls").take(3)),
    ).toHaveLength(2);
});

test.each([
    "missing_configuration",
    "paid_work_disabled",
    "cancelled",
])("%s makes zero provider requests", async (failure) => {
    const { t, preparationId, sourceCaptureId, runId } =
        await capturedCandidate();
    vi.stubEnv(
        "OPENROUTER_API_KEY",
        failure === "missing_configuration" ? "" : "test-key",
    );
    if (failure === "paid_work_disabled")
        await t.run((ctx) =>
            ctx.db.insert("paidWorkControls", {
                key: "global",
                enabled: false,
                updatedAt: Date.now(),
            }),
        );
    if (failure === "cancelled")
        await t.run((ctx) =>
            ctx.db.patch(runId, {
                executionGeneration: 4,
                executionStatus: "cancelled",
            }),
        );
    const request = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", request);
    expect(
        await t.action(internal.sourcePreparationActions.qualifySource, {
            preparationId,
            sourceCaptureId,
        }),
    ).toMatchObject({ status: "unavailable" });
    expect(request).not.toHaveBeenCalled();
    expect(await t.run((ctx) => ctx.db.query("providerCalls").take(2))).toEqual(
        [],
    );
});

test("late model output closes telemetry without publishing or falling back", async () => {
    const { t, preparationId, sourceCaptureId, runId } =
        await capturedCandidate();
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    const request = vi.fn<typeof fetch>(async () => {
        await t.run((ctx) => ctx.db.patch(runId, { executionGeneration: 4 }));
        return success();
    });
    vi.stubGlobal("fetch", request);
    expect(
        await t.action(internal.sourcePreparationActions.qualifySource, {
            preparationId,
            sourceCaptureId,
        }),
    ).toMatchObject({ status: "unavailable", reasonCode: "stale_execution" });
    expect(request).toHaveBeenCalledOnce();
    expect(
        await t.run((ctx) => ctx.db.query("aiTaskResults").take(1)),
    ).toHaveLength(0);
});

test("a fresh preparation cannot reset the dossier model-attempt allowance", async () => {
    const { t, preparationId, sourceCaptureId, runId } =
        await capturedCandidate();
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
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
    const request = vi.fn<typeof fetch>(async () => success());
    vi.stubGlobal("fetch", request);
    expect(
        await t.action(internal.sourcePreparationActions.qualifySource, {
            preparationId,
            sourceCaptureId,
        }),
    ).toMatchObject({
        status: "unavailable",
        reasonCode: "work_budget_exhausted",
    });
    expect(request).not.toHaveBeenCalled();
});

test("qualification of a reused capture remains idempotent in a later corpus revision", async () => {
    const { t, runId, sourceCaptureId } = await capturedCandidate();
    const corpusRevisionId = await t.run(async (ctx) => {
        const revisionId = await ctx.db.insert("corpusRevisions", {
            runId,
            revision: 2,
            status: "draft",
            createdAt: 2,
        });
        await ctx.db.patch(runId, {
            activeCorpusRevisionId: revisionId,
            executionGeneration: 4,
        });
        return revisionId;
    });
    const preparationId = await t.mutation(
        internal.sourcePreparation.claimForDiscovery,
        { runId, corpusRevisionId, expectedExecutionGeneration: 4 },
    );
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    const request = vi.fn<typeof fetch>(async () => success());
    vi.stubGlobal("fetch", request);
    const first = await t.action(
        internal.sourcePreparationActions.qualifySource,
        { preparationId, sourceCaptureId },
    );
    expect(first.status).toBe("qualified");
    expect(
        await t.action(internal.sourcePreparationActions.qualifySource, {
            preparationId,
            sourceCaptureId,
        }),
    ).toEqual(first);
    expect(request).toHaveBeenCalledOnce();
});

test("a new preparation does not repeat failed attempts for the same logical input", async () => {
    const { t, runId, corpusRevisionId, preparationId, sourceCaptureId } =
        await capturedCandidate();
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    const request = vi.fn<typeof fetch>(
        async () =>
            new Response('{"error":{"message":"Unavailable"}}', {
                status: 503,
            }),
    );
    vi.stubGlobal("fetch", request);
    await t.action(internal.sourcePreparationActions.qualifySource, {
        preparationId,
        sourceCaptureId,
    });
    expect(request).toHaveBeenCalledTimes(2);
    await t.run((ctx) => ctx.db.patch(runId, { executionGeneration: 4 }));
    const resumed = await t.mutation(
        internal.sourcePreparation.claimForDiscovery,
        { runId, corpusRevisionId, expectedExecutionGeneration: 4 },
    );
    expect(
        await t.action(internal.sourcePreparationActions.qualifySource, {
            preparationId: resumed,
            sourceCaptureId,
        }),
    ).toMatchObject({ status: "unavailable" });
    expect(request).toHaveBeenCalledTimes(2);
});

test("commits the model receipt and qualification in one mutation", async () => {
    const {
        t,
        runId,
        corpusRevisionId,
        sourceId,
        preparationId,
        sourceCaptureId,
        prepared,
    } = await capturedCandidate();
    const preparation = await t.run((ctx) => ctx.db.get(preparationId));
    if (!preparation) throw new Error("Missing preparation fixture");
    const call = await t.mutation(internal.providerCalls.recordAttempt, {
        runId,
        corpusRevisionId,
        sourceId,
        preparationId,
        inputHash: prepared.inputHash,
        executionGeneration: 3,
        workflowVersion: 1,
        stepKey: "source_preparation",
        service: "model",
        operation: "source_qualification",
        operationKey: `${preparation.operationKey}:step:source_preparation:input:${prepared.inputHash}:attempt:1`,
        status: "started",
        attempt: 1,
    });
    const args = {
        preparationId,
        sourceCaptureId,
        providerCallId: call.providerCallId,
        inputHash: prepared.inputHash,
        qualification,
        readingCompleteness: "complete" as const,
        omittedPassageCount: 0,
        selectedPassages: prepared.request.document.passages.map((passage) => ({
            passageKey: passage.passageKey,
            startOffset: passage.startOffset,
            endOffset: passage.endOffset,
        })),
    };
    const taskId = await t.mutation(
        internal.sourcePreparation.saveQualification,
        args,
    );
    expect(await t.run((ctx) => ctx.db.get(call.providerCallId))).toMatchObject(
        { status: "succeeded" },
    );
    expect(
        await t.mutation(internal.sourcePreparation.saveQualification, args),
    ).toBe(taskId);
});

test("an attempt timeout keeps an unknown outcome without triggering fallback", async () => {
    vi.useFakeTimers();
    vi.spyOn(AbortSignal, "timeout").mockImplementation((milliseconds) => {
        const controller = new AbortController();
        setTimeout(
            () =>
                controller.abort(new DOMException("Timed out", "TimeoutError")),
            milliseconds,
        );
        return controller.signal;
    });
    const { t, preparationId, sourceCaptureId } = await capturedCandidate();
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    const request = vi
        .fn<typeof fetch>()
        .mockImplementationOnce(
            async (_url, init) =>
                new Promise<Response>((_resolve, reject) => {
                    if (!init?.signal)
                        throw new Error("Expected a bounded request signal");
                    init.signal.addEventListener(
                        "abort",
                        () => reject(init.signal?.reason),
                        { once: true },
                    );
                }),
        )
        .mockImplementation(async () => success());
    vi.stubGlobal("fetch", request);
    const pending = t.action(internal.sourcePreparationActions.qualifySource, {
        preparationId,
        sourceCaptureId,
    });
    const outcome = pending.then(
        (result) => ({ result }),
        (error) => ({ error }),
    );
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(60_001);
    expect(await outcome).toMatchObject({
        result: { status: "unavailable", reasonCode: "request_timeout" },
    });
    expect(request).toHaveBeenCalledOnce();
});

test.each([
    "legacy",
    "full_document_first_v1",
] as const)("an unknown %s model outcome is not repeated by a later execution generation", async (policy) => {
    if (policy === "full_document_first_v1")
        vi.stubEnv("SOURCE_RETRIEVAL_MODE", "lexical");
    const {
        t,
        runId,
        corpusRevisionId,
        sourceId,
        preparationId,
        sourceCaptureId,
        prepared,
    } = await capturedCandidate();
    const preparation = await t.run((ctx) => ctx.db.get(preparationId));
    if (!preparation) throw new Error("Missing preparation fixture");
    const call = await t.mutation(internal.providerCalls.recordAttempt, {
        runId,
        corpusRevisionId,
        sourceId,
        preparationId,
        inputHash: prepared.inputHash,
        executionGeneration: 3,
        workflowVersion: 1,
        stepKey: "source_preparation",
        service: "model",
        operation: "source_qualification",
        operationKey: `${preparation.operationKey}:step:source_preparation:input:${prepared.inputHash}:attempt:1`,
        status: "started",
        attempt: 1,
    });
    await t.run(async (ctx) => {
        await ctx.db.patch(call.providerCallId, {
            leaseExpiresAt: Date.now() - 1,
        });
        await ctx.db.patch(runId, { executionGeneration: 4 });
    });
    const resumed = await t.mutation(
        internal.sourcePreparation.claimForDiscovery,
        { runId, corpusRevisionId, expectedExecutionGeneration: 4 },
    );
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    const request = vi.fn<typeof fetch>(async () => success());
    vi.stubGlobal("fetch", request);
    expect(
        await t.action(internal.sourcePreparationActions.qualifySource, {
            preparationId: resumed,
            sourceCaptureId,
        }),
    ).toMatchObject({
        status: "unavailable",
        reasonCode: "attempt_outcome_unknown",
    });
    expect(request).not.toHaveBeenCalled();
});

test("legacy captures retain hybrid mode and explicit lexical degradation without embedding credentials", async () => {
    vi.stubEnv("SOURCE_RETRIEVAL_MODE", "hybrid");
    const fixture = await capturedCandidate();
    await fixture.t.run((ctx) =>
        ctx.db.patch(fixture.sourceCaptureId, {
            qualificationInputPolicy: undefined,
        }),
    );
    vi.stubEnv("SOURCE_RETRIEVAL_MODE", undefined);
    vi.stubEnv("OPENROUTER_API_KEY", "test-qualification-key");
    vi.stubGlobal(
        "fetch",
        vi.fn(async () => success()),
    );
    const result = await fixture.t.action(
        internal.sourcePreparationActions.qualifySource,
        {
            preparationId: fixture.preparationId,
            sourceCaptureId: fixture.sourceCaptureId,
        },
    );
    expect(result.status).toBe("qualified");
    if (result.status !== "qualified")
        throw new Error("Qualification did not complete");
    const data = await fixture.t.run(async (ctx) => ({
        task: result.taskId ? await ctx.db.get(result.taskId) : null,
        calls: await ctx.db.query("providerCalls").collect(),
        preparation: await ctx.db.get(fixture.preparationId),
    }));
    expect(data.preparation?.retrievalMode).toBe("hybrid");
    expect(
        data.task?.output.kind === "source_qualification"
            ? data.task.output.retrieval
            : null,
    ).toMatchObject({
        requestedMode: "hybrid",
        effectiveMode: "lexical",
        degradationReason: "missing_configuration",
    });
    expect(
        data.calls.filter((c) => c.operation === "source_embedding"),
    ).toHaveLength(0);
});

test("concurrent explicit recovery permits one further model attempt and reuses the capture", async () => {
    vi.useFakeTimers();
    const { api } = await import("@convex/_generated/api");
    const { default: workflowTest } = await import(
        "@/__tests__/convex/workflows/workflow-test-register.js"
    );
    const {
        t,
        runId,
        corpusRevisionId,
        preparationId,
        sourceCaptureId,
        sourceId,
        userId,
    } = await capturedCandidate();
    workflowTest.register(t);
    vi.stubEnv("SOURCE_QUALIFICATION_ENABLED", "true");
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    const request = vi.fn<typeof fetch>(
        async () =>
            new Response('{"error":{"message":"Unavailable"}}', {
                status: 503,
            }),
    );
    vi.stubGlobal("fetch", request);
    await t.action(internal.sourcePreparationActions.qualifySource, {
        preparationId,
        sourceCaptureId,
    });
    expect(request).toHaveBeenCalledTimes(2);
    await t.mutation(internal.sourcePreparation.recordResult, {
        preparationId,
        outcome: {
            sourceId,
            result: {
                status: "unavailable",
                sourceCaptureId,
                reasonCode: "transport_unavailable",
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
    vi.setSystemTime(Date.now() + 15_001);
    const owned = t.withIdentity({ subject: userId });
    const args = {
        runId,
        corpusRevisionId,
        expectedProposalId: completed.proposalId,
        requestId: "explicit-model-recovery",
    };
    const resumed = await owned.mutation(
        api.sourcePreparation.startForReview,
        args,
    );
    request.mockImplementation(async () => success());
    const results = await Promise.all(
        [1, 2].map(() =>
            t.action(internal.sourcePreparationActions.qualifySource, {
                preparationId: resumed.preparationId,
                sourceCaptureId,
            }),
        ),
    );
    expect(results.some((result) => result.status === "qualified")).toBe(true);
    expect(
        await t.run((ctx) =>
            ctx.db
                .query("aiTaskResults")
                .withIndex("by_run", (q) => q.eq("runId", runId))
                .take(3),
        ),
    ).toHaveLength(1);
    expect(
        await owned.mutation(api.sourcePreparation.startForReview, args),
    ).toEqual(resumed);
    expect(request).toHaveBeenCalledTimes(3);
    expect(
        await t.run((ctx) => ctx.db.query("sourceCaptures").take(10)),
    ).toHaveLength(1);
    expect(await t.run((ctx) => ctx.db.get(runId))).toMatchObject({
        sourceQualificationAttemptCount: 3,
    });
});

test.each([
    "work",
    "incidents",
] as const)("the review and mutation block an exhausted %s allowance", async (kind) => {
    const { api } = await import("@convex/_generated/api");
    const {
        t,
        runId,
        corpusRevisionId,
        preparationId,
        sourceCaptureId,
        sourceId,
        userId,
    } = await capturedCandidate();
    vi.stubEnv("SOURCE_QUALIFICATION_ENABLED", "true");
    await t.mutation(internal.sourcePreparation.recordResult, {
        preparationId,
        outcome: {
            sourceId,
            result: {
                status: "unavailable",
                sourceCaptureId,
                reasonCode: "missing_configuration",
            },
        },
    });
    await t.mutation(internal.sourcePreparation.finish, {
        preparationId,
        expectedExecutionGeneration: 3,
    });
    await t.run((ctx) =>
        ctx.db.patch(runId, {
            lifecycleState: "awaiting_source_review",
            executionStatus: "paused",
            pauseReason: "source_review",
            sourceQualificationAttemptCount: kind === "work" ? 120 : 40,
            sourcePreparationBudget: {
                version: 1,
                work: kind === "work" ? 120 : 0,
                incidents: kind === "incidents" ? 40 : 0,
                reserved: 0,
                dispatches: kind === "work" ? 120 : 40,
            },
        }),
    );
    const before = await t.run((ctx) => ctx.db.get(runId));
    const current = await t
        .withIdentity({ subject: userId })
        .query(api.sourceSelectionProposals.getCurrent, {
            runId,
            corpusRevisionId,
        });
    expect(current?.preparationAction).toMatchObject({
        available: false,
        reason:
            kind === "work"
                ? "work_budget_exhausted"
                : "incident_budget_exhausted",
    });
    if (!current) throw new Error("Missing proposal");
    expect(
        await t
            .withIdentity({ subject: userId })
            .mutation(api.sourcePreparation.startForReview, {
                runId,
                corpusRevisionId,
                expectedProposalId: current.proposalId,
                requestId: "exhausted-budget",
            }),
    ).toMatchObject({
        status: "blocked",
        reason:
            kind === "work"
                ? "work_budget_exhausted"
                : "incident_budget_exhausted",
    });
    expect(await t.run((ctx) => ctx.db.get(runId))).toEqual(before);
});

test.each([
    "transport",
    "invalid_output",
    "legacy_unknown",
] as const)("%s recovery preserves accounting across repeated explicit executions", async (mode) => {
    vi.useFakeTimers();
    const { api } = await import("@convex/_generated/api");
    const { default: workflowTest } = await import(
        "@/__tests__/convex/workflows/workflow-test-register.js"
    );
    const {
        t,
        runId,
        corpusRevisionId,
        preparationId,
        sourceCaptureId,
        sourceId,
        userId,
    } = await capturedCandidate();
    workflowTest.register(t);
    vi.stubEnv("SOURCE_QUALIFICATION_ENABLED", "true");
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    const request = vi.fn<typeof fetch>(async () =>
        mode === "invalid_output"
            ? new Response(
                  JSON.stringify({
                      id: "invalid",
                      created: 1,
                      model: "test",
                      choices: [
                          {
                              index: 0,
                              message: { role: "assistant", content: "{}" },
                              finish_reason: "stop",
                          },
                      ],
                  }),
                  { headers: { "Content-Type": "application/json" } },
              )
            : new Response('{"error":{"message":"Unavailable"}}', {
                  status: 503,
              }),
    );
    vi.stubGlobal("fetch", request);
    await t.action(internal.sourcePreparationActions.qualifySource, {
        preparationId,
        sourceCaptureId,
    });
    expect(request).toHaveBeenCalledTimes(2);
    if (mode === "legacy_unknown")
        await t.run(async (ctx) => {
            for (const call of await ctx.db
                .query("providerCalls")
                .withIndex("by_run", (q) => q.eq("runId", runId))
                .take(4))
                await ctx.db.patch(call._id, {
                    dispatchOutcome: undefined,
                    httpStatus: undefined,
                    errorCode: "transport_unavailable",
                    retryable: true,
                });
        });
    await t.mutation(internal.sourcePreparation.recordResult, {
        preparationId,
        outcome: {
            sourceId,
            result: {
                status: "unavailable",
                sourceCaptureId,
                reasonCode: "qualification_unavailable",
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
    vi.setSystemTime(Date.now() + 15_001);
    const owned = t.withIdentity({ subject: userId });
    const args = {
        runId,
        corpusRevisionId,
        expectedProposalId: finished.proposalId,
        requestId: "bounded-recovery",
    };
    const resumed = await owned.mutation(
        api.sourcePreparation.startForReview,
        args,
    );
    if (mode === "legacy_unknown") {
        expect(resumed.status).toBe("blocked");
        expect(
            (
                await owned.query(api.sourceSelectionProposals.getCurrent, {
                    runId,
                    corpusRevisionId,
                })
            )?.preparationAction,
        ).toMatchObject({ available: false, reason: "outcome_unknown" });
        expect(request).toHaveBeenCalledTimes(2);
        return;
    }
    expect(resumed.status).toBe("started");
    expect(
        await t.action(internal.sourcePreparationActions.qualifySource, {
            preparationId: resumed.preparationId,
            sourceCaptureId,
        }),
    ).toMatchObject({ status: "unavailable" });
    await t.mutation(internal.sourcePreparation.recordResult, {
        preparationId: resumed.preparationId,
        outcome: {
            sourceId,
            result: {
                status: "unavailable",
                sourceCaptureId,
                reasonCode: "qualification_unavailable",
            },
        },
    });
    const latest = await t.mutation(internal.sourcePreparation.finish, {
        preparationId: resumed.preparationId,
        expectedExecutionGeneration: 4,
    });
    vi.setSystemTime(Date.now() + 15_001);
    const again = await owned.mutation(api.sourcePreparation.startForReview, {
        ...args,
        expectedProposalId: latest.proposalId,
        requestId: "another-explicit-recovery",
    });
    expect(again.status).toBe("started");
    await t.action(internal.sourcePreparationActions.qualifySource, {
        preparationId: again.preparationId,
        sourceCaptureId,
    });
    expect(request).toHaveBeenCalledTimes(4);
    expect(await t.run((ctx) => ctx.db.get(runId))).toMatchObject({
        sourceQualificationAttemptCount: 4,
        sourcePreparationBudget: {
            work: 0,
            incidents: 4,
            reserved: 0,
            dispatches: 4,
        },
    });
});

test("a provider Retry-After blocks fallback and explicit recovery until its recorded time", async () => {
    vi.useFakeTimers();
    const { api } = await import("@convex/_generated/api");
    const { default: workflowTest } = await import(
        "@/__tests__/convex/workflows/workflow-test-register.js"
    );
    const {
        t,
        runId,
        corpusRevisionId,
        preparationId,
        sourceCaptureId,
        sourceId,
        userId,
    } = await capturedCandidate();
    workflowTest.register(t);
    vi.stubEnv("SOURCE_QUALIFICATION_ENABLED", "true");
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    const startedAt = Date.now();
    const request = vi.fn<typeof fetch>(
        async () =>
            new Response('{"error":{"message":"Limited"}}', {
                status: 429,
                headers: { "retry-after": "120" },
            }),
    );
    vi.stubGlobal("fetch", request);
    await t.action(internal.sourcePreparationActions.qualifySource, {
        preparationId,
        sourceCaptureId,
    });
    expect(request).toHaveBeenCalledOnce();
    await t.mutation(internal.sourcePreparation.recordResult, {
        preparationId,
        outcome: {
            sourceId,
            result: {
                status: "unavailable",
                sourceCaptureId,
                reasonCode: "transport_unavailable",
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
    ).toMatchObject({
        available: false,
        reason: "cooldown",
        retryAt: startedAt + 120_000,
    });
    const args = {
        runId,
        corpusRevisionId,
        expectedProposalId: finished.proposalId,
        requestId: "after-rate-limit",
    };
    expect(
        await owned.mutation(api.sourcePreparation.startForReview, args),
    ).toMatchObject({ status: "blocked" });
    vi.setSystemTime(startedAt + 120_001);
    const resumed = await owned.mutation(
        api.sourcePreparation.startForReview,
        args,
    );
    request.mockImplementation(async () => success());
    expect(
        await t.action(internal.sourcePreparationActions.qualifySource, {
            preparationId: resumed.preparationId,
            sourceCaptureId,
        }),
    ).toMatchObject({ status: "qualified" });
    expect(request).toHaveBeenCalledTimes(2);
});

test("a corrupt retained capture stays blocked without replacement retrieval", async () => {
    const { api } = await import("@convex/_generated/api");
    const {
        t,
        runId,
        corpusRevisionId,
        preparationId,
        sourceCaptureId,
        sourceId,
        userId,
    } = await capturedCandidate();
    vi.stubEnv("SOURCE_QUALIFICATION_ENABLED", "true");
    await t.run(async (ctx) => {
        const storageId = await ctx.storage.store(
            new Blob(["Changed retained bytes"]),
        );
        await ctx.db.patch(sourceCaptureId, { storageId });
    });
    const request = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", request);
    const outcome = await t.action(
        internal.sourcePreparationActions.qualifySource,
        { preparationId, sourceCaptureId },
    );
    expect(outcome).toMatchObject({
        status: "unavailable",
        reasonCode: "capture_corrupt",
    });
    await t.mutation(internal.sourcePreparation.recordResult, {
        preparationId,
        outcome: {
            sourceId,
            result: {
                status: "unavailable",
                sourceCaptureId,
                reasonCode: "capture_corrupt",
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
    ).toMatchObject({ available: false, reason: "no_eligible_work" });
    expect(
        await owned.mutation(api.sourcePreparation.startForReview, {
            runId,
            corpusRevisionId,
            expectedProposalId: finished.proposalId,
            requestId: "corrupt-capture-must-not-refetch",
        }),
    ).toMatchObject({ status: "blocked" });
    expect(request).not.toHaveBeenCalled();
    expect(
        await t.run((ctx) => ctx.db.query("sourceCaptures").take(3)),
    ).toHaveLength(1);
});

test("a historical pre-dispatch block preserves its receipt without consuming the first real attempt", async () => {
    const { api } = await import("@convex/_generated/api");
    const { default: workflowTest } = await import(
        "@/__tests__/convex/workflows/workflow-test-register.js"
    );
    const {
        t,
        runId,
        corpusRevisionId,
        preparationId,
        sourceCaptureId,
        sourceId,
        userId,
    } = await capturedCandidate();
    workflowTest.register(t);
    vi.stubEnv("SOURCE_QUALIFICATION_ENABLED", "true");
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    const input = await t.query(
        internal.sourcePreparation.getQualificationInput,
        { preparationId, sourceCaptureId, now: Date.now() },
    );
    const prepared = prepareQualificationInput({
        company: input.company,
        canonicalUrl: input.source.canonicalUrl,
        title: input.source.title,
        asOfTime: input.asOfTime,
        text: "ServiceNow provides workflow software.",
    });
    const legacyId = await t.run((ctx) =>
        ctx.db.insert("providerCalls", {
            runId,
            corpusRevisionId,
            sourceId,
            preparationId,
            service: "model",
            operation: "source_qualification",
            operationKey: "historical-paid-work-block",
            inputHash: prepared.inputHash,
            attempt: 1,
            status: "failed",
            errorCode: "paid_work_disabled",
            createdAt: 1,
            completedAt: 1,
        }),
    );
    await t.mutation(internal.sourcePreparation.recordResult, {
        preparationId,
        outcome: {
            sourceId,
            result: {
                status: "unavailable",
                sourceCaptureId,
                reasonCode: "paid_work_disabled",
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
    const resumed = await t
        .withIdentity({ subject: userId })
        .mutation(api.sourcePreparation.startForReview, {
            runId,
            corpusRevisionId,
            expectedProposalId: finished.proposalId,
            requestId: "configuration-restored",
        });
    const request = vi.fn<typeof fetch>(async () => success());
    vi.stubGlobal("fetch", request);
    expect(
        await t.action(internal.sourcePreparationActions.qualifySource, {
            preparationId: resumed.preparationId,
            sourceCaptureId,
        }),
    ).toMatchObject({ status: "qualified" });
    expect(request).toHaveBeenCalledOnce();
    expect(await t.run((ctx) => ctx.db.get(legacyId))).toMatchObject({
        status: "failed",
        errorCode: "paid_work_disabled",
    });
    expect(await t.run((ctx) => ctx.db.get(runId))).toMatchObject({
        sourceQualificationAttemptCount: 1,
    });
});

test.each([
    "complete",
    "partial",
] as const)("a full-document qualification retains all %s capture passages without building a retrieval index", async (completeness) => {
    vi.stubEnv("SOURCE_RETRIEVAL_MODE", "lexical");
    const fixture = await capturedCandidate();
    if (completeness === "partial")
        await fixture.t.run((ctx) =>
            ctx.db.patch(fixture.sourceCaptureId, {
                readingCompleteness: "partial",
                omittedPassageCount: 1,
            }),
        );
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    const requests: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
        "fetch",
        vi.fn(async (_url, init) => {
            const body = JSON.parse(String(init?.body));
            requests.push(JSON.parse(body.messages.at(-1).content));
            return success();
        }),
    );
    const result = await fixture.t.action(
        internal.sourcePreparationActions.qualifySource,
        {
            preparationId: fixture.preparationId,
            sourceCaptureId: fixture.sourceCaptureId,
        },
    );
    expect(result.status).toBe("qualified");
    if (result.status !== "qualified") throw Error("Missing qualification");
    const state = await fixture.t.run(async (ctx) => ({
        indexes: await ctx.db.query("sourceSearchCaptures").take(2),
        passages: await ctx.db.query("sourceSearchPassages").take(2),
        task: result.taskId ? await ctx.db.get(result.taskId) : null,
        calls: await ctx.db.query("providerCalls").take(3),
    }));
    expect(state.indexes).toEqual([]);
    expect(state.passages).toEqual([]);
    expect(state.task?.output).toMatchObject({
        kind: "source_qualification",
        selectionStrategy: "full_document",
        readingCompleteness: completeness,
        omittedPassageCount: completeness === "partial" ? 1 : 0,
        selectedPassages: [{ passageKey: "p0", startOffset: 0, endOffset: 38 }],
    });
    expect(requests[0]?.document).toMatchObject({
        selectionStrategy: "full_document",
        passages: [
            {
                passageKey: "p0",
                text: "ServiceNow provides workflow software.",
            },
        ],
    });
    expect(state.calls).toHaveLength(1);
    expect(
        await fixture.t.action(
            internal.sourcePreparationActions.qualifySource,
            {
                preparationId: fixture.preparationId,
                sourceCaptureId: fixture.sourceCaptureId,
            },
        ),
    ).toEqual(result);
});

test("an oversized document keeps bounded retrieved passages under the new capture policy", async () => {
    vi.stubEnv("SOURCE_RETRIEVAL_MODE", "lexical");
    const text = Array.from(
        { length: 80 },
        (_, i) =>
            `ServiceNow workflow platform disclosure ${i}. ${"Operational integration capabilities. ".repeat(50)}`,
    ).join("\n\n");
    const fixture = await capturedCandidate(text);
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    vi.stubGlobal(
        "fetch",
        vi.fn(async () => success()),
    );
    const result = await fixture.t.action(
        internal.sourcePreparationActions.qualifySource,
        {
            preparationId: fixture.preparationId,
            sourceCaptureId: fixture.sourceCaptureId,
        },
    );
    expect(result.status).toBe("qualified");
    if (result.status !== "qualified") throw Error("Missing qualification");
    const task = await fixture.t.run((ctx) => ctx.db.get(result.taskId));
    expect(task?.output).toMatchObject({
        kind: "source_qualification",
        selectionStrategy: "retrieved_passages",
        readingCompleteness: "partial",
        retrieval: { effectiveMode: "lexical" },
    });
    if (task?.output.kind !== "source_qualification")
        throw Error("Missing qualification");
    expect(task.output.omittedPassageCount).toBeGreaterThan(0);
    expect(task.output.selectedPassages.length).toBeGreaterThan(0);
});

test("the persistence boundary rejects an unscoped new restriction before saving a qualification", async () => {
    const {
        t,
        runId,
        corpusRevisionId,
        sourceId,
        preparationId,
        sourceCaptureId,
        prepared,
    } = await capturedCandidate();
    const preparation = await t.run((ctx) => ctx.db.get(preparationId));
    if (!preparation) throw new Error("Missing preparation");
    const inputHash = prepared.inputHash;
    const call = await t.mutation(internal.providerCalls.recordAttempt, {
        runId,
        corpusRevisionId,
        sourceId,
        preparationId,
        executionGeneration: 3,
        workflowVersion: 1,
        stepKey: "source_preparation",
        service: "model",
        operation: "source_qualification",
        operationKey: `${preparation.operationKey}:step:source_preparation:input:${inputHash}:attempt:1`,
        inputHash,
        attempt: 1,
        status: "started",
    });
    await expect(
        t.mutation(internal.sourcePreparation.saveQualification, {
            preparationId,
            sourceCaptureId,
            providerCallId: call.providerCallId,
            inputHash,
            qualification: {
                ...qualification,
                limitations: [
                    {
                        code: "no_substantive_content",
                        explanation: "Scope omitted.",
                        passages: [],
                    },
                ],
            },
            readingCompleteness: "complete",
            omittedPassageCount: 0,
            selectedPassages: prepared.request.document.passages.map(
                ({ passageKey, startOffset, endOffset }) => ({
                    passageKey,
                    startOffset,
                    endOffset,
                }),
            ),
        }),
    ).rejects.toThrow("restriction_scope_missing");
    expect(await t.run((ctx) => ctx.db.query("aiTaskResults").take(1))).toEqual(
        [],
    );
});
