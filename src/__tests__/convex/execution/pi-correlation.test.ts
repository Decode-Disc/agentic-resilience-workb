import { internal } from "@convex/_generated/api";
import type { QueryCtx } from "@convex/_generated/server";
import { operation } from "@convex/execution/piControl";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { afterEach, expect, test, vi } from "vitest";
import { seedPiMission } from "@/__tests__/setup/pi-mission";

const registeredOperation = operation as typeof operation & {
    _handler(
        ctx: QueryCtx,
        args: FunctionArgs<typeof internal.execution.piControl.operation>,
    ): Promise<
        FunctionReturnType<typeof internal.execution.piControl.operation>
    >;
};

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
});

test.each([
    false,
    true,
])("tool correlation reads only the selected request, including reused causes (%s)", async (reused) => {
    const { t, args } = await seedPiMission();
    const missionId = await t.mutation(internal.execution.missions.start, {
        runId: args.runId,
        expectedGeneration: 4,
        definitionId: "execution_validation_v1",
        scope: {
            kind: "execution_validation_v1",
            values: [1, 2, 3, 4, 5, 6, 7, 8],
        },
        requestKey: "correlation",
    });
    if (reused)
        for (let index = 0; index < 8; index++) {
            const requestId = await t.mutation(
                internal.execution.operations.enqueue,
                {
                    missionId,
                    expectedGeneration: 4,
                    cause: `earlier-${index}`,
                    input: { kind: "check_fixture_value", index },
                },
            );
            expect(
                await t.action(internal.execution.operations.dispatch, {
                    requestId,
                    expectedGeneration: 4,
                }),
            ).toMatchObject({ kind: "success" });
        }
    const begun = await t.mutation(internal.execution.invocations.begin, {
        missionId,
        expectedGeneration: 4,
        taskKey: "tool-batch",
        provenance: "simulation",
    });
    if (begun.kind !== "ready") throw new Error("Expected invocation");
    const finished = await t.mutation(internal.execution.invocations.finish, {
        invocationId: begun.invocationId,
        expectedGeneration: 4,
        response: {
            kind: "operations",
            requests: Array.from({ length: 8 }, (_, index) => ({
                callId: `current-${index}`,
                name: "check_fixture_value",
                inputJson: JSON.stringify({ index }),
            })),
        },
    });
    expect(finished).toMatchObject({ kind: "waiting" });
    expect(finished.requestIds).toHaveLength(8);
    await t.query(async (ctx) => {
        const get = vi.spyOn(ctx.db, "get");
        try {
            const request = await registeredOperation._handler(ctx, {
                missionId,
                expectedGeneration: 4,
                callId: "current-7",
            });
            expect(request).toMatchObject({
                _id: finished.requestIds[7],
                input: { kind: "check_fixture_value", index: 7 },
            });
            expect(
                get.mock.calls.filter(([id]) =>
                    finished.requestIds.includes(
                        id as (typeof finished.requestIds)[number],
                    ),
                ),
            ).toEqual([[finished.requestIds[7]]]);
        } finally {
            get.mockRestore();
        }
    });
    expect(
        await t.query(internal.execution.piControl.operation, {
            missionId,
            expectedGeneration: 4,
            callId: "missing",
        }),
    ).toBeNull();
});
