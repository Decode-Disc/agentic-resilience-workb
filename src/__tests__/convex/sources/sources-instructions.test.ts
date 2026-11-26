import { api, internal } from "@convex/_generated/api";
import { sha256Hex } from "@convex/domain/sourcePassages";
import { completeSources } from "@convex/domain/sources";
import { readWorkbenchFacts } from "@convex/domain/workbenchContext";
import { getAgentDefinition } from "@convex/execution/agentCatalog";
import { WORKBENCH_MODEL_ROUTE } from "@convex/integrations/modelRouting";
import { afterEach, assert, expect, test, vi } from "vitest";
import { installModel } from "@/__tests__/setup/model-configuration";
import { seedCapturedSources } from "@/__tests__/setup/sources-mission";
import { workbenchAdmissionInput } from "@/__tests__/setup/workbench";

afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllEnvs();
});

async function seedInstruction(
    f: Awaited<ReturnType<typeof seedCapturedSources>>,
) {
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

test("closed instruction treatment reaches Workbench and its review without reopening preparation", async () => {
    vi.useFakeTimers();
    vi.stubEnv("WORKBENCH_AGENT_ENABLED", "true");
    const source = await seedCapturedSources();
    await source.t.run(async (ctx) => {
        const preparation = await ctx.db.get(source.preparationId);
        assert(preparation?.sourcesMission);
        const data = preparation.sourcesMission;
        await completeSources(ctx, preparation._id, {
            kind: "complete",
            needsRevision: data.needsRevision,
            needs: data.needs.map((need) => ({
                needId: need.id,
                workRequestIds: [],
                unfinished: ["Documentary work remains."],
            })),
        });
        await ctx.db.patch(source.runId, {
            lifecycleState: "sources_prepared",
            executionStatus: "idle",
        });
    });
    const f = await seedInstruction(source);
    const { admin } = await installModel(f.t, WORKBENCH_MODEL_ROUTE);
    const settings = await admin.query(api.modelConfiguration.list, {});
    await admin.mutation(api.modelConfiguration.setResponseControl, {
        expectedRevision: settings.responseControl.revision,
        enabled: true,
        model: settings.responseControl.model,
        contradictionThreshold: settings.responseControl.contradictionThreshold,
        supportThreshold: settings.responseControl.supportThreshold,
    });
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
    const projected = await f.t.run(async (ctx) => {
        const run = await ctx.db.get(f.runId);
        assert(run);
        return getAgentDefinition("workbench_v1").context(ctx, mission, run);
    });
    assert(projected.kind === "ready");
    expect(projected.context.documentaryPreparation).toMatchObject({
        instructionTreatment: {
            status: "closed",
            description: expect.stringContaining(
                "not accepting additional documentary requests",
            ),
        },
    });
    const invocation = await f.t.mutation(
        internal.execution.invocations.begin,
        {
            missionId: mission._id,
            expectedGeneration: mission.generation,
            taskKey: "closed-instruction-review",
            provenance: "live",
            nativeInput: await workbenchAdmissionInput(
                f.t,
                mission._id,
                mission.generation,
            ),
        },
    );
    assert(invocation.kind === "ready");
    const row = await f.t.run((ctx) => ctx.db.get(invocation.invocationId));
    assert(row);
    const receipt = {
        missionId: mission._id,
        invocationId: row._id,
        runId: f.runId,
        executionGeneration: mission.generation,
        workflowVersion: mission.definitionVersion,
        corpusRevisionId: row.corpusRevisionId,
        service: "model" as const,
        operation: "agent_reasoning",
        stepKey: "agent_reasoning",
        operationKey: `mission:${mission._id}:invocation:${row._id}:attempt:1`,
        attempt: 1,
        inputHash: sha256Hex(row.inputJson),
    };
    await f.t.mutation(internal.providerCalls.recordAttempt, {
        ...receipt,
        status: "started",
    });
    await f.t.mutation(internal.providerCalls.recordAttempt, {
        ...receipt,
        status: "succeeded",
        dispatchOutcome: "response_received",
        reportedCost: 0,
    });
    expect(
        await f.t.mutation(internal.execution.invocations.finish, {
            invocationId: invocation.invocationId,
            expectedGeneration: mission.generation,
            response: {
                kind: "complete",
                text: "Registering another instruction does not reopen the ended preparation.",
            },
        }),
    ).toMatchObject({ kind: "blocked", code: "pending_operations" });
    const review = await f.t.run(async (ctx) => {
        const current = await ctx.db.get(mission._id);
        assert(current?.conversationTurnId);
        return (await ctx.db.get(current.conversationTurnId))?.responseControl
            ?.checks[0];
    });
    assert(review?.requestJson);
    const facts = JSON.parse(review.requestJson).state.authoritative_facts;
    expect(facts.documentaryPreparation).toEqual(
        projected.context.documentaryPreparation,
    );
    await f.t.mutation(internal.workbench.processInstructions, {
        runId: f.runId,
    });
    expect(await f.t.run((ctx) => ctx.db.get(f.instructionId))).toMatchObject({
        status: "limited",
        outcome: facts.documentaryPreparation.instructionTreatment.description,
    });
    expect(await f.t.run((ctx) => ctx.db.get(f.runId))).toMatchObject({
        lifecycleState: "sources_prepared",
        executionStatus: "idle",
    });
    expect(
        (await f.t.run((ctx) => ctx.db.query("providerCalls").collect())).map(
            (call) => call.operation,
        ),
    ).toEqual(["agent_reasoning"]);
});

test("paused instructions join the same Sources preparation after Resume without renewing allowances", async () => {
    vi.useFakeTimers();
    const f = await seedInstruction(await seedCapturedSources());
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
    "open",
    "at_capacity",
] as const)("projected instruction treatment %s agrees with real delivery", async (status) => {
    vi.useFakeTimers();
    const f = await seedInstruction(await seedCapturedSources());
    if (status === "at_capacity")
        await f.t.run(async (ctx) => {
            const preparation = await ctx.db.get(f.preparationId);
            assert(preparation?.sourcesMission);
            const data = preparation.sourcesMission;
            await ctx.db.patch(preparation._id, {
                sourcesMission: {
                    ...data,
                    needs: [
                        ...data.needs,
                        ...Array.from(
                            {
                                length:
                                    data.envelope.maxNeeds - data.needs.length,
                            },
                            (_, i) => ({
                                id: `instruction:prior-${i}`,
                                version: 1,
                                information: `Previously admitted documentary need ${i}.`,
                                questionIds: [],
                                commonContext: false,
                            }),
                        ),
                    ],
                },
            });
        });
    const projected = await f.t.run(async (ctx) => {
        const run = await ctx.db.get(f.runId);
        assert(run);
        return readWorkbenchFacts(ctx, run);
    });
    assert(projected.kind === "ready");
    expect(projected.context.documentaryPreparation).toMatchObject({
        instructionTreatment: { status },
    });
    await f.t.mutation(internal.workbench.processInstructions, {
        runId: f.runId,
    });
    const instruction = await f.t.run((ctx) => ctx.db.get(f.instructionId));
    expect(instruction?.status).toBe(
        status === "open" ? "transmitted" : "limited",
    );
    if (status === "at_capacity")
        expect(projected.context.documentaryPreparation).toMatchObject({
            instructionTreatment: { description: instruction?.outcome },
        });
});

test.each([
    true,
    false,
])("an instruction admitted during final generation refreshes Sources before completion (delivery already ran: %s)", async (delivered) => {
    vi.useFakeTimers();
    const f = await seedInstruction(await seedCapturedSources());
    const begun = await f.t.mutation(internal.execution.invocations.begin, {
        missionId: f.missionId,
        expectedGeneration: 4,
        taskKey: "before-new-need",
        provenance: "simulation",
    });
    expect(begun.kind).toBe("ready");
    if (begun.kind !== "ready") throw new Error(JSON.stringify(begun));
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

                needs: [
                    {
                        needId: "common-context",
                        unfinished: ["Independent work remains."],
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
    if (next.kind !== "ready") throw new Error(JSON.stringify(next));
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

test("generation and review share compact documentary instructions with the actual analyst text", async () => {
    const f = await seedInstruction(await seedCapturedSources());
    await f.t.mutation(internal.workbench.processInstructions, {
        runId: f.runId,
    });
    const context = await f.t.query(internal.execution.context.build, {
        missionId: f.missionId,
        expectedGeneration: 4,
    });
    assert(context.kind === "ready");
    const requests = JSON.parse(context.inputJson).domain.documentaryRequests;
    expect(requests[0]).toMatchObject({
        instructionId: f.instructionId,
        originalText: "Please inspect the linked interoperability guide",
        interpretedNeed: "Inspect interoperability guide",
    });
    expect(requests[0]).not.toHaveProperty("originalMessage");
    expect(requests[0]).not.toHaveProperty("_creationTime");
    const facts = await f.t.run(async (ctx) => {
        const run = await ctx.db.get(f.runId);
        const mission = await ctx.db.get(f.missionId);
        assert(run && mission);
        return readWorkbenchFacts(ctx, run, mission);
    });
    assert(facts.kind === "ready");
    expect(facts.context.analystRequests).toEqual(requests);
});
