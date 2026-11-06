import assert from "node:assert/strict";
import { test } from "node:test";
import { prepareQualificationModel } from "../../../scripts/evaluations/workbench-browser/model-preparation.ts";

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
