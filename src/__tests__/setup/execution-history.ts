import { api, internal } from "@convex/_generated/api";
import type { OperationInput } from "@convex/execution/agentDefinition";
import { assert } from "vitest";
import { seedConversation } from "./agent-harness";

/** Prior published exchange followed by an active, separately authorized response. */
export async function seedHistoryMission(
    priorText = "Original analyst question",
    options?: {
        reply: string;
        transactionLimits: Parameters<typeof seedConversation>[1];
    },
) {
    const f = await seedConversation(true, options?.transactionLimits);
    await f.client.mutation(api.execution.conversations.submit, {
        runId: f.runId,
        requestKey: "prior",
        delivery: "queue",
        text: priorText,
    });
    const priorTurnId = await f.t.mutation(
        internal.execution.conversations.claimTurn,
        { runId: f.runId },
    );
    assert(priorTurnId);
    const priorMissionId = await f.t.mutation(
        internal.execution.missions.start,
        {
            runId: f.runId,
            expectedGeneration: 1,
            conversationTurnId: priorTurnId,
            definitionId: "conversation_validation_v1",
            scope: { kind: "conversation_validation_v1" },
            requestKey: "prior",
        },
    );
    const begun = await f.t.mutation(internal.execution.invocations.begin, {
        missionId: priorMissionId,
        expectedGeneration: 1,
        taskKey: "prior",
        provenance: "simulation",
    });
    assert(begun.kind === "ready");
    await f.t.mutation(internal.execution.invocations.finish, {
        invocationId: begun.invocationId,
        expectedGeneration: 1,
        response: {
            kind: "complete",
            text: options?.reply ?? "Original assistant answer",
        },
    });
    await f.client.mutation(api.execution.conversations.submit, {
        runId: f.runId,
        requestKey: "current",
        delivery: "queue",
        text: "Current analyst question",
    });
    const turnId = await f.t.mutation(
        internal.execution.conversations.claimTurn,
        { runId: f.runId },
    );
    assert(turnId);
    const missionId = await f.t.mutation(internal.execution.missions.start, {
        runId: f.runId,
        expectedGeneration: 1,
        conversationTurnId: turnId,
        definitionId: "conversation_validation_v1",
        scope: { kind: "conversation_validation_v1" },
        requestKey: "current",
    });
    return { ...f, missionId, turnId };
}

type HistoryFixture = Awaited<ReturnType<typeof seedHistoryMission>>;
type HistoryInput = Extract<
    OperationInput,
    { kind: "consult_conversation" | "consult_mission_state" }
>;

/** Calls the real persisted dispatcher; no reader or accounting behavior is reproduced here. */
export async function dispatchHistory(f: HistoryFixture, input: HistoryInput) {
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: f.missionId,
            expectedGeneration: 1,
            cause: "history-test",
            input,
        },
    );
    const outcome = await f.t.action(internal.execution.operations.dispatch, {
        requestId,
        expectedGeneration: 1,
    });
    return { requestId, outcome };
}

/** One complete application invocation, including real repetition settlement. */
export async function runHistoryTurn(f: HistoryFixture, input: HistoryInput) {
    const mission = await f.t.run((ctx) => ctx.db.get(f.missionId));
    assert(mission);
    const begun = await f.t.mutation(internal.execution.invocations.begin, {
        missionId: f.missionId,
        expectedGeneration: 1,
        taskKey: `history:${mission.nextEventSequence}`,
        provenance: "simulation",
    });
    assert(begun.kind === "ready");
    const { kind, ...args } = input;
    const finished = await f.t.mutation(internal.execution.invocations.finish, {
        invocationId: begun.invocationId,
        expectedGeneration: 1,
        response: {
            kind: "operations",
            requests: [
                {
                    callId: "history",
                    name: kind,
                    inputJson: JSON.stringify(args),
                },
            ],
        },
    });
    const requestId = finished.requestIds[0];
    assert(requestId);
    const outcome = await f.t.action(internal.execution.operations.dispatch, {
        requestId,
        expectedGeneration: 1,
    });
    const settlement = await f.t.mutation(
        internal.execution.invocationLifecycle.settle,
        {
            invocationId: begun.invocationId,
            expectedGeneration: 1,
        },
    );
    return { requestId, outcome, settlement };
}
