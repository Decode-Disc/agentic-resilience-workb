import { api, internal } from "@convex/_generated/api";
import {
    getAgentDefinition,
    registeredAgentDefinitions,
} from "@convex/execution/agentCatalog";
import { modelOperationOutcome } from "@convex/execution/agentDefinition";
import { commonOperations } from "@convex/execution/commonOperations";
import { afterEach, assert, expect, test, vi } from "vitest";
import { seedHistoryMission } from "@/__tests__/setup/execution-history";
import { seedInspectedEvidence } from "@/__tests__/setup/source-preparation";
import { seedWorkbench } from "@/__tests__/setup/workbench";

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.useRealTimers();
});

test("a pure read failure is retained as an incident without stranding the request", async () => {
    const f = await seedHistoryMission();
    const operation = commonOperations.consult_run_state;
    const original = { ...operation };
    vi.spyOn(operation, "execute").mockImplementation((ctx, args) =>
        original.execute(
            {
                ...ctx,
                runQuery: async () => {
                    throw new Error("storage detail must stay private");
                },
            },
            args,
        ),
    );
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: f.missionId,
            expectedGeneration: 1,
            cause: "read-incident",
            input: { kind: "consult_run_state" },
        },
    );
    const outcome = await f.t.action(internal.execution.operations.dispatch, {
        requestId,
        expectedGeneration: 1,
    });
    expect(outcome).toEqual({
        kind: "unavailable",
        code: "operation_execution_failed",
    });
    expect(JSON.stringify(outcome)).not.toContain("storage detail");
    expect(await f.t.run((ctx) => ctx.db.get(requestId))).toMatchObject({
        status: "completed",
        outcome,
    });
    expect(await f.t.run((ctx) => ctx.db.get(f.missionId))).toMatchObject({
        progressKeys: [],
    });
    expect(
        await f.t.run((ctx) =>
            ctx.db
                .query("agentExecutionEvents")
                .withIndex("by_mission_and_kind", (q) =>
                    q
                        .eq("missionId", f.missionId)
                        .eq("kind", "operation_execution_incident"),
                )
                .collect(),
        ),
    ).toEqual([
        expect.objectContaining({
            requestId,
            code: "operation_execution_failed",
            protectedDiagnostic: {
                phase: "read_callback",
                name: "Error",
                message: "storage detail must stay private",
                causeHash: expect.any(String),
            },
        }),
    ]);
});

test("a confirmed framing effect survives a lost action acknowledgement without repeating the write", async () => {
    const f = await seedWorkbench(true);
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
    const mission = await f.t.run((ctx) => ctx.db.get(active.missionId));
    assert(mission);
    const operation = getAgentDefinition(
        "workbench_v1",
        mission.definitionVersion,
    ).operations.adjust_framing;
    assert(operation?.effectKind === "atomic_effect");
    const original = { ...operation };
    vi.spyOn(operation, "execute").mockImplementation((ctx, args) =>
        original.execute(
            {
                ...ctx,
                runMutation: async (reference, ...mutationArgs) => {
                    await ctx.runMutation(reference, ...mutationArgs);
                    throw new Error("acknowledgement lost");
                },
            },
            args,
        ),
    );
    const message = await f.t.run(async (ctx) =>
        (
            await ctx.db
                .query("agentMessageDeliveries")
                .withIndex("by_turn", (q) => q.eq("turnId", active.turnId))
                .take(64)
        ).find((row) => row.role === "user"),
    );
    assert(message);
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: active.missionId,
            expectedGeneration: 1,
            cause: "lost-ack",
            input: {
                kind: "adjust_framing",
                messageId: message._id,
                expectedRevision: 1,
                content: { scope: "Payments workflow", questions: [] },
            },
        },
    );
    expect(
        await f.t.action(internal.execution.operations.dispatch, {
            requestId,
            expectedGeneration: 1,
        }),
    ).toMatchObject({ kind: "success" });
    expect(
        await f.client.query(api.framing.get, { runId: f.runId }),
    ).toMatchObject({ revision: 2, content: { scope: "Payments workflow" } });
    expect(
        await f.t.action(internal.execution.operations.dispatch, {
            requestId,
            expectedGeneration: 1,
        }),
    ).toMatchObject({ kind: "success" });
    expect(
        await f.client.query(api.framing.get, { runId: f.runId }),
    ).toMatchObject({ revision: 2 });
    const request = await f.t.run((ctx) => ctx.db.get(requestId));
    expect(request).toMatchObject({
        status: "completed",
        effect: { outcome: { kind: "success" } },
    });
});

test("an unconfirmed durable action is unknown immediately and is never blindly retried", async () => {
    const { t, args, sourceId } = await seedInspectedEvidence();
    const missionId = await t.mutation(internal.execution.missions.start, {
        runId: args.runId,
        corpusRevisionId: args.corpusRevisionId,
        definitionId: "saved_material_inspection_v1",
        requestKey: "uncertain",
        expectedGeneration: 4,
    });
    const operation = getAgentDefinition("saved_material_inspection_v1")
        .operations.read_in_context;
    assert(operation?.effectKind === "durable_effect" && operation.execute);
    const original = { ...operation };
    vi.spyOn(operation, "execute").mockImplementation((ctx, input) =>
        original.execute(
            {
                ...ctx,
                runAction: async () => {
                    throw new Error("transport outcome unknown");
                },
            },
            input,
        ),
    );
    const requestId = await t.mutation(internal.execution.operations.enqueue, {
        missionId,
        expectedGeneration: 4,
        cause: "uncertain",
        input: { kind: "read_in_context", sourceId, passageOrder: 0 },
    });
    expect(
        await t.action(internal.execution.operations.dispatch, {
            requestId,
            expectedGeneration: 4,
        }),
    ).toEqual({ kind: "unavailable", code: "operation_outcome_unknown" });
    expect(await t.run((ctx) => ctx.db.get(requestId))).toMatchObject({
        status: "unknown",
    });
    expect(await t.run((ctx) => ctx.db.get(missionId))).toMatchObject({
        status: "blocked",
        blockCode: "operation_outcome_unknown",
        progressKeys: [],
    });
    expect(
        await t.action(internal.execution.operations.dispatch, {
            requestId,
            expectedGeneration: 4,
        }),
    ).toMatchObject({ code: "operation_outcome_unknown" });
});

test("authority lost during a read refuses adoption and preserves a recorded observation", async () => {
    const f = await seedHistoryMission();
    const operation = commonOperations.consult_run_state;
    const original = { ...operation };
    vi.spyOn(operation, "execute").mockImplementation(async (ctx, args) => {
        await f.t.run((dbCtx) =>
            dbCtx.db.patch(f.turnId, { status: "cancelled" }),
        );
        return original.execute(ctx, args);
    });
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: f.missionId,
            expectedGeneration: 1,
            cause: "lost-authority",
            input: { kind: "consult_run_state" },
        },
    );
    expect(
        await f.t.action(internal.execution.operations.dispatch, {
            requestId,
            expectedGeneration: 1,
        }),
    ).toMatchObject({ kind: "refused", code: "active_turn_required" });
    const request = await f.t.run((ctx) => ctx.db.get(requestId));
    expect(request?.outcome).toMatchObject({
        kind: "refused",
        code: "active_turn_required",
    });
    expect(request?.adoptedAt).toBeUndefined();
    expect(await f.t.run((ctx) => ctx.db.get(f.missionId))).toMatchObject({
        progressKeys: [],
    });
});

test("expiry still recovers an unacknowledged settlement and retains a late observation without adoption", async () => {
    const f = await seedHistoryMission();
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: f.missionId,
            expectedGeneration: 1,
            cause: "crash-before-settlement",
            input: { kind: "consult_run_state" },
        },
    );
    expect(
        await f.t.mutation(internal.execution.operations.claim, {
            requestId,
            expectedGeneration: 1,
        }),
    ).toMatchObject({ kind: "execute" });
    await f.t.run((ctx) =>
        ctx.db.patch(f.missionId, { deadlineAt: Date.now() - 1 }),
    );
    await f.t.mutation(internal.execution.operations.expire, {
        requestId,
        expectedGeneration: 1,
    });
    expect(await f.t.run((ctx) => ctx.db.get(requestId))).toMatchObject({
        status: "unknown",
    });
    const args = {
        requestId,
        expectedGeneration: 1,
        outcome: { kind: "success" as const, valueJson: "{}" },
    };
    expect(
        await f.t.mutation(internal.execution.operations.recordResult, args),
    ).toMatchObject({ kind: "refused", code: "execution_deadline" });
    expect(
        await f.t.mutation(internal.execution.operations.recordResult, args),
    ).toMatchObject({ kind: "refused", code: "execution_deadline" });
    const request = await f.t.run((ctx) => ctx.db.get(requestId));
    expect(request?.outcome).toEqual(args.outcome);
    expect(request?.adoptedAt).toBeUndefined();
    expect(await f.t.run((ctx) => ctx.db.get(f.missionId))).toMatchObject({
        status: "blocked",
        blockCode: "operation_outcome_unknown",
        progressKeys: [],
    });
});

test("unknown effect diagnostics never claim non-execution or authorize repetition", () => {
    const reply = modelOperationOutcome(getAgentDefinition("workbench_v1"), {
        kind: "unavailable",
        code: "operation_outcome_unknown",
    });
    expect(reply).toContain("unconfirmed");
    expect(reply).toContain("Do not repeat");
    expect(reply).not.toContain("not performed");
});

test("a missing atomic receipt forbids repeating a known callback success", () => {
    const reply = modelOperationOutcome(getAgentDefinition("workbench_v1"), {
        kind: "refused",
        code: "operation_effect_receipt_missing",
    });
    expect(reply).toContain("observed result was retained");
    expect(reply).toContain("Do not repeat");
    expect(reply).not.toContain("not performed");
});

test("expiry retains a confirmed effect after a crash instead of labelling its outcome unknown", async () => {
    const f = await seedWorkbench(true);
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
    const message = await f.t.run(async (ctx) =>
        (
            await ctx.db
                .query("agentMessageDeliveries")
                .withIndex("by_turn", (q) => q.eq("turnId", active.turnId))
                .take(64)
        ).find((row) => row.role === "user"),
    );
    assert(message);
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: active.missionId,
            expectedGeneration: 1,
            cause: "effect-before-crash",
            input: {
                kind: "adjust_framing",
                messageId: message._id,
                expectedRevision: 1,
                content: { scope: "Retained payments framing", questions: [] },
            },
        },
    );
    await f.t.mutation(internal.execution.operations.claim, {
        requestId,
        expectedGeneration: 1,
    });
    await f.t.mutation(internal.framing.applyFromWorkbench, {
        requestId,
        expectedGeneration: 1,
    });
    await f.t.run((ctx) =>
        ctx.db.patch(active.missionId, { deadlineAt: Date.now() - 1 }),
    );
    await f.t.mutation(internal.execution.operations.expire, {
        requestId,
        expectedGeneration: 1,
    });
    const request = await f.t.run((ctx) => ctx.db.get(requestId));
    expect(request?.status).toBe("observed");
    expect(request?.outcome).toEqual(request?.effect?.outcome);
    expect(request?.outcome).toMatchObject({ kind: "success" });
    expect(request?.adoptedAt).toBeUndefined();
    expect(await f.t.run((ctx) => ctx.db.get(active.missionId))).toMatchObject({
        status: "blocked",
        blockCode: "execution_deadline",
        progressKeys: [],
    });
    expect(
        await f.client.query(api.framing.get, { runId: f.runId }),
    ).toMatchObject({
        revision: 2,
        content: { scope: "Retained payments framing" },
    });
});

test("native dispatch persists exact retained reading once and continuation receives the result", async () => {
    const { t, args, sourceId, captureId, text } =
        await seedInspectedEvidence();
    vi.stubGlobal(
        "fetch",
        vi.fn(() => {
            throw new Error("Unexpected external I/O");
        }),
    );
    const missionId = await t.mutation(internal.execution.missions.start, {
        runId: args.runId,
        corpusRevisionId: args.corpusRevisionId,
        definitionId: "saved_material_inspection_v1",
        requestKey: "native-read",
        expectedGeneration: 4,
    });
    const request = {
        missionId,
        expectedGeneration: 4,
        cause: "native-inspection",
        input: { kind: "read_in_context" as const, sourceId, passageOrder: 0 },
    };
    const requestId = await t.mutation(
        internal.execution.operations.enqueue,
        request,
    );
    expect(await t.run((ctx) => ctx.db.get(requestId))).toMatchObject({
        status: "pending",
        actor: "system",
    });
    const outcome = await t.action(internal.execution.operations.dispatch, {
        requestId,
        expectedGeneration: 4,
    });
    expect(outcome.kind).toBe("success");
    if (outcome.kind !== "success")
        throw new Error("Expected retained reading");
    expect(outcome).toMatchObject({ captureId });
    expect(outcome.valueJson).toContain(
        "ServiceNow provides workflow software through its platform.",
    );
    expect(
        await t.mutation(internal.execution.operations.enqueue, request),
    ).toBe(requestId);
    expect(
        await t.action(internal.execution.operations.dispatch, {
            requestId,
            expectedGeneration: 4,
        }),
    ).toEqual(outcome);
    const next = await t.mutation(internal.execution.invocations.begin, {
        missionId,
        expectedGeneration: 4,
        taskKey: "after-reading",
        provenance: "simulation",
    });
    if (next.kind !== "ready") throw new Error("Expected continuation");
    const observed = JSON.parse(next.inputJson).triggeringRequestsAndResults;
    expect(observed).toEqual([
        expect.objectContaining({
            requestId,
            outcome: { kind: "success", captureId },
            historyReference: expect.any(String),
        }),
    ]);
    const { projectMissionHistoryEvent } = await import(
        "@convex/execution/journal"
    );
    const retained = await t.run(async (ctx) => {
        const id = ctx.db.normalizeId(
            "agentExecutionEvents",
            observed[0].historyReference,
        );
        const event = id ? await ctx.db.get(id) : null;
        if (!event) throw new Error("Retained reading observation required");
        return projectMissionHistoryEvent(ctx, event);
    });
    expect(JSON.parse(retained.json).observation.value.outcome).toEqual(
        outcome,
    );
    expect(await t.run((ctx) => ctx.db.get(missionId))).toMatchObject({
        state: {
            kind: "saved_material_inspection_v1",
            inspectedCaptureIds: [captureId],
        },
        obligations: [],
    });
    expect(text).toContain("ServiceNow provides");
});

test("a source refusal after admission is retained and prevents cached result reuse or completion", async () => {
    const { t, args, sourceId, captureId } = await seedInspectedEvidence();
    const missionId = await t.mutation(internal.execution.missions.start, {
        runId: args.runId,
        corpusRevisionId: args.corpusRevisionId,
        definitionId: "saved_material_inspection_v1",
        requestKey: "revoked-read",
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
    await t.run(async (ctx) => {
        const decision = await ctx.db
            .query("sourceReviewItems")
            .withIndex("by_revision_and_source", (q) =>
                q
                    .eq("corpusRevisionId", args.corpusRevisionId)
                    .eq("sourceId", sourceId),
            )
            .unique();
        if (!decision) throw new Error("Missing decision");
        await ctx.db.patch(decision._id, { decision: "rejected" });
        await ctx.db.patch(decision.latestDecisionId, { decision: "rejected" });
    });
    expect(
        await t.action(internal.execution.operations.dispatch, {
            requestId,
            expectedGeneration: 4,
        }),
    ).toMatchObject({ kind: "refused", code: "source_not_approved" });
    const invocation = await t.mutation(internal.execution.invocations.begin, {
        missionId,
        expectedGeneration: 4,
        taskKey: "complete-revoked",
        provenance: "simulation",
    });
    if (invocation.kind !== "ready") throw new Error("Expected invocation");
    expect(
        await t.mutation(internal.execution.invocations.finish, {
            invocationId: invocation.invocationId,
            expectedGeneration: 4,
            response: { kind: "complete", captureIds: [captureId] },
        }),
    ).toMatchObject({ kind: "blocked", code: "source_not_approved" });
});

test("every mixed batch request has a persisted outcome and later dispatch rechecks generation", async () => {
    const { t, args, sourceId } = await seedInspectedEvidence();
    const missionId = await t.mutation(internal.execution.missions.start, {
        runId: args.runId,
        corpusRevisionId: args.corpusRevisionId,
        definitionId: "saved_material_inspection_v1",
        requestKey: "mixed-batch",
        expectedGeneration: 4,
    });
    const invocation = await t.mutation(internal.execution.invocations.begin, {
        missionId,
        expectedGeneration: 4,
        taskKey: "batch",
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
                    callId: "read",
                    name: "read_in_context",
                    inputJson: JSON.stringify({ sourceId, passageOrder: 0 }),
                },
                {
                    callId: "shadowed-discriminator",
                    name: "read_in_context",
                    inputJson: JSON.stringify({
                        kind: "consult_mission_state",
                        sourceId,
                        passageOrder: 0,
                    }),
                },
                {
                    callId: "consult",
                    name: "consult_mission_state",
                    inputJson: "{}",
                },
            ],
        },
    });
    const [readId, invalidId, consultId] = result.requestIds;
    if (!readId || !invalidId || !consultId)
        throw new Error("Expected all persisted batch requests");
    expect(await t.run((ctx) => ctx.db.get(invalidId))).toMatchObject({
        status: "completed",
        outcome: { kind: "refused", code: "invalid_operation_input" },
    });
    expect(
        await t.action(internal.execution.operations.dispatch, {
            requestId: readId,
            expectedGeneration: 4,
        }),
    ).toMatchObject({ kind: "success" });
    await t.run((ctx) => ctx.db.patch(args.runId, { executionGeneration: 5 }));
    expect(
        await t.action(internal.execution.operations.dispatch, {
            requestId: consultId,
            expectedGeneration: 4,
        }),
    ).toMatchObject({ kind: "refused", code: "stale_execution" });
    expect(await t.run((ctx) => ctx.db.get(readId))).toMatchObject({
        status: "completed",
        outcome: { kind: "success" },
    });
    expect(await t.run((ctx) => ctx.db.get(consultId))).toMatchObject({
        status: "completed",
        outcome: { kind: "refused", code: "stale_execution" },
    });
});

test("an adoption incident never claims its retained operation was not performed", () => {
    const reply = modelOperationOutcome(getAgentDefinition("workbench_v1"), {
        kind: "refused",
        code: "operation_adoption_failed",
    });
    expect(reply).toContain("retained");
    expect(reply).toContain("Do not repeat");
    expect(reply).not.toContain("not performed");
});

test.each(
    registeredAgentDefinitions().map((definition) => ({
        name: `${definition.id}@${definition.version}`,
        definition,
    })),
)("$name does not turn an authority refusal into an assertion of non-execution", ({
    definition,
}) => {
    const diagnostic = modelOperationOutcome(definition, {
        kind: "refused",
        code: "stale_execution",
    });
    expect(diagnostic).not.toContain("not performed");
    expect(diagnostic).toContain("recorded state");
    expect(JSON.parse(diagnostic)).toMatchObject({
        kind: "refused",
        code: "stale_execution",
    });
});
