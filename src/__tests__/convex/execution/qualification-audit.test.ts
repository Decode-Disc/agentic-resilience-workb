import { internal } from "@convex/_generated/api";
import { initializeQualificationUsage } from "@convex/qualificationUsage";
import { afterEach, expect, test, vi } from "vitest";
import { seedCapturedSources } from "@/__tests__/setup/sources-mission";

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
});

test("closed qualification contexts retain read-only capture audit without reopening execution", async () => {
    const f = await seedCapturedSources();
    vi.stubEnv("E2E_FIXTURES_ENABLED", "true");
    vi.stubEnv("CONVEX_CLOUD_URL", "http://127.0.0.1:3210");
    await f.t.run(async (ctx) => {
        const run = await ctx.db.get(f.runId);
        const visitor = run?.ownerVisitorId
            ? await ctx.db.get(run.ownerVisitorId)
            : null;
        if (!visitor) throw new Error("Missing admitted fixture owner");
        await ctx.db.patch(visitor.invitationId, { slotKey: "analyst-4" });
    });
    const contextId = await f.t.mutation(
        internal.runWorkspace.openBrowserTestContext,
        {
            slotKey: "analyst-4",
            contextKey: "retained-audit",
            durationMs: 60_000,
        },
    );
    await f.t.run((ctx) =>
        ctx.db.patch(f.runId, {
            purpose: "browser_test",
            browserTestContextId: contextId,
            reservationKey: "browser:retained-audit",
        }),
    );
    await f.t.run((ctx) =>
        initializeQualificationUsage(ctx, contextId, [f.runId]),
    );
    await f.t.mutation(internal.runWorkspace.closeBrowserTestContext, {
        slotKey: "analyst-4",
        contextKey: "retained-audit",
    });
    const args = { runId: f.runId, fixtureKey: "retained-audit" };
    const page = await f.t.query(
        internal.execution.fixtures.inspectQualificationPage,
        {
            ...args,
            kind: "captures",
            paginationOpts: { cursor: null, numItems: 32 },
        },
    );
    expect(page.page).toEqual(
        expect.arrayContaining([expect.objectContaining({ _id: f.captureId })]),
    );
    expect(
        await f.t.query(
            internal.execution.fixtures.qualificationSnapshot,
            args,
        ),
    ).toMatchObject({
        run: { _id: f.runId },
        accounting: {
            contextId,
            runId: f.runId,
            pending: 0,
            unknown: 0,
            overruns: 0,
        },
    });
    expect(await f.t.run((ctx) => ctx.db.get(contextId))).toMatchObject({
        status: "closed",
    });
    await expect(
        f.t.mutation(
            internal.execution.fixtures.authorizeWorkbenchQualification,
            {
                ...args,
                maximumRequests: 1,
                maximumCostUsd: 0.1,
            },
        ),
    ).rejects.toThrow("Active browser test context required");
    await expect(
        f.t.query(internal.execution.fixtures.qualificationSnapshot, {
            ...args,
            fixtureKey: "another-fixture",
        }),
    ).rejects.toThrow("Local simulation scope required");
    vi.stubEnv("CONVEX_CLOUD_URL", "https://example.convex.cloud");
    await expect(
        f.t.query(internal.execution.fixtures.qualificationSnapshot, args),
    ).rejects.toThrow("Local browser test slot required");
    vi.stubEnv("CONVEX_CLOUD_URL", "http://127.0.0.1:3210");
    vi.stubEnv("E2E_FIXTURES_ENABLED", "false");
    await expect(
        f.t.query(internal.execution.fixtures.qualificationSnapshot, args),
    ).rejects.toThrow("Local browser test slot required");
});
