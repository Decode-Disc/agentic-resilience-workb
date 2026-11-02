import { api, internal } from "@convex/_generated/api";
import type { MutationCtx } from "@convex/_generated/server";
import { processInstructions } from "@convex/workbench";
import agentTest from "@convex-dev/agent/test";
import { getFunctionName } from "convex/server";
import { afterEach, expect, test, vi } from "vitest";
import workflowTest from "@/__tests__/convex/workflows/workflow-test-register.js";
import { seedSourcePreparation } from "@/__tests__/setup/source-preparation";

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
});
test.each([
    false,
    true,
])("instruction delivery preserves expected refusals and propagates infrastructure failures (%s)", async (unexpected) => {
    vi.useFakeTimers();
    const f = await seedSourcePreparation();
    const { t, runId, userId } = f;
    agentTest.register(t);
    workflowTest.register(t);
    await t.mutation(internal.sourceSelectionProposals.generateForRun, {
        runId,
        expectedExecutionGeneration: 3,
    });
    const client = t.withIdentity({ subject: userId });
    const messageId = await client.mutation(
        api.execution.conversations.submit,
        {
            runId,
            requestKey: "instruction-message",
            text: "Please inspect commercial terms",
            delivery: "queue",
        },
    );
    const ids = await t.run(async (ctx) => {
        const framingId = await ctx.db.insert("framingRevisions", {
            runId,
            revision: 1,
            content: { scope: "Accepted workflow", questions: [] },
            contentHash: "fixture",
            requestKey: "saved",
            origin: "analyst",
            createdAt: Date.now(),
        });
        await ctx.db.patch(runId, {
            startMode: "framed",
            agentExecutionVersion: 3,
            fixedFramingRevisionId: framingId,
            currentFramingRevisionId: framingId,
            lifecycleState: "awaiting_source_review",
            executionStatus: "paused",
            pauseReason: "source_review",
        });
        const ids = [];
        for (const key of ["one", "two"]) {
            const requestId = await ctx.db.insert("agentOperationRequests", {
                runId,
                actor: "agent",
                cause: "fixture",
                input: {
                    kind: "transmit_source_request",
                    messageId,
                    interpretedNeed: key,
                    coverageRole: "official_commercial_terms",
                },
                operationVersion: 1,
                expectedGeneration: 1,
                logicalKey: key,
                status: "completed",
                createdAt: Date.now(),
            });
            ids.push(
                await ctx.db.insert("workbenchInstructions", {
                    runId,
                    requestId,
                    messageId,
                    interpretedNeed: key,
                    framingRevisionId: framingId,
                    coverageRole: "official_commercial_terms",
                    status: "waiting",
                    outcome: "Waiting for transmission",
                    createdAt: Date.now(),
                }),
            );
        }
        const [first, second] = ids;
        if (!first || !second) throw new Error("Expected two instructions");
        return [first, second] as const;
    });
    if (unexpected) {
        const registered = processInstructions as typeof processInstructions & {
            _handler(
                ctx: MutationCtx,
                args: { runId: typeof runId },
            ): Promise<null>;
        };
        await expect(
            t.mutation((ctx) =>
                registered._handler(
                    {
                        ...ctx,
                        runMutation: async (reference, ...args) => {
                            if (
                                getFunctionName(reference) ===
                                "workbench:deliverSourceInstruction"
                            )
                                throw new Error(
                                    "Documentary dispatch infrastructure unavailable",
                                );
                            return ctx.runMutation(reference, ...args);
                        },
                    },
                    { runId },
                ),
            ),
        ).rejects.toThrow("Documentary dispatch infrastructure unavailable");
        expect(await t.run((ctx) => ctx.db.get(ids[0]))).toMatchObject({
            status: "waiting",
        });
        return;
    }
    await t.mutation(internal.workbench.processInstructions, { runId });
    expect(await t.run((ctx) => ctx.db.get(ids[0]))).toMatchObject({
        status: "blocked",
    });
    expect(await t.run((ctx) => ctx.db.get(ids[1]))).toMatchObject({
        status: "blocked",
    });
    const wakes = await t.run((ctx) =>
        ctx.db.system.query("_scheduled_functions").collect(),
    );
    expect(wakes).toHaveLength(0);
});

test("a pause at review finalization resumes back to the required source review", async () => {
    vi.useFakeTimers();
    vi.stubEnv("SOURCE_QUALIFICATION_ENABLED", "true");
    const f = await seedSourcePreparation();
    const { t, runId, corpusRevisionId, userId } = f;
    workflowTest.register(t);
    const proposal = await t.mutation(
        internal.sourceSelectionProposals.generateForRun,
        { runId, expectedExecutionGeneration: 3 },
    );
    await t.run(async (ctx) => {
        const framingId = await ctx.db.insert("framingRevisions", {
            runId,
            revision: 1,
            content: { scope: "Accepted workflow", questions: [] },
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
            lifecycleState: "awaiting_source_review",
            executionStatus: "paused",
            pauseReason: "source_review",
        });
    });
    const client = t.withIdentity({ subject: userId });
    const preparation = await client.mutation(
        api.sourcePreparation.startForReview,
        {
            runId,
            corpusRevisionId,
            expectedProposalId: proposal.proposalId,
            requestId: "review-finalization",
        },
    );
    // A real workflow checkpoint has just returned running generation 4.
    await t.mutation(internal.execution.researchControl.checkpoint, {
        runId,
        preparationId: preparation.preparationId,
    });
    await client.mutation(api.execution.researchControl.pause, {
        runId,
        expectedGeneration: 4,
    });
    await t.mutation(internal.sourcePreparation.finish, {
        preparationId: preparation.preparationId,
        expectedExecutionGeneration: 4,
        stopCode: "missing_configuration",
    });
    expect(await t.run((ctx) => ctx.db.get(runId))).toMatchObject({
        executionStatus: "paused",
        pauseReason: "analyst",
        researchPauseRequested: false,
        executionGeneration: 5,
    });
    await client.mutation(api.execution.researchControl.resume, {
        runId,
        expectedGeneration: 5,
    });
    expect(await t.run((ctx) => ctx.db.get(runId))).toMatchObject({
        executionStatus: "paused",
        pauseReason: "source_review",
        executionGeneration: 6,
    });
});
