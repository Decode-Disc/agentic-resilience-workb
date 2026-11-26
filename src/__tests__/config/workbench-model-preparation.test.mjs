import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import * as campaignConfiguration from "../../../scripts/evaluations/workbench-browser/campaign-configuration.ts";
import { prepareQualificationModel } from "../../../scripts/evaluations/workbench-browser/model-preparation.ts";
import { configurableCampaign } from "../setup/qualification-v2.ts";

function catalogue(compatible) {
    return {
        models: [
            {
                _id: "model",
                model: "z-ai/glm-5.3-flash",
                enabled: true,
                workbenchSelectable: true,
                status: "ready",
                currentRevisionId: "revision",
                revision: 3,
                compatible,
            },
        ],
        assignments: [{ agent: "workbench", catalogId: "model" }],
    };
}
test("stale profiles are refreshed via the existing bounded continuation without model reassignment", async () => {
    let refreshed = false;
    const args = [];
    const result = await prepareQualificationModel({
        query: async () => catalogue(refreshed),
        action: async (_reference, input) => {
            args.push(input);
            if (args.length === 1)
                return { isDone: false, continueCursor: "next" };
            refreshed = true;
            return { isDone: true, continueCursor: null };
        },
    });
    assert.deepEqual(args, [
        { catalogId: "model", cursor: null },
        { catalogId: "model", cursor: "next" },
    ]);
    assert.equal(result.refreshed, true);
    assert.equal(result.revisionId, "revision");
});
test("disabled selection remains blocked rather than enabled by qualification", async () => {
    const disabled = catalogue(false);
    disabled.models[0].enabled = false;
    await assert.rejects(
        prepareQualificationModel({
            query: async () => disabled,
            action: async () =>
                assert.fail("Disabled model cannot be prepared"),
        }),
        /not available/,
    );
});
test("incomplete refresh and concurrent revision changes stop before inference authorization", async () => {
    await assert.rejects(
        prepareQualificationModel({
            query: async () => catalogue(false),
            action: async () => ({ isDone: true, continueCursor: null }),
        }),
        /incomplete/,
    );
    let calls = 0;
    await assert.rejects(
        prepareQualificationModel({
            query: async () => {
                const c = catalogue(true);
                if (calls++) c.models[0].currentRevisionId = "other";
                return c;
            },
            action: async () => ({ isDone: true, continueCursor: null }),
        }),
        /revision changed/,
    );
});
test("stalled continuations cannot loop indefinitely", async () => {
    let calls = 0;
    await assert.rejects(
        prepareQualificationModel({
            query: async () => catalogue(false),
            action: async () => {
                calls++;
                return { isDone: false, continueCursor: "stuck" };
            },
        }),
        /did not advance/,
    );
    assert.equal(calls, 2);
});

test("reaching the continuation bound remains blocked even if the current revision is already compatible", async () => {
    let refreshed = false,
        calls = 0;
    await assert.rejects(
        prepareQualificationModel({
            query: async () => catalogue(refreshed),
            action: async () => {
                refreshed = true;
                return { isDone: false, continueCursor: `page-${++calls}` };
            },
        }),
        /continuation bound/,
    );
    assert.equal(calls, 4);
});

test("profile preparation follows more than twenty retained revisions within the catalogue bound", async () => {
    let calls = 0;
    const result = await prepareQualificationModel({
        query: async () => {
            const state = catalogue(calls === 34);
            state.models[0].revision = 44;
            return state;
        },
        action: async () => {
            calls++;
            return calls === 34
                ? { isDone: true, continueCursor: null }
                : { isDone: false, continueCursor: `revision-${44 - calls}` };
        },
    });
    assert.equal(result.pages, 34);
    assert.equal(result.revisionId, "revision");
});

test("campaign configuration prepares an unassigned model before assignment", async () => {
    const root = mkdtempSync(join(tmpdir(), "campaign-unassigned-model-"));
    const manifest = configurableCampaign();
    manifest.configurations[0].models = {
        workbench: { model: "fixture/current", reasoning: "recommended" },
        sources: { model: "fixture/selected", reasoning: "recommended" },
    };
    const current = {
        ...catalogue(true).models[0],
        model: "fixture/current",
        reasoning: { preference: "recommended" },
    };
    const selected = {
        ...current,
        _id: "selected-catalogue",
        model: "fixture/selected",
        currentRevisionId: "selected-revision",
        compatible: false,
    };
    const state = {
        models: [current, selected],
        assignments: ["workbench", "sources"].map((agent) => ({
            agent,
            catalogId: "model",
            revision: 1,
        })),
        responseControl: { enabled: false, revision: 1 },
    };
    const client = {
        query: async () => structuredClone(state),
        action: async (_ref, args) => {
            const model = state.models.find((m) => m._id === args.catalogId);
            assert(model);
            model.compatible = true;
            return { isDone: true, continueCursor: null };
        },
        mutation: async (_ref, args) => {
            assert.equal(args.agent, "sources");
            assert.equal(args.catalogId, "selected-catalogue");
            if (!selected.compatible) throw new Error("model_unavailable");
            const assignment = state.assignments.find(
                (a) => a.agent === args.agent,
            );
            assignment.catalogId = args.catalogId;
            assignment.revision++;
            return { revision: assignment.revision };
        },
    };
    try {
        await campaignConfiguration.configureCampaign(
            client,
            manifest,
            root,
            "first",
        );
        assert.equal(state.assignments[1].catalogId, "selected-catalogue");
        assert.equal(state.assignments[0].catalogId, "model");
        assert.equal(selected.currentRevisionId, "selected-revision");
        assert.equal(selected.compatible, true);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test("campaign model preflight prepares declared choices without changing role assignments", async () => {
    const manifest = configurableCampaign();
    const state = catalogue(false);
    state.assignments.push({ agent: "sources", catalogId: "model" });
    const originalAssignments = structuredClone(state.assignments);
    for (const profile of manifest.configurations)
        for (const choice of Object.values(profile.models))
            choice.model = "z-ai/glm-5.3-flash";
    let available = false;
    const client = {
        query: async () => structuredClone(state),
        action: async (_ref, args) => {
            assert.equal(args.catalogId, "model");
            if (!available) throw new Error("profile_refresh_unavailable");
            state.models[0].compatible = true;
            return { isDone: true, continueCursor: null };
        },
        mutation: async () =>
            assert.fail("Preflight cannot assign a role or admit a paid lot"),
    };
    await assert.rejects(
        campaignConfiguration.prepareCampaignModels(client, manifest),
        /profile_refresh_unavailable/,
    );
    assert.deepEqual(state.assignments, originalAssignments);
    assert.equal(state.models[0].compatible, false);
    available = true;
    await campaignConfiguration.prepareCampaignModels(client, manifest);
    assert.equal(state.models[0].compatible, true);
    assert.deepEqual(state.assignments, originalAssignments);
    assert.equal(state.models[0].currentRevisionId, "revision");
});

test("campaign model preflight rejects incompatible controllerModel before lot admission", async () => {
    const manifest = configurableCampaign();
    manifest.configurations[0].controllerModel = "z-ai/glm-5.3-flash";
    const state = catalogue(true);
    state.assignments.push({ agent: "sources", catalogId: "model" });
    for (const profile of manifest.configurations)
        for (const choice of Object.values(profile.models))
            choice.model = "z-ai/glm-5.3-flash";
    const verifiedModels = [];
    let controllerCompatible = false;
    const client = {
        query: async () => structuredClone(state),
        action: async (_ref, args) => {
            if ("model" in args) {
                verifiedModels.push(args.model);
                if (!controllerCompatible)
                    throw new Error("model_not_compatible");
                return { model: args.model, contextWindowTokens: 32768 };
            }
            return { isDone: true, continueCursor: null };
        },
        mutation: async () =>
            assert.fail("Preflight cannot mutate settings or admit a lot"),
    };
    await assert.rejects(
        campaignConfiguration.prepareCampaignModels(client, manifest),
        /model_not_compatible/,
    );
    assert.deepEqual(verifiedModels, ["z-ai/glm-5.3-flash"]);
    controllerCompatible = true;
    const prepared = await campaignConfiguration.prepareCampaignModels(
        client,
        manifest,
    );
    assert.equal(
        prepared.some(
            (entry) =>
                entry.role === "controller" &&
                entry.model === "z-ai/glm-5.3-flash" &&
                entry.contextWindowTokens === 32768,
        ),
        true,
    );
});

test("prepareCampaignModels deduplicates shared model and controller preparations across roles and configurations", async () => {
    const manifest = configurableCampaign();
    for (const profile of manifest.configurations) {
        profile.controllerModel = "z-ai/glm-5.3-flash";
        for (const choice of Object.values(profile.models))
            choice.model = "z-ai/glm-5.3-flash";
    }
    const state = catalogue(true);
    state.assignments.push({ agent: "sources", catalogId: "model" });
    let refreshCalls = 0;
    let controllerCalls = 0;
    const client = {
        query: async () => structuredClone(state),
        action: async (_ref, args) => {
            if ("model" in args) {
                controllerCalls++;
                return { model: args.model, contextWindowTokens: 32768 };
            }
            refreshCalls++;
            return { isDone: true, continueCursor: null };
        },
    };
    const prepared = await campaignConfiguration.prepareCampaignModels(
        client,
        manifest,
    );
    assert.equal(refreshCalls, 1);
    assert.equal(controllerCalls, 1);
    assert.equal(prepared.length, manifest.configurations.length * 3);
});

test("configureCampaign skips redundant refresh for compatible models and deduplicates shared incompatible models", async () => {
    const rootA = mkdtempSync(join(tmpdir(), "campaign-compatible-"));
    const rootB = mkdtempSync(join(tmpdir(), "campaign-incompatible-"));
    try {
        const manifest = configurableCampaign();
        manifest.configurations[0].models = {
            workbench: { model: "fixture/shared", reasoning: "high" },
            sources: { model: "fixture/shared", reasoning: "high" },
        };
        const makeState = (compatible) => ({
            models: [
                {
                    ...catalogue(compatible).models[0],
                    model: "fixture/shared",
                    reasoning: { preference: "recommended" },
                },
            ],
            assignments: ["workbench", "sources"].map((agent) => ({
                agent,
                catalogId: "model",
                revision: 1,
            })),
            responseControl: { enabled: false, revision: 1 },
        });

        const stateA = makeState(true);
        let refreshCallsA = 0;
        await campaignConfiguration.configureCampaign(
            {
                query: async () => structuredClone(stateA),
                action: async () => {
                    refreshCallsA++;
                    return { isDone: true, continueCursor: null };
                },
                mutation: async (_ref, args) => {
                    stateA.models[0].revision++;
                    stateA.models[0].currentRevisionId = `rev-${stateA.models[0].revision}`;
                    stateA.models[0].reasoning.preference = args.preference;
                    return { revision: stateA.models[0].revision };
                },
            },
            manifest,
            rootA,
            "first",
        );
        assert.equal(refreshCallsA, 0);
        assert.equal(stateA.models[0].reasoning.preference, "high");

        const stateB = makeState(false);
        let refreshCallsB = 0;
        await campaignConfiguration.configureCampaign(
            {
                query: async () => structuredClone(stateB),
                action: async () => {
                    refreshCallsB++;
                    stateB.models[0].compatible = true;
                    return { isDone: true, continueCursor: null };
                },
                mutation: async (_ref, args) => {
                    stateB.models[0].revision++;
                    stateB.models[0].currentRevisionId = `rev-${stateB.models[0].revision}`;
                    stateB.models[0].reasoning.preference = args.preference;
                    return { revision: stateB.models[0].revision };
                },
            },
            manifest,
            rootB,
            "first",
        );
        assert.equal(refreshCallsB, 1);
        assert.equal(stateB.models[0].compatible, true);
    } finally {
        rmSync(rootA, { recursive: true, force: true });
        rmSync(rootB, { recursive: true, force: true });
    }
});
