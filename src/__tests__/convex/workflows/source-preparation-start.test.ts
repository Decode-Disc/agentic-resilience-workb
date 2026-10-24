import { api, internal } from "@convex/_generated/api";
import type { ActionCtx } from "@convex/_generated/server";
import { sha256Hex } from "@convex/domain/sourcePassages";
import { addManualUrlWithInspector } from "@convex/sourceActions";
import { workflow } from "@convex/workflow";
import type { FunctionReference } from "convex/server";
import type { Value } from "convex/values";
import { afterEach, expect, test, vi } from "vitest";
import rateLimiterTest from "@/__tests__/convex/integrations/rate-limiter-test-register.js";

import { seedSourcePreparation } from "@/__tests__/setup/source-preparation";
import workflowTest from "./workflow-test-register.js";

afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

async function waitingReview() {
    vi.stubEnv("SOURCE_QUALIFICATION_ENABLED", "true");
    vi.stubEnv("OPENROUTER_API_KEY", "test-only-key");
    const fixture = await seedSourcePreparation();
    const { t, runId } = fixture;
    workflowTest.register(t);
    const proposal = await t.mutation(
        internal.sourceSelectionProposals.generateForRun,
        {
            runId,
            expectedExecutionGeneration: 3,
        },
    );
    const mainHandle = await t.run(async (ctx) => {
        const mainHandle = await workflow.start(
            ctx,
            internal.e2eFixtures.sourceReviewWorkflow,
            { runId },
        );
        await ctx.db.patch(runId, {
            workflowId: mainHandle,
            lifecycleState: "awaiting_source_review",
            executionStatus: "paused",
            pauseReason: "source_review",
        });
        return mainHandle;
    });
    return { ...fixture, proposal, mainHandle };
}

test("offers explicit reading preparation for a current metadata-only draft without starting work", async () => {
    vi.useFakeTimers();
    const { t, runId, corpusRevisionId, userId } = await waitingReview();
    const current = await t
        .withIdentity({ subject: userId })
        .query(api.sourceSelectionProposals.getCurrent, {
            runId,
            corpusRevisionId,
        });
    expect(current?.preparationAction).toEqual({
        kind: "start",
        available: true,
    });
    expect(
        (await t.run((ctx) => ctx.db.get(runId)))?.sourcePreparationId,
    ).toBeUndefined();
    expect(await t.run((ctx) => ctx.db.query("providerCalls").take(1))).toEqual(
        [],
    );
});

test("targets a review search without rereading existing sources or replenishing the supplement", async () => {
    vi.useFakeTimers();
    const { t, runId, corpusRevisionId, userId, proposal, sourceId } =
        await waitingReview();
    const owned = t.withIdentity({ subject: userId });
    const args = {
        runId,
        corpusRevisionId,
        expectedProposalId: proposal.proposalId,
        requestId: "original-reading",
    };
    const first = await owned.mutation(
        api.sourcePreparation.startForReview,
        args,
    );
    await t.mutation(internal.sourcePreparation.recordResult, {
        preparationId: first.preparationId,
        outcome: {
            sourceId,
            result: {
                status: "unavailable",
                reasonCode: "content_not_available",
            },
        },
    });
    await t.mutation(internal.sourcePreparation.reserveNextSupplementSearch, {
        preparationId: first.preparationId,
    });
    await t.run(async (ctx) => {
        const original = await ctx.db.get(first.preparationId);
        await ctx.db.patch(first.preparationId, { status: "complete" });
        await ctx.db.patch(runId, {
            executionStatus: "paused",
            pauseReason: "source_review",
        });
        return original;
    });
    vi.setSystemTime(Date.now() + 30_000);
    const proposalForSearch = await owned.query(
        api.sourceSelectionProposals.getCurrent,
        { runId, corpusRevisionId },
    );
    if (!proposalForSearch) throw new Error("Missing current proposal");
    const targetedArgs = {
        ...args,
        expectedProposalId: proposalForSearch.proposalId,
        requestId: "terms-search",
        target: {
            kind: "coverage" as const,
            role: "official_commercial_terms" as const,
        },
    };
    const requested = await owned.action(
        api.sourceSelectionProposalActions.recoverDiscovery,
        targetedArgs,
    );
    expect(requested).toMatchObject({
        outcome: "blocked",
        reason: "in_progress",
    });
    const searchRun = await t.run((ctx) => ctx.db.get(runId));
    if (!searchRun?.sourcePreparationId)
        throw new Error("Missing requested preparation");
    const search = {
        preparationId: searchRun.sourcePreparationId,
        status: "started" as const,
    };
    await expect(
        owned.mutation(api.sourcePreparation.startForReview, {
            ...targetedArgs,
            requestId: "different-target",
            target: { kind: "coverage", role: "regulatory_annual" },
        }),
    ).rejects.toThrow("preparation_busy");
    expect(
        await owned.mutation(
            api.sourcePreparation.startForReview,
            targetedArgs,
        ),
    ).toEqual(search);
    const batch = await t.mutation(internal.sourcePreparation.nextBatch, {
        preparationId: search.preparationId,
    });
    expect(batch.sourceIds).toEqual([]);
    const reserved = await t.mutation(
        internal.sourcePreparation.reserveNextSupplementSearch,
        { preparationId: search.preparationId },
    );
    expect(reserved?.query.query).toContain(
        "official terms of service customer agreement",
    );
    expect(
        await t.mutation(
            internal.sourcePreparation.reserveNextSupplementSearch,
            { preparationId: search.preparationId },
        ),
    ).toBeNull();
    const current = await t.run((ctx) => ctx.db.get(search.preparationId));
    expect(current?.deadlineAt).toBe(Date.now() + 900_000);
    expect(current?.target).toEqual(targetedArgs.target);
    expect(current?.readingSourceIds).toEqual([]);
    expect(
        await t.run((ctx) => ctx.db.query("providerCalls").take(4)),
    ).toHaveLength(2);
    if (!reserved || !current) throw new Error("Missing search reservation");
    await t.mutation(internal.sourceDiscovery.persistCandidates, {
        runId,
        corpusRevisionId,
        preparationId: search.preparationId,
        executionGeneration: current.executionGeneration,
        operationKey: reserved.operationKey,
        candidates: [
            {
                canonicalUrl:
                    "https://www.servicenow.com/legal/terms-of-service.html",
                title: "Customer terms",
                origin: "exa",
                category: "official_commercial",
            },
        ],
        providerCompletion: {
            providerCallId: reserved.providerCallId,
            status: "succeeded",
            latencyMs: 5,
            accepted: 1,
            rejected: 0,
        },
    });
    const next = await t.mutation(internal.sourcePreparation.nextBatch, {
        preparationId: search.preparationId,
    });
    expect(next.sourceIds).toHaveLength(1);
    expect(next.sourceIds).not.toContain(sourceId);
    const newSourceId = next.sourceIds[0];
    if (!newSourceId) throw new Error("Missing new candidate");
    await t.mutation(internal.sourcePreparation.recordResult, {
        preparationId: search.preparationId,
        outcome: {
            sourceId: newSourceId,
            result: {
                status: "unavailable",
                reasonCode: "missing_configuration",
            },
        },
    });
    await t.mutation(internal.sourcePreparation.finish, {
        preparationId: search.preparationId,
        expectedExecutionGeneration: current.executionGeneration,
    });
    const sets = await owned.query(
        api.sourceSelectionProposals.getAdjustmentSets,
        { runId, corpusRevisionId },
    );
    expect(
        sets.available.find((item) =>
            item.canonicalUrl.endsWith("terms-of-service.html"),
        ),
    ).toMatchObject({
        decision: "pending",
        included: false,
        disposition: "needs_attention",
    });
    const finishedProposal = await owned.query(
        api.sourceSelectionProposals.getCurrent,
        { runId, corpusRevisionId },
    );
    if (!finishedProposal) throw new Error("Missing completed search proposal");
    const resumeArgs = {
        runId,
        corpusRevisionId,
        expectedProposalId: finishedProposal.proposalId,
        requestId: "continue-targeted-reading",
    };
    const resumed = await owned.mutation(
        api.sourcePreparation.startForReview,
        resumeArgs,
    );
    expect(
        await t.run((ctx) => ctx.db.get(resumed.preparationId)),
    ).toMatchObject({
        target: targetedArgs.target,
        readingSourceIds: [newSourceId],
        deadlineAt: Date.now() + 900_000,
        insertedCount: 1,
    });
    expect(
        await t.mutation(internal.sourcePreparation.nextBatch, {
            preparationId: resumed.preparationId,
        }),
    ).toMatchObject({ sourceIds: [newSourceId], canSupplement: false });
    expect(
        await owned.mutation(api.sourcePreparation.startForReview, resumeArgs),
    ).toEqual(resumed);
});

test("starts source reading atomically without replacing the waiting approval workflow and deduplicates replay", async () => {
    vi.useFakeTimers();
    const { t, runId, corpusRevisionId, userId, proposal, mainHandle } =
        await waitingReview();
    const owned = t.withIdentity({ subject: userId });
    const args = {
        runId,
        corpusRevisionId,
        expectedProposalId: proposal.proposalId,
        requestId: "prepare-existing",
    };
    const request = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", request);
    const started = await owned.mutation(
        api.sourcePreparation.startForReview,
        args,
    );
    expect(started.status).toBe("started");
    const replay = await owned.mutation(
        api.sourcePreparation.startForReview,
        args,
    );
    expect(replay).toEqual(started);
    const state = await t.run(async (ctx) => ({
        run: await ctx.db.get(runId),
        preparation: await ctx.db.get(started.preparationId),
        preparations: await ctx.db
            .query("sourceSelectionProposalRebuilds")
            .take(3),
    }));
    expect(state.run).toMatchObject({
        executionStatus: "running",
        executionGeneration: 4,
        workflowId: mainHandle,
    });
    expect(state.preparations).toHaveLength(1);
    expect(state.preparation).toMatchObject({
        entryPoint: "source_review",
        expectedProposalId: proposal.proposalId,
        executionGeneration: 4,
    });
    expect(state.preparation?.workflowId).toBeTruthy();
    expect(state.preparation?.workflowId).not.toBe(mainHandle);
    expect(request).not.toHaveBeenCalled();
});

test("continues the unfinished reading after a search added no candidates without extending its deadline", async () => {
    vi.useFakeTimers();
    const { t, runId, corpusRevisionId, userId, proposal, sourceId } =
        await waitingReview();
    const owned = t.withIdentity({ subject: userId });
    const args = {
        runId,
        corpusRevisionId,
        expectedProposalId: proposal.proposalId,
    };
    const first = await owned.mutation(api.sourcePreparation.startForReview, {
        ...args,
        requestId: "interrupted-search",
    });
    const deadlineAt = await t.run(async (ctx) => {
        const original = await ctx.db.get(first.preparationId);
        await ctx.db.patch(first.preparationId, {
            status: "blocked",
            target: { kind: "coverage", role: "regulatory_annual" },
            readingSourceIds: [],
            insertedCount: 0,
            stopCode: "preparation_failed",
        });
        await ctx.db.patch(runId, {
            executionStatus: "paused",
            pauseReason: "source_review",
        });
        return original?.deadlineAt;
    });
    const resumed = await owned.mutation(api.sourcePreparation.startForReview, {
        ...args,
        requestId: "continue-reading",
    });
    expect(
        (await t.run((ctx) => ctx.db.get(resumed.preparationId)))?.deadlineAt,
    ).toBe(deadlineAt);
    expect(
        await t.mutation(internal.sourcePreparation.nextBatch, {
            preparationId: resumed.preparationId,
        }),
    ).toMatchObject({ sourceIds: [sourceId] });
});

test("a new review request renews execution time while preserving qualification input identity", async () => {
    vi.useFakeTimers();
    const { t, runId, corpusRevisionId, userId, sourceId, proposal } =
        await waitingReview();
    const owned = t.withIdentity({ subject: userId });
    const first = await owned.mutation(api.sourcePreparation.startForReview, {
        runId,
        corpusRevisionId,
        expectedProposalId: proposal.proposalId,
        requestId: "first-read",
    });
    const { capture } = await t.mutation(
        internal.sourceCaptures.reserveUpload,
        { preparationId: first.preparationId, sourceId },
    );
    const text = "ServiceNow provides workflow software.";
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob([text])));
    await t.mutation(internal.sourceCaptures.attachStorage, {
        preparationId: first.preparationId,
        captureId: capture._id,
        storageId,
    });
    await t.mutation(internal.sourceCaptures.finalize, {
        preparationId: first.preparationId,
        captureId: capture._id,
        contentHash: sha256Hex(text),
        byteCount: text.length,
        resolvedUrl: capture.requestedUrl,
        normalizerVersion: capture.normalizerVersion,
        retrievalVersion: "fixture",
        readingCompleteness: "complete",
        omittedPassageCount: 0,
        retrievedAt: Date.now(),
    });
    const originalInput = await t.query(
        internal.sourcePreparation.getQualificationInput,
        {
            preparationId: first.preparationId,
            sourceCaptureId: capture._id,
            now: Date.now(),
        },
    );
    await t.mutation(internal.sourcePreparation.recordResult, {
        preparationId: first.preparationId,
        outcome: {
            sourceId,
            result: {
                status: "unavailable",
                reasonCode: "missing_configuration",
            },
        },
    });
    await t.mutation(internal.sourcePreparation.recordProgress, {
        preparationId: first.preparationId,
        phase: "comparison",
        current: 0,
        total: 1,
    });
    const readingMilestone = (
        await t.run((ctx) => ctx.db.get(first.preparationId))
    )?.initialReadingsCompletedAt;
    const completed = await t.mutation(internal.sourcePreparation.finish, {
        preparationId: first.preparationId,
        expectedExecutionGeneration: 4,
    });
    vi.setSystemTime(Date.now() + 60_000);
    const resumed = await owned.mutation(api.sourcePreparation.startForReview, {
        runId,
        corpusRevisionId,
        expectedProposalId: completed.proposalId,
        requestId: "resume-read",
    });
    const preparation = await t.run((ctx) => ctx.db.get(resumed.preparationId));
    expect(preparation?.deadlineAt).toBe(Date.now() + 900_000);
    expect(preparation?.initialReadingsCompletedAt).toBe(readingMilestone);
    expect(preparation?.executionGeneration).toBe(5);
    expect(preparation?.leaseExpiresAt).toBe(Date.now() + 900_000);
    const resumedInput = await t.query(
        internal.sourcePreparation.getQualificationInput,
        {
            preparationId: resumed.preparationId,
            sourceCaptureId: capture._id,
            now: Date.now(),
        },
    );
    expect(resumedInput.asOfTime).toBe(originalInput.asOfTime);
});

test("cancelling preparation cancels both workflow handles and fences late source results", async () => {
    vi.useFakeTimers();
    const {
        t,
        runId,
        corpusRevisionId,
        userId,
        sourceId,
        proposal,
        mainHandle,
    } = await waitingReview();
    const owned = t.withIdentity({ subject: userId });
    const started = await owned.mutation(api.sourcePreparation.startForReview, {
        runId,
        corpusRevisionId,
        expectedProposalId: proposal.proposalId,
        requestId: "cancel-read",
    });
    const preparation = await t.run((ctx) => ctx.db.get(started.preparationId));
    if (!preparation?.workflowId)
        throw new Error("Missing preparation workflow");
    await owned.mutation(api.workflowControls.cancel, { runId });
    expect(
        await t.run((ctx) => ctx.db.get(started.preparationId)),
    ).toMatchObject({ status: "blocked", stopCode: "cancelled" });
    expect(await t.run((ctx) => ctx.db.get(corpusRevisionId))).toMatchObject({
        sourceSelectionProposalId: proposal.proposalId,
    });
    expect(
        await owned.query(api.sourceSelectionProposals.getCurrent, {
            runId,
            corpusRevisionId,
        }),
    ).toMatchObject({ preparation: { status: "blocked", canResume: false } });
    expect(
        await t.run((ctx) =>
            workflow.status(ctx, preparation.workflowId as never),
        ),
    ).toMatchObject({ type: "canceled" });
    expect(
        await t.run((ctx) => workflow.status(ctx, mainHandle)),
    ).toMatchObject({ type: "canceled" });
    await expect(
        t.mutation(internal.sourcePreparation.recordResult, {
            preparationId: started.preparationId,
            outcome: {
                sourceId,
                result: { status: "unavailable", reasonCode: "late_result" },
            },
        }),
    ).rejects.toThrow("stale_execution");
});

test("missing retrieval configuration returns to review and clears only the preparation handle", async () => {
    vi.useFakeTimers();
    vi.stubEnv("EXA_API_KEY", "");
    vi.stubEnv("OPENROUTER_API_KEY", "");
    const { t, runId, corpusRevisionId, userId, proposal, mainHandle } =
        await waitingReview();
    const request = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", request);
    const started = await t
        .withIdentity({ subject: userId })
        .mutation(api.sourcePreparation.startForReview, {
            runId,
            corpusRevisionId,
            expectedProposalId: proposal.proposalId,
            requestId: "missing-config",
        });
    for (let tick = 0; tick < 100; tick += 1) {
        await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(100));
        const current = await t.run(async (ctx) => ({
            run: await ctx.db.get(runId),
            preparation: await ctx.db.get(started.preparationId),
        }));
        if (
            current.run?.executionStatus === "paused" &&
            !current.preparation?.workflowId
        )
            break;
    }
    const state = await t.run(async (ctx) => ({
        run: await ctx.db.get(runId),
        preparation: await ctx.db.get(started.preparationId),
    }));
    expect(state.run).toMatchObject({
        executionStatus: "paused",
        pauseReason: "source_review",
        workflowId: mainHandle,
    });
    expect(state.preparation?.status).toBe("blocked");
    expect(state.preparation?.workflowId).toBeUndefined();
    expect(
        await t.run((ctx) => workflow.status(ctx, mainHandle)),
    ).toMatchObject({ type: "inProgress" });
    expect(request).not.toHaveBeenCalled();
});

test("another running dossier prevents preparation and unauthorized calls write nothing", async () => {
    vi.useFakeTimers();
    const { t, runId, corpusRevisionId, userId, visitorId, proposal } =
        await waitingReview();
    const args = {
        runId,
        corpusRevisionId,
        expectedProposalId: proposal.proposalId,
        requestId: "blocked-owner",
    };
    await expect(
        t.mutation(api.sourcePreparation.startForReview, args),
    ).rejects.toThrow("Not authenticated");
    await t.run((ctx) =>
        ctx.db.insert("researchRuns", {
            ownerVisitorId: visitorId,
            coveragePreset: "balanced",
            lifecycleState: "discovering_sources",
            executionStatus: "running",
            executionGeneration: 1,
            nextEventSequence: 1,
            createdAt: 1,
            updatedAt: 1,
        }),
    );
    await expect(
        t
            .withIdentity({ subject: userId })
            .mutation(api.sourcePreparation.startForReview, args),
    ).rejects.toThrow("A research workflow is already running");
    expect(
        await t.run((ctx) =>
            ctx.db.query("sourceSelectionProposalRebuilds").take(2),
        ),
    ).toHaveLength(0);
    expect(await t.run((ctx) => ctx.db.get(runId))).toMatchObject({
        executionStatus: "paused",
        executionGeneration: 3,
    });
});

test("a failed preparation callback presents a bounded partial review and a late callback cannot release another execution", async () => {
    vi.useFakeTimers();
    const { t, runId, corpusRevisionId, userId, proposal, mainHandle } =
        await waitingReview();
    const started = await t
        .withIdentity({ subject: userId })
        .mutation(api.sourcePreparation.startForReview, {
            runId,
            corpusRevisionId,
            expectedProposalId: proposal.proposalId,
            requestId: "failed-child",
        });
    const preparation = await t.run((ctx) => ctx.db.get(started.preparationId));
    if (!preparation?.workflowId)
        throw new Error("Missing preparation workflow");
    const completion = {
        workflowId: preparation.workflowId as never,
        result: {
            kind: "failed" as const,
            error: "unexposed internal exception",
        },
        context: { preparationId: started.preparationId },
    };
    await t.mutation(internal.sourcePreparationWorkflow.onComplete, completion);
    const state = await t.run(async (ctx) => ({
        run: await ctx.db.get(runId),
        preparation: await ctx.db.get(started.preparationId),
    }));
    expect(state.run).toMatchObject({
        executionStatus: "paused",
        pauseReason: "source_review",
        workflowId: mainHandle,
    });
    expect(state.preparation).toMatchObject({
        status: "blocked",
        stopCode: "preparation_failed",
    });
    expect(state.preparation?.workflowId).toBeUndefined();
    await t.run((ctx) =>
        ctx.db.patch(runId, {
            executionStatus: "running",
            executionGeneration: 5,
        }),
    );
    await t.mutation(internal.sourcePreparationWorkflow.onComplete, completion);
    expect(await t.run((ctx) => ctx.db.get(runId))).toMatchObject({
        executionStatus: "running",
        executionGeneration: 5,
        workflowId: mainHandle,
    });
});

test("disabled preparation keeps the legacy approval wait and reserves no work", async () => {
    vi.useFakeTimers();
    const { t, runId, corpusRevisionId, userId, proposal, mainHandle } =
        await waitingReview();
    vi.stubEnv("SOURCE_QUALIFICATION_ENABLED", "false");
    await expect(
        t
            .withIdentity({ subject: userId })
            .mutation(api.sourcePreparation.startForReview, {
                runId,
                corpusRevisionId,
                expectedProposalId: proposal.proposalId,
                requestId: "disabled-preparation",
            }),
    ).rejects.toThrow("preparation_disabled");
    expect(await t.run((ctx) => ctx.db.get(runId))).toMatchObject({
        executionStatus: "paused",
        executionGeneration: 3,
        workflowId: mainHandle,
    });
    expect(
        await t.run((ctx) =>
            ctx.db.query("sourceSelectionProposalRebuilds").take(1),
        ),
    ).toHaveLength(0);
    expect(
        await t.run((ctx) => ctx.db.query("providerCalls").take(1)),
    ).toHaveLength(0);
});

test("a genuinely new manual link gets its own window after expiry and never reopens earlier sources or searches", async () => {
    vi.useFakeTimers();
    const fixture = await waitingReview();
    const { t, runId, corpusRevisionId, userId, sourceId, mainHandle } =
        fixture;
    const now = Date.now();
    const originalId = await t.run(async (ctx) => {
        const originalId = await ctx.db.insert(
            "sourceSelectionProposalRebuilds",
            {
                runId,
                corpusRevisionId,
                kind: "preparation",
                entryPoint: "source_review",
                operationKey: "expired-initial-preparation",
                executionGeneration: 3,
                workflowVersion: 1,
                policyVersion: "source-qualification-v2",
                qualificationVersion: "source-qualification-v2",
                status: "blocked",
                failedDiscoveryFamilies: [],
                leaseExpiresAt: now - 1,
                deadlineAt: now - 1,
                asOfTime: now - 900_001,
                createdAt: now - 900_001,
            },
        );
        await ctx.db.patch(runId, {
            sourcePreparationId: originalId,
            sourceQualificationAttemptCount: 17,
        });
        return originalId;
    });
    const manualId = await t
        .withIdentity({ subject: userId })
        .mutation(internal.sources.persistManualCandidate, {
            runId,
            corpusRevisionId,
            executionGeneration: 3,
            providerReference: "manual-new-content",
            canonicalUrl: "https://www.servicenow.com/new-document",
            title: "New official document",
        });
    const state = await t.run(async (ctx) => {
        const run = await ctx.db.get(runId);
        return {
            run,
            preparation: run?.sourcePreparationId
                ? await ctx.db.get(run.sourcePreparationId)
                : null,
            original: await ctx.db.get(originalId),
        };
    });
    expect(state.run).toMatchObject({
        executionStatus: "running",
        executionGeneration: 4,
        workflowId: mainHandle,
        sourceQualificationAttemptCount: 17,
    });
    expect(state.preparation).toMatchObject({
        entryPoint: "manual_addition",
        manualSourceIds: [manualId],
        deadlineAt: Date.now() + 900_000,
        asOfTime: now,
    });
    expect(state.original?.deadlineAt).toBe(now - 1);
    if (!state.preparation) throw new Error("Missing manual preparation");
    const preparationId = state.preparation._id;
    expect(
        await t.mutation(internal.sourcePreparation.nextBatch, {
            preparationId,
        }),
    ).toMatchObject({ sourceIds: [manualId], canSupplement: false });
    expect(
        await t.mutation(internal.sourcePreparation.reserveSupplementPlan, {
            preparationId,
        }),
    ).toBeNull();
    await expect(
        t.query(internal.sourceCaptures.assertActive, {
            preparationId,
            sourceId,
            now,
        }),
    ).rejects.toThrow("source_outside_preparation");
    await t.mutation(internal.sourcePreparation.recordResult, {
        preparationId,
        outcome: {
            sourceId: manualId,
            result: {
                status: "unavailable",
                reasonCode: "missing_configuration",
            },
        },
    });
    const finished = await t.mutation(internal.sourcePreparation.finish, {
        preparationId,
        expectedExecutionGeneration: 4,
    });
    expect(finished.outcome).toBe("blocked");
    expect(await t.run((ctx) => ctx.db.get(runId))).toMatchObject({
        executionStatus: "paused",
        pauseReason: "source_review",
        workflowId: mainHandle,
        sourceQualificationAttemptCount: 17,
    });
    vi.setSystemTime(now + 800_000);
    const resumed = await t
        .withIdentity({ subject: userId })
        .mutation(api.sourcePreparation.startForReview, {
            runId,
            corpusRevisionId,
            expectedProposalId: finished.proposalId,
            requestId: "resume-same-manual-content",
        });
    expect(
        await t.run((ctx) => ctx.db.get(resumed.preparationId)),
    ).toMatchObject({
        manualSourceIds: [manualId],
        deadlineAt: Date.now() + 900_000,
        asOfTime: now,
    });
});

test.each([
    "resume",
    "approve",
] as const)("retains a new manual source during another dossier and honors the subsequent %s decision", async (decision) => {
    vi.useFakeTimers();
    const { t, runId, corpusRevisionId, userId, visitorId, mainHandle } =
        await waitingReview();
    const busyId = await t.run((ctx) =>
        ctx.db.insert("researchRuns", {
            ownerVisitorId: visitorId,
            lifecycleState: "discovering_sources",
            executionStatus: "running",
            executionGeneration: 1,
            nextEventSequence: 0,
            createdAt: Date.now(),
            updatedAt: Date.now(),
        }),
    );
    const owned = t.withIdentity({ subject: userId });
    const manualId = await owned.mutation(
        internal.sources.persistManualCandidate,
        {
            runId,
            corpusRevisionId,
            executionGeneration: 3,
            providerReference: "manual-busy-slot",
            canonicalUrl: "https://www.servicenow.com/manual-while-busy",
            title: "Document retained during other research",
        },
    );
    const queued = await t.run(async (ctx) => {
        const run = await ctx.db.get(runId);
        return {
            run,
            source: await ctx.db.get(manualId),
            revision: await ctx.db.get(corpusRevisionId),
            preparation: run?.sourcePreparationId
                ? await ctx.db.get(run.sourcePreparationId)
                : null,
        };
    });
    expect(queued.source?.canonicalUrl).toBe(
        "https://www.servicenow.com/manual-while-busy",
    );
    expect(queued.run).toMatchObject({
        executionStatus: "paused",
        executionGeneration: 3,
        workflowId: mainHandle,
    });
    expect(queued.preparation).toMatchObject({
        status: "blocked",
        manualSourceIds: [manualId],
        stopCode: "execution_slot_unavailable",
    });
    expect(queued.preparation?.deadlineAt).toBeUndefined();
    if (!queued.revision?.sourceSelectionProposalId)
        throw new Error("Missing updated proposal");
    vi.setSystemTime(Date.now() + 1_800_000);
    await t.run((ctx) =>
        ctx.db.patch(busyId, { executionStatus: "completed" }),
    );
    expect(
        await owned.query(api.sourceSelectionProposals.getCurrent, {
            runId,
            corpusRevisionId,
        }),
    ).toMatchObject({
        effectiveStatus: "ready",
        preparation: { canResume: true },
    });
    if (decision === "approve") {
        await owned.mutation(api.sources.decide, {
            runId,
            corpusRevisionId,
            sourceId: manualId,
            decision: "accepted",
            decisionKey: "include-unread-source-with-limitations",
        });
        const proposalId = queued.revision.sourceSelectionProposalId;
        const proposal = await t.run((ctx) => ctx.db.get(proposalId));
        if (!proposal) throw new Error("Missing proposal");
        await owned.mutation(
            api.sourceSelectionProposals.approveProposedCorpus,
            {
                runId,
                corpusRevisionId,
                proposalId: proposal._id,
                proposalVersion: proposal.version,
                decisionKey: "approve-with-unread-manual-link",
            },
        );
        expect(
            await owned.query(api.sourceSelectionProposals.getCurrent, {
                runId,
                corpusRevisionId,
            }),
        ).toMatchObject({
            revisionStatus: "approved",
            preparation: { canResume: false },
        });
        return;
    }
    const resumed = await owned.mutation(api.sourcePreparation.startForReview, {
        runId,
        corpusRevisionId,
        expectedProposalId: queued.revision.sourceSelectionProposalId,
        requestId: "resume-manual-slot",
    });
    const preparation = await t.run((ctx) => ctx.db.get(resumed.preparationId));
    expect(preparation).toMatchObject({
        manualSourceIds: [manualId],
        status: "started",
        deadlineAt: Date.now() + 900_000,
    });
    expect(
        await t.mutation(internal.sourcePreparation.nextBatch, {
            preparationId: resumed.preparationId,
        }),
    ).toMatchObject({ sourceIds: [manualId], canSupplement: false });
});

test("replays manual intake after automatic preparation advances the generation without another HTTP request", async () => {
    vi.useFakeTimers();
    const { t, runId, corpusRevisionId, userId } = await waitingReview();
    rateLimiterTest.register(t);
    const owned = t.withIdentity({ subject: userId });
    // convex-test accepts concrete references, which are the only references used by this intake path.
    const ctx = {
        runQuery: (
            reference: FunctionReference<"query">,
            args: Record<string, Value>,
        ) => owned.query(reference, args),
        runMutation: (
            reference: FunctionReference<"mutation">,
            args: Record<string, Value>,
        ) => owned.mutation(reference, args),
    } as unknown as Pick<ActionCtx, "runMutation" | "runQuery">;
    const args = {
        authUserId: userId,
        runId,
        corpusRevisionId,
        requestKey: "manual-response-retry",
        url: "https://www.servicenow.com/new-retry-document",
    };
    const inspect = vi.fn(async () => ({
        canonicalUrl: args.url,
        title: "New document",
    }));
    const first = await addManualUrlWithInspector(ctx, args, inspect);
    expect(await t.run((ctx) => ctx.db.get(runId))).toMatchObject({
        executionStatus: "running",
        executionGeneration: 4,
    });
    expect(await addManualUrlWithInspector(ctx, args, inspect)).toEqual(first);
    expect(inspect).toHaveBeenCalledTimes(1);
    const calls = await t.run((ctx) => ctx.db.query("providerCalls").take(3));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
        service: "url_metadata",
        status: "succeeded",
        executionGeneration: 3,
    });
    // Historical references remain replayable after the generation changes too.
    await t.run((ctx) =>
        ctx.db.patch(first.sourceId, {
            providerReference: calls[0]?.operationKey,
        }),
    );
    expect(await addManualUrlWithInspector(ctx, args, inspect)).toEqual(first);
    expect(inspect).toHaveBeenCalledTimes(1);
    await expect(
        t.query(internal.sources.findManualCandidateByProviderReference, {
            runId,
            corpusRevisionId,
            providerReference: calls[0]?.operationKey ?? "missing",
        }),
    ).rejects.toMatchObject({
        data: { code: "not_authenticated", retryable: false },
    });
});

test("the existing legacy rebuild action starts bounded reading without replacing its approval wait or issuing discovery calls", async () => {
    vi.useFakeTimers();
    vi.stubEnv("EXA_API_KEY", "");
    vi.stubEnv("SEC_USER_AGENT", "");
    const { t, runId, corpusRevisionId, userId, proposal, mainHandle } =
        await waitingReview();
    await t.run((ctx) =>
        ctx.db.patch(proposal.proposalId, {
            policyVersion: "legacy-metadata-selection",
        }),
    );
    const request = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", request);
    const owned = t.withIdentity({ subject: userId });
    const args = {
        runId,
        corpusRevisionId,
        expectedProposalId: proposal.proposalId,
    };
    const result = await owned.action(
        api.sourceSelectionProposalActions.rebuild,
        args,
    );
    expect(result.reason).toBe("in_progress");
    expect(
        await owned.action(api.sourceSelectionProposalActions.rebuild, args),
    ).toEqual(result);
    const state = await t.run(async (ctx) => ({
        run: await ctx.db.get(runId),
        preparations: await ctx.db
            .query("sourceSelectionProposalRebuilds")
            .take(3),
        calls: await ctx.db.query("providerCalls").take(3),
    }));
    expect(state.run).toMatchObject({
        executionStatus: "running",
        executionGeneration: 4,
        workflowId: mainHandle,
    });
    expect(state.preparations).toHaveLength(1);
    expect(state.preparations[0]).toMatchObject({
        kind: "preparation",
        entryPoint: "source_review",
    });
    expect(state.calls).toHaveLength(0);
    expect(request).not.toHaveBeenCalled();
});

test("manual intake also prepares only the new content in a legacy draft", async () => {
    vi.useFakeTimers();
    const { t, runId, corpusRevisionId, userId, proposal, sourceId } =
        await waitingReview();
    await t.run((ctx) =>
        ctx.db.patch(proposal.proposalId, {
            policyVersion: "legacy-metadata-selection",
        }),
    );
    const manualId = await t
        .withIdentity({ subject: userId })
        .mutation(internal.sources.persistManualCandidate, {
            runId,
            corpusRevisionId,
            executionGeneration: 3,
            providerReference: "manual-legacy-draft",
            canonicalUrl: "https://www.servicenow.com/new-legacy-document",
            title: "New legacy-draft document",
        });
    const run = await t.run((ctx) => ctx.db.get(runId));
    expect(run).toMatchObject({
        executionStatus: "running",
        executionGeneration: 4,
    });
    if (!run?.sourcePreparationId) throw new Error("Missing preparation");
    const batch = await t.mutation(internal.sourcePreparation.nextBatch, {
        preparationId: run.sourcePreparationId,
    });
    expect(batch.sourceIds).toEqual([manualId]);
    expect(batch.sourceIds).not.toContain(sourceId);
    expect(batch.canSupplement).toBe(false);
});

test("several new links retained during another dossier are all read on continuation without reopening older content", async () => {
    vi.useFakeTimers();
    const { t, runId, corpusRevisionId, userId, visitorId, sourceId } =
        await waitingReview();
    const busyId = await t.run((ctx) =>
        ctx.db.insert("researchRuns", {
            ownerVisitorId: visitorId,
            lifecycleState: "discovering_sources",
            executionStatus: "running",
            executionGeneration: 1,
            nextEventSequence: 0,
            createdAt: Date.now(),
            updatedAt: Date.now(),
        }),
    );
    const owned = t.withIdentity({ subject: userId });
    const added = [];
    for (const suffix of ["one", "two"])
        added.push(
            await owned.mutation(internal.sources.persistManualCandidate, {
                runId,
                corpusRevisionId,
                executionGeneration: 3,
                providerReference: `manual-queued-${suffix}`,
                canonicalUrl: `https://www.servicenow.com/queued-${suffix}`,
                title: `Queued document ${suffix}`,
            }),
        );
    await t.run((ctx) =>
        ctx.db.patch(busyId, { executionStatus: "completed" }),
    );
    const revision = await t.run((ctx) => ctx.db.get(corpusRevisionId));
    if (!revision?.sourceSelectionProposalId)
        throw new Error("Missing proposal");
    const resumed = await owned.mutation(api.sourcePreparation.startForReview, {
        runId,
        corpusRevisionId,
        expectedProposalId: revision.sourceSelectionProposalId,
        requestId: "continue-queued-links",
    });
    const batch = await t.mutation(internal.sourcePreparation.nextBatch, {
        preparationId: resumed.preparationId,
    });
    expect(batch.sourceIds).toEqual(added);
    expect(batch.sourceIds).not.toContain(sourceId);
    expect(batch.canSupplement).toBe(false);
});

test.each([
    "dossier",
    "legacy_operation",
])("explicit recovery after expiry retains the %s allowance and claims one bounded execution", async (counterOwner) => {
    vi.useFakeTimers();
    const { t, runId, corpusRevisionId, userId, proposal } =
        await waitingReview();
    const owned = t.withIdentity({ subject: userId });
    const started = await owned.mutation(api.sourcePreparation.startForReview, {
        runId,
        corpusRevisionId,
        expectedProposalId: proposal.proposalId,
        requestId: "expire-original",
    });
    const previous = await t.run(async (ctx) => {
        const preparation = await ctx.db.get(started.preparationId);
        await ctx.db.patch(started.preparationId, {
            status: "blocked",
            stopCode: "missing_configuration",
            modelAttemptCount: counterOwner === "legacy_operation" ? 19 : 0,
        });
        await ctx.db.patch(runId, {
            executionStatus: "paused",
            pauseReason: "source_review",
            sourceQualificationAttemptCount:
                counterOwner === "dossier" ? 19 : undefined,
            sourcePreparationBudget: undefined,
        });
        return preparation;
    });
    vi.setSystemTime((previous?.deadlineAt ?? Date.now()) + 1);
    expect(
        (
            await owned.query(api.sourceSelectionProposals.getCurrent, {
                runId,
                corpusRevisionId,
            })
        )?.preparationAction,
    ).toMatchObject({ kind: "resume", available: true });
    expect(previous?.modelLimits).toEqual({ work: 120, incidents: 40 });
    vi.stubEnv("SOURCE_PREPARATION_WORK_LIMIT", "140");
    vi.stubEnv("SOURCE_PREPARATION_INCIDENT_LIMIT", "50");
    const args = {
        runId,
        corpusRevisionId,
        expectedProposalId: proposal.proposalId,
        requestId: "expire-retry",
    };
    const resumed = await owned.mutation(
        api.sourcePreparation.startForReview,
        args,
    );
    expect(
        await owned.mutation(api.sourcePreparation.startForReview, args),
    ).toEqual(resumed);
    expect(
        await t.run((ctx) => ctx.db.get(resumed.preparationId)),
    ).toMatchObject({
        deadlineAt: Date.now() + 15 * 60_000,
        modelLimits: { work: 140, incidents: 50 },
        asOfTime: previous?.asOfTime,
        executionGeneration: (previous?.executionGeneration ?? 0) + 1,
    });
    expect(await t.run((ctx) => ctx.db.get(runId))).toMatchObject({
        executionStatus: "running",
        sourcePreparationId: resumed.preparationId,
        sourceQualificationAttemptCount: 19,
    });
    expect(await t.run((ctx) => ctx.db.query("providerCalls").take(1))).toEqual(
        [],
    );
});

test("an expired started review is fenced before recovery without cancelling the approval workflow", async () => {
    vi.useFakeTimers();
    const { t, runId, corpusRevisionId, userId, proposal, mainHandle } =
        await waitingReview();
    const owned = t.withIdentity({ subject: userId });
    const initial = await owned.mutation(api.sourcePreparation.startForReview, {
        runId,
        corpusRevisionId,
        expectedProposalId: proposal.proposalId,
        requestId: "stalled-review",
    });
    const preparation = await t.run((ctx) => ctx.db.get(initial.preparationId));
    vi.setSystemTime((preparation?.deadlineAt ?? Date.now()) + 1);
    expect(
        (
            await owned.query(api.sourceSelectionProposals.getCurrent, {
                runId,
                corpusRevisionId,
            })
        )?.preparationAction,
    ).toMatchObject({ available: true });
    const resumed = await owned.mutation(api.sourcePreparation.startForReview, {
        runId,
        corpusRevisionId,
        expectedProposalId: proposal.proposalId,
        requestId: "recover-stalled-review",
    });
    expect(resumed.preparationId).not.toBe(initial.preparationId);
    expect(await t.run((ctx) => ctx.db.get(runId))).toMatchObject({
        workflowId: mainHandle,
        executionGeneration: (preparation?.executionGeneration ?? 0) + 1,
        executionStatus: "running",
    });
    await expect(
        t.query(internal.sourcePreparation.getForExecution, {
            preparationId: initial.preparationId,
            now: Date.now(),
        }),
    ).rejects.toThrow("stale_execution");
});
