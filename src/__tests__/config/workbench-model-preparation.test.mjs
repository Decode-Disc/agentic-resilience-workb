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
test("current profiles never trigger preparation or another model operation", async () => {
    const result = await prepareQualificationModel({
        query: async () => catalogue(true),
        action: async () => assert.fail("No preparation expected"),
    });
    assert.equal(result.refreshed, false);
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
            action: async () => assert.fail(),
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
            assert.equal(args.catalogId, "selected-catalogue");
            selected.compatible = true;
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
