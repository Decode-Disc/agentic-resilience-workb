import { internal } from "@convex/_generated/api";
import { afterEach, assert, expect, test, vi } from "vitest";
import { seedHistoryMission } from "@/__tests__/setup/execution-history";

afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
});

test("the common read persists a result without research or framing effects", async () => {
    const f = await seedHistoryMission();
    const before = await f.t.run((ctx) => ctx.db.get(f.runId));
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: f.missionId,
            expectedGeneration: 1,
            cause: "preserve-read",
            input: { kind: "consult_run_state" },
        },
    );
    const outcome = await f.t.action(internal.execution.operations.dispatch, {
        requestId,
        expectedGeneration: 1,
    });
    assert(outcome.kind === "success");
    expect(JSON.parse(outcome.valueJson)).toMatchObject({
        executionStatus: "idle",
        lifecycleState: "draft",
    });
    expect(await f.t.run((ctx) => ctx.db.get(requestId))).toMatchObject({
        status: "completed",
        outcome,
    });
    expect(await f.t.run((ctx) => ctx.db.get(f.runId))).toEqual(before);
});
