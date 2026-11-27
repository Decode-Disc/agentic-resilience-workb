import { api, internal } from "@convex/_generated/api";
import { readPreparationLimits } from "@convex/domain/sourcePreparationAuthority";
import { RESOURCE_POLICY_VERSION } from "@convex/resourcePolicy";
import { afterEach, assert, expect, test, vi } from "vitest";
import { seedInspectedEvidence } from "@/__tests__/setup/source-preparation";
import { seedWorkbench } from "@/__tests__/setup/workbench";

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
});

test("confirmation and the first turn use the named current Workbench binding", async () => {
    const { t, client, runId } = await seedWorkbench(
        false,
        undefined,
        undefined,
        undefined,
        undefined,
        null,
    );
    const conversation = await t.run((ctx) =>
        ctx.db
            .query("agentConversations")
            .withIndex("by_run", (q) => q.eq("runId", runId))
            .unique(),
    );
    expect(conversation).toMatchObject({
        definitionId: "workbench_v1",
        definitionVersion: 13,
    });
    await client.mutation(api.execution.conversations.submit, {
        runId,
        requestKey: "current-binding",
        delivery: "queue",
        text: "Scope the research question.",
    });
    const turnId = await t.mutation(
        internal.execution.conversations.claimTurn,
        { runId },
    );
    assert(turnId);
    const missionId = await t.mutation(internal.execution.missions.start, {
        runId,
        requestKey: "current-binding",
        expectedGeneration: 1,
        conversationTurnId: turnId,
        definitionId: "workbench_v1",
        scope: { kind: "workbench_v1" },
    });
    expect(await t.run((ctx) => ctx.db.get(missionId))).toMatchObject({
        definitionId: "workbench_v1",
        definitionVersion: 13,
        objectiveKey: `workbench:${turnId}`,
    });
});

test.each([
    "request",
    "objective",
] as const)("%s replay returns the completed mission with its retained pin", async (replay) => {
    const { t, args, visitorId } = await seedInspectedEvidence();
    const input = {
        runId: args.runId,
        corpusRevisionId: args.corpusRevisionId,
        definitionId: "saved_material_inspection_v1" as const,
        requestKey: "inspect-material",
        expectedGeneration: args.executionGeneration,
    };
    const missionId = await t.run((ctx) =>
        ctx.db.insert("agentMissions", {
            runId: args.runId,
            ownerVisitorId: visitorId,
            definitionId: input.definitionId,
            definitionVersion: 3,
            protocolVersion: 3,
            executionScope: "research",
            executionRuntime: "pi-durable",
            generationBackend: { id: "pi-durable", version: 1 },
            resourcePolicy: RESOURCE_POLICY_VERSION,
            scope: {
                kind: input.definitionId,
                corpusRevisionId: args.corpusRevisionId,
            },
            state: { kind: input.definitionId, inspectedCaptureIds: [] },
            requestKey: input.requestKey,
            objectiveKey: `saved-material:${args.corpusRevisionId}`,
            generation: args.executionGeneration,
            status: "completed",
            deadlineAt: Date.now() - 1,
            modelLimits: readPreparationLimits(undefined),
            noProgressTurns: 0,
            progressKeys: [],
            workingNotes: "",
            obligations: [],
            nextEventSequence: 1,
            createdAt: Date.now(),
            updatedAt: Date.now(),
        }),
    );
    const snapshot = () =>
        t.run(async (ctx) => ({
            missions: await ctx.db.query("agentMissions").collect(),
            events: await ctx.db.query("agentExecutionEvents").collect(),
            run: await ctx.db.get(args.runId),
            calls: await ctx.db.query("providerCalls").collect(),
            scheduled: await ctx.db.system
                .query("_scheduled_functions")
                .collect(),
        }));
    const before = await snapshot();
    expect(before.missions).toEqual([
        expect.objectContaining({
            _id: missionId,
            definitionVersion: 3,
            status: "completed",
        }),
    ]);
    const requestKey =
        replay === "request" ? input.requestKey : "reuse-material";
    await expect(
        t.mutation(internal.execution.missions.start, { ...input, requestKey }),
    ).resolves.toBe(missionId);
    expect(await snapshot()).toEqual(before);
});

test.each([
    {
        defect: "missing",
        definitionId: "workbench_v1",
        definitionVersion: undefined,
    },
    {
        defect: "mismatched",
        definitionId: "conversation_validation_v1",
        definitionVersion: 3,
    },
    { defect: "unknown", definitionId: "workbench_v1", definitionVersion: 999 },
] as const)("a $defect Workbench pin refuses both direct and queued turn admission", async (pin) => {
    const { t, client, runId } = await seedWorkbench();
    const messageId = await client.mutation(
        api.execution.conversations.submit,
        {
            runId,
            requestKey: "keep-queued",
            delivery: "queue",
            text: "Preserve the analyst's question.",
        },
    );
    const { conversationId, queuedCount, firstMessageId } = await t.run(
        async (ctx) => {
            const conversation = await ctx.db
                .query("agentConversations")
                .withIndex("by_run", (q) => q.eq("runId", runId))
                .unique();
            assert(conversation);
            await ctx.db.patch(conversation._id, {
                definitionId: pin.definitionId,
                definitionVersion: pin.definitionVersion,
            });
            const first = await ctx.db
                .query("agentMessageDeliveries")
                .withIndex("by_run_and_status", (q) =>
                    q.eq("runId", runId).eq("status", "queued"),
                )
                .first();
            assert(first);
            return {
                conversationId: conversation._id,
                queuedCount: conversation.queuedCount,
                firstMessageId: first._id,
            };
        },
    );
    await expect(
        t.mutation(internal.execution.conversations.startTurn, {
            runId,
            definitionId: "workbench_v1",
            scope: { kind: "workbench_v1" },
            simulation: false,
        }),
    ).rejects.toThrow("definition_version_conflict");
    await t.mutation(internal.execution.conversations.pumpWorkbench, { runId });
    const state = await t.run(async (ctx) => ({
        conversation: await ctx.db.get(conversationId),
        message: await ctx.db.get(messageId),
        turns: await ctx.db.query("agentConversationTurns").collect(),
        missions: await ctx.db.query("agentMissions").collect(),
        receipts: await ctx.db.query("providerCalls").collect(),
    }));
    expect(state).toMatchObject({
        conversation: {
            queuedCount,
            queuePaused: true,
            admissionFailure: {
                code: "definition_version_conflict",
                messageId: firstMessageId,
            },
        },
        message: { status: "queued" },
        turns: [],
        missions: [],
        receipts: [],
    });
});
