import { internal } from "@convex/_generated/api";
import type { ActionCtx } from "@convex/_generated/server";
import {
    prepareQualificationInput,
    type SourceQualification,
} from "@convex/domain/sourceQualification";
import { SOURCE_COVERAGE_ROLES } from "@convex/domain/sourceSelectionPolicy";
import { qualifySource } from "@convex/sourcePreparationActions";
import {
    type FunctionArgs,
    type FunctionReturnType,
    getFunctionName,
} from "convex/server";
import { afterEach, expect, test, vi } from "vitest";
import { installModel } from "@/__tests__/setup/model-configuration";
import { providerFixtureResponse } from "@/__tests__/setup/model-stream";
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
    providerFixtureResponse({
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
                            SOURCE_COVERAGE_ROLES.map((role) => [role, null]),
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
    });

async function capturedCandidate(
    text = "ServiceNow provides workflow software.",
) {
    const fixture = await seedSourcePreparation({ models: true });
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
    expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body))).toMatchObject({
        max_tokens: 8192,
    });
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
    const payloads = await t.run((ctx) =>
        ctx.db.query("agentInvocationPayloads").collect(),
    );
    expect(
        payloads.map((payload) => [payload.part, payload.state]).sort(),
    ).toEqual([
        ["reply", "complete"],
        ["request", "complete"],
    ]);
    expect(
        payloads.find((payload) => payload.part === "reply")?.json,
    ).toContain("companyPassageKeys");
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

test("qualification uses the administratively assigned Sources model", async () => {
    const { t, preparationId, sourceCaptureId } = await capturedCandidate();
    await installModel(
        t,
        { model: "example/documentary-model", provider: "test-provider" },
        "sources",
    );
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    const request = vi.fn<typeof fetch>(async () => success());
    vi.stubGlobal("fetch", request);
    expect(
        await t.action(internal.sourcePreparationActions.qualifySource, {
            preparationId,
            sourceCaptureId,
        }),
    ).toMatchObject({ status: "qualified" });
    expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body)).model).toBe(
        "example/documentary-model",
    );
});

test("retries at most once with the same assigned model and records both attempts", async () => {
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
        "z-ai/glm-5.3-flash",
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
    await t.mutation(internal.modelConfiguration.forPreparation, {
        preparationId,
        expectedGeneration: 3,
    });
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

test("generation survives the former timeout and retains an unknown outcome at its authorized deadline", async () => {
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
    let completed = false;
    void outcome.then(() => {
        completed = true;
    });
    await vi.advanceTimersByTimeAsync(60_001);
    expect(completed).toBe(false);
    expect(request).toHaveBeenCalledOnce();
    const preparation = await t.run((ctx) => ctx.db.get(preparationId));
    if (preparation?.deadlineAt === undefined)
        throw new Error("Missing preparation deadline");
    await vi.advanceTimersByTimeAsync(preparation.deadlineAt - Date.now() + 1);
    expect(await outcome).toMatchObject({
        result: { status: "unavailable", reasonCode: "request_timeout" },
    });
    const receipts = await t.run((ctx) =>
        ctx.db.query("providerCalls").take(2),
    );
    expect(receipts).toMatchObject([
        {
            status: "failed",
            errorCode: "request_timeout",
            dispatchOutcome: "unknown",
        },
    ]);
    expect(receipts).toHaveLength(1);
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
    await t.mutation(internal.modelConfiguration.forPreparation, {
        preparationId,
        expectedGeneration: 3,
    });
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
    expect(
        result.status,
        JSON.stringify({
            result,
            captures: await fixture.t.run(async (ctx) =>
                (await ctx.db.query("agentInvocationPayloads").collect()).map(
                    ({ part, sizeBytes, state, code }) => ({
                        part,
                        sizeBytes,
                        state,
                        code,
                    }),
                ),
            ),
        }),
    ).toBe("qualified");
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

test.each([
    "restriction_scope_missing",
    "contribution_basis_missing",
])("the persistence boundary rejects %s before saving a qualification", async (reason) => {
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
    if (reason === "contribution_basis_missing")
        await t.run((ctx) =>
            ctx.db.patch(preparationId, {
                qualificationVersion: "source-qualification-v5",
            }),
        );
    const inputHash = prepared.inputHash;
    await t.mutation(internal.modelConfiguration.forPreparation, {
        preparationId,
        expectedGeneration: 3,
    });
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
            qualification:
                reason === "restriction_scope_missing"
                    ? {
                          ...qualification,
                          limitations: [
                              {
                                  code: "no_substantive_content",
                                  explanation: "Scope omitted.",
                                  passages: [],
                              },
                          ],
                      }
                    : {
                          ...qualification,
                          findings: [
                              {
                                  role: "official_product_platform",
                                  kind: "asserted_fact",
                                  summary:
                                      "ServiceNow provides workflow software.",
                                  passages: [
                                      {
                                          passageKey: "p0",
                                          quotation:
                                              "ServiceNow provides workflow software.",
                                      },
                                  ],
                                  period: "unspecified",
                                  periodPassages: [],
                                  dependsOnFlaggedAssertion: false,
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
    ).rejects.toThrow(reason);
    expect(await t.run((ctx) => ctx.db.query("aiTaskResults").take(1))).toEqual(
        [],
    );
});

const qualificationHandler = qualifySource as typeof qualifySource & {
    _handler(
        ctx: ActionCtx,
        args: FunctionArgs<
            typeof internal.sourcePreparationActions.qualifySource
        >,
    ): Promise<
        FunctionReturnType<
            typeof internal.sourcePreparationActions.qualifySource
        >
    >;
};

test("a request journal persistence failure prevents external qualification dispatch", async () => {
    const { t, preparationId, sourceCaptureId } = await capturedCandidate();
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    const request = vi.fn<typeof fetch>(async () => success());
    vi.stubGlobal("fetch", request);
    const result = await t.action(async (ctx) => {
        const runMutation: typeof ctx.runMutation = async (ref, ...args) => {
            if (
                getFunctionName(ref) ===
                "execution/invocationLifecycle:retainRequest"
            )
                throw new Error("Journal unavailable");
            return ctx.runMutation(ref, ...args);
        };
        return qualificationHandler._handler(
            { ...ctx, runMutation },
            { preparationId, sourceCaptureId },
        );
    });
    expect(result).toMatchObject({
        status: "unavailable",
        reasonCode: "journal_request_unavailable",
    });
    expect(request).not.toHaveBeenCalled();
    const calls = await t.run((ctx) => ctx.db.query("providerCalls").collect());
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
        status: "failed",
        dispatchOutcome: "not_dispatched",
    });
});

test("a lost one-shot terminal acknowledgement keeps the journal and receipt without redispatch", async () => {
    const { t, preparationId, sourceCaptureId, runId } =
        await capturedCandidate();
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    const request = vi.fn<typeof fetch>(async () => success());
    vi.stubGlobal("fetch", request);
    await expect(
        t.action(async (ctx) => {
            const runMutation: typeof ctx.runMutation = async (
                ref,
                ...args
            ) => {
                const result = await ctx.runMutation(ref, ...args);
                if (
                    getFunctionName(ref) ===
                    "execution/invocationLifecycle:finishOneShot"
                )
                    throw new Error("Lost terminal acknowledgement");
                return result;
            };
            return qualificationHandler._handler(
                { ...ctx, runMutation },
                { preparationId, sourceCaptureId },
            );
        }),
    ).rejects.toThrow("Lost terminal acknowledgement");
    expect(
        await t.action(internal.sourcePreparationActions.qualifySource, {
            preparationId,
            sourceCaptureId,
        }),
    ).toMatchObject({
        status: "unavailable",
        reasonCode: "result_already_recorded",
    });
    expect(request).toHaveBeenCalledOnce();
    const state = await t.run(async (ctx) => ({
        invocation: await ctx.db.query("agentInvocations").unique(),
        payloads: await ctx.db.query("agentInvocationPayloads").collect(),
        calls: await ctx.db.query("providerCalls").collect(),
        run: await ctx.db.get(runId),
    }));
    expect(state.invocation).toMatchObject({ status: "returned" });
    expect(state.payloads.map((payload) => payload.state)).toEqual([
        "complete",
        "complete",
    ]);
    expect(state.calls).toHaveLength(1);
    expect(state.calls[0]).toMatchObject({ status: "succeeded" });
    expect(state.run?.sourcePreparationBudget).toMatchObject({
        work: 1,
        reserved: 0,
        dispatches: 1,
    });
});

test("a lost billing-scheduling acknowledgement cannot erase a known failed model result", async () => {
    const { t, preparationId, sourceCaptureId } = await capturedCandidate();
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    const request = vi.fn<typeof fetch>(async () =>
        providerFixtureResponse(
            {
                id: "gen-known-incomplete-qualification",
                model: "test-model",
                choices: [
                    {
                        index: 0,
                        message: {
                            role: "assistant",
                            content: '{"coherence": ',
                        },
                        finish_reason: "length",
                    },
                ],
                usage: {
                    prompt_tokens: 100,
                    completion_tokens: 50,
                    total_tokens: 150,
                },
            },
            {
                headers: {
                    "x-generation-id": "gen-known-incomplete-qualification",
                },
            },
        ),
    );
    vi.stubGlobal("fetch", request);
    let lostAcknowledgement = false;
    await expect(
        t.action(async (ctx) => {
            const runMutation: typeof ctx.runMutation = async (
                ref,
                ...args
            ) => {
                const result = await ctx.runMutation(ref, ...args);
                const calls = await t.run((context) =>
                    context.db.query("providerCalls").collect(),
                );
                const call = calls.find(
                    (item) =>
                        item.providerObservation?.generationId ===
                        "gen-known-incomplete-qualification",
                );
                // Lose the external RPC acknowledgement after its real billing effect commits.
                if (
                    !lostAcknowledgement &&
                    call?.billing?.state === "pending"
                ) {
                    lostAcknowledgement = true;
                    throw new Error("Lost billing scheduling acknowledgement");
                }
                return result;
            };
            return qualificationHandler._handler(
                { ...ctx, runMutation },
                { preparationId, sourceCaptureId },
            );
        }),
    ).rejects.toThrow("Lost billing scheduling acknowledgement");
    const state = await t.run(async (ctx) => ({
        invocation: await ctx.db.query("agentInvocations").unique(),
        call: (await ctx.db.query("providerCalls").collect()).find(
            (item) =>
                item.providerObservation?.generationId ===
                "gen-known-incomplete-qualification",
        ),
        tasks: await ctx.db.query("aiTaskResults").collect(),
    }));
    expect(lostAcknowledgement).toBe(true);
    expect(state.invocation).toMatchObject({ status: "returned" });
    expect(JSON.parse(state.invocation?.outputJson ?? "null")).toMatchObject({
        status: "failed",
        errorCode: "invalid_output",
    });
    expect(state.call).toMatchObject({
        status: "failed",
        errorCode: "invalid_output",
        dispatchOutcome: "response_received",
        billing: { state: "pending", attempt: 0 },
        providerObservation: {
            generationId: "gen-known-incomplete-qualification",
        },
    });
    expect(state.call?.reportedCost).toBeUndefined();
    expect(state.tasks).toEqual([]);
    expect(request).toHaveBeenCalledOnce();
});
