import type { Id } from "@convex/_generated/dataModel";
import schema from "@convex/schema";
import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";

const { exaSearch } = vi.hoisted(() => ({
    exaSearch: vi.fn(),
}));

vi.mock("exa-js", () => ({
    default: class MockExa {
        search(...args: unknown[]) {
            return exaSearch(...args);
        }
    },
}));

vi.mock("node:dns/promises", async (importOriginal) => {
    const dns = await importOriginal<typeof import("node:dns/promises")>();
    return {
        ...dns,
        lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]),
    };
});

const modules = import.meta.glob("/convex/**/*.ts");
const discoverForRun = makeFunctionReference<
    "action",
    { runId: Id<"researchRuns"> },
    { total: number }
>("exaDiscoveryActions:discoverForRun");
const originalExaApiKey = process.env.EXA_API_KEY;

afterEach(() => {
    exaSearch.mockReset();
    if (originalExaApiKey === undefined) {
        delete process.env.EXA_API_KEY;
    } else {
        process.env.EXA_API_KEY = originalExaApiKey;
    }
    vi.useRealTimers();
});

async function createDiscoveryFixture(t: ReturnType<typeof convexTest>) {
    return t.run(async (ctx) => {
        const companyId = await ctx.db.insert("companies", {
            cik: "1818201",
            legalName: "CCC Intelligent Solutions Holdings Inc.",
            ticker: "CCC",
            exchange: "NYSE",
            canonicalizedAt: 1,
        });
        const runId = await ctx.db.insert("researchRuns", {
            companyId,
            lifecycleState: "discovering_sources",
            executionStatus: "running",
            executionGeneration: 1,
            nextEventSequence: 1,
            createdAt: 1,
            updatedAt: 1,
        });
        const corpusRevisionId = await ctx.db.insert("corpusRevisions", {
            runId,
            revision: 1,
            status: "draft",
            createdAt: 1,
        });
        await ctx.db.patch(runId, {
            activeCorpusRevisionId: corpusRevisionId,
        });
        await ctx.db.insert("researchPlans", {
            runId,
            version: 1,
            coveragePreset: "balanced",
            queries: [
                {
                    query: "CCC workflow control",
                    category: "independent_analysis",
                    dimensionKeys: ["workflow_control"],
                },
            ],
            createdAt: 1,
        });
        return { runId };
    });
}

test("does not retry Exa after cancellation invalidates an in-flight result", async () => {
    process.env.EXA_API_KEY = "test-key";
    const t = convexTest(schema, modules);
    const { runId } = await createDiscoveryFixture(t);
    let releaseSearch:
        | ((value: {
              results: Array<{
                  id: string;
                  url: string;
                  title: string;
              }>;
          }) => void)
        | undefined;
    exaSearch.mockImplementation(
        () =>
            new Promise((resolve) => {
                releaseSearch = resolve;
            }),
    );

    const discovery = t.action(discoverForRun, { runId });
    await vi.waitFor(() => expect(exaSearch).toHaveBeenCalledOnce());
    await t.run((ctx) =>
        ctx.db.patch(runId, {
            executionStatus: "cancelled",
            executionGeneration: 2,
            updatedAt: 2,
        }),
    );
    releaseSearch?.({
        results: [
            {
                id: "late-exa-result",
                url: "https://example.com/late",
                title: "Late result",
            },
        ],
    });

    await expect(discovery).rejects.toThrow("no longer active");
    expect(exaSearch).toHaveBeenCalledOnce();
    await expect(
        t.run((ctx) => ctx.db.query("sources").collect()),
    ).resolves.toHaveLength(0);
    await expect(
        t.run((ctx) => ctx.db.query("providerCalls").collect()),
    ).resolves.toEqual([
        expect.objectContaining({
            service: "exa",
            status: "failed",
            errorCode: "stale_execution",
        }),
    ]);
});

test("persists valid Exa candidates and records a partial provider result", async () => {
    process.env.EXA_API_KEY = "test-key";
    const t = convexTest(schema, modules);
    const { runId } = await createDiscoveryFixture(t);
    exaSearch.mockResolvedValue({
        results: [
            {
                id: "valid-result",
                url: "https://example.com/valid",
                title: "Valid result",
            },
            {
                id: "invalid-result",
                url: "http://example.com/invalid",
                title: "Invalid result",
            },
        ],
        searchTime: 24,
        costDollars: { total: 0.003 },
    });

    await expect(t.action(discoverForRun, { runId })).resolves.toEqual({
        total: 1,
    });
    await expect(t.action(discoverForRun, { runId })).resolves.toEqual({
        total: 1,
    });
    expect(exaSearch).toHaveBeenCalledOnce();
    await expect(
        t.run((ctx) => ctx.db.query("providerCalls").collect()),
    ).resolves.toEqual([
        expect.objectContaining({
            service: "exa",
            status: "partial",
            usage: {
                accepted: 1,
                rejected: 1,
                searchTime: 24,
            },
            reportedCost: 0.003,
        }),
    ]);
});

test("does not retry an entirely invalid Exa response batch", async () => {
    process.env.EXA_API_KEY = "test-key";
    const t = convexTest(schema, modules);
    const { runId } = await createDiscoveryFixture(t);
    exaSearch.mockResolvedValue({
        results: [
            {
                id: "invalid-result",
                url: "http://example.com/invalid",
                title: "Invalid result",
            },
        ],
    });

    await expect(t.action(discoverForRun, { runId })).resolves.toEqual({
        total: 0,
    });
    expect(exaSearch).toHaveBeenCalledOnce();
    await expect(
        t.run((ctx) => ctx.db.query("providerCalls").collect()),
    ).resolves.toEqual([
        expect.objectContaining({
            service: "exa",
            status: "failed",
            errorCode: "invalid_provider_response",
            usage: expect.objectContaining({ accepted: 0, rejected: 1 }),
        }),
    ]);
});

test("checks the paid-work switch before constructing Exa discovery work", async () => {
    process.env.EXA_API_KEY = "test-key";
    const t = convexTest(schema, modules);
    const { runId } = await createDiscoveryFixture(t);
    await t.run((ctx) =>
        ctx.db.insert("paidWorkControls", {
            key: "global",
            enabled: false,
            updatedAt: 1,
        }),
    );

    await expect(t.action(discoverForRun, { runId })).rejects.toThrow(
        "Paid provider work is disabled",
    );
    expect(exaSearch).not.toHaveBeenCalled();
});

test("bounds Exa discovery timeouts to two attempts", async () => {
    vi.useFakeTimers();
    process.env.EXA_API_KEY = "test-key";
    const t = convexTest(schema, modules);
    const { runId } = await createDiscoveryFixture(t);
    exaSearch.mockImplementation(() => new Promise(() => undefined));

    const discovery = t.action(discoverForRun, { runId });
    await vi.waitFor(() => expect(exaSearch).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(10_001);
    await vi.waitFor(() => expect(exaSearch).toHaveBeenCalledTimes(2));
    await vi.advanceTimersByTimeAsync(10_001);

    await expect(discovery).resolves.toEqual({ total: 0 });
    await expect(
        t.run((ctx) => ctx.db.query("providerCalls").collect()),
    ).resolves.toEqual([
        expect.objectContaining({
            status: "failed",
            attempt: 1,
            errorCode: "ExaLogicalTimeoutError",
        }),
        expect.objectContaining({
            status: "failed",
            attempt: 2,
            errorCode: "ExaLogicalTimeoutError",
        }),
    ]);
});
