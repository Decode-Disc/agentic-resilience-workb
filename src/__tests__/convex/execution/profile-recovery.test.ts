import { api, internal } from "@convex/_generated/api";
import { buildMissionContext } from "@convex/execution/context";
import { Harness } from "@earendil-works/pi-durable";
import { prepareQualificationModel } from "@evaluations/workbench-browser/model-preparation";
import { ConvexHttpClient } from "convex/browser";
import { convexToJson, type Value } from "convex/values";
import { afterEach, assert, expect, test, vi } from "vitest";
import { installModel } from "@/__tests__/setup/model-configuration";
import { nativePiFixtureRoute } from "@/__tests__/setup/pi-native";
import { seedWorkbench } from "@/__tests__/setup/workbench";

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

test.each([
    "missing",
    "byte-only",
] as const)("qualification refreshes %s profiles despite a compatible catalogue", async (state) => {
    const f = await seedWorkbench(
        false,
        undefined,
        60_000,
        undefined,
        undefined,
        11,
    );
    const installed = await installModel(f.t, nativePiFixtureRoute);
    vi.stubEnv("WORKBENCH_AGENT_ENABLED", "true");
    const original = await installed.admin.query(
        api.modelConfiguration.list,
        {},
    );
    expect(
        original.models.find((m) => m._id === installed.catalogId)?.compatible,
    ).toBe(true);
    await f.t.run(async (ctx) => {
        for (const profile of await ctx.db
            .query("nativeInputProfiles")
            .collect())
            if (state === "missing") await ctx.db.delete(profile._id);
            else
                await ctx.db.patch(profile._id, {
                    effectiveMaxOutputTokens: undefined,
                });
    });
    const args = {
        runId: f.runId,
        definitionId: "workbench_v1" as const,
        scope: { kind: "workbench_v1" as const },
        simulation: false,
    };
    if (state === "missing")
        await expect(
            f.t.mutation(internal.execution.conversations.startTurn, args),
        ).rejects.toThrow("model_input_profile_unavailable");
    vi.stubGlobal("fetch", () => {
        throw new Error("Profile preparation cannot dispatch inference");
    });
    const client = new ConvexHttpClient("http://127.0.0.1:3210", {
        logger: false,
        fetch: async (_url, init) => {
            const request: unknown = JSON.parse(String(init?.body));
            assert(request && typeof request === "object" && "path" in request);
            let value: Value;
            if (request.path === "modelConfiguration:list")
                value = await installed.admin.query(
                    api.modelConfiguration.list,
                    {},
                );
            else {
                expect(request.path).toBe(
                    "modelConfigurationActions:refreshProfiles",
                );
                assert("args" in request && Array.isArray(request.args));
                expect(request.args[0]).toEqual({
                    catalogId: installed.catalogId,
                    cursor: null,
                });
                value = await installed.admin.action(
                    api.modelConfigurationActions.refreshProfiles,
                    {
                        catalogId: installed.catalogId,
                        cursor: null,
                    },
                );
            }
            return Response.json({
                status: "success",
                value: convexToJson(value),
            });
        },
    });
    await prepareQualificationModel(client);
    const profiles = await f.t.run((ctx) =>
        ctx.db.query("nativeInputProfiles").collect(),
    );
    expect(profiles.length).toBeGreaterThan(0);
    expect(
        profiles.every(
            (profile) => (profile.effectiveMaxOutputTokens ?? 0) > 0,
        ),
    ).toBe(true);
    const active = await f.t.mutation(
        internal.execution.conversations.startTurn,
        args,
    );
    assert(active);
    expect(
        await f.t.run((ctx) => buildMissionContext(ctx, active.missionId, 1)),
    ).toMatchObject({ kind: "ready" });
    const after = await installed.admin.query(api.modelConfiguration.list, {});
    expect(after.assignments).toEqual(original.assignments);
    expect(
        after.models.find((m) => m._id === installed.catalogId)
            ?.currentRevisionId,
    ).toBe(
        original.models.find((m) => m._id === installed.catalogId)
            ?.currentRevisionId,
    );
    expect(
        await f.t.run((ctx) => ctx.db.query("providerCalls").collect()),
    ).toEqual([]);
});

test("refresh reuses retained exact profiles while the native serializer is unavailable, then restores a missing profile", async () => {
    const f = await seedWorkbench();
    const installed = await installModel(f.t, nativePiFixtureRoute);
    const before = await f.t.run(async (ctx) => ({
        profiles: await ctx.db.query("nativeInputProfiles").collect(),
        revisions: await ctx.db.query("modelRevisions").collect(),
    }));
    await f.t.run((ctx) =>
        ctx.db.patch(installed.catalogId, {
            preparedProfileCatalog: "prior-catalogue",
        }),
    );
    const serializer = vi
        .spyOn(Harness, "open")
        .mockRejectedValue(new Error("Native serializer unavailable"));
    await expect(
        installed.admin.action(api.modelConfigurationActions.refreshProfiles, {
            catalogId: installed.catalogId,
        }),
    ).resolves.toEqual({ isDone: true, continueCursor: null });
    expect(
        (
            await installed.admin.query(api.modelConfiguration.list, {})
        ).models.find((row) => row._id === installed.catalogId)?.compatible,
    ).toBe(true);
    expect(
        await f.t.run((ctx) => ctx.db.query("nativeInputProfiles").collect()),
    ).toEqual(before.profiles);
    serializer.mockRestore();
    const missing = before.profiles[0];
    assert(missing);
    await f.t.run((ctx) => ctx.db.delete(missing._id));
    await installed.admin.action(
        api.modelConfigurationActions.refreshProfiles,
        { catalogId: installed.catalogId },
    );
    const after = await f.t.run((ctx) =>
        ctx.db.query("nativeInputProfiles").collect(),
    );
    expect(
        after
            .map(({ key, bytes }) => ({ key, bytes }))
            .sort((a, b) => a.key.localeCompare(b.key)),
    ).toEqual(
        before.profiles
            .map(({ key, bytes }) => ({ key, bytes }))
            .sort((a, b) => a.key.localeCompare(b.key)),
    );
    expect(
        await f.t.run((ctx) => ctx.db.query("modelRevisions").collect()),
    ).toEqual(before.revisions);
});

test.each([
    false,
    true,
])("stored profiles refresh offline, including historical pins: %s", async (historical) => {
    const base = await seedWorkbench();
    vi.stubEnv("WORKBENCH_AGENT_ENABLED", "true");
    await installModel(base.t, nativePiFixtureRoute);
    const active = await base.t.mutation(
        internal.execution.conversations.startTurn,
        {
            runId: base.runId,
            definitionId: "workbench_v1",
            scope: { kind: "workbench_v1" },
            simulation: false,
        },
    );
    assert(active);
    const f = { ...base, ...active };
    const state = await f.t.run(async (ctx) => {
        const mission = await ctx.db.get(f.missionId);
        assert(mission?.modelRevisionId);
        const revision = await ctx.db.get(mission.modelRevisionId);
        assert(revision);
        const catalog = await ctx.db.get(revision.catalogId);
        assert(catalog);
        const { _id, _creationTime, ...fields } = catalog;
        Reflect.deleteProperty(fields, "preparedProfileCatalog");
        let latestRevision = revision;
        if (historical) {
            const {
                _id: _revisionId,
                _creationTime: _revisionTime,
                ...revisionFields
            } = revision;
            const latestId = await ctx.db.insert("modelRevisions", {
                ...revisionFields,
                revision: revision.revision + 1,
                descriptor: {
                    ...revision.descriptor,
                    maxTokens: revision.descriptor.maxTokens + 1,
                },
            });
            const latest = await ctx.db.get(latestId);
            assert(latest);
            latestRevision = latest;
            fields.currentRevisionId = latestId;
            fields.revision = latest.revision;
        }
        await ctx.db.replace(_id, fields);
        for (const profile of await ctx.db
            .query("nativeInputProfiles")
            .withIndex("by_key")
            .take(512))
            await ctx.db.delete(profile._id);
        await ctx.db.insert("nativeInputProfiles", {
            key: "retained-prior-toolset",
            bytes: 1000,
        });
        const admin = await ctx.db
            .query("invitations")
            .withIndex("by_slot_key", (q) => q.eq("slotKey", "admin"))
            .unique();
        const visitor = admin?.claimedByVisitorId
            ? await ctx.db.get(admin.claimedByVisitorId)
            : null;
        assert(visitor?.authUserId);
        return {
            revision,
            latestRevision,
            catalog: fields,
            catalogId: _id,
            adminId: visitor.authUserId,
            settings: await ctx.db.query("agentModelSettings").collect(),
            conversation: await ctx.db
                .query("agentConversations")
                .withIndex("by_run", (q) => q.eq("runId", f.runId))
                .unique(),
        };
    });
    const admin = f.t.withIdentity({ subject: state.adminId });
    expect(
        (await admin.query(api.modelConfiguration.list, {})).models.find(
            (row) => row._id === state.catalogId,
        )?.compatible,
    ).toBe(false);
    vi.stubGlobal("fetch", () => {
        throw new Error("Profile refresh cannot use network");
    });
    const result = await admin.action(
        api.modelConfigurationActions.refreshProfiles,
        { catalogId: state.catalogId },
    );
    expect(result.isDone).toBe(!historical);
    if (historical) {
        assert(result.continueCursor);
        await expect(
            f.t.run((ctx) => buildMissionContext(ctx, f.missionId, 1)),
        ).rejects.toThrow("model_input_profile_unavailable");
        expect(
            await admin.action(api.modelConfigurationActions.refreshProfiles, {
                catalogId: state.catalogId,
                cursor: result.continueCursor,
            }),
        ).toEqual({ isDone: true, continueCursor: null });
    } else expect(result.continueCursor).toBeNull();
    expect(
        await f.t.run((ctx) => buildMissionContext(ctx, f.missionId, 1)),
    ).toMatchObject({ kind: "ready" });
    expect(await f.t.run((ctx) => ctx.db.get(state.revision._id))).toEqual(
        state.revision,
    );
    expect(
        await f.t.run((ctx) => ctx.db.get(state.latestRevision._id)),
    ).toEqual(state.latestRevision);
    expect(
        await f.t.run((ctx) => ctx.db.query("agentModelSettings").collect()),
    ).toEqual(state.settings);
    expect(
        await f.t.run((ctx) =>
            ctx.db
                .query("agentConversations")
                .withIndex("by_run", (q) => q.eq("runId", f.runId))
                .unique(),
        ),
    ).toEqual(state.conversation);
    const after = (
        await admin.query(api.modelConfiguration.list, {})
    ).models.find((row) => row._id === state.catalogId);
    assert(after);
    expect(after).toMatchObject({
        compatible: true,
        revision: state.catalog.revision,
        enabled: state.catalog.enabled,
        workbenchSelectable: state.catalog.workbenchSelectable,
        currentRevisionId: state.latestRevision._id,
    });
    expect(
        await admin.action(api.modelConfigurationActions.refreshProfiles, {
            catalogId: state.catalogId,
        }),
    ).toEqual(result);
    await expect(
        f.t.action(api.modelConfigurationActions.refreshProfiles, {
            catalogId: state.catalogId,
        }),
    ).rejects.toThrow("Not authenticated");
    await expect(
        f.client.action(api.modelConfigurationActions.refreshProfiles, {
            catalogId: state.catalogId,
        }),
    ).rejects.toThrow("Unauthorized");
    await expect(
        admin.mutation(internal.modelConfiguration.retainRefreshedProfiles, {
            revisionId: state.revision._id,
            profileCatalog: "previous-toolset",
            profiles: [{ key: "stale-write", bytes: 100 }],
        }),
    ).rejects.toThrow("model_profile_version_conflict");
    expect(
        await f.t.run((ctx) =>
            ctx.db
                .query("nativeInputProfiles")
                .withIndex("by_key", (q) => q.eq("key", "stale-write"))
                .unique(),
        ),
    ).toBeNull();
    expect(
        await f.t.run((ctx) =>
            ctx.db
                .query("nativeInputProfiles")
                .withIndex("by_key", (q) =>
                    q.eq("key", "retained-prior-toolset"),
                )
                .unique(),
        ),
    ).toMatchObject({ bytes: 1000 });
});

test("initialization refreshes existing defaults offline and preserves administrative choices", async () => {
    const f = await seedWorkbench();
    const { INITIAL_MODEL_CATALOG } = await import(
        "@convex/integrations/modelRouting"
    );
    vi.stubGlobal("fetch", () => {
        throw new Error("Existing defaults cannot fetch provider metadata");
    });
    const first = await installModel(f.t, {
        ...nativePiFixtureRoute,
        model: INITIAL_MODEL_CATALOG[0].model,
    });
    const second = await installModel(f.t, {
        ...nativePiFixtureRoute,
        model: INITIAL_MODEL_CATALOG[1].model,
    });
    expect(
        await first.admin.action(api.modelConfigurationActions.initialize, {}),
    ).toEqual({ ready: true });
    const state = await f.t.run(async (ctx) => {
        const secondCatalog = await ctx.db.get(second.catalogId);
        assert(secondCatalog);
        await ctx.db.patch(second.catalogId, {
            enabled: false,
            workbenchSelectable: false,
        });
        const models = await ctx.db.query("modelCatalog").collect();
        for (const model of models) {
            const { _id, _creationTime, ...fields } = model;
            Reflect.deleteProperty(fields, "preparedProfileCatalog");
            await ctx.db.replace(_id, fields);
        }
        for (const profile of await ctx.db
            .query("nativeInputProfiles")
            .withIndex("by_key")
            .take(512))
            await ctx.db.delete(profile._id);
        return {
            models,
            settings: await ctx.db.query("agentModelSettings").collect(),
            revisions: await ctx.db.query("modelRevisions").collect(),
        };
    });
    expect(
        await first.admin.action(api.modelConfigurationActions.initialize, {}),
    ).toEqual({ ready: true });
    const after = await first.admin.query(api.modelConfiguration.list, {});
    expect(after.models.every((model) => model.compatible)).toBe(true);
    for (const model of state.models)
        expect(after.models.find((row) => row._id === model._id)).toMatchObject(
            model,
        );
    expect(
        await f.t.run((ctx) => ctx.db.query("agentModelSettings").collect()),
    ).toEqual(state.settings);
    expect(
        await f.t.run((ctx) => ctx.db.query("modelRevisions").collect()),
    ).toEqual(state.revisions);
});

test("refreshProfiles collapses contiguous identical-descriptor revisions and reaches distinct historical descriptors", async () => {
    const f = await seedWorkbench();
    const installed = await installModel(
        f.t,
        { ...nativePiFixtureRoute, reasoningEffort: "low" },
        "workbench",
        {
            reasoningEfforts: ["low", "medium", "high"],
            reasoningDefault: "medium",
        },
    );
    const catalog = await f.t.run((ctx) => ctx.db.get(installed.catalogId));
    assert(catalog?.currentRevisionId);
    const currentRevisionId = catalog.currentRevisionId;
    const baseRevision = await f.t.run((ctx) => ctx.db.get(currentRevisionId));
    assert(baseRevision);
    // Insert an older historical revision with a distinct descriptor below the current one.
    await f.t.run(async (ctx) => {
        const { _id, _creationTime, ...fields } = baseRevision;
        await ctx.db.insert("modelRevisions", {
            ...fields,
            revision: 0,
            descriptor: {
                ...baseRevision.descriptor,
                maxTokens: baseRevision.descriptor.maxTokens - 1024,
            },
        });
    });
    // Create 4 additional revisions via reasoning preference toggles (identical descriptor).
    let expectedRevision = catalog.revision;
    for (const [index, preference] of (
        ["high", "low", "medium", "recommended"] as const
    ).entries()) {
        const updated = await installed.admin.mutation(
            api.modelConfiguration.setReasoningPreference,
            {
                catalogId: installed.catalogId,
                expectedRevision,
                requestKey: `toggle-${index}`,
                preference,
            },
        );
        expectedRevision = updated.revision;
    }
    const totalRevisions = await f.t.run((ctx) =>
        ctx.db
            .query("modelRevisions")
            .withIndex("by_catalog_and_revision", (q) =>
                q.eq("catalogId", installed.catalogId),
            )
            .collect(),
    );
    expect(totalRevisions).toHaveLength(6);

    const page1 = await installed.admin.action(
        api.modelConfigurationActions.refreshProfiles,
        { catalogId: installed.catalogId, cursor: null },
    );
    expect(page1.isDone).toBe(false);
    assert(page1.continueCursor);

    const page2 = await installed.admin.action(
        api.modelConfigurationActions.refreshProfiles,
        { catalogId: installed.catalogId, cursor: page1.continueCursor },
    );
    expect(page2).toEqual({ isDone: true, continueCursor: null });
}, 30_000);

test("refreshProfiles advances strictly across the 128-revision scan boundary without truncation", async () => {
    const f = await seedWorkbench();
    const installed = await installModel(
        f.t,
        { ...nativePiFixtureRoute, reasoningEffort: "low" },
        "workbench",
        { reasoningEfforts: ["low", "medium"], reasoningDefault: "low" },
    );
    const catalog = await f.t.run((ctx) => ctx.db.get(installed.catalogId));
    assert(catalog?.currentRevisionId);
    const currentRevisionId = catalog.currentRevisionId;
    const current = await f.t.run((ctx) => ctx.db.get(currentRevisionId));
    assert(current);
    // Total identical revisions = 129 (1 existing + 128 inserted).
    await f.t.run(async (ctx) => {
        const { _id, _creationTime, ...fields } = current;
        let rev = current.revision;
        let lastId = current._id;
        for (let i = 0; i < 128; i++) {
            rev++;
            lastId = await ctx.db.insert("modelRevisions", {
                ...fields,
                revision: rev,
                reasoningEffort: i % 2 === 0 ? "medium" : "low",
            });
        }
        await ctx.db.patch(installed.catalogId, {
            revision: rev,
            currentRevisionId: lastId,
        });
    });

    const serializer = vi
        .spyOn(Harness, "open")
        .mockRejectedValue(
            new Error("Already retained profiles need no serializer"),
        );
    const page1 = await installed.admin.action(
        api.modelConfigurationActions.refreshProfiles,
        { catalogId: installed.catalogId, cursor: null },
    );
    expect(page1.isDone).toBe(false);
    assert(page1.continueCursor);
    const page2 = await installed.admin.action(
        api.modelConfigurationActions.refreshProfiles,
        { catalogId: installed.catalogId, cursor: page1.continueCursor },
    );
    expect(page2).toEqual({ isDone: true, continueCursor: null });
    expect(serializer).not.toHaveBeenCalled();
});

test("refreshProfiles preserves historical revisions whose reasoningEffort is outside advertised choices", async () => {
    const f = await seedWorkbench();
    const installed = await installModel(
        f.t,
        { ...nativePiFixtureRoute, reasoningEffort: "low" },
        "workbench",
        { reasoningEfforts: ["low", "medium"], reasoningDefault: "low" },
    );
    const catalog = await f.t.run((ctx) => ctx.db.get(installed.catalogId));
    assert(catalog?.currentRevisionId);
    const currentRevisionId = catalog.currentRevisionId;
    const current = await f.t.run((ctx) => ctx.db.get(currentRevisionId));
    assert(current);
    await f.t.run(async (ctx) => {
        const { _id, _creationTime, ...fields } = current;
        await ctx.db.insert("modelRevisions", {
            ...fields,
            revision: 0,
            reasoningEffort: "high",
        });
    });

    const page1 = await installed.admin.action(
        api.modelConfigurationActions.refreshProfiles,
        { catalogId: installed.catalogId, cursor: null },
    );
    expect(page1.isDone).toBe(false);
    assert(page1.continueCursor);
    const page2 = await installed.admin.action(
        api.modelConfigurationActions.refreshProfiles,
        { catalogId: installed.catalogId, cursor: page1.continueCursor },
    );
    expect(page2).toEqual({ isDone: true, continueCursor: null });
}, 30_000);

test("refreshProfiles rejects malformed continuation cursors", async () => {
    const f = await seedWorkbench();
    const installed = await installModel(f.t, nativePiFixtureRoute);
    await expect(
        installed.admin.action(api.modelConfigurationActions.refreshProfiles, {
            catalogId: installed.catalogId,
            cursor: "not-a-valid-cursor",
        }),
    ).rejects.toThrow("invalid_model_configuration");
});
