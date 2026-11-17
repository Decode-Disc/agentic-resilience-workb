import { internal } from "@convex/_generated/api";
import { expect, test } from "vitest";
import { seedInspectedEvidence } from "@/__tests__/setup/source-preparation";

test("invalid requests stop after three turns without progress and a new request key cannot restart the objective", async () => {
    const { t, args } = await seedInspectedEvidence();
    const start = {
        runId: args.runId,
        corpusRevisionId: args.corpusRevisionId,
        definitionId: "saved_material_inspection_v1" as const,
        requestKey: "loop",
        expectedGeneration: 4,
    };
    const missionId = await t.mutation(
        internal.execution.missions.start,
        start,
    );
    for (let turn = 0; turn < 3; turn++) {
        const invocation = await t.mutation(
            internal.execution.invocations.begin,
            {
                missionId,
                expectedGeneration: 4,
                taskKey: `turn-${turn}`,
                provenance: "simulation",
            },
        );
        if (invocation.kind !== "ready")
            throw new Error("Expected ready invocation");
        const result = await t.mutation(internal.execution.invocations.finish, {
            invocationId: invocation.invocationId,
            expectedGeneration: 4,
            response: {
                kind: "operations",
                workingNotes: "Another identifier is not progress.",
                requests: [
                    {
                        callId: `invalid-${turn}`,
                        name: "spawn_unrestricted_agent",
                        inputJson: "{}",
                    },
                ],
            },
        });
        expect(result.requestIds).toHaveLength(1);
        const requestId = result.requestIds[0];
        if (!requestId) throw new Error("Expected persisted request");
        expect(await t.run((ctx) => ctx.db.get(requestId))).toMatchObject({
            status: "completed",
            outcome: { kind: "refused", code: "invalid_operation_input" },
        });
        const settled = await t.mutation(
            internal.execution.invocations.settle,
            { invocationId: invocation.invocationId, expectedGeneration: 4 },
        );
        expect(settled.kind).toBe(turn === 2 ? "blocked" : "ready");
    }
    expect(await t.run((ctx) => ctx.db.get(missionId))).toMatchObject({
        noProgressTurns: 3,
        blockCode: "repetition_stop",
        status: "blocked",
        obligations: ["inspect_saved_material"],
    });
    await expect(
        t.mutation(internal.execution.invocations.begin, {
            missionId,
            expectedGeneration: 4,
            taskKey: "new-turn",
            provenance: "simulation",
        }),
    ).rejects.toThrow("repetition_stop");
    await expect(
        t.mutation(internal.execution.missions.start, {
            ...start,
            requestKey: "renamed-loop",
        }),
    ).rejects.toThrow("repetition_stop");
});
