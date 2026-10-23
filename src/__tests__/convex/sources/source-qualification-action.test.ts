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

async function capturedCandidate() {
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
        asOfTime: Date.now(),
        text: "ServiceNow provides workflow software.",
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
        ctx.db.patch(runId, { sourceQualificationAttemptCount: 120 }),
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
        reasonCode: "model_attempt_limit_reached",
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

test("an attempt timeout permits one fallback while the preparation deadline is still active", async () => {
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
    expect(await outcome).toMatchObject({ result: { status: "qualified" } });
    expect(request).toHaveBeenCalledTimes(2);
});

test("an unknown model outcome is not repeated by a later execution generation", async () => {
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

test("new preparations snapshot hybrid mode and persist explicit lexical degradation without embedding credentials", async () => {
    vi.stubEnv("SOURCE_RETRIEVAL_MODE", "hybrid");
    const fixture = await capturedCandidate();
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
