import { api, internal } from "@convex/_generated/api";
import { afterEach, expect, test, vi } from "vitest";
import workflowTest from "@/__tests__/convex/workflows/workflow-test-register.js";
import { seedConversation } from "@/__tests__/setup/agent-harness";

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
});

test("turn admission leaves valid later messages queued when their combined required context cannot fit", async () => {
    vi.useFakeTimers();
    const f = await seedConversation(true);
    workflowTest.register(f.t);
    for (const key of ["first", "second"])
        await f.client.mutation(api.execution.conversations.submit, {
            runId: f.runId,
            requestKey: key,
            delivery: "queue",
            text: key.charAt(0).repeat(64 * 1024),
        });
    const started = await f.t.mutation(
        internal.execution.conversations.startTurn,
        {
            runId: f.runId,
            definitionId: "conversation_validation_v1",
            scope: { kind: "conversation_validation_v1" },
            simulation: true,
        },
    );
    if (!started) throw new Error("Expected turn");
    expect(
        await f.client.query(api.execution.conversations.get, {
            runId: f.runId,
        }),
    ).toMatchObject({ queuedCount: 1, activeTurn: { messageCount: 1 } });
    expect(
        await f.t.query(internal.execution.context.build, {
            missionId: started.missionId,
            expectedGeneration: 1,
        }),
    ).toMatchObject({ kind: "ready" });
});
