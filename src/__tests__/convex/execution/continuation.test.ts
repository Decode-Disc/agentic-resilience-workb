import { internal } from "@convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { expect, test } from "vitest";
import { seedInspectedEvidence } from "@/__tests__/setup/source-preparation";

test("a recreated invocation receives retained notes, human instructions and obligations automatically", async () => {
    const { t, args } = await seedInspectedEvidence();
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
    expect(input.humanInstructions.researchAngle).toBe(
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
    const { t, args } = await seedInspectedEvidence();
    const missionId = await t.mutation(internal.execution.missions.start, {
        runId: args.runId,
        corpusRevisionId: args.corpusRevisionId,
        definitionId: "saved_material_inspection_v1",
        requestKey: "capacity",
        expectedGeneration: 4,
    });
    const notes = "x".repeat(128 * 1024);
    await t.run((ctx) => ctx.db.patch(missionId, { workingNotes: notes }));
    expect(
        await t.mutation(internal.execution.invocations.begin, {
            missionId,
            expectedGeneration: 4,
            taskKey: "turn-0",
            provenance: "simulation",
        }),
    ).toEqual({ kind: "blocked", code: "context_capacity" });
    expect(await t.run((ctx) => ctx.db.get(missionId))).toMatchObject({
        workingNotes: notes,
        obligations: ["inspect_saved_material"],
        status: "blocked",
        blockCode: "context_capacity",
    });
});

test("a returned batch is persisted before dispatch and cannot complete with unfinished obligations", async () => {
    const { t, args, sourceId } = await seedInspectedEvidence();
    const missionId = await t.mutation(internal.execution.missions.start, {
        runId: args.runId,
        corpusRevisionId: args.corpusRevisionId,
        definitionId: "saved_material_inspection_v1",
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
    const missionId = await t.mutation(internal.execution.missions.start, {
        runId: args.runId,
        corpusRevisionId: args.corpusRevisionId,
        definitionId: "saved_material_inspection_v1",
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
    expect(await t.run((ctx) => ctx.db.get(missionId))).toMatchObject({
        completionRefs: [],
        obligations: ["inspect_saved_material"],
    });
});

test("an observed paid response is adopted after a crash without dispatching a second provider call", async () => {
    const { t, args } = await seedInspectedEvidence();
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
        workflowVersion: 1,
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
    const next = await t.mutation(internal.execution.missionWorkflow.next, {
        missionId,
        expectedGeneration: 4,
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
            expectedGeneration: 4,
            response: next.response,
        }),
    ).toMatchObject({ kind: "waiting" });
    expect(
        await t.run((ctx) => ctx.db.query("providerCalls").collect()),
    ).toHaveLength(1);
});

test("exact history pagination reconstructs large observable records without gaps", async () => {
    const { t, args } = await seedInspectedEvidence();
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
    const expected = await t.run(async (ctx) => {
        const events = await ctx.db
            .query("agentExecutionEvents")
            .withIndex("by_mission_and_sequence", (q) =>
                q.eq("missionId", missionId),
            )
            .collect();
        return Promise.all(
            events.map(async (event) =>
                JSON.stringify({
                    event,
                    invocation: event.invocationId
                        ? await ctx.db.get(event.invocationId)
                        : null,
                    request: event.requestId
                        ? await ctx.db.get(event.requestId)
                        : null,
                }),
            ),
        );
    });
    const actual = new Map<number, string>();
    let cursor: string | null = null;
    let pages = 0;
    do {
        const page: FunctionReturnType<
            typeof internal.execution.missions.history
        > = await t.query(internal.execution.missions.history, {
            missionId,
            expectedGeneration: 4,
            ...(cursor ? { cursor } : {}),
        });
        for (const entry of page.entries) {
            const previous = actual.get(entry.sequence) ?? "";
            expect(entry.offset).toBe(previous.length);
            actual.set(entry.sequence, previous + entry.content);
        }
        cursor = page.continueCursor;
        expect(++pages).toBeLessThan(100);
    } while (cursor);
    expect(pages).toBeGreaterThan(1);
    expect([...actual.values()]).toEqual(expected);
});

test.each([
    "",
    "duplicate",
])("malformed tool correlation %s blocks explicitly and retains the response", async (correlation) => {
    const { t, args } = await seedInspectedEvidence();
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
    const missionId = await t.mutation(internal.execution.missions.start, {
        runId: args.runId,
        corpusRevisionId: args.corpusRevisionId,
        definitionId: "saved_material_inspection_v1",
        requestKey: "assistant-continuity",
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
