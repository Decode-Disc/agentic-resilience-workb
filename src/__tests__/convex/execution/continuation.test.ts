import { internal } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { sha256Hex } from "@convex/domain/sourcePassages";
import { getAgentDefinition } from "@convex/execution/agentCatalog";
import type { OperationOutcome } from "@convex/execution/agentDefinition";
import type { WorkflowId } from "@convex-dev/workflow";
import { afterEach, expect, test, vi } from "vitest";
import workflowTest from "@/__tests__/convex/workflows/workflow-test-register.js";
import { installModel } from "@/__tests__/setup/model-configuration";
import { nativePiFixtureRoute } from "@/__tests__/setup/pi-native";
import {
    seedInspectedEvidence,
    startRetainedInspection,
} from "@/__tests__/setup/source-preparation";

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
});

test.each([
    "resume",
    "next",
    "finish",
] as const)("%s refuses a response first observed without authority after same-generation readmission", async (entry) => {
    vi.useFakeTimers();
    const { t, args } = await seedInspectedEvidence();
    await installModel(t, nativePiFixtureRoute, "saved_material_inspection");
    workflowTest.register(t);
    const missionId = await t.mutation(internal.execution.missions.start, {
        runId: args.runId,
        corpusRevisionId: args.corpusRevisionId,
        definitionId: "saved_material_inspection_v1",
        requestKey: "readmission",
        expectedGeneration: 4,
    });
    const workflowId = await t.mutation(internal.execution.missions.resume, {
        missionId,
        expectedGeneration: 4,
    });
    const invocation = await t.mutation(internal.execution.invocations.begin, {
        missionId,
        expectedGeneration: 4,
        taskKey: "before-rotation",
        provenance: "live",
    });
    if (invocation.kind !== "ready") throw new Error("Expected invocation");
    const attempt = {
        missionId,
        invocationId: invocation.invocationId,
        runId: args.runId,
        corpusRevisionId: args.corpusRevisionId,
        executionGeneration: 4,
        workflowVersion: getAgentDefinition("saved_material_inspection_v1")
            .version,
        stepKey: "agent_reasoning",
        service: "model" as const,
        operation: "agent_reasoning",
        operationKey: `mission:${missionId}:invocation:${invocation.invocationId}:attempt:1`,
        attempt: 1,
        inputHash: sha256Hex(invocation.inputJson),
    };
    await t.mutation(internal.providerCalls.recordAttempt, {
        ...attempt,
        status: "started",
    });
    await t.mutation(internal.invitations.seedForSetup, {
        invitations: [
            {
                slotKey: "source-preparation-test",
                role: "analyst",
                codeDigest: "rotated",
            },
            { slotKey: "admin", role: "admin", codeDigest: "admin-digest" },
            ...["one", "two", "three"].map((key) => ({
                slotKey: key,
                role: "analyst" as const,
                codeDigest: key,
            })),
        ],
    });
    await t.mutation(internal.providerCalls.recordAttempt, {
        ...attempt,
        status: "succeeded",
        dispatchOutcome: "response_received",
    });
    const response = {
        kind: "operations" as const,
        requests: [
            {
                callId: "late-consult",
                name: "consult_mission_state",
                inputJson: "{}",
            },
        ],
    };
    await t.mutation(internal.execution.invocations.retainOutput, {
        invocationId: invocation.invocationId,
        expectedGeneration: 4,
        responseJson: JSON.stringify(response),
    });
    if (entry === "resume")
        await t.mutation(internal.execution.missionWorkflow.onComplete, {
            workflowId: workflowId as WorkflowId,
            context: { missionId },
            result: { kind: "failed", error: "Simulated process interruption" },
        });
    const userId = await t.run((ctx) =>
        ctx.db.insert("users", { isAnonymous: true }),
    );
    await t.mutation(internal.invitations.claimDigest, {
        authUserId: userId,
        codeDigest: "rotated",
    });
    expect(
        (await t.run((ctx) => ctx.db.get(args.runId)))?.executionGeneration,
    ).toBe(4);
    if (entry === "resume")
        await expect(
            t.mutation(internal.execution.missions.resume, {
                missionId,
                expectedGeneration: 4,
            }),
        ).rejects.toThrow("retained_response_not_reusable");
    else if (entry === "next")
        expect(
            await t.mutation(internal.execution.missionWorkflow.next, {
                missionId,
                expectedGeneration: 4,
            }),
        ).toEqual({ kind: "stopped" });
    else
        expect(
            await t.mutation(internal.execution.invocations.finish, {
                invocationId: invocation.invocationId,
                expectedGeneration: 4,
                response,
            }),
        ).toMatchObject({
            kind: "blocked",
            code: "retained_response_not_reusable",
        });
    expect(
        await t.run((ctx) => ctx.db.query("agentOperationRequests").take(1)),
    ).toEqual([]);
    expect(
        await t.run((ctx) => ctx.db.get(invocation.invocationId)),
    ).toMatchObject({ receivedWhileAuthorized: false });
});

test("duplicate completion references are refused before accepting an artifact", async () => {
    const { t, args, sourceId, captureId } = await seedInspectedEvidence();
    const missionId = await startRetainedInspection(t, {
        runId: args.runId,
        corpusRevisionId: args.corpusRevisionId,
        requestKey: "duplicate-completion",
        expectedGeneration: 4,
    });
    const requestId = await t.mutation(internal.execution.operations.enqueue, {
        missionId,
        expectedGeneration: 4,
        cause: "inspection",
        input: { kind: "read_in_context", sourceId, passageOrder: 0 },
    });
    expect(
        await t.action(internal.execution.operations.dispatch, {
            requestId,
            expectedGeneration: 4,
        }),
    ).toMatchObject({ kind: "success" });
    const invocation = await t.mutation(internal.execution.invocations.begin, {
        missionId,
        expectedGeneration: 4,
        taskKey: "complete",
        provenance: "simulation",
    });
    if (invocation.kind !== "ready") throw new Error("Expected invocation");
    expect(
        await t.mutation(internal.execution.invocations.finish, {
            invocationId: invocation.invocationId,
            expectedGeneration: 4,
            response: {
                kind: "complete",
                captureIds: Array.from({ length: 256 }, () => captureId),
            },
        }),
    ).toMatchObject({ kind: "blocked", code: "completion_references_invalid" });
    expect(await t.run((ctx) => ctx.db.get(missionId))).not.toHaveProperty(
        "result",
    );
});

test("a reused earlier request supplies its awaited result after newer requests", async () => {
    const { t, args, sourceId } = await seedInspectedEvidence();
    const missionId = await startRetainedInspection(t, {
        runId: args.runId,
        corpusRevisionId: args.corpusRevisionId,
        requestKey: "reused-context",
        expectedGeneration: 4,
    });
    const requestId = await t.mutation(internal.execution.operations.enqueue, {
        missionId,
        expectedGeneration: 4,
        cause: "first-read",
        input: { kind: "read_in_context", sourceId, passageOrder: 0 },
    });
    const outcome = await t.action(internal.execution.operations.dispatch, {
        requestId,
        expectedGeneration: 4,
    });
    expect(outcome.kind).toBe("success");
    for (const query of ["workflow", "company", "control", "material"]) {
        const newer = await t.mutation(internal.execution.operations.enqueue, {
            missionId,
            expectedGeneration: 4,
            cause: query,
            input: { kind: "search_available_material", sourceId, query },
        });
        await t.action(internal.execution.operations.dispatch, {
            requestId: newer,
            expectedGeneration: 4,
        });
    }
    const invocation = await t.mutation(internal.execution.invocations.begin, {
        missionId,
        expectedGeneration: 4,
        taskKey: "repeat-read",
        provenance: "simulation",
    });
    if (invocation.kind !== "ready") throw new Error("Expected invocation");
    const returned = await t.mutation(internal.execution.invocations.finish, {
        invocationId: invocation.invocationId,
        expectedGeneration: 4,
        response: {
            kind: "operations",
            requests: [
                {
                    callId: "read-again",
                    name: "read_in_context",
                    inputJson: JSON.stringify({ sourceId, passageOrder: 0 }),
                },
            ],
        },
    });
    expect(returned.requestIds).toEqual([requestId]);
    const context = await t.query(internal.execution.context.build, {
        missionId,
        expectedGeneration: 4,
    });
    if (context.kind !== "ready") throw new Error("Expected context");
    expect(
        JSON.parse(context.inputJson).triggeringRequestsAndResults,
    ).toContainEqual(
        expect.objectContaining({
            requestId,
            outcome: expect.objectContaining({ kind: outcome.kind }),
            historyReference: expect.any(String),
        }),
    );
});

test("a recreated invocation receives retained notes, human instructions and obligations automatically", async () => {
    const { t, args } = await seedInspectedEvidence();
    await installModel(t, nativePiFixtureRoute, "saved_material_inspection");
    await t.run((ctx) =>
        ctx.db.patch(args.runId, {
            researchAngle: "Compare operational control and distribution.",
        }),
    );
    const missionId = await t.mutation(internal.execution.missions.start, {
        runId: args.runId,
        corpusRevisionId: args.corpusRevisionId,
        definitionId: "saved_material_inspection_v1",
        requestKey: "retention",
        expectedGeneration: 4,
    });
    await t.run((ctx) =>
        ctx.db.patch(missionId, {
            workingNotes:
                "Hypothesis: distribution may shift. Rejected: no evidence of direct execution.",
            obligations: ["inspect_saved_material", "examine_counter_evidence"],
        }),
    );
    const invocation = await t.mutation(internal.execution.invocations.begin, {
        missionId,
        expectedGeneration: 4,
        taskKey: "turn-0",
        provenance: "simulation",
    });
    expect(invocation.kind).toBe("ready");
    if (invocation.kind !== "ready")
        throw new Error("Expected ready invocation");
    const input = JSON.parse(invocation.inputJson);
    expect(input.domain.humanInstructions.researchAngle).toBe(
        "Compare operational control and distribution.",
    );
    expect(input.workingNotes.text).toContain(
        "Rejected: no evidence of direct execution.",
    );
    expect(input.activeWork.unfinishedObligations).toEqual([
        "inspect_saved_material",
        "examine_counter_evidence",
    ]);
    expect(
        await t.run((ctx) => ctx.db.get(invocation.invocationId)),
    ).toMatchObject({
        inputJson: invocation.inputJson,
        provenance: "simulation",
    });
});

test("required context over capacity blocks without discarding notes or obligations", async () => {
    const { seedPiMission } = await import("@/__tests__/setup/pi-mission");
    const { t, missionId } = await seedPiMission();
    const notes = "x".repeat(600000);
    await t.run((ctx) => ctx.db.patch(missionId, { workingNotes: notes }));
    await t.mutation(internal.execution.missions.resume, {
        missionId,
        expectedGeneration: 4,
        simulation: true,
    });
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(10), 500);
    expect(await t.run((ctx) => ctx.db.get(missionId))).toMatchObject({
        workingNotes: notes,
        obligations: ["inspect_saved_material"],
        status: "blocked",
        blockCode: "context_capacity",
    });
});

test("a returned batch is persisted before dispatch and cannot complete with unfinished obligations", async () => {
    const { t, args, sourceId } = await seedInspectedEvidence();
    const missionId = await startRetainedInspection(t, {
        runId: args.runId,
        corpusRevisionId: args.corpusRevisionId,
        requestKey: "handoff",
        expectedGeneration: 4,
    });
    const invocation = await t.mutation(internal.execution.invocations.begin, {
        missionId,
        expectedGeneration: 4,
        taskKey: "turn-0",
        provenance: "simulation",
    });
    if (invocation.kind !== "ready")
        throw new Error("Expected ready invocation");
    const reply = {
        kind: "operations" as const,
        workingNotes: "Next examine the retained passage.",
        requests: [
            {
                callId: "read-1",
                name: "read_in_context",
                inputJson: JSON.stringify({ sourceId, passageOrder: 0 }),
            },
        ],
    };
    const returned = await t.mutation(internal.execution.invocations.finish, {
        invocationId: invocation.invocationId,
        expectedGeneration: 4,
        response: reply,
    });
    expect(returned.kind).toBe("waiting");
    expect(returned.requestIds).toHaveLength(1);
    const requestId = returned.requestIds[0];
    if (!requestId) throw new Error("Expected persisted request");
    expect(await t.run((ctx) => ctx.db.get(requestId))).toMatchObject({
        status: "pending",
        actor: "agent",
        cause: "read-1",
        input: { kind: "read_in_context", sourceId, passageOrder: 0 },
    });
    const next = await t.mutation(internal.execution.invocations.begin, {
        missionId,
        expectedGeneration: 4,
        taskKey: "turn-1",
        provenance: "simulation",
    });
    expect(next).toMatchObject({ kind: "blocked", code: "pending_operations" });
});

test("late cancelled output is retained but cannot create requests or advance the mission", async () => {
    const { t, args } = await seedInspectedEvidence();
    await installModel(t, nativePiFixtureRoute, "saved_material_inspection");
    const missionId = await t.mutation(internal.execution.missions.start, {
        runId: args.runId,
        corpusRevisionId: args.corpusRevisionId,
        definitionId: "saved_material_inspection_v1",
        requestKey: "cancelled",
        expectedGeneration: 4,
    });
    const invocation = await t.mutation(internal.execution.invocations.begin, {
        missionId,
        expectedGeneration: 4,
        taskKey: "turn-0",
        provenance: "simulation",
    });
    if (invocation.kind !== "ready")
        throw new Error("Expected ready invocation");
    await t.run((ctx) =>
        ctx.db.patch(args.runId, {
            executionStatus: "cancelled",
            executionGeneration: 5,
        }),
    );
    const response = {
        kind: "operations" as const,
        requests: [
            { callId: "late", name: "consult_mission_state", inputJson: "{}" },
        ],
    };
    await t.mutation(internal.execution.invocations.retainOutput, {
        invocationId: invocation.invocationId,
        expectedGeneration: 4,
        responseJson: JSON.stringify(response),
    });
    const observed = await t.run((ctx) => ctx.db.get(invocation.invocationId));
    expect(observed?.receivedWhileAuthorized).toBe(false);
    expect(JSON.parse(observed?.receivedOutputJson ?? "null")).toEqual(
        response,
    );
    expect(
        await t.mutation(internal.execution.invocations.finish, {
            invocationId: invocation.invocationId,
            expectedGeneration: 4,
            response,
        }),
    ).toMatchObject({
        kind: "blocked",
        requestIds: [],
        code: "stale_execution",
    });
    const retained = await t.run((ctx) => ctx.db.get(invocation.invocationId));
    expect(retained?.status).toBe("returned");
    expect(JSON.parse(retained?.outputJson ?? "null")).toEqual(response);
    expect(
        await t.run((ctx) => ctx.db.query("agentOperationRequests").collect()),
    ).toEqual([]);
});

test("logical request identity ignores JSON argument key order", async () => {
    const { t, args, sourceId } = await seedInspectedEvidence();
    const missionId = await startRetainedInspection(t, {
        runId: args.runId,
        corpusRevisionId: args.corpusRevisionId,
        requestKey: "logical-identity",
        expectedGeneration: 4,
    });
    const invocation = await t.mutation(internal.execution.invocations.begin, {
        missionId,
        expectedGeneration: 4,
        taskKey: "turn-0",
        provenance: "simulation",
    });
    if (invocation.kind !== "ready") throw new Error("Expected invocation");
    const result = await t.mutation(internal.execution.invocations.finish, {
        invocationId: invocation.invocationId,
        expectedGeneration: 4,
        response: {
            kind: "operations",
            requests: [
                {
                    callId: "read-a",
                    name: "read_in_context",
                    inputJson: JSON.stringify({ sourceId, passageOrder: 0 }),
                },
                {
                    callId: "read-b",
                    name: "read_in_context",
                    inputJson: JSON.stringify({ passageOrder: 0, sourceId }),
                },
            ],
        },
    });
    expect(result.requestIds).toHaveLength(2);
    expect(result.requestIds[0]).toBe(result.requestIds[1]);
});

test("saying complete without inspected artifacts cannot satisfy the mission", async () => {
    const { t, args, captureId } = await seedInspectedEvidence();
    const missionId = await t.mutation(internal.execution.missions.start, {
        runId: args.runId,
        corpusRevisionId: args.corpusRevisionId,
        definitionId: "saved_material_inspection_v1",
        requestKey: "completion",
        expectedGeneration: 4,
    });
    const invocation = await t.mutation(internal.execution.invocations.begin, {
        missionId,
        expectedGeneration: 4,
        taskKey: "turn-0",
        provenance: "simulation",
    });
    if (invocation.kind !== "ready")
        throw new Error("Expected ready invocation");
    expect(
        await t.mutation(internal.execution.invocations.finish, {
            invocationId: invocation.invocationId,
            expectedGeneration: 4,
            response: { kind: "complete", captureIds: [captureId] },
        }),
    ).toMatchObject({
        kind: "blocked",
        code: "completion_requirements_missing",
    });
    const unfinished = await t.run((ctx) => ctx.db.get(missionId));
    expect(unfinished).not.toHaveProperty("result");
    expect(unfinished).toMatchObject({
        obligations: ["inspect_saved_material"],
    });
});

test.each([
    4, 5,
])("an observed paid response is adopted after a crash in generation %s without dispatching a second provider call", async (recoveredGeneration) => {
    vi.useFakeTimers();
    const { t, args } = await seedInspectedEvidence();
    await installModel(t, nativePiFixtureRoute, "saved_material_inspection");
    const missionId = await t.mutation(internal.execution.missions.start, {
        runId: args.runId,
        corpusRevisionId: args.corpusRevisionId,
        definitionId: "saved_material_inspection_v1",
        requestKey: "observed-recovery",
        expectedGeneration: 4,
    });
    const invocation = await t.mutation(internal.execution.invocations.begin, {
        missionId,
        expectedGeneration: 4,
        taskKey: "turn-0",
        provenance: "live",
    });
    if (invocation.kind !== "ready")
        throw new Error("Expected ready invocation");
    const { sha256Hex } = await import("@convex/domain/sourcePassages");
    const attempt = {
        missionId,
        invocationId: invocation.invocationId,
        runId: args.runId,
        corpusRevisionId: args.corpusRevisionId,
        executionGeneration: 4,
        workflowVersion: getAgentDefinition("saved_material_inspection_v1")
            .version,
        stepKey: "agent_reasoning",
        service: "model" as const,
        operation: "agent_reasoning",
        operationKey: `mission:${missionId}:invocation:${invocation.invocationId}:attempt:1`,
        attempt: 1,
        inputHash: sha256Hex(invocation.inputJson),
    };
    await t.mutation(internal.providerCalls.recordAttempt, {
        ...attempt,
        status: "started",
    });
    await t.mutation(internal.providerCalls.recordAttempt, {
        ...attempt,
        status: "succeeded",
        dispatchOutcome: "response_received",
    });
    const response = {
        kind: "operations" as const,
        requests: [
            {
                callId: "retained-consult",
                name: "consult_mission_state",
                inputJson: "{}",
            },
        ],
    };
    await t.mutation(internal.execution.invocations.retainOutput, {
        invocationId: invocation.invocationId,
        expectedGeneration: 4,
        responseJson: JSON.stringify(response),
    });
    if (recoveredGeneration !== 4) {
        workflowTest.register(t);
        await t.run(async (ctx) => {
            await ctx.db.patch(missionId, {
                status: "blocked",
                blockCode: "execution_interrupted",
            });
            await ctx.db.patch(args.runId, {
                lifecycleState: "corpus_approved",
                executionStatus: "idle",
            });
            const { claimCorpusApprovedRunExecution } = await import(
                "@convex/domain/executionClaim"
            );
            const run = await ctx.db.get(args.runId);
            const visitor = run?.ownerVisitorId
                ? await ctx.db.get(run.ownerVisitorId)
                : null;
            if (!run || !visitor) throw new Error("Missing execution owner");
            expect(
                await claimCorpusApprovedRunExecution(ctx, {
                    run,
                    visitor,
                    now: Date.now(),
                }),
            ).toBe(recoveredGeneration);
        });
        await t.mutation(internal.execution.missions.resume, {
            missionId,
            expectedGeneration: recoveredGeneration,
        });
    }
    const next = await t.mutation(internal.execution.missionWorkflow.next, {
        missionId,
        expectedGeneration: recoveredGeneration,
    });
    expect(next).toMatchObject({
        kind: "adopt",
        invocationId: invocation.invocationId,
        response,
    });
    if (next.kind !== "adopt")
        throw new Error("Expected retained response adoption");
    expect(
        await t.mutation(internal.execution.invocations.finish, {
            invocationId: invocation.invocationId,
            expectedGeneration: recoveredGeneration,
            response: next.response,
        }),
    ).toMatchObject({ kind: "waiting" });
    expect(
        await t.run((ctx) => ctx.db.query("providerCalls").collect()),
    ).toHaveLength(1);
    expect(
        await t.run((ctx) => ctx.db.get(invocation.invocationId)),
    ).toMatchObject({ generation: 4, receivedWhileAuthorized: true });
});

test("exact history pagination reconstructs large observable records without gaps", async () => {
    const { t, args } = await seedInspectedEvidence();
    await installModel(t, nativePiFixtureRoute, "saved_material_inspection");
    const missionId = await t.mutation(internal.execution.missions.start, {
        runId: args.runId,
        corpusRevisionId: args.corpusRevisionId,
        definitionId: "saved_material_inspection_v1",
        requestKey: "history",
        expectedGeneration: 4,
    });
    const begun = await t.mutation(internal.execution.invocations.begin, {
        missionId,
        expectedGeneration: 4,
        taskKey: "large-history",
        provenance: "simulation",
    });
    if (begun.kind !== "ready") throw new Error("Expected invocation");
    const rawOutputJson = JSON.stringify({
        text: "Quoted evidence 😀".repeat(1200),
    });
    await t.mutation(internal.execution.invocations.finish, {
        invocationId: begun.invocationId,
        expectedGeneration: 4,
        response: { kind: "operations", requests: [] },
        rawOutputJson,
    });
    const actual = new Map<number, string>();
    const lengths = new Map<number, number>();
    let cursor: string | null = null;
    let pages = 0;
    do {
        const requestId: Id<"agentOperationRequests"> = await t.mutation(
            internal.execution.operations.enqueue,
            {
                missionId,
                expectedGeneration: 4,
                cause: "reconstruct-history",
                input: {
                    kind: "consult_mission_state" as const,
                    ...(cursor ? { cursor } : {}),
                },
            },
        );
        const outcome: OperationOutcome = await t.action(
            internal.execution.operations.dispatch,
            { requestId, expectedGeneration: 4 },
        );
        expect(outcome.kind).toBe("success");
        if (outcome.kind !== "success") throw new Error("Expected history");
        const page = JSON.parse(outcome.valueJson).history;
        for (const entry of page.entries) {
            const previous = actual.get(entry.sequence) ?? "";
            expect(entry.offset).toBe(previous.length);
            actual.set(entry.sequence, previous + entry.content);
            lengths.set(entry.sequence, entry.totalCharacters);
        }
        cursor = page.continueCursor;
        expect(++pages).toBeLessThan(100);
    } while (cursor);
    expect(pages).toBeGreaterThan(1);
    for (const [sequence, text] of actual)
        expect(text.length).toBe(lengths.get(sequence));
    const observation = [...actual.values()]
        .map((text) => JSON.parse(text))
        .find((value) => value.observation?.value?.rawOutputJson);
    expect(observation?.observation.value.rawOutputJson).toBe(rawOutputJson);
});

test.each([
    "",
    "duplicate",
])("malformed tool correlation %s blocks explicitly and retains the response", async (correlation) => {
    const { t, args } = await seedInspectedEvidence();
    await installModel(t, nativePiFixtureRoute, "saved_material_inspection");
    const missionId = await t.mutation(internal.execution.missions.start, {
        runId: args.runId,
        corpusRevisionId: args.corpusRevisionId,
        definitionId: "saved_material_inspection_v1",
        requestKey: "invalid-correlation",
        expectedGeneration: 4,
    });
    const invocation = await t.mutation(internal.execution.invocations.begin, {
        missionId,
        expectedGeneration: 4,
        taskKey: "turn-0",
        provenance: "simulation",
    });
    if (invocation.kind !== "ready") throw new Error("Expected invocation");
    const request = {
        callId: correlation,
        name: "consult_mission_state",
        inputJson: "{}",
    };
    const response = {
        kind: "operations" as const,
        requests: correlation ? [request, request] : [request],
    };
    expect(
        await t.mutation(internal.execution.invocations.finish, {
            invocationId: invocation.invocationId,
            expectedGeneration: 4,
            response,
        }),
    ).toMatchObject({ kind: "blocked", code: "invalid_tool_correlation" });
    expect(
        await t.run((ctx) => ctx.db.get(invocation.invocationId)),
    ).toMatchObject({
        status: "returned",
        blockCode: "invalid_tool_correlation",
    });
    expect(
        await t.run((ctx) => ctx.db.query("agentOperationRequests").collect()),
    ).toEqual([]);
});

test("the fresh context automatically carries the previous observable assistant reply", async () => {
    const { t, args } = await seedInspectedEvidence();
    await installModel(t, nativePiFixtureRoute, "saved_material_inspection");
    const missionId = await t.mutation(internal.execution.missions.start, {
        runId: args.runId,
        corpusRevisionId: args.corpusRevisionId,
        definitionId: "saved_material_inspection_v1",
        requestKey: "assistant-continuity",
        generationBackend: { id: "convex-agent", version: 2 },
        expectedGeneration: 4,
    });
    const first = await t.mutation(internal.execution.invocations.begin, {
        missionId,
        expectedGeneration: 4,
        taskKey: "first",
        provenance: "simulation",
    });
    if (first.kind !== "ready") throw new Error("Expected invocation");
    const rawOutputJson = JSON.stringify({
        assistantOutput:
            "Hypothesis remains open; reject the distribution interpretation if the cited passage concerns only product scope.",
    });
    await t.mutation(internal.execution.invocations.finish, {
        invocationId: first.invocationId,
        expectedGeneration: 4,
        response: { kind: "operations", requests: [] },
        rawOutputJson,
    });
    const next = await t.mutation(internal.execution.invocations.begin, {
        missionId,
        expectedGeneration: 4,
        taskKey: "second",
        provenance: "simulation",
    });
    if (next.kind !== "ready") throw new Error("Expected continuation");
    expect(JSON.parse(next.inputJson).lastObservableInvocation).toMatchObject({
        invocationId: first.invocationId,
        rawOutputJson,
    });
});
