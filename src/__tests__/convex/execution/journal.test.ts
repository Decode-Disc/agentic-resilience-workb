import { internal } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { sha256Hex } from "@convex/domain/sourcePassages";
import { makeFunctionReference } from "convex/server";
import { expect, test } from "vitest";
import {
    seedInspectedEvidence,
    seedSourcePreparation,
} from "@/__tests__/setup/source-preparation";

test("new invocations identify their journal version without expanding continuation context", async () => {
    const { t, args } = await seedInspectedEvidence();
    const missionId = await t.mutation(internal.execution.missions.start, {
        runId: args.runId,
        corpusRevisionId: args.corpusRevisionId,
        expectedGeneration: 4,
        definitionId: "saved_material_inspection_v1",
        requestKey: "journal-version",
    });
    const begun = await t.mutation(internal.execution.invocations.begin, {
        missionId,
        expectedGeneration: 4,
        taskKey: "first",
        provenance: "simulation",
    });
    if (begun.kind !== "ready") throw new Error("Expected invocation");
    const invocation = await t.run((ctx) => ctx.db.get(begun.invocationId));
    expect(invocation?.journalVersion).toBe(1);
    expect(begun.inputJson).not.toContain("requestSnapshot");
});

async function oneShotFixture() {
    const fixture = await seedSourcePreparation();
    const { t, runId, corpusRevisionId, sourceId } = fixture;
    await t.mutation(internal.researchPlanning.createForRun, {
        runId,
        expectedExecutionGeneration: 3,
    });
    const preparationId = await t.mutation(
        internal.sourcePreparation.claimForDiscovery,
        { runId, corpusRevisionId, expectedExecutionGeneration: 3 },
    );
    const preparation = await t.run((ctx) => ctx.db.get(preparationId));
    if (!preparation) throw new Error("Expected preparation");
    const inputJson = JSON.stringify({ instructions: "Read.", sourceId });
    const inputHash = sha256Hex(inputJson);
    const attempt = {
        runId,
        corpusRevisionId,
        sourceId,
        preparationId,
        inputHash,
        executionGeneration: 3,
        workflowVersion: preparation.workflowVersion,
        stepKey: "source_preparation",
        service: "model" as const,
        operation: "source_qualification",
        operationKey: `${preparation.operationKey}:step:source_preparation:input:${inputHash}:attempt:1`,
        attempt: 1,
    };
    const receipt = await t.mutation(internal.providerCalls.recordAttempt, {
        ...attempt,
        status: "started",
    });
    const invocationId = await t.mutation(
        internal.execution.invocations.beginOneShot,
        { providerCallId: receipt.providerCallId, inputJson },
    );
    return {
        ...fixture,
        invocationId,
        attempt,
        providerCallId: receipt.providerCallId,
    };
}

test("one-shot settlement commits the original reply, receipt and normalized result atomically", async () => {
    const { t, invocationId, attempt, providerCallId } = await oneShotFixture();
    const observableReplyJson = JSON.stringify({
        version: 1,
        content: [{ type: "text", text: ' { "finding": "original" } ' }],
    });
    await t.mutation(internal.execution.invocations.finishOneShot, {
        invocationId,
        outputJson: '{"finding":"normalized"}',
        observableReplyJson,
        attempt: {
            ...attempt,
            status: "succeeded",
            dispatchOutcome: "response_received",
        },
    });
    expect(await t.run((ctx) => ctx.db.get(providerCallId))).toMatchObject({
        status: "succeeded",
        invocationId,
    });
    expect(await t.run((ctx) => ctx.db.get(invocationId))).toMatchObject({
        status: "returned",
        outputJson: '{"finding":"normalized"}',
    });
    const payload = await t.run((ctx) =>
        ctx.db
            .query("agentInvocationPayloads")
            .withIndex("by_invocation_and_part", (q) =>
                q.eq("invocationId", invocationId).eq("part", "reply"),
            )
            .unique(),
    );
    expect(JSON.parse(payload?.json ?? "null")).toEqual(
        JSON.parse(observableReplyJson),
    );
});

test("one-shot admission is inspectable before a request can be dispatched", async () => {
    const { t, runId, invocationId } = await oneShotFixture();
    const events = await t.run((ctx) =>
        ctx.db
            .query("agentExecutionEvents")
            .withIndex("by_run", (q) => q.eq("runId", runId))
            .collect(),
    );
    expect(events).toContainEqual(
        expect.objectContaining({ kind: "invocation_started", invocationId }),
    );
});

test("an invalid one-shot finalization rolls back its receipt and reply snapshot", async () => {
    const { t, invocationId, attempt, providerCallId } = await oneShotFixture();
    await expect(
        t.mutation(internal.execution.invocations.finishOneShot, {
            invocationId,
            outputJson: "x".repeat(702 * 1024),
            observableReplyJson: JSON.stringify({ version: 1, content: [] }),
            attempt: {
                ...attempt,
                status: "succeeded",
                dispatchOutcome: "response_received",
            },
        }),
    ).rejects.toThrow("response_capacity");
    expect(await t.run((ctx) => ctx.db.get(providerCallId))).toMatchObject({
        status: "started",
    });
    expect(
        await t.run((ctx) => ctx.db.query("agentInvocationPayloads").collect()),
    ).toHaveLength(0);
});

const retainRequest = makeFunctionReference<
    "mutation",
    {
        invocationId: Id<"agentInvocations">;
        expectedGeneration: number;
        requestJson: string;
    },
    { kind: "ready" | "blocked"; code?: string }
>("execution/invocations:retainRequest");

test("prepared requests persist once with immutable content and a dossier event", async () => {
    const { t, args } = await seedInspectedEvidence();
    const missionId = await t.mutation(internal.execution.missions.start, {
        runId: args.runId,
        corpusRevisionId: args.corpusRevisionId,
        expectedGeneration: 4,
        definitionId: "saved_material_inspection_v1",
        requestKey: "immutable-journal",
    });
    const begun = await t.mutation(internal.execution.invocations.begin, {
        missionId,
        expectedGeneration: 4,
        taskKey: "first",
        provenance: "simulation",
    });
    if (begun.kind !== "ready") throw new Error("Expected invocation");
    const input = {
        invocationId: begun.invocationId,
        expectedGeneration: 4,
        requestJson: JSON.stringify({
            version: 1,
            input: { prompt: "Exact input" },
        }),
    };
    expect(await t.mutation(retainRequest, input)).toEqual({ kind: "ready" });
    expect(await t.mutation(retainRequest, input)).toEqual({ kind: "ready" });
    const payloads = await t.run((ctx) =>
        ctx.db.query("agentInvocationPayloads").collect(),
    );
    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toMatchObject({
        part: "request",
        state: "complete",
        invocationId: begun.invocationId,
        runId: args.runId,
    });
    expect(JSON.parse(payloads[0]?.json ?? "null")).toEqual({
        version: 1,
        input: { prompt: "Exact input" },
    });
    await expect(
        t.mutation(retainRequest, {
            ...input,
            requestJson: JSON.stringify({
                version: 1,
                input: { prompt: "Changed input" },
            }),
        }),
    ).rejects.toThrow("journal_payload_conflict");
    expect(
        (
            await t.run((ctx) =>
                ctx.db
                    .query("agentExecutionEvents")
                    .withIndex("by_run", (q) => q.eq("runId", args.runId))
                    .collect(),
            )
        ).filter((event) => event.kind === "invocation_request_recorded"),
    ).toHaveLength(1);
});

test("oversized request snapshots retain an explicit incomplete marker without an excerpt", async () => {
    const { t, invocationId } = await oneShotFixture();
    const result = await t.mutation(
        internal.execution.invocations.retainRequest,
        {
            invocationId,
            expectedGeneration: 3,
            requestJson: JSON.stringify({
                version: 1,
                text: "x".repeat(512 * 1024),
            }),
        },
    );
    expect(result).toEqual({
        kind: "blocked",
        code: "journal_request_capacity",
    });
    const payload = await t.run((ctx) =>
        ctx.db.query("agentInvocationPayloads").unique(),
    );
    expect(payload).toMatchObject({
        state: "incomplete",
        code: "journal_request_capacity",
    });
    expect(payload?.json).toBeUndefined();
    expect(payload?.contentHash).toHaveLength(64);
});

test("an oversized observable reply does not discard the normalized result or pretend an excerpt is complete", async () => {
    const { t, invocationId, attempt } = await oneShotFixture();
    await t.mutation(internal.execution.invocations.finishOneShot, {
        invocationId,
        outputJson: '{"status":"succeeded"}',
        observableReplyJson: JSON.stringify({
            version: 1,
            text: "x".repeat(512 * 1024),
        }),
        attempt: {
            ...attempt,
            status: "succeeded",
            dispatchOutcome: "response_received",
        },
    });
    const payload = await t.run((ctx) =>
        ctx.db.query("agentInvocationPayloads").unique(),
    );
    expect(payload).toMatchObject({
        state: "incomplete",
        code: "journal_reply_capacity",
    });
    expect(payload?.json).toBeUndefined();
    expect(await t.run((ctx) => ctx.db.get(invocationId))).toMatchObject({
        status: "returned",
        outputJson: '{"status":"succeeded"}',
    });
});

test("dispatch authority is checked again after request persistence", async () => {
    const { t, runId, invocationId } = await oneShotFixture();
    await t.mutation(internal.execution.invocations.retainRequest, {
        invocationId,
        expectedGeneration: 3,
        requestJson: '{"version":1,"input":{}}',
    });
    expect(
        await t.query(internal.execution.invocations.authorizeDispatch, {
            invocationId,
            expectedGeneration: 3,
        }),
    ).toBeNull();
    await t.run((ctx) =>
        ctx.db.patch(runId, {
            executionStatus: "cancelled",
            executionGeneration: 4,
        }),
    );
    await expect(
        t.query(internal.execution.invocations.authorizeDispatch, {
            invocationId,
            expectedGeneration: 3,
        }),
    ).rejects.toThrow();
    const payload = await t.run((ctx) =>
        ctx.db.query("agentInvocationPayloads").unique(),
    );
    expect(payload?.state).toBe("complete");
});
