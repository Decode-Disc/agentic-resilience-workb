import { internal } from "@convex/_generated/api";
import { sha256Hex } from "@convex/domain/sourcePassages";
import { SOURCE_EMBEDDING_PROFILE } from "@convex/integrations/sourceEmbeddings";
import { afterEach, expect, test, vi } from "vitest";
import { seedSourcePreparation } from "@/__tests__/setup/source-preparation";

async function indexedCaptureSubset() {
    const fixture = await seedSourcePreparation();
    const { t, runId, corpusRevisionId } = fixture;
    const preparationId = await t.mutation(
        internal.sourcePreparation.claimForDiscovery,
        { runId, corpusRevisionId, expectedExecutionGeneration: 3 },
    );
    const captures = [];
    for (const [label, count] of [
        ["distractor", 300],
        ["primary-a", 1],
        ["primary-b", 1],
    ] as const) {
        const quotations = Array.from(
            { length: count },
            (_, i) => `Routing architecture ${label} passage ${i}.`,
        );
        const text = quotations.join("\n\n");
        const captureId = await t.run(async (ctx) => {
            const sourceId = await ctx.db.insert("sources", {
                runId,
                canonicalUrl: `https://example.com/${label}`,
                title: label,
                origin: "exa",
                category: "official_product",
                createdAt: 1,
            });
            const storageId = await ctx.storage.store(new Blob([text]));
            return ctx.db.insert("sourceCaptures", {
                runId,
                corpusRevisionId,
                sourceId,
                preparationId,
                executionGeneration: 3,
                captureKey: label,
                requestInputHash: sha256Hex(label),
                status: "committed",
                requestedUrl: `https://example.com/${label}`,
                contentHash: sha256Hex(text),
                storageId,
                byteCount: text.length,
                normalizerVersion: "test",
                createdAt: 1,
                updatedAt: 1,
            });
        });
        let offset = 0;
        const passages = quotations.map((quotation, order) => {
            const startOffset = offset;
            offset += quotation.length + 2;
            return {
                order,
                startOffset,
                endOffset: startOffset + quotation.length,
                quotation,
                headingPath: [],
            };
        });
        for (let start = 0; start < passages.length; start += 64)
            await t.mutation(internal.sourceRetrieval.putBatch, {
                preparationId,
                captureId,
                passages: passages.slice(start, start + 64),
            });
        await t.mutation(internal.sourceRetrieval.finishIndex, {
            preparationId,
            captureId,
            candidateCount: count,
        });
        captures.push(captureId);
    }
    const distractorId = captures[0];
    if (!distractorId) throw new Error("Missing distractor capture");
    return {
        ...fixture,
        preparationId,
        captureIds: captures.slice(1),
        distractorId,
    };
}

test("lexical search retains requested captures behind more than 256 out-of-scope matches", async () => {
    const { t, preparationId, captureIds } = await indexedCaptureSubset();
    const found = await t.action(internal.sourceRetrievalActions.retrieve, {
        preparationId,
        captureIds,
        queries: ["routing"],
        mode: "lexical",
    });
    expect(found.passages.map((row) => row.quotation).sort()).toEqual([
        "Routing architecture primary-a passage 0.",
        "Routing architecture primary-b passage 0.",
    ]);
});

test("semantic search applies the requested capture scope before its top-k", async () => {
    const { t, preparationId, captureIds, distractorId } =
        await indexedCaptureSubset();
    const profile = SOURCE_EMBEDDING_PROFILE.id;
    const vector = (first: number) =>
        Array.from({ length: 1024 }, (_, i) =>
            i === 0 ? first : i === 1 ? Math.sqrt(1 - first ** 2) : 0,
        );
    const rows = await t.run(async (ctx) => {
        const rows = await ctx.db.query("sourceSearchPassages").collect();
        for (const row of rows)
            await ctx.db.insert("sourceEmbeddingCache", {
                profile,
                textHash: sha256Hex(row.searchText),
                vector: vector(row.captureId === distractorId ? 1 : 0.8),
            });
        await ctx.db.insert("sourceEmbeddingCache", {
            profile,
            textHash: sha256Hex("infrastructure"),
            vector: vector(1),
        });
        return rows;
    });
    for (const captureId of [distractorId, ...captureIds]) {
        const ids = rows
            .filter((row) => row.captureId === captureId)
            .map((row) => row._id);
        for (let start = 0; start < ids.length; start += 16)
            await t.mutation(internal.sourceRetrieval.commitEmbeddings, {
                preparationId,
                captureId,
                profile,
                ids: ids.slice(start, start + 16),
            });
        await t.mutation(internal.sourceRetrieval.finishIndex, {
            preparationId,
            captureId,
            candidateCount: ids.length,
            embeddingProfile: profile,
        });
    }
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const found = await t.action(internal.sourceRetrievalActions.retrieve, {
        preparationId,
        captureIds,
        queries: ["infrastructure"],
        mode: "hybrid",
    });
    expect(found.metadata.effectiveMode).toBe("hybrid");
    expect(found.passages.map((row) => row.captureId).sort()).toEqual(
        [...captureIds].sort(),
    );
    expect(fetchMock).not.toHaveBeenCalled();
});

afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
});

test("indexing is idempotent, scoped to a capture and rejects late writes after cancellation", async () => {
    const { t, runId, corpusRevisionId, sourceId } =
        await seedSourcePreparation();
    const preparationId = await t.mutation(
        internal.sourcePreparation.claimForDiscovery,
        { runId, corpusRevisionId, expectedExecutionGeneration: 3 },
    );
    const text = "Subscription revenue increased. Fiscal 2025, USD millions.";
    const captureId = await t.run(async (ctx) =>
        ctx.db.insert("sourceCaptures", {
            runId,
            corpusRevisionId,
            sourceId,
            preparationId,
            executionGeneration: 3,
            captureKey: "retrieval-test",
            requestInputHash: sha256Hex("input"),
            status: "committed",
            requestedUrl: "https://example.com",
            contentHash: sha256Hex(text),
            byteCount: text.length,
            normalizerVersion: "test",
            createdAt: 1,
            updatedAt: 1,
        }),
    );
    const args = {
        preparationId,
        captureId,
        passages: [
            {
                order: 0,
                startOffset: 0,
                endOffset: text.length,
                quotation: text,
                headingPath: ["Revenue"],
            },
        ],
    };
    expect(await t.mutation(internal.sourceRetrieval.putBatch, args)).toBe(1);
    expect(await t.mutation(internal.sourceRetrieval.putBatch, args)).toBe(0);
    const found = await t.query(internal.sourceRetrieval.search, {
        preparationId,
        query: "subscription revenue",
        captureId,
    });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
        captureId,
        quotation: text,
        startOffset: 0,
    });
    expect(
        (
            await t.action(internal.sourceRetrievalActions.retrieve, {
                preparationId,
                queries: ["subscription revenue"],
                captureIds: [],
                mode: "lexical",
            })
        ).passages,
    ).toEqual([]);
    await t.run(async (ctx) => {
        await ctx.db.patch(runId, { executionGeneration: 4 });
    });
    await expect(
        t.mutation(internal.sourceRetrieval.putBatch, args),
    ).rejects.toThrow("stale_execution");
});

test("embedding reservations are atomic, cumulative, idempotent and capped per dossier", async () => {
    const { t, runId, corpusRevisionId, sourceId } =
        await seedSourcePreparation();
    const preparationId = await t.mutation(
        internal.sourcePreparation.claimForDiscovery,
        { runId, corpusRevisionId, expectedExecutionGeneration: 3 },
    );
    const p = await t.run((ctx) => ctx.db.get(preparationId));
    if (!p) throw new Error("Missing preparation fixture");
    const inputHash = sha256Hex("embedding batch");
    const attempt = {
        runId,
        corpusRevisionId,
        sourceId,
        preparationId,
        executionGeneration: 3,
        workflowVersion: 1,
        stepKey: "source_preparation",
        service: "model" as const,
        operation: "source_embedding",
        operationKey: `${p.operationKey}:step:source_embedding:input:${inputHash}:attempt:1`,
        inputHash,
        status: "started" as const,
        attempt: 1,
        embeddingInputBytes: 100000,
    };
    await t.run(async (ctx) => {
        await ctx.db.patch(runId, { sourceEmbeddingReservedBytes: 700000 });
    });
    const first = await t.mutation(
        internal.providerCalls.recordAttempt,
        attempt,
    );
    expect(first.shouldExecute).toBe(true);
    expect(
        (await t.mutation(internal.providerCalls.recordAttempt, attempt))
            .shouldExecute,
    ).toBe(false);
    const secondHash = sha256Hex("second batch");
    await expect(
        t.mutation(internal.providerCalls.recordAttempt, {
            ...attempt,
            inputHash: secondHash,
            operationKey: `${p.operationKey}:step:source_embedding:input:${secondHash}:attempt:1`,
            embeddingInputBytes: 40000,
        }),
    ).rejects.toThrow("embedding_budget_exhausted");
    expect(
        await t.run(
            async (ctx) =>
                (await ctx.db.get(runId))?.sourceEmbeddingReservedBytes,
        ),
    ).toBe(800000);
});

test("a missing embedding credential preserves native lexical evidence and records why hybrid degraded", async () => {
    const { t, runId, corpusRevisionId, sourceId } =
        await seedSourcePreparation();
    const preparationId = await t.mutation(
        internal.sourcePreparation.claimForDiscovery,
        { runId, corpusRevisionId, expectedExecutionGeneration: 3 },
    );
    const text =
        "# Revenue\n\nSubscription revenue in fiscal 2025 was USD 23769 million.";
    const captureId = await t.run(async (ctx) => {
        const storageId = await ctx.storage.store(new Blob([text]));
        return ctx.db.insert("sourceCaptures", {
            runId,
            corpusRevisionId,
            sourceId,
            preparationId,
            executionGeneration: 3,
            captureKey: "retrieval-action",
            requestInputHash: sha256Hex("input"),
            status: "committed",
            requestedUrl: "https://example.com",
            storageId,
            contentHash: sha256Hex(text),
            byteCount: text.length,
            normalizerVersion: "test",
            createdAt: 1,
            updatedAt: 1,
        });
    });
    const indexed = await t.action(
        internal.sourceRetrievalActions.indexCapture,
        { preparationId, captureId, mode: "hybrid" },
    );
    expect(indexed.degradationReason).toBe("missing_configuration");
    const found = await t.action(internal.sourceRetrievalActions.retrieve, {
        preparationId,
        captureIds: [captureId],
        queries: ["subscription revenue fiscal 2025"],
        mode: "hybrid",
    });
    expect(found.metadata).toMatchObject({
        requestedMode: "hybrid",
        effectiveMode: "lexical",
        degradationReason: "missing_configuration",
    });
    expect(found.passages[0]?.quotation).toContain("23769");
    expect(
        await t.run((ctx) => ctx.db.query("providerCalls").collect()),
    ).toHaveLength(0);
});

test("a cancelled embedding attempt cannot persist vectors or refund its reserved allowance", async () => {
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "a".repeat(32));
    vi.stubEnv("CLOUDFLARE_AI_TOKEN", "test-token");
    const { t, runId, corpusRevisionId, sourceId } =
        await seedSourcePreparation();
    const preparationId = await t.mutation(
        internal.sourcePreparation.claimForDiscovery,
        { runId, corpusRevisionId, expectedExecutionGeneration: 3 },
    );
    const text = "Subscription revenue in fiscal 2025.";
    const captureId = await t.run(async (ctx) => {
        const storageId = await ctx.storage.store(new Blob([text]));
        return ctx.db.insert("sourceCaptures", {
            runId,
            corpusRevisionId,
            sourceId,
            preparationId,
            executionGeneration: 3,
            captureKey: "cancelled-embedding",
            requestInputHash: sha256Hex("input"),
            status: "committed",
            requestedUrl: "https://example.com",
            storageId,
            contentHash: sha256Hex(text),
            byteCount: text.length,
            normalizerVersion: "test",
            createdAt: 1,
            updatedAt: 1,
        });
    });
    vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
            await t.run(async (ctx) => {
                await ctx.db.patch(runId, { executionGeneration: 4 });
            });
            return new Response(
                JSON.stringify({
                    success: true,
                    result: {
                        shape: [1, 1024],
                        data: [
                            Array.from({ length: 1024 }, (_, i) =>
                                i === 0 ? 1 : 0,
                            ),
                        ],
                    },
                }),
            );
        }),
    );
    await expect(
        t.action(internal.sourceRetrievalActions.indexCapture, {
            preparationId,
            captureId,
            mode: "hybrid",
        }),
    ).rejects.toThrow("stale_execution");
    const saved = await t.run(async (ctx) => ({
        rows: await ctx.db.query("sourceSearchPassages").collect(),
        cache: await ctx.db.query("sourceEmbeddingCache").collect(),
        run: await ctx.db.get(runId),
    }));
    expect(saved.rows[0]?.embedding).toBeUndefined();
    expect(saved.cache).toHaveLength(0);
    expect(saved.run?.sourceEmbeddingReservedBytes).toBe(text.length);
});

test("capture indexing honors its caller's remaining read allowance and reports zero bytes for reuse", async () => {
    const { t, runId, corpusRevisionId, sourceId } =
        await seedSourcePreparation();
    const preparationId = await t.mutation(
        internal.sourcePreparation.claimForDiscovery,
        { runId, corpusRevisionId, expectedExecutionGeneration: 3 },
    );
    const text = "An exact disclosure about subscription revenue.";
    const captureId = await t.run(async (ctx) => {
        const storageId = await ctx.storage.store(new Blob([text]));
        return ctx.db.insert("sourceCaptures", {
            runId,
            corpusRevisionId,
            sourceId,
            preparationId,
            executionGeneration: 3,
            captureKey: "read-allowance",
            requestInputHash: sha256Hex("input"),
            status: "committed",
            requestedUrl: "https://example.com",
            storageId,
            contentHash: sha256Hex(text),
            byteCount: text.length,
            normalizerVersion: "test",
            createdAt: 1,
            updatedAt: 1,
        });
    });
    await expect(
        t.action(internal.sourceRetrievalActions.indexCapture, {
            preparationId,
            captureId,
            mode: "lexical",
            maxReadBytes: 0,
        }),
    ).rejects.toThrow("retrieval_read_limit");
    expect(
        await t.run((ctx) => ctx.db.query("sourceSearchPassages").collect()),
    ).toHaveLength(0);
    expect(
        await t.action(internal.sourceRetrievalActions.indexCapture, {
            preparationId,
            captureId,
            mode: "lexical",
            maxReadBytes: text.length,
        }),
    ).toMatchObject({ readBytes: text.length });
    expect(
        await t.action(internal.sourceRetrievalActions.indexCapture, {
            preparationId,
            captureId,
            mode: "lexical",
            maxReadBytes: 0,
        }),
    ).toMatchObject({ readBytes: 0 });
});

test("successful hybrid preparation caches exact inputs and repeated retrieval does not issue another paid request", async () => {
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "a".repeat(32));
    vi.stubEnv("CLOUDFLARE_AI_TOKEN", "test-token");
    const { t, runId, corpusRevisionId, sourceId } =
        await seedSourcePreparation();
    const preparationId = await t.mutation(
        internal.sourcePreparation.claimForDiscovery,
        { runId, corpusRevisionId, expectedExecutionGeneration: 3 },
    );
    const text = "Subscription revenue in fiscal 2025 was USD 23769 million.";
    const captureId = await t.run(async (ctx) => {
        const storageId = await ctx.storage.store(new Blob([text]));
        return ctx.db.insert("sourceCaptures", {
            runId,
            corpusRevisionId,
            sourceId,
            preparationId,
            executionGeneration: 3,
            captureKey: "embedding-cache",
            requestInputHash: sha256Hex("input"),
            status: "committed",
            requestedUrl: "https://example.com",
            storageId,
            contentHash: sha256Hex(text),
            byteCount: text.length,
            normalizerVersion: "test",
            createdAt: 1,
            updatedAt: 1,
        });
    });
    const fetchMock = vi.fn(
        async () =>
            new Response(
                JSON.stringify({
                    success: true,
                    result: {
                        shape: [1, 1024],
                        data: [
                            Array.from({ length: 1024 }, (_, i) =>
                                i === 0 ? 1 : 0,
                            ),
                        ],
                    },
                }),
            ),
    );
    vi.stubGlobal("fetch", fetchMock);
    expect(
        await t.action(internal.sourceRetrievalActions.indexCapture, {
            preparationId,
            captureId,
            mode: "hybrid",
        }),
    ).toMatchObject({ embeddingComplete: true });
    const args = {
        preparationId,
        captureIds: [captureId],
        queries: ["subscription revenue fiscal 2025"],
        mode: "hybrid" as const,
    };
    const first = await t.action(
        internal.sourceRetrievalActions.retrieve,
        args,
    );
    expect(first.metadata.effectiveMode).toBe("hybrid");
    expect(first.passages[0]?.quotation).toBe(text);
    const before = await t.run((ctx) => ctx.db.get(runId));
    await t.action(internal.sourceRetrievalActions.retrieve, args);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
        (await t.run((ctx) => ctx.db.get(runId)))?.sourceEmbeddingReservedBytes,
    ).toBe(before?.sourceEmbeddingReservedBytes);
    expect(
        await t.run((ctx) => ctx.db.query("sourceEmbeddingCache").collect()),
    ).toHaveLength(2);
    await t.run(async (ctx) => {
        for (const row of await ctx.db
            .query("sourceSearchPassages")
            .collect()) {
            await ctx.db.patch(row._id, {
                embeddingScopeKey: `${row.scopeKey}:${row.embeddingProfile}`,
            });
        }
    });
    const legacy = await t.action(
        internal.sourceRetrievalActions.retrieve,
        args,
    );
    expect(legacy.metadata).toMatchObject({
        effectiveMode: "lexical",
        degradationReason: "embedding_scope_outdated",
    });
    expect(
        await t.action(internal.sourceRetrievalActions.indexCapture, {
            preparationId,
            captureId,
            mode: "hybrid",
        }),
    ).toMatchObject({ embeddingComplete: true });
    expect(
        (await t.action(internal.sourceRetrievalActions.retrieve, args))
            .metadata.effectiveMode,
    ).toBe("hybrid");
    expect(fetchMock).toHaveBeenCalledTimes(2);
});
