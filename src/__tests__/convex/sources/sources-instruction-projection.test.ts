import { api, internal } from "@convex/_generated/api";
import { getDocumentSize } from "convex/values";
import { afterEach, assert, expect, test, vi } from "vitest";
import { seedCapturedSources } from "@/__tests__/setup/sources-mission";

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
});

test("many instructions share a preparation read and keep the authenticated snapshot within transaction limits", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const f = await seedCapturedSources();
    const framingId = await f.t.run(async (ctx) => {
        const preparation = await ctx.db.get(f.preparationId);
        assert(preparation?.sourcesMission);
        const frameId = await ctx.db.insert("framingRevisions", {
            runId: f.runId,
            revision: 1,
            content: { scope: "Workflow", questions: [] },
            requestKey: "instruction-projection",
            contentHash: "fixture",
            origin: "analyst",
            createdAt: 1,
        });
        await ctx.db.patch(f.runId, {
            startMode: "framed",
            agentExecutionVersion: 3,
            fixedFramingRevisionId: frameId,
        });
        await ctx.db.patch(f.preparationId, {
            sourcesMission: {
                ...preparation.sourcesMission,
                envelope: {
                    ...preparation.sourcesMission.envelope,
                    maxNeeds: 160,
                },
            },
        });
        return frameId;
    });
    const analyst = f.t.withIdentity({ subject: f.userId });
    const messageId = await analyst.mutation(
        api.execution.conversations.submit,
        {
            runId: f.runId,
            requestKey: "instruction-projection",
            text: "Research documentary needs",
            delivery: "queue",
        },
    );
    await f.t.run(async (ctx) => {
        for (let i = 0; i < 159; i++) {
            const interpretedNeed =
                "研究".repeat(995) + String(i).padStart(10, "0");
            const requestId = await ctx.db.insert("agentOperationRequests", {
                runId: f.runId,
                actor: "agent",
                cause: `instruction-${i}`,
                input: {
                    kind: "transmit_source_request",
                    messageId,
                    interpretedNeed,
                    coverageRole: null,
                },
                operationVersion: 1,
                expectedGeneration: 4,
                logicalKey: `instruction-${i}`,
                status: "completed",
                createdAt: i + 1,
            });
            await ctx.db.insert("workbenchInstructions", {
                runId: f.runId,
                requestId,
                messageId,
                interpretedNeed,
                framingRevisionId: framingId,
                status: "waiting",
                outcome: "Waiting",
                createdAt: i + 1,
            });
        }
    });
    for (let i = 0; i < 8; i++)
        await f.t.run((ctx) =>
            ctx.runMutation(
                internal.workbench.processInstructions,
                { runId: f.runId },
                {
                    transactionLimits: {
                        bytesRead: 16 * 1024 * 1024,
                        databaseQueries: 4096,
                    },
                },
            ),
        );
    const preparation = await f.t.run((ctx) => ctx.db.get(f.preparationId));
    assert(preparation?.sourcesMission);
    const instructions = await f.t.run((ctx) =>
        ctx.db
            .query("workbenchInstructions")
            .withIndex("by_run", (q) => q.eq("runId", f.runId))
            .take(160),
    );
    expect(instructions).toHaveLength(159);
    expect(
        instructions.every(
            (row) => row.status === "transmitted" || row.status === "limited",
        ),
    ).toBe(true);
    expect(preparation.sourcesMission.needs).toHaveLength(
        1 + instructions.filter((row) => row.status === "transmitted").length,
    );
    expect(getDocumentSize(preparation)).toBeGreaterThan(
        (16 * 1024 * 1024) / 20,
    );
    expect(getDocumentSize(preparation)).toBeLessThan(1_048_576);
    const snapshot = await analyst.run((ctx) =>
        ctx.runQuery(
            api.workbench.snapshot,
            { runId: f.runId },
            { transactionLimits: { bytesRead: 16 * 1024 * 1024 } },
        ),
    );
    expect(snapshot.run._id).toBe(f.runId);
    expect(snapshot.instructions).toEqual(
        instructions
            .slice(-20)
            .reverse()
            .map((instruction) => ({
                id: instruction._id,
                need: instruction.interpretedNeed,
                status: instruction.status,
                outcome: instruction.outcome,
            })),
    );
    expect(snapshot.preparation?._id).toBe(f.preparationId);
    expect(snapshot.preparation?.sourcesMission?.needs).toEqual(
        preparation.sourcesMission.needs,
    );
});
