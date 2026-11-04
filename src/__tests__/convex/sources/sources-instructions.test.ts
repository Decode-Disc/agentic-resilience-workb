import { api, internal } from "@convex/_generated/api";
import { afterEach, expect, test, vi } from "vitest";
import { seedCapturedSources } from "@/__tests__/setup/sources-mission";

afterEach(() => vi.useRealTimers());

async function seedInstruction() {
    const f = await seedCapturedSources();
    const frameId = await f.t.run(async (ctx) => {
        const frameId = await ctx.db.insert("framingRevisions", {
            runId: f.runId,
            revision: 1,
            content: { scope: "Studied workflow", questions: [] },
            requestKey: "fixed",
            contentHash: "fixture",
            origin: "analyst",
            createdAt: 1,
        });
        await ctx.db.patch(f.runId, {
            agentExecutionVersion: 3,
            startMode: "framed",
            fixedFramingRevisionId: frameId,
            currentFramingRevisionId: frameId,
        });
        return frameId;
    });
    const analyst = f.t.withIdentity({ subject: f.userId });
    const messageId = await analyst.mutation(
        api.execution.conversations.submit,
        {
            runId: f.runId,
            requestKey: "documentary-request",
            text: "Please inspect the linked interoperability guide",
            delivery: "queue",
        },
    );
    const instructionId = await f.t.run(async (ctx) => {
        const requestId = await ctx.db.insert("agentOperationRequests", {
            runId: f.runId,
            actor: "agent",
            cause: "fixture",
            input: {
                kind: "transmit_source_request",
                messageId,
                interpretedNeed: "Inspect interoperability guide",
                coverageRole: null,
            },
            operationVersion: 1,
            expectedGeneration: 4,
            logicalKey: "instruction",
            status: "completed",
            createdAt: 1,
        });
        return ctx.db.insert("workbenchInstructions", {
            runId: f.runId,
            requestId,
            messageId,
            interpretedNeed: "Inspect interoperability guide",
            framingRevisionId: frameId,
            status: "waiting",
            outcome: "Waiting",
            createdAt: 1,
        });
    });
    return { ...f, analyst, instructionId };
}

test("paused instructions join the same Sources preparation after Resume without renewing allowances", async () => {
    vi.useFakeTimers();
    const f = await seedInstruction();
    const { analyst, instructionId } = f;
    await analyst.mutation(api.execution.researchControl.pause, {
        runId: f.runId,
        expectedGeneration: 4,
    });
    const paused = await f.t.mutation(
        internal.execution.researchControl.checkpoint,
        { runId: f.runId, preparationId: f.preparationId },
    );
    await f.t.mutation(internal.workbench.processInstructions, {
        runId: f.runId,
    });
    expect(await f.t.run((ctx) => ctx.db.get(instructionId))).toMatchObject({
        status: "waiting",
    });
    const generation = await analyst.mutation(
        api.execution.researchControl.resume,
        { runId: f.runId, expectedGeneration: paused.generation },
    );
    expect(await f.t.run((ctx) => ctx.db.get(f.preparationId))).toMatchObject({
        executionGeneration: generation,
    });
    await f.t.mutation(internal.workbench.processInstructions, {
        runId: f.runId,
    });
    expect(await f.t.run((ctx) => ctx.db.get(instructionId))).toMatchObject({
        status: "transmitted",
        preparationId: f.preparationId,
        needId: `instruction:${instructionId}`,
    });
    const preparation = await f.t.run((ctx) => ctx.db.get(f.preparationId));
    expect(preparation?.sourcesMission).toMatchObject({
        needsRevision: 2,
        searches: 0,
        controls: 0,
        acquisitions: 0,
    });
    expect(preparation?.sourcesMission?.needs).toHaveLength(2);
});

test.each([
    true,
    false,
])("an instruction admitted during final generation refreshes Sources before completion (delivery already ran: %s)", async (delivered) => {
    vi.useFakeTimers();
    const f = await seedInstruction();
    const begun = await f.t.mutation(internal.execution.invocations.begin, {
        missionId: f.missionId,
        expectedGeneration: 4,
        taskKey: "before-new-need",
        provenance: "simulation",
    });
    expect(begun.kind).toBe("ready");
    if (begun.kind !== "ready") throw new Error(begun.code);
    if (delivered)
        await f.t.mutation(internal.workbench.processInstructions, {
            runId: f.runId,
        });
    expect(
        await f.t.mutation(internal.execution.invocations.finish, {
            invocationId: begun.invocationId,
            expectedGeneration: 4,
            response: {
                kind: "complete",
                needsRevision: 1,
                needs: [
                    {
                        needId: "common-context",
                        unfinished: ["Independent work remains."],
                        workRequestIds: [],
                    },
                ],
            },
        }),
    ).toMatchObject({ kind: "blocked", code: "mission_context_changed" });
    expect(await f.t.run((ctx) => ctx.db.get(f.missionId))).toMatchObject({
        status: "running",
    });
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.preparationId)))?.sourcesMission
            ?.result,
    ).toBeUndefined();
    const next = await f.t.mutation(internal.execution.invocations.begin, {
        missionId: f.missionId,
        expectedGeneration: 4,
        taskKey: "with-new-need",
        provenance: "simulation",
    });
    expect(next.kind).toBe("ready");
    if (next.kind !== "ready") throw new Error(next.code);
    expect(JSON.parse(next.inputJson).activeWork).toMatchObject({
        needsRevision: 2,
        needs: expect.arrayContaining([
            {
                id: `instruction:${f.instructionId}`,
                version: 1,
                information: "Inspect interoperability guide",
                questionIds: [],
                commonContext: false,
            },
        ]),
    });
});
