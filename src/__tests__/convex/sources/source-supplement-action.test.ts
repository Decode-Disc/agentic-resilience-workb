import { internal } from "@convex/_generated/api";
import "@convex/sourcePreparationActions";
import { afterEach, expect, test, vi } from "vitest";

import { seedSourcePreparation } from "@/__tests__/setup/source-preparation";

const dns = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock("node:dns/promises", () => ({ ...dns, default: dns }));
afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    dns.lookup.mockReset();
});

async function inspectedCandidates() {
    const fixture = await seedSourcePreparation();
    const preparationId = await fixture.t.mutation(
        internal.sourcePreparation.claimForDiscovery,
        {
            runId: fixture.runId,
            corpusRevisionId: fixture.corpusRevisionId,
            expectedExecutionGeneration: 3,
        },
    );
    await fixture.t.mutation(internal.sourcePreparation.recordResult, {
        preparationId,
        outcome: {
            sourceId: fixture.sourceId,
            result: { status: "unavailable", reasonCode: "not_available" },
        },
    });
    return { ...fixture, preparationId };
}

test("empty supplement searches stop after three requests and replay makes no fourth request", async () => {
    vi.stubEnv("EXA_API_KEY", "test-only-exa-key");
    const { t, preparationId } = await inspectedCandidates();
    const request = vi.fn<typeof fetch>(async () =>
        Response.json({ results: [] }),
    );
    vi.stubGlobal("fetch", request);
    for (let index = 0; index < 3; index++)
        expect(
            await t.action(internal.sourcePreparationActions.searchSupplement, {
                preparationId,
            }),
        ).toMatchObject({ status: "searched" });
    expect(
        await t.action(internal.sourcePreparationActions.searchSupplement, {
            preparationId,
        }),
    ).toMatchObject({ status: "complete" });
    expect(request).toHaveBeenCalledTimes(3);
    expect(dns.lookup).not.toHaveBeenCalled();
    const calls = await t.run((ctx) => ctx.db.query("providerCalls").take(4));
    expect(calls).toHaveLength(3);
    expect(calls.every((c) => c.status === "succeeded")).toBe(true);
});

test("missing supplemental search configuration is explicit and dispatches no provider or DNS work", async () => {
    vi.stubEnv("EXA_API_KEY", "");
    const { t, preparationId } = await inspectedCandidates();
    const request = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", request);
    expect(
        await t.action(internal.sourcePreparationActions.searchSupplement, {
            preparationId,
        }),
    ).toEqual({ status: "blocked", reasonCode: "missing_configuration" });
    expect(request).not.toHaveBeenCalled();
    expect(dns.lookup).not.toHaveBeenCalled();
    expect(
        await t.run((ctx) => ctx.db.query("providerCalls").take(1)),
    ).toHaveLength(0);
});

test("a cancelled result cannot resolve candidate DNS or insert a new source", async () => {
    vi.stubEnv("EXA_API_KEY", "test-only-exa-key");
    const { t, runId, preparationId } = await inspectedCandidates();
    const request = vi.fn<typeof fetch>(async () => {
        await t.run((ctx) =>
            ctx.db.patch(runId, {
                executionStatus: "cancelled",
                executionGeneration: 4,
            }),
        );
        return Response.json({
            results: [
                {
                    id: "unaccepted",
                    url: "https://example.com/late",
                    title: "Late source",
                },
            ],
        });
    });
    vi.stubGlobal("fetch", request);
    await expect(
        t.action(internal.sourcePreparationActions.searchSupplement, {
            preparationId,
        }),
    ).rejects.toThrow("stale_execution");
    expect(request).toHaveBeenCalledOnce();
    expect(dns.lookup).not.toHaveBeenCalled();
    expect(await t.run((ctx) => ctx.db.query("sources").take(3))).toHaveLength(
        1,
    );
});

test("private candidate addresses remain excluded and visible as a partial provider result", async () => {
    vi.stubEnv("EXA_API_KEY", "test-only-exa-key");
    const { t, preparationId } = await inspectedCandidates();
    dns.lookup.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    const request = vi.fn<typeof fetch>(async () =>
        Response.json({
            results: [
                {
                    id: "private",
                    url: "https://example.com/private",
                    title: "Private target",
                },
            ],
        }),
    );
    vi.stubGlobal("fetch", request);
    expect(
        await t.action(internal.sourcePreparationActions.searchSupplement, {
            preparationId,
        }),
    ).toEqual({ status: "searched" });
    expect(request).toHaveBeenCalledOnce();
    expect(dns.lookup).toHaveBeenCalledOnce();
    expect(await t.run((ctx) => ctx.db.query("sources").take(3))).toHaveLength(
        1,
    );
    expect(
        (await t.run((ctx) => ctx.db.query("providerCalls").take(2)))[0],
    ).toMatchObject({ status: "partial", usage: { accepted: 0, rejected: 1 } });
});
