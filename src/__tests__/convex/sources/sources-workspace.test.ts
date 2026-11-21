import { api, internal } from "@convex/_generated/api";
import { completeSources } from "@convex/domain/sources";
import { getAgentDefinition } from "@convex/execution/agentCatalog";
import { afterEach, assert, expect, test, vi } from "vitest";
import { installModel } from "@/__tests__/setup/model-configuration";
import {
    dispatchSourcesOperation,
    seedCapturedSources,
    startSourcesOperation,
} from "@/__tests__/setup/sources-mission";

const examiner = vi.hoisted(() => vi.fn());
vi.mock("@convex/integrations/documentaryControl", () => ({
    examineDocumentaryContributions: examiner,
}));
afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    examiner.mockReset();
});

type Fixture = Awaited<ReturnType<typeof seedCapturedSources>>;

async function workbenchFacts(f: Fixture) {
    await f.t.run((ctx) => ctx.db.patch(f.runId, { startMode: "framed" }));
    await f.t
        .withIdentity({ subject: f.userId })
        .mutation(api.execution.conversations.submit, {
            runId: f.runId,
            requestKey: "controlled-source-consultation",
            text: "Explain the saved documentary material.",
            delivery: "queue",
        });
    await f.t.run(async (ctx) => {
        const conversation = await ctx.db
            .query("agentConversations")
            .withIndex("by_run", (q) => q.eq("runId", f.runId))
            .unique();
        assert(conversation);
        await ctx.db.patch(conversation._id, {
            definitionId: "workbench_v1",
            definitionVersion: getAgentDefinition("workbench_v1").version,
        });
    });
    const active = await f.t.mutation(
        internal.execution.conversations.startTurn,
        {
            runId: f.runId,
            definitionId: "workbench_v1",
            scope: { kind: "workbench_v1" },
            simulation: false,
        },
    );
    assert(active);
    const facts = await f.t.run(async (ctx) => {
        const run = await ctx.db.get(f.runId),
            mission = await ctx.db.get(active.missionId);
        assert(run && mission);
        return getAgentDefinition("workbench_v1").context(ctx, mission, run);
    });
    assert(facts.kind === "ready");
    return facts.context;
}

async function qualifyWithConflict(
    f: Fixture,
    conclusions: (
        | "supported"
        | "documentary_conflict"
        | "not_established"
    )[] = ["documentary_conflict"],
    permittedUse:
        | "attributed_argument_only"
        | "context_only" = "attributed_argument_only",
) {
    vi.stubEnv("OPENROUTER_API_KEY", "fixture-only");
    await installModel(
        f.t,
        { model: "z-ai/glm-5.3-flash", reasoningEffort: "low" },
        "sources",
    );
    examiner.mockImplementation(async (input, route, dependencies) => {
        await dependencies.beforeDispatch(
            JSON.stringify({ model: route.model, fixture: true }),
            { effectiveMaxOutputTokens: route.descriptor.maxTokens },
        );
        return {
            status: "succeeded",
            model: route.model,
            latencyMs: 1,
            dispatchOutcome: "response_received",
            output: {
                coherence: false,
                limitations: [
                    "The filing and the call define scope differently.",
                ],
                findings: input.contributions.map(
                    (c: { id: string }, index: number) => ({
                        contributionId: c.id,
                        conclusion: conclusions[index],
                        permittedUse,
                        diagnostic: "Another filing states a different scope.",
                    }),
                ),
            },
        };
    });
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: f.missionId,
            expectedGeneration: 4,
            cause: "qualification",
            input: {
                kind: "submit_documentary_qualification",
                sourceId: f.sourceId,
                captureId: f.captureId,
                expectedTaskId: null,
                changes: conclusions.map((_, index) => ({
                    contribution: {
                        needIds: ["common-context"],
                        statement: `The publisher describes workflow software scope ${index}.`,
                        period: "undated",
                        modality: "publisher statement",
                        attribution: "ServiceNow",
                        kind: "attributed_argument" as const,
                        evidence: [
                            {
                                readRequestId: f.readRequestId,
                                passageOrder: f.passage.order,
                            },
                        ],
                    },
                })),
            },
        },
    );
    const outcome = await dispatchSourcesOperation(f.t, {
        requestId,
        expectedGeneration: 4,
    });
    expect(outcome, JSON.stringify(outcome)).toMatchObject({ kind: "success" });
    return requestId;
}

test("the Sources workspace keeps reading, contribution, control and membership distinct before and after handoff", async () => {
    const f = await seedCapturedSources();
    const owner = f.t.withIdentity({ subject: f.userId });
    await expect(
        f.t.query(api.sourcesWorkspace.overview, { runId: f.runId }),
    ).rejects.toThrow();

    const requestId = await qualifyWithConflict(f);
    const running = await owner.query(api.sourcesWorkspace.overview, {
        runId: f.runId,
    });
    assert(running);
    expect(running.materialOutcome).toBeNull();
    const need = running.needs.find((entry) => entry.id === "common-context");
    expect(need).toMatchObject({
        outcome: "in_progress",
        documents: 1,
        sourceIds: [f.sourceId],
        contributions: 1,
        conflicts: 1,
    });
    expect(running.contributions).toMatchObject({
        total: 1,
        conflict: 1,
        kinds: { attributed_argument: 1 },
    });
    expect(running.reading.captured).toBeGreaterThanOrEqual(1);
    const pendingRows = await owner.query(api.sourcesWorkspace.listSources, {
        runId: f.runId,
    });
    expect(
        pendingRows?.find((row) => row.sourceId === f.sourceId),
    ).toMatchObject({ membership: "pending", reading: "full" });

    await f.t.run((ctx) =>
        completeSources(ctx, f.preparationId, {
            kind: "complete",
            needsRevision: 1,
            needs: [
                {
                    needId: "common-context",
                    unfinished: ["An independent source was not examined."],
                    workRequestIds: [requestId],
                },
            ],
        }),
    );
    const handed = await owner.query(api.sourcesWorkspace.overview, {
        runId: f.runId,
    });
    const prepared = await owner.query(api.sourcesMission.getPreparedMaterial, {
        runId: f.runId,
    });
    assert(handed && prepared?.material);
    // The projection mirrors the persisted handoff; it never re-decides retention.
    expect(handed.materialOutcome).toBe(prepared.material.outcome);
    const outcome = prepared.material.needs.find(
        (entry) => entry.needId === "common-context",
    );
    expect(
        handed.needs.find((entry) => entry.id === "common-context"),
    ).toMatchObject({
        outcome: "unfinished",
        unfinished: ["An independent source was not examined."],
        contributions: outcome?.contributions.length,
    });
    expect(handed.organize.retained).toBe(prepared.material.documents.length);

    const rows = await owner.query(api.sourcesWorkspace.listSources, {
        runId: f.runId,
    });
    assert(rows);
    type Row = NonNullable<typeof rows>[number];
    const tallyOf = (predicate: (entry: Row) => boolean) =>
        rows.filter(predicate).length;
    // Every candidate is accounted for: captured, unavailable, capturing or never captured.
    expect(handed.reading.notCaptured).toBe(
        tallyOf((entry) => entry.reading === "not_captured"),
    );
    expect(
        handed.reading.captured +
            handed.reading.unavailable +
            handed.reading.capturing +
            handed.reading.notCaptured,
    ).toBe(handed.collect.candidates);
    // Not retained separates read documents with nothing usable from leads never read.
    expect(handed.organize.notRetainedCaptured).toBe(
        tallyOf(
            (entry) =>
                entry.membership === "not_retained" &&
                (entry.reading === "full" || entry.reading === "partial"),
        ),
    );
    expect(
        handed.organize.notRetainedCaptured +
            handed.organize.notRetainedWithoutAvailableCapture,
    ).toBe(handed.organize.notRetained);
    // Controls on retained material are reported separately from every control performed.
    expect(handed.retainedContributions.total).toBe(
        rows
            .filter((entry) => entry.membership === "retained")
            .reduce((sum, entry) => sum + (entry.contributions?.total ?? 0), 0),
    );
    expect(
        handed.needs.find((entry) => entry.id === "common-context")?.sourceIds,
    ).toEqual(retainedNeedSources(prepared.material, "common-context"));
    const retained = new Set(
        prepared.material.documents.map((document) => document.sourceId),
    );
    for (const entry of rows ?? [])
        expect(entry.membership).toBe(
            retained.has(entry.sourceId) ? "retained" : "not_retained",
        );
    expect(rows?.find((entry) => entry.sourceId === f.sourceId)).toMatchObject({
        reading: "full",
        contributions: {
            total: 1,
            conflict: 1,
            supported: 0,
            effectiveUses: {
                documentary: 0,
                attributed_argument_only: 0,
                context_only: 0,
                blocked: 1,
            },
        },
        limitations: ["The filing and the call define scope differently."],
    });

    const reading = await owner.query(api.sourcesWorkspace.getSource, {
        runId: f.runId,
        sourceId: f.sourceId,
    });
    assert(reading);
    expect(reading.excerpts).toBe("cited");
    expect(
        reading.sections.flatMap((section) =>
            section.passages.map((p) => p.order),
        ),
    ).toContain(f.passage.order);
    expect(reading.contributions).toEqual([
        expect.objectContaining({
            kind: "attributed_argument",
            conclusion: "documentary_conflict",
            permittedUse: "blocked",
            reportedUse: "attributed_argument_only",
            passageOrders: [f.passage.order],
        }),
    ]);
    expect(reading.coherence).toBe(false);
});

function retainedNeedSources(
    material: {
        documents: { sourceId: string; qualificationTaskId: string }[];
        needs: {
            needId: string;
            contributions: { qualificationTaskId: string }[];
        }[];
    },
    needId: string,
) {
    const tasks = new Set(
        material.needs
            .find((entry) => entry.needId === needId)
            ?.contributions.map((entry) => entry.qualificationTaskId),
    );
    return material.documents
        .filter((document) => tasks.has(document.qualificationTaskId))
        .map((document) => document.sourceId);
}

test("coverage handoff freezes unfinished searches for Sources and Workbench", async () => {
    const f = await seedCapturedSources();
    await f.t.run(async (ctx) => {
        const preparation = await ctx.db.get(f.preparationId);
        assert(preparation?.sourcesMission);
        await ctx.db.patch(f.preparationId, {
            sourcesMission: {
                ...preparation.sourcesMission,
                coveragePolicy: {
                    version: "sources_coverage_v1",
                    preset: "independent_scrutiny",
                },
            },
        });
    });
    const expectedGeneration = 4;
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: f.missionId,
            expectedGeneration,
            cause: "coverage-search",
            input: {
                kind: "discover_sources_for_need",
                needId: "common-context",
                query: "workflow reliability",
            },
        },
    );
    await startSourcesOperation(f.t, {
        requestId,
        expectedGeneration,
    });
    const reserved = await f.t.mutation(internal.sourcesMission.reserve, {
        requestId,
        expectedGeneration,
    });
    assert(reserved.discovery);
    await f.t.run((ctx) =>
        ctx.db.patch(f.missionId, { deadlineAt: Date.now() }),
    );
    await f.t.mutation(internal.execution.operations.expire, {
        requestId,
        expectedGeneration,
    });
    await f.t.run((ctx) =>
        completeSources(ctx, f.preparationId, {
            kind: "complete",
            needsRevision: 1,
            needs: [
                {
                    needId: "common-context",
                    unfinished: ["The search outcome could not be confirmed."],
                    workRequestIds: [requestId],
                },
            ],
        }),
    );
    const owner = f.t.withIdentity({ subject: f.userId });
    const before = await owner.query(api.sourcesMission.getPreparedMaterial, {
        runId: f.runId,
    });
    expect(before?.material).toMatchObject({
        coveragePolicy: {
            version: "sources_coverage_v1",
            preset: "independent_scrutiny",
        },
        coverageSearches: [
            {
                requestId,
                outcome: "unfinished",
                reasonCode: "operation_outcome_unknown",
            },
        ],
    });
    await f.t.mutation(internal.execution.operations.recordResult, {
        requestId,
        expectedGeneration,
        outcome: {
            kind: "success",
            valueJson: JSON.stringify({
                needId: "common-context",
                query: reserved.discovery.query,
                inserted: 0,
                total: 0,
            }),
        },
    });
    expect(
        await owner.query(api.sourcesMission.getPreparedMaterial, {
            runId: f.runId,
        }),
    ).toEqual(before);
    const overview = await owner.query(api.sourcesWorkspace.overview, {
        runId: f.runId,
    });
    expect(overview?.coverage?.searches).toEqual([
        {
            requestId,
            needIds: ["common-context"],
            ...reserved.discovery,
            outcome: "unfinished",
            reasonCode: "operation_outcome_unknown",
        },
    ]);
    const facts = await workbenchFacts(f);
    expect(facts.documentaryPreparation).toMatchObject({
        coverage: overview?.coverage,
    });
});

test("dossiers without the Sources protocol have no Sources workspace projection", async () => {
    const f = await seedCapturedSources();
    await f.t.run((ctx) =>
        ctx.db.patch(f.runId, { sourcesProtocol: undefined }),
    );
    const owner = f.t.withIdentity({ subject: f.userId });
    expect(
        await owner.query(api.sourcesWorkspace.overview, { runId: f.runId }),
    ).toBeNull();
    expect(
        await owner.query(api.sourcesWorkspace.getSource, {
            runId: f.runId,
            sourceId: f.sourceId,
        }),
    ).toBeNull();
});

test("the conversation exposes the same recorded Sources operation and keeps its documentary result distinct", async () => {
    const f = await seedCapturedSources();
    const owner = f.t.withIdentity({ subject: f.userId });
    const snapshot = await owner.query(api.workbench.snapshot, {
        runId: f.runId,
    });
    expect(snapshot).toMatchObject({
        sourcesWork: {
            missionId: f.missionId,
            operations: [
                expect.objectContaining({
                    id: f.readRequestId,
                    title: "Search retained documentary material",
                    summary: "Search completed. Inspect the matching material.",
                    sourceId: f.sourceId,
                    succeeded: true,
                }),
            ],
        },
    });
    expect(JSON.stringify(snapshot)).not.toContain('"valueJson"');
});

test("retention preserves per-contribution conflict and non-establishment limits", async () => {
    const f = await seedCapturedSources();
    const requestId = await qualifyWithConflict(f, [
        "supported",
        "documentary_conflict",
        "not_established",
    ]);
    await f.t.run((ctx) =>
        completeSources(ctx, f.preparationId, {
            kind: "complete",
            needsRevision: 1,
            needs: [
                {
                    needId: "common-context",
                    unfinished: [],
                    workRequestIds: [requestId],
                },
            ],
        }),
    );
    const rows = await f.t
        .withIdentity({ subject: f.userId })
        .query(api.sourcesWorkspace.listSources, { runId: f.runId });
    expect(rows?.find((row) => row.sourceId === f.sourceId)).toMatchObject({
        membership: "retained",
        contributions: {
            total: 3,
            supported: 1,
            conflict: 1,
            notEstablished: 1,
            inspectionOnly: 2,
            effectiveUses: {
                documentary: 0,
                attributed_argument_only: 1,
                context_only: 0,
                blocked: 2,
            },
        },
    });
    expect((await workbenchFacts(f)).availableMaterials).toEqual(
        expect.arrayContaining([
            expect.objectContaining({
                sourceId: f.sourceId,
                documentaryState: expect.objectContaining({
                    membership: "retained",
                    contributions: expect.objectContaining({
                        total: 3,
                        supported: 1,
                        conflict: 1,
                        notEstablished: 1,
                        inspectionOnly: 2,
                        effectiveUses: {
                            documentary: 0,
                            attributed_argument_only: 1,
                            context_only: 0,
                            blocked: 2,
                        },
                    }),
                }),
            }),
        ]),
    );
});

test("supported attribution-only use stays restricted without an additional restriction record", async () => {
    const f = await seedCapturedSources();
    await qualifyWithConflict(f, ["supported"]);
    const rows = await f.t
        .withIdentity({ subject: f.userId })
        .query(api.sourcesWorkspace.listSources, { runId: f.runId });
    expect(rows?.find((row) => row.sourceId === f.sourceId)).toMatchObject({
        contributions: {
            supported: 1,
            restricted: 0,
            effectiveUses: {
                documentary: 0,
                attributed_argument_only: 1,
                context_only: 0,
                blocked: 0,
            },
        },
    });
    expect((await workbenchFacts(f)).availableMaterials).toEqual(
        expect.arrayContaining([
            expect.objectContaining({
                sourceId: f.sourceId,
                documentaryState: expect.objectContaining({
                    contributions: expect.objectContaining({
                        supported: 1,
                        restricted: 0,
                        effectiveUses: {
                            documentary: 0,
                            attributed_argument_only: 1,
                            context_only: 0,
                            blocked: 0,
                        },
                    }),
                }),
            }),
        ]),
    );
});

test("context-only effective permission reaches Sources and Workbench without an extra restriction", async () => {
    const f = await seedCapturedSources();
    await qualifyWithConflict(f, ["supported"], "context_only");
    const rows = await f.t
        .withIdentity({ subject: f.userId })
        .query(api.sourcesWorkspace.listSources, { runId: f.runId });
    expect(rows?.find((row) => row.sourceId === f.sourceId)).toMatchObject({
        contextOnly: true,
        contributions: {
            supported: 1,
            restricted: 0,
            effectiveUses: {
                documentary: 0,
                attributed_argument_only: 0,
                context_only: 1,
                blocked: 0,
            },
        },
    });
    const context = await workbenchFacts(f);
    expect(context.availableMaterials).toEqual(
        expect.arrayContaining([
            expect.objectContaining({
                sourceId: f.sourceId,
                documentaryState: expect.objectContaining({
                    contextOnly: true,
                    contributions: expect.objectContaining({
                        supported: 1,
                        restricted: 0,
                        effectiveUses: {
                            documentary: 0,
                            attributed_argument_only: 0,
                            context_only: 1,
                            blocked: 0,
                        },
                    }),
                }),
            }),
        ]),
    );
    expect(context.documentaryPreparation).toMatchObject({
        controlledContributions: [
            expect.objectContaining({
                sourceId: f.sourceId,
                contributions: [
                    expect.objectContaining({
                        permittedUse: "context_only",
                        restrictions: [],
                    }),
                ],
            }),
        ],
    });
});

test("retained context counts follow the frozen capture when a newer capture is unqualified", async () => {
    const f = await seedCapturedSources();
    const requestId = await qualifyWithConflict(
        f,
        ["supported"],
        "context_only",
    );
    await f.t.run((ctx) =>
        completeSources(ctx, f.preparationId, {
            kind: "complete",
            needsRevision: 1,
            needs: [
                {
                    needId: "common-context",
                    unfinished: [],
                    workRequestIds: [requestId],
                },
            ],
        }),
    );
    await f.t.run(async (ctx) => {
        const capture = await ctx.db.get(f.captureId);
        assert(capture);
        const { _id, _creationTime, ...fields } = capture;
        await ctx.db.insert("sourceCaptures", {
            ...fields,
            captureKey: "newer-unqualified-context",
            contentHash: "newer-capture-hash",
            updatedAt: capture.updatedAt + 1,
        });
    });
    const owner = f.t.withIdentity({ subject: f.userId });
    expect(
        await owner.query(api.sourcesWorkspace.overview, { runId: f.runId }),
    ).toMatchObject({
        organize: { retained: 1, contextOnly: 1 },
        retainedContributions: { effectiveUses: { context_only: 1 } },
    });
    const rows = await owner.query(api.sourcesWorkspace.listSources, {
        runId: f.runId,
    });
    expect(rows?.find((row) => row.sourceId === f.sourceId)).toMatchObject({
        contextOnly: false,
        qualification: { status: "not_recorded" },
        contributions: null,
        retainedSnapshot: { captureId: f.captureId },
    });
    const frozen = await f.t.run((ctx) => ctx.db.get(f.preparationId));
    await owner.mutation(api.sources.decide, {
        runId: f.runId,
        corpusRevisionId: f.corpusRevisionId,
        sourceId: f.sourceId,
        decision: "rejected",
        decisionKey: "exclude-frozen-context",
    });
    expect(
        await owner.query(api.sourcesWorkspace.overview, { runId: f.runId }),
    ).toMatchObject({
        organize: { retained: 0, contextOnly: 0, excluded: 1 },
        retainedContributions: { total: 0 },
    });
    expect(
        (
            await owner.query(api.sourcesWorkspace.listSources, {
                runId: f.runId,
            })
        )?.find((row) => row.sourceId === f.sourceId),
    ).toMatchObject({
        membership: "excluded",
        retainedSnapshot: { captureId: f.captureId },
    });
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.preparationId)))?.sourcesMission
            ?.result,
    ).toEqual(frozen?.sourcesMission?.result);
});

test("a corpus-scoped index keeps an already qualified excerpt readable and retained across upgrade", async () => {
    const f = await seedCapturedSources();
    const requestId = await qualifyWithConflict(
        f,
        ["supported"],
        "context_only",
    );
    await f.t.run(async (ctx) => {
        const scopeKey = `${f.runId}:${f.corpusRevisionId}:structured-v1`;
        for (const passage of await ctx.db
            .query("sourceSearchPassages")
            .collect()) {
            if (passage.captureId === f.captureId)
                await ctx.db.patch(passage._id, { scopeKey });
        }
        for (const index of await ctx.db
            .query("sourceSearchCaptures")
            .collect()) {
            if (index.captureId === f.captureId)
                await ctx.db.patch(index._id, { scopeKey });
        }
    });
    const owner = f.t.withIdentity({ subject: f.userId });
    const reader = await owner.query(api.sourcesWorkspace.getSource, {
        runId: f.runId,
        sourceId: f.sourceId,
    });
    expect(
        reader?.sections.flatMap((section) => section.passages),
    ).toContainEqual({
        order: f.passage.order,
        quotation: f.passage.quotation,
    });
    await f.t.run((ctx) =>
        completeSources(ctx, f.preparationId, {
            kind: "complete",
            needsRevision: 1,
            needs: [
                {
                    needId: "common-context",
                    unfinished: [],
                    workRequestIds: [requestId],
                },
            ],
        }),
    );
    const prepared = await owner.query(api.sourcesMission.getPreparedMaterial, {
        runId: f.runId,
    });
    expect(prepared?.material?.documents).toContainEqual(
        expect.objectContaining({
            sourceId: f.sourceId,
            captureId: f.captureId,
        }),
    );
});

test("Sources counts an unselected capture with unknown completeness as available after handoff", async () => {
    const f = await seedCapturedSources();
    await f.t.run(async (ctx) => {
        await ctx.db.patch(f.captureId, {
            representationCompleteness: "unknown",
            readingCompleteness: undefined,
        });
        await completeSources(ctx, f.preparationId, {
            kind: "complete",
            needsRevision: 1,
            needs: [
                {
                    needId: "common-context",
                    unfinished: ["No qualifying evidence was recorded."],
                    workRequestIds: [],
                },
            ],
        });
    });
    const overview = await f.t
        .withIdentity({ subject: f.userId })
        .query(api.sourcesWorkspace.overview, { runId: f.runId });
    expect(overview).toMatchObject({
        reading: { captured: 1, unknown: 1 },
        organize: {
            notRetained: 1,
            notRetainedCaptured: 1,
            notRetainedWithoutAvailableCapture: 0,
        },
    });
});
