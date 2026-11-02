import { writeFileSync } from "node:fs";
import { internal } from "@convex/_generated/api";
import { registeredAgentDefinitions } from "@convex/execution/agentCatalog";
import { afterEach, assert, expect, test, vi } from "vitest";
import { seedHistoryMission } from "@/__tests__/setup/execution-history";

afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
});

test("registered operation versions and native schema distinctions survive relocation", () => {
    const definitions = registeredAgentDefinitions();
    const inventory = definitions.map((d) => ({
        id: d.id,
        version: d.version,
        operations: Object.entries(d.operations)
            .map(([name, op]) => ({
                name,
                version: op.version,
                description: op.description,
                input: op.inputValidator.json,
            }))
            .sort((a, b) => a.name.localeCompare(b.name)),
    }));
    expect(inventory.map((d) => `${d.id}:${d.version}`).sort()).toEqual([
        "conversation_validation_v1:1",
        "execution_validation_v1:1",
        "saved_material_inspection_v1:1",
        "workbench_v1:1",
        "workbench_v1:2",
    ]);
    for (const d of definitions) {
        expect(d.operations).toHaveProperty("consult_conversation");
        expect(d.operations).toHaveProperty("consult_mission_state");
        expect(d.operations).toHaveProperty("consult_run_state");
    }
    const versions = definitions.filter((d) => d.id === "workbench_v1");
    expect(versions.map((d) => d.operations.adjust_framing?.version)).toEqual([
        1, 2,
    ]);
    expect(
        versions.map((d) => d.operations.transmit_source_request?.version),
    ).toEqual([1, 2]);
    if (process.env.EXECUTION_INVENTORY_OUTPUT)
        writeFileSync(
            process.env.EXECUTION_INVENTORY_OUTPUT,
            `${JSON.stringify(inventory, null, 2)}\n`,
        );
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
