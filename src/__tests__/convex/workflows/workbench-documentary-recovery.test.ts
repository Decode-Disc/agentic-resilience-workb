import { api, internal } from "@convex/_generated/api";
import agentTest from "@convex-dev/agent/test";
import { afterEach, expect, test, vi } from "vitest";
import workflowTest from "@/__tests__/convex/workflows/workflow-test-register.js";
import { seedSourcePreparation } from "@/__tests__/setup/source-preparation";

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
});
test("historical instructions settle without starting retired preparation", async () => {
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
    const snapshot = () =>
        t.run(async (ctx) => ({
            run: await ctx.db.get(runId),
            preparations: await ctx.db
                .query("sourceSelectionProposalRebuilds")
                .collect(),
            receipts: await ctx.db.query("providerCalls").collect(),
            scheduled: await ctx.db.system
                .query("_scheduled_functions")
                .collect(),
        }));
    const before = await snapshot();
    await t.mutation(internal.workbench.processInstructions, { runId });
    for (const id of ids)
        expect(await t.run((ctx) => ctx.db.get(id))).toMatchObject({
            status: "limited",
        });
    expect(await snapshot()).toEqual(before);
});
