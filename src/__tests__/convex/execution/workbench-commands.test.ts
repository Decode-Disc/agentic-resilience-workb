import { api, internal } from "@convex/_generated/api";
import { approvalOutcomeText } from "@convex/domain/approvalCopy";
import { submitAuthorizedMessage } from "@convex/execution/conversations";
import { createNativeInputDelivery } from "@convex/integrations/piNativeInput";
import { openMissionPiStorage } from "@convex/integrations/piStorage";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai";
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import { getFunctionName } from "convex/server";
import { afterEach, assert, beforeEach, expect, test, vi } from "vitest";
import { activateSourcesMission } from "@/__tests__/setup/sources-mission";
import {
    client,
    reachTimeLimit,
    seedExpiredPreparation,
    seedTimeLimitConversation,
} from "@/__tests__/setup/sources-time-limit";
import { seedWorkbench } from "@/__tests__/setup/workbench";

// Research starts run through the Sources mission; there is no corpus-approval fallback.
beforeEach(() => activateSourcesMission());

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
});

test("a slash command records the actual unstarted status without a response mission or model invocation", async () => {
    const { t, client, runId } = await seedWorkbench();
    const framing = await client.query(api.framing.get, { runId });
    const before = await client.query(api.execution.conversations.get, {
        runId,
    });
    const result = await client.mutation(api.workbench.command, {
        runId,
        requestKey: "unstarted-pause",
        command: "/pause",
        expectedGeneration: 1,
    });
    expect(result).toMatchObject({
        outcome: "refused",
        text: "Research has not started.",
    });
    expect(
        (await client.query(api.workbench.snapshot, { runId })).research.actions
            .start.applicable,
    ).toBe(false);
    const page = await client.query(api.execution.conversations.listMessages, {
        runId,
        paginationOpts: { numItems: 20, cursor: null },
    });
    expect(page.page.filter((m) => m._id === result.messageId)).toMatchObject([
        { role: "user", text: "/pause", status: "processed" },
    ]);
    expect(
        page.page.filter((m) => m._id === result.confirmationMessageId),
    ).toMatchObject([
        { role: "assistant", text: result.text, status: "processed" },
    ]);
    expect(await client.query(api.framing.get, { runId })).toEqual(framing);
    expect(
        await client.query(api.execution.conversations.get, { runId }),
    ).toEqual(before);
    expect(
        await t.run((ctx) => ctx.db.query("agentMissions").collect()),
    ).toEqual([]);
    expect(
        await t.run((ctx) => ctx.db.query("agentInvocations").collect()),
    ).toEqual([]);
    expect(
        await t.run((ctx) => ctx.db.query("providerCalls").collect()),
    ).toEqual([]);
});

test("pause and resume act immediately through existing controls without creating conversational work", async () => {
    const { t, client, runId } = await startedWorkbench();
    const active = await t.mutation(
        internal.execution.conversations.startTurn,
        {
            runId,
            definitionId: "workbench_v1",
            scope: { kind: "workbench_v1" },
            simulation: true,
        },
    );
    expect(active).not.toBeNull();
    const before = await client.query(api.execution.conversations.get, {
        runId,
    });
    const pause = await client.mutation(api.workbench.command, {
        runId,
        requestKey: "pause",
        command: "/pause",
        expectedGeneration: 1,
    });
    expect(pause).toMatchObject({
        outcome: "applied",
        text: "Pause requested. Research will pause after the work already in progress finishes.",
    });
    expect(await t.run((ctx) => ctx.db.get(runId))).toMatchObject({
        executionStatus: "running",
        researchPauseRequested: true,
    });
    expect(
        await client.query(api.execution.conversations.get, { runId }),
    ).toEqual(before);
    await t.mutation(internal.execution.researchControl.checkpoint, { runId });
    const resumed = await client.mutation(api.workbench.command, {
        runId,
        requestKey: "resume",
        command: "/resume",
        expectedGeneration: 2,
    });
    expect(resumed).toMatchObject({
        outcome: "applied",
        text: "Research has resumed.",
    });
    expect(await t.run((ctx) => ctx.db.get(runId))).toMatchObject({
        executionStatus: "running",
        executionGeneration: 3,
    });
    expect(
        await t.run((ctx) => ctx.db.query("agentInvocations").collect()),
    ).toEqual([]);
    expect(
        await t.run((ctx) => ctx.db.query("providerCalls").collect()),
    ).toEqual([]);
});

test("replaying a command retains its original receipt and never repeats a later control effect", async () => {
    const { t, client, runId } = await startedWorkbench();
    const input = {
        runId,
        requestKey: "once",
        command: "/pause" as const,
        expectedGeneration: 1,
    };
    const first = await client.mutation(api.workbench.command, input);
    await client.mutation(api.workbench.command, {
        runId,
        requestKey: "cancel-pause",
        command: "/resume",
        expectedGeneration: 1,
    });
    const current = await t.run((ctx) => ctx.db.get(runId));
    expect(await client.mutation(api.workbench.command, input)).toEqual(first);
    expect(await t.run((ctx) => ctx.db.get(runId))).toEqual(current);
    await expect(
        client.mutation(api.workbench.command, {
            ...input,
            command: "/resume",
        }),
    ).rejects.toThrow("message_identity_conflict");
    await expect(
        client.mutation(api.workbench.command, {
            ...input,
            expectedGeneration: 2,
        }),
    ).rejects.toThrow("message_identity_conflict");
    const messages = await client.query(
        api.execution.conversations.listMessages,
        { runId, paginationOpts: { numItems: 20, cursor: null } },
    );
    expect(messages.page.filter((m) => m.text === "/pause")).toHaveLength(1);
});

test("commands preserve human prerequisites and reject stale generations without changing research", async () => {
    const { t, client, runId } = await startedWorkbench();
    await t.run((ctx) =>
        ctx.db.patch(runId, {
            executionStatus: "paused",
            pauseReason: "source_review",
        }),
    );
    const before = await t.run((ctx) => ctx.db.get(runId));
    expect(
        await client.mutation(api.workbench.command, {
            runId,
            requestKey: "prerequisite",
            command: "/resume",
            expectedGeneration: 1,
        }),
    ).toMatchObject({
        outcome: "refused",
        text: "Research is waiting for source review. Review the proposed sources to continue.",
    });
    expect(await t.run((ctx) => ctx.db.get(runId))).toEqual(before);
    const pause = await client.mutation(api.workbench.command, {
        runId,
        requestKey: "pause-at-prerequisite",
        command: "/pause",
        expectedGeneration: 1,
    });
    expect(pause).toMatchObject({
        outcome: "refused",
        text: "Research is waiting for source review. Review the proposed sources to continue.",
    });
    expect(pause.text).not.toMatch(/changed|stale_execution|source_review/);
    expect(await t.run((ctx) => ctx.db.get(runId))).toEqual(before);
    expect(
        await client.mutation(api.workbench.command, {
            runId,
            requestKey: "stale",
            command: "/pause",
            expectedGeneration: 2,
        }),
    ).toMatchObject({
        outcome: "refused",
        text: "Research changed while this command was submitted. Check the current state and try again.",
    });
    expect(await t.run((ctx) => ctx.db.get(runId))).toEqual(before);
});

test("authentication and the native conversation contract are required before recording a command", async () => {
    const { t, client, runId } = await seedWorkbench();
    const input = {
        runId,
        requestKey: "auth",
        command: "/pause" as const,
        expectedGeneration: 1,
    };
    await expect(t.mutation(api.workbench.command, input)).rejects.toThrow();
    await expect(
        t
            .withIdentity({ subject: "other-user" })
            .mutation(api.workbench.command, input),
    ).rejects.toThrow();
    const conversation = await t.run((ctx) =>
        ctx.db.query("agentConversations").first(),
    );
    assert(conversation);
    await t.run((ctx) =>
        ctx.db.patch(conversation._id, { definitionVersion: 1 }),
    );
    await expect(client.mutation(api.workbench.command, input)).rejects.toThrow(
        "native_conversation_required",
    );
    expect(
        (
            await client.query(api.execution.conversations.listMessages, {
                runId,
                paginationOpts: { numItems: 20, cursor: null },
            })
        ).page.filter((m) => m.delivery === "control"),
    ).toEqual([]);
});

test.each([
    "/start",
    "/pause and explain",
    "Pause research",
])("only explicit slash tokens enter the command API: %s", async (command) => {
    const { t, client, runId } = await seedWorkbench();
    const input = {
        runId,
        requestKey: "invalid-command",
        command,
        expectedGeneration: 1,
    };
    await expect(
        client.mutation(api.workbench.command, {
            ...input,
            command: command as "/pause",
        }),
    ).rejects.toThrow();
    expect(
        await t.run((ctx) => ctx.db.query("providerCalls").collect()),
    ).toEqual([]);
});

async function startedWorkbench(local = true) {
    const setup = await seedWorkbench(local);
    await setup.client.mutation(api.framing.save, {
        runId: setup.runId,
        expectedRevision: 1,
        requestKey: "program",
        content: {
            scope: "Claims coordination",
            questions: [
                {
                    id: "switching",
                    shortLabel: "Switching",
                    text: "What constrains platform switching?",
                    rationale: "Inspect dependencies.",
                },
            ],
        },
    });
    await setup.client.mutation(api.framing.startResearch, {
        runId: setup.runId,
        expectedRevision: 2,
        requestKey: "explicit-start",
    });
    return setup;
}

test("a lost control acknowledgement reopens the same passive entry without a provider", async () => {
    const { t, client, runId } = await seedWorkbench(true);
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
    const receipt = await client.mutation(api.workbench.command, {
        runId,
        requestKey: "ack-loss",
        command: "/pause",
        expectedGeneration: 1,
    });
    const args = { missionId: active.missionId, expectedGeneration: 1 };
    async function synchronize(loseAck: boolean) {
        return t.action(async (ctx) => {
            const storage = await openMissionPiStorage(
                ctx,
                args.missionId,
                1,
                "control-test",
                BACKGROUND_CONTEXT,
            );
            const harness = await Harness.open(
                storage,
                { models: createModels(), registry: createRegistry() },
                BACKGROUND_CONTEXT,
            );
            try {
                const root = await harness.root(BACKGROUND_CONTEXT);
                const commandCtx: typeof ctx = {
                    ...ctx,
                    runMutation: async (reference, ...parameters) => {
                        if (
                            loseAck &&
                            getFunctionName(reference) ===
                                "execution/piStore:recordControlInputs"
                        )
                            throw new Error(
                                "Control acknowledgement unavailable",
                            );
                        return ctx.runMutation(reference, ...parameters);
                    },
                };
                await createNativeInputDelivery(
                    commandCtx,
                    args,
                    storage,
                ).synchronizeControls(root, BACKGROUND_CONTEXT);
                return root.entries(
                    { order: "ascending" },
                    100,
                    undefined,
                    BACKGROUND_CONTEXT,
                );
            } finally {
                await harness.close(BACKGROUND_CONTEXT);
            }
        });
    }
    await expect(synchronize(true)).rejects.toThrow(
        "Control acknowledgement unavailable",
    );
    expect(await t.run((ctx) => ctx.db.get(receipt.messageId))).toMatchObject({
        nativeControlStatus: "pending",
    });
    const entries = (await synchronize(false)).items.filter(
        (e) => e.kind === "workbench.control-command",
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]?.model?.map((m) => m.role)).toEqual([
        "user",
        "assistant",
    ]);
    expect(await t.run((ctx) => ctx.db.get(receipt.messageId))).toMatchObject({
        nativeControlStatus: "recorded",
    });
    expect(
        await t.run((ctx) => ctx.db.query("agentInvocations").collect()),
    ).toEqual([]);
    expect(
        await t.run((ctx) => ctx.db.query("providerCalls").collect()),
    ).toEqual([]);
});

test("passive control synchronization paginates beyond one read batch", async () => {
    const { t, client, runId } = await seedWorkbench(true);
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
    for (let n = 0; n < 23; n++)
        await client.mutation(api.workbench.command, {
            runId,
            requestKey: `page-${n}`,
            command: "/pause",
            expectedGeneration: 1,
        });
    const count = await t.action(async (ctx) => {
        const storage = await openMissionPiStorage(
            ctx,
            active.missionId,
            1,
            "pages",
            BACKGROUND_CONTEXT,
        );
        const harness = await Harness.open(
            storage,
            { models: createModels(), registry: createRegistry() },
            BACKGROUND_CONTEXT,
        );
        try {
            const root = await harness.root(BACKGROUND_CONTEXT);
            await createNativeInputDelivery(
                ctx,
                { missionId: active.missionId, expectedGeneration: 1 },
                storage,
            ).synchronizeControls(root, BACKGROUND_CONTEXT);
            return (
                await root.entries(
                    { order: "ascending" },
                    100,
                    undefined,
                    BACKGROUND_CONTEXT,
                )
            ).items.filter((e) => e.kind === "workbench.control-command")
                .length;
        } finally {
            await harness.close(BACKGROUND_CONTEXT);
        }
    });
    expect(count).toBe(23);
    expect(
        await t.run((ctx) =>
            ctx.db
                .query("agentMessageDeliveries")
                .withIndex("by_run_and_native_control", (q) =>
                    q.eq("runId", runId).eq("nativeControlStatus", "pending"),
                )
                .collect(),
        ),
    ).toEqual([]);
});

test("a fenced writer cannot acknowledge a command after its lease is replaced", async () => {
    const { t, client, runId } = await seedWorkbench(true);
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
    const receipt = await client.mutation(api.workbench.command, {
        runId,
        requestKey: "fenced",
        command: "/pause",
        expectedGeneration: 1,
    });
    const lease = await t.mutation(internal.execution.piStore.claim, {
        missionId: active.missionId,
        expectedGeneration: 1,
        writer: "old",
    });
    await t.run((ctx) =>
        ctx.db.patch(lease.sessionId, {
            writer: "replacement",
            epoch: lease.epoch + 1,
        }),
    );
    await expect(
        t.mutation(internal.execution.piStore.recordControlInputs, {
            ...lease,
            messageIds: [receipt.messageId],
        }),
    ).rejects.toThrow("pi_writer_fenced");
    expect(await t.run((ctx) => ctx.db.get(receipt.messageId))).toMatchObject({
        nativeControlStatus: "pending",
    });
});

test("concurrent slash resumes atomically preserve one running dossier per visitor", async () => {
    const { t, client, runId } = await startedWorkbench(false);
    await client.mutation(api.workbench.command, {
        runId,
        requestKey: "pause-first",
        command: "/pause",
        expectedGeneration: 1,
    });
    await t.mutation(internal.execution.researchControl.checkpoint, { runId });
    const preflightId = await t.run(async (ctx) => {
        const run = await ctx.db.get(runId);
        assert(run?.ownerVisitorId && run.companyId);
        return ctx.db.insert("companyPreflights", {
            ownerVisitorId: run.ownerVisitorId,
            companyId: run.companyId,
            query: "1818201",
            resolverVersion: "sec-company-v1",
            status: "resolved",
            expiresAt: Date.now() + 60000,
            createdAt: Date.now(),
        });
    });
    const other = await client.mutation(api.framing.confirmCompany, {
        preflightId,
        idempotencyKey: "other-native",
        coveragePreset: "balanced",
    });
    await client.mutation(api.framing.save, {
        runId: other.runId,
        expectedRevision: 1,
        requestKey: "other-program",
        content: {
            scope: "Claims coordination",
            questions: [
                {
                    id: "q1",
                    shortLabel: "Control",
                    text: "Who controls claim assignment?",
                    rationale: "Inspect assignment.",
                },
            ],
        },
    });
    await client.mutation(api.framing.startResearch, {
        runId: other.runId,
        expectedRevision: 2,
        requestKey: "other-start",
    });
    await client.mutation(api.workbench.command, {
        runId: other.runId,
        requestKey: "pause-other",
        command: "/pause",
        expectedGeneration: 1,
    });
    await t.mutation(internal.execution.researchControl.checkpoint, {
        runId: other.runId,
    });
    const results = await Promise.all(
        [runId, other.runId].map((id) =>
            client.mutation(api.workbench.command, {
                runId: id,
                requestKey: "resume-concurrently",
                command: "/resume",
                expectedGeneration: 2,
            }),
        ),
    );
    expect(results.map((r) => r.outcome).sort()).toEqual([
        "applied",
        "refused",
    ]);
    expect(results.find((r) => r.outcome === "refused")?.text).toBe(
        "Another research dossier is running. Pause it before resuming this one.",
    );
    const running = await t.run(async (ctx) =>
        (
            await Promise.all([runId, other.runId].map((id) => ctx.db.get(id)))
        ).filter((run) => run?.executionStatus === "running"),
    );
    expect(running).toHaveLength(1);
});

test("resuming already running research reports an unchanged state rather than another resumption", async () => {
    const { t, client, runId } = await startedWorkbench();
    const before = await t.run((ctx) => ctx.db.get(runId));
    expect(
        await client.mutation(api.workbench.command, {
            runId,
            requestKey: "already-running",
            command: "/resume",
            expectedGeneration: 1,
        }),
    ).toMatchObject({
        outcome: "unchanged",
        text: "Research is already running.",
    });
    expect(await t.run((ctx) => ctx.db.get(runId))).toEqual(before);
});

test("the composer only offers control commands supported by the current conversation and research state", async () => {
    const { client, runId } = await seedWorkbench();
    expect(
        (await client.query(api.workbench.snapshot, { runId }))
            .availableCommands,
    ).toEqual([]);
    const started = await startedWorkbench();
    expect(
        (
            await started.client.query(api.workbench.snapshot, {
                runId: started.runId,
            })
        ).availableCommands,
    ).toEqual(["/pause"]);
    await started.t.run(async (ctx) => {
        const conversation = await ctx.db
            .query("agentConversations")
            .withIndex("by_run", (q) => q.eq("runId", started.runId))
            .unique();
        assert(conversation);
        await ctx.db.patch(conversation._id, { definitionVersion: 1 });
    });
    expect(
        (
            await started.client.query(api.workbench.snapshot, {
                runId: started.runId,
            })
        ).availableCommands,
    ).toEqual([]);
});

test("an approval decision is recorded as a control exchange for the native history", async () => {
    const f = await seedExpiredPreparation();
    vi.stubEnv("E2E_FIXTURES_ENABLED", "true");
    vi.stubEnv("CONVEX_CLOUD_URL", "http://127.0.0.1:3210");
    await f.t.run(async (ctx) => {
        const visitor = await ctx.db.get(f.visitorId);
        assert(visitor);
        await ctx.db.patch(visitor.invitationId, { slotKey: "analyst-4" });
    });
    const contextId = await f.t.mutation(
        internal.runWorkspace.openBrowserTestContext,
        {
            slotKey: "analyst-4",
            contextKey: "approval-native-history",
            durationMs: 60_000,
        },
    );
    await f.t.run((ctx) =>
        ctx.db.patch(f.runId, {
            purpose: "browser_test",
            browserTestContextId: contextId,
        }),
    );
    await seedTimeLimitConversation(f);
    await f.t.run((ctx) =>
        submitAuthorizedMessage(
            ctx,
            {
                runId: f.runId,
                requestKey: "native-history-check",
                text: "Explain the source status.",
                delivery: "queue",
            },
            { type: "system" },
        ),
    );
    const active = await f.t.mutation(
        internal.execution.conversations.startTurn,
        {
            runId: f.runId,
            definitionId: "workbench_v1",
            scope: { kind: "workbench_v1" },
            simulation: true,
        },
    );
    assert(active);
    await reachTimeLimit(f);

    const { sourcesDecisionRequestId: requestId } = await client(f).query(
        api.researchRuns.getMine,
        { runId: f.runId },
    );
    assert(requestId);
    const view = await client(f).mutation(api.execution.approvals.decide, {
        requestId,
        choice: "always",
    });

    const lease = await f.t.mutation(internal.execution.piStore.claim, {
        missionId: active.missionId,
        expectedGeneration: 1,
        writer: "approval-sync",
    });
    const pending = await f.t.query(
        internal.execution.piStore.pendingControlInputs,
        {
            ...lease,
            paginationOpts: { numItems: 20, cursor: null },
        },
    );
    expect(pending.entries).toHaveLength(1);
    const entry = pending.entries[0];
    assert(entry);
    expect(entry).toMatchObject({
        command: "Continue preparation: always for this dossier",
        text: approvalOutcomeText(view),
    });

    await f.t.mutation(internal.execution.piStore.recordControlInputs, {
        ...lease,
        messageIds: [entry.messageId],
    });
    expect(await f.t.run((ctx) => ctx.db.get(entry.messageId))).toMatchObject({
        nativeControlStatus: "recorded",
    });
});
