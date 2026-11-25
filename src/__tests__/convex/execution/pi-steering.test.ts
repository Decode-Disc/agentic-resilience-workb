import { api, internal } from "@convex/_generated/api";
import {
    retainedTextParts,
    stageRetainedText,
} from "@convex/execution/retainedText";
import * as pi from "@earendil-works/pi-ai";
import { afterEach, assert, expect, test, vi } from "vitest";
import { seedConversation } from "@/__tests__/setup/agent-harness";
import { seedWorkbench } from "@/__tests__/setup/workbench";

vi.mock("@earendil-works/pi-ai", async (original) => {
    const source = await original<typeof import("@earendil-works/pi-ai")>();
    return { ...source, fauxProvider: vi.fn(source.fauxProvider) };
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
});

test("native input snapshots reference large analyst bodies without loading them", async () => {
    vi.useFakeTimers();
    const f = await seedWorkbench(
        true,
        undefined,
        undefined,
        undefined,
        undefined,
        12,
        "balanced",
        { bytesRead: 128 * 1024 },
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
    const message = await f.t.run((ctx) =>
        ctx.db
            .query("agentMessageDeliveries")
            .withIndex("by_turn", (q) => q.eq("turnId", active.turnId))
            .first(),
    );
    assert(message?.bodyTextId);
    const { _id: messageId, bodyTextId: original } = message;
    const content = `${"x".repeat(170_000)}界😀`;
    const { manifest, parts } = retainedTextParts(content);
    for (const [index, content] of parts.entries()) {
        const textId = await f.t.run((ctx) =>
            stageRetainedText(ctx, "historical-large-input", {
                ...manifest,
                index,
                content,
            }),
        );
        if (index === parts.length - 1) {
            await f.t.run(async (ctx) => {
                const old = await ctx.db.get(original);
                assert(old);
                await ctx.db.patch(original, { key: "unused-input-fixture" });
                await ctx.db.patch(textId, { key: old.key });
                await ctx.db.patch(messageId, {
                    bodyTextId: textId,
                    bodyContentHash: manifest.contentHash,
                });
            });
        }
    }
    const lease = await f.t.mutation(internal.execution.piStore.claim, {
        missionId: active.missionId,
        expectedGeneration: 1,
        writer: "large-input",
    });
    const snapshot = await f.t.mutation(
        internal.execution.piStore.inputSnapshot,
        lease,
    );
    expect(snapshot.inputs[0]?.messages).toEqual([
        { messageId, contentHash: manifest.contentHash },
    ]);
    const fragments = [];
    for (const index of parts.keys()) {
        const piece = await f.t.query(
            internal.execution.piStore.nativeInputFragment,
            {
                ...lease,
                messageId,
                index,
                contentHash: manifest.contentHash,
            },
        );
        fragments.push(piece.content);
        expect(piece.fragmentCount).toBe(parts.length);
    }
    expect(fragments.join("")).toBe(content);
    const read = internal.execution.piStore.nativeInputFragment;
    await expect(
        f.t.query(read, {
            ...lease,
            messageId,
            index: 0,
            contentHash: "wrong-hash",
        }),
    ).rejects.toThrow("native_input_unavailable");
    await expect(
        f.t.query(read, {
            ...lease,
            writer: "superseded-writer",
            messageId,
            index: 0,
            contentHash: manifest.contentHash,
        }),
    ).rejects.toThrow("pi_writer_fenced");
});

async function gateFirstResponse() {
    let entered!: () => void;
    const dispatched = new Promise<void>((resolve) => {
        entered = resolve;
    });
    let release!: () => void;
    const resume = new Promise<void>((resolve) => {
        release = resolve;
    });
    const nativeFaux = (
        await vi.importActual<typeof pi>("@earendil-works/pi-ai")
    ).fauxProvider;
    let first = true;
    let count = 0;
    vi.mocked(pi.fauxProvider).mockImplementation((options) => {
        const fake = nativeFaux(options);
        const provider = fake.provider;
        return {
            ...fake,
            provider: {
                ...provider,
                streamSimple(model, messages, streamOptions) {
                    count++;
                    const actual = provider.streamSimple(
                        model,
                        messages,
                        streamOptions,
                    );
                    const stream = pi.createAssistantMessageEventStream();
                    void (async () => {
                        if (first) {
                            first = false;
                            entered();
                            await resume;
                        }
                        stream.end(await actual.result());
                    })();
                    return stream;
                },
            },
        };
    });
    return { dispatched, release, calls: () => count };
}

test("a steer received during a Pi generation prevents stale publication and reaches the following generation", async () => {
    vi.useFakeTimers();
    const { dispatched, release } = await gateFirstResponse();
    const f = await seedConversation(true);
    await import("@convex/execution/agentCatalog");
    const { conversationValidationDefinition } = await import(
        "@convex/domain/conversationValidation"
    );
    vi.spyOn(conversationValidationDefinition, "simulate").mockImplementation(
        (input) => ({ kind: "complete", text: JSON.stringify(input) }),
    );
    await f.client.mutation(api.execution.conversations.submit, {
        runId: f.runId,
        requestKey: "initial",
        text: "Initial question",
        delivery: "queue",
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
    const running = f.t.finishAllScheduledFunctions(
        () => vi.advanceTimersByTime(10),
        500,
    );
    try {
        await dispatched;
        await f.client.mutation(api.execution.conversations.submit, {
            runId: f.runId,
            requestKey: "steer",
            text: "IMPORTANT NEW SCOPE",
            delivery: "steer",
            turnId: started.turnId,
        });
    } finally {
        release();
    }
    await running;
    expect(await f.t.run((ctx) => ctx.db.get(started.missionId))).toMatchObject(
        { status: "completed" },
    );
    const page = await f.client.query(
        api.execution.conversations.listMessages,
        { runId: f.runId, paginationOpts: { numItems: 20, cursor: null } },
    );
    expect(
        page.page.filter((message) => message.role === "assistant"),
    ).toHaveLength(1);
    expect(
        page.page.find((message) => message.role === "assistant")?.text,
    ).toContain("IMPORTANT NEW SCOPE");
    expect(page.page.every((message) => message.status === "processed")).toBe(
        true,
    );
}, 30000);

test("public Resume reuses a confirmed Pi reply retained during analyst pause", async () => {
    vi.useFakeTimers();
    const gate = await gateFirstResponse();
    const { seedPiMission } = await import("@/__tests__/setup/pi-mission");
    const f = await seedPiMission();
    const client = f.t.withIdentity({ subject: f.userId });
    await f.t.run((ctx) =>
        ctx.db.patch(f.args.runId, { agentExecutionVersion: 3 }),
    );
    await f.t.mutation(internal.execution.missions.resume, {
        missionId: f.missionId,
        expectedGeneration: 4,
        simulation: true,
    });
    const running = f.t.finishAllScheduledFunctions(
        () => vi.advanceTimersByTime(10),
        500,
    );
    try {
        await gate.dispatched;
        await client.mutation(api.execution.researchControl.pause, {
            runId: f.args.runId,
            expectedGeneration: 4,
        });
    } finally {
        gate.release();
    }
    await running;
    const saved = await f.t.run(async (ctx) => {
        const mission = await ctx.db.get(f.missionId);
        return mission?.lastInvocationId
            ? ctx.db.get(mission.lastInvocationId)
            : null;
    });
    expect(saved).toMatchObject({
        status: "started",
        receivedWhileAuthorized: true,
    });
    expect(saved?.receivedOutputJson).toContain("operations");
    expect(gate.calls()).toBe(1);
    await client.mutation(api.execution.researchControl.resume, {
        runId: f.args.runId,
        expectedGeneration: 5,
    });
    await f.t.finishAllScheduledFunctions(
        () => vi.advanceTimersByTime(10),
        500,
    );
    expect(await f.t.run((ctx) => ctx.db.get(f.missionId))).toMatchObject({
        status: "completed",
        result: { captureIds: [f.captureId] },
    });
    expect(gate.calls()).toBe(4);
}, 30000);

test("a Pi parent sleeps durably for its child and resumes from retained results", async () => {
    vi.useFakeTimers();
    const f = await seedConversation(true);
    await import("@convex/execution/agentCatalog");
    const { conversationValidationDefinition } = await import(
        "@convex/domain/conversationValidation"
    );
    vi.spyOn(conversationValidationDefinition, "simulate").mockImplementation(
        (input) => {
            const context = input as {
                triggeringRequestsAndResults: Array<{
                    input: { kind: string };
                    outcome?: { kind: string };
                }>;
            };
            return context.triggeringRequestsAndResults.some(
                (result) =>
                    result.input.kind === "request_fixture_validation" &&
                    result.outcome?.kind === "success",
            )
                ? {
                      kind: "complete",
                      text: "The retained child result is available.",
                  }
                : {
                      kind: "operations",
                      requests: [
                          {
                              callId: "child",
                              name: "request_fixture_validation",
                              inputJson: JSON.stringify({ values: [3, 7] }),
                          },
                      ],
                  };
        },
    );
    await f.t.run((ctx) =>
        ctx.db.patch(f.runId, { executionStatus: "running" }),
    );
    await f.client.mutation(api.execution.conversations.submit, {
        runId: f.runId,
        requestKey: "delegate",
        delivery: "queue",
        text: "Use the child fixture",
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
    await f.t.finishAllScheduledFunctions(
        () => vi.advanceTimersByTime(10),
        500,
    );
    await vi.advanceTimersByTimeAsync(1000);
    await f.t.finishAllScheduledFunctions(
        () => vi.advanceTimersByTime(10),
        500,
    );
    expect(await f.t.run((ctx) => ctx.db.get(started.missionId))).toMatchObject(
        { status: "completed" },
    );
    const session = await f.t.run((ctx) =>
        ctx.db
            .query("piSessions")
            .withIndex("by_mission", (q) =>
                q.eq("missionId", started.missionId),
            )
            .unique(),
    );
    expect(session?.epoch).toBeGreaterThan(1);
    const requests = await f.t.run((ctx) =>
        ctx.db
            .query("agentOperationRequests")
            .withIndex("by_mission", (q) =>
                q.eq("missionId", started.missionId),
            )
            .collect(),
    );
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
        status: "completed",
        outcome: { kind: "success" },
    });
    const childId = requests[0]?.childMissionId;
    expect(childId).toBeDefined();
    if (!childId) throw new Error("Expected retained child");
    expect(await f.t.run((ctx) => ctx.db.get(childId))).toMatchObject({
        executionRuntime: "pi-durable",
        status: "completed",
        result: { kind: "execution_validation_v1", total: 10 },
    });
}, 30000);

test("public Resume reuses a confirmed reply after Pi checkpoint storage fails", async () => {
    vi.useFakeTimers();
    const gate = await gateFirstResponse();
    gate.release();
    const { PiConvexStorage } = await import("@convex/integrations/piStorage");
    const { executionError } = await import("@convex/execution/errors");
    const commit = PiConvexStorage.prototype.commit;
    let failed = false;
    vi.spyOn(PiConvexStorage.prototype, "commit").mockImplementation(
        async function (
            this: typeof PiConvexStorage.prototype,
            writes,
            context,
        ) {
            if (
                !failed &&
                writes.some(
                    (write) =>
                        write.type === "entry" &&
                        write.value.model?.some(
                            (message) => message.role === "assistant",
                        ),
                )
            ) {
                failed = true;
                throw executionError("execution_interrupted");
            }
            return commit.call(this, writes, context);
        },
    );
    const { seedPiMission } = await import("@/__tests__/setup/pi-mission");
    const f = await seedPiMission();
    await f.t.run((ctx) =>
        ctx.db.patch(f.args.runId, { agentExecutionVersion: 3 }),
    );
    await f.t.mutation(internal.execution.missions.resume, {
        missionId: f.missionId,
        expectedGeneration: 4,
        simulation: true,
    });
    await f.t.finishAllScheduledFunctions(
        () => vi.advanceTimersByTime(10),
        500,
    );
    expect(failed).toBe(true);
    expect(await f.t.run((ctx) => ctx.db.get(f.missionId))).toMatchObject({
        status: "blocked",
        blockCode: "execution_interrupted",
    });
    expect(gate.calls()).toBe(1);
    const client = f.t.withIdentity({ subject: f.userId });
    await client.mutation(api.execution.researchControl.pause, {
        runId: f.args.runId,
        expectedGeneration: 4,
    });
    await client.mutation(api.execution.researchControl.resume, {
        runId: f.args.runId,
        expectedGeneration: 5,
    });
    await f.t.finishAllScheduledFunctions(
        () => vi.advanceTimersByTime(10),
        500,
    );
    const recovered = await f.t.run((ctx) => ctx.db.get(f.missionId));
    expect(recovered?.blockCode).toBeUndefined();
    expect(recovered).toMatchObject({
        status: "completed",
        generation: 6,
        result: { captureIds: [f.captureId] },
    });
    expect(gate.calls()).toBe(4);
}, 30000);

test("public Resume reuses a confirmed compaction after its Pi checkpoint fails", async () => {
    vi.useFakeTimers();
    const gate = await gateFirstResponse();
    gate.release();
    const { seedPiMission, seedPiHistory } = await import(
        "@/__tests__/setup/pi-mission"
    );
    const f = await seedPiMission();
    await seedPiHistory(f.t, f.missionId, 4, 8, 16250);
    await f.t.run((ctx) =>
        ctx.db.patch(f.args.runId, { agentExecutionVersion: 3 }),
    );
    const { PiConvexStorage } = await import("@convex/integrations/piStorage");
    const { executionError } = await import("@convex/execution/errors");
    const commit = PiConvexStorage.prototype.commit;
    let failed = false;
    vi.spyOn(PiConvexStorage.prototype, "commit").mockImplementation(
        async function (
            this: typeof PiConvexStorage.prototype,
            writes,
            context,
        ) {
            if (
                !failed &&
                (await f.t.run(async (ctx) =>
                    (
                        await ctx.db
                            .query("agentInvocations")
                            .withIndex("by_mission", (q) =>
                                q.eq("missionId", f.missionId),
                            )
                            .collect()
                    ).some(
                        (invocation) =>
                            invocation.purpose === "compaction" &&
                            invocation.status === "returned",
                    ),
                ))
            ) {
                failed = true;
                throw executionError("execution_interrupted");
            }
            return commit.call(this, writes, context);
        },
    );
    await f.t.mutation(internal.execution.missions.resume, {
        missionId: f.missionId,
        expectedGeneration: 4,
        simulation: true,
    });
    await f.t.finishAllScheduledFunctions(
        () => vi.advanceTimersByTime(10),
        500,
    );
    expect(failed).toBe(true);
    expect(await f.t.run((ctx) => ctx.db.get(f.missionId))).toMatchObject({
        status: "blocked",
        blockCode: "execution_interrupted",
    });
    expect(gate.calls()).toBe(1);
    const confirmedSummary = await f.t.run(async (ctx) =>
        (
            await ctx.db
                .query("agentInvocations")
                .withIndex("by_mission", (q) => q.eq("missionId", f.missionId))
                .collect()
        ).find((invocation) => invocation.purpose === "compaction"),
    );
    expect(confirmedSummary?.status).toBe("returned");

    const client = f.t.withIdentity({ subject: f.userId });
    await client.mutation(api.execution.researchControl.pause, {
        runId: f.args.runId,
        expectedGeneration: 4,
    });
    await client.mutation(api.execution.researchControl.resume, {
        runId: f.args.runId,
        expectedGeneration: 5,
    });
    await f.t.finishAllScheduledFunctions(
        () => vi.advanceTimersByTime(10),
        500,
    );
    const recovered = await f.t.run((ctx) => ctx.db.get(f.missionId));
    expect(recovered?.blockCode).toBeUndefined();
    expect(recovered).toMatchObject({
        status: "completed",
        generation: 6,
        result: { captureIds: [f.captureId] },
    });
    const summaries = await f.t.run(async (ctx) =>
        (
            await ctx.db
                .query("agentInvocations")
                .withIndex("by_mission", (q) => q.eq("missionId", f.missionId))
                .collect()
        ).filter((invocation) => invocation.purpose === "compaction"),
    );
    const retained = summaries.find((row) => row._id === confirmedSummary?._id);
    expect(retained).toMatchObject({
        _id: confirmedSummary?._id,
        taskKey: confirmedSummary?.taskKey,
        generation: 4,
        adoptionGeneration: 6,
        status: "returned",
        inputJson: confirmedSummary?.inputJson,
        rawOutputJson: confirmedSummary?.rawOutputJson,
        receivedOutputJson: confirmedSummary?.receivedOutputJson,
    });
    expect(new Set(summaries.map((row) => row.taskKey)).size).toBe(
        summaries.length,
    );
    const hashes = await f.t.run(async (ctx) =>
        Promise.all(
            summaries.map(
                async (row) =>
                    (
                        await ctx.db
                            .query("agentInvocationPayloads")
                            .withIndex("by_invocation_and_part", (q) =>
                                q
                                    .eq("invocationId", row._id)
                                    .eq("part", "request"),
                            )
                            .unique()
                    )?.contentHash,
            ),
        ),
    );
    expect(hashes.every((hash) => typeof hash === "string")).toBe(true);
    expect(new Set(hashes).size).toBe(hashes.length);
}, 30000);
