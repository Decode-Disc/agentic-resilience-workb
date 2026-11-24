import { api, internal } from "@convex/_generated/api";
import { afterEach, expect, test, vi } from "vitest";
import workflowTest from "@/__tests__/convex/workflows/workflow-test-register.js";
import { seedSourcePreparation } from "@/__tests__/setup/source-preparation";

test("ordinary workspace excludes evaluations while preserving real reservations with similar keys", async () => {
    const f = await seedSourcePreparation();
    const ids = await f.t.run(async (ctx) => {
        const fields = {
            ownerVisitorId: f.visitorId,
            companyId: f.companyId,
            lifecycleState: "awaiting_source_review" as const,
            executionStatus: "paused" as const,
            executionGeneration: 1,
            nextEventSequence: 1,
            createdAt: 1,
            updatedAt: 2,
        };
        const evaluation = await ctx.db.insert("researchRuns", {
            purpose: "evaluation",
            ...fields,
            reservationKey: "retrieval-evaluation:study-clone",
        });
        const research = await ctx.db.insert("researchRuns", {
            purpose: "research",
            ...fields,
            reservationKey: "retrieval-evaluation:caller-controlled-key",
            reservationStatus: "consumed",
        });
        return { evaluation, research };
    });
    const analyst = f.t.withIdentity({
        subject: `${f.userId}|workspace-session`,
    });
    const visitor = await analyst.query(api.visitors.current, {});
    if (!visitor?.workspace) throw new Error("Expected admitted workspace");
    const runs = await analyst.query(api.researchRuns.listMine, {
        workspaceKey: visitor.workspace.key,
        paginationOpts: { numItems: 10, cursor: null },
    });
    expect(runs.page.map((run) => run.runId).sort()).toEqual(
        [f.runId, ids.research].sort(),
    );
    await expect(
        analyst.query(api.researchRuns.getMine, { runId: ids.evaluation }),
    ).rejects.toThrow("Unauthorized");
    await expect(
        analyst.query(api.researchRuns.listMyEvents, { runId: ids.evaluation }),
    ).rejects.toThrow("Unauthorized");
    expect(await f.t.run((ctx) => ctx.db.get(f.visitorId))).toMatchObject({
        analysesReserved: 1,
    });
});

test("technical dossier ownership does not authorize source reads or decisions", async () => {
    const f = await seedSourcePreparation();
    await f.t.run((ctx) => ctx.db.patch(f.runId, { purpose: "evaluation" }));
    const analyst = f.t.withIdentity({
        subject: `${f.userId}|workspace-session`,
    });
    await expect(
        analyst.query(api.sources.getReviewSummary, {
            runId: f.runId,
            corpusRevisionId: f.corpusRevisionId,
        }),
    ).rejects.toThrow("Unauthorized");
    await expect(
        analyst.mutation(api.sources.decide, {
            runId: f.runId,
            corpusRevisionId: f.corpusRevisionId,
            sourceId: f.sourceId,
            decision: "accepted",
            decisionKey: "not-a-real-research-decision",
        }),
    ).rejects.toThrow("not_authorized");
    expect(
        await f.t.run((ctx) => ctx.db.query("sourceDecisions").collect()),
    ).toHaveLength(1);
});

afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
});

test("the reserved browser account cannot be rebound while local fixtures are disabled", async () => {
    const f = await seedSourcePreparation();
    await f.t.run((ctx) =>
        ctx.db.patch(f.invitationId, { slotKey: "analyst-4" }),
    );
    const other = await f.t.run((ctx) =>
        ctx.db.insert("users", { isAnonymous: true }),
    );
    await expect(
        f.t.mutation(internal.invitations.claimDigest, {
            codeDigest: "source-preparation-test-digest",
            authUserId: other,
        }),
    ).rejects.toThrow("Access code is not available");
    expect(await f.t.run((ctx) => ctx.db.get(f.visitorId))).toMatchObject({
        authUserId: f.userId,
    });
});

test("browser fixture creation requires a privately bound test context after real admission", async () => {
    vi.useFakeTimers();
    vi.stubEnv("E2E_FIXTURES_ENABLED", "true");
    vi.stubEnv("CONVEX_CLOUD_URL", "http://127.0.0.1:3210");
    const f = await seedSourcePreparation();
    workflowTest.register(f.t);
    await f.t.run(async (ctx) => {
        await ctx.db.patch(f.invitationId, { slotKey: "analyst-4" });
        await ctx.db.patch(f.runId, { executionStatus: "paused" });
    });
    try {
        await expect(
            f.t.mutation(internal.e2eFixtures.seedSourceReviewScenario, {
                slotKey: "analyst-4",
                fixtureKey: "missing-context",
            }),
        ).rejects.toThrow("Active browser test context required");
    } finally {
        vi.useRealTimers();
    }
});

test("administrative restoration cannot refund a technical fixture against a human quota", async () => {
    const f = await seedSourcePreparation();
    await f.t.run(async (ctx) => {
        await ctx.db.patch(f.visitorId, { role: "admin" });
        await ctx.db.patch(f.runId, {
            purpose: "browser_test",
            reservationStatus: "consumed",
            lifecycleState: "draft",
            executionStatus: "idle",
        });
    });
    const admin = f.t.withIdentity({ subject: `${f.userId}|admin-session` });
    await expect(
        admin.mutation(api.admin.restoreQuota, {
            runId: f.runId,
            reason: "A technical fixture must not restore research capacity.",
        }),
    ).rejects.toThrow("Only research reservations");
    expect(await f.t.run((ctx) => ctx.db.get(f.visitorId))).toMatchObject({
        analysesReserved: 1,
    });
});

test("browser test executions cannot reserve real external provider work", async () => {
    const f = await seedSourcePreparation();
    await f.t.run((ctx) => ctx.db.patch(f.runId, { purpose: "browser_test" }));
    await expect(
        f.t.mutation(internal.providerCalls.recordAttempt, {
            runId: f.runId,
            executionGeneration: 3,
            service: "exa",
            operation: "search",
            operationKey: "browser-must-not-dispatch",
            status: "started",
            attempt: 1,
        }),
    ).rejects.toThrow("paid_work_disabled");
    expect(
        await f.t.run((ctx) => ctx.db.query("providerCalls").collect()),
    ).toEqual([]);
});

test("a browser context isolates fixtures, requires explicit rebinding and fences teardown", async () => {
    vi.useFakeTimers();
    vi.stubEnv("E2E_FIXTURES_ENABLED", "true");
    vi.stubEnv("CONVEX_CLOUD_URL", "http://127.0.0.1:3210");
    const f = await seedSourcePreparation();
    workflowTest.register(f.t);
    await f.t.run(async (ctx) => {
        await ctx.db.patch(f.invitationId, { slotKey: "analyst-4" });
        await ctx.db.patch(f.runId, {
            purpose: "research",
            executionStatus: "paused",
        });
    });
    const contextArgs = {
        slotKey: "analyst-4",
        contextKey: "scope-one",
        durationMs: 60_000,
    };
    const contextId = await f.t.mutation(
        internal.runWorkspace.openBrowserTestContext,
        contextArgs,
    );
    const seeded = await f.t.mutation(
        internal.e2eFixtures.seedSourceReviewScenario,
        { slotKey: "analyst-4", fixtureKey: "scope-one-fixture" },
    );
    const actor = f.t.withIdentity({ subject: `${f.userId}|browser-session` });
    expect(
        await actor.query(api.researchRuns.getMine, { runId: seeded.runId }),
    ).toMatchObject({ runId: seeded.runId });
    expect(await actor.query(api.visitors.current, {})).toMatchObject({
        workspace: { isTestData: true, canStartDossier: false, contextId },
    });
    await expect(
        actor.query(api.researchRuns.getMine, { runId: f.runId }),
    ).rejects.toThrow("Unauthorized");
    const newUser = await f.t.run((ctx) =>
        ctx.db.insert("users", { isAnonymous: true }),
    );
    await f.t.mutation(internal.invitations.claimDigest, {
        codeDigest: "source-preparation-test-digest",
        authUserId: newUser,
    });
    const rebound = f.t.withIdentity({
        subject: `${newUser}|new-browser-session`,
    });
    await expect(
        rebound.query(api.researchRuns.getMine, { runId: seeded.runId }),
    ).rejects.toThrow("Unauthorized");
    expect(
        await f.t.mutation(
            internal.runWorkspace.openBrowserTestContext,
            contextArgs,
        ),
    ).toBe(contextId);
    expect(
        await rebound.query(api.researchRuns.getMine, { runId: seeded.runId }),
    ).toMatchObject({ runId: seeded.runId });
    await f.t.mutation(internal.runWorkspace.closeBrowserTestContext, {
        slotKey: "analyst-4",
        contextKey: "scope-one",
    });
    await expect(
        rebound.query(api.researchRuns.getMine, { runId: seeded.runId }),
    ).rejects.toThrow("Unauthorized");
    expect(await f.t.run((ctx) => ctx.db.get(seeded.runId))).toMatchObject({
        purpose: "browser_test",
        browserTestContextId: contextId,
        executionStatus: "cancelled",
    });
    expect(await f.t.run((ctx) => ctx.db.get(f.visitorId))).toMatchObject({
        analysesReserved: 1,
    });
    await f.t.mutation(internal.runWorkspace.openBrowserTestContext, {
        ...contextArgs,
        contextKey: "scope-two",
    });
    const fresh = await f.t.mutation(
        internal.e2eFixtures.seedSourceReviewScenario,
        { slotKey: "analyst-4", fixtureKey: "scope-one-fixture" },
    );
    expect(fresh.runId).not.toBe(seeded.runId);
    await f.t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(1000));
});

test("workspace pagination excludes technical history on every page and rejects stale scope keys", async () => {
    const f = await seedSourcePreparation();
    await f.t.run(async (ctx) => {
        await ctx.db.patch(f.runId, { purpose: "research", updatedAt: 1 });
        const fields = {
            ownerVisitorId: f.visitorId,
            purpose: "research" as const,
            lifecycleState: "draft" as const,
            executionStatus: "idle" as const,
            executionGeneration: 1,
            nextEventSequence: 1,
            createdAt: 1,
            updatedAt: 2,
        };
        await ctx.db.insert("researchRuns", {
            ...fields,
            purpose: "evaluation",
            updatedAt: 100,
        });
        await ctx.db.insert("researchRuns", fields);
    });
    const actor = f.t.withIdentity({
        subject: `${f.userId}|workspace-session`,
    });
    const visitor = await actor.query(api.visitors.current, {});
    if (!visitor?.workspace) throw new Error("Expected admitted workspace");
    const args = {
        workspaceKey: visitor.workspace.key,
        paginationOpts: { numItems: 1, cursor: null },
    };
    const first = await actor.query(api.researchRuns.listMine, args);
    expect(first.page).toHaveLength(1);
    const second = await actor.query(api.researchRuns.listMine, {
        ...args,
        paginationOpts: { numItems: 1, cursor: first.continueCursor },
    });
    expect(second.page.map((run) => run.runId)).toEqual([f.runId]);
    const stale = await actor.query(api.researchRuns.listMine, {
        ...args,
        workspaceKey: "browser_test:previous-context",
    });
    expect(stale).toMatchObject({ page: [], isDone: true });
});

test("only administrators can page technical runs and inspect their receipts", async () => {
    const f = await seedSourcePreparation();
    await f.t.run((ctx) => ctx.db.patch(f.runId, { purpose: "evaluation" }));
    const actor = f.t.withIdentity({
        subject: `${f.userId}|inspection-session`,
    });
    const args = {
        purpose: "evaluation" as const,
        paginationOpts: { numItems: 1, cursor: null },
    };
    await expect(
        actor.query(api.adminOperations.listRunsPage, args),
    ).rejects.toThrow("Unauthorized");
    await f.t.run((ctx) => ctx.db.patch(f.visitorId, { role: "admin" }));
    expect(
        await actor.query(api.adminOperations.listRunsPage, args),
    ).toMatchObject({ page: [{ runId: f.runId, purpose: "evaluation" }] });
    expect(
        await actor.query(api.adminOperations.inspectRun, { runId: f.runId }),
    ).toMatchObject({ run: { _id: f.runId, purpose: "evaluation" } });
    expect(
        await actor.query(api.adminOperations.listRestorableRunsPage, {
            paginationOpts: { numItems: 5, cursor: null },
        }),
    ).toMatchObject({ page: [] });
});

test("the reserved browser principal cannot initiate unscoped company search", async () => {
    const f = await seedSourcePreparation();
    await f.t.run((ctx) =>
        ctx.db.patch(f.invitationId, { slotKey: "analyst-4" }),
    );
    const actor = f.t.withIdentity({ subject: `${f.userId}|browser-search` });
    await expect(
        actor.action(api.companyResolution.search, { query: "ServiceNow" }),
    ).rejects.toThrow("paid_work_disabled");
    expect(
        await f.t.run((ctx) => ctx.db.query("providerCalls").collect()),
    ).toEqual([]);
});

test("the admin pagination fixture supplies its own bounded population without research reservations", async () => {
    vi.useFakeTimers();
    vi.stubEnv("E2E_FIXTURES_ENABLED", "true");
    vi.stubEnv("CONVEX_CLOUD_URL", "http://127.0.0.1:3210");
    const f = await seedSourcePreparation();
    await f.t.run((ctx) =>
        ctx.db.patch(f.invitationId, { slotKey: "analyst-4" }),
    );
    await f.t.mutation(internal.runWorkspace.openBrowserTestContext, {
        slotKey: "analyst-4",
        contextKey: "pagination-test",
        durationMs: 60_000,
    });
    const args = { fixtureKey: "admin-pagination" };
    const population = await f.t.mutation(
        internal.e2eFixtures.seedAdministrationPaginationScenario,
        args,
    );
    expect(population.evaluationRunIds).toHaveLength(40);
    expect(population.browserRunIds).toHaveLength(20);
    expect(
        new Set([...population.evaluationRunIds, ...population.browserRunIds])
            .size,
    ).toBe(60);
    expect(
        await f.t.mutation(
            internal.e2eFixtures.seedAdministrationPaginationScenario,
            args,
        ),
    ).toEqual(population);
    const adminUserId = await f.t.run(async (ctx) => {
        const userId = await ctx.db.insert("users", { isAnonymous: true });
        const invitationId = await ctx.db.insert("invitations", {
            slotKey: "admin",
            role: "admin",
            codeDigest: "pagination-admin",
            status: "claimed",
            createdAt: 1,
        });
        const visitorId = await ctx.db.insert("visitors", {
            invitationId,
            authUserId: userId,
            role: "admin",
            status: "active",
            analysesReserved: 0,
            admittedAt: 1,
        });
        await ctx.db.patch(invitationId, { claimedByVisitorId: visitorId });
        return userId;
    });
    const admin = f.t.withIdentity({
        subject: `${adminUserId}|pagination-admin`,
    });
    const first = await admin.query(api.adminOperations.listRunsPage, {
        purpose: "evaluation",
        paginationOpts: { numItems: 20, cursor: null },
    });
    const second = await admin.query(api.adminOperations.listRunsPage, {
        purpose: "evaluation",
        paginationOpts: { numItems: 20, cursor: first.continueCursor },
    });
    expect(first.page).toHaveLength(20);
    expect(second.page).toHaveLength(20);
    expect(
        [...first.page, ...second.page].map((run) => run.runId).sort(),
    ).toEqual([...population.evaluationRunIds].sort());
    const browser = await admin.query(api.adminOperations.listRunsPage, {
        purpose: "browser_test",
        paginationOpts: { numItems: 20, cursor: null },
    });
    expect(browser.page.map((run) => run.runId).sort()).toEqual(
        [...population.browserRunIds].sort(),
    );
    expect(await f.t.run((ctx) => ctx.db.get(f.visitorId))).toMatchObject({
        analysesReserved: 1,
    });
    expect(
        await f.t.run((ctx) => ctx.db.query("providerCalls").collect()),
    ).toEqual([]);
    await f.t.mutation(internal.runWorkspace.closeBrowserTestContext, {
        slotKey: "analyst-4",
        contextKey: "pagination-test",
    });
    await expect(
        f.t.mutation(
            internal.e2eFixtures.seedAdministrationPaginationScenario,
            args,
        ),
    ).rejects.toThrow("Active browser test context required");
    await f.t.finishAllScheduledFunctions(vi.runAllTimers);
});

type WorkspaceTestClient = Awaited<
    ReturnType<typeof seedSourcePreparation>
>["t"];

/** Seeds a dedicated administrator slot so withdrawal runs against real human analyst state. */
async function seedWithdrawalAdministrator(t: WorkspaceTestClient) {
    const adminUserId = await t.run((ctx) =>
        ctx.db.insert("users", { isAnonymous: true }),
    );
    await t.run(async (ctx) => {
        const invitationId = await ctx.db.insert("invitations", {
            slotKey: "withdrawal-test-admin",
            role: "admin",
            codeDigest: "withdrawal-test-admin-digest",
            status: "claimed",
            createdAt: 1,
        });
        const visitorId = await ctx.db.insert("visitors", {
            authUserId: adminUserId,
            invitationId,
            role: "admin",
            status: "active",
            analysesReserved: 0,
            admittedAt: 1,
        });
        await ctx.db.patch(invitationId, {
            claimedByVisitorId: visitorId,
        });
    });
    return {
        admin: t.withIdentity({ subject: `${adminUserId}|admin-session` }),
    };
}

test("administrative withdrawal blocks Start, resume and checkpoint retry", async () => {
    const f = await seedSourcePreparation();
    const { admin } = await seedWithdrawalAdministrator(f.t);
    await f.t.run((ctx) =>
        ctx.db.patch(f.runId, {
            reservationStatus: "consumed",
            lifecycleState: "awaiting_source_review",
            executionStatus: "failed",
            workflowId: "withdrawn-workflow",
            pauseReason: "source_review",
            executionGeneration: 2,
        }),
    );
    await expect(
        admin.mutation(api.admin.withdrawDossier, {
            runId: f.runId,
            reason: "Withdraw the abandoned dossier before relaunching",
        }),
    ).resolves.toEqual({ withdrawn: true });
    const analyst = f.t.withIdentity({
        subject: `${f.userId}|workspace-session`,
    });
    await expect(
        analyst.mutation(api.framing.startResearch, {
            runId: f.runId,
            expectedRevision: 1,
            requestKey: "withdrawn-start",
        }),
    ).rejects.toThrow("not_authorized");
    await expect(
        analyst.mutation(api.execution.researchControl.resume, {
            runId: f.runId,
            expectedGeneration: 2,
        }),
    ).rejects.toThrow("not_authorized");
    await expect(
        analyst.mutation(api.workflowControls.retry, { runId: f.runId }),
    ).rejects.toThrow("A withdrawn dossier cannot be resumed");
    expect(await f.t.run((ctx) => ctx.db.get(f.visitorId))).toMatchObject({
        analysesReserved: 0,
    });
});

test("a withdrawn dossier leaves the ordinary workspace list but stays readable directly", async () => {
    const f = await seedSourcePreparation();
    const { admin } = await seedWithdrawalAdministrator(f.t);
    await f.t.run((ctx) =>
        ctx.db.patch(f.runId, {
            reservationStatus: "consumed",
            lifecycleState: "completed",
            executionStatus: "completed",
        }),
    );
    const analyst = f.t.withIdentity({
        subject: `${f.userId}|workspace-session`,
    });
    const visitor = await analyst.query(api.visitors.current, {});
    if (!visitor?.workspace) throw new Error("Expected admitted workspace");
    const listArgs = {
        workspaceKey: visitor.workspace.key,
        paginationOpts: { numItems: 10, cursor: null },
    };
    const before = await analyst.query(api.researchRuns.listMine, listArgs);
    expect(before.page).toHaveLength(1);
    await expect(
        admin.mutation(api.admin.withdrawDossier, {
            runId: f.runId,
            reason: "Completed dossier releases its human research seat",
        }),
    ).resolves.toEqual({ withdrawn: true });
    const after = await analyst.query(api.researchRuns.listMine, {
        workspaceKey: visitor.workspace.key,
        paginationOpts: { numItems: 10, cursor: null },
    });
    expect(after.page).toHaveLength(0);
    expect(after.isDone).toBe(true);
    await expect(
        analyst.query(api.researchRuns.getMine, { runId: f.runId }),
    ).resolves.toMatchObject({ runId: f.runId });
    expect(await f.t.run((ctx) => ctx.db.get(f.visitorId))).toMatchObject({
        analysesReserved: 0,
    });
});
