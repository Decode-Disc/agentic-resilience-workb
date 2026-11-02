import { api, internal } from "@convex/_generated/api";
import { afterEach, assert, expect, test, vi } from "vitest";
import { installModel } from "@/__tests__/setup/model-configuration";
import { seedWorkbench } from "@/__tests__/setup/workbench";

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
});

test("a dossier selection changes future responses without changing an admitted response's model", async () => {
    const { t, client, runId } = await seedWorkbench();
    vi.stubEnv("WORKBENCH_AGENT_ENABLED", "true");
    const first = await installModel(t, {
        model: "example/first",
        provider: "test",
    });
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
    const mission = await t.run((ctx) => ctx.db.get(active.missionId));
    assert(mission);
    expect(mission.modelRevisionId).toBeDefined();
    const selected = await client.query(api.workbench.models, { runId });
    expect(selected.selectedId).toBe(first.catalogId);
    const second = await installModel(t, {
        model: "example/second",
        provider: "test",
    });
    await client.mutation(api.workbench.setModel, {
        runId,
        catalogId: second.catalogId,
        expectedRevision: selected.revision,
        requestKey: "choose-second",
    });
    expect(
        (await client.query(api.workbench.models, { runId })).selectedId,
    ).toBe(second.catalogId);
    const preserved = await t.run((ctx) => ctx.db.get(active.missionId));
    expect(preserved?.modelRevisionId).toBe(mission.modelRevisionId);
    const modelRevisionId = mission.modelRevisionId;
    const effective = modelRevisionId
        ? await t.run((ctx) => ctx.db.get(modelRevisionId))
        : null;
    expect(effective?.model).toBe("example/first");
}, 30_000);

test("an administrator's new default does not change a dossier created with the earlier default", async () => {
    const { t, client, runId } = await seedWorkbench();
    const first = await installModel(t, {
        model: "example/original-default",
        provider: "test",
    });
    const preflightId = await t.run(async (ctx) => {
        const run = await ctx.db.get(runId);
        assert(run?.ownerVisitorId && run.companyId);
        return ctx.db.insert("companyPreflights", {
            ownerVisitorId: run.ownerVisitorId,
            companyId: run.companyId,
            query: "1818201",
            resolverVersion: "sec-company-v1",
            status: "resolved",
            expiresAt: Date.now() + 60000,
            createdAt: Date.now(),
        });
    });
    const created = await client.mutation(api.framing.confirmCompany, {
        preflightId,
        idempotencyKey: "new-default-dossier",
        coveragePreset: "balanced",
    });
    await installModel(t, { model: "example/later-default", provider: "test" });
    expect(
        (await client.query(api.workbench.models, { runId: created.runId }))
            .selectedId,
    ).toBe(first.catalogId);
}, 30_000);

test("default setup can be replayed without overwriting availability, assignments or dossier choices", async () => {
    const { t, client, runId } = await seedWorkbench();
    const first = await installModel(t, {
        model: "example/initial",
        provider: "test",
    });
    await first.admin.mutation(internal.modelConfiguration.initializePrepared, {
        catalogId: first.catalogId,
        primary: true,
    });
    const second = await installModel(t, {
        model: "example/replacement",
        provider: "test",
    });
    const config = await first.admin.query(api.modelConfiguration.list, {});
    const original = config.models.find(
        (model) => model._id === first.catalogId,
    );
    assert(original);
    await first.admin.mutation(api.modelConfiguration.updateAvailability, {
        catalogId: first.catalogId,
        expectedRevision: original.revision,
        enabled: false,
        workbenchSelectable: false,
        requestKey: "disable-initial",
    });
    await first.admin.mutation(internal.modelConfiguration.initializePrepared, {
        catalogId: first.catalogId,
        primary: true,
    });
    const current = await first.admin.query(api.modelConfiguration.list, {});
    expect(
        current.models.find((model) => model._id === first.catalogId)?.enabled,
    ).toBe(false);
    expect(
        current.assignments.find((setting) => setting.agent === "workbench")
            ?.catalogId,
    ).toBe(second.catalogId);
    expect(await client.query(api.workbench.models, { runId })).toMatchObject({
        selectedId: first.catalogId,
        available: false,
    });
    await expect(
        client.mutation(api.workbench.setModel, {
            runId,
            catalogId: first.catalogId,
            expectedRevision: 0,
            requestKey: "unavailable-choice",
        }),
    ).rejects.toThrow("model_unavailable");
}, 30_000);

test("effort is persisted per dossier and pinned independently for each response", async () => {
    const { t, client, runId } = await seedWorkbench();
    vi.stubEnv("WORKBENCH_AGENT_ENABLED", "true");
    const { catalogId } = await installModel(
        t,
        { model: "example/effort", provider: "test", reasoningEffort: "low" },
        "workbench",
        { reasoningEfforts: ["low", "high", "max"], reasoningMandatory: true },
    );
    const first = await t.mutation(internal.execution.conversations.startTurn, {
        runId,
        definitionId: "workbench_v1",
        scope: { kind: "workbench_v1" },
        simulation: false,
    });
    assert(first);
    const before = await client.query(api.workbench.models, { runId });
    expect(before).toMatchObject({
        effort: "low",
        effortChoices: ["low", "high", "max"],
    });
    const selection = {
        runId,
        catalogId,
        reasoningEffort: "high" as const,
        expectedRevision: before.revision,
        requestKey: "high-effort",
    };
    const changed = await client.mutation(api.workbench.setModel, selection);
    expect(await client.mutation(api.workbench.setModel, selection)).toEqual(
        changed,
    );
    expect(await client.query(api.workbench.models, { runId })).toMatchObject({
        effort: "high",
        revision: 1,
    });
    expect(
        await t.query(internal.modelConfiguration.forMission, {
            missionId: first.missionId,
        }),
    ).toMatchObject({ reasoningEffort: "low" });
    await client.mutation(api.execution.conversations.stopResponse, {
        runId,
        turnId: first.turnId,
    });
    await client.mutation(api.execution.conversations.submit, {
        runId,
        requestKey: "after-effort-change",
        text: "Continue with the saved program.",
        delivery: "queue",
    });
    await client.mutation(api.execution.conversations.resumeQueue, { runId });
    const next = await t.mutation(internal.execution.conversations.startTurn, {
        runId,
        definitionId: "workbench_v1",
        scope: { kind: "workbench_v1" },
        simulation: false,
    });
    assert(next);
    const effective = await t.query(internal.modelConfiguration.forMission, {
        missionId: next.missionId,
    });
    expect(effective).toMatchObject({ reasoningEffort: "high" });
    expect(
        await t.query(internal.execution.context.build, {
            missionId: next.missionId,
            expectedGeneration:
                (await t.run((ctx) => ctx.db.get(next.missionId)))
                    ?.generation ?? 0,
        }),
    ).toMatchObject({ kind: "ready" });
    await expect(
        client.mutation(api.workbench.setModel, {
            ...selection,
            reasoningEffort: "medium",
            expectedRevision: 1,
            requestKey: "unsupported-effort",
        }),
    ).rejects.toThrow("model_effort_unavailable");
    expect(await client.query(api.workbench.models, { runId })).toMatchObject({
        effort: "high",
        revision: 1,
    });
    expect(
        await t.run((ctx) => ctx.db.query("providerCalls").collect()),
    ).toEqual([]);
}, 30_000);

test("a refreshed model cannot strand a response when the saved effort is no longer supported", async () => {
    const { t, client, runId } = await seedWorkbench();
    vi.stubEnv("WORKBENCH_AGENT_ENABLED", "true");
    const route = {
        model: "example/refreshed-effort",
        provider: "test",
        reasoningEffort: "low" as const,
    };
    const { admin, catalogId } = await installModel(t, route, "workbench", {
        reasoningEfforts: ["low", "high"],
        reasoningMandatory: true,
    });
    await client.mutation(api.workbench.setModel, {
        runId,
        catalogId,
        reasoningEffort: "high",
        expectedRevision: 0,
        requestKey: "high-before-refresh",
    });
    const first = await t.mutation(internal.execution.conversations.startTurn, {
        runId,
        definitionId: "workbench_v1",
        scope: { kind: "workbench_v1" },
        simulation: false,
    });
    assert(first);
    const configured = await t.query(internal.modelConfiguration.forMission, {
        missionId: first.missionId,
    });
    assert(configured);
    const descriptor = {
        ...configured.descriptor,
        reasoningEfforts: ["low" as const],
        reasoningDefault: "low" as const,
    };
    const current = (
        await admin.query(api.modelConfiguration.list, {})
    ).models.find((model) => model._id === catalogId);
    assert(current);
    const pending = await admin.mutation(
        internal.modelConfiguration.beginPreparation,
        {
            model: route.model,
            provider: route.provider,
            label: "Refreshed",
            requestKey: "refresh-efforts",
            expectedRevision: current.revision,
        },
    );
    const { prepareNativeProfiles } = await import(
        "@convex/integrations/piModelProfiles"
    );
    await admin.mutation(internal.modelConfiguration.finishPreparation, {
        catalogId,
        revision: pending.revision,
        descriptor,
        profiles: await prepareNativeProfiles(route, descriptor),
    });
    await admin.mutation(api.modelConfiguration.updateAvailability, {
        catalogId,
        expectedRevision: pending.revision,
        enabled: true,
        workbenchSelectable: true,
        requestKey: "enable-refreshed",
    });
    expect(
        await t.query(internal.modelConfiguration.forMission, {
            missionId: first.missionId,
        }),
    ).toMatchObject({ reasoningEffort: "high" });
    await client.mutation(api.execution.conversations.stopResponse, {
        runId,
        turnId: first.turnId,
    });
    await client.mutation(api.execution.conversations.submit, {
        runId,
        requestKey: "after-refresh",
        text: "Continue.",
        delivery: "queue",
    });
    await client.mutation(api.execution.conversations.resumeQueue, { runId });
    const next = await t.mutation(internal.execution.conversations.startTurn, {
        runId,
        definitionId: "workbench_v1",
        scope: { kind: "workbench_v1" },
        simulation: false,
    });
    assert(next);
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(10), 500);
    expect(await t.run((ctx) => ctx.db.get(next.missionId))).toMatchObject({
        status: "blocked",
        blockCode: "missing_authorized_route",
    });
    expect(
        await t.run((ctx) => ctx.db.query("providerCalls").collect()),
    ).toEqual([]);
    expect(await client.query(api.workbench.models, { runId })).toMatchObject({
        effort: "high",
        effortChoices: ["low"],
    });
}, 30_000);

test("the research composer can inspect prepared choices before a dossier exists", async () => {
    const { t } = await seedWorkbench();
    const model = await installModel(t, {
        model: "example/preflight",
        provider: "test",
    });
    await expect(t.query(api.workbench.models, {})).rejects.toThrow(
        "unauthorized",
    );
    const anonymousId = await t.run((ctx) =>
        ctx.db.insert("users", { isAnonymous: true }),
    );
    const choices = await t
        .withIdentity({ subject: anonymousId })
        .query(api.workbench.models, {});
    expect(
        choices.choices.find((choice) => choice.id === model.catalogId),
    ).toMatchObject({
        id: model.catalogId,
        effortChoices: expect.any(Array),
    });
});

test("company confirmation retains the chosen model before the initial framing turn and rejects changed retry choices", async () => {
    const { t, client, runId } = await seedWorkbench();
    const selected = await installModel(
        t,
        { model: "example/chosen", provider: "test" },
        "workbench",
        { reasoningEfforts: ["low", "high"], reasoningDefault: "low" },
    );
    const other = await installModel(t, {
        model: "example/default",
        provider: "test",
    });
    const preflightId = await t.run(async (ctx) => {
        const run = await ctx.db.get(runId);
        assert(run?.ownerVisitorId && run.companyId);
        return ctx.db.insert("companyPreflights", {
            ownerVisitorId: run.ownerVisitorId,
            companyId: run.companyId,
            query: "1818201",
            resolverVersion: "sec-company-v1",
            status: "resolved",
            expiresAt: Date.now() + 60000,
            createdAt: Date.now(),
        });
    });
    const args = {
        preflightId,
        idempotencyKey: "chosen-in-research-composer",
        coveragePreset: "balanced" as const,
        modelSelection: {
            catalogId: selected.catalogId,
            reasoningEffort: "high" as const,
        },
    };
    const runsBefore = await t.run((ctx) =>
        ctx.db.query("researchRuns").collect(),
    );
    await expect(
        client.mutation(api.framing.confirmCompany, {
            ...args,
            idempotencyKey: "unsupported-initial-effort",
            modelSelection: {
                catalogId: selected.catalogId,
                reasoningEffort: "medium",
            },
        }),
    ).rejects.toThrow("model_effort_unavailable");
    expect(
        await t.run((ctx) => ctx.db.query("researchRuns").collect()),
    ).toEqual(runsBefore);
    const created = await client.mutation(api.framing.confirmCompany, args);
    expect(
        await client.query(api.workbench.models, { runId: created.runId }),
    ).toMatchObject({ selectedId: selected.catalogId, effort: "high" });
    expect(await client.mutation(api.framing.confirmCompany, args)).toEqual(
        created,
    );
    await expect(
        client.mutation(api.framing.confirmCompany, {
            ...args,
            modelSelection: { catalogId: other.catalogId },
        }),
    ).rejects.toThrow("message_identity_conflict");
    const conversation = await t.run((ctx) =>
        ctx.db
            .query("agentConversations")
            .withIndex("by_run", (q) => q.eq("runId", created.runId))
            .unique(),
    );
    expect(conversation?.modelCatalogId).toBe(selected.catalogId);
    expect(conversation?.reasoningEffort).toBe("high");
});
