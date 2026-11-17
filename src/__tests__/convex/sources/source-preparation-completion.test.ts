import { api, internal } from "@convex/_generated/api";
import { sha256Hex } from "@convex/domain/sourcePassages";
import { SOURCE_QUALIFICATION_VERSION } from "@convex/domain/sourceQualification";
import { afterEach, expect, test, vi } from "vitest";
import { seedSourcePreparation } from "@/__tests__/setup/source-preparation";

afterEach(() => vi.useRealTimers());

async function preparationForReview() {
    const fixture = await seedSourcePreparation();
    const { t, runId, corpusRevisionId } = fixture;
    const preparationId = await t.mutation(
        internal.sourcePreparation.claimForDiscovery,
        { runId, corpusRevisionId, expectedExecutionGeneration: 3 },
    );
    await t.run(async (ctx) => {
        await ctx.db.patch(preparationId, { entryPoint: "source_review" });
        await ctx.db.patch(runId, {
            lifecycleState: "awaiting_source_review",
            workflowId: "preserved-approval-handle",
        });
    });
    return { ...fixture, preparationId };
}

test("cannot finish an unexamined preparation before its deadline", async () => {
    const { t, preparationId } = await preparationForReview();
    await expect(
        t.mutation(internal.sourcePreparation.finish, {
            preparationId,
            expectedExecutionGeneration: 3,
        }),
    ).rejects.toThrow("preparation_unfinished");
    expect(
        await t.run((ctx) =>
            ctx.db.query("sourceSelectionProposals").collect(),
        ),
    ).toHaveLength(0);
});

test("finishes at the deadline without I/O and preserves the durable corpus approval handle", async () => {
    vi.useFakeTimers();
    const { t, runId, corpusRevisionId, preparationId } =
        await preparationForReview();
    const preparation = await t.run((ctx) => ctx.db.get(preparationId));
    if (!preparation?.deadlineAt)
        throw new Error("Missing preparation deadline");
    vi.setSystemTime(preparation.deadlineAt + 1);
    await expect(
        t.query(internal.sourcePreparation.getForExecution, {
            preparationId,
            now: Date.now(),
        }),
    ).rejects.toThrow("stale_execution");
    const result = await t.mutation(internal.sourcePreparation.finish, {
        preparationId,
        expectedExecutionGeneration: 3,
    });
    expect(
        await t.mutation(internal.sourcePreparation.finish, {
            preparationId,
            expectedExecutionGeneration: 3,
        }),
    ).toEqual(result);
    const state = await t.run(async (ctx) => ({
        run: await ctx.db.get(runId),
        revision: await ctx.db.get(corpusRevisionId),
        preparation: await ctx.db.get(preparationId),
        events: await ctx.db.query("runEvents").collect(),
        claims: await ctx.db.query("claims").collect(),
    }));
    expect(state.run).toMatchObject({
        workflowId: "preserved-approval-handle",
        lifecycleState: "awaiting_source_review",
        executionStatus: "paused",
        pauseReason: "source_review",
    });
    expect(state.revision?.status).toBe("draft");
    expect(state.preparation).toMatchObject({
        status: "blocked",
        proposalId: result.proposalId,
    });
    expect(
        state.events.filter(
            (event) => event.type === "source_preparation_completed",
        ),
    ).toHaveLength(1);
    expect(state.claims).toHaveLength(0);
});

test.each([
    "cancelled",
    "generation_changed",
] as const)("deadline completion cannot advance %s work", async (mode) => {
    vi.useFakeTimers();
    const { t, runId, preparationId } = await preparationForReview();
    await t.run((ctx) =>
        ctx.db.patch(
            runId,
            mode === "cancelled"
                ? { executionStatus: "cancelled" }
                : { executionGeneration: 4 },
        ),
    );
    vi.advanceTimersByTime(16 * 60_000);
    await expect(
        t.mutation(internal.sourcePreparation.finish, {
            preparationId,
            expectedExecutionGeneration: 3,
        }),
    ).rejects.toThrow("stale_execution");
    expect(
        await t.run((ctx) =>
            ctx.db.query("sourceSelectionProposals").collect(),
        ),
    ).toHaveLength(0);
});

test("records unavailable results once, then restores source review without accepting the corpus", async () => {
    const { t, runId, sourceId, preparationId } = await preparationForReview();
    const args = {
        preparationId,
        outcome: {
            sourceId,
            result: {
                status: "unavailable" as const,
                reasonCode: "missing_configuration",
            },
        },
    };
    await t.mutation(internal.sourcePreparation.recordResult, args);
    await t.mutation(internal.sourcePreparation.recordResult, args);
    const result = await t.mutation(internal.sourcePreparation.finish, {
        preparationId,
        expectedExecutionGeneration: 3,
    });
    const state = await t.run(async (ctx) => ({
        preparation: await ctx.db.get(preparationId),
        events: await ctx.db.query("runEvents").collect(),
        run: await ctx.db.get(runId),
    }));
    expect(state.preparation?.sourceOutcomes).toHaveLength(1);
    expect(
        state.events.filter(
            (event) => event.type === "source_preparation_progress",
        ),
    ).toHaveLength(1);
    expect(state.preparation).toMatchObject({
        status: "blocked",
        proposalId: result.proposalId,
    });
    expect(state.run).toMatchObject({
        workflowId: "preserved-approval-handle",
        executionStatus: "paused",
    });
});

test("does not overwrite a recorded source result with a different outcome", async () => {
    const { t, sourceId, preparationId } = await preparationForReview();
    await t.mutation(internal.sourcePreparation.recordResult, {
        preparationId,
        outcome: {
            sourceId,
            result: {
                status: "unavailable",
                reasonCode: "missing_configuration",
            },
        },
    });
    await expect(
        t.mutation(internal.sourcePreparation.recordResult, {
            preparationId,
            outcome: {
                sourceId,
                result: {
                    status: "unavailable",
                    reasonCode: "different_failure",
                },
            },
        }),
    ).rejects.toThrow("preparation_result_conflict");
});

test("expired preparation cannot append a late source result", async () => {
    vi.useFakeTimers();
    const { t, sourceId, preparationId } = await preparationForReview();
    vi.advanceTimersByTime(16 * 60_000);
    await expect(
        t.mutation(internal.sourcePreparation.recordResult, {
            preparationId,
            outcome: {
                sourceId,
                result: { status: "unavailable", reasonCode: "late_result" },
            },
        }),
    ).resolves.toBe("deadline_elapsed");
    expect(
        (await t.run((ctx) => ctx.db.get(preparationId)))?.sourceOutcomes,
    ).toBeUndefined();
});

test("rejected sources do not delay completion or create analytical artifacts", async () => {
    const { t, runId, corpusRevisionId, sourceId, userId, preparationId } =
        await preparationForReview();
    await t.withIdentity({ subject: userId }).mutation(api.sources.decide, {
        runId,
        corpusRevisionId,
        sourceId,
        decision: "rejected",
        decisionKey: "rejected-during-preparation",
    });
    await expect(
        t.mutation(internal.sourcePreparation.recordResult, {
            preparationId,
            outcome: {
                sourceId,
                result: {
                    status: "unavailable",
                    reasonCode: "source_rejected",
                },
            },
        }),
    ).resolves.toBe("source_rejected");
    expect(
        await t.mutation(internal.sourcePreparation.finish, {
            preparationId,
            expectedExecutionGeneration: 3,
        }),
    ).toMatchObject({ outcome: "complete" });
    const review = await t
        .withIdentity({ subject: userId })
        .query(api.sourceSelectionProposals.getCurrent, {
            runId,
            corpusRevisionId,
        });
    expect(review?.preparation?.status).toBe("complete");
    expect(
        await t.run((ctx) => ctx.db.query("sourceVersions").collect()),
    ).toHaveLength(0);
});

test("finishes a qualified source as prepared while keeping corpus approval pending", async () => {
    const { t, runId, corpusRevisionId, sourceId, preparationId } =
        await preparationForReview();
    const text = "ServiceNow provides workflow software.";
    const { captureId, taskId } = await t.run(async (ctx) => {
        const storageId = await ctx.storage.store(new Blob([text]));
        const contentHash = sha256Hex(text);
        const captureId = await ctx.db.insert("sourceCaptures", {
            runId,
            corpusRevisionId,
            sourceId,
            preparationId,
            executionGeneration: 3,
            captureKey: "completion-fixture",
            requestInputHash: sha256Hex("completion-fixture"),
            status: "committed",
            requestedUrl: "https://www.servicenow.com/products/workflows.html",
            storageId,
            contentHash,
            byteCount: text.length,
            normalizerVersion: "test-v1",
            retrievalVersion: "test-v1",
            retrievedAt: Date.now(),
            readingCompleteness: "complete",
            omittedPassageCount: 0,
            createdAt: Date.now(),
            updatedAt: Date.now(),
        });
        const reference = { passageKey: "p0", quotation: text };
        const taskId = await ctx.db.insert("aiTaskResults", {
            runId,
            corpusRevisionId,
            sourceId,
            sourceCaptureId: captureId,
            taskType: "source_qualification",
            executionMode: "live",
            schemaVersion: SOURCE_QUALIFICATION_VERSION,
            adapterVersion: "test-qualification",
            inputHash: contentHash,
            output: {
                kind: "source_qualification",
                sourceCaptureId: captureId,
                contentHash,
                readingCompleteness: "complete",
                omittedPassageCount: 0,
                selectedPassages: [
                    {
                        passageKey: "p0",
                        startOffset: 0,
                        endOffset: text.length,
                    },
                ],
                qualification: {
                    companyMatch: "subject",
                    companyPassages: [reference],
                    documentKind: "official_product_documentation",
                    reportingPeriodEnd: null,
                    reportingPeriodPassages: [],
                    findings: [
                        {
                            role: "official_product_platform",
                            kind: "asserted_fact",
                            summary: text,
                            passages: [reference],
                            period: "unspecified",
                            periodPassages: [],
                            dependsOnFlaggedAssertion: false,
                        },
                    ],
                    limitations: [],
                },
            },
            createdAt: Date.now(),
        });
        return { captureId, taskId };
    });
    await t.mutation(internal.sourcePreparation.recordResult, {
        preparationId,
        outcome: {
            sourceId,
            result: { status: "qualified", sourceCaptureId: captureId, taskId },
        },
    });
    expect(
        await t.mutation(internal.sourcePreparation.finish, {
            preparationId,
            expectedExecutionGeneration: 3,
        }),
    ).toMatchObject({ outcome: "complete" });
    const state = await t.run(async (ctx) => ({
        revision: await ctx.db.get(corpusRevisionId),
        versions: await ctx.db.query("sourceVersions").collect(),
        claims: await ctx.db.query("claims").collect(),
    }));
    expect(state.revision?.status).toBe("draft");
    expect(state.versions).toHaveLength(0);
    expect(state.claims).toHaveLength(0);
});

test("initial preparation leaves the main workflow running until its existing approval checkpoint", async () => {
    const { t, runId, corpusRevisionId, sourceId } =
        await seedSourcePreparation();
    const preparationId = await t.mutation(
        internal.sourcePreparation.claimForDiscovery,
        { runId, corpusRevisionId, expectedExecutionGeneration: 3 },
    );
    await t.mutation(internal.sourcePreparation.recordResult, {
        preparationId,
        outcome: {
            sourceId,
            result: {
                status: "unavailable",
                reasonCode: "missing_configuration",
            },
        },
    });
    await t.mutation(internal.sourcePreparation.finish, {
        preparationId,
        expectedExecutionGeneration: 3,
    });
    expect(await t.run((ctx) => ctx.db.get(runId))).toMatchObject({
        lifecycleState: "discovering_sources",
        executionStatus: "running",
        executionGeneration: 3,
    });
    expect((await t.run((ctx) => ctx.db.get(corpusRevisionId)))?.status).toBe(
        "draft",
    );
});
