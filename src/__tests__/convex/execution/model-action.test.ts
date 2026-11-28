import { internal } from "@convex/_generated/api";
import { sha256Hex } from "@convex/domain/sourcePassages";
import { afterEach, expect, test, vi } from "vitest";
import { installModel } from "@/__tests__/setup/model-configuration";
import {
    beginFixtureInvocation,
    recordFixtureAttempt,
} from "@/__tests__/setup/pi-mission";
import { nativePiFixtureRoute } from "@/__tests__/setup/pi-native";
import { seedInspectedEvidence } from "@/__tests__/setup/source-preparation";

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
});

test.each([
    { disabled: true, code: "paid_work_disabled" },
    { disabled: false, code: "missing_configuration" },
])("Pi retains $code without dispatch or accounting", async ({
    disabled,
    code,
}) => {
    vi.useFakeTimers();
    vi.stubEnv("OPENROUTER_API_KEY", disabled ? "fixture-key" : "");
    const fetch = vi.fn(() => {
        throw new Error("Unexpected provider dispatch");
    });
    vi.stubGlobal("fetch", fetch);
    const { t, args } = await seedInspectedEvidence();
    await installModel(t, nativePiFixtureRoute, "saved_material_inspection");
    const missionId = await t.mutation(internal.execution.missions.start, {
        runId: args.runId,
        corpusRevisionId: args.corpusRevisionId,
        definitionId: "saved_material_inspection_v1",
        requestKey: code,
        expectedGeneration: args.executionGeneration,
    });
    if (disabled)
        await t.run((ctx) =>
            ctx.db.insert("paidWorkControls", {
                key: "global",
                enabled: false,
                updatedAt: Date.now(),
            }),
        );
    const budget = (await t.run((ctx) => ctx.db.get(args.runId)))
        ?.sourcePreparationBudget;
    await t.mutation(internal.execution.missions.resume, {
        missionId,
        expectedGeneration: args.executionGeneration,
    });
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(10), 500);
    expect(await t.run((ctx) => ctx.db.get(missionId))).toMatchObject({
        status: "blocked",
        blockCode: code,
    });
    expect(
        await t.run((ctx) => ctx.db.query("providerCalls").collect()),
    ).toEqual([]);
    expect(
        (await t.run((ctx) => ctx.db.get(args.runId)))?.sourcePreparationBudget,
    ).toEqual(budget);
    expect(fetch).not.toHaveBeenCalled();
});

test("a conflicting Pi observation rolls back settlement and a retry charges once", async () => {
    const { t, args } = await seedInspectedEvidence();
    await installModel(t, nativePiFixtureRoute, "saved_material_inspection");
    const missionId = await t.mutation(internal.execution.missions.start, {
        runId: args.runId,
        corpusRevisionId: args.corpusRevisionId,
        definitionId: "saved_material_inspection_v1",
        requestKey: "atomic-pi-observation",
        expectedGeneration: args.executionGeneration,
    });
    const admitted = await beginFixtureInvocation(t, {
        missionId,
        expectedGeneration: args.executionGeneration,
        taskKey: "observation",
        provenance: "live",
    });
    if (admitted.kind !== "ready")
        throw new Error("Expected admitted invocation");
    const mission = await t.run((ctx) => ctx.db.get(missionId));
    if (!mission) throw new Error("Expected persisted mission");
    const attempt = {
        missionId,
        invocationId: admitted.invocationId,
        runId: args.runId,
        corpusRevisionId: args.corpusRevisionId,
        executionGeneration: args.executionGeneration,
        workflowVersion: mission.definitionVersion,
        stepKey: "agent_reasoning",
        service: "model" as const,
        operation: "agent_reasoning",
        operationKey: `mission:${missionId}:invocation:${admitted.invocationId}:attempt:1`,
        attempt: 1,
        inputHash: sha256Hex(admitted.inputJson),
    };
    const receipt = await recordFixtureAttempt(t, {
        ...attempt,
        status: "started",
    });
    const snapshot = () =>
        t.run(async (ctx) => ({
            receipts: await ctx.db.query("providerCalls").collect(),
            invocation: await ctx.db.get(admitted.invocationId),
            budget: (await ctx.db.get(args.runId))?.sourcePreparationBudget,
        }));
    await t.run((ctx) =>
        ctx.db.patch(admitted.invocationId, { rawOutputJson: "original" }),
    );
    const before = await snapshot();
    expect(before).toMatchObject({
        receipts: [{ _id: receipt.providerCallId, status: "started" }],
        budget: { work: 0, reserved: 1, dispatches: 1 },
    });
    const response = {
        kind: "operations" as const,
        requests: [],
        workingNotes: "",
    };
    const terminal = {
        ...attempt,
        status: "succeeded" as const,
        dispatchOutcome: "response_received" as const,
    };
    await expect(
        t.mutation(internal.execution.invocationLifecycle.recordModelReply, {
            attempt: terminal,
            reply: {
                response,
                rawOutputJson: "conflicting observed output",
            },
        }),
    ).rejects.toThrow("invocation_result_conflict");
    expect(await snapshot()).toEqual(before);

    await t.mutation(internal.execution.invocationLifecycle.recordModelReply, {
        attempt: terminal,
        reply: { response },
    });
    const settled = await snapshot();
    expect(settled).toMatchObject({
        receipts: [{ _id: receipt.providerCallId, status: "succeeded" }],
        invocation: { receivedOutputJson: expect.any(String) },
        budget: { work: 1, reserved: 0, dispatches: 1 },
    });
    expect(
        JSON.parse(settled.invocation?.receivedOutputJson ?? "null"),
    ).toEqual(response);
    await t.mutation(internal.execution.invocationLifecycle.recordModelReply, {
        attempt: terminal,
        reply: { response },
    });
    expect(await snapshot()).toEqual(settled);
});
