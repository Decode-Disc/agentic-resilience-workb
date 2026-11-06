import { api, internal } from "@convex/_generated/api";
import {
    completeSources,
    summarizeSourcesPreparation,
} from "@convex/domain/sources";
import { extractObservedDestinations } from "@convex/integrations/evidenceNormalization";
import { approvedPassagesForMission } from "@convex/sourceRetrieval";
import { afterEach, assert, expect, test, vi } from "vitest";
import { seedCapturedSources } from "@/__tests__/setup/sources-mission";

afterEach(() => vi.restoreAllMocks());

test("contextual passage batch RPC declares its return contract", () => {
    assert("exportReturns" in approvedPassagesForMission);
    assert(typeof approvedPassagesForMission.exportReturns === "function");
    const serialized: unknown = approvedPassagesForMission.exportReturns();
    assert(typeof serialized === "string");
    expect(JSON.parse(serialized)).not.toBeNull();
});

test("a retained operation result without capture omission metadata remains usable and immutable", async () => {
    const f = await seedCapturedSources();
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueueNative,
        {
            runId: f.runId,
            expectedGeneration: 4,
            cause: "retained-reading",
            input: {
                kind: "search_available_material",
                sourceId: f.sourceId,
                query: "workflow",
            },
        },
    );
    const current = await f.t.action(internal.execution.operations.dispatch, {
        requestId,
        expectedGeneration: 4,
    });
    assert(current.kind === "success");
    const value = JSON.parse(current.valueJson);
    expect(value.documentaryStatus.capture).toHaveProperty(
        "captureOmittedPassageCount",
    );
    delete value.documentaryStatus.capture.captureOmittedPassageCount;
    const retained = { ...current, valueJson: JSON.stringify(value) };
    await f.t.run((ctx) =>
        ctx.db.patch(requestId, {
            status: "observed",
            outcome: retained,
            adoptionRefusalCode: undefined,
            completedAt: undefined,
        }),
    );
    expect(
        await f.t.action(internal.execution.operations.dispatch, {
            requestId,
            expectedGeneration: 4,
        }),
    ).toEqual(retained);
    expect((await f.t.run((ctx) => ctx.db.get(requestId)))?.outcome).toEqual(
        retained,
    );
});

test.each([
    "native",
    "mission",
] as const)("blank saved-material search is refused without reading or establishing a gap: %s", async (mode) => {
    const f = await seedCapturedSources();
    const input = {
        kind: "search_available_material" as const,
        sourceId: f.sourceId,
        query: "   ",
    };
    const requestId =
        mode === "native"
            ? await f.t.mutation(internal.execution.operations.enqueueNative, {
                  runId: f.runId,
                  expectedGeneration: 4,
                  cause: "blank-search",
                  input,
              })
            : await f.t.mutation(internal.execution.operations.enqueue, {
                  missionId: f.missionId,
                  expectedGeneration: 4,
                  cause: "blank-search",
                  input,
              });
    const reads = vi.spyOn(Blob.prototype, "text");
    expect(
        await f.t.action(internal.execution.operations.dispatch, {
            requestId,
            expectedGeneration: 4,
        }),
    ).toMatchObject({ kind: "refused", code: "retrieval_query_invalid" });
    expect(reads).not.toHaveBeenCalled();
    await expect(
        f.t.run((ctx) =>
            completeSources(ctx, f.preparationId, {
                kind: "complete",
                needsRevision: 1,
                needs: [
                    {
                        needId: "common-context",
                        gap: "Nothing found.",
                        unfinished: [],
                        workRequestIds: [requestId],
                    },
                ],
            }),
        ),
    ).rejects.toThrow("sources_work_unfinished");
});

test("a historical successful blank search cannot establish an examined gap", async () => {
    const f = await seedCapturedSources();
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueueNative,
        {
            runId: f.runId,
            expectedGeneration: 4,
            cause: "historical-search",
            input: {
                kind: "search_available_material",
                sourceId: f.sourceId,
                query: "workflow",
            },
        },
    );
    expect(
        await f.t.action(internal.execution.operations.dispatch, {
            requestId,
            expectedGeneration: 4,
        }),
    ).toMatchObject({ kind: "success" });
    await f.t.run((ctx) =>
        ctx.db.patch(requestId, {
            input: {
                kind: "search_available_material",
                sourceId: f.sourceId,
                query: "   ",
            },
        }),
    );
    await expect(
        f.t.run((ctx) =>
            completeSources(ctx, f.preparationId, {
                kind: "complete",
                needsRevision: 1,
                needs: [
                    {
                        needId: "common-context",
                        gap: "Nothing found.",
                        unfinished: [],
                        workRequestIds: [requestId],
                    },
                ],
            }),
        ),
    ).rejects.toThrow("documentary_gap_not_examined");
});

test("the conversational summary bounds need previews while retaining their total and exact preparation reference", async () => {
    const f = await seedCapturedSources();
    const preparation = await f.t.run((ctx) => ctx.db.get(f.preparationId));
    assert(preparation?.sourcesMission);
    const summary = summarizeSourcesPreparation({
        ...preparation,
        sourcesMission: {
            ...preparation.sourcesMission,
            needs: Array.from({ length: 160 }, (_, i) => ({
                id: `instruction-${i}`,
                version: 1,
                information: "研究".repeat(1000),
                questionIds: [],
                commonContext: false,
            })),
        },
    });
    expect(
        new TextEncoder().encode(JSON.stringify(summary)).length,
    ).toBeLessThan(32 * 1024);
    expect(summary).toMatchObject({
        preparationId: f.preparationId,
        needCount: 160,
        needsPreviewComplete: false,
    });
});

test("Workbench lists large retained captures within one transaction without hydrating every capture per source", async () => {
    const f = await seedCapturedSources();
    const destinations = extractObservedDestinations(
        Array.from(
            { length: 64 },
            (_, i) =>
                `<a href="${" ".repeat(2200)}https://example.com/${i}/${"a".repeat(1990)}">Guide</a>`,
        ).join("\n"),
        "https://example.com",
    );
    const sourceIds = await f.t.run(async (ctx) => {
        const capture = await ctx.db.get(f.captureId);
        const preparation = await ctx.db.get(f.preparationId);
        assert(capture && preparation?.sourcesMission);
        const { _id, _creationTime, ...value } = capture;
        const ids = [f.sourceId];
        const captureIds = [f.captureId];
        await ctx.db.patch(f.captureId, { observedDestinations: destinations });
        for (let i = 1; i < 48; i++) {
            const sourceId = await ctx.db.insert("sources", {
                runId: f.runId,
                canonicalUrl: `https://example.com/${i}`,
                title: `Document ${i}`,
                origin: "exa",
                category: "research_lead",
                createdAt: 1,
            });
            ids.push(sourceId);
            captureIds.push(
                await ctx.db.insert("sourceCaptures", {
                    ...value,
                    sourceId,
                    captureKey: `capture-${i}`,
                    observedDestinations: destinations,
                }),
            );
        }
        await ctx.db.patch(f.preparationId, {
            sourcesMission: { ...preparation.sourcesMission, captureIds },
        });
        await ctx.db.patch(f.runId, {
            startMode: "framed",
            agentExecutionVersion: 3,
        });
        return ids;
    });
    await f.t
        .withIdentity({ subject: f.userId })
        .mutation(api.execution.conversations.submit, {
            runId: f.runId,
            requestKey: "list-captures",
            text: "What material is available?",
            delivery: "queue",
        });
    const turnId = await f.t.mutation(
        internal.execution.conversations.claimTurn,
        { runId: f.runId, single: true },
    );
    assert(turnId);
    const missionId = await f.t.mutation(internal.execution.missions.start, {
        runId: f.runId,
        definitionId: "workbench_v1",
        scope: { kind: "workbench_v1" },
        conversationTurnId: turnId,
        expectedGeneration: 1,
        requestKey: "list-material",
    });
    const available = await f.t.run((ctx) =>
        ctx.runQuery(
            internal.sourceRetrieval.availableCapturesForMission,
            { missionId, expectedGeneration: 1, sourceIds },
            { transactionLimits: { bytesRead: 16 * 1024 * 1024 } },
        ),
    );
    expect(available).toEqual(sourceIds);
});

test("shared reading stays usable when the capture contains large observed destinations", async () => {
    const f = await seedCapturedSources();
    const html = Array.from(
        { length: 20 },
        (_, i) =>
            `<a href="https://example.com/${i}/${"a".repeat(1750)}">Guide ${i}</a>`,
    ).join("\n");
    const observedDestinations = extractObservedDestinations(
        html,
        "https://example.com",
    );
    await f.t.run((ctx) => ctx.db.patch(f.captureId, { observedDestinations }));
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueueNative,
        {
            runId: f.runId,
            expectedGeneration: 4,
            cause: "bounded-read",
            input: {
                kind: "search_available_material",
                sourceId: f.sourceId,
                query: "workflow",
            },
        },
    );
    const outcome = await f.t.action(internal.execution.operations.dispatch, {
        requestId,
        expectedGeneration: 4,
    });
    expect(outcome).toMatchObject({ kind: "success" });
    assert(outcome.kind === "success");
    expect(new TextEncoder().encode(outcome.valueJson).length).toBeLessThan(
        65536,
    );
    const value = JSON.parse(outcome.valueJson);
    expect(value.documentaryStatus.capture).toMatchObject({
        _id: f.captureId,
        observedDestinationCount: 20,
    });
    expect(value.documentaryStatus.observedDestinations).toHaveLength(20);
    expect(value.documentaryStatus.observedDestinations[0]).toMatchObject({
        index: 0,
    });
    expect(outcome.valueJson).not.toContain("storageId");
});
