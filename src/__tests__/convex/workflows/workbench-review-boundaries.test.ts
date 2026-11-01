import { api, internal } from "@convex/_generated/api";
import agentTest from "@convex-dev/agent/test";
import { afterEach, expect, test, vi } from "vitest";
import workflowTest from "@/__tests__/convex/workflows/workflow-test-register.js";
import { seedSourcePreparation } from "@/__tests__/setup/source-preparation";

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
});

async function framedDiscovery() {
    vi.useFakeTimers();
    const fixture = await seedSourcePreparation();
    const { t, runId, userId } = fixture;
    agentTest.register(t);
    workflowTest.register(t);
    await t.run(async (ctx) => {
        const framingId = await ctx.db.insert("framingRevisions", {
            runId,
            revision: 1,
            content: { scope: "Claims workflow", questions: [] },
            contentHash: "fixture",
            requestKey: "fixed",
            origin: "analyst",
            createdAt: Date.now(),
        });
        await ctx.db.patch(runId, {
            startMode: "framed",
            agentExecutionVersion: 3,
            fixedFramingRevisionId: framingId,
            currentFramingRevisionId: framingId,
        });
    });
    const proposal = await t.mutation(
        internal.sourceSelectionProposals.generateForRun,
        { runId, expectedExecutionGeneration: 3 },
    );
    return {
        ...fixture,
        proposal,
        client: t.withIdentity({ subject: userId }),
    };
}

test("Workbench cannot start documentary preparation while qualification is disabled", async () => {
    vi.stubEnv("SOURCE_QUALIFICATION_ENABLED", "false");
    const network = vi.fn(() => {
        throw new Error("Unexpected external I/O");
    });
    vi.stubGlobal("fetch", network);
    const { t, client, runId, corpusRevisionId } = await framedDiscovery();
    const previousPreparationId = await t.mutation(
        internal.sourcePreparation.claimForDiscovery,
        { runId, corpusRevisionId, expectedExecutionGeneration: 3 },
    );
    await t.run((ctx) =>
        ctx.db.patch(previousPreparationId, {
            status: "complete",
            completedAt: Date.now(),
        }),
    );
    await t.mutation(internal.sourceSelectionProposals.generateForRun, {
        runId,
        expectedExecutionGeneration: 3,
    });
    await t.run((ctx) =>
        ctx.db.patch(runId, {
            lifecycleState: "awaiting_source_review",
            executionStatus: "paused",
            pauseReason: "source_review",
        }),
    );
    const messageId = await client.mutation(
        api.execution.conversations.submit,
        {
            runId,
            requestKey: "commercial-terms",
            text: "Inspect commercial terms",
            delivery: "queue",
        },
    );
    const turn = await t.mutation(internal.execution.conversations.startTurn, {
        runId,
        definitionId: "workbench_v1",
        scope: { kind: "workbench_v1" },
        simulation: false,
    });
    if (!turn) throw new Error("Expected Workbench turn");
    const requestId = await t.mutation(internal.execution.operations.enqueue, {
        missionId: turn.missionId,
        expectedGeneration: 1,
        cause: "analyst_followup",
        input: {
            kind: "transmit_source_request",
            messageId,
            interpretedNeed: "Inspect commercial terms",
            coverageRole: "official_commercial_terms",
        },
    });
    expect(
        await t.action(internal.execution.operations.dispatch, {
            requestId,
            expectedGeneration: 1,
        }),
    ).toMatchObject({ kind: "success" });
    const instruction = await t.run((ctx) =>
        ctx.db
            .query("workbenchInstructions")
            .withIndex("by_request", (q) => q.eq("requestId", requestId))
            .unique(),
    );
    if (!instruction) throw new Error("Expected retained instruction");
    await expect(
        t.mutation(internal.workbench.deliverSourceInstruction, {
            instructionId: instruction._id,
        }),
    ).rejects.toThrow("preparation_disabled");
    expect(await t.run((ctx) => ctx.db.get(runId))).toMatchObject({
        executionStatus: "paused",
        pauseReason: "source_review",
        executionGeneration: 3,
    });
    expect(
        await t.run(async (ctx) =>
            (
                await ctx.db
                    .query("sourceSelectionProposalRebuilds")
                    .withIndex("by_revision_and_created_at", (q) =>
                        q.eq("corpusRevisionId", corpusRevisionId),
                    )
                    .take(2)
            ).map((p) => p._id),
        ),
    ).toEqual([previousPreparationId]);
    expect(network).not.toHaveBeenCalled();
});

test.each([
    false,
    true,
])("an initial source-review transition reconciles a late pause (preparation: %s)", async (withPreparation) => {
    const { t, client, runId, corpusRevisionId } = await framedDiscovery();
    if (withPreparation) {
        const preparationId = await t.mutation(
            internal.sourcePreparation.claimForDiscovery,
            { runId, corpusRevisionId, expectedExecutionGeneration: 3 },
        );
        await t.run((ctx) =>
            ctx.db.patch(preparationId, {
                status: "complete",
                completedAt: Date.now(),
            }),
        );
    }
    await t.mutation(internal.execution.researchControl.checkpoint, { runId });
    await client.mutation(api.execution.researchControl.pause, {
        runId,
        expectedGeneration: 3,
    });
    await t.mutation(internal.researchRuns.transition, {
        runId,
        expectedExecutionGeneration: 3,
        lifecycleState: "awaiting_source_review",
        executionStatus: "paused",
        stepKey: "source_review",
    });
    expect(await t.run((ctx) => ctx.db.get(runId))).toMatchObject({
        lifecycleState: "awaiting_source_review",
        executionStatus: "paused",
        pauseReason: "analyst",
        researchPauseRequested: false,
        executionGeneration: 4,
    });
    await client.mutation(api.execution.researchControl.resume, {
        runId,
        expectedGeneration: 4,
    });
    expect(await t.run((ctx) => ctx.db.get(runId))).toMatchObject({
        lifecycleState: "awaiting_source_review",
        executionStatus: "paused",
        pauseReason: "source_review",
        researchPauseRequested: false,
        executionGeneration: 5,
    });
});
