import { internal } from "@convex/_generated/api";
import type { ActionCtx } from "@convex/_generated/server";
import { completeSources } from "@convex/domain/sources";
import { execute } from "@convex/sourcesMissionActions";
import { type FunctionArgs, getFunctionName } from "convex/server";
import { afterEach, assert, expect, test, vi } from "vitest";
import {
    dispatchSourcesOperation,
    seedCapturedSources,
} from "@/__tests__/setup/sources-mission";

vi.mock("node:dns/promises", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:dns/promises")>();
    const lookup = vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]);
    return { ...actual, default: { ...actual, lookup }, lookup };
});

afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
});

test("confirmed discovery survives a committed settlement whose acknowledgement is lost without repeating provider work", async () => {
    vi.stubEnv("EXA_API_KEY", "fixture-only");
    const fetch = vi.fn(
        async (_url: string, _init: RequestInit) =>
            new Response(
                JSON.stringify({
                    results: [],
                    searchTime: 7,
                    costDollars: { total: 0.01 },
                }),
                { status: 200 },
            ),
    );
    vi.stubGlobal("fetch", fetch);
    const f = await seedCapturedSources();
    await f.t.run(async (ctx) => {
        const preparation = await ctx.db.get(f.preparationId);
        assert(preparation?.sourcesMission);
        await ctx.db.patch(f.preparationId, {
            sourcesMission: {
                ...preparation.sourcesMission,
                coveragePolicy: {
                    version: "sources_coverage_v1",
                    preset: "independent_scrutiny",
                },
            },
        });
    });
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueueNative,
        {
            runId: f.runId,
            expectedGeneration: 4,
            cause: "lost-settlement-ack",
            input: {
                kind: "discover_sources_for_need",
                needId: "common-context",
                query: "Additional material",
                focus: "official",
            },
        },
    );
    expect(
        await f.t.mutation(internal.execution.operations.claim, {
            requestId,
            expectedGeneration: 4,
        }),
    ).toMatchObject({ kind: "outcome", outcome: { kind: "waiting" } });
    const registered = execute as typeof execute & {
        _handler(
            ctx: ActionCtx,
            args: FunctionArgs<typeof internal.sourcesMissionActions.execute>,
        ): Promise<unknown>;
    };
    let lost = false;
    await expect(
        f.t.action((ctx) =>
            registered._handler(
                {
                    ...ctx,
                    runMutation: async (reference, args) => {
                        const result = await ctx.runMutation(reference, args);
                        if (
                            getFunctionName(reference) ===
                                "providerCalls:recordAttempt" &&
                            args &&
                            typeof args === "object" &&
                            "status" in args &&
                            args.status === "succeeded" &&
                            !lost
                        ) {
                            lost = true;
                            throw Error(
                                "simulated lost settlement acknowledgement",
                            );
                        }
                        return result;
                    },
                },
                { requestId, expectedGeneration: 4 },
            ),
        ),
    ).resolves.toMatchObject({
        kind: "unavailable",
        code: "operation_outcome_unknown",
    });
    const calls = await f.t.run((ctx) =>
        ctx.db
            .query("providerCalls")
            .withIndex("by_run", (q) => q.eq("runId", f.runId))
            .take(10),
    );
    expect(
        calls.find((c) => c.operation === "source_need_search"),
    ).toMatchObject({
        status: "succeeded",
        reportedCost: 0.01,
        dispatchOutcome: "response_received",
        usage: { searchTime: 7, returned: 0, accepted: 0, rejected: 0 },
    });
    expect(
        await f.t.action((ctx) =>
            registered._handler(ctx, { requestId, expectedGeneration: 4 }),
        ),
    ).toBeNull();
    expect((await f.t.run((ctx) => ctx.db.get(requestId)))?.status).toBe(
        "unknown",
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    const body = fetch.mock.calls[0]?.[1].body;
    assert(typeof body === "string");
    expect(JSON.parse(body).query).toBe(
        "Additional material\nPrioritize relevant issuer and regulatory publications.",
    );
});

test("mixed discovery retains usable candidates and partial provider status", async () => {
    vi.stubEnv("EXA_API_KEY", "fixture-only");
    vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
            new Response(
                JSON.stringify({
                    results: [
                        {
                            id: "valid",
                            url: "https://example.com/guide",
                            title: "Guide",
                        },
                        {
                            id: "invalid",
                            url: "https://127.0.0.1/private",
                            title: "Invalid",
                        },
                    ],
                    searchTime: 7,
                    costDollars: { total: 0.01 },
                }),
                { status: 200 },
            ),
        ),
    );
    const f = await seedCapturedSources();
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueueNative,
        {
            runId: f.runId,
            expectedGeneration: 4,
            cause: "mixed-discovery",
            input: {
                kind: "discover_sources_for_need",
                needId: "common-context",
                query: "Additional material",
            },
        },
    );
    expect(
        await dispatchSourcesOperation(f.t, {
            requestId,
            expectedGeneration: 4,
        }),
    ).toMatchObject({ kind: "success" });
    const receipts = await f.t.run((ctx) =>
        ctx.db
            .query("providerCalls")
            .withIndex("by_run", (q) => q.eq("runId", f.runId))
            .take(10),
    );
    expect(
        receipts.find((r) => r.operation === "source_need_search"),
    ).toMatchObject({
        status: "partial",
        reportedCost: 0.01,
        dispatchOutcome: "response_received",
        usage: { accepted: 1, rejected: 1, searchTime: 7 },
    });
    const sources = await f.t.run((ctx) =>
        ctx.db
            .query("sources")
            .withIndex("by_run_and_url", (q) => q.eq("runId", f.runId))
            .collect(),
    );
    expect(sources.map((s) => s.canonicalUrl)).toContain(
        "https://example.com/guide",
    );
    expect(sources.map((s) => s.canonicalUrl)).not.toContain(
        "https://127.0.0.1/private",
    );
});

test.each([
    [
        {
            id: "private-result",
            url: "https://127.0.0.1/private",
            title: "Invalid result",
        },
    ],
    [{ url: "https://127.0.0.1/private", title: "Malformed result" }],
])("entirely rejected discovery is unfinished work rather than a completed documentary gap: %j", async (...results) => {
    vi.stubEnv("EXA_API_KEY", "fixture-only");
    vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
            new Response(
                JSON.stringify({
                    results,
                    searchTime: 7,
                    costDollars: { total: 0.01 },
                }),
                { status: 200 },
            ),
        ),
    );
    const f = await seedCapturedSources();
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueueNative,
        {
            runId: f.runId,
            expectedGeneration: 4,
            cause: "invalid-discovery",
            input: {
                kind: "discover_sources_for_need",
                needId: "common-context",
                query: "Additional documentary material",
            },
        },
    );
    expect(
        await dispatchSourcesOperation(f.t, {
            requestId,
            expectedGeneration: 4,
        }),
    ).toMatchObject({ kind: "unavailable", code: "invalid_provider_response" });
    await expect(
        f.t.run((ctx) =>
            completeSources(ctx, f.preparationId, {
                kind: "complete",
                needsRevision: 1,
                needs: [
                    {
                        needId: "common-context",
                        workRequestIds: [requestId],
                        unfinished: [],
                        gap: "Nothing found.",
                    },
                ],
            }),
        ),
    ).rejects.toThrow("sources_work_unfinished");
    const calls = await f.t.run((ctx) =>
        ctx.db
            .query("providerCalls")
            .withIndex("by_run", (q) => q.eq("runId", f.runId))
            .take(10),
    );
    expect(
        calls.find((c) => c.operation === "source_need_search"),
    ).toMatchObject({
        status: "failed",
        errorCode: "invalid_provider_response",
        reportedCost: 0.01,
        dispatchOutcome: "response_received",
        usage: { accepted: 0, rejected: 1, searchTime: 7 },
    });
});

test("a confirmed discovery reply after cancellation settles facts without adopting candidates", async () => {
    vi.stubEnv("EXA_API_KEY", "fixture-only");
    const f = await seedCapturedSources();
    vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
            await f.t.run((ctx) =>
                ctx.db.patch(f.runId, {
                    executionStatus: "cancelled",
                    executionGeneration: 5,
                }),
            );
            return new Response(
                JSON.stringify({
                    results: [],
                    searchTime: 7,
                    costDollars: { total: 0.01 },
                }),
                { status: 200 },
            );
        }),
    );
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueueNative,
        {
            runId: f.runId,
            expectedGeneration: 4,
            cause: "late-discovery",
            input: {
                kind: "discover_sources_for_need",
                needId: "common-context",
                query: "Additional documentary material",
            },
        },
    );
    expect(
        await dispatchSourcesOperation(f.t, {
            requestId,
            expectedGeneration: 4,
        }),
    ).not.toMatchObject({ kind: "success" });
    const calls = await f.t.run((ctx) =>
        ctx.db
            .query("providerCalls")
            .withIndex("by_run", (q) => q.eq("runId", f.runId))
            .take(10),
    );
    expect(
        calls.find((c) => c.operation === "source_need_search"),
    ).toMatchObject({
        status: "succeeded",
        reportedCost: 0.01,
        dispatchOutcome: "response_received",
        usage: { searchTime: 7, accepted: 0, rejected: 0 },
    });
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.preparationId)))?.sourcesMission
            ?.result,
    ).toBeUndefined();
    expect(
        await f.t.run((ctx) =>
            ctx.db
                .query("sources")
                .withIndex("by_run_and_url", (q) => q.eq("runId", f.runId))
                .collect(),
        ),
    ).toHaveLength(1);
});

test("full candidate capacity refuses discovery before provider work and does not establish a search", async () => {
    vi.stubEnv("EXA_API_KEY", "fixture-only");
    const fetch = vi
        .fn()
        .mockResolvedValue(
            new Response(
                JSON.stringify({ results: [], costDollars: { total: 0.01 } }),
                { status: 200 },
            ),
        );
    vi.stubGlobal("fetch", fetch);
    const f = await seedCapturedSources();
    await f.t.run(async (ctx) => {
        for (let i = 1; i < 48; i++)
            await ctx.db.insert("sources", {
                runId: f.runId,
                canonicalUrl: `https://example.com/${i}`,
                title: `Candidate ${i}`,
                origin: "exa",
                category: "research_lead",
                createdAt: 1,
            });
    });
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueueNative,
        {
            runId: f.runId,
            expectedGeneration: 4,
            cause: "full-candidates",
            input: {
                kind: "discover_sources_for_need",
                needId: "common-context",
                query: "Additional documentary material",
            },
        },
    );
    const outcome = await dispatchSourcesOperation(f.t, {
        requestId,
        expectedGeneration: 4,
    });
    expect(outcome).toMatchObject({
        kind: "refused",
        code: "source_candidate_limit",
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(
        await f.t.run((ctx) =>
            ctx.db
                .query("providerCalls")
                .withIndex("by_run", (q) => q.eq("runId", f.runId))
                .take(1),
        ),
    ).toEqual([]);
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.preparationId)))?.sourcesMission
            ?.searches,
    ).toBe(0);
});

test("discovery retains provider-declared cost and search telemetry", async () => {
    vi.stubEnv("EXA_API_KEY", "fixture-only");
    vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
            new Response(
                JSON.stringify({
                    results: [],
                    searchTime: 7,
                    costDollars: { total: 0.01 },
                }),
                { status: 200 },
            ),
        ),
    );
    const f = await seedCapturedSources();
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueueNative,
        {
            runId: f.runId,
            expectedGeneration: 4,
            cause: "search-telemetry",
            input: {
                kind: "discover_sources_for_need",
                needId: "common-context",
                query: "Additional documentary material",
            },
        },
    );
    expect(
        await dispatchSourcesOperation(f.t, {
            requestId,
            expectedGeneration: 4,
        }),
    ).toMatchObject({ kind: "success" });
    const receipts = await f.t.run((ctx) =>
        ctx.db
            .query("providerCalls")
            .withIndex("by_run", (q) => q.eq("runId", f.runId))
            .take(10),
    );
    expect(
        receipts.find((r) => r.operation === "source_need_search"),
    ).toMatchObject({
        status: "succeeded",
        reportedCost: 0.01,
        usage: { searchTime: 7, accepted: 0, rejected: 0 },
    });
    const receipt = receipts.find((r) => r.operation === "source_need_search");
    assert(receipt?.inputHash && receipt.stepKey);
    const identity = {
        runId: f.runId,
        corpusRevisionId: f.corpusRevisionId,
        preparationId: f.preparationId,
        executionGeneration: 4,
        workflowVersion: receipt.workflowVersion,
        stepKey: receipt.stepKey,
        service: "exa" as const,
        operation: receipt.operation,
        operationKey: receipt.operationKey,
        attempt: receipt.attempt,
        status: "succeeded" as const,
    };
    await expect(
        f.t.mutation(internal.providerCalls.recordAttempt, identity),
    ).rejects.toThrow("attempt_identity_conflict");
    await expect(
        f.t.mutation(internal.providerCalls.recordAttempt, {
            ...identity,
            inputHash: "0".repeat(64),
        }),
    ).rejects.toThrow("attempt_identity_conflict");
});
