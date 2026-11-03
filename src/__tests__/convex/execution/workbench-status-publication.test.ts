import { api, internal } from "@convex/_generated/api";
import { afterEach, assert, expect, test, vi } from "vitest";
import {
    seedWorkbench,
    workbenchAdmissionInput,
} from "@/__tests__/setup/workbench";

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
});

test.each([
    [
        "framing",
        "idle",
        undefined,
        "Research is running.",
        "Research has not started.",
        true,
    ],
    [
        "awaiting_source_review",
        "paused",
        "source_review",
        "**Current status:** Research has not started. Nothing has been approved.",
        "Research is waiting for source review. Review the proposed sources to continue.",
        true,
    ],
    [
        "checking_public_evidence",
        "paused",
        "analyst",
        "Research is running.",
        "Research is paused.",
        true,
    ],
    [
        "checking_public_evidence",
        "running",
        undefined,
        "Research is paused.",
        "Research is running.",
        true,
    ],
    [
        "awaiting_source_review",
        "paused",
        "source_review",
        "> Research has not started.\n\nThat was the earlier status.",
        "> Research has not started.\n\nThat was the earlier status.",
        false,
    ],
    [
        "awaiting_source_review",
        "paused",
        "source_review",
        "Earlier I said research has not started; that statement is now superseded.",
        "Earlier I said research has not started; that statement is now superseded.",
        false,
    ],
    [
        "awaiting_source_review",
        "paused",
        "source_review",
        "```text\nResearch has not started.\n```\n\nThis is a historical quotation.",
        "```text\nResearch has not started.\n```\n\nThis is a historical quotation.",
        false,
    ],
] as const)("publication uses observed %s/%s status instead of a contradictory model claim", async (lifecycleState, executionStatus, pauseReason, text, expected, conflict) => {
    const { t, client, runId } = await seedWorkbench(true);
    await t.run((ctx) =>
        ctx.db.patch(runId, {
            lifecycleState,
            executionStatus,
            pauseReason,
            agentExecutionVersion: 3,
        }),
    );
    const active = await t.mutation(
        internal.execution.conversations.startTurn,
        {
            runId,
            definitionId: "workbench_v1",
            scope: { kind: "workbench_v1" },
            simulation: true,
        },
    );
    assert(active);
    const invocation = await t.mutation(internal.execution.invocations.begin, {
        missionId: active.missionId,
        expectedGeneration: 1,
        taskKey: "status-publication",
        provenance: "simulation",
        nativeInput: await workbenchAdmissionInput(t, active.missionId),
    });
    assert(invocation.kind === "ready");
    const finished = await t.mutation(internal.execution.invocations.finish, {
        invocationId: invocation.invocationId,
        expectedGeneration: 1,
        response: { kind: "complete", text },
    });
    expect(finished.kind).toBe("completed");
    const page = await client.query(api.execution.conversations.listMessages, {
        runId,
        paginationOpts: { numItems: 20, cursor: null },
    });
    const reply = page.page.find((m) => m.role === "assistant")?.text;
    expect(reply).toBe(
        conflict
            ? expected +
                  "\n\nI couldn't confirm the explanation in this response. Your messages and recorded work remain available."
            : expected,
    );
    const retained = await t.run((ctx) => ctx.db.get(invocation.invocationId));
    expect(JSON.parse(retained?.outputJson ?? "{}").text).toBe(text);
    expect(await t.run((ctx) => ctx.db.get(runId))).toMatchObject({
        lifecycleState,
        executionStatus,
    });
});
