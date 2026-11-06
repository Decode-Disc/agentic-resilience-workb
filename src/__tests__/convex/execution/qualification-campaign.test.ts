import assert from "node:assert/strict";
import type { Id } from "@convex/_generated/dataModel";
import {
    type CampaignManifest,
    emptyCampaignLimits,
} from "@convex/qualificationCampaignPolicy";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import {
    convexToJson,
    type JSONValue,
    jsonToConvex,
    type Value,
} from "convex/values";
import { afterEach, expect, test, vi } from "vitest";
import { seedWorkbench } from "@/__tests__/setup/workbench";

const authorize = makeFunctionReference<
    "mutation",
    { manifest: CampaignManifest },
    Id<"qualificationCampaigns">
>("qualificationCampaigns:authorize");
const admit = makeFunctionReference<
    "mutation",
    {
        campaignId: Id<"qualificationCampaigns">;
        key: string;
        candidateHash: string;
        correction?: string;
        changedPaths: string[];
    },
    Id<"qualificationLots">
>("qualificationCampaigns:admit");
const manifest = (): Extract<CampaignManifest, { version: 1 }> => ({
    version: 1,
    key: "campaign",
    objective: "Qualify the protected Workbench path",
    capability: "workbench",
    mode: "deterministic",
    batteryHash: "a".repeat(64),
    expectations: [{ id: "framing", checks: ["saved"] }],
    models: { workbench: { model: "fixture", reasoning: "recommended" } },
    correctionPaths: ["convex/execution"],
    maximumLots: 2,
    repetitionsPerCandidate: 1,
    expiresAt: Date.now() + 60000,
    perLot: emptyCampaignLimits(),
    total: emptyCampaignLimits(),
});
afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
});
test("one immutable authorization admits a lot idempotently and refuses a concurrent second lot", async () => {
    const { t } = await seedWorkbench(true);
    const m = manifest();
    const campaignId = await t.mutation(authorize, { manifest: m });
    expect(await t.mutation(authorize, { manifest: m })).toBe(campaignId);
    const args = {
        campaignId,
        key: "first",
        candidateHash: "b".repeat(64),
        changedPaths: [],
    };
    const lot = await t.mutation(admit, args);
    expect(await t.mutation(admit, args)).toBe(lot);
    await expect(t.mutation(admit, { ...args, key: "second" })).rejects.toThrow(
        "pending",
    );
    await expect(
        t.mutation(authorize, { manifest: { ...m, maximumLots: 3 } }),
    ).rejects.toThrow("conflict");
});

import { api, internal } from "@convex/_generated/api";
import { WORKBENCH_MODEL_ROUTE } from "@convex/integrations/modelRouting";
import { readWorkbenchQualification } from "@convex/runWorkspace";
import { installModel } from "@/__tests__/setup/model-configuration";

const bind = makeFunctionReference<
    "mutation",
    { lotId: Id<"qualificationLots">; contextId: Id<"browserTestContexts"> },
    null
>("qualificationCampaigns:bind");
const reconcile = makeFunctionReference<
    "mutation",
    { lotId: Id<"qualificationLots">; cleanupCompleted: boolean },
    { reconciled: boolean }
>("qualificationCampaigns:reconcile");
const assess = makeFunctionReference<
    "mutation",
    {
        lotId: Id<"qualificationLots">;
        assessmentHash: string;
        verdict: "passed" | "failed" | "inconclusive";
    },
    null
>("qualificationCampaigns:assess");
const close = makeFunctionReference<
    "mutation",
    { campaignId: Id<"qualificationCampaigns"> },
    null
>("qualificationCampaigns:close");

test("closing the campaign revokes an otherwise valid paid grant before further dispatch", async () => {
    const f = await seedWorkbench(true);
    await installModel(f.t, WORKBENCH_MODEL_ROUTE);
    await f.t.run((ctx) =>
        ctx.db.patch(f.runId, { reservationKey: "browser:qualification" }),
    );
    const campaignId = await f.t.mutation(authorize, {
        manifest: {
            ...manifest(),
            mode: "live",
            models: {
                workbench: {
                    model: WORKBENCH_MODEL_ROUTE.model,
                    reasoning: "recommended",
                },
            },
            perLot: { model: 20, search: 0, acquisition: 0, costUsd: 0.5 },
            total: { model: 40, search: 0, acquisition: 0, costUsd: 1 },
        },
    });
    const lotId = await f.t.mutation(admit, {
        campaignId,
        key: "first",
        candidateHash: "b".repeat(64),
        changedPaths: [],
    });
    const run = await f.t.run((ctx) => ctx.db.get(f.runId));
    assert(run?.browserTestContextId);
    const contextId = run.browserTestContextId;
    expect(run?.browserTestContextId).toBeTruthy();
    await f.t.mutation(bind, { lotId, contextId });
    await f.t.mutation(
        internal.execution.fixtures.authorizeWorkbenchQualification,
        { runId: f.runId, fixtureKey: "qualification" },
    );
    expect(
        await f.t.run(async (ctx) => readWorkbenchQualification(ctx, run)),
    ).toBeTruthy();
    await f.t.mutation(close, { campaignId });
    await expect(
        f.t.run(async (ctx) => readWorkbenchQualification(ctx, run)),
    ).rejects.toThrow("not active");
});

test("reconciliation and a bound review allow two corrected candidates without another authorization", async () => {
    const { t } = await seedWorkbench(true);
    const campaignId = await t.mutation(authorize, { manifest: manifest() });
    const first = await t.mutation(admit, {
        campaignId,
        key: "first",
        candidateHash: "b".repeat(64),
        changedPaths: [],
    });
    await expect(
        t.mutation(assess, {
            lotId: first,
            assessmentHash: "c".repeat(64),
            verdict: "failed",
        }),
    ).rejects.toThrow("reconciliation");
    expect(
        await t.mutation(reconcile, { lotId: first, cleanupCompleted: false }),
    ).toMatchObject({ reconciled: false });
    await t.mutation(reconcile, { lotId: first, cleanupCompleted: true });
    await t.mutation(assess, {
        lotId: first,
        assessmentHash: "c".repeat(64),
        verdict: "failed",
    });
    await expect(
        t.mutation(admit, {
            campaignId,
            key: "outside",
            candidateHash: "d".repeat(64),
            correction: "Fix gate",
            changedPaths: ["convex/schema.ts"],
        }),
    ).rejects.toThrow("outside");
    const second = await t.mutation(admit, {
        campaignId,
        key: "second",
        candidateHash: "d".repeat(64),
        correction: "Fix gate",
        changedPaths: ["convex/execution/fixtures.ts"],
    });
    await t.mutation(reconcile, { lotId: second, cleanupCompleted: true });
    await t.mutation(assess, {
        lotId: second,
        assessmentHash: "e".repeat(64),
        verdict: "passed",
    });
    await expect(
        t.mutation(admit, {
            campaignId,
            key: "third",
            candidateHash: "f".repeat(64),
            changedPaths: [],
        }),
    ).rejects.toThrow("satisfied");
});

test("known receipts retain conservative consumption and prevent a second allocation above the total", async () => {
    const f = await seedWorkbench(true);
    await installModel(f.t, WORKBENCH_MODEL_ROUTE);
    const campaignId = await f.t.mutation(authorize, {
        manifest: {
            ...manifest(),
            mode: "live",
            models: {
                workbench: {
                    model: WORKBENCH_MODEL_ROUTE.model,
                    reasoning: "recommended",
                },
            },
            perLot: { model: 2, search: 0, acquisition: 0, costUsd: 0.5 },
            total: { model: 3, search: 0, acquisition: 0, costUsd: 0.8 },
        },
    });
    const lotId = await f.t.mutation(admit, {
        campaignId,
        key: "first",
        candidateHash: "b".repeat(64),
        changedPaths: [],
    });
    const run = await f.t.run((ctx) => ctx.db.get(f.runId));
    assert(run?.browserTestContextId);
    const contextId = run.browserTestContextId;
    await f.t.mutation(bind, { lotId, contextId });
    // Fixture records the production receipt format; no provider is invoked.
    await f.t.run(async (ctx) => {
        const revision = await ctx.db.insert("modelRevisions", {
            catalogId: await ctx.db.insert("modelCatalog", {
                model: "fixture",
                label: "fixture",
                revision: 1,
                enabled: true,
                workbenchSelectable: true,
                status: "ready",
                preparationKey: "fixture",
                preparationHash: "fixture",
                updatedAt: 1,
            }),
            revision: 1,
            model: "fixture",
            descriptor: {
                contextWindow: 100,
                maxTokens: 10,
                reasoning: false,
                inputPrice: 0,
                outputPrice: 0,
                cacheReadPrice: 0,
                structuredOutputs: true,
            },
            preparationHash: "fixture",
            createdAt: 1,
        });
        await ctx.db.patch(contextId, {
            status: "closed",
            paidQualification: {
                runId: f.runId,
                modelRevisionId: revision,
                maximumRequests: 2,
                maximumCostUsd: 0.5,
                authorizedAt: 1,
            },
        });
        await ctx.db.insert("providerCalls", {
            runId: f.runId,
            service: "model",
            operation: "agent_reasoning",
            operationKey: "first",
            status: "succeeded",
            attempt: 1,
            reportedCost: 0.1,
            qualificationReservationUsd: 0.4,
            dispatchOutcome: "response_received",
            createdAt: 1,
        });
    });
    expect(
        await f.t.mutation(reconcile, { lotId, cleanupCompleted: true }),
    ).toMatchObject({ reconciled: true, usage: { model: 1, costUsd: 0.4 } });
    await f.t.mutation(assess, {
        lotId,
        assessmentHash: "c".repeat(64),
        verdict: "failed",
    });
    await expect(
        f.t.mutation(admit, {
            campaignId,
            key: "second",
            candidateHash: "d".repeat(64),
            correction: "Repair recovery",
            changedPaths: ["convex/execution/fixtures.ts"],
        }),
    ).rejects.toThrow("budget");
});

test("a closed or expired campaign cannot admit work or renew its authorization", async () => {
    const { t } = await seedWorkbench(true);
    const m = manifest();
    const campaignId = await t.mutation(authorize, { manifest: m });
    vi.setSystemTime(m.expiresAt + 1);
    await expect(
        t.mutation(admit, {
            campaignId,
            key: "late",
            candidateHash: "b".repeat(64),
            changedPaths: [],
        }),
    ).rejects.toThrow("expired");
    await expect(t.mutation(authorize, { manifest: m })).rejects.toThrow(
        "expired",
    );
});

test("an unknown provider result keeps the full allocation and blocks another lot", async () => {
    const f = await seedWorkbench(true);
    const { catalogId } = await installModel(f.t, WORKBENCH_MODEL_ROUTE);
    const campaignId = await f.t.mutation(authorize, {
        manifest: {
            ...manifest(),
            mode: "live",
            models: {
                workbench: {
                    model: WORKBENCH_MODEL_ROUTE.model,
                    reasoning: "recommended",
                },
            },
            perLot: { model: 20, search: 0, acquisition: 0, costUsd: 0.5 },
            total: { model: 40, search: 0, acquisition: 0, costUsd: 1 },
        },
    });
    const lotId = await f.t.mutation(admit, {
        campaignId,
        key: "unknown",
        candidateHash: "b".repeat(64),
        changedPaths: [],
    });
    const run = await f.t.run((ctx) => ctx.db.get(f.runId));
    assert(run?.browserTestContextId);
    const contextId = run.browserTestContextId;
    await f.t.mutation(bind, { lotId, contextId });
    await f.t.run(async (ctx) => {
        const model = await ctx.db.get(catalogId);
        assert(model?.currentRevisionId);
        await ctx.db.patch(contextId, {
            status: "closed",
            paidQualification: {
                runId: f.runId,
                modelRevisionId: model.currentRevisionId,
                maximumRequests: 20,
                maximumCostUsd: 0.5,
                authorizedAt: 1,
            },
        });
        await ctx.db.insert("providerCalls", {
            runId: f.runId,
            service: "model",
            operation: "agent_reasoning",
            operationKey: "unknown",
            status: "failed",
            attempt: 1,
            qualificationReservationUsd: 0.4,
            errorCode: "network_error",
            createdAt: 1,
        });
    });
    expect(
        await f.t.mutation(reconcile, { lotId, cleanupCompleted: true }),
    ).toMatchObject({ reconciled: false });
    await expect(
        f.t.mutation(admit, {
            campaignId,
            key: "second",
            candidateHash: "c".repeat(64),
            changedPaths: [],
        }),
    ).rejects.toThrow("pending");
});

import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    configureCampaign,
    restoreCampaignConfiguration,
} from "@evaluations/workbench-browser/campaign-configuration";

test("temporary reasoning changes restore through the real configuration owner and preserve concurrent edits", async () => {
    const f = await seedWorkbench(true);
    const { admin, catalogId } = await installModel(
        f.t,
        { model: "test/campaign", reasoningEffort: "low" },
        "workbench",
        { reasoningEfforts: ["low", "medium"], reasoningDefault: "low" },
    );
    const root = mkdtempSync(join(tmpdir(), "campaign-config-"));
    const m = {
        ...manifest(),
        models: {
            workbench: { model: "test/campaign", reasoning: "medium" as const },
        },
    };
    const client = new ConvexHttpClient("http://127.0.0.1:3210", {
        fetch: async (url, init) => {
            const body = JSON.parse(String(init?.body)) as {
                path: string;
                args: JSONValue[];
            };
            const args = jsonToConvex(body.args[0] ?? {}) as Record<
                string,
                Value
            >;
            const value = String(url).endsWith("/query")
                ? await admin.query(
                      makeFunctionReference<
                          "query",
                          Record<string, Value>,
                          Value
                      >(body.path),
                      args,
                  )
                : String(url).endsWith("/mutation")
                  ? await admin.mutation(
                        makeFunctionReference<
                            "mutation",
                            Record<string, Value>,
                            Value
                        >(body.path),
                        args,
                    )
                  : await admin.action(
                        makeFunctionReference<
                            "action",
                            Record<string, Value>,
                            Value
                        >(body.path),
                        args,
                    );
            return new Response(
                JSON.stringify({
                    status: "success",
                    value: convexToJson(value),
                }),
                { status: 200 },
            );
        },
    });
    await configureCampaign(client, m, root);
    const after = await admin.query(api.modelConfiguration.list, {});
    expect(
        after.models.find((model) => model._id === catalogId)?.reasoning
            .effective,
    ).toBe("medium");
    const selected = after.models.find((model) => model._id === catalogId);
    assert(selected);
    await admin.mutation(api.modelConfiguration.setReasoningPreference, {
        catalogId,
        expectedRevision: selected.revision,
        requestKey: "concurrent-human-change",
        preference: "low",
    });
    await expect(restoreCampaignConfiguration(client, root)).rejects.toThrow(
        "concurrently",
    );
    expect(
        (await admin.query(api.modelConfiguration.list, {})).models.find(
            (model) => model._id === catalogId,
        )?.reasoning.effective,
    ).toBe("low");
    expect(
        JSON.parse(readFileSync(join(root, "configuration.json"), "utf8"))
            .changes[0].restored,
    ).toBeUndefined();
});

test("route pricing cannot change between campaign authorization and its first lot", async () => {
    const f = await seedWorkbench(true);
    const { catalogId } = await installModel(f.t, WORKBENCH_MODEL_ROUTE);
    await f.t.run((ctx) =>
        ctx.db.patch(f.runId, { reservationKey: "browser:qualification" }),
    );
    const campaignId = await f.t.mutation(authorize, {
        manifest: {
            ...manifest(),
            mode: "live",
            models: {
                workbench: {
                    model: WORKBENCH_MODEL_ROUTE.model,
                    reasoning: "recommended",
                },
            },
            perLot: { model: 20, search: 0, acquisition: 0, costUsd: 0.5 },
            total: { model: 40, search: 0, acquisition: 0, costUsd: 1 },
        },
    });
    const lotId = await f.t.mutation(admit, {
        campaignId,
        key: "first",
        candidateHash: "b".repeat(64),
        changedPaths: [],
    });
    const run = await f.t.run((ctx) => ctx.db.get(f.runId));
    assert(run?.browserTestContextId);
    const contextId = run.browserTestContextId;
    await f.t.mutation(bind, { lotId, contextId });
    await f.t.run(async (ctx) => {
        const c = await ctx.db.get(catalogId);
        assert(c?.currentRevisionId);
        const revision = await ctx.db.get(c.currentRevisionId);
        assert(revision);
        await ctx.db.patch(revision._id, {
            descriptor: {
                ...revision.descriptor,
                inputPrice: revision.descriptor.inputPrice + 0.001,
            },
        });
    });
    await expect(
        f.t.mutation(
            internal.execution.fixtures.authorizeWorkbenchQualification,
            { runId: f.runId, fixtureKey: "qualification" },
        ),
    ).rejects.toThrow("price drift");
});

test("cleanup fences a running lot before context cleanup and retains its unresolved allocation", async () => {
    const { t } = await seedWorkbench(true);
    const campaignId = await t.mutation(authorize, { manifest: manifest() });
    const lotId = await t.mutation(admit, {
        campaignId,
        key: "first",
        candidateHash: "b".repeat(64),
        changedPaths: [],
    });
    const beginCleanup = makeFunctionReference<
        "mutation",
        { lotId: Id<"qualificationLots"> },
        null
    >("qualificationCampaigns:beginCleanup");
    await t.mutation(beginCleanup, { lotId });
    await t.mutation(beginCleanup, { lotId });
    const state = await t.run((ctx) => ctx.db.get(lotId));
    assert(state);
    expect(state.status).toBe("closing");
    await expect(
        t.mutation(admit, {
            campaignId,
            key: "second",
            candidateHash: "c".repeat(64),
            changedPaths: [],
        }),
    ).rejects.toThrow("pending");
    expect(
        await t.mutation(reconcile, { lotId, cleanupCompleted: false }),
    ).toMatchObject({ reconciled: false });
});
