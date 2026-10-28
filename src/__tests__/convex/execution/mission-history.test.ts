import { internal } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { consultMissionState } from "@convex/execution/missionHistory";
import { expect, test } from "vitest";
import { seedInspectedEvidence } from "@/__tests__/setup/source-preparation";

test.each([
    "system",
    "agent",
] as const)("an invalid %s history request retains a refusal and permits a corrected read", async (actor) => {
    const { t, args } = await seedInspectedEvidence();
    const missionId = await t.mutation(internal.execution.missions.start, {
        runId: args.runId,
        corpusRevisionId: args.corpusRevisionId,
        definitionId: "saved_material_inspection_v1",
        requestKey: "history-refusal",
        expectedGeneration: args.executionGeneration,
    });
    let requestId: Id<"agentOperationRequests"> | undefined;
    if (actor === "system") {
        requestId = await t.mutation(internal.execution.operations.enqueue, {
            missionId,
            expectedGeneration: args.executionGeneration,
            cause: "history-refusal",
            input: { kind: "consult_mission_state", cursor: "bad" },
        });
    } else {
        const invocation = await t.mutation(
            internal.execution.invocations.begin,
            {
                missionId,
                expectedGeneration: args.executionGeneration,
                taskKey: "history-refusal",
                provenance: "simulation",
            },
        );
        if (invocation.kind !== "ready") throw new Error("Expected invocation");
        const response = await t.mutation(
            internal.execution.invocations.finish,
            {
                invocationId: invocation.invocationId,
                expectedGeneration: args.executionGeneration,
                response: {
                    kind: "operations",
                    requests: [
                        {
                            callId: "history",
                            name: "consult_mission_state",
                            inputJson: '{"cursor":"bad"}',
                        },
                    ],
                },
            },
        );
        requestId = response.requestIds[0];
    }
    if (!requestId) throw new Error("Expected retained history request");
    expect(
        await t.action(internal.execution.operations.dispatch, {
            requestId,
            expectedGeneration: args.executionGeneration,
        }),
    ).toEqual({ kind: "refused", code: "history_cursor_invalid" });
    expect(await t.run((ctx) => ctx.db.get(requestId))).toMatchObject({
        actor,
        status: "completed",
        outcome: { kind: "refused", code: "history_cursor_invalid" },
    });
    const correctedId = await t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId,
            expectedGeneration: args.executionGeneration,
            cause: "corrected-history",
            input: { kind: "consult_mission_state", cursor: "1:0" },
        },
    );
    expect(
        await t.action(internal.execution.operations.dispatch, {
            requestId: correctedId,
            expectedGeneration: args.executionGeneration,
        }),
    ).toMatchObject({ kind: "success" });
    expect(
        await t.mutation(internal.execution.invocations.begin, {
            missionId,
            expectedGeneration: args.executionGeneration,
            taskKey: "after-corrected-history",
            provenance: "simulation",
        }),
    ).toMatchObject({ kind: "ready" });
});

test("unexpected history read failures remain visible as errors", async () => {
    const { t, args } = await seedInspectedEvidence();
    const missionId = await t.mutation(internal.execution.missions.start, {
        runId: args.runId,
        corpusRevisionId: args.corpusRevisionId,
        definitionId: "saved_material_inspection_v1",
        requestKey: "history-transport",
        expectedGeneration: args.executionGeneration,
    });
    await expect(
        t.action((ctx) => {
            const runQuery: typeof ctx.runQuery = async () => {
                throw new Error("History read channel failed");
            };
            return consultMissionState(
                { ...ctx, runQuery },
                {
                    missionId,
                    expectedGeneration: args.executionGeneration,
                },
            );
        }),
    ).rejects.toThrow("History read channel failed");
});
