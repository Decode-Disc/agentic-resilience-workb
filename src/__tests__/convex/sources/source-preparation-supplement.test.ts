import { internal } from "@convex/_generated/api";
import { afterEach, expect, test, vi } from "vitest";

import { seedSourcePreparation } from "@/__tests__/setup/source-preparation";

afterEach(() => vi.useRealTimers());

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
            operationKey: `supplement-query-${index}`,
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
    expect(reservedFamilies).toEqual(
        status === "succeeded"
            ? ["regulatory", "official_product"]
            : ["regulatory", "regulatory"],
    );
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
