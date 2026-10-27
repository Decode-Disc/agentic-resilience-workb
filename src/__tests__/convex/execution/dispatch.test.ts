import { internal } from "@convex/_generated/api";
import { afterEach, expect, test, vi } from "vitest";
import { seedInspectedEvidence } from "@/__tests__/setup/source-preparation";

afterEach(() => vi.unstubAllGlobals());

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
    expect(outcome.captureId).toBe(captureId);
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
    expect(JSON.parse(next.inputJson).triggeringRequestsAndResults).toEqual([
        expect.objectContaining({ requestId, outcome }),
    ]);
    expect(await t.run((ctx) => ctx.db.get(missionId))).toMatchObject({
        inspectedCaptureIds: [captureId],
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
