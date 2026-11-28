import { internal } from "@convex/_generated/api";
import { afterEach, assert, expect, test, vi } from "vitest";
import { beginFixtureInvocation } from "@/__tests__/setup/pi-mission";
import { readConversationPageWithBodies } from "@/__tests__/setup/retained-messages";
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
        "sources_prepared",
        "idle",
        undefined,
        "**What remains unfinished**\n\n- No research has been initiated yet; the 10-K has not been examined for relevant passages.\n- No documents have been processed, indexed, or cited in the current research state.",
        "Sources preparation has ended. Inspect the retained material and its limits. Question-led Investigation is not available yet.",
        true,
    ],
    [
        "sources_prepared",
        "idle",
        undefined,
        "**Usable documentary material:** None is currently available. The research program has not been started, and no sources have been collected or inspected.\n\nThe next action for the analyst is to click Start research.",
        "Sources preparation has ended. Inspect the retained material and its limits. Question-led Investigation is not available yet.",
        true,
    ],
    [
        "framing",
        "idle",
        undefined,
        "- No research has been initiated yet.",
        "- No research has been initiated yet.",
        false,
    ],
    [
        "framing",
        "idle",
        undefined,
        "No saved material is available. The research program has not been started.",
        "No saved material is available. The research program has not been started.",
        false,
    ],
    [
        "checking_public_evidence",
        "running",
        undefined,
        "Current material is retained. Research is paused.",
        "Research is running.",
        true,
    ],
    [
        "sources_prepared",
        "idle",
        undefined,
        "Earlier I said the research program has not been started; that was incorrect.",
        "Earlier I said the research program has not been started; that was incorrect.",
        false,
    ],
    [
        "sources_prepared",
        "idle",
        undefined,
        "> No research has been initiated yet.\n\nThat earlier description is incorrect.",
        "> No research has been initiated yet.\n\nThat earlier description is incorrect.",
        false,
    ],
    [
        "sources_prepared",
        "idle",
        undefined,
        "If no research has been initiated yet, Start research would be the next action. That condition does not apply here.",
        "If no research has been initiated yet, Start research would be the next action. That condition does not apply here.",
        false,
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
] as const)("closed %s/%s status grammar requests one correction and preserves final model wording", async (lifecycleState, executionStatus, pauseReason, text, expected, conflict) => {
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
    const invocation = await beginFixtureInvocation(t, {
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
    if (conflict) {
        expect(finished).toMatchObject({
            kind: "blocked",
            code: "mission_context_changed",
        });
        const context = await t.query(internal.execution.context.build, {
            missionId: active.missionId,
            expectedGeneration: 1,
        });
        assert(context.kind === "ready");
        expect(
            JSON.parse(context.inputJson).domain.responseControl.reminder,
        ).toContain(expected);
        const correction = await beginFixtureInvocation(t, {
            missionId: active.missionId,
            expectedGeneration: 1,
            taskKey: "status-revision",
            provenance: "simulation",
            nativeInput: await workbenchAdmissionInput(t, active.missionId),
        });
        assert(correction.kind === "ready");
        expect(
            (
                await t.mutation(internal.execution.invocations.finish, {
                    invocationId: correction.invocationId,
                    expectedGeneration: 1,
                    response: { kind: "complete", text },
                })
            ).kind,
        ).toBe("completed");
    } else expect(finished.kind).toBe("completed");
    const page = await readConversationPageWithBodies(client, {
        runId,
        paginationOpts: { numItems: 20, cursor: null },
    });
    const reply = page.page.find((m) => m.role === "assistant")?.text;
    expect(reply).toBe(text);
    expect(
        page.page.find((m) => m.role === "assistant")?.responseControl?.status,
    ).toBe(conflict ? "review_needed" : "not_checked");
    const retained = await t.run((ctx) => ctx.db.get(invocation.invocationId));
    expect(JSON.parse(retained?.outputJson ?? "{}").text).toBe(text);
    expect(await t.run((ctx) => ctx.db.get(runId))).toMatchObject({
        lifecycleState,
        executionStatus,
    });
});
