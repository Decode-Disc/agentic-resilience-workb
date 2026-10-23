/// <reference types="vite/client" />

import { api, internal } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import schema from "@convex/schema";
import type { WorkflowId } from "@convex-dev/workflow";
import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import rateLimiterTest from "../integrations/rate-limiter-test-register.js";
import workflowTest from "../workflows/workflow-test-register.js";

const modules = import.meta.glob("/convex/**/*.ts");
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const startPhase5 = makeFunctionReference<
    "mutation",
    { runId: Id<"researchRuns">; requestKey: string },
    { acceptedSourceCount: number; executionGeneration: number }
>("evidenceExecution:start");

const getRun = makeFunctionReference<
    "query",
    { runId: Id<"researchRuns"> },
    unknown
>("researchRuns:get");

test.each([
    ["corpus_approved", "idle", true],
    ["extracting_evidence", "running", false],
    ["extracting_evidence", "paused", false],
    ["evidence_ready", "idle", false],
] as const)("projects source revision availability at %s / %s", async (lifecycleState, executionStatus, available) => {
    const t = convexTest(schema, modules);
    const scenario = await createApprovedCorpusScenario(t);
    await t.run((ctx) =>
        ctx.db.patch(scenario.runId, { lifecycleState, executionStatus }),
    );
    expect(
        await scenario.asOwner.query(api.researchRuns.getMine, {
            runId: scenario.runId,
        }),
    ).toMatchObject({ canStartNewCorpusRevision: available });
});

async function createApprovedCorpusScenario(
    t: ReturnType<typeof convexTest>,
    options: {
        sources?: Array<{
            url: string;
            title: string;
            origin?: string;
            decisions: Array<"accepted" | "rejected" | "pending">;
        }>;
        lifecycleState?:
            | "corpus_approved"
            | "awaiting_source_review"
            | "draft"
            | "extracting_evidence";
        executionStatus?: "idle" | "running" | "paused";
        revisionStatus?: "approved" | "draft";
        workflowId?: string;
    } = {},
) {
    const data = await t.run(async (ctx) => {
        const userId = await ctx.db.insert("users", { isAnonymous: true });
        const otherUserId = await ctx.db.insert("users", { isAnonymous: true });
        const invitationId = await ctx.db.insert("invitations", {
            slotKey: "analyst-phase-5",
            role: "analyst",
            codeDigest: "digest-1",
            status: "claimed",
            createdAt: 100,
        });
        const otherInvitationId = await ctx.db.insert("invitations", {
            slotKey: "analyst-phase-5-other",
            role: "analyst",
            codeDigest: "digest-2",
            status: "claimed",
            createdAt: 100,
        });
        const visitorId = await ctx.db.insert("visitors", {
            authUserId: userId,
            invitationId,
            role: "analyst",
            status: "active",
            analysesReserved: 1,
            admittedAt: 100,
        });
        const otherVisitorId = await ctx.db.insert("visitors", {
            authUserId: otherUserId,
            invitationId: otherInvitationId,
            role: "analyst",
            status: "active",
            analysesReserved: 1,
            admittedAt: 100,
        });

        const companyId = await ctx.db.insert("companies", {
            cik: "1818201",
            legalName: "CCC Intelligent Solutions Holdings Inc.",
            ticker: "CCCS",
            exchange: "NASDAQ",
            canonicalizedAt: 100,
        });

        const runId = await ctx.db.insert("researchRuns", {
            ownerVisitorId: visitorId,
            companyId,
            coveragePreset: "balanced",
            lifecycleState: options.lifecycleState ?? "corpus_approved",
            executionStatus: options.executionStatus ?? "idle",
            executionGeneration: 1,
            ...(options.workflowId ? { workflowId: options.workflowId } : {}),
            nextEventSequence: 1,
            createdAt: 100,
            updatedAt: 100,
        });

        const corpusRevisionId = await ctx.db.insert("corpusRevisions", {
            runId,
            revision: 1,
            status: options.revisionStatus ?? "approved",
            approvedByVisitorId: visitorId,
            approvedAt: 100,
            createdAt: 100,
        });

        await ctx.db.patch(runId, { activeCorpusRevisionId: corpusRevisionId });

        const sourcesConfig: Array<{
            url: string;
            title: string;
            origin?: string;
            decisions: Array<"accepted" | "rejected" | "pending">;
        }> = options.sources ?? [
            {
                url: "https://example.com/source-1",
                title: "Source 1",
                decisions: ["accepted"],
            },
        ];

        const createdSources: Array<{
            sourceId: Id<"sources">;
            lastDecisionId: Id<"sourceDecisions">;
            finalDecision: "accepted" | "rejected" | "pending";
        }> = [];

        let timeOffset = 101;
        for (const [index, src] of sourcesConfig.entries()) {
            const sourceId = await ctx.db.insert("sources", {
                runId,
                canonicalUrl: src.url,
                title: src.title,
                origin: src.origin ?? "exa",
                category: "independent_analysis",
                createdAt: timeOffset++,
            });

            let latestDecisionId: Id<"sourceDecisions"> | undefined;
            let finalDecision: "accepted" | "rejected" | "pending" = "pending";

            for (const dec of src.decisions) {
                const decTime = timeOffset++;
                const decisionId = await ctx.db.insert("sourceDecisions", {
                    runId,
                    corpusRevisionId,
                    sourceId,
                    decisionKey: `dec:${sourceId}:${decTime}`,
                    decision: dec,
                    reviewerVisitorId: visitorId,
                    ...(latestDecisionId
                        ? { supersedesDecisionId: latestDecisionId }
                        : {}),
                    occurredAt: decTime,
                });
                latestDecisionId = decisionId;
                finalDecision = dec;
            }

            if (latestDecisionId) {
                await ctx.db.insert("sourceReviewItems", {
                    runId,
                    corpusRevisionId,
                    sourceId,
                    decision: finalDecision,
                    decisionRank: index,
                    sourceCreatedAt: 100,
                    latestDecisionId,
                    decisionOccurredAt: timeOffset++,
                });
                createdSources.push({
                    sourceId,
                    lastDecisionId: latestDecisionId,
                    finalDecision,
                });
            }
        }

        return {
            userId,
            otherUserId,
            visitorId,
            otherVisitorId,
            runId,
            corpusRevisionId,
            createdSources,
        };
    });

    return {
        ...data,
        asOwner: t.withIdentity({ subject: `${data.userId}|analyst` }),
        asOther: t.withIdentity({ subject: `${data.otherUserId}|other` }),
    };
}

async function createApprovedCorpusWithSupersededAcceptance(
    t: ReturnType<typeof convexTest>,
) {
    const scenario = await createApprovedCorpusScenario(t, {
        sources: [
            {
                url: "https://example.com/source-1",
                title: "Source 1",
                decisions: ["accepted", "rejected"],
            },
            {
                url: "https://example.com/source-2",
                title: "Source 2",
                decisions: ["accepted"],
            },
        ],
    });

    const acceptedSource = scenario.createdSources.find(
        (s) => s.finalDecision === "accepted",
    );

    return {
        ...scenario,
        currentAcceptedDecisionId: acceptedSource?.lastDecisionId,
    };
}

interface FrozenSourceStatusRecord {
    _id: string;
    runId: Id<"researchRuns">;
    corpusRevisionId: Id<"corpusRevisions">;
    sourceId: Id<"sources">;
    acceptedDecisionId: Id<"sourceDecisions">;
    executionGeneration: number;
    status: "queued" | "running" | "succeeded" | "partial" | "failed";
    requestKey?: string;
    createdAt: number;
    updatedAt: number;
}

async function listFrozenSources(
    t: ReturnType<typeof convexTest>,
    runId: Id<"researchRuns">,
    executionGeneration: number,
): Promise<FrozenSourceStatusRecord[]> {
    return t.run(async (ctx) => {
        const rows = await (ctx.db as any)
            .query("evidenceSourceStatuses")
            .withIndex("by_run_and_execution_generation", (query: any) =>
                query
                    .eq("runId", runId)
                    .eq("executionGeneration", executionGeneration),
            )
            .collect();
        return rows as FrozenSourceStatusRecord[];
    });
}

async function prepareHandoff(t: ReturnType<typeof convexTest>) {
    const scenario = await createApprovedCorpusScenario(t, {
        lifecycleState: "awaiting_source_review",
        executionStatus: "running",
        workflowId: "phase-4-handle" as WorkflowId,
    });
    const decisionId = await t.run((ctx) =>
        ctx.db.insert("checkpointDecisions", {
            runId: scenario.runId,
            checkpoint: "source_review",
            decisionKey: "handoff-approval",
            reviewerVisitorId: scenario.visitorId,
            decision: "approved",
            occurredAt: 100,
        }),
    );
    return {
        scenario,
        args: {
            runId: scenario.runId,
            corpusRevisionId: scenario.corpusRevisionId,
            decisionId,
            expectedExecutionGeneration: 1,
        },
    };
}

test("replayed atomic handoff starts once and survives late Phase 4 completion", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    workflowTest.register(t);
    const { scenario, args } = await prepareHandoff(t);
    await Promise.all([
        t.mutation(internal.evidenceExecution.completeSourceReview, args),
        t.mutation(internal.evidenceExecution.completeSourceReview, args),
    ]);
    const run = await t.run((ctx) => ctx.db.get(scenario.runId));
    expect(run).toMatchObject({
        lifecycleState: "extracting_evidence",
        executionStatus: "running",
        executionGeneration: 2,
    });
    expect(run?.workflowId).not.toBe("phase-4-handle");
    await t.mutation(internal.researchWorkflow.onComplete, {
        workflowId: "phase-4-handle" as WorkflowId,
        result: { kind: "success", returnValue: null },
        context: { runId: scenario.runId },
    });
    expect((await t.run((ctx) => ctx.db.get(scenario.runId)))?.workflowId).toBe(
        run?.workflowId,
    );
    const rows = await t.run(async (ctx) => ({
        frozen: await ctx.db
            .query("evidenceSourceStatuses")
            .withIndex("by_run_and_execution_generation", (q) =>
                q.eq("runId", scenario.runId).eq("executionGeneration", 2),
            )
            .take(49),
        events: await ctx.db
            .query("runEvents")
            .withIndex("by_run_and_sequence", (q) =>
                q.eq("runId", scenario.runId),
            )
            .take(10),
        visitor: await ctx.db.get(scenario.visitorId),
    }));
    expect(rows.frozen).toHaveLength(1);
    expect(rows.events.map((event) => event.lifecycleState)).toEqual([
        "corpus_approved",
        "extracting_evidence",
    ]);
    expect(rows.visitor?.analysesReserved).toBe(1);
});

test("a reopened legacy dossier can be adjusted and approved into durable evidence work", async () => {
    const t = convexTest(schema, modules);
    workflowTest.register(t);
    const scenario = await createApprovedCorpusScenario(t, {
        sources: [
            {
                url: "https://adobe.com/legal/terms",
                title: "Terms",
                origin: "analyst_url",
                decisions: ["accepted"],
            },
            {
                url: "https://adobe.com/docs/index",
                title: "Index",
                origin: "analyst_url",
                decisions: ["accepted"],
            },
        ],
    });
    const oldRevision = await t.run((ctx) =>
        ctx.db.get(scenario.corpusRevisionId),
    );
    const reopened = await scenario.asOwner.mutation(
        api.sourceSelectionProposals.startNewCorpusRevision,
        { runId: scenario.runId, corpusRevisionId: scenario.corpusRevisionId },
    );
    const rejectedSource = scenario.createdSources[1]?.sourceId;
    const keptSource = scenario.createdSources[0]?.sourceId;
    if (!rejectedSource || !keptSource)
        throw new Error("Missing review sources");
    await scenario.asOwner.mutation(api.sources.decide, {
        runId: scenario.runId,
        corpusRevisionId: reopened.corpusRevisionId,
        sourceId: rejectedSource,
        decision: "rejected",
        decisionKey: "exclude-index",
    });
    const approval = {
        runId: scenario.runId,
        corpusRevisionId: reopened.corpusRevisionId,
        proposalId: reopened.proposalId,
        proposalVersion: 1,
        decisionKey: "reopened-approval",
    };
    expect(
        await scenario.asOwner.mutation(
            api.sourceSelectionProposals.approveProposedCorpus,
            approval,
        ),
    ).toEqual({ accepted: true });
    expect(
        await scenario.asOwner.mutation(
            api.sourceSelectionProposals.approveProposedCorpus,
            approval,
        ),
    ).toEqual({ accepted: false });
    const run = await t.run((ctx) => ctx.db.get(scenario.runId));
    expect(run).toMatchObject({
        lifecycleState: "extracting_evidence",
        executionStatus: "running",
        workflowId: expect.any(String),
    });
    expect(
        await listFrozenSources(
            t,
            scenario.runId,
            run?.executionGeneration ?? -1,
        ),
    ).toMatchObject([
        {
            sourceId: keptSource,
            corpusRevisionId: reopened.corpusRevisionId,
        },
    ]);
    expect(await t.run((ctx) => ctx.db.get(scenario.corpusRevisionId))).toEqual(
        oldRevision,
    );
    expect(await t.run((ctx) => ctx.db.query("providerCalls").take(1))).toEqual(
        [],
    );
});

test.each([
    "cancelled",
    "stale",
    "foreign decision",
    "occupied slot",
])("atomic handoff rejects %s without partial writes", async (condition) => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    workflowTest.register(t);
    const { scenario, args } = await prepareHandoff(t);
    await t.run(async (ctx) => {
        if (condition === "cancelled")
            await ctx.db.patch(scenario.runId, {
                executionStatus: "cancelled",
            });
        if (condition === "stale")
            await ctx.db.patch(scenario.runId, { executionGeneration: 2 });
        if (condition === "foreign decision")
            await ctx.db.patch(args.decisionId, {
                reviewerVisitorId: scenario.otherVisitorId,
            });
        if (condition === "occupied slot")
            await ctx.db.insert("researchRuns", {
                ownerVisitorId: scenario.visitorId,
                lifecycleState: "discovering_sources",
                executionStatus: "running",
                executionGeneration: 1,
                nextEventSequence: 1,
                createdAt: 1,
                updatedAt: 1,
            });
    });
    const before = await t.run((ctx) => ctx.db.get(scenario.runId));
    await expect(
        t.mutation(internal.evidenceExecution.completeSourceReview, args),
    ).rejects.toThrow();
    expect(await t.run((ctx) => ctx.db.get(scenario.runId))).toEqual(before);
    expect(
        await t.run((ctx) =>
            ctx.db
                .query("evidenceSourceStatuses")
                .withIndex("by_run_and_execution_generation", (q) =>
                    q.eq("runId", scenario.runId),
                )
                .take(1),
        ),
    ).toEqual([]);
    expect(
        await t.run((ctx) =>
            ctx.db
                .query("runEvents")
                .withIndex("by_run_and_sequence", (q) =>
                    q.eq("runId", scenario.runId),
                )
                .take(1),
        ),
    ).toEqual([]);
});

test("freezes only effective accepted heads", async () => {
    const t = convexTest(schema, modules);
    workflowTest.register(t);
    rateLimiterTest.register(t);

    const scenario = await createApprovedCorpusWithSupersededAcceptance(t);
    const result = await scenario.asOwner.mutation(startPhase5, {
        runId: scenario.runId,
        requestKey: "phase5-start-1",
    });
    expect(result.acceptedSourceCount).toBe(1);
    expect(result.executionGeneration).toBe(2);

    const frozen = await listFrozenSources(
        t,
        scenario.runId,
        result.executionGeneration,
    );
    expect(frozen.map((item) => item.acceptedDecisionId)).toEqual([
        scenario.currentAcceptedDecisionId,
    ]);
    expect(frozen[0]).toMatchObject({
        runId: scenario.runId,
        corpusRevisionId: scenario.corpusRevisionId,
        status: "queued",
        executionGeneration: 2,
    });

    const run = (await t.query(getRun, {
        runId: scenario.runId,
    })) as Record<string, unknown>;
    expect(run.lifecycleState).toBe("extracting_evidence");
    expect(run.executionStatus).toBe("running");
    expect(run.executionGeneration).toBe(2);
    expect(typeof run.workflowId).toBe("string");
});

test("freezes actual accepted count rather than recommendation target", async () => {
    const t = convexTest(schema, modules);
    workflowTest.register(t);
    rateLimiterTest.register(t);

    const scenario = await createApprovedCorpusScenario(t, {
        sources: [
            {
                url: "https://example.com/source-1",
                title: "Source 1",
                decisions: ["accepted"],
            },
            {
                url: "https://example.com/source-2",
                title: "Source 2",
                decisions: ["accepted"],
            },
            {
                url: "https://example.com/source-3",
                title: "Source 3",
                decisions: ["rejected"],
            },
        ],
    });

    const result = await scenario.asOwner.mutation(startPhase5, {
        runId: scenario.runId,
        requestKey: "phase5-start-actual-count",
    });

    expect(result.acceptedSourceCount).toBe(2);
    const frozen = await listFrozenSources(
        t,
        scenario.runId,
        result.executionGeneration,
    );
    expect(frozen).toHaveLength(2);
    expect(frozen.every((f) => f.status === "queued")).toBe(true);
});

test("rejects when no accepted sources exist", async () => {
    const t = convexTest(schema, modules);
    workflowTest.register(t);
    rateLimiterTest.register(t);

    const scenario = await createApprovedCorpusScenario(t, {
        sources: [
            {
                url: "https://example.com/source-1",
                title: "Source 1",
                decisions: ["rejected"],
            },
            {
                url: "https://example.com/source-2",
                title: "Source 2",
                decisions: ["pending"],
            },
        ],
    });

    await expect(
        scenario.asOwner.mutation(startPhase5, {
            runId: scenario.runId,
            requestKey: "phase5-start-no-accepted",
        }),
    ).rejects.toThrow("At least one accepted source is required");

    const frozen = await listFrozenSources(t, scenario.runId, 2);
    expect(frozen).toHaveLength(0);

    const run = (await t.query(getRun, {
        runId: scenario.runId,
    })) as Record<string, unknown>;
    expect(run.lifecycleState).toBe("corpus_approved");
    expect(run.executionStatus).toBe("idle");
    expect(run.executionGeneration).toBe(1);
});

test("rejects start by foreign visitor", async () => {
    const t = convexTest(schema, modules);
    workflowTest.register(t);
    rateLimiterTest.register(t);

    const scenario = await createApprovedCorpusScenario(t);

    await expect(
        scenario.asOther.mutation(startPhase5, {
            runId: scenario.runId,
            requestKey: "phase5-start-foreign",
        }),
    ).rejects.toThrow("Unauthorized");

    const frozen = await listFrozenSources(t, scenario.runId, 2);
    expect(frozen).toHaveLength(0);
});

test("rejects start when revision is non-approved", async () => {
    const t = convexTest(schema, modules);
    workflowTest.register(t);
    rateLimiterTest.register(t);

    const scenario = await createApprovedCorpusScenario(t, {
        revisionStatus: "draft",
        lifecycleState: "awaiting_source_review",
        executionStatus: "paused",
    });

    await expect(
        scenario.asOwner.mutation(startPhase5, {
            runId: scenario.runId,
            requestKey: "phase5-start-draft",
        }),
    ).rejects.toThrow("Research run cannot be started");
});

test("rejects start when active revision is stale or mismatched", async () => {
    const t = convexTest(schema, modules);
    workflowTest.register(t);
    rateLimiterTest.register(t);

    const scenario = await createApprovedCorpusScenario(t);

    await t.run(async (ctx) => {
        const otherRunId = await ctx.db.insert("researchRuns", {
            ownerVisitorId: scenario.visitorId,
            lifecycleState: "corpus_approved",
            executionStatus: "idle",
            executionGeneration: 1,
            nextEventSequence: 1,
            createdAt: 100,
            updatedAt: 100,
        });
        const foreignRevisionId = await ctx.db.insert("corpusRevisions", {
            runId: otherRunId,
            revision: 1,
            status: "approved",
            createdAt: 100,
        });
        // Point activeCorpusRevisionId to foreign revision
        await ctx.db.patch(scenario.runId, {
            activeCorpusRevisionId: foreignRevisionId,
        });
    });

    await expect(
        scenario.asOwner.mutation(startPhase5, {
            runId: scenario.runId,
            requestKey: "phase5-start-mismatched-revision",
        }),
    ).rejects.toThrow("Active corpus revision is not approved");
});

test("rejects and writes no frozen sources when latestDecisionId is missing", async () => {
    const t = convexTest(schema, modules);
    workflowTest.register(t);
    rateLimiterTest.register(t);

    const scenario = await createApprovedCorpusScenario(t);

    await t.run(async (ctx) => {
        const reviewItem = await ctx.db
            .query("sourceReviewItems")
            .withIndex("by_revision_and_source", (query) =>
                query.eq("corpusRevisionId", scenario.corpusRevisionId),
            )
            .first();
        if (!reviewItem) throw new Error("Fixture review item not found");
        await ctx.db.delete(reviewItem.latestDecisionId);
    });

    await expect(
        scenario.asOwner.mutation(startPhase5, {
            runId: scenario.runId,
            requestKey: "phase5-start-missing-decision",
        }),
    ).rejects.toThrow("Source review item references missing decision");

    const frozen = await listFrozenSources(t, scenario.runId, 2);
    expect(frozen).toHaveLength(0);

    const run = (await t.query(getRun, {
        runId: scenario.runId,
    })) as Record<string, unknown>;
    expect(run.lifecycleState).toBe("corpus_approved");
    expect(run.executionStatus).toBe("idle");
    expect(run.executionGeneration).toBe(1);
});

test("rejects and writes no frozen sources when decision belongs to foreign run or revision", async () => {
    const t = convexTest(schema, modules);
    workflowTest.register(t);
    rateLimiterTest.register(t);

    const scenario = await createApprovedCorpusScenario(t);

    await t.run(async (ctx) => {
        const foreignRunId = await ctx.db.insert("researchRuns", {
            ownerVisitorId: scenario.visitorId,
            lifecycleState: "corpus_approved",
            executionStatus: "idle",
            executionGeneration: 1,
            nextEventSequence: 1,
            createdAt: 100,
            updatedAt: 100,
        });
        const reviewItem = await ctx.db
            .query("sourceReviewItems")
            .withIndex("by_revision_and_source", (query) =>
                query.eq("corpusRevisionId", scenario.corpusRevisionId),
            )
            .first();
        if (!reviewItem) throw new Error("Fixture review item not found");
        await ctx.db.patch(reviewItem.latestDecisionId, {
            runId: foreignRunId,
        });
    });

    await expect(
        scenario.asOwner.mutation(startPhase5, {
            runId: scenario.runId,
            requestKey: "phase5-start-foreign-decision-run",
        }),
    ).rejects.toThrow("Source decision does not match review item identity");

    const frozen = await listFrozenSources(t, scenario.runId, 2);
    expect(frozen).toHaveLength(0);

    const run = (await t.query(getRun, {
        runId: scenario.runId,
    })) as Record<string, unknown>;
    expect(run.lifecycleState).toBe("corpus_approved");
    expect(run.executionStatus).toBe("idle");
    expect(run.executionGeneration).toBe(1);
});

test("rejects and writes no frozen sources when decision sourceId does not match review item sourceId", async () => {
    const t = convexTest(schema, modules);
    workflowTest.register(t);
    rateLimiterTest.register(t);

    const scenario = await createApprovedCorpusScenario(t);

    await t.run(async (ctx) => {
        const otherSourceId = await ctx.db.insert("sources", {
            runId: scenario.runId,
            canonicalUrl: "https://example.com/other-source",
            title: "Other Source",
            origin: "exa",
            category: "independent_analysis",
            createdAt: 105,
        });
        const reviewItem = await ctx.db
            .query("sourceReviewItems")
            .withIndex("by_revision_and_source", (query) =>
                query.eq("corpusRevisionId", scenario.corpusRevisionId),
            )
            .first();
        if (!reviewItem) throw new Error("Fixture review item not found");
        await ctx.db.patch(reviewItem.latestDecisionId, {
            sourceId: otherSourceId,
        });
    });

    await expect(
        scenario.asOwner.mutation(startPhase5, {
            runId: scenario.runId,
            requestKey: "phase5-start-mismatched-source-decision",
        }),
    ).rejects.toThrow("Source decision does not match review item identity");

    const frozen = await listFrozenSources(t, scenario.runId, 2);
    expect(frozen).toHaveLength(0);

    const run = (await t.query(getRun, {
        runId: scenario.runId,
    })) as Record<string, unknown>;
    expect(run.lifecycleState).toBe("corpus_approved");
    expect(run.executionStatus).toBe("idle");
    expect(run.executionGeneration).toBe(1);
});

test("rejects and writes no frozen sources when source does not belong to research run", async () => {
    const t = convexTest(schema, modules);
    workflowTest.register(t);
    rateLimiterTest.register(t);

    const scenario = await createApprovedCorpusScenario(t);

    await t.run(async (ctx) => {
        const foreignRunId = await ctx.db.insert("researchRuns", {
            ownerVisitorId: scenario.visitorId,
            lifecycleState: "corpus_approved",
            executionStatus: "idle",
            executionGeneration: 1,
            nextEventSequence: 1,
            createdAt: 100,
            updatedAt: 100,
        });
        const reviewItem = await ctx.db
            .query("sourceReviewItems")
            .withIndex("by_revision_and_source", (query) =>
                query.eq("corpusRevisionId", scenario.corpusRevisionId),
            )
            .first();
        if (!reviewItem) throw new Error("Fixture review item not found");
        await ctx.db.patch(reviewItem.sourceId, {
            runId: foreignRunId,
        });
    });

    await expect(
        scenario.asOwner.mutation(startPhase5, {
            runId: scenario.runId,
            requestKey: "phase5-start-foreign-source-run",
        }),
    ).rejects.toThrow("Source does not belong to research run");

    const frozen = await listFrozenSources(t, scenario.runId, 2);
    expect(frozen).toHaveLength(0);

    const run = (await t.query(getRun, {
        runId: scenario.runId,
    })) as Record<string, unknown>;
    expect(run.lifecycleState).toBe("corpus_approved");
    expect(run.executionStatus).toBe("idle");
    expect(run.executionGeneration).toBe(1);
});

test("rejects and writes no frozen sources when projection outcome does not match source decision outcome", async () => {
    const t = convexTest(schema, modules);
    workflowTest.register(t);
    rateLimiterTest.register(t);

    const scenario = await createApprovedCorpusScenario(t);

    await t.run(async (ctx) => {
        const reviewItem = await ctx.db
            .query("sourceReviewItems")
            .withIndex("by_revision_and_source", (query) =>
                query.eq("corpusRevisionId", scenario.corpusRevisionId),
            )
            .first();
        if (!reviewItem) throw new Error("Fixture review item not found");

        // Tamper decision row outcome to be rejected while reviewItem is accepted
        await ctx.db.patch(reviewItem.latestDecisionId, {
            decision: "rejected",
        });
    });

    await expect(
        scenario.asOwner.mutation(startPhase5, {
            runId: scenario.runId,
            requestKey: "phase5-start-mismatched-projection",
        }),
    ).rejects.toThrow(
        "Source decision outcome does not match review item projection",
    );

    const frozen = await listFrozenSources(t, scenario.runId, 2);
    expect(frozen).toHaveLength(0);

    const run = (await t.query(getRun, {
        runId: scenario.runId,
    })) as Record<string, unknown>;
    expect(run.lifecycleState).toBe("corpus_approved");
    expect(run.executionStatus).toBe("idle");
    expect(run.executionGeneration).toBe(1);
});

test("historical acceptance superseded by pending does not freeze", async () => {
    const t = convexTest(schema, modules);
    workflowTest.register(t);
    rateLimiterTest.register(t);

    const scenario = await createApprovedCorpusScenario(t, {
        sources: [
            {
                url: "https://example.com/source-1",
                title: "Source 1",
                decisions: ["accepted", "pending"],
            },
            {
                url: "https://example.com/source-2",
                title: "Source 2",
                decisions: ["accepted"],
            },
        ],
    });

    const result = await scenario.asOwner.mutation(startPhase5, {
        runId: scenario.runId,
        requestKey: "phase5-start-superseded-pending",
    });

    expect(result.acceptedSourceCount).toBe(1);
    const frozen = await listFrozenSources(
        t,
        scenario.runId,
        result.executionGeneration,
    );
    expect(frozen).toHaveLength(1);
    expect(frozen[0]?.sourceId).toBe(scenario.createdSources[1]?.sourceId);
});

test("concurrent starts with different request keys race such that exactly one succeeds", async () => {
    const t = convexTest(schema, modules);
    workflowTest.register(t);
    rateLimiterTest.register(t);

    const scenario = await createApprovedCorpusScenario(t);

    const results = await Promise.allSettled([
        scenario.asOwner.mutation(startPhase5, {
            runId: scenario.runId,
            requestKey: "phase5-start-race-key-1",
        }),
        scenario.asOwner.mutation(startPhase5, {
            runId: scenario.runId,
            requestKey: "phase5-start-race-key-2",
        }),
    ]);

    const fulfilled = results.filter(
        (
            r,
        ): r is PromiseFulfilledResult<{
            acceptedSourceCount: number;
            executionGeneration: number;
        }> => r.status === "fulfilled",
    );
    const rejected = results.filter(
        (r): r is PromiseRejectedResult => r.status === "rejected",
    );

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(fulfilled[0]?.value.acceptedSourceCount).toBe(1);
    expect(fulfilled[0]?.value.executionGeneration).toBe(2);
    expect(rejected[0]?.reason).toBeDefined();

    const run = (await t.query(getRun, {
        runId: scenario.runId,
    })) as Record<string, unknown>;
    expect(run.executionGeneration).toBe(2);
    expect(run.lifecycleState).toBe("extracting_evidence");
    expect(run.executionStatus).toBe("running");
    expect(typeof run.workflowId).toBe("string");

    // Exactly one set of frozen sources exists in the table for this run
    const allFrozenForRun = await t.run(async (ctx) => {
        return ctx.db
            .query("evidenceSourceStatuses")
            .withIndex("by_run_and_execution_generation", (query) =>
                query.eq("runId", scenario.runId),
            )
            .collect();
    });
    expect(allFrozenForRun).toHaveLength(1);
    expect(allFrozenForRun[0]?.executionGeneration).toBe(2);
    expect(allFrozenForRun[0]?.requestKey).toBe(run.evidenceStartRequestKey);
});

test("replays idempotently with the same request key", async () => {
    const t = convexTest(schema, modules);
    workflowTest.register(t);
    rateLimiterTest.register(t);

    const scenario = await createApprovedCorpusScenario(t);

    const first = await scenario.asOwner.mutation(startPhase5, {
        runId: scenario.runId,
        requestKey: "phase5-start-replay",
    });

    const second = await scenario.asOwner.mutation(startPhase5, {
        runId: scenario.runId,
        requestKey: "phase5-start-replay",
    });

    expect(second).toEqual(first);
    const frozen = await listFrozenSources(
        t,
        scenario.runId,
        first.executionGeneration,
    );
    expect(frozen).toHaveLength(1);
});

test("rejects start when visitor already has another running run", async () => {
    const t = convexTest(schema, modules);
    workflowTest.register(t);
    rateLimiterTest.register(t);

    const scenario = await createApprovedCorpusScenario(t);

    // Insert another running run for the same visitor
    await t.run(async (ctx) => {
        await ctx.db.insert("researchRuns", {
            ownerVisitorId: scenario.visitorId,
            lifecycleState: "discovering_sources",
            executionStatus: "running",
            executionGeneration: 1,
            nextEventSequence: 1,
            createdAt: 100,
            updatedAt: 100,
        });
    });

    await expect(
        scenario.asOwner.mutation(startPhase5, {
            runId: scenario.runId,
            requestKey: "phase5-start-another-running",
        }),
    ).rejects.toThrow("A research workflow is already running");

    const frozen = await listFrozenSources(t, scenario.runId, 2);
    expect(frozen).toHaveLength(0);
});

test("starts successfully when run has a stale completed workflow handle", async () => {
    const t = convexTest(schema, modules);
    workflowTest.register(t);
    rateLimiterTest.register(t);

    const scenario = await createApprovedCorpusScenario(t, {
        workflowId: "stale-phase-4-completed-workflow",
        lifecycleState: "corpus_approved",
        executionStatus: "idle",
    });

    const result = await scenario.asOwner.mutation(startPhase5, {
        runId: scenario.runId,
        requestKey: "phase5-start-stale-handle",
    });

    expect(result.acceptedSourceCount).toBe(1);
    expect(result.executionGeneration).toBe(2);

    const run = (await t.query(getRun, {
        runId: scenario.runId,
    })) as Record<string, unknown>;
    expect(run.lifecycleState).toBe("extracting_evidence");
    expect(run.executionStatus).toBe("running");
    expect(run.workflowId).not.toBe("stale-phase-4-completed-workflow");
    expect(typeof run.workflowId).toBe("string");
});

test("workflow executes to honest terminal failure and clears visitor running slot", async () => {
    const t = convexTest(schema, modules);
    workflowTest.register(t);
    rateLimiterTest.register(t);

    const scenario = await createApprovedCorpusScenario(t);
    const result = await scenario.asOwner.mutation(startPhase5, {
        runId: scenario.runId,
        requestKey: "phase5-start-drain",
    });

    expect(result.acceptedSourceCount).toBe(1);
    expect(result.executionGeneration).toBe(2);

    const runBefore = (await t.query(getRun, {
        runId: scenario.runId,
    })) as Record<string, unknown>;

    const onCompleteRef = makeFunctionReference<
        "mutation",
        {
            workflowId: string;
            result: any;
            context: { runId: Id<"researchRuns"> };
        },
        null
    >("evidenceWorkflow:onComplete");

    await t.mutation(onCompleteRef, {
        workflowId: runBefore.workflowId as string,
        result: { kind: "failed", error: "workflow failed" },
        context: { runId: scenario.runId },
    });

    const run = (await t.query(getRun, {
        runId: scenario.runId,
    })) as Record<string, unknown>;
    expect(run.executionStatus).toBe("failed");
    expect(run.workflowId).toBeUndefined();

    // Verify visitor is no longer blocked from starting another run
    const runningRun = await t.run(async (ctx) => {
        return ctx.db
            .query("researchRuns")
            .withIndex("by_owner_and_execution_status", (query) =>
                query
                    .eq("ownerVisitorId", scenario.visitorId)
                    .eq("executionStatus", "running"),
            )
            .first();
    });
    expect(runningRun).toBeNull();
});

test("freezes and replays sixty accepted candidates from a prepared corpus without truncation", async () => {
    const t = convexTest(schema, modules);
    workflowTest.register(t);
    const scenario = await createApprovedCorpusScenario(t, {
        sources: Array.from({ length: 60 }, (_, index) => ({
            url: `https://example.com/prepared-${index}`,
            title: `Prepared source ${index}`,
            origin: "exa",
            decisions: ["accepted" as const],
        })),
    });
    await t.run(async (ctx) => {
        const preparationId = await ctx.db.insert(
            "sourceSelectionProposalRebuilds",
            {
                runId: scenario.runId,
                corpusRevisionId: scenario.corpusRevisionId,
                kind: "preparation",
                entryPoint: "source_review",
                workflowVersion: 1,
                qualificationVersion: "source-qualification-v2",
                executionGeneration: 1,
                policyVersion: "source-qualification-v2",
                operationKey: "prepared-sixty-candidate-fixture",
                status: "complete",
                failedDiscoveryFamilies: [],
                leaseExpiresAt: 100,
                deadlineAt: 100,
                createdAt: 1,
                completedAt: 100,
            },
        );
        await ctx.db.patch(scenario.runId, {
            sourcePreparationId: preparationId,
        });
    });
    const args = { runId: scenario.runId, requestKey: "prepared-sixty" };
    const first = await scenario.asOwner.mutation(startPhase5, args);
    expect(first.acceptedSourceCount).toBe(60);
    expect(await scenario.asOwner.mutation(startPhase5, args)).toEqual(first);
    const frozen = await t.query(
        internal.evidenceArtifacts.listFrozenSourcesForRun,
        {
            runId: scenario.runId,
            executionGeneration: first.executionGeneration,
        },
    );
    expect(frozen).toHaveLength(60);
    expect(new Set(frozen.map((row) => row.sourceId)).size).toBe(60);
});
