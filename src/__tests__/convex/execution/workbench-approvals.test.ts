import { api, internal } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { sha256Hex } from "@convex/domain/sourcePassages";
import { workbenchDefinition } from "@convex/domain/workbenchAgent";
import { readWorkbenchFacts } from "@convex/domain/workbenchContext";
import { approvalRequestIdFromOperation } from "@convex/domain/workbenchContracts";
import { getAgentDefinition } from "@convex/execution/agentCatalog";
import { agentToolSchemas } from "@convex/execution/agentDefinition";
import { raiseApproval, readApprovalFacts } from "@convex/execution/approvals";
import { buildMissionContext } from "@convex/execution/context";
import { BROWSER_TEST_SLOT } from "@convex/runWorkspace";
import { afterEach, assert, beforeEach, expect, test, vi } from "vitest";
import { installModel } from "@/__tests__/setup/model-configuration";
import {
    beginFixtureInvocation,
    claimFixtureOperation,
    dispatchFixtureOperation,
    recordFixtureAttempt,
} from "@/__tests__/setup/pi-mission";
import { nativePiFixtureRoute } from "@/__tests__/setup/pi-native";
import {
    readConversationPageWithBodies,
    readWorkbenchPageWithBodies,
} from "@/__tests__/setup/retained-messages";
import { activateSourcesMission } from "@/__tests__/setup/sources-mission";
import {
    client,
    reachTimeLimit,
    seedExpiredPreparation,
    seedTimeLimitConversation,
} from "@/__tests__/setup/sources-time-limit";
import {
    seedWorkbench,
    workbenchAdmissionInput,
} from "@/__tests__/setup/workbench";

beforeEach(() => activateSourcesMission());

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
});

async function seedFramedStartedWorkbench(
    messageText: string,
    binding: "retained" | "current" = "retained",
) {
    const { t, client, runId } = await seedWorkbench(
        false,
        nativePiFixtureRoute,
        undefined,
        undefined,
        undefined,
        binding === "current" ? null : undefined,
    );
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
    const messageId = await client.mutation(
        api.execution.conversations.submit,
        {
            runId,
            requestKey: "analyst-message",
            text: messageText,
            delivery: "queue",
        },
    );
    const active = await t.mutation(
        internal.execution.conversations.startTurn,
        {
            runId,
            definitionId: "workbench_v1",
            scope: { kind: "workbench_v1" },
            simulation: false,
        },
    );
    assert(active);
    return { t, client, runId, messageId, active };
}

test("an exact command applies the action and records an approved request", async () => {
    const { t, client, runId, messageId, active } =
        await seedFramedStartedWorkbench("Pause research.");

    const requestId = await t.mutation(internal.execution.operations.enqueue, {
        missionId: active.missionId,
        expectedGeneration: 1,
        cause: "exact-command",
        input: {
            kind: "request_approval",
            action: "pause_research",
            messageId,
        },
    });
    const outcome = await dispatchFixtureOperation(t, {
        requestId,
        expectedGeneration: 1,
    });
    expect(outcome.kind).toBe("success");
    assert(outcome.kind === "success");
    expect(JSON.parse(outcome.valueJson)).toMatchObject({
        status: "applied",
        action: "pause_research",
    });

    const run = await t.run((ctx) => ctx.db.get(runId));
    expect(run).toMatchObject({
        researchPauseRequested: true,
    });
    const approval = await t.run((ctx) =>
        ctx.db
            .query("approvalRequests")
            .withIndex("by_run_and_status", (q) =>
                q.eq("runId", runId).eq("status", "approved"),
            )
            .first(),
    );
    assert(approval);
    expect(approval.decision).toMatchObject({
        choice: "once",
        via: "command",
        outcome: { kind: "applied", action: "pause_research" },
    });
    expect(approval.requestedBy).toEqual({
        type: "agent",
        missionId: active.missionId,
        messageId,
    });
    const view = await client.query(api.execution.approvals.get, {
        requestId: approval._id,
    });
    expect(view.status).toBe("approved");

    const turnWork = await client.query(api.workbench.turnWork, {
        runId,
        turnId: active.turnId,
    });
    expect(turnWork?.operations[0]?.approvalRequestId).toBe(approval._id);

    const controlSequence = await t.run(async (ctx) => {
        const context = await buildMissionContext(ctx, active.missionId, 1);
        assert(context.kind === "ready");
        return (
            (
                JSON.parse(context.inputJson) as {
                    nativeObservations?: { controlSequence?: number };
                }
            ).nativeObservations?.controlSequence ?? 0
        );
    });
    const invocation = await beginFixtureInvocation(t, {
        missionId: active.missionId,
        expectedGeneration: 1,
        taskKey: "confirm-pause",
        provenance: "live",
        nativeInput: {
            ...(await workbenchAdmissionInput(t, active.missionId)),
            controlSequence,
        },
    });
    expect(invocation).toMatchObject({ kind: "ready" });
    if (invocation.kind !== "ready") return;
    const mission = await t.run((ctx) => ctx.db.get(active.missionId));
    assert(mission);
    const attempt = {
        missionId: active.missionId,
        invocationId: invocation.invocationId,
        runId,
        executionGeneration: 1,
        workflowVersion: mission.definitionVersion,
        stepKey: "agent_reasoning",
        service: "model" as const,
        operation: "agent_reasoning",
        operationKey: `mission:${active.missionId}:invocation:${invocation.invocationId}:attempt:1`,
        attempt: 1,
        inputHash: sha256Hex(invocation.inputJson),
    };
    await recordFixtureAttempt(t, {
        ...attempt,
        status: "started",
    });
    await recordFixtureAttempt(t, {
        ...attempt,
        status: "succeeded",
        dispatchOutcome: "response_received",
    });
    const finished = await t.mutation(internal.execution.invocations.finish, {
        invocationId: invocation.invocationId,
        expectedGeneration: 1,
        response: { kind: "complete", text: "Unused model text" },
    });
    expect(finished).toMatchObject({ kind: "completed" });
    const page = await readConversationPageWithBodies(client, {
        runId,
        paginationOpts: { numItems: 20, cursor: null },
    });
    const assistantTexts = page.page
        .filter((message) => message.role === "assistant")
        .map((message) => message.text);
    expect(assistantTexts).toContain("Applied: Pause research.");
    expect(assistantTexts).toContain(
        "Pause requested. Research will pause after the work already in progress finishes.",
    );
});

test("an interpreted request creates a pending approval instead of acting", async () => {
    const { t, client, runId, messageId, active } =
        await seedFramedStartedWorkbench(
            "Could we hold off on research for a moment while I check something?",
        );

    const requestId = await t.mutation(internal.execution.operations.enqueue, {
        missionId: active.missionId,
        expectedGeneration: 1,
        cause: "inferred-pause",
        input: {
            kind: "request_approval",
            action: "pause_research",
            messageId,
        },
    });
    const outcome = await dispatchFixtureOperation(t, {
        requestId,
        expectedGeneration: 1,
    });
    assert(outcome.kind === "success");
    const parsed = JSON.parse(outcome.valueJson) as {
        status: string;
        requestId: Id<"approvalRequests">;
    };
    expect(parsed.status).toBe("pending");

    const run = await t.run((ctx) => ctx.db.get(runId));
    expect(run?.executionStatus).toBe("running");
    expect(run?.researchPauseRequested).toBeFalsy();

    const view = await client.query(api.execution.approvals.get, {
        requestId: parsed.requestId,
    });
    expect(view.status).toBe("pending");
    expect(view.requestedBy).toEqual({
        type: "agent",
        missionId: active.missionId,
        messageId,
    });

    const turnWork = await client.query(api.workbench.turnWork, {
        runId,
        turnId: active.turnId,
    });
    expect(turnWork?.operations[0]?.approvalRequestId).toBe(parsed.requestId);
});

test("asking about a pending system decision shows the same request again", async () => {
    vi.stubEnv("WORKBENCH_AGENT_ENABLED", "true");
    const f = await seedExpiredPreparation();
    await installModel(f.t, nativePiFixtureRoute);
    await seedTimeLimitConversation(f);
    await reachTimeLimit(f);

    const systemPending = await f.t.run(async (ctx) => {
        const run = await ctx.db.get(f.runId);
        assert(run);
        return readApprovalFacts(ctx, run);
    });
    expect(systemPending.pending).toHaveLength(1);
    const systemRequestId = systemPending.pending[0]?.requestId;
    assert(systemRequestId);
    expect(systemPending.pending[0]).toMatchObject({
        action: "continue_sources_preparation",
        alternative: "settle_sources_preparation",
    });

    const client = f.t.withIdentity({ subject: f.userId });
    const messageId = await client.mutation(
        api.execution.conversations.submit,
        {
            runId: f.runId,
            requestKey: "settle-request",
            text: "Can we just use what's prepared?",
            delivery: "queue",
        },
    );
    const active = await f.t.mutation(
        internal.execution.conversations.startTurn,
        {
            runId: f.runId,
            definitionId: "workbench_v1",
            scope: { kind: "workbench_v1" },
            simulation: false,
        },
    );
    assert(active);

    const requestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: active.missionId,
            expectedGeneration: 1,
            cause: "reuse-time-limit-card",
            input: {
                kind: "request_approval",
                action: "settle_sources_preparation",
                messageId,
            },
        },
    );
    const outcome = await dispatchFixtureOperation(f.t, {
        requestId,
        expectedGeneration: 1,
    });
    assert(outcome.kind === "success");
    expect(JSON.parse(outcome.valueJson)).toEqual({
        status: "pending",
        requestId: systemRequestId,
    });

    const factsAfter = await f.t.run(async (ctx) => {
        const run = await ctx.db.get(f.runId);
        assert(run);
        return readApprovalFacts(ctx, run);
    });
    expect(factsAfter.pending.map((item) => item.requestId)).toEqual([
        systemRequestId,
    ]);
});

test("an active grant applies the interpreted request", async () => {
    const { t, client, runId } = await seedWorkbench(
        true,
        nativePiFixtureRoute,
    );
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

    const seededPending = await t.run(async (ctx) => {
        const run = await ctx.db.get(runId);
        assert(run);
        return raiseApproval(ctx, {
            run,
            action: "pause_research",
            requestedBy: { type: "system" },
        });
    });
    expect(seededPending.status).toBe("pending");
    await client.mutation(api.execution.approvals.decide, {
        requestId: seededPending.requestId,
        choice: "always",
    });
    await t.mutation(internal.execution.researchControl.checkpoint, { runId });
    await client.mutation(api.execution.researchControl.resume, {
        runId,
        expectedGeneration: 2,
    });

    const messageId = await client.mutation(
        api.execution.conversations.submit,
        {
            runId,
            requestKey: "inferred-with-grant",
            text: "Could you hold research again while I check something?",
            delivery: "queue",
        },
    );
    const active = await t.mutation(
        internal.execution.conversations.startTurn,
        {
            runId,
            definitionId: "workbench_v1",
            scope: { kind: "workbench_v1" },
            simulation: false,
        },
    );
    assert(active);

    const requestId = await t.mutation(internal.execution.operations.enqueue, {
        missionId: active.missionId,
        expectedGeneration: 1,
        cause: "grant-applied",
        input: {
            kind: "request_approval",
            action: "pause_research",
            messageId,
        },
    });
    const outcome = await dispatchFixtureOperation(t, {
        requestId,
        expectedGeneration: 1,
    });
    assert(outcome.kind === "success");
    const parsed = JSON.parse(outcome.valueJson) as {
        status: string;
        action: string;
        requestId: Id<"approvalRequests">;
    };
    expect(parsed.status).toBe("applied");
    expect(parsed.action).toBe("pause_research");

    const view = await client.query(api.execution.approvals.get, {
        requestId: parsed.requestId,
    });
    expect(view.status).toBe("approved");
    expect(view.decision).toMatchObject({
        choice: "always",
        via: "grant",
        outcome: { kind: "applied", action: "pause_research" },
    });
    expect(await t.run((ctx) => ctx.db.get(runId))).toMatchObject({
        researchPauseRequested: true,
    });
});

test("an unavailable action creates no request", async () => {
    const { t, client, runId, messageId, active } =
        await seedFramedStartedWorkbench("Maybe we should resume now?");

    const requestId = await t.mutation(internal.execution.operations.enqueue, {
        missionId: active.missionId,
        expectedGeneration: 1,
        cause: "unavailable-resume",
        input: {
            kind: "request_approval",
            action: "resume_research",
            messageId,
        },
    });
    const outcome = await dispatchFixtureOperation(t, {
        requestId,
        expectedGeneration: 1,
    });
    assert(outcome.kind === "success");
    expect(JSON.parse(outcome.valueJson)).toEqual({
        status: "unavailable",
        reason: "action_not_applicable",
    });

    const facts = await t.run(async (ctx) => {
        const run = await ctx.db.get(runId);
        assert(run);
        return readApprovalFacts(ctx, run);
    });
    expect(facts.pending).toEqual([]);
    expect(
        await t.run((ctx) => ctx.db.query("approvalRequests").collect()),
    ).toEqual([]);

    const turnWork = await client.query(api.workbench.turnWork, {
        runId,
        turnId: active.turnId,
    });
    expect(turnWork?.operations[0]?.approvalRequestId).toBeUndefined();
});

test("Workbench offers request_approval and no longer offers control_research", () => {
    const sets =
        workbenchDefinition.nativeToolSets?.(workbenchDefinition.operations) ??
        [];
    expect(sets.length).toBeGreaterThan(0);
    expect(sets.some((set) => "control_research" in set)).toBe(false);
    expect(sets.some((set) => "request_approval" in set)).toBe(true);

    const offered = agentToolSchemas(workbenchDefinition, {
        framing: { fixed: true },
        research: { controlAvailable: true },
        conversationInstructions: {
            messages: [{ messageId: "msg-1", text: "Can we pause?" }],
        },
    });
    expect(offered).toHaveProperty("request_approval");
    expect(offered).not.toHaveProperty("control_research");
    expect(offered.request_approval?.inputValidator.fields).not.toHaveProperty(
        "messageId",
    );

    const hidden = agentToolSchemas(workbenchDefinition, {
        framing: { fixed: true },
        research: { controlAvailable: false },
        conversationInstructions: {
            messages: [{ messageId: "msg-1", text: "Pause research." }],
        },
    });
    expect(hidden).not.toHaveProperty("request_approval");
    expect(hidden).not.toHaveProperty("control_research");
});

test("Workbench facts list pending requests and grants", async () => {
    const f = await seedExpiredPreparation();
    await reachTimeLimit(f);

    const client = f.t.withIdentity({ subject: f.userId });
    await f.t.run(async (ctx) => {
        const run = await ctx.db.get(f.runId);
        assert(run);
        const pending = await raiseApproval(ctx, {
            run,
            action: "pause_research",
            requestedBy: { type: "system" },
        });
        expect(pending.status).toBe("pending");
    });

    const pendingFacts = await f.t.run(async (ctx) => {
        const run = await ctx.db.get(f.runId);
        assert(run);
        const facts = await readWorkbenchFacts(ctx, run);
        assert(facts.kind === "ready");
        return {
            facts,
            direct: await readApprovalFacts(ctx, run),
        };
    });
    expect(
        (pendingFacts.facts.context.research as { approvals: unknown })
            .approvals,
    ).toEqual(pendingFacts.direct);
    expect(pendingFacts.direct.pending.map((p) => p.action)).toContain(
        "continue_sources_preparation",
    );

    const requestId = pendingFacts.direct.pending.find(
        (p) => p.action === "continue_sources_preparation",
    )?.requestId;
    assert(requestId);
    await client.mutation(api.execution.approvals.decide, {
        requestId,
        choice: "always",
    });

    const afterGrant = await f.t.run(async (ctx) => {
        const run = await ctx.db.get(f.runId);
        assert(run);
        const facts = await readWorkbenchFacts(ctx, run);
        assert(facts.kind === "ready");
        return facts.context.research as {
            approvals: { grants: string[]; pending: unknown[] };
        };
    });
    expect(afterGrant.approvals.grants).toEqual([
        "continue_sources_preparation",
    ]);
});

test.each([
    "retained",
    "current",
] as const)("%s Workbench offers approval controls and adopts pause/checkpoint/resume across generation changes", async (binding) => {
    const { t, client, runId, messageId, active } =
        await seedFramedStartedWorkbench("Pause research.", binding);
    const mission = await t.run((ctx) => ctx.db.get(active.missionId));
    assert(mission);
    const context = await t.run((ctx) =>
        buildMissionContext(ctx, active.missionId, 1),
    );
    assert(context.kind === "ready");
    expect(
        agentToolSchemas(
            getAgentDefinition("workbench_v1", mission.definitionVersion),
            JSON.parse(context.inputJson),
        ),
    ).toHaveProperty("request_approval");

    const pauseReqId = await t.mutation(internal.execution.operations.enqueue, {
        missionId: active.missionId,
        expectedGeneration: 1,
        cause: "pause-checkpoint",
        input: {
            kind: "request_approval",
            action: "pause_research",
            messageId,
        },
    });
    await claimFixtureOperation(t, {
        requestId: pauseReqId,
        expectedGeneration: 1,
    });
    await t.mutation(internal.workbench.performInstruction, {
        requestId: pauseReqId,
        expectedGeneration: 1,
    });
    await t.mutation(internal.execution.researchControl.checkpoint, { runId });
    expect(
        await dispatchFixtureOperation(t, {
            requestId: pauseReqId,
            expectedGeneration: 1,
        }),
    ).toMatchObject({ kind: "success" });
    expect(await t.run((ctx) => ctx.db.get(runId))).toMatchObject({
        executionStatus: "paused",
        pauseReason: "analyst",
        executionGeneration: 2,
    });

    const resumeMessageId = await client.mutation(
        api.execution.conversations.submit,
        {
            runId,
            requestKey: "resume-msg",
            text: "Resume research.",
            delivery: "steer",
            turnId: active.turnId,
        },
    );
    const resumeReqId = await t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: active.missionId,
            expectedGeneration: 1,
            cause: "resume-adoption",
            input: {
                kind: "request_approval",
                action: "resume_research",
                messageId: resumeMessageId,
            },
        },
    );
    await claimFixtureOperation(t, {
        requestId: resumeReqId,
        expectedGeneration: 1,
    });
    await t.mutation(internal.workbench.performInstruction, {
        requestId: resumeReqId,
        expectedGeneration: 1,
    });
    // Replay performInstruction before recordResult must stay idempotent and dispatch must adopt generation 3.
    await t.mutation(internal.workbench.performInstruction, {
        requestId: resumeReqId,
        expectedGeneration: 1,
    });
    expect(
        await dispatchFixtureOperation(t, {
            requestId: resumeReqId,
            expectedGeneration: 1,
        }),
    ).toMatchObject({ kind: "success" });
    expect(await t.run((ctx) => ctx.db.get(runId))).toMatchObject({
        executionStatus: "running",
        executionGeneration: 3,
    });
});

test("an undispatched approval operation is refused after a later analyst checkpoint changes its generation", async () => {
    const {
        t,
        client,
        runId,
        messageId: staleMessageId,
        active,
    } = await seedFramedStartedWorkbench("Could we pause?");
    const staleReqId = await t.mutation(internal.execution.operations.enqueue, {
        missionId: active.missionId,
        expectedGeneration: 1,
        cause: "stale-fence",
        input: {
            kind: "request_approval",
            action: "pause_research",
            messageId: staleMessageId,
        },
    });
    await client.mutation(api.execution.researchControl.pause, {
        runId,
        expectedGeneration: 1,
    });
    await t.mutation(internal.execution.researchControl.checkpoint, { runId });
    expect(
        await dispatchFixtureOperation(t, {
            requestId: staleReqId,
            expectedGeneration: 1,
        }),
    ).toEqual({ kind: "refused", code: "version_conflict" });
});

test("approvalRequestIdFromOperation validates real operation outcomes without unchecked coercions", async () => {
    const { t, messageId, active } =
        await seedFramedStartedWorkbench("Maybe pause?");
    const requestId = await t.mutation(internal.execution.operations.enqueue, {
        missionId: active.missionId,
        expectedGeneration: 1,
        cause: "extractor-check",
        input: {
            kind: "request_approval",
            action: "pause_research",
            messageId,
        },
    });
    const base = await t.run((ctx) => ctx.db.get(requestId));
    assert(base);

    expect(approvalRequestIdFromOperation(base)).toBeUndefined();
    expect(
        approvalRequestIdFromOperation({
            ...base,
            outcome: { kind: "success", valueJson: "not-json" },
        }),
    ).toBeUndefined();
    expect(
        approvalRequestIdFromOperation({
            ...base,
            outcome: {
                kind: "success",
                valueJson: JSON.stringify({ status: "pending", extra: 1 }),
            },
        }),
    ).toBeUndefined();
    expect(
        approvalRequestIdFromOperation({
            ...base,
            outcome: {
                kind: "success",
                valueJson: JSON.stringify({
                    status: "unavailable",
                    reason: "human_prerequisite_required",
                }),
            },
        }),
    ).toBeUndefined();
    expect(
        approvalRequestIdFromOperation({
            ...base,
            adoptionRefusalCode: "version_conflict",
            outcome: {
                kind: "success",
                valueJson: JSON.stringify({
                    status: "pending",
                    requestId: "fake-id",
                }),
            },
        }),
    ).toBeUndefined();
    expect(
        approvalRequestIdFromOperation({
            ...base,
            outcome: {
                kind: "success",
                valueJson: JSON.stringify({
                    status: "pending",
                    requestId: "req-123",
                }),
            },
        }),
    ).toBe("req-123");
});

test("the approval fixture raises a real request on a fresh framed dossier without launching Sources", async () => {
    const {
        t,
        client: authClient,
        runId,
    } = await seedWorkbench(
        true,
        undefined,
        undefined,
        undefined,
        undefined,
        null,
    );
    await t.run((ctx) =>
        ctx.db.patch(runId, { reservationKey: "test:native-workbench" }),
    );
    const queued = await t.run((ctx) =>
        ctx.db
            .query("agentMessageDeliveries")
            .withIndex("by_run_and_status", (q) =>
                q.eq("runId", runId).eq("status", "queued"),
            )
            .first(),
    );
    assert(queued);
    await authClient.mutation(api.execution.conversations.removeQueued, {
        runId,
        messageId: queued._id,
    });

    await t.action(internal.execution.fixtures.requestApprovalFixture, {
        runId,
        fixtureKey: "native-workbench",
    });

    const history = await readWorkbenchPageWithBodies(authClient, {
        runId: runId,
        paginationOpts: { numItems: 20, cursor: null },
    });
    const reply = history.page.find(
        (m) =>
            m.role === "assistant" &&
            m.text === "Simulation: please confirm whether to pause research.",
    );
    assert(reply);
    expect(reply.approvalRequestIds).toHaveLength(1);
    const requestId = reply.approvalRequestIds?.[0];
    assert(requestId);

    const pendingView = await authClient.query(api.execution.approvals.get, {
        requestId,
    });
    expect(pendingView).toMatchObject({
        status: "pending",
        action: "pause_research",
    });

    const deniedView = await authClient.mutation(
        api.execution.approvals.decide,
        { requestId, choice: "deny" },
    );
    expect(deniedView).toMatchObject({
        status: "denied",
        action: "pause_research",
    });

    const run = await t.run((ctx) => ctx.db.get(runId));
    expect(run).toMatchObject({
        executionStatus: "running",
        executionGeneration: 1,
    });
    expect(run?.researchPauseRequested).toBeFalsy();
    expect(run?.sourcePreparationId).toBeUndefined();
    expect(await t.run((ctx) => ctx.db.query("providerCalls").take(1))).toEqual(
        [],
    );
});

test("reachSourcesTimeLimit repeats after Always continue, auto-continues while granted, and asks again after revocation", async () => {
    const f = await seedExpiredPreparation();
    vi.stubEnv("E2E_FIXTURES_ENABLED", "true");
    vi.stubEnv("CONVEX_CLOUD_URL", "http://127.0.0.1:3210");
    vi.stubEnv("SOURCES_PREPARATION_WINDOW_MINUTES", "5");
    await f.t.run(async (ctx) => {
        const visitor = await ctx.db.get(f.visitorId);
        assert(visitor);
        await ctx.db.patch(visitor.invitationId, {
            slotKey: BROWSER_TEST_SLOT,
        });
    });
    const contextId = await f.t.mutation(
        internal.runWorkspace.openBrowserTestContext,
        {
            slotKey: BROWSER_TEST_SLOT,
            contextKey: "repeat-time-limit-fixture",
            durationMs: 60_000,
        },
    );
    await f.t.run((ctx) =>
        ctx.db.patch(f.runId, {
            purpose: "browser_test",
            browserTestContextId: contextId,
            reservationKey: "test:repeat-limit",
        }),
    );

    // First time limit pauses with a pending decision card.
    await f.t.mutation(internal.execution.fixtures.reachSourcesTimeLimit, {
        runId: f.runId,
        fixtureKey: "repeat-limit",
    });
    const authClient = client(f);
    const firstMine = await authClient.query(api.researchRuns.getMine, {
        runId: f.runId,
    });
    assert(firstMine.sourcesDecisionRequestId);
    expect(firstMine.pauseReason).toBe("sources_time_limit");

    // Always continue grants automatic continuation and resumes research.
    await authClient.mutation(api.execution.approvals.decide, {
        requestId: firstMine.sourcesDecisionRequestId,
        choice: "always",
    });
    expect(
        await authClient.query(api.researchRuns.getMine, { runId: f.runId }),
    ).toMatchObject({
        executionStatus: "running",
        sourcesDecisionRequestId: null,
    });

    // Second time limit continues automatically without creating a pending card.
    await f.t.mutation(internal.execution.fixtures.reachSourcesTimeLimit, {
        runId: f.runId,
        fixtureKey: "repeat-limit",
    });
    expect(
        await authClient.query(api.researchRuns.getMine, { runId: f.runId }),
    ).toMatchObject({
        executionStatus: "running",
        sourcesDecisionRequestId: null,
    });

    // Revoking the grant causes the next time limit to pause and ask again.
    await authClient.mutation(api.execution.approvals.revokeGrant, {
        runId: f.runId,
        action: "continue_sources_preparation",
    });
    await f.t.mutation(internal.execution.fixtures.reachSourcesTimeLimit, {
        runId: f.runId,
        fixtureKey: "repeat-limit",
    });
    const thirdMine = await authClient.query(api.researchRuns.getMine, {
        runId: f.runId,
    });
    expect(thirdMine.executionStatus).toBe("paused");
    expect(thirdMine.pauseReason).toBe("sources_time_limit");
    expect(thirdMine.sourcesDecisionRequestId).not.toBeNull();
});
