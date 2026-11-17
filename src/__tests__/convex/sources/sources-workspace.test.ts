import { api, internal } from "@convex/_generated/api";
import { completeSources } from "@convex/domain/sources";
import { afterEach, assert, expect, test, vi } from "vitest";
import { installModel } from "@/__tests__/setup/model-configuration";
import { seedCapturedSources } from "@/__tests__/setup/sources-mission";

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

async function qualifyWithConflict(f: Fixture) {
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
                findings: input.contributions.map((c: { id: string }) => ({
                    contributionId: c.id,
                    conclusion: "documentary_conflict",
                    permittedUse: "attributed_argument_only",
                    diagnostic: "Another filing states a different scope.",
                })),
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
                changes: [
                    {
                        contribution: {
                            needIds: ["common-context"],
                            statement:
                                "The publisher describes workflow software.",
                            period: "undated",
                            modality: "publisher statement",
                            attribution: "ServiceNow",
                            kind: "attributed_argument",
                            evidence: [
                                {
                                    readRequestId: f.readRequestId,
                                    passageOrder: f.passage.order,
                                },
                            ],
                        },
                    },
                ],
            },
        },
    );
    const outcome = await f.t.action(internal.execution.operations.dispatch, {
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
    const retained = new Set(
        prepared.material.documents.map((document) => document.sourceId),
    );
    for (const entry of rows ?? [])
        expect(entry.membership).toBe(
            retained.has(entry.sourceId) ? "retained" : "not_retained",
        );
    expect(rows?.find((entry) => entry.sourceId === f.sourceId)).toMatchObject({
        reading: "full",
        contributions: { total: 1, conflict: 1, supported: 0 },
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
