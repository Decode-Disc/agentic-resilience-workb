import { internal } from "@convex/_generated/api";
import { readWorkbenchFacts } from "@convex/domain/workbenchContext";
import { assert, expect, test } from "vitest";
import { seedCapturedSources } from "@/__tests__/setup/sources-mission";

test("an exhausted discovery allowance refuses only discovery and records its specific reason", async () => {
    const f = await seedCapturedSources();
    await f.t.run(async (ctx) => {
        const preparation = await ctx.db.get(f.preparationId);
        assert(preparation?.sourcesMission);
        await ctx.db.patch(f.preparationId, {
            sourcesMission: {
                ...preparation.sourcesMission,
                searches: 6,
                envelope: {
                    ...preparation.sourcesMission.envelope,
                    initialSearches: 6,
                },
            },
        });
    });
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: f.missionId,
            expectedGeneration: 4,
            cause: "exhausted-discovery",
            input: {
                kind: "discover_sources_for_need",
                needId: "common-context",
                query: "another independent source",
            },
        },
    );
    const outcome = await f.t.action(internal.execution.operations.dispatch, {
        requestId,
        expectedGeneration: 4,
    });
    expect(outcome).toMatchObject({
        kind: "refused",
        code: "sources_discovery_limit",
    });
    const readingId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: f.missionId,
            expectedGeneration: 4,
            cause: "reading-after-discovery-limit",
            input: {
                kind: "search_available_material",
                sourceId: f.sourceId,
                query: "workflow",
            },
        },
    );
    expect(
        await f.t.action(internal.execution.operations.dispatch, {
            requestId: readingId,
            expectedGeneration: 4,
        }),
    ).toMatchObject({ kind: "success" });
    expect(await f.t.run((ctx) => ctx.db.get(requestId))).toMatchObject({
        outcome: { kind: "refused", code: "sources_discovery_limit" },
    });
});

test("Sources and Workbench expose the same phase-bound discovery allowance", async () => {
    const f = await seedCapturedSources();
    await f.t.run(async (ctx) => {
        const preparation = await ctx.db.get(f.preparationId);
        assert(preparation?.sourcesMission);
        await ctx.db.patch(f.preparationId, {
            sourcesMission: {
                ...preparation.sourcesMission,
                phase: "investigation_complement",
                searches: 2,
            },
        });
    });
    const source = await f.t.query(internal.execution.context.build, {
        missionId: f.missionId,
        expectedGeneration: 4,
    });
    assert(source.kind === "ready");
    const workbench = await f.t.run(async (ctx) => {
        const run = await ctx.db.get(f.runId);
        assert(run);
        return readWorkbenchFacts(ctx, run);
    });
    assert(workbench.kind === "ready");
    const allowance = JSON.parse(source.inputJson).activeWork.allowance;
    expect(allowance.searches).toEqual({
        used: 2,
        limit: 3,
        blockCode: null,
        operation: "discover_sources_for_need",
    });
    expect(workbench.context).toMatchObject({
        documentaryPreparation: { allowance },
    });
});

test.each([
    ["acquisitions", "sources_acquisition_limit"],
    ["controls", "sources_control_limit"],
] as const)("an exhausted %s allowance keeps its own refusal reason", async (resource, code) => {
    const f = await seedCapturedSources();
    await f.t.run(async (ctx) => {
        const preparation = await ctx.db.get(f.preparationId);
        assert(preparation?.sourcesMission);
        await ctx.db.patch(f.preparationId, {
            sourcesMission: {
                ...preparation.sourcesMission,
                [resource]: preparation.sourcesMission.envelope[resource],
            },
        });
    });
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: f.missionId,
            expectedGeneration: 4,
            cause: `exhausted-${resource}`,
            input:
                resource === "acquisitions"
                    ? {
                          kind: "make_source_consultable",
                          sourceId: f.sourceId,
                          needId: "common-context",
                      }
                    : {
                          kind: "request_documentary_check",
                          sourceId: f.sourceId,
                          needId: "common-context",
                          proposition: "The document describes the workflow.",
                          evidence: [
                              {
                                  readRequestId: f.readRequestId,
                                  passageOrder: f.passage.order,
                              },
                          ],
                      },
        },
    );
    expect(
        await f.t.action(internal.execution.operations.dispatch, {
            requestId,
            expectedGeneration: 4,
        }),
    ).toMatchObject({ kind: "refused", code });
});

test("the preparation work capacity has a distinct refusal without consuming discovery", async () => {
    const f = await seedCapturedSources();
    await f.t.run(async (ctx) => {
        const preparation = await ctx.db.get(f.preparationId);
        assert(preparation?.sourcesMission);
        await ctx.db.patch(f.preparationId, {
            sourcesMission: {
                ...preparation.sourcesMission,
                work: Array.from({ length: 160 }, () => ({
                    kind: "discover_sources_for_need" as const,
                    requestId: f.readRequestId,
                    needIds: ["common-context"],
                })),
            },
        });
    });
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: f.missionId,
            expectedGeneration: 4,
            cause: "preparation-work-capacity",
            input: {
                kind: "discover_sources_for_need",
                needId: "common-context",
                query: "a useful new source",
            },
        },
    );
    expect(
        await f.t.action(internal.execution.operations.dispatch, {
            requestId,
            expectedGeneration: 4,
        }),
    ).toMatchObject({ kind: "refused", code: "sources_work_limit" });
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.preparationId)))?.sourcesMission,
    ).toMatchObject({ searches: 0 });
});

test("seven saved-material searches do not consume the external discovery allowance", async () => {
    const f = await seedCapturedSources();
    for (let i = 0; i < 6; i++) {
        const requestId = await f.t.mutation(
            internal.execution.operations.enqueue,
            {
                missionId: f.missionId,
                expectedGeneration: 4,
                cause: `saved-material-search-${i}`,
                input: {
                    kind: "search_available_material",
                    sourceId: f.sourceId,
                    query: `workflow ${i}`,
                },
            },
        );
        expect(
            await f.t.action(internal.execution.operations.dispatch, {
                requestId,
                expectedGeneration: 4,
            }),
        ).toMatchObject({ kind: "success" });
    }
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.preparationId)))?.sourcesMission,
    ).toMatchObject({ searches: 0 });
});

test("a limited passage page remains continuable without consuming discovery", async () => {
    const f = await seedCapturedSources({
        text: Array.from(
            { length: 80 },
            (_, i) =>
                `# Workflow ${i}\n\nWorkflow ${i}: ${"documentary description ".repeat(100)}`,
        ).join("\n\n"),
    });
    const first = await f.t.run((ctx) => ctx.db.get(f.readRequestId));
    assert(first?.outcome?.kind === "success");
    const page = JSON.parse(first.outcome.valueJson);
    expect(page.limitReached).toBe(true);
    expect(page.continuation).toEqual(expect.any(String));
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: f.missionId,
            expectedGeneration: 4,
            cause: "next-passage-page",
            input: {
                kind: "search_available_material",
                sourceId: f.sourceId,
                query: "workflow",
                continuation: page.continuation,
            },
        },
    );
    const outcome = await f.t.action(internal.execution.operations.dispatch, {
        requestId,
        expectedGeneration: 4,
    });
    assert(outcome.kind === "success");
    const next = JSON.parse(outcome.valueJson);
    expect(next.passages.length).toBeGreaterThan(0);
    expect(next.passages[0].passageOrder).not.toBe(
        page.passages[0].passageOrder,
    );
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.preparationId)))?.sourcesMission,
    ).toMatchObject({ searches: 0 });
});
