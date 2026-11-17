import { internal } from "@convex/_generated/api";
import { requestPinnedPublicSource } from "@convex/sourceActions";
import { afterEach, expect, test, vi } from "vitest";
import rateLimiterTest from "@/__tests__/convex/integrations/rate-limiter-test-register.js";
import { seedSourcePreparation } from "@/__tests__/setup/source-preparation";

const lookup = vi.hoisted(() =>
    vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]),
);
vi.mock("node:dns/promises", () => ({ lookup, default: { lookup } }));
vi.mock("@convex/sourceActions", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@convex/sourceActions")>()),
    requestPinnedPublicSource: vi.fn(),
}));
afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.clearAllMocks();
});

test.each([
    ["regulatory_annual", "10-K", "320193"],
    ["regulatory_interim", "10-Q", "789019"],
    ["regulatory_material_event", "8-K", "1373715"],
] as const)("%s finds only the requested SEC forms and leaves candidates pending", async (role, form, cik) => {
    const { t, runId, corpusRevisionId, companyId } =
        await seedSourcePreparation();
    rateLimiterTest.register(t);
    await t.run((ctx) => ctx.db.patch(companyId, { cik }));
    const preparationId = await t.mutation(
        internal.sourcePreparation.claimForDiscovery,
        { runId, corpusRevisionId, expectedExecutionGeneration: 3 },
    );
    await t.run((ctx) =>
        ctx.db.patch(preparationId, {
            target: { kind: "coverage", role },
            readingSourceIds: [],
        }),
    );
    vi.stubEnv("EXA_API_KEY", "");
    vi.stubEnv("SEC_USER_AGENT", "Test research research@example.com");
    const request = vi
        .mocked(requestPinnedPublicSource)
        .mockImplementation(async (url, address, options) => {
            expect(address).toBe("93.184.216.34");
            expect(options?.headers?.["User-Agent"]).toBe(
                "Test research research@example.com",
            );
            expect(String(url)).toBe(
                `https://data.sec.gov/submissions/CIK${cik.padStart(10, "0")}.json`,
            );
            return Response.json({
                cik,
                name: "Test issuer",
                tickers: ["TEST"],
                exchanges: ["NYSE"],
                filings: {
                    recent: {
                        accessionNumber: [
                            "0000000000-26-000001",
                            "0000000000-26-000002",
                            "0000000000-26-000003",
                        ],
                        form: ["10-K", "10-Q", "8-K"],
                        filingDate: ["2026-02-01", "2026-05-01", "2026-06-01"],
                        primaryDocument: [
                            "annual.htm",
                            "interim.htm",
                            "event.htm",
                        ],
                    },
                },
            });
        });
    vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
            throw new Error("Unexpected unpinned network request");
        }),
    );
    expect(
        await t.action(internal.sourcePreparationActions.searchSupplement, {
            preparationId,
        }),
    ).toEqual({ status: "searched" });
    const state = await t.run(async (ctx) => ({
        sources: await ctx.db
            .query("sources")
            .withIndex("by_run_and_url", (q) => q.eq("runId", runId))
            .take(10),
        decisions: await ctx.db.query("sourceDecisions").take(10),
        preparation: await ctx.db.get(preparationId),
        calls: await ctx.db.query("providerCalls").take(5),
    }));
    const added = state.sources.filter((s) => s.origin === "sec");
    expect(added.map((s) => s.secForm)).toEqual([form]);
    expect(
        state.decisions.find((d) => d.sourceId === added[0]?._id)?.decision,
    ).toBe("pending");
    expect(state.preparation?.readingSourceIds).toEqual([added[0]?._id]);
    expect(state.calls).toMatchObject([
        { service: "sec", status: "succeeded" },
    ]);
    expect(
        await t.action(internal.sourcePreparationActions.searchSupplement, {
            preparationId,
        }),
    ).toEqual({ status: "complete" });
    expect(request).toHaveBeenCalledOnce();
});

test.each([
    "empty",
    "wrong_issuer",
    "private_address",
    "cancelled",
    "provider_failure",
    "rate_limited",
    "timeout",
] as const)("SEC search preserves existing sources and decisions on %s", async (scenario) => {
    const { t, runId, corpusRevisionId, sourceId } =
        await seedSourcePreparation();
    rateLimiterTest.register(t);
    vi.stubEnv("SEC_USER_AGENT", "Test research research@example.com");
    vi.stubEnv("EXA_API_KEY", "");
    const preparationId = await t.mutation(
        internal.sourcePreparation.claimForDiscovery,
        { runId, corpusRevisionId, expectedExecutionGeneration: 3 },
    );
    await t.run((ctx) =>
        ctx.db.patch(preparationId, {
            target: { kind: "coverage", role: "regulatory_annual" },
            readingSourceIds: [],
        }),
    );
    const decisions = await t.run((ctx) =>
        ctx.db.query("sourceDecisions").take(10),
    );
    if (scenario === "private_address")
        vi.mocked(lookup).mockResolvedValueOnce([
            { address: "127.0.0.1", family: 4 },
        ]);
    const request = vi
        .mocked(requestPinnedPublicSource)
        .mockImplementation(async () => {
            if (scenario === "cancelled")
                await t.run((ctx) =>
                    ctx.db.patch(runId, {
                        executionGeneration: 4,
                        executionStatus: "paused",
                    }),
                );
            if (scenario === "provider_failure" || scenario === "rate_limited")
                return new Response("Unavailable", {
                    status: scenario === "rate_limited" ? 429 : 503,
                });
            if (scenario === "timeout")
                throw new DOMException("Timed out", "AbortError");
            return Response.json({
                cik: scenario === "wrong_issuer" ? "320193" : "1373715",
                name: "Test issuer",
                tickers: ["TEST"],
                exchanges: ["NYSE"],
                filings: {
                    recent: {
                        accessionNumber:
                            scenario === "empty"
                                ? []
                                : ["0001373715-26-000001"],
                        form: ["10-K"],
                        filingDate: ["2026-02-01"],
                        primaryDocument: ["annual.htm"],
                    },
                },
            });
        });
    vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
            throw new Error("Unexpected unpinned request");
        }),
    );
    const result = t.action(
        internal.sourcePreparationActions.searchSupplement,
        { preparationId },
    );
    if (scenario === "cancelled") await expect(result).rejects.toThrow();
    else
        expect(await result).toMatchObject({
            status: scenario === "empty" ? "searched" : "blocked",
            ...(["provider_failure", "rate_limited", "timeout"].includes(
                scenario,
            )
                ? { reasonCode: "transport_unavailable" }
                : {}),
        });
    const state = await t.run(async (ctx) => ({
        sources: await ctx.db
            .query("sources")
            .withIndex("by_run_and_url", (q) => q.eq("runId", runId))
            .take(10),
        decisions: await ctx.db.query("sourceDecisions").take(10),
    }));
    expect(state.sources.map((source) => source._id)).toEqual([sourceId]);
    expect(state.decisions).toEqual(decisions);
    expect(request).toHaveBeenCalledTimes(
        scenario === "private_address" ? 0 : 1,
    );
});
