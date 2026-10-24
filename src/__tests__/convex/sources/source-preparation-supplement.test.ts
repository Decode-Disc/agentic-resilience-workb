import { api, internal } from "@convex/_generated/api";
import { afterEach, expect, test, vi } from "vitest";
import workflowTest from "@/__tests__/convex/workflows/workflow-test-register.js";

import { seedSourcePreparation } from "@/__tests__/setup/source-preparation";

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
});

test("a restored supplemental search closes its real attempt without rewriting a historical pre-dispatch block", async () => {
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
                reasonCode: "content_not_available",
            },
        },
    });
    const first = await t.mutation(
        internal.sourcePreparation.reserveNextSupplementSearch,
        { preparationId },
    );
    if (!first) throw Error("Missing search reservation");
    await t.run(async (ctx) => {
        await ctx.db.patch(first.providerCallId, {
            inputHash: undefined,
            status: "failed",
            errorCode: "paid_work_disabled",
            completedAt: Date.now(),
        });
        await ctx.db.patch(preparationId, {
            supplementClaimedQueryIndexes: [],
        });
    });
    const restored = await t.mutation(
        internal.sourcePreparation.reserveNextSupplementSearch,
        { preparationId },
    );
    expect(restored?.shouldExecute).toBe(true);
    if (!restored) throw Error("Missing restored search");
    await t.mutation(internal.providerCalls.recordAttempt, {
        runId,
        corpusRevisionId,
        preparationId,
        executionGeneration: 3,
        workflowVersion: 1,
        stepKey: "source_preparation",
        service: "exa",
        operation: "source_supplement_search",
        operationKey: restored.operationKey,
        attempt: 1,
        status: "failed",
        errorCode: "http_503",
        httpStatus: 503,
        dispatchOutcome: "response_received",
    });
    const receipts = await t.run(async (ctx) => ({
        historical: await ctx.db.get(first.providerCallId),
        actual: await ctx.db.get(restored.providerCallId),
    }));
    expect(receipts.historical).toMatchObject({
        status: "failed",
        errorCode: "paid_work_disabled",
    });
    expect(receipts.actual).toMatchObject({
        status: "failed",
        errorCode: "http_503",
        dispatchOutcome: "response_received",
    });
});

test.each([
    "cooldown",
    "unknown",
    "terminal",
])("targeted search preserves a %s failure instead of reporting empty completion", async (failure) => {
    vi.useFakeTimers();
    const { t, runId, corpusRevisionId, sourceId, userId } =
        await seedSourcePreparation();
    workflowTest.register(t);
    vi.stubEnv("SOURCE_QUALIFICATION_ENABLED", "true");
    vi.stubEnv("EXA_API_KEY", "test-only-key");
    const initial = await t.mutation(
        internal.sourcePreparation.claimForDiscovery,
        { runId, corpusRevisionId, expectedExecutionGeneration: 3 },
    );
    await t.mutation(internal.sourcePreparation.recordResult, {
        preparationId: initial,
        outcome: {
            sourceId,
            result: {
                status: "unavailable",
                reasonCode: "content_not_available",
            },
        },
    });
    const proposal = await t.mutation(internal.sourcePreparation.finish, {
        preparationId: initial,
        expectedExecutionGeneration: 3,
    });
    await t.run((ctx) =>
        ctx.db.patch(runId, {
            lifecycleState: "awaiting_source_review",
            executionStatus: "paused",
            pauseReason: "source_review",
        }),
    );
    const target = {
        kind: "coverage" as const,
        role: "official_commercial_pricing" as const,
    };
    const owned = t.withIdentity({ subject: userId });
    const first = await owned.mutation(api.sourcePreparation.startForReview, {
        runId,
        corpusRevisionId,
        expectedProposalId: proposal.proposalId,
        requestId: "long-cooldown-first",
        target,
    });
    const reservation = await t.mutation(
        internal.sourcePreparation.reserveNextSupplementSearch,
        { preparationId: first.preparationId },
    );
    if (!reservation) throw Error("Missing search reservation");
    const retryAt = failure === "cooldown" ? Date.now() + 90_000 : undefined;
    await t.mutation(internal.providerCalls.recordAttempt, {
        runId,
        corpusRevisionId,
        preparationId: first.preparationId,
        executionGeneration: 4,
        workflowVersion: 1,
        stepKey: "source_preparation",
        service: "exa",
        operation: "source_supplement_search",
        operationKey: reservation.operationKey,
        attempt: 1,
        status: "failed",
        errorCode:
            failure === "unknown"
                ? "request_timeout"
                : failure === "terminal"
                  ? "http_403"
                  : "http_429",
        dispatchOutcome:
            failure === "unknown" ? "unknown" : "response_received",
        httpStatus:
            failure === "unknown"
                ? undefined
                : failure === "terminal"
                  ? 403
                  : 429,
        retryAfterAt: retryAt,
    });
    const failed = await t.mutation(internal.sourcePreparation.finish, {
        preparationId: first.preparationId,
        expectedExecutionGeneration: 4,
        stopCode: "transport_unavailable",
        retryAt,
    });
    vi.setSystemTime(Date.now() + 15_001);
    if (failure === "cooldown")
        await expect(
            owned.mutation(api.sourcePreparation.startForReview, {
                runId,
                corpusRevisionId,
                expectedProposalId: failed.proposalId,
                requestId: "current-cooldown",
                target,
            }),
        ).rejects.toThrow("search_cooldown");
    await t.run((ctx) =>
        ctx.db.patch(first.preparationId, { leaseExpiresAt: Date.now() - 1 }),
    );
    const retry = await owned.mutation(api.sourcePreparation.startForReview, {
        runId,
        corpusRevisionId,
        expectedProposalId: failed.proposalId,
        requestId: "long-cooldown-retry",
        target,
    });
    const searched = await t.action(
        internal.sourcePreparationActions.searchSupplement,
        { preparationId: retry.preparationId },
    );
    expect(searched).toMatchObject({
        status: "blocked",
        reasonCode:
            failure === "terminal"
                ? "request_invalid"
                : "transport_unavailable",
        ...(retryAt ? { retryAt } : {}),
    });
    if (searched.status !== "blocked") throw Error("Search must stay blocked");
    const finished = await t.mutation(internal.sourcePreparation.finish, {
        preparationId: retry.preparationId,
        expectedExecutionGeneration: 5,
        stopCode: searched.reasonCode,
        retryAt: searched.retryAt,
    });
    expect(finished.outcome).toBe("blocked");
    expect(
        (
            await owned.query(api.sourceSelectionProposals.getCurrent, {
                runId,
                corpusRevisionId,
            })
        )?.recovery,
    ).toMatchObject({
        status: "blocked",
        leaseExpiresAt: retryAt ?? Date.now() + 15_000,
    });
    expect(
        await t.run((ctx) => ctx.db.query("providerCalls").take(3)),
    ).toHaveLength(1);
    await expect(
        owned.mutation(api.sourcePreparation.startForReview, {
            runId,
            corpusRevisionId,
            expectedProposalId: finished.proposalId,
            requestId: "still-cooling",
            target,
        }),
    ).rejects.toThrow("search_cooldown");
    vi.setSystemTime((retryAt ?? Date.now() + 15_000) + 1);
    const allowed = await owned.mutation(api.sourcePreparation.startForReview, {
        runId,
        corpusRevisionId,
        expectedProposalId: finished.proposalId,
        requestId: "cooldown-finished",
        target,
    });
    expect(
        await t.mutation(
            internal.sourcePreparation.reserveNextSupplementSearch,
            { preparationId: allowed.preparationId },
        ),
    ).toMatchObject(
        failure === "cooldown"
            ? { shouldExecute: true, attempt: 2 }
            : {
                  shouldExecute: false,
                  reasonCode:
                      failure === "terminal"
                          ? "request_invalid"
                          : "transport_unavailable",
              },
    );
});

test("targeted recovery can select the second eligible failure within the three-call limit", async () => {
    vi.useFakeTimers();
    vi.stubEnv("SOURCE_QUALIFICATION_ENABLED", "true");
    const { t, runId, corpusRevisionId, sourceId, userId } =
        await seedSourcePreparation();
    workflowTest.register(t);
    const owned = t.withIdentity({ subject: userId });
    const initial = await t.mutation(
        internal.sourcePreparation.claimForDiscovery,
        { runId, corpusRevisionId, expectedExecutionGeneration: 3 },
    );
    await t.mutation(internal.sourcePreparation.recordResult, {
        preparationId: initial,
        outcome: {
            sourceId,
            result: {
                status: "unavailable",
                reasonCode: "content_not_available",
            },
        },
    });
    let proposal = await t.mutation(internal.sourcePreparation.finish, {
        preparationId: initial,
        expectedExecutionGeneration: 3,
    });
    await t.run((ctx) =>
        ctx.db.patch(runId, {
            lifecycleState: "awaiting_source_review",
            executionStatus: "paused",
            pauseReason: "source_review",
        }),
    );
    const targets = [
        {
            kind: "coverage" as const,
            role: "official_product_platform" as const,
        },
        {
            kind: "coverage" as const,
            role: "official_commercial_pricing" as const,
        },
    ];
    const failures = [];
    for (const [index, target] of targets.entries()) {
        const operation = await owned.mutation(
            api.sourcePreparation.startForReview,
            {
                runId,
                corpusRevisionId,
                expectedProposalId: proposal.proposalId,
                requestId: `failed-query-${index}`,
                target,
            },
        );
        const search = await t.mutation(
            internal.sourcePreparation.reserveNextSupplementSearch,
            { preparationId: operation.preparationId },
        );
        if (!search) throw Error("Missing targeted search");
        failures.push(search);
        await t.mutation(internal.providerCalls.recordAttempt, {
            runId,
            corpusRevisionId,
            preparationId: operation.preparationId,
            executionGeneration: 4 + index,
            workflowVersion: 1,
            stepKey: "source_preparation",
            service: "exa",
            operation: "source_supplement_search",
            operationKey: search.operationKey,
            attempt: 1,
            status: "failed",
            errorCode: "http_503",
            httpStatus: 503,
            dispatchOutcome: "response_received",
        });
        proposal = await t.mutation(internal.sourcePreparation.finish, {
            preparationId: operation.preparationId,
            expectedExecutionGeneration: 4 + index,
            stopCode: "transport_unavailable",
        });
        vi.setSystemTime(Date.now() + 15_001);
    }
    const target = targets[1];
    if (!target) throw Error("Missing second target");
    const resumed = await owned.mutation(api.sourcePreparation.startForReview, {
        runId,
        corpusRevisionId,
        expectedProposalId: proposal.proposalId,
        requestId: "retry-second-query",
        target,
    });
    const retry = await t.mutation(
        internal.sourcePreparation.reserveNextSupplementSearch,
        { preparationId: resumed.preparationId },
    );
    expect(retry).toMatchObject({
        query: failures[1]?.query,
        shouldExecute: true,
        attempt: 2,
    });
    expect(
        await t.run((ctx) => ctx.db.query("providerCalls").take(4)),
    ).toHaveLength(3);
    expect(
        await t.mutation(
            internal.sourcePreparation.reserveNextSupplementSearch,
            { preparationId: resumed.preparationId },
        ),
    ).toBeNull();
});

test("reserves one immutable three-query supplement only after existing candidates have been inspected", async () => {
    const { t, runId, corpusRevisionId, sourceId, companyId } =
        await seedSourcePreparation();
    const preparationId = await t.mutation(
        internal.sourcePreparation.claimForDiscovery,
        {
            runId,
            corpusRevisionId,
            expectedExecutionGeneration: 3,
        },
    );
    await expect(
        t.mutation(internal.sourcePreparation.reserveSupplementPlan, {
            preparationId,
        }),
    ).rejects.toThrow("preparation_unfinished");
    expect(
        (await t.run((ctx) => ctx.db.get(runId)))
            ?.automaticSupplementOperationId,
    ).toBeUndefined();
    await t.mutation(internal.sourcePreparation.recordResult, {
        preparationId,
        outcome: {
            sourceId,
            result: {
                status: "unavailable",
                reasonCode: "content_not_available",
            },
        },
    });
    const plan = await t.mutation(
        internal.sourcePreparation.reserveSupplementPlan,
        { preparationId },
    );
    if (!plan) throw new Error("Expected supplemental search plan");
    expect(plan.queries).toHaveLength(3);
    expect(new Set(plan.queries.map((q) => q.query)).size).toBe(3);
    expect(
        (await t.run((ctx) => ctx.db.get(runId)))
            ?.automaticSupplementOperationId,
    ).toBe(plan.supplementOperationId);
    await t.run((ctx) =>
        ctx.db.patch(companyId, {
            legalName: "Updated metadata must not rewrite a reserved search",
        }),
    );
    expect(
        await t.mutation(internal.sourcePreparation.reserveSupplementPlan, {
            preparationId,
        }),
    ).toEqual(plan);
});

test.each([
    "missing_configuration",
    "paid_work_disabled",
])("shared %s prevents supplemental search planning", async (reasonCode) => {
    const { t, runId, corpusRevisionId, sourceId } =
        await seedSourcePreparation();
    const preparationId = await t.mutation(
        internal.sourcePreparation.claimForDiscovery,
        {
            runId,
            corpusRevisionId,
            expectedExecutionGeneration: 3,
        },
    );
    await t.mutation(internal.sourcePreparation.recordResult, {
        preparationId,
        outcome: { sourceId, result: { status: "unavailable", reasonCode } },
    });
    expect(
        await t.mutation(internal.sourcePreparation.reserveSupplementPlan, {
            preparationId,
        }),
    ).toBeNull();
    expect(
        (await t.run((ctx) => ctx.db.get(runId)))
            ?.automaticSupplementOperationId,
    ).toBeUndefined();
});

test("a supplement reserves at most three external attempts and a new generation cannot reset them", async () => {
    vi.useFakeTimers();
    const { t, runId, corpusRevisionId, sourceId } =
        await seedSourcePreparation();
    const preparationId = await t.mutation(
        internal.sourcePreparation.claimForDiscovery,
        {
            runId,
            corpusRevisionId,
            expectedExecutionGeneration: 3,
        },
    );
    await t.mutation(internal.sourcePreparation.recordResult, {
        preparationId,
        outcome: {
            sourceId,
            result: {
                status: "unavailable",
                reasonCode: "content_not_available",
            },
        },
    });
    const plan = await t.mutation(
        internal.sourcePreparation.reserveSupplementPlan,
        { preparationId },
    );
    if (!plan) throw new Error("Missing supplement plan");
    const calls = [];
    for (let i = 0; i < 3; i++) {
        const reserved = await t.mutation(
            internal.sourcePreparation.reserveNextSupplementSearch,
            { preparationId },
        );
        expect(reserved?.query).toEqual(plan.queries[i]);
        expect(reserved?.shouldExecute).toBe(true);
        calls.push(reserved);
    }
    expect(
        await t.mutation(
            internal.sourcePreparation.reserveNextSupplementSearch,
            { preparationId },
        ),
    ).toBeNull();
    const firstPreparation = await t.run((ctx) => ctx.db.get(preparationId));
    vi.setSystemTime(Date.now() + 60_000);
    await t.run((ctx) => ctx.db.patch(runId, { executionGeneration: 4 }));
    const resumedId = await t.mutation(
        internal.sourcePreparation.claimForDiscovery,
        {
            runId,
            corpusRevisionId,
            expectedExecutionGeneration: 4,
        },
    );
    expect((await t.run((ctx) => ctx.db.get(resumedId)))?.deadlineAt).toBe(
        firstPreparation?.deadlineAt,
    );
    await t.mutation(internal.sourcePreparation.recordResult, {
        preparationId: resumedId,
        outcome: {
            sourceId,
            result: {
                status: "unavailable",
                reasonCode: "content_not_available",
            },
        },
    });
    expect(
        await t.mutation(
            internal.sourcePreparation.reserveNextSupplementSearch,
            { preparationId: resumedId },
        ),
    ).toBeNull();
    expect(
        await t.run((ctx) => ctx.db.query("providerCalls").take(4)),
    ).toHaveLength(3);
    expect(new Set(calls.map((c) => c?.providerCallId)).size).toBe(3);
});

test("the three supplement results add at most four candidates each and preserve the original forty-eight", async () => {
    const { t, runId, corpusRevisionId, sourceId } =
        await seedSourcePreparation();
    const preparationId = await t.mutation(
        internal.sourcePreparation.claimForDiscovery,
        {
            runId,
            corpusRevisionId,
            expectedExecutionGeneration: 3,
        },
    );
    await t.run(async (ctx) => {
        const sourceIds = [sourceId];
        for (let i = 1; i < 48; i++)
            sourceIds.push(
                await ctx.db.insert("sources", {
                    runId,
                    canonicalUrl: `https://example.com/existing-${i}`,
                    title: `Existing ${i}`,
                    origin: "exa",
                    category: "official_product",
                    createdAt: 1,
                }),
            );
        await ctx.db.patch(preparationId, {
            sourceOutcomes: sourceIds.map((sourceId) => ({
                sourceId,
                result: {
                    status: "unavailable" as const,
                    reasonCode: "not_available",
                },
            })),
        });
    });
    for (let index = 0; index < 3; index++) {
        const reservation = await t.mutation(
            internal.sourcePreparation.reserveNextSupplementSearch,
            { preparationId },
        );
        if (!reservation) throw new Error("Missing bounded search reservation");
        const candidates = Array.from({ length: 4 }, (_, i) => ({
            canonicalUrl: `https://example.com/additional-${index}-${i}`,
            title: `Additional ${index}-${i}`,
            origin: "exa" as const,
            category: reservation.query.discoveryIntent ?? "official_product",
        }));
        await t.mutation(internal.sourceDiscovery.persistCandidates, {
            runId,
            corpusRevisionId,
            preparationId,
            executionGeneration: 3,
            operationKey: reservation.operationKey,
            candidates,
            providerCompletion: {
                providerCallId: reservation.providerCallId,
                status: "succeeded",
                latencyMs: 1,
                accepted: 4,
                rejected: 0,
            },
        });
        if (index < 2)
            await expect(
                t.mutation(
                    internal.sourcePreparation.reserveNextSupplementSearch,
                    { preparationId },
                ),
            ).rejects.toThrow("preparation_unfinished");
        const added = await t.run((ctx) =>
            ctx.db
                .query("sources")
                .withIndex("by_run_and_url", (q) => q.eq("runId", runId))
                .take(61),
        );
        for (const source of added.filter((source) =>
            candidates.some((c) => c.canonicalUrl === source.canonicalUrl),
        ))
            await t.mutation(internal.sourcePreparation.recordResult, {
                preparationId,
                outcome: {
                    sourceId: source._id,
                    result: {
                        status: "unavailable",
                        reasonCode: "not_available",
                    },
                },
            });
    }
    expect(
        await t.mutation(
            internal.sourcePreparation.reserveNextSupplementSearch,
            { preparationId },
        ),
    ).toBeNull();
    const state = await t.run(async (ctx) => ({
        sources: await ctx.db.query("sources").take(61),
        calls: await ctx.db.query("providerCalls").take(4),
        original: await ctx.db.get(sourceId),
    }));
    expect(state.sources).toHaveLength(60);
    expect(state.original).not.toBeNull();
    expect(state.calls).toHaveLength(3);
    expect(state.calls.every((c) => c.status === "succeeded")).toBe(true);
});

test("a search result exceeding four candidates is rejected atomically", async () => {
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
            result: { status: "unavailable", reasonCode: "not_available" },
        },
    });
    const reservation = await t.mutation(
        internal.sourcePreparation.reserveNextSupplementSearch,
        { preparationId },
    );
    if (!reservation) throw new Error("Missing bounded search");
    await expect(
        t.mutation(internal.sourceDiscovery.persistCandidates, {
            runId,
            corpusRevisionId,
            preparationId,
            executionGeneration: 3,
            operationKey: "over-bound",
            candidates: Array.from({ length: 5 }, (_, i) => ({
                canonicalUrl: `https://example.com/over-${i}`,
                title: "Unexpected fifth result",
                origin: "exa" as const,
                category: "official_product",
            })),
            providerCompletion: {
                providerCallId: reservation.providerCallId,
                status: "succeeded",
                latencyMs: 1,
                accepted: 5,
                rejected: 0,
            },
        }),
    ).rejects.toThrow("supplement_result_invalid");
    expect(await t.run((ctx) => ctx.db.query("sources").take(7))).toHaveLength(
        1,
    );
    expect(
        (await t.run((ctx) => ctx.db.get(reservation.providerCallId)))?.status,
    ).toBe("started");
});

test.each([
    "succeeded",
    "partial",
] as const)("mixed discovery recovery clears only fully successful families (%s) without resetting the shared budget", async (status) => {
    const { t, runId, corpusRevisionId } = await seedSourcePreparation();
    let preparationId = await t.mutation(
        internal.sourcePreparation.claimForDiscovery,
        { runId, corpusRevisionId, expectedExecutionGeneration: 3 },
    );
    await t.run(async (ctx) => {
        await ctx.db.patch(preparationId, {
            entryPoint: "targeted_search",
            target: { kind: "failed_discovery" },
            readingSourceIds: [],
            failedDiscoveryFamilies: ["regulatory", "official_product"],
        });
        await ctx.db.patch(runId, { lifecycleState: "awaiting_source_review" });
    });
    const initial = await t.run((ctx) => ctx.db.get(preparationId));
    const reservedFamilies: string[] = [];
    for (let attempt = 0; attempt < 2; attempt++) {
        const reservation = await t.mutation(
            internal.sourcePreparation.reserveNextSupplementSearch,
            { preparationId },
        );
        if (!reservation?.shouldExecute)
            throw new Error("Missing search lease");
        reservedFamilies.push(reservation.query.discoveryIntent ?? "");
        await t.mutation(internal.sourceDiscovery.persistCandidates, {
            runId,
            corpusRevisionId,
            preparationId,
            executionGeneration: 3,
            operationKey: reservation.operationKey,
            candidates: [],
            providerCompletion: {
                providerCallId: reservation.providerCallId,
                status,
                latencyMs: 1,
                accepted: 0,
                rejected: status === "partial" ? 1 : 0,
            },
        });
        const finished = await t.mutation(internal.sourcePreparation.finish, {
            preparationId,
            expectedExecutionGeneration: 3,
        });
        const proposal = await t.run((ctx) => ctx.db.get(finished.proposalId));
        if (attempt === 0) {
            preparationId = await t.run(async (ctx) => {
                const previous = await ctx.db.get(preparationId);
                if (!previous) throw new Error("Missing preparation");
                const { _id, _creationTime, ...fields } = previous;
                const next = await ctx.db.insert(
                    "sourceSelectionProposalRebuilds",
                    {
                        ...fields,
                        status: "started",
                        operationKey: "second-recovery",
                        insertedCount: undefined,
                        failedDiscoveryFamilies:
                            proposal?.failedDiscoveryFamilies ?? [],
                        createdAt: previous.createdAt + 1,
                    },
                );
                await ctx.db.patch(runId, {
                    sourcePreparationId: next,
                    executionStatus: "running",
                });
                return next;
            });
        } else
            expect(proposal?.failedDiscoveryFamilies).toEqual(
                status === "succeeded"
                    ? []
                    : ["regulatory", "official_product"],
            );
    }
    expect(reservedFamilies).toEqual(["regulatory", "official_product"]);
    const current = await t.run((ctx) => ctx.db.get(preparationId));
    expect(current?.deadlineAt).toBe(initial?.deadlineAt);
    const ledger = await t.run(async (ctx) => {
        const run = await ctx.db.get(runId);
        return run?.automaticSupplementOperationId
            ? ctx.db.get(run.automaticSupplementOperationId)
            : null;
    });
    expect(ledger?.supplementClaimedQueryIndexes).toEqual([0, 1]);
});

test.each([
    "current",
    "legacy",
])("explicit search recovery consumes a remaining call for the same failed %s query", async (receiptFormat) => {
    vi.useFakeTimers();
    const { api } = await import("@convex/_generated/api");
    const { default: workflowTest } = await import(
        "@/__tests__/convex/workflows/workflow-test-register.js"
    );
    const { t, runId, corpusRevisionId, sourceId, userId } =
        await seedSourcePreparation();
    workflowTest.register(t);
    vi.stubEnv("SOURCE_QUALIFICATION_ENABLED", "true");
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
                reasonCode: "content_not_available",
            },
        },
    });
    const first = await t.mutation(
        internal.sourcePreparation.reserveNextSupplementSearch,
        { preparationId },
    );
    if (!first) throw new Error("Missing search reservation");
    await t.mutation(internal.providerCalls.recordAttempt, {
        runId,
        corpusRevisionId,
        preparationId,
        executionGeneration: 3,
        workflowVersion: 1,
        stepKey: "source_preparation",
        service: "exa",
        operation: "source_supplement_search",
        operationKey: first.operationKey,
        attempt: 1,
        status: "failed",
        errorCode: "http_503",
    });
    const completed = await t.mutation(internal.sourcePreparation.finish, {
        preparationId,
        expectedExecutionGeneration: 3,
    });
    if (receiptFormat === "legacy")
        await t.run((ctx) =>
            ctx.db.patch(first.providerCallId, {
                inputHash: undefined,
                dispatchOutcome: undefined,
                httpStatus: undefined,
            }),
        );
    await t.run((ctx) =>
        ctx.db.patch(runId, {
            lifecycleState: "awaiting_source_review",
            executionStatus: "paused",
            pauseReason: "source_review",
        }),
    );
    vi.setSystemTime(Date.now() + 15_001);
    const resumed = await t
        .withIdentity({ subject: userId })
        .mutation(api.sourcePreparation.startForReview, {
            runId,
            corpusRevisionId,
            expectedProposalId: completed.proposalId,
            requestId: "resume-failed-search",
        });
    expect(resumed.status).toBe("started");
    const retry = await t.mutation(
        internal.sourcePreparation.reserveNextSupplementSearch,
        { preparationId: resumed.preparationId },
    );
    expect(retry?.query).toEqual(first.query);
    expect(retry?.providerCallId).not.toBe(first.providerCallId);
    if (!retry) throw new Error("Missing retry reservation");
    await t.mutation(internal.sourceDiscovery.persistCandidates, {
        runId,
        corpusRevisionId,
        preparationId: resumed.preparationId,
        executionGeneration: 4,
        operationKey: retry.operationKey,
        candidates: [],
        providerCompletion: {
            providerCallId: retry.providerCallId,
            status: "succeeded",
            latencyMs: 1,
            accepted: 0,
            rejected: 0,
        },
    });
    const last = await t.mutation(
        internal.sourcePreparation.reserveNextSupplementSearch,
        { preparationId: resumed.preparationId },
    );
    expect(last?.query).not.toEqual(first.query);
    expect(
        await t.mutation(
            internal.sourcePreparation.reserveNextSupplementSearch,
            { preparationId: resumed.preparationId },
        ),
    ).toBeNull();
    expect(
        await t.run((ctx) => ctx.db.query("providerCalls").take(5)),
    ).toHaveLength(3);
    vi.unstubAllEnvs();
});
