import { api, internal } from "@convex/_generated/api";
import {
    INITIAL_MODEL_CATALOG,
    NATIVE_PROFILE_CATALOG,
} from "@convex/integrations/modelRouting";
import schema from "@convex/schema";
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";

afterEach(() => vi.unstubAllGlobals());

async function setup() {
    const t = convexTest(schema, import.meta.glob("/convex/**/*.ts"));
    const userId = await t.run(async (ctx) => {
        const userId = await ctx.db.insert("users", { isAnonymous: true });
        const invitationId = await ctx.db.insert("invitations", {
            slotKey: "admin",
            role: "admin",
            codeDigest: "model-admin",
            status: "claimed",
            createdAt: 1,
        });
        const visitorId = await ctx.db.insert("visitors", {
            authUserId: userId,
            invitationId,
            role: "admin",
            status: "active",
            analysesReserved: 0,
            admittedAt: 1,
        });
        await ctx.db.patch(invitationId, { claimedByVisitorId: visitorId });
        return userId;
    });
    return { t, admin: t.withIdentity({ subject: userId }) };
}

test("only an admitted administrator can inspect the model catalogue", async () => {
    const { t, admin } = await setup();
    await expect(t.query(api.modelConfiguration.list, {})).rejects.toThrow(
        "Not authenticated",
    );
    expect(await admin.query(api.modelConfiguration.list, {})).toMatchObject({
        models: [],
        assignments: [],
    });
});

test("revoking the administrator invitation prevents catalogue access", async () => {
    const { t, admin } = await setup();
    await t.run(async (ctx) => {
        const invitation = await ctx.db.query("invitations").first();
        if (!invitation) throw new Error("Missing admitted administrator");
        await ctx.db.patch(invitation._id, { status: "revoked" });
    });
    await expect(admin.query(api.modelConfiguration.list, {})).rejects.toThrow(
        "Unauthorized",
    );
});

test("a prepared model can be enabled and assigned without a code-defined route", async () => {
    const { t, admin } = await setup();
    const added = await admin.mutation(
        internal.modelConfiguration.beginPreparation,
        {
            model: "example/administrable-model",
            provider: "example-provider",
            label: "Administrable model",
            requestKey: "prepare-one",
        },
    );
    const saved = await admin.mutation(
        internal.modelConfiguration.finishPreparation,
        {
            catalogId: added.catalogId,
            revision: added.revision,
            descriptor: {
                contextWindow: 131072,
                maxTokens: 8192,
                reasoning: true,
                inputPrice: 0.03,
                outputPrice: 0.1,
                cacheReadPrice: 0.01,
                structuredOutputs: true,
            },
            profileCatalog: NATIVE_PROFILE_CATALOG,
            profiles: [{ key: "profile-one", bytes: 1000 }],
        },
    );
    await admin.mutation(api.modelConfiguration.updateAvailability, {
        catalogId: added.catalogId,
        expectedRevision: saved.revision,
        enabled: true,
        workbenchSelectable: true,
        requestKey: "enable-one",
    });
    await admin.mutation(api.modelConfiguration.assign, {
        agent: "workbench",
        catalogId: added.catalogId,
        expectedRevision: 0,
        requestKey: "assign-one",
    });
    const config = await admin.query(api.modelConfiguration.list, {});
    expect(config.models).toMatchObject([
        {
            model: "example/administrable-model",
            enabled: true,
            workbenchSelectable: true,
            status: "ready",
        },
    ]);
    expect(config.assignments).toMatchObject([
        { agent: "workbench", catalogId: added.catalogId },
    ]);
    expect(
        await t.run((ctx) => ctx.db.query("providerCalls").collect()),
    ).toEqual([]);
});

test("a lost preparation acknowledgement can be replayed without duplicating its revision", async () => {
    const { t, admin } = await setup();
    const added = await admin.mutation(
        internal.modelConfiguration.beginPreparation,
        {
            model: "example/replay",
            provider: "example-provider",
            label: "Replay",
            requestKey: "prepare-replay",
        },
    );
    const input = {
        catalogId: added.catalogId,
        revision: added.revision,
        descriptor: {
            contextWindow: 131072,
            maxTokens: 8192,
            reasoning: true,
            inputPrice: 0.03,
            outputPrice: 0.1,
            cacheReadPrice: 0.01,
            structuredOutputs: true,
        },
        profileCatalog: NATIVE_PROFILE_CATALOG,
        profiles: [{ key: "replay-profile", bytes: 1000 }],
    };
    const first = await admin.mutation(
        internal.modelConfiguration.finishPreparation,
        input,
    );
    expect(
        await admin.mutation(
            internal.modelConfiguration.finishPreparation,
            input,
        ),
    ).toEqual(first);
    expect(
        await t.run((ctx) => ctx.db.query("modelRevisions").collect()),
    ).toHaveLength(1);
});

test.each([
    4096, 8192,
])("administrative import prepares a model absent from Pi's bundled catalogue with %i declared output tokens and no inference", async (maxTokens) => {
    const { t, admin } = await setup();
    const model = "example/new-runtime-model";
    const fetch = vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url === "https://openrouter.ai/api/v1/models")
            return Response.json({
                data: [
                    {
                        id: model,
                        reasoning: {
                            supported_efforts: ["max", "high", "low"],
                            default_effort: "max",
                            mandatory: true,
                        },
                        context_length: 131072,
                        pricing: {
                            prompt: "0.00000003",
                            completion: "0.0000001",
                            input_cache_read: "0.00000001",
                        },
                        top_provider: { max_completion_tokens: maxTokens },
                        supported_parameters: [
                            "tools",
                            "max_tokens",
                            "reasoning",
                            "structured_outputs",
                        ],
                    },
                ],
            });
        throw new Error(
            "Inference and unapproved metadata requests are forbidden",
        );
    });
    vi.stubGlobal("fetch", fetch);
    const prepared = await admin.action(api.modelConfigurationActions.prepare, {
        model,
        label: "Runtime model",
        requestKey: "runtime-import",
    });
    expect(prepared.ready).toBe(true);
    const config = await admin.query(api.modelConfiguration.list, {});
    expect(config.models).toMatchObject([
        { model, enabled: false, status: "ready" },
    ]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(config.models[0]).not.toHaveProperty("provider");
    expect(
        await t.run((ctx) => ctx.db.query("modelRevisions").first()),
    ).toMatchObject({
        descriptor: {
            maxTokens,
            reasoningEfforts: ["low", "high", "max"],
            reasoningMandatory: true,
            supportedParameters: [
                "tools",
                "max_tokens",
                "reasoning",
                "structured_outputs",
            ],
        },
        reasoningEffort: "high",
    });
});

test.each([
    0, 1,
])("a pinned provider is prepared from its exact available endpoint (status=%s)", async (status) => {
    const { t, admin } = await setup();
    const model = "example/provider-capabilities";
    const supported = [
        "tools",
        "max_tokens",
        "structured_outputs",
        "response_format",
    ];
    const pricing = { prompt: "0.00000003", completion: "0.0000001" };
    const fetch = vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url === "https://openrouter.ai/api/v1/models")
            return Response.json({
                data: [
                    {
                        id: model,
                        context_length: 131072,
                        top_provider: { max_completion_tokens: 32768 },
                        pricing,
                        supported_parameters: [
                            ...supported,
                            "reasoning",
                            "temperature",
                        ],
                    },
                ],
            });
        if (url === `https://openrouter.ai/api/v1/models/${model}/endpoints`)
            return Response.json({
                data: {
                    id: model,
                    endpoints: [
                        {
                            tag: "selected/fp8",
                            status,
                            context_length: 65536,
                            max_completion_tokens: 8192,
                            pricing,
                            supported_parameters: supported,
                        },
                    ],
                },
            });
        throw Error("Inference and unrelated metadata are forbidden");
    });
    vi.stubGlobal("fetch", fetch);
    const input = {
        model,
        provider: "selected/fp8",
        label: "Provider capabilities",
        requestKey: "provider-capabilities",
    };
    const prepared = await admin.action(
        api.modelConfigurationActions.prepare,
        input,
    );
    expect(prepared.ready).toBe(status === 0);
    if (status === 0) {
        const revision = await t.run((ctx) =>
            ctx.db.query("modelRevisions").first(),
        );
        expect(revision).toMatchObject({
            provider: "selected/fp8",
            descriptor: {
                contextWindow: 65536,
                maxTokens: 8192,
                reasoning: false,
                supportedParameters: supported,
                structuredOutputs: true,
            },
        });
    } else {
        expect(
            await t.run((ctx) => ctx.db.query("modelRevisions").first()),
        ).toBeNull();
        expect(
            (await admin.query(api.modelConfiguration.list, {})).models[0],
        ).toMatchObject({
            status: "failed",
            failure: "provider_unavailable",
            enabled: false,
        });
    }
    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([
        "https://openrouter.ai/api/v1/models",
        `https://openrouter.ai/api/v1/models/${model}/endpoints`,
    ]);
    await admin.action(api.modelConfigurationActions.prepare, input);
    expect(fetch).toHaveBeenCalledTimes(2);
});

test("unauthenticated model preparation performs no metadata I/O or writes", async () => {
    const { t } = await setup();
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(
        t.action(api.modelConfigurationActions.prepare, {
            model: "example/model",
            provider: "test",
            label: "Model",
            requestKey: "unauthenticated",
        }),
    ).rejects.toThrow("Not authenticated");
    expect(fetch).not.toHaveBeenCalled();
    expect(
        await t.run((ctx) => ctx.db.query("modelCatalog").collect()),
    ).toEqual([]);
});

test("a failed metadata request is retained and replayed without repeating I/O", async () => {
    const { admin } = await setup();
    const fetch = vi.fn(
        async () => new Response("Unavailable", { status: 503 }),
    );
    vi.stubGlobal("fetch", fetch);
    const input = {
        model: "example/failed",
        provider: "test",
        label: "Failed import",
        requestKey: "failed-import",
    };
    const first = await admin.action(
        api.modelConfigurationActions.prepare,
        input,
    );
    expect(first.ready).toBe(false);
    expect(
        await admin.action(api.modelConfigurationActions.prepare, input),
    ).toEqual(first);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(
        (await admin.query(api.modelConfiguration.list, {})).models,
    ).toMatchObject([
        { enabled: false, status: "failed", failure: "catalog_unavailable" },
    ]);
});

test("availability cannot invalidate an in-progress preparation", async () => {
    const { admin } = await setup();
    const pending = await admin.mutation(
        internal.modelConfiguration.beginPreparation,
        {
            model: "example/pending",
            provider: "test",
            label: "Pending",
            requestKey: "pending",
        },
    );
    await expect(
        admin.mutation(api.modelConfiguration.updateAvailability, {
            catalogId: pending.catalogId,
            expectedRevision: pending.revision,
            enabled: false,
            workbenchSelectable: false,
            requestKey: "disable-pending",
        }),
    ).rejects.toThrow("model_preparation_pending");
    expect(
        (await admin.query(api.modelConfiguration.list, {})).models[0],
    ).toMatchObject({ revision: pending.revision, status: "preparing" });
});

test("missing model prices cannot be accepted as free inference", async () => {
    const { admin } = await setup();
    vi.stubGlobal(
        "fetch",
        vi.fn(async (input: string | URL | Request) =>
            String(input).endsWith("/endpoints")
                ? Response.json({
                      data: {
                          id: "example/no-price",
                          endpoints: [
                              {
                                  tag: "test",
                                  status: 0,
                                  context_length: 131072,
                                  max_completion_tokens: 8192,
                                  supported_parameters: ["tools", "max_tokens"],
                                  pricing: { prompt: null, completion: null },
                              },
                          ],
                      },
                  })
                : Response.json({
                      data: [
                          {
                              id: "example/no-price",
                              context_length: 131072,
                              top_provider: { max_completion_tokens: 8192 },
                              supported_parameters: ["tools", "max_tokens"],
                              pricing: { prompt: null, completion: null },
                          },
                      ],
                  }),
        ),
    );
    expect(
        await admin.action(api.modelConfigurationActions.prepare, {
            model: "example/no-price",
            provider: "test",
            label: "Missing prices",
            requestKey: "no-price",
        }),
    ).toMatchObject({ ready: false });
    expect(
        (await admin.query(api.modelConfiguration.list, {})).models[0],
    ).toMatchObject({
        enabled: false,
        status: "failed",
        failure: "model_not_compatible",
    });
});

test("default initialization refuses a model that cannot satisfy structured agent contracts", async () => {
    const { admin } = await setup();
    const pending = await admin.mutation(
        internal.modelConfiguration.beginPreparation,
        {
            model: "example/text-only",
            provider: "test",
            label: "Text only",
            requestKey: "text-only",
        },
    );
    await admin.mutation(internal.modelConfiguration.finishPreparation, {
        catalogId: pending.catalogId,
        revision: pending.revision,
        descriptor: {
            contextWindow: 131072,
            maxTokens: 8192,
            reasoning: false,
            inputPrice: 0.03,
            outputPrice: 0.1,
            cacheReadPrice: 0.03,
            structuredOutputs: false,
        },
        profileCatalog: NATIVE_PROFILE_CATALOG,
        profiles: [{ key: "text-only", bytes: 1000 }],
    });
    await expect(
        admin.mutation(internal.modelConfiguration.initializePrepared, {
            catalogId: pending.catalogId,
            primary: true,
        }),
    ).rejects.toThrow("model_not_compatible");
    expect(
        (await admin.query(api.modelConfiguration.list, {})).assignments,
    ).toEqual([]);
});

test("a deliberate new preparation supersedes an interrupted one and fences its late result", async () => {
    const { admin } = await setup();
    const input = {
        model: "example/superseded",
        provider: "test",
        label: "Original",
        requestKey: "original",
    };
    const first = await admin.mutation(
        internal.modelConfiguration.beginPreparation,
        input,
    );
    const second = await admin.mutation(
        internal.modelConfiguration.beginPreparation,
        {
            ...input,
            label: "Replacement",
            requestKey: "replacement",
            expectedRevision: first.revision,
        },
    );
    const result = {
        descriptor: {
            contextWindow: 131072,
            maxTokens: 8192,
            reasoning: false,
            inputPrice: 0.03,
            outputPrice: 0.1,
            cacheReadPrice: 0.03,
            structuredOutputs: true,
        },
        profileCatalog: NATIVE_PROFILE_CATALOG,
        profiles: [{ key: "supersession", bytes: 1000 }],
    };
    await expect(
        admin.mutation(internal.modelConfiguration.finishPreparation, {
            catalogId: first.catalogId,
            revision: first.revision,
            ...result,
        }),
    ).rejects.toThrow("model_configuration_conflict");
    await admin.mutation(internal.modelConfiguration.finishPreparation, {
        catalogId: second.catalogId,
        revision: second.revision,
        ...result,
    });
    expect(
        (await admin.query(api.modelConfiguration.list, {})).models[0],
    ).toMatchObject({ label: "Replacement", status: "ready", enabled: false });
});

test("a lost assignment acknowledgement replays its result even after catalogue disablement", async () => {
    const { admin } = await setup();
    const prepared = await admin.mutation(
        internal.modelConfiguration.beginPreparation,
        {
            model: "example/assignment-replay",
            provider: "test",
            label: "Replay",
            requestKey: "assignment-prepare",
        },
    );
    await admin.mutation(internal.modelConfiguration.finishPreparation, {
        catalogId: prepared.catalogId,
        revision: prepared.revision,
        descriptor: {
            contextWindow: 131072,
            maxTokens: 8192,
            reasoning: false,
            inputPrice: 0.03,
            outputPrice: 0.1,
            cacheReadPrice: 0.03,
            structuredOutputs: true,
        },
        profileCatalog: NATIVE_PROFILE_CATALOG,
        profiles: [{ key: "assignment-profile", bytes: 1000 }],
    });
    const enabled = await admin.mutation(
        api.modelConfiguration.updateAvailability,
        {
            catalogId: prepared.catalogId,
            expectedRevision: prepared.revision,
            enabled: true,
            workbenchSelectable: true,
            requestKey: "assignment-enable",
        },
    );
    const assignment = {
        agent: "workbench" as const,
        catalogId: prepared.catalogId,
        expectedRevision: 0,
        requestKey: "assignment-save",
    };
    const saved = await admin.mutation(
        api.modelConfiguration.assign,
        assignment,
    );
    await admin.mutation(api.modelConfiguration.updateAvailability, {
        catalogId: prepared.catalogId,
        expectedRevision: enabled.revision,
        enabled: false,
        workbenchSelectable: false,
        requestKey: "assignment-disable",
    });
    expect(
        await admin.mutation(api.modelConfiguration.assign, assignment),
    ).toEqual(saved);
    expect(
        (await admin.query(api.modelConfiguration.list, {})).models[0]?.enabled,
    ).toBe(false);
});

test("a Workbench default must be eligible for dossier selection", async () => {
    const { admin } = await setup();
    const prepared = await admin.mutation(
        internal.modelConfiguration.beginPreparation,
        {
            model: "example/hidden-default",
            provider: "test",
            label: "Hidden",
            requestKey: "hidden-prepare",
        },
    );
    await admin.mutation(internal.modelConfiguration.finishPreparation, {
        catalogId: prepared.catalogId,
        revision: prepared.revision,
        descriptor: {
            contextWindow: 131072,
            maxTokens: 8192,
            reasoning: false,
            inputPrice: 0.03,
            outputPrice: 0.1,
            cacheReadPrice: 0.03,
            structuredOutputs: true,
        },
        profileCatalog: NATIVE_PROFILE_CATALOG,
        profiles: [{ key: "hidden-profile", bytes: 1000 }],
    });
    await admin.mutation(api.modelConfiguration.updateAvailability, {
        catalogId: prepared.catalogId,
        expectedRevision: prepared.revision,
        enabled: true,
        workbenchSelectable: false,
        requestKey: "hidden-enable",
    });
    await expect(
        admin.mutation(api.modelConfiguration.assign, {
            agent: "workbench",
            catalogId: prepared.catalogId,
            expectedRevision: 0,
            requestKey: "hidden-default",
        }),
    ).rejects.toThrow("model_unavailable");
    expect(
        (await admin.query(api.modelConfiguration.list, {})).assignments,
    ).toEqual([]);
});

test("initialization retries a confirmed metadata failure with a new attempt", async () => {
    const { t, admin } = await setup();
    const transport = vi.fn(
        async () => new Response("Unavailable", { status: 503 }),
    );
    vi.stubGlobal("fetch", transport);
    expect(
        await admin.action(api.modelConfigurationActions.initialize, {}),
    ).toEqual({ ready: false });
    expect(
        await admin.action(api.modelConfigurationActions.initialize, {}),
    ).toEqual({ ready: false });
    expect(transport).toHaveBeenCalledTimes(2);
    expect(
        await t.run((ctx) => ctx.db.query("modelCatalog").first()),
    ).toMatchObject({ status: "failed", revision: 2 });
});

test("initialization leaves an engaged metadata preparation untouched", async () => {
    const { t, admin } = await setup();
    const model = INITIAL_MODEL_CATALOG[0];
    const claimed = await admin.mutation(
        internal.modelConfiguration.beginPreparation,
        { ...model, requestKey: "engaged-initial-preparation" },
    );
    const transport = vi.fn(
        async () => new Response("Unavailable", { status: 503 }),
    );
    vi.stubGlobal("fetch", transport);
    expect(
        await admin.action(api.modelConfigurationActions.initialize, {}),
    ).toEqual({ ready: false });
    expect(transport).not.toHaveBeenCalled();
    expect(await t.run((ctx) => ctx.db.get(claimed.catalogId))).toMatchObject({
        status: "preparing",
        revision: claimed.revision,
    });
});

test("repreparing a legacy entry keeps its identity and historical revision while removing its provider pin", async () => {
    const { t, admin } = await setup();
    const first = await admin.mutation(
        internal.modelConfiguration.beginPreparation,
        {
            model: "example/legacy",
            provider: "historical-provider",
            label: "Legacy",
            requestKey: "legacy-first",
        },
    );
    const descriptor = {
        contextWindow: 131072,
        maxTokens: 8192,
        reasoning: false,
        inputPrice: 0.03,
        outputPrice: 0.1,
        cacheReadPrice: 0.03,
        structuredOutputs: true,
    };
    await admin.mutation(internal.modelConfiguration.finishPreparation, {
        catalogId: first.catalogId,
        revision: first.revision,
        descriptor,
        profileCatalog: NATIVE_PROFILE_CATALOG,
        profiles: [{ key: "legacy-profile", bytes: 1000 }],
    });
    const second = await admin.mutation(
        internal.modelConfiguration.beginPreparation,
        {
            catalogId: first.catalogId,
            model: "example/legacy",
            label: "Legacy",
            requestKey: "legacy-second",
            expectedRevision: first.revision,
        },
    );
    await admin.mutation(internal.modelConfiguration.finishPreparation, {
        catalogId: second.catalogId,
        revision: second.revision,
        descriptor,
        profileCatalog: NATIVE_PROFILE_CATALOG,
        profiles: [{ key: "openrouter-profile", bytes: 990 }],
    });
    expect(second.catalogId).toBe(first.catalogId);
    const revisions = await t.run((ctx) =>
        ctx.db
            .query("modelRevisions")
            .withIndex("by_catalog_and_revision", (q) =>
                q.eq("catalogId", first.catalogId),
            )
            .collect(),
    );
    expect(revisions).toHaveLength(2);
    expect(revisions[0]?.provider).toBe("historical-provider");
    expect(revisions[1]).not.toHaveProperty("provider");
    expect(
        (await admin.query(api.modelConfiguration.list, {})).models,
    ).toHaveLength(1);
});

test("response coherence policy has central defaults and administrator-versioned thresholds", async () => {
    const { t, admin } = await setup();
    const before = await admin.query(api.modelConfiguration.list, {});
    expect(before.responseControl).toMatchObject({
        revision: 0,
        enabled: false,
        model: "typesafe/jev-1.14",
        contradictionThreshold: 0.9,
        supportThreshold: 0.8,
    });
    await expect(
        t.mutation(api.modelConfiguration.setResponseControl, {
            expectedRevision: 0,
            enabled: true,
            model: "typesafe/jev-1.14",
            contradictionThreshold: 0.95,
            supportThreshold: 0.7,
        }),
    ).rejects.toThrow("Not authenticated");
    await admin.mutation(api.modelConfiguration.setResponseControl, {
        expectedRevision: 0,
        enabled: true,
        model: "typesafe/jev-1.14",
        contradictionThreshold: 0.95,
        supportThreshold: 0.7,
    });
    expect(
        (await admin.query(api.modelConfiguration.list, {})).responseControl,
    ).toMatchObject({
        revision: 1,
        enabled: true,
        contradictionThreshold: 0.95,
        supportThreshold: 0.7,
    });
    await expect(
        admin.mutation(api.modelConfiguration.setResponseControl, {
            expectedRevision: 0,
            enabled: false,
            model: "typesafe/jev-1.14",
            contradictionThreshold: 0.9,
            supportThreshold: 0.8,
        }),
    ).rejects.toThrow("version_conflict");
    await expect(
        admin.mutation(api.modelConfiguration.setResponseControl, {
            expectedRevision: 1,
            enabled: true,
            model: "typesafe/jev-1.14",
            contradictionThreshold: 1.1,
            supportThreshold: 0.8,
        }),
    ).rejects.toThrow("response_control_policy_invalid");
});

import { assert } from "vitest";
import { installModel } from "@/__tests__/setup/model-configuration";
import { nativePiFixtureRoute } from "@/__tests__/setup/pi-native";

test("an administrator changes reasoning through immutable revisions while explicit low remains selectable", async () => {
    const { t } = await setup();
    const { admin, catalogId } = await installModel(
        t,
        { ...nativePiFixtureRoute, reasoningEffort: "low" },
        "workbench",
        { reasoningEfforts: ["none", "low", "medium", "high"] },
    );
    const before = await admin.query(api.modelConfiguration.list, {});
    const catalog = before.models.find((m) => m._id === catalogId);
    assert(catalog?.currentRevisionId);
    expect(catalog.reasoning).toMatchObject({
        preference: "recommended",
        recommended: "medium",
        effective: "medium",
    });
    const originalRevisionId = catalog.currentRevisionId;
    const original = await t.run((ctx) => ctx.db.get(originalRevisionId));
    const args = {
        catalogId,
        expectedRevision: catalog.revision,
        preference: "low" as const,
        requestKey: "choose-low",
    };
    const changed = await admin.mutation(
        api.modelConfiguration.setReasoningPreference,
        args,
    );
    expect(
        await admin.mutation(
            api.modelConfiguration.setReasoningPreference,
            args,
        ),
    ).toEqual(changed);
    expect(await t.run((ctx) => ctx.db.get(originalRevisionId))).toEqual(
        original,
    );
    const after = await admin.query(api.modelConfiguration.list, {});
    expect(
        after.models.find((m) => m._id === catalogId)?.reasoning,
    ).toMatchObject({
        preference: "low",
        effective: "low",
        recommended: "medium",
    });
    await expect(
        admin.mutation(api.modelConfiguration.setReasoningPreference, {
            ...args,
            expectedRevision: changed.revision,
            preference: "max",
            requestKey: "unsupported",
        }),
    ).rejects.toThrow("model_effort_unavailable");
});

test("a failed preparation can change its preference before reprepare without enabling inference", async () => {
    const { t } = await setup();
    const { admin, catalogId } = await installModel(
        t,
        { ...nativePiFixtureRoute, reasoningEffort: "low" },
        "workbench",
        { reasoningEfforts: ["low", "medium"] },
    );
    const before = (
        await admin.query(api.modelConfiguration.list, {})
    ).models.find((model) => model._id === catalogId);
    assert(before);
    await t.run((ctx) =>
        ctx.db.patch(catalogId, { status: "failed", enabled: false }),
    );
    await admin.mutation(api.modelConfiguration.setReasoningPreference, {
        catalogId,
        expectedRevision: before.revision,
        requestKey: "recover-preference",
        preference: "recommended",
    });
    const after = (
        await admin.query(api.modelConfiguration.list, {})
    ).models.find((model) => model._id === catalogId);
    expect(after).toMatchObject({
        status: "failed",
        enabled: false,
        compatible: false,
        reasoning: { preference: "recommended", effective: "medium" },
    });
});

test("loopback browser metadata initializes real model settings without external requests", async () => {
    const { admin } = await setup();
    vi.stubEnv("E2E_FIXTURES_ENABLED", "true");
    vi.stubEnv("E2E_MODEL_METADATA_FIXTURE", "true");
    vi.stubEnv("CONVEX_CLOUD_URL", "http://127.0.0.1:3210");
    const external = vi.fn(() => {
        throw new Error("External requests forbidden");
    });
    vi.stubGlobal("fetch", external);
    try {
        expect(
            await admin.action(api.modelConfigurationActions.initialize, {}),
        ).toEqual({ ready: true });
        const view = await admin.query(api.modelConfiguration.list, {});
        expect(
            view.models.map((model) => ({
                label: model.label,
                enabled: model.enabled,
                compatible: model.compatible,
            })),
        ).toEqual([
            { label: "GLM-5.3-Flash", enabled: true, compatible: true },
            {
                label: "DeepSeek V4.1 Flash 1017",
                enabled: true,
                compatible: true,
            },
        ]);
        expect(
            view.assignments.some(
                (assignment) => assignment.agent === "workbench",
            ),
        ).toBe(true);
        expect(external).not.toHaveBeenCalled();
    } finally {
        vi.unstubAllEnvs();
    }
    // A cold catalogue is initialized in full here (measured ~17 s), so this case
    // cannot share the suite default; the assertions are unchanged.
}, 60_000);

test.each([
    { fixtures: "false", origin: "http://127.0.0.1:3210" },
    { fixtures: "true", origin: "https://example.convex.cloud" },
])("browser metadata refuses fixture configuration outside enabled loopback: $fixtures $origin", async ({
    fixtures,
    origin,
}) => {
    const { admin } = await setup();
    vi.stubEnv("E2E_FIXTURES_ENABLED", fixtures);
    vi.stubEnv("E2E_MODEL_METADATA_FIXTURE", "true");
    vi.stubEnv("CONVEX_CLOUD_URL", origin);
    const external = vi.fn(() => {
        throw new Error("External requests forbidden");
    });
    vi.stubGlobal("fetch", external);
    try {
        expect(
            await admin.action(api.modelConfigurationActions.initialize, {}),
        ).toEqual({ ready: false });
        const view = await admin.query(api.modelConfiguration.list, {});
        expect(view.assignments).toEqual([]);
        expect(
            view.models.every((model) => !model.enabled && !model.compatible),
        ).toBe(true);
        expect(external).not.toHaveBeenCalled();
    } finally {
        vi.unstubAllEnvs();
    }
});

test.each([
    { mode: "unchanged_additive_catalog" as const },
    { mode: "changed_catalog_revision" as const },
])("configured route refuses missing DB profile before refresh and succeeds after refresh without altering model, effort or admitted pins ($mode)", async ({
    mode,
}) => {
    const { getAgentDefinition } = await import(
        "@convex/execution/agentCatalog"
    );
    const { agentToolSchemas } = await import(
        "@convex/execution/agentDefinition"
    );
    const { piInputProfileKey } = await import(
        "@convex/integrations/modelInput"
    );
    const { revisionRoute } = await import("@convex/modelConfiguration");
    const { seedInspectedEvidence } = await import(
        "@/__tests__/setup/source-preparation"
    );

    const f = await seedInspectedEvidence();
    const { admin, catalogId } = await installModel(
        f.t,
        { ...nativePiFixtureRoute, reasoningEffort: "low" },
        "saved_material_inspection",
        { reasoningEfforts: ["low", "medium"], reasoningDefault: "medium" },
    );

    const beforeCatalog = await f.t.run((ctx) => ctx.db.get(catalogId));
    const revisionId = beforeCatalog?.currentRevisionId;
    assert(revisionId);
    const revisionBefore = await f.t.run((ctx) => ctx.db.get(revisionId));
    assert(revisionBefore);
    const route = revisionRoute(revisionBefore);

    // Start an already-admitted historical v3 mission and a new default v4 mission.
    const v3MissionId = await f.t.mutation(internal.execution.missions.start, {
        runId: f.args.runId,
        corpusRevisionId: f.args.corpusRevisionId,
        definitionId: "saved_material_inspection_v1",
        requestKey: `profile-refresh-v3-${mode}`,
        expectedGeneration: 4,
    });
    await f.t.run((ctx) =>
        ctx.db.patch(v3MissionId, {
            definitionVersion: 3,
            objectiveKey: `saved-material-historical:${f.args.corpusRevisionId}`,
            modelRevisionId: revisionBefore._id,
            reasoningEffort: "low",
        }),
    );
    const v4MissionId = await f.t.mutation(internal.execution.missions.start, {
        runId: f.args.runId,
        corpusRevisionId: f.args.corpusRevisionId,
        definitionId: "saved_material_inspection_v1",
        requestKey: `profile-refresh-v4-${mode}`,
        expectedGeneration: 4,
    });
    expect(v4MissionId).not.toBe(v3MissionId);
    await f.t.run((ctx) =>
        ctx.db.patch(v4MissionId, {
            modelRevisionId: revisionBefore._id,
            reasoningEffort: "low",
        }),
    );

    // Simulate a database provisioned before v4 existed: remove the v4 profile key from DB.
    const v4Def = getAgentDefinition("saved_material_inspection_v1", 4);
    const v4Key = await piInputProfileKey({
        instructions: v4Def.instructions,
        operations: agentToolSchemas(v4Def),
        prompt: "",
        definitionVersion: v4Def.version,
        nativeConversation: v4Def.nativeConversation,
        contextRendering: v4Def.contextRendering,
        completionTransport: v4Def.completionTransport,
        nativeRoute: { ...route, reasoningEffort: "low" },
    });
    await f.t.run(async (ctx) => {
        const row = await ctx.db
            .query("nativeInputProfiles")
            .withIndex("by_key", (q) => q.eq("key", v4Key))
            .unique();
        if (row) await ctx.db.delete(row._id);
        if (mode === "changed_catalog_revision") {
            await ctx.db.patch(catalogId, {
                preparedProfileCatalog: "stale-previous-catalog-revision",
            });
        }
    });

    const { modelPrepared } = await import("@convex/modelConfiguration");
    const catalogBeforeRefresh = await f.t.run((ctx) => ctx.db.get(catalogId));
    assert(catalogBeforeRefresh);
    expect(modelPrepared(catalogBeforeRefresh)).toBe(
        mode === "unchanged_additive_catalog",
    );
    expect(
        (await admin.query(api.modelConfiguration.list, {})).models.find(
            (model) => model._id === catalogId,
        )?.compatible,
    ).toBe(mode === "unchanged_additive_catalog");

    // Historical v3 continues working with its retained DB profile, while v4 explicitly blocks before refresh.
    const v3Before = await f.t.query(internal.execution.context.build, {
        missionId: v3MissionId,
        expectedGeneration: 4,
    });
    expect(v3Before.kind).toBe("ready");
    await expect(
        f.t.query(internal.execution.context.build, {
            missionId: v4MissionId,
            expectedGeneration: 4,
        }),
    ).rejects.toThrow("model_input_profile_unavailable");

    // Explicit offline refresh supplies the missing DB profile without network I/O or changing model/effort/pins.
    const external = vi.fn(() => {
        throw new Error("External network forbidden during profile refresh");
    });
    vi.stubGlobal("fetch", external);
    let cursor: string | null = null;
    do {
        const page: { isDone: boolean; continueCursor: string | null } =
            await admin.action(api.modelConfigurationActions.refreshProfiles, {
                catalogId,
                cursor,
            });
        cursor = page.isDone ? null : page.continueCursor;
    } while (cursor !== null);
    expect(external).not.toHaveBeenCalled();

    const afterCatalog = await f.t.run((ctx) => ctx.db.get(catalogId));
    expect(afterCatalog?.currentRevisionId).toBe(
        beforeCatalog.currentRevisionId,
    );
    expect(afterCatalog?.model).toBe(beforeCatalog.model);
    expect(afterCatalog?.provider).toBe(beforeCatalog.provider);
    assert(afterCatalog);
    expect(modelPrepared(afterCatalog)).toBe(true);
    const afterRevision = await f.t.run((ctx) => ctx.db.get(revisionId));
    expect(afterRevision?.reasoningPreference).toBe(
        revisionBefore.reasoningPreference,
    );
    expect(afterRevision?.reasoningEffort).toBe(revisionBefore.reasoningEffort);
    expect(
        (await f.t.run((ctx) => ctx.db.get(v3MissionId)))?.modelRevisionId,
    ).toBe(revisionBefore._id);

    // After refresh, both v3 and v4 resolve their DB profiles cleanly.
    const v3After = await f.t.query(internal.execution.context.build, {
        missionId: v3MissionId,
        expectedGeneration: 4,
    });
    const v4After = await f.t.query(internal.execution.context.build, {
        missionId: v4MissionId,
        expectedGeneration: 4,
    });
    expect(v3After.kind).toBe("ready");
    expect(v4After.kind).toBe("ready");
}, 30000);

test("profile reads reject a transaction exceeding 256 keys", async () => {
    const { admin } = await setup();
    await expect(
        admin.query(internal.modelConfiguration.profiles, {
            keys: Array.from({ length: 257 }, (_, i) => `missing:${i}`),
        }),
    ).rejects.toThrow("model_not_compatible");
});

test("staged profile chunks do not publish preparation readiness before the final batch", async () => {
    const { admin, t } = await setup();
    const pending = await admin.mutation(
        internal.modelConfiguration.beginPreparation,
        {
            model: "fixture/batched",
            label: "Batched",
            requestKey: "batched",
        },
    );
    const profiles = Array.from({ length: 256 }, (_, i) => ({
        key: `batch:${i}`,
        bytes: 100,
    }));
    await admin.mutation(internal.modelConfiguration.retainNativeProfileBatch, {
        profileCatalog: NATIVE_PROFILE_CATALOG,
        profiles,
    });
    const staged = await t.run((ctx) => ctx.db.get(pending.catalogId));
    expect(staged?.status).toBe("preparing");
    expect(staged?.preparedProfileCatalog).toBeUndefined();
    expect(
        await admin.query(internal.modelConfiguration.profiles, {
            keys: ["batch:0", "batch:255"],
        }),
    ).toEqual([profiles[0], profiles[255]]);
    await expect(
        admin.mutation(internal.modelConfiguration.retainNativeProfileBatch, {
            profileCatalog: NATIVE_PROFILE_CATALOG,
            profiles: [...profiles, { key: "overflow", bytes: 100 }],
        }),
    ).rejects.toThrow("model_not_compatible");
    expect(
        await admin.query(internal.modelConfiguration.profiles, {
            keys: ["overflow"],
        }),
    ).toEqual([]);
    await expect(
        admin.mutation(internal.modelConfiguration.retainNativeProfileBatch, {
            profileCatalog: "stale",
            profiles: [{ key: "stale", bytes: 100 }],
        }),
    ).rejects.toThrow("model_profile_version_conflict");
});
