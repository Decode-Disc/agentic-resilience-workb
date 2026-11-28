import { api, internal } from "@convex/_generated/api";
import { afterEach, assert, beforeEach, expect, test, vi } from "vitest";
import {
    beginFixtureInvocation,
    dispatchFixtureOperation,
} from "@/__tests__/setup/pi-mission";
import { readConversationPageWithBodies } from "@/__tests__/setup/retained-messages";
import { activateSourcesMission } from "@/__tests__/setup/sources-mission";
import {
    seedWorkbench,
    workbenchAdmissionInput,
} from "@/__tests__/setup/workbench";

// Research starts run through the Sources mission; there is no corpus-approval fallback.
beforeEach(() => activateSourcesMission());

test.each([
    null,
    "official_commercial_terms",
    undefined,
] as const)("documentary registration distinguishes an explicit routing choice from omission: %s", async (coverageRole) => {
    const { t, client, runId } = await seedWorkbench(true);
    await client.mutation(api.framing.save, {
        runId,
        expectedRevision: 1,
        requestKey: "fixed-program",
        content: {
            scope: "Claims coordination",
            questions: [
                {
                    id: "switching",
                    shortLabel: "Switching",
                    text: "What constrains provider switching?",
                    rationale: "Inspect dependencies.",
                },
            ],
        },
    });
    await client.mutation(api.framing.startResearch, {
        runId,
        expectedRevision: 2,
        requestKey: "analyst-start",
    });
    await client.mutation(api.execution.researchControl.pause, {
        runId,
        expectedGeneration: 1,
    });
    await t.mutation(internal.execution.researchControl.checkpoint, { runId });
    // Historical dossiers retain the routing choice after preparation execution retires.
    await t.run((ctx) => ctx.db.patch(runId, { sourcesProtocol: undefined }));
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
    const message = await t.run((ctx) =>
        ctx.db
            .query("agentMessageDeliveries")
            .withIndex("by_run_and_status", (q) =>
                q.eq("runId", runId).eq("status", "active"),
            )
            .first(),
    );
    assert(message);
    const requestId = await t.mutation(internal.execution.operations.enqueue, {
        missionId: active.missionId,
        expectedGeneration: 1,
        cause: "documentary-registration",
        input: {
            kind: "transmit_source_request",
            messageId: message._id,
            interpretedNeed: "Inspect public switching restrictions.",
            coverageRole,
        },
    });
    const outcome = await dispatchFixtureOperation(t, {
        requestId,
        expectedGeneration: 1,
    });
    if (coverageRole === undefined) {
        expect(outcome).toMatchObject({
            kind: "refused",
            code: "source_request_target_required",
        });
        expect(
            await t.run((ctx) =>
                ctx.db.query("workbenchInstructions").collect(),
            ),
        ).toEqual([]);
        return;
    }
    expect(outcome.kind).toBe("success");
    expect(
        await t.run((ctx) => ctx.db.query("workbenchInstructions").first()),
    ).toMatchObject({
        status: "limited",
        ...(coverageRole ? { coverageRole } : {}),
    });
    expect(await t.run((ctx) => ctx.db.get(runId))).toMatchObject({
        executionStatus: "paused",
        executionGeneration: 2,
    });
    const invocation = await beginFixtureInvocation(t, {
        missionId: active.missionId,
        expectedGeneration: 1,
        taskKey: "documentary-confirmation",
        provenance: "simulation",
        nativeInput: await workbenchAdmissionInput(t, active.missionId),
    });
    assert(invocation.kind === "ready");
    await t.mutation(internal.execution.invocations.finish, {
        invocationId: invocation.invocationId,
        expectedGeneration: 1,
        response: {
            kind: "complete",
            text: "Switching restrictions deserve inspection.",
        },
    });
    const page = await readConversationPageWithBodies(client, {
        runId,
        paginationOpts: { numItems: 20, cursor: null },
    });
    const text = page.page.find((item) => item.role === "assistant")?.text;
    expect(text).toContain("Switching restrictions deserve inspection.");
    expect(text).toContain(
        "This request is recorded, but it cannot be executed through the documentary operations currently available.",
    );
    expect(text).not.toContain("transmit_source_request");
});

test("a control and an independent question retain the explanation and the actual control confirmation", async () => {
    const { t, client, runId } = await seedWorkbench(true);
    const queued = await t.run((ctx) =>
        ctx.db
            .query("agentMessageDeliveries")
            .withIndex("by_run_and_status", (q) =>
                q.eq("runId", runId).eq("status", "queued"),
            )
            .first(),
    );
    assert(queued);
    await client.mutation(api.execution.conversations.removeQueued, {
        runId,
        messageId: queued._id,
    });
    await client.mutation(api.execution.conversations.submit, {
        runId,
        requestKey: "start-command",
        text: "Start research now",
        delivery: "queue",
    });
    await client.mutation(api.execution.conversations.submit, {
        runId,
        requestKey: "economic-question",
        text: "Also explain why switching matters.",
        delivery: "queue",
    });
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
        taskKey: "mixed-publication",
        provenance: "simulation",
        nativeInput: await workbenchAdmissionInput(t, active.missionId),
    });
    assert(invocation.kind === "ready");
    await t.mutation(internal.execution.invocations.finish, {
        invocationId: invocation.invocationId,
        expectedGeneration: 1,
        response: {
            kind: "complete",
            text: "Switching costs can constrain substitution.",
        },
    });
    const page = await readConversationPageWithBodies(client, {
        runId,
        paginationOpts: { numItems: 20, cursor: null },
    });
    expect(
        page.page.find((message) => message.role === "assistant")?.text,
    ).toBe(
        "Switching costs can constrain substitution.\n\nResearch has not started.",
    );
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
});

test.each([
    {
        mode: "pending pause",
        action: "pause",
        effective: false,
        thenResume: false,
        expected:
            "Pause requested. Research will pause after the work already in progress finishes.",
    },
    {
        mode: "effective pause",
        action: "pause",
        effective: true,
        thenResume: false,
        expected: "Research is paused. Resume research to continue.",
    },
    {
        mode: "resume at source review",
        action: "resume",
        effective: false,
        thenResume: false,
        expected:
            "Research is waiting for source review. Review the proposed sources to continue.",
    },
    {
        mode: "pause superseded by resume",
        action: "pause",
        effective: false,
        thenResume: true,
        expected:
            "The pause request was recorded. Research is not currently paused.\n\nResearch has resumed.",
    },
] as const)("a control-only response confirms $mode from its real operation and retained prerequisite", async ({
    action,
    effective,
    thenResume,
    expected,
}) => {
    const { t, client, runId } = await seedWorkbench(true);
    const original = await t.run((ctx) =>
        ctx.db
            .query("agentMessageDeliveries")
            .withIndex("by_run_and_status", (q) =>
                q.eq("runId", runId).eq("status", "queued"),
            )
            .first(),
    );
    assert(original);
    await client.mutation(api.execution.conversations.removeQueued, {
        runId,
        messageId: original._id,
    });
    const messageId = await client.mutation(
        api.execution.conversations.submit,
        {
            runId,
            requestKey: "control",
            text: `${action} research`,
            delivery: "queue",
        },
    );
    const resumeMessageId = thenResume
        ? await client.mutation(api.execution.conversations.submit, {
              runId,
              requestKey: "resume-after-pause",
              text: "Resume research.",
              delivery: "queue",
          })
        : undefined;
    await t.run(async (ctx) => {
        const run = await ctx.db.get(runId);
        assert(run);
        await ctx.db.patch(runId, {
            fixedFramingRevisionId: run.currentFramingRevisionId,
            agentExecutionVersion: 3,
            lifecycleState:
                action === "resume"
                    ? "awaiting_source_review"
                    : "discovering_sources",
            executionStatus: action === "resume" ? "paused" : "running",
            pauseReason: action === "resume" ? "analyst" : undefined,
        });
    });
    const active = await t.mutation(
        internal.execution.conversations.startTurn,
        {
            runId,
            definitionId: "workbench_v1",
            scope: { kind: "workbench_v1" },
            simulation: true,
        },
    );
    if (!active) throw new Error("Missing turn");
    const requestId = await t.mutation(internal.execution.operations.enqueue, {
        missionId: active.missionId,
        expectedGeneration: 1,
        cause: "explicit-control",
        input: { kind: "control_research", action, messageId },
    });
    expect(
        (
            await dispatchFixtureOperation(t, {
                requestId,
                expectedGeneration: 1,
            })
        ).kind,
    ).toBe("success");
    if (resumeMessageId) {
        const resumeId = await t.mutation(
            internal.execution.operations.enqueue,
            {
                missionId: active.missionId,
                expectedGeneration: 1,
                cause: "subsequent-resume",
                input: {
                    kind: "control_research",
                    action: "resume",
                    messageId: resumeMessageId,
                },
            },
        );
        expect(
            (
                await dispatchFixtureOperation(t, {
                    requestId: resumeId,
                    expectedGeneration: 1,
                })
            ).kind,
        ).toBe("success");
    }
    if (effective)
        await t.mutation(internal.execution.researchControl.checkpoint, {
            runId,
        });
    const invocation = await beginFixtureInvocation(t, {
        nativeInput: await workbenchAdmissionInput(t, active.missionId),
        missionId: active.missionId,
        expectedGeneration: 1,
        taskKey: "confirmation",
        provenance: "simulation",
    });
    if (invocation.kind !== "ready") throw new Error("Missing invocation");
    expect(
        await t.mutation(internal.execution.invocations.finish, {
            invocationId: invocation.invocationId,
            expectedGeneration: 1,
            response: {
                kind: "complete",
                text: "Unsupported model confirmation.",
            },
        }),
    ).toMatchObject({ kind: "completed" });
    const page = await readConversationPageWithBodies(client, {
        runId,
        paginationOpts: { numItems: 20, cursor: null },
    });
    expect(
        page.page.find((message) => message.role === "assistant")?.text,
    ).toBe(expected);
}, 15000);
