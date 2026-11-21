import { createHash } from "node:crypto";
import { api, internal } from "@convex/_generated/api";
import type { ActionCtx } from "@convex/_generated/server";
import { buildMissionContext } from "@convex/execution/context";
import {
    retainedTextParts,
    stageOperationObservation,
} from "@convex/execution/retainedText";
import { importRetainedDocument } from "@convex/sourceCaptureActions";
import { type FunctionArgs, getFunctionName } from "convex/server";
import { afterEach, assert, expect, test, vi } from "vitest";
import { nativePiFixtureRoute } from "@/__tests__/setup/pi-native";
import { sourcesTestEnvelope } from "@/__tests__/setup/sources-mission";
import { seedWorkbench } from "@/__tests__/setup/workbench";

const registeredImport =
    importRetainedDocument as typeof importRetainedDocument & {
        _handler(
            ctx: ActionCtx,
            args: FunctionArgs<
                typeof internal.sourceCaptureActions.importRetainedDocument
            >,
        ): Promise<unknown>;
    };

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
});

async function seedHistoricalRead(transactionLimits = false, prefix = "") {
    const { t, client, runId } = await seedWorkbench(
        false,
        nativePiFixtureRoute,
        60000,
        "Check a retained publication.",
        undefined,
        10,
        "balanced",
        transactionLimits,
    );
    const active = await t.mutation(
        internal.execution.conversations.startTurn,
        {
            runId,
            definitionId: "workbench_v1",
            scope: { kind: "workbench_v1" },
            simulation: false,
        },
    );
    assert(active);
    const url = "https://example.com/historical-publication";
    const text =
        prefix +
        "  The insurer kept review rights. 🚗\n\nCaptured before Start.  ";
    const contentHash = createHash("sha256").update(text).digest("hex");
    const historical = await t.run(async (ctx) => {
        const run = await ctx.db.get(runId);
        const message = await ctx.db
            .query("agentMessageDeliveries")
            .withIndex("by_turn", (q) => q.eq("turnId", active.turnId))
            .first();
        assert(run?.currentFramingRevisionId && message);
        const requestId = await ctx.db.insert("agentOperationRequests", {
            runId,
            missionId: active.missionId,
            actor: "agent",
            cause: "retained-public-read",
            logicalKey: "retained-public-read",
            input: {
                kind: "read_public_context",
                messageId: message._id,
                target: { kind: "supplied", url },
            },
            pin: {
                kind: "framing_revision",
                revisionId: run.currentFramingRevisionId,
            },
            operationVersion: 1,
            expectedGeneration: 1,
            instructionVersion: 1,
            status: "completed",
            adoptedAt: 5,
            completedAt: 5,
            createdAt: 2,
        });
        const value = {
            readId: requestId,
            status: "observed",
            reference: {
                url,
                publisher: "example.com",
                excerpt: text,
                dates: {
                    publication: {
                        status: "conflict",
                        evidence: ["2024-04-01", "2024-04-03"].map((value) => ({
                            kind: "publication",
                            value,
                            precision: "day",
                            origin: {
                                kind: "metadata",
                                label: "publication",
                                raw: value,
                            },
                        })),
                    },
                    filing: { status: "unknown", evidence: [] },
                    event: { status: "unknown", evidence: [] },
                },
            },
            document: {
                readId: requestId,
                contentHash,
                characters: text.length,
                acquisitionCompleteness: "unknown",
            },
            range: { start: 0, end: text.length },
        };
        await ctx.db.patch(requestId, {
            outcome: { kind: "success", valueJson: JSON.stringify(value) },
        });
        const parts = retainedTextParts(text);
        for (const [index, content] of parts.parts.entries())
            await stageOperationObservation(ctx, requestId, {
                ...parts.manifest,
                index,
                content,
            });
        return ctx.db.get(requestId);
    });
    assert(historical);
    const fetch = vi.fn(() => {
        throw new Error("Document import must use retained bytes");
    });
    vi.stubGlobal("fetch", fetch);
    const context = await t.run((ctx) =>
        buildMissionContext(ctx, active.missionId, 1),
    );
    assert(context.kind === "ready");
    const materials = JSON.parse(context.inputJson).domain.availableMaterials;
    expect(materials).toEqual([
        expect.objectContaining({
            canonicalUrl: url,
            contentHash,
            readingReferences: [
                expect.objectContaining({ reference: expect.any(String) }),
            ],
        }),
    ]);
    const reference = materials[0].readingReferences[0].reference;
    return {
        t,
        client,
        runId,
        active,
        historical,
        reference,
        fetch,
        text,
        contentHash,
        url,
    };
}

test("imports adopted historical public text once without changing its bytes or provenance", async () => {
    const { t, active, historical, reference, fetch, text, contentHash, url } =
        await seedHistoricalRead();
    const requestId = await t.mutation(internal.execution.operations.enqueue, {
        missionId: active.missionId,
        expectedGeneration: 1,
        cause: "import-retained-publication",
        input: { kind: "read_in_context", reference },
    });
    expect(await t.run((ctx) => ctx.db.get(requestId))).toMatchObject({
        pin: {
            target: {
                kind: "retained_document",
                rootOperationId: historical._id,
                contentHash,
            },
        },
    });
    expect(
        await t.run((ctx) => ctx.db.query("sourceCaptures").first()),
    ).toBeNull();
    const result = await t.action(internal.execution.operations.dispatch, {
        requestId,
        expectedGeneration: 1,
    });
    assert(result.kind === "success", JSON.stringify(result));
    expect(JSON.parse(result.valueJson)).toMatchObject({
        canonicalUrl: url,
        contentHash,
        text,
        retrievedAt: null,
        range: { startOffset: 0, endOffset: text.length },
        representationCompleteness: "unknown",
        document: {
            dates: { publication: { status: "conflict" } },
            publishedAt: null,
        },
    });
    const capture = await t.run((ctx) =>
        ctx.db.query("sourceCaptures").unique(),
    );
    assert(capture?.storageId);
    const storageId = capture.storageId;
    expect(
        await t.run(
            async (ctx) => (await ctx.storage.get(storageId))?.text() ?? null,
        ),
    ).toBe(text);
    expect(await t.run((ctx) => ctx.db.get(historical._id))).toEqual(
        historical,
    );
    expect(fetch).not.toHaveBeenCalled();
});

test("protects an active historical attachment and resumes it after its first worker stops", async () => {
    const { t, active, reference, fetch, text } = await seedHistoricalRead();
    const scope = { missionId: active.missionId, expectedGeneration: 1 };
    const first = {
        expectedGeneration: 1,
        requestId: await t.mutation(internal.execution.operations.enqueue, {
            ...scope,
            cause: "import-then-interrupt",
            input: { kind: "read_in_context", reference },
        }),
    };
    const second = {
        expectedGeneration: 1,
        requestId: await t.mutation(internal.execution.operations.enqueue, {
            ...scope,
            cause: "competing-import",
            input: {
                kind: "search_available_material",
                reference,
                query: "review rights",
            },
        }),
    };
    expect(
        await t.mutation(internal.execution.operations.claim, first),
    ).toMatchObject({ kind: "execute" });
    const reserved = await t.mutation(
        internal.sourceCaptures.reserveRetainedImport,
        first,
    );
    assert(reserved.status === "claimed" && reserved.capture.retainedImport);
    expect(
        await t.mutation(internal.sourceCaptures.reserveRetainedImport, first),
    ).toEqual({
        status: "unavailable",
        reason: "documentary_import_in_progress",
    });
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now - 7 * 24 * 60 * 60 * 1000);
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob([text])));
    const owner = {
        captureId: reserved.capture._id,
        operationRequestId: first.requestId,
        attemptRevision: reserved.capture.retainedImport.attemptRevision,
    };
    await t.mutation(internal.sourceCaptures.attachStorage, {
        ...owner,
        storageId,
    });
    vi.setSystemTime(now);
    await t.mutation(internal.evidenceArtifacts.reconcileArtifactStorage, {});
    expect(await t.run((ctx) => ctx.db.get(owner.captureId))).toMatchObject({
        status: "uploaded",
        storageId,
    });
    expect(await t.run((ctx) => ctx.db.system.get(storageId))).not.toBeNull();
    await t.mutation(internal.execution.operations.recordResult, {
        ...first,
        outcome: { kind: "unavailable", code: "operation_outcome_unknown" },
    });
    const claim = await t.mutation(internal.execution.operations.claim, second);
    assert(claim.kind === "execute", JSON.stringify(claim));
    let lost = false;
    const resumed = await t.action((ctx) =>
        registeredImport._handler(
            {
                ...ctx,
                async runMutation(reference, ...parameters) {
                    const result = await ctx.runMutation(
                        reference,
                        ...parameters,
                    );
                    if (
                        getFunctionName(reference) === "sourceCaptures:finalize"
                    ) {
                        lost = true;
                        throw new Error("Import commit acknowledgement lost");
                    }
                    return result;
                },
            },
            second,
        ),
    );
    expect(lost).toBe(true);
    expect(resumed).toEqual({ status: "ready", captureId: owner.captureId });
    await expect(
        t.mutation(internal.sourceCaptures.attachStorage, {
            ...owner,
            storageId,
        }),
    ).rejects.toThrow("capture_missing");
    expect(
        await t.action(
            internal.sourceCaptureActions.importRetainedDocument,
            second,
        ),
    ).toEqual(resumed);
    expect(await t.run((ctx) => ctx.db.get(owner.captureId))).toMatchObject({
        status: "committed",
        storageId,
        retainedImport: { attemptRevision: 2 },
    });
    expect(fetch).not.toHaveBeenCalled();
});

test("an upload interrupted before attachment reclaims the blob and retries the same import", async () => {
    const { t, active, reference, fetch, text, contentHash } =
        await seedHistoricalRead();
    const first = {
        requestId: await t.mutation(internal.execution.operations.enqueue, {
            missionId: active.missionId,
            expectedGeneration: 1,
            cause: "import-interrupted-before-attachment",
            input: { kind: "read_in_context", reference },
        }),
        expectedGeneration: 1,
    };
    expect(
        await t.mutation(internal.execution.operations.claim, first),
    ).toMatchObject({
        kind: "execute",
    });
    let abandoned:
        | FunctionArgs<
              typeof internal.sourceCaptures.attachStorage
          >["storageId"]
        | undefined;
    await expect(
        t.action((ctx) =>
            registeredImport._handler(
                {
                    ...ctx,
                    async runMutation(reference, ...parameters) {
                        if (
                            getFunctionName(reference) ===
                            "sourceCaptures:attachStorage"
                        ) {
                            const args = parameters[0] as FunctionArgs<
                                typeof internal.sourceCaptures.attachStorage
                            >;
                            abandoned = args.storageId;
                            throw new Error(
                                "Controlled attachment interruption",
                            );
                        }
                        return ctx.runMutation(reference, ...parameters);
                    },
                },
                first,
            ),
        ),
    ).rejects.toThrow("Controlled attachment interruption");
    assert(abandoned);
    const storageId = abandoned;
    expect(await t.run((ctx) => ctx.db.system.get(storageId))).toBeNull();
    const initial = await t.run((ctx) =>
        ctx.db.query("sourceCaptures").unique(),
    );
    expect(initial).toMatchObject({ status: "unavailable", contentHash });
    expect(initial?.storageId).toBeUndefined();
    await t.mutation(internal.execution.operations.recordResult, {
        ...first,
        outcome: { kind: "unavailable", code: "operation_outcome_unknown" },
    });
    const remaining = {
        requestId: await t.mutation(internal.execution.operations.enqueue, {
            missionId: active.missionId,
            expectedGeneration: 1,
            cause: "import-after-interrupted-attachment",
            input: {
                kind: "search_available_material",
                reference,
                query: "insurer review rights",
            },
        }),
        expectedGeneration: 1,
    };
    const result = await t.action(
        internal.execution.operations.dispatch,
        remaining,
    );
    assert(result.kind === "success", JSON.stringify(result));
    expect(JSON.parse(result.valueJson)).toMatchObject({
        captureId: initial?._id,
        contentHash,
        passages: [
            expect.objectContaining({
                exactQuote: expect.stringContaining(
                    "The insurer kept review rights.",
                ),
            }),
        ],
    });
    const recovered = await t.run((ctx) =>
        ctx.db.query("sourceCaptures").unique(),
    );
    expect(recovered).toMatchObject({
        _id: initial?._id,
        status: "committed",
        retainedImport: { attemptRevision: 2 },
    });
    const recoveredStorage = recovered?.storageId;
    assert(recoveredStorage);
    expect(
        await t.run(async (ctx) =>
            (await ctx.storage.get(recoveredStorage))?.text(),
        ),
    ).toBe(text);
    expect(fetch).not.toHaveBeenCalled();
});

test.each([
    ["missing", "retained_text_invalid"],
    ["incomplete", "retained_text_incomplete"],
] as const)("%s historical text leaves Workbench usable with an explicit unavailable document", async (failure, reason) => {
    const { t, active, historical, reference, fetch, url } =
        await seedHistoricalRead();
    await t.run(async (ctx) => {
        const retained = await ctx.db
            .query("retainedTexts")
            .withIndex("by_key", (q) =>
                q.eq("key", `operation:${historical._id}:observation`),
            )
            .unique();
        assert(retained);
        if (failure === "missing") await ctx.db.delete(retained._id);
        else await ctx.db.patch(retained._id, { received: 0 });
    });
    const context = await t.run((ctx) =>
        buildMissionContext(ctx, active.missionId, 1),
    );
    assert(context.kind === "ready");
    expect(JSON.parse(context.inputJson).domain).toMatchObject({
        availableMaterials: [],
        unavailableDocumentaryMaterials: [{ canonicalUrl: url, reason }],
    });
    const requestId = await t.mutation(internal.execution.operations.enqueue, {
        missionId: active.missionId,
        expectedGeneration: 1,
        cause: "try-unavailable-document",
        input: { kind: "read_in_context", reference },
    });
    expect(
        await t.action(internal.execution.operations.dispatch, {
            requestId,
            expectedGeneration: 1,
        }),
    ).toMatchObject({ code: reason });
    expect(fetch).not.toHaveBeenCalled();
});

test("Start exposes a historical import without inventing its retrieval date", async () => {
    const { t, client, runId, active, reference, fetch } =
        await seedHistoricalRead(false, "\uFEFF");
    const requestId = await t.mutation(internal.execution.operations.enqueue, {
        missionId: active.missionId,
        expectedGeneration: 1,
        cause: "import-before-start",
        input: { kind: "read_in_context", reference },
    });
    const result = await t.action(internal.execution.operations.dispatch, {
        requestId,
        expectedGeneration: 1,
    });
    assert(result.kind === "success", JSON.stringify(result));
    const read = JSON.parse(result.valueJson);
    expect(read.retrievedAt).toBeNull();
    const revision = await client.mutation(api.framing.save, {
        runId,
        expectedRevision: 1,
        requestKey: "reviewed-program",
        content: {
            scope: "Insurer review rights",
            questions: [
                {
                    id: "authority",
                    shortLabel: "Authority",
                    text: "Who can approve review outcomes?",
                    rationale: "Identify who controls the process.",
                },
            ],
        },
    });
    vi.stubEnv("SOURCES_MISSION_ENABLED", "true");
    vi.stubEnv("SOURCES_MISSION_ENVELOPE", JSON.stringify(sourcesTestEnvelope));
    await client.mutation(api.framing.startResearch, {
        runId,
        expectedRevision: revision,
        requestKey: "start-with-import",
    });
    const run = await t.run((ctx) => ctx.db.get(runId));
    assert(run?.activeCorpusRevisionId);
    for (const state of [
        {
            lifecycleState: "checking_public_evidence",
            stepKey: "check_public_evidence",
        },
        { lifecycleState: "discovering_sources", stepKey: "prepare_sources" },
    ] as const) {
        await t.mutation(internal.researchRuns.transition, {
            ...state,
            runId,
            expectedExecutionGeneration: run.executionGeneration,
            executionStatus: "running",
        });
    }
    const preparationId = await t.mutation(internal.sourcesMission.claim, {
        runId,
        corpusRevisionId: run.activeCorpusRevisionId,
        expectedGeneration: run.executionGeneration,
        envelope: sourcesTestEnvelope,
    });
    expect(
        (await t.run((ctx) => ctx.db.get(preparationId)))?.sourcesMission,
    ).toMatchObject({
        captureIds: [read.captureId],
        acquisitions: 0,
        qualifications: [],
    });
    const index = await t.action(internal.sourceRetrievalActions.indexCapture, {
        preparationId,
        captureId: read.captureId,
        mode: "lexical",
    });
    expect(index.candidateCount).toBeGreaterThan(0);
    expect(
        await t.query(internal.sourceRetrieval.search, {
            preparationId,
            captureId: read.captureId,
            query: "insurer",
        }),
    ).toEqual([
        expect.objectContaining({
            captureId: read.captureId,
            contentHash: read.contentHash,
            quotation: expect.stringContaining(
                "The insurer kept review rights.",
            ),
        }),
    ]);
    expect(fetch).not.toHaveBeenCalled();
});

test("Workbench inventory skips historical continuation bodies within the transaction limit", async () => {
    const f = await seedHistoricalRead(true);
    const excerpt = "界".repeat(8192);
    for (let start = 0; start < 700; start += 20)
        await f.t.run(async (ctx) => {
            const root = await ctx.db.get(f.historical._id);
            assert(root?.input.kind === "read_public_context");
            const { _id, _creationTime, ...record } = root;
            for (let page = start; page < start + 20; page++) {
                const readId = await ctx.db.insert("agentOperationRequests", {
                    ...record,
                    logicalKey: `continuation-${page}`,
                    input: { ...root.input, continuation: _id },
                });
                await ctx.db.patch(readId, {
                    outcome: {
                        kind: "success",
                        valueJson: JSON.stringify({
                            readId,
                            status: "observed",
                            document: {
                                readId: _id,
                                characters: 8192 * 700,
                                contentHash: f.contentHash,
                                acquisitionCompleteness: "complete",
                            },
                            reference: {
                                url: f.url,
                                publisher: "example.com",
                                excerpt,
                            },
                            range: {
                                start: page * 8192,
                                end: (page + 1) * 8192,
                            },
                        }),
                    },
                });
            }
        });
    const context = await f.t.query(internal.execution.context.build, {
        missionId: f.active.missionId,
        expectedGeneration: 1,
    });
    assert(context.kind === "ready");
    expect(JSON.parse(context.inputJson).domain.availableMaterials).toEqual([
        expect.objectContaining({
            canonicalUrl: f.url,
            contentHash: f.contentHash,
        }),
    ]);
});
