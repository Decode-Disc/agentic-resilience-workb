import { createHash } from "node:crypto";
import { internal } from "@convex/_generated/api";
import { afterEach, expect, test, vi } from "vitest";
import workflowTest from "@/__tests__/convex/workflows/workflow-test-register.js";
import { seedInspectedEvidence } from "@/__tests__/setup/source-preparation";

afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
});

test("the same durable Workflow completes a second definition through temporary invocations", async () => {
    vi.useFakeTimers();
    const { t, args, missionId } = await validationFixture();
    workflowTest.register(t);
    await t.mutation(internal.execution.missions.resume, {
        missionId,
        expectedGeneration: args.executionGeneration,
        simulation: true,
    });
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(10), 500);
    expect(await t.run((ctx) => ctx.db.get(missionId))).toMatchObject({
        status: "completed",
        state: { kind: "execution_validation_v1", checkedIndices: [0, 1] },
        result: { kind: "execution_validation_v1", total: 10 },
        obligations: [],
    });
    const invocations = await t.run((ctx) =>
        ctx.db
            .query("agentInvocations")
            .withIndex("by_mission", (q) => q.eq("missionId", missionId))
            .collect(),
    );
    expect(invocations).toHaveLength(3);
    expect(
        invocations.every(
            (invocation) => invocation.provenance === "simulation",
        ),
    ).toBe(true);
    const lastContext: unknown = JSON.parse(
        invocations[2]?.inputJson ?? "null",
    );
    expect(lastContext).toMatchObject({
        activeWork: { checkedIndices: [0, 1] },
        triggeringRequestsAndResults: [
            {
                input: { kind: "check_fixture_value", index: 1 },
                outcome: {
                    kind: "success",
                    valueJson: '{"index":1,"value":7}',
                },
            },
        ],
    });
}, 30_000);

async function validationFixture() {
    vi.stubEnv("E2E_FIXTURES_ENABLED", "true");
    vi.stubEnv("CONVEX_CLOUD_URL", "http://127.0.0.1:3212");
    const { t, args, invitationId, sourceId } = await seedInspectedEvidence();
    await t.run((ctx) => ctx.db.patch(invitationId, { slotKey: "analyst-4" }));
    const contextId = await t.mutation(
        internal.runWorkspace.openBrowserTestContext,
        {
            slotKey: "analyst-4",
            contextKey: "agent-extension",
            durationMs: 60_000,
        },
    );
    await t.run((ctx) =>
        ctx.db.patch(args.runId, {
            purpose: "browser_test",
            browserTestContextId: contextId,
            activeCorpusRevisionId: undefined,
        }),
    );
    const input = {
        runId: args.runId,
        definitionId: "execution_validation_v1" as const,
        scope: { kind: "execution_validation_v1" as const, values: [3, 7] },
        requestKey: "validate-extension",
        expectedGeneration: args.executionGeneration,
    };
    const missionId = await t.mutation(
        internal.execution.missions.start,
        input,
    );
    return { t, args, input, missionId, sourceId };
}

test("a registered validation agent starts without an approved corpus and retains its own typed state", async () => {
    const { t, input, missionId } = await validationFixture();
    expect(await t.mutation(internal.execution.missions.start, input)).toBe(
        missionId,
    );
    const mission = await t.run((ctx) => ctx.db.get(missionId));
    expect(mission).toMatchObject({
        protocolVersion: 3,
        definitionId: "execution_validation_v1",
        state: { kind: "execution_validation_v1", checkedIndices: [] },
    });
    expect(mission).not.toHaveProperty("corpusRevisionId");
    expect(mission).not.toHaveProperty("inspectedCaptureIds");
});

test("the shared native dispatcher applies only the validation agent's typed progress", async () => {
    const { t, args, missionId } = await validationFixture();
    const requestId = await t.mutation(internal.execution.operations.enqueue, {
        missionId,
        expectedGeneration: args.executionGeneration,
        cause: "native-check",
        input: { kind: "check_fixture_value", index: 0 },
    });
    expect(
        await t.action(internal.execution.operations.dispatch, {
            requestId,
            expectedGeneration: args.executionGeneration,
        }),
    ).toMatchObject({ kind: "success", valueJson: '{"index":0,"value":3}' });
    expect(await t.run((ctx) => ctx.db.get(missionId))).toMatchObject({
        state: { kind: "execution_validation_v1", checkedIndices: [0] },
    });
    expect(
        await t.run((ctx) => ctx.db.query("providerCalls").collect()),
    ).toEqual([]);
});

test("confirmed operations are reused without adding progress or provider attempts", async () => {
    const { t, args, missionId } = await validationFixture();
    const input = {
        missionId,
        expectedGeneration: args.executionGeneration,
        cause: "reuse",
        input: { kind: "check_fixture_value" as const, index: 0 },
    };
    const requestId = await t.mutation(
        internal.execution.operations.enqueue,
        input,
    );
    await t.action(internal.execution.operations.dispatch, {
        requestId,
        expectedGeneration: 4,
    });
    expect(await t.mutation(internal.execution.operations.enqueue, input)).toBe(
        requestId,
    );
    await t.action(internal.execution.operations.dispatch, {
        requestId,
        expectedGeneration: 4,
    });
    expect(await t.run((ctx) => ctx.db.get(missionId))).toMatchObject({
        progressKeys: ["checked:0"],
        state: { checkedIndices: [0] },
    });
});

test("native and agent requests cannot acquire another definition's operations", async () => {
    const { t, args, missionId, sourceId } = await validationFixture();
    const native = await t.mutation(internal.execution.operations.enqueue, {
        missionId,
        expectedGeneration: 4,
        cause: "forbidden",
        input: { kind: "read_in_context", sourceId: sourceId, passageOrder: 0 },
    });
    expect(await t.run((ctx) => ctx.db.get(native))).toMatchObject({
        status: "completed",
        outcome: { kind: "refused", code: "operation_not_allowed" },
    });
    const invocation = await t.mutation(internal.execution.invocations.begin, {
        missionId,
        expectedGeneration: args.executionGeneration,
        taskKey: "forbidden-tool",
        provenance: "simulation",
    });
    if (invocation.kind !== "ready") throw new Error("Expected invocation");
    await t.mutation(internal.execution.invocations.finish, {
        invocationId: invocation.invocationId,
        expectedGeneration: 4,
        response: {
            kind: "operations",
            requests: [
                {
                    callId: "forbidden",
                    name: "read_in_context",
                    inputJson: JSON.stringify({
                        sourceId: sourceId,
                        passageOrder: 0,
                    }),
                },
            ],
        },
    });
    const requests = await t.run((ctx) =>
        ctx.db
            .query("agentOperationRequests")
            .withIndex("by_mission", (q) => q.eq("missionId", missionId))
            .collect(),
    );
    expect(
        requests.every(
            (request) =>
                request.status === "completed" &&
                request.outcome?.kind === "refused",
        ),
    ).toBe(true);
    expect(await t.run((ctx) => ctx.db.get(missionId))).toMatchObject({
        state: { checkedIndices: [] },
    });
});

test("incompatible completion data cannot complete a validation mission", async () => {
    const { t, missionId } = await validationFixture();
    const invocation = await t.mutation(internal.execution.invocations.begin, {
        missionId,
        expectedGeneration: 4,
        taskKey: "wrong-result",
        provenance: "simulation",
    });
    if (invocation.kind !== "ready") throw new Error("Expected invocation");
    expect(
        await t.mutation(internal.execution.invocations.finish, {
            invocationId: invocation.invocationId,
            expectedGeneration: 4,
            response: { kind: "complete", captureIds: [] },
        }),
    ).toMatchObject({ kind: "blocked", code: "invalid_completion" });
    expect(await t.run((ctx) => ctx.db.get(missionId))).not.toHaveProperty(
        "result",
    );
});

test.each([
    "wrong value",
    "malformed JSON",
])("an invalid operation result (%s) cannot create progress", async (failure) => {
    const { t, missionId } = await validationFixture();
    const requestId = await t.mutation(internal.execution.operations.enqueue, {
        missionId,
        expectedGeneration: 4,
        cause: "bad-result",
        input: { kind: "check_fixture_value", index: 0 },
    });
    await t.mutation(internal.execution.operations.claim, {
        requestId,
        expectedGeneration: 4,
    });
    expect(
        await t.mutation(internal.execution.operations.recordResult, {
            requestId,
            expectedGeneration: 4,
            outcome: {
                kind: "success",
                valueJson:
                    failure === "wrong value" ? '{"index":0,"value":999}' : "{",
                progressKey: "checked:0",
            },
        }),
    ).toMatchObject({
        kind: "refused",
        code:
            failure === "wrong value"
                ? "validation_result_invalid"
                : "operation_adoption_failed",
    });
    expect(await t.run((ctx) => ctx.db.get(missionId))).toMatchObject({
        progressKeys: [],
        state: { checkedIndices: [] },
    });
});

test("stale results and unknown definition versions cannot advance a second agent", async () => {
    const { t, args, missionId } = await validationFixture();
    const requestId = await t.mutation(internal.execution.operations.enqueue, {
        missionId,
        expectedGeneration: 4,
        cause: "late",
        input: { kind: "check_fixture_value", index: 0 },
    });
    await t.mutation(internal.execution.operations.claim, {
        requestId,
        expectedGeneration: 4,
    });
    await t.run((ctx) => ctx.db.patch(args.runId, { executionGeneration: 5 }));
    expect(
        await t.mutation(internal.execution.operations.recordResult, {
            requestId,
            expectedGeneration: 4,
            outcome: { kind: "success", valueJson: '{"index":0,"value":3}' },
        }),
    ).toMatchObject({ kind: "refused", code: "stale_execution" });
    await t.run(async (ctx) => {
        await ctx.db.patch(args.runId, { executionGeneration: 4 });
        await ctx.db.patch(missionId, { definitionVersion: 99 });
    });
    await expect(
        t.query(internal.execution.context.build, {
            missionId,
            expectedGeneration: 4,
        }),
    ).rejects.toThrow("definition_version_conflict");
    expect(await t.run((ctx) => ctx.db.get(missionId))).toMatchObject({
        state: { checkedIndices: [] },
    });
});

test("the validation binding loses authority when local fixtures are disabled", async () => {
    const { t, missionId } = await validationFixture();
    vi.stubEnv("E2E_FIXTURES_ENABLED", "false");
    await expect(
        t.query(internal.execution.context.build, {
            missionId,
            expectedGeneration: 4,
        }),
    ).rejects.toThrow();
});

test("a legacy mission keeps its stored requests, hash identities and flat completion through old function paths", async () => {
    const { t, args, sourceId, captureId } = await seedInspectedEvidence();
    const missionId = await t.mutation(internal.execution.missions.start, {
        runId: args.runId,
        corpusRevisionId: args.corpusRevisionId,
        definitionId: "saved_material_inspection_v1",
        requestKey: "legacy",
        expectedGeneration: 4,
    });
    const requestId = await t.run(async (ctx) => {
        const mission = await ctx.db.get(missionId);
        const capture = await ctx.db.get(captureId);
        if (!mission || !("protocolVersion" in mission) || !capture)
            throw new Error("Expected fixture");
        const {
            _id,
            _creationTime: _created,
            protocolVersion: _protocol,
            scope: _scope,
            state: _state,
            result: _result,
            ...common
        } = mission;
        await ctx.db.replace(_id, {
            ...common,
            definitionId: "saved_material_inspection_v1",
            corpusRevisionId: args.corpusRevisionId,
            inspectedCaptureIds: [],
            completionRefs: [],
        });
        const logicalKey = createHash("sha256")
            .update(
                JSON.stringify({
                    corpusRevisionId: args.corpusRevisionId,
                    input: {
                        kind: "read_in_context",
                        passageOrder: 0,
                        sourceId,
                    },
                    objective: mission.objectiveKey,
                    pin: {
                        expectedCaptureId: captureId,
                        expectedContentHash: capture.contentHash,
                    },
                    version: 1,
                }),
            )
            .digest("hex");
        return ctx.db.insert("agentOperationRequests", {
            missionId,
            actor: "system",
            cause: "legacy-pending",
            input: { kind: "read_in_context", passageOrder: 0, sourceId },
            expectedCaptureId: captureId,
            expectedContentHash: capture.contentHash,
            operationVersion: 1,
            expectedGeneration: 4,
            logicalKey,
            status: "pending",
            createdAt: Date.now(),
        });
    });
    expect(
        await t.mutation(internal.execution.operations.enqueue, {
            missionId,
            expectedGeneration: 4,
            cause: "legacy-reuse",
            input: { kind: "read_in_context", passageOrder: 0, sourceId },
        }),
    ).toBe(requestId);
    expect(
        await t.action(internal.execution.operations.dispatch, {
            requestId,
            expectedGeneration: 4,
        }),
    ).toMatchObject({ kind: "success" });
    const invocation = await t.mutation(internal.execution.invocations.begin, {
        missionId,
        expectedGeneration: 4,
        taskKey: "legacy-complete",
        provenance: "simulation",
    });
    if (invocation.kind !== "ready") throw new Error("Expected invocation");
    await t.run((ctx) =>
        ctx.db.patch(invocation.invocationId, { scopeKey: undefined }),
    );
    await t.mutation(internal.execution.invocations.retainOutput, {
        invocationId: invocation.invocationId,
        expectedGeneration: 4,
        responseJson: JSON.stringify({
            kind: "complete",
            captureIds: [captureId],
        }),
    });
    expect(
        await t.mutation(internal.execution.invocations.finish, {
            invocationId: invocation.invocationId,
            expectedGeneration: 4,
            response: { kind: "complete", captureIds: [captureId] },
        }),
    ).toMatchObject({ kind: "completed" });
    const completed = await t.run((ctx) => ctx.db.get(missionId));
    expect(completed).toMatchObject({
        status: "completed",
        inspectedCaptureIds: [captureId],
        completionRefs: [captureId],
    });
    expect(completed).not.toHaveProperty("state");
    expect(completed).not.toHaveProperty("protocolVersion");
});
