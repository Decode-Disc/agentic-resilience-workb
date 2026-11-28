import { internal } from "@convex/_generated/api";
import { vi } from "vitest";
import {
    seedInspectedEvidence,
    startRetainedInspection,
} from "./source-preparation";

export async function seedPiMission(
    existing?: Parameters<typeof seedInspectedEvidence>[1],
) {
    vi.useFakeTimers();
    vi.stubEnv("E2E_FIXTURES_ENABLED", "true");
    vi.stubEnv("CONVEX_CLOUD_URL", "http://127.0.0.1:3212");
    const fixture = await seedInspectedEvidence({}, existing);
    const { t, args, invitationId } = fixture;
    await t.run((ctx) => ctx.db.patch(invitationId, { slotKey: "analyst-4" }));
    const contextId = await t.mutation(
        internal.runWorkspace.openBrowserTestContext,
        {
            slotKey: "analyst-4",
            contextKey: "harness-workflow",
            durationMs: 2 * 60 * 60 * 1000,
        },
    );
    await t.run((ctx) =>
        ctx.db.patch(args.runId, {
            purpose: "browser_test",
            browserTestContextId: contextId,
        }),
    );
    vi.stubGlobal(
        "fetch",
        vi.fn(() => {
            throw new Error("Unexpected provider I/O");
        }),
    );
    const missionId = await startRetainedInspection(t, {
        runId: args.runId,
        corpusRevisionId: args.corpusRevisionId,
        requestKey: "pi-workflow",
        generationBackend: { id: "pi-durable", version: 1 },
        expectedGeneration: 4,
    });
    return { ...fixture, missionId };
}

/** Retains real Pi context before starting the application mission; no model or provider is invoked. */
export async function seedPiHistory(
    t: Awaited<ReturnType<typeof seedInspectedEvidence>>["t"],
    missionId: import("@convex/_generated/dataModel").Id<"agentMissions">,
    generation: number,
    count: number,
    textLength: number,
) {
    const { openMissionPiStorage } = await import(
        "@convex/integrations/piStorage"
    );
    const { BACKGROUND_CONTEXT } = await import(
        "@earendil-works/chord/context"
    );
    const { Harness, createRegistry } = await import(
        "@earendil-works/pi-durable"
    );
    const { createModels } = await import("@earendil-works/pi-ai");
    await t.action(async (ctx) => {
        const storage = await openMissionPiStorage(
            ctx,
            missionId,
            generation,
            "seed-history",
            BACKGROUND_CONTEXT,
        );
        const harness = await Harness.open(
            storage,
            { models: createModels(), registry: createRegistry() },
            BACKGROUND_CONTEXT,
        );
        try {
            const root = await harness.root(BACKGROUND_CONTEXT);
            for (let i = 0; i < count; i++)
                await root.submit(
                    {
                        type: "write",
                        requestId: `history-${i}`,
                        entry: {
                            kind: "workbench.original",
                            data: { index: i },
                            model: [
                                {
                                    role: "user",
                                    content: [
                                        {
                                            type: "text",
                                            text:
                                                `EXACT-ORIGINAL-${i}:` +
                                                "x".repeat(textLength),
                                        },
                                    ],
                                    timestamp: Date.now(),
                                },
                            ],
                        },
                    },
                    BACKGROUND_CONTEXT,
                );
        } finally {
            await harness.close(BACKGROUND_CONTEXT);
        }
        await ctx.runMutation(internal.execution.piControl.closeWorker, {
            missionId,
            expectedGeneration: generation,
            writer: "seed-history",
        });
    });
}

type PiFixtureTest = Awaited<ReturnType<typeof seedInspectedEvidence>>["t"];

export async function claimFixturePiLease(
    t: PiFixtureTest,
    missionId: import("@convex/_generated/dataModel").Id<"agentMissions">,
    expectedGeneration: number,
) {
    const { sessionId, writer, epoch } = await t.mutation(
        internal.execution.piStore.claim,
        { missionId, expectedGeneration, writer: "fixture-writer" },
    );
    return { sessionId, writer, epoch };
}

/** Opens a real temporary writer only when a seeded Pi fixture has no active writer. */
async function withFixturePiWriter<Result>(
    t: PiFixtureTest,
    args: {
        missionId?: import("@convex/_generated/dataModel").Id<"agentMissions">;
        requestId?: import("@convex/_generated/dataModel").Id<"agentOperationRequests">;
        invocationId?: import("@convex/_generated/dataModel").Id<"agentInvocations">;
        expectedGeneration: number;
        piLease?: import("@convex/execution/piSession").PiDispatchLease;
    },
    perform: (
        lease?: import("@convex/execution/piSession").PiDispatchLease,
    ) => Promise<Result>,
): Promise<Result> {
    if (args.piLease) return perform(args.piLease);
    const state = await t.run(async (ctx) => {
        const missionId =
            args.missionId ??
            (args.requestId
                ? (await ctx.db.get(args.requestId))?.missionId
                : undefined) ??
            (args.invocationId
                ? (await ctx.db.get(args.invocationId))?.missionId
                : undefined);
        const mission = missionId ? await ctx.db.get(missionId) : null;
        if (
            mission?.executionRuntime !== "pi-durable" ||
            mission.generation !== args.expectedGeneration
        )
            return null;
        const { sessionForMission } = await import(
            "@convex/execution/piSession"
        );
        const session = await sessionForMission(ctx, mission);
        return {
            missionId: mission._id,
            active:
                session &&
                session.missionId === mission._id &&
                session.generation === args.expectedGeneration &&
                session.leaseUntil > Date.now()
                    ? {
                          sessionId: session._id,
                          writer: session.writer,
                          epoch: session.epoch,
                      }
                    : undefined,
        };
    });
    if (!state) return perform();
    const lease =
        state.active ??
        (await claimFixturePiLease(
            t,
            state.missionId,
            args.expectedGeneration,
        ));
    try {
        return await perform(lease);
    } finally {
        if (!state.active)
            await t.run(async (ctx) => {
                const session = await ctx.db.get(lease.sessionId);
                if (session?.epoch === lease.epoch)
                    await ctx.db.patch(lease.sessionId, {
                        leaseUntil: Date.now(),
                        ...(session.sequence === 0
                            ? { settledSequence: 0 }
                            : {}),
                    });
            });
    }
}

export async function dispatchFixtureOperation(
    t: PiFixtureTest,
    args: import("convex/server").FunctionArgs<
        typeof internal.execution.operations.dispatch
    >,
) {
    return withFixturePiWriter(t, args, (piLease) =>
        t.action(internal.execution.operations.dispatch, { ...args, piLease }),
    );
}

export async function claimFixtureOperation(
    t: PiFixtureTest,
    args: import("convex/server").FunctionArgs<
        typeof internal.execution.operations.claim
    >,
) {
    return withFixturePiWriter(t, args, (piLease) =>
        t.mutation(internal.execution.operations.claim, { ...args, piLease }),
    );
}

export async function beginFixtureInvocation(
    t: PiFixtureTest,
    args: import("convex/server").FunctionArgs<
        typeof internal.execution.invocations.begin
    >,
) {
    return withFixturePiWriter(t, args, (piLease) =>
        t.mutation(internal.execution.invocations.begin, { ...args, piLease }),
    );
}

export async function retainFixtureRequest(
    t: PiFixtureTest,
    args: import("convex/server").FunctionArgs<
        typeof internal.execution.invocationLifecycle.retainRequest
    >,
) {
    return withFixturePiWriter(t, args, (piLease) =>
        t.mutation(internal.execution.invocationLifecycle.retainRequest, {
            ...args,
            piLease,
        }),
    );
}

export async function authorizeFixtureDispatch(
    t: PiFixtureTest,
    args: import("convex/server").FunctionArgs<
        typeof internal.execution.invocationLifecycle.authorizeDispatch
    >,
) {
    return withFixturePiWriter(t, args, (piLease) =>
        t.query(internal.execution.invocationLifecycle.authorizeDispatch, {
            ...args,
            piLease,
        }),
    );
}

export async function recordFixtureAttempt(
    t: PiFixtureTest,
    args: import("convex/server").FunctionArgs<
        typeof internal.providerCalls.recordAttempt
    >,
) {
    if (
        !args.missionId ||
        args.executionGeneration === undefined ||
        args.status !== "started" ||
        args.service !== "model" ||
        (args.operation !== "agent_reasoning" &&
            args.operation !== "agent_compaction") ||
        args.operationRequestId ||
        args.sourceId ||
        args.acceptedDecisionId
    )
        return t.mutation(internal.providerCalls.recordAttempt, args);
    return withFixturePiWriter(
        t,
        {
            missionId: args.missionId,
            expectedGeneration: args.executionGeneration,
            piLease: args.piLease,
        },
        (piLease) =>
            t.mutation(internal.providerCalls.recordAttempt, {
                ...args,
                piLease,
            }),
    );
}

export async function stageFixtureRequest(
    t: PiFixtureTest,
    args: import("convex/server").FunctionArgs<
        typeof internal.execution.invocationLifecycle.stageRequest
    >,
) {
    return withFixturePiWriter(t, args, (piLease) =>
        t.mutation(internal.execution.invocationLifecycle.stageRequest, {
            ...args,
            piLease,
        }),
    );
}

export async function recordFixtureMissionAttempt(
    t: PiFixtureTest,
    args: import("convex/server").FunctionArgs<
        typeof internal.execution.providerCallReceipts.recordMissionModelAttempt
    >,
) {
    if (args.executionGeneration === undefined)
        return t.mutation(
            internal.execution.providerCallReceipts.recordMissionModelAttempt,
            args,
        );
    return withFixturePiWriter(
        t,
        {
            missionId: args.missionId,
            expectedGeneration: args.executionGeneration,
            piLease: args.piLease,
        },
        (piLease) =>
            t.mutation(
                internal.execution.providerCallReceipts
                    .recordMissionModelAttempt,
                { ...args, piLease },
            ),
    );
}
