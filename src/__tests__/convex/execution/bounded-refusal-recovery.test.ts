import { internal } from "@convex/_generated/api";
import { afterEach, assert, expect, test, vi } from "vitest";
import { seedInspectedEvidence } from "@/__tests__/setup/source-preparation";
import { seedCapturedSources } from "@/__tests__/setup/sources-mission";

afterEach(() => vi.unstubAllEnvs());

test.each([
    ["sources", "refuse"],
    ["inspection", "refuse"],
    ["sources", "complete"],
    ["inspection", "complete"],
] as const)("%s permits one material restoration, then %s preserves the original failure limit", async (binding, next) => {
    const f = await (async () => {
        if (binding === "sources") return seedCapturedSources();
        const inspected = await seedInspectedEvidence();
        const missionId = await inspected.t.mutation(
            internal.execution.missions.start,
            {
                runId: inspected.runId,
                corpusRevisionId: inspected.corpusRevisionId,
                expectedGeneration: 4,
                definitionId: "saved_material_inspection_v1",
                requestKey: "bounded-recovery",
            },
        );
        return { ...inspected, missionId };
    })();
    const missionId = f.missionId;
    async function turn(
        taskKey: string,
        name: string,
        args: Record<string, unknown>,
    ) {
        const begun = await f.t.mutation(internal.execution.invocations.begin, {
            missionId,
            expectedGeneration: 4,
            taskKey,
            provenance: "simulation",
        });
        assert(begun.kind === "ready");
        const result = await f.t.mutation(
            internal.execution.invocations.finish,
            {
                invocationId: begun.invocationId,
                expectedGeneration: 4,
                response: {
                    kind: "operations",
                    requests: [
                        {
                            callId: taskKey,
                            name,
                            inputJson: JSON.stringify(args),
                        },
                    ],
                },
            },
        );
        assert(result.requestIds[0]);
        const outcome = await f.t.action(
            internal.execution.operations.dispatch,
            { requestId: result.requestIds[0], expectedGeneration: 4 },
        );
        const settlement = await f.t.mutation(
            internal.execution.invocations.settle,
            { invocationId: begun.invocationId, expectedGeneration: 4 },
        );
        return { outcome, settlement, invocationId: begun.invocationId };
    }
    const args = { sourceId: f.sourceId, passageOrder: 0 };
    expect(
        (await turn("initial-read", "read_in_context", args)).outcome.kind,
    ).toBe("success");
    await turn("refused-one", "unregistered_operation", {});
    await turn("refused-two", "unregistered_operation", {});
    const recovery = await turn("restore", "read_in_context", args);
    expect(recovery.outcome.kind).toBe("success");
    expect(recovery.settlement).toMatchObject({ kind: "ready" });
    const restored = await f.t.run((ctx) => ctx.db.get(missionId));
    expect(restored?.noProgressTurns).toBe(2);
    await f.t.mutation(internal.execution.invocations.settle, {
        invocationId: recovery.invocationId,
        expectedGeneration: 4,
    });
    expect(await f.t.run((ctx) => ctx.db.get(missionId))).toEqual(restored);
    if (next === "refuse") {
        expect(
            (await turn("third-refusal", "unregistered_operation", {}))
                .settlement,
        ).toMatchObject({ kind: "blocked", code: "repetition_stop" });
    } else {
        const begun = await f.t.mutation(internal.execution.invocations.begin, {
            missionId,
            expectedGeneration: 4,
            taskKey: "honest-completion",
            provenance: "simulation",
        });
        assert(begun.kind === "ready");
        const completion = await f.t.mutation(
            internal.execution.invocations.finish,
            {
                invocationId: begun.invocationId,
                expectedGeneration: 4,
                response:
                    binding === "sources"
                        ? {
                              kind: "complete",

                              needs: [
                                  {
                                      needId: "common-context",

                                      unfinished: [
                                          "No controlled material yet.",
                                      ],
                                  },
                              ],
                          }
                        : { kind: "complete", captureIds: [f.captureId] },
            },
        );
        expect(completion.kind).toBe("completed");
        expect((await f.t.run((ctx) => ctx.db.get(missionId)))?.status).toBe(
            "completed",
        );
    }
});
