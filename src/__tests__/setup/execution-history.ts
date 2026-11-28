import { api, internal } from "@convex/_generated/api";
import { stableStringify } from "@convex/domain/sourcePassages";
import { getAgentDefinition } from "@convex/execution/agentCatalog";
import type { OperationInput } from "@convex/execution/agentDefinition";
import { stageObservedBody } from "@convex/execution/observedReply";
import { preparePiReply } from "@convex/integrations/piInvocation";
import { assert } from "vitest";
import {
    beginFixtureInvocation,
    claimFixturePiLease,
    dispatchFixtureOperation,
} from "@/__tests__/setup/pi-mission";
import { seedConversation } from "./agent-harness";
import { retainFixtureOutput } from "./pi-mission";

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
        piLease: await claimFixturePiLease(f.t, priorMissionId, 1),
        missionId: priorMissionId,
        expectedGeneration: 1,
        taskKey: "prior",
        provenance: "simulation",
    });
    assert(begun.kind === "ready");
    const authority = {
        invocationId: begun.invocationId,
        expectedGeneration: 1,
    };
    const response = {
        kind: "complete" as const,
        text: options?.reply ?? "Original assistant answer",
    };
    const responseJson = stableStringify(response);
    const responseTextId = await f.t.action((ctx) =>
        stageObservedBody(ctx, authority, "response", responseJson),
    );
    const envelope = stableStringify({
        version: 1,
        provenance: "simulation",
        response,
    });
    const observableReplyTextId = await f.t.action((ctx) =>
        stageObservedBody(ctx, authority, "reply", envelope),
    );
    await retainFixtureOutput(f.t, {
        ...authority,
        ...(responseTextId ? { responseTextId } : { responseJson }),
        ...(observableReplyTextId
            ? { observableReplyTextId }
            : { observableReplyJson: envelope }),
    });
    const { mission } = await f.t.query(
        internal.execution.invocationLifecycle.forExecution,
        authority,
    );
    const preparedReply = await f.t.action((ctx) =>
        preparePiReply(
            ctx,
            authority,
            response,
            responseJson,
            getAgentDefinition(mission.definitionId, mission.definitionVersion),
        ),
    );
    assert(preparedReply && "textId" in preparedReply);
    await f.t.mutation(internal.execution.invocations.finish, {
        ...authority,
        preparedReply,
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
    const outcome = await dispatchFixtureOperation(f.t, {
        requestId,
        expectedGeneration: 1,
    });
    return { requestId, outcome };
}

/** One complete application invocation, including real repetition settlement. */
export async function runHistoryTurn(f: HistoryFixture, input: HistoryInput) {
    const mission = await f.t.run((ctx) => ctx.db.get(f.missionId));
    assert(mission);
    const begun = await beginFixtureInvocation(f.t, {
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
    const outcome = await dispatchFixtureOperation(f.t, {
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
