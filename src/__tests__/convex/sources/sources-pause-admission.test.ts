import { api, internal } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { afterEach, expect, test, vi } from "vitest";
import {
    seedCapturedSources,
    startSourcesOperation,
} from "@/__tests__/setup/sources-mission";

afterEach(() => vi.useRealTimers());

test("native acquisition shares the persisted preparation concurrency limit and preserves refused allowance", async () => {
    const f = await seedCapturedSources();
    await f.t.run((ctx) =>
        ctx.db.patch(f.preparationId, { maxConcurrentSources: 2 }),
    );
    const requests: Id<"agentOperationRequests">[] = [];
    for (let i = 0; i < 3; i++) {
        const sourceId = await f.t.run((ctx) =>
            ctx.db.insert("sources", {
                runId: f.runId,
                canonicalUrl: `https://example.com/concurrent-${i}`,
                title: `Candidate ${i}`,
                origin: "exa",
                category: "research_lead",
                createdAt: 1,
            }),
        );
        const requestId = await f.t.mutation(
            internal.execution.operations.enqueueNative,
            {
                runId: f.runId,
                expectedGeneration: 4,
                cause: `acquire-${i}`,
                input: {
                    kind: "make_source_consultable",
                    sourceId,
                    needId: "common-context",
                },
            },
        );
        expect(
            await startSourcesOperation(f.t, {
                requestId,
                expectedGeneration: 4,
            }),
        ).toMatchObject({ kind: "outcome", outcome: { kind: "waiting" } });
        requests.push(requestId);
    }
    for (const requestId of requests.slice(0, 2))
        await f.t.mutation(internal.sourcesMission.reserve, {
            requestId,
            expectedGeneration: 4,
        });
    const third = requests[2];
    if (!third) throw new Error("Missing third acquisition");
    await expect(
        f.t.mutation(internal.sourcesMission.reserve, {
            requestId: third,
            expectedGeneration: 4,
        }),
    ).rejects.toThrow("preparation_concurrency_limit");
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.preparationId)))?.sourcesMission
            ?.acquisitions,
    ).toBe(2);
    const first = requests[0];
    if (!first) throw new Error("Missing first acquisition");
    await f.t.run((ctx) =>
        ctx.db.patch(first, {
            status: "completed",
            outcome: { kind: "success", valueJson: "{}" },
        }),
    );
    await f.t.mutation(internal.sourcesMission.reserve, {
        requestId: third,
        expectedGeneration: 4,
    });
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.preparationId)))?.sourcesMission
            ?.acquisitions,
    ).toBe(3);
});

test("a framed research pause is applied before admitting Sources' next operation", async () => {
    vi.useFakeTimers();
    const f = await seedCapturedSources();
    await f.t.run(async (ctx) => {
        const frameId = await ctx.db.insert("framingRevisions", {
            runId: f.runId,
            revision: 1,
            content: { scope: "Fixed workflow", questions: [] },
            requestKey: "fixed",
            contentHash: "fixture",
            origin: "analyst",
            createdAt: 1,
        });
        await ctx.db.patch(f.runId, {
            startMode: "framed",
            agentExecutionVersion: 3,
            fixedFramingRevisionId: frameId,
        });
    });
    await f.t
        .withIdentity({ subject: f.userId })
        .mutation(api.execution.researchControl.pause, {
            runId: f.runId,
            expectedGeneration: 4,
        });
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: f.missionId,
            expectedGeneration: 4,
            cause: "next-query",
            input: {
                kind: "discover_sources_for_need",
                needId: "common-context",
                query: "interoperability",
            },
        },
    );
    const claim = await startSourcesOperation(f.t, {
        requestId,
        expectedGeneration: 4,
    });
    expect(claim).toMatchObject({
        kind: "outcome",
        outcome: { kind: "unavailable", code: "research_paused" },
    });
    expect(await f.t.run((ctx) => ctx.db.get(f.runId))).toMatchObject({
        executionStatus: "paused",
        pauseReason: "analyst",
        researchPauseRequested: false,
    });
    expect(await f.t.run((ctx) => ctx.db.get(requestId))).toMatchObject({
        status: "pending",
    });
    expect(
        await f.t.run((ctx) =>
            ctx.db
                .query("providerCalls")
                .withIndex("by_run", (q) => q.eq("runId", f.runId))
                .take(1),
        ),
    ).toEqual([]);
    const paused = await f.t.run((ctx) => ctx.db.get(f.runId));
    if (!paused) throw new Error("Missing paused dossier");
    const generation = await f.t
        .withIdentity({ subject: f.userId })
        .mutation(api.execution.researchControl.resume, {
            runId: f.runId,
            expectedGeneration: paused.executionGeneration,
        });
    await f.t.mutation(internal.execution.missions.resume, {
        missionId: f.missionId,
        expectedGeneration: generation,
    });
    await f.t.mutation(internal.execution.piControl.rebind, {
        missionId: f.missionId,
        expectedGeneration: generation,
        stage: 0,
        cursor: null,
    });
    expect(
        await startSourcesOperation(f.t, {
            requestId,
            expectedGeneration: generation,
        }),
    ).toMatchObject({ kind: "outcome", outcome: { kind: "waiting" } });
    const reserved = await f.t.mutation(internal.sourcesMission.reserve, {
        requestId,
        expectedGeneration: generation,
    });
    expect(reserved.input).toMatchObject({
        kind: "discover_sources_for_need",
        query: "interoperability",
    });
});

test("a pending analyst pause also blocks the next research model invocation", async () => {
    vi.useFakeTimers();
    const f = await seedCapturedSources();
    await f.t.run(async (ctx) => {
        const frameId = await ctx.db.insert("framingRevisions", {
            runId: f.runId,
            revision: 1,
            content: { scope: "Fixed workflow", questions: [] },
            requestKey: "fixed",
            contentHash: "fixture",
            origin: "analyst",
            createdAt: 1,
        });
        await ctx.db.patch(f.runId, {
            startMode: "framed",
            agentExecutionVersion: 3,
            fixedFramingRevisionId: frameId,
        });
    });
    await f.t
        .withIdentity({ subject: f.userId })
        .mutation(api.execution.researchControl.pause, {
            runId: f.runId,
            expectedGeneration: 4,
        });
    expect(
        await f.t.mutation(internal.execution.invocations.begin, {
            missionId: f.missionId,
            expectedGeneration: 4,
            taskKey: "after-pause",
            provenance: "simulation",
        }),
    ).toEqual({ kind: "blocked", code: "research_paused" });
    expect(await f.t.run((ctx) => ctx.db.get(f.runId))).toMatchObject({
        executionStatus: "paused",
        pauseReason: "analyst",
    });
});

test("a requested pause refuses new native research dispatch while an engaged operation drains", async () => {
    vi.useFakeTimers();
    const f = await seedCapturedSources();
    await f.t.run(async (ctx) => {
        const frameId = await ctx.db.insert("framingRevisions", {
            runId: f.runId,
            revision: 1,
            content: { scope: "Fixed workflow", questions: [] },
            requestKey: "fixed",
            contentHash: "fixture",
            origin: "analyst",
            createdAt: 1,
        });
        await ctx.db.patch(f.runId, {
            startMode: "framed",
            agentExecutionVersion: 3,
            fixedFramingRevisionId: frameId,
        });
    });
    const enqueue = (query: string) =>
        f.t.mutation(internal.execution.operations.enqueueNative, {
            runId: f.runId,
            expectedGeneration: 4,
            cause: query,
            input: {
                kind: "discover_sources_for_need",
                needId: "common-context",
                query,
            },
        });
    const engagedId = await enqueue("engaged-search");
    const nextId = await enqueue("next-search");
    expect(
        await startSourcesOperation(f.t, {
            requestId: engagedId,
            expectedGeneration: 4,
        }),
    ).toMatchObject({ kind: "outcome", outcome: { kind: "waiting" } });
    await f.t
        .withIdentity({ subject: f.userId })
        .mutation(api.execution.researchControl.pause, {
            runId: f.runId,
            expectedGeneration: 4,
        });
    expect(
        await startSourcesOperation(f.t, {
            requestId: nextId,
            expectedGeneration: 4,
        }),
    ).toMatchObject({
        kind: "outcome",
        outcome: { kind: "unavailable", code: "research_paused" },
    });
    expect(await f.t.run((ctx) => ctx.db.get(nextId))).toMatchObject({
        status: "pending",
    });
    expect(await f.t.run((ctx) => ctx.db.get(f.runId))).toMatchObject({
        executionStatus: "running",
        researchPauseRequested: true,
        executionGeneration: 4,
    });
    await f.t.run((ctx) =>
        ctx.db.patch(f.missionId, { piActiveWriter: "pause-writer" }),
    );
    await f.t.mutation(internal.execution.piControl.closeWorker, {
        missionId: f.missionId,
        expectedGeneration: 4,
        writer: "pause-writer",
        error: "research_paused",
    });
    expect(await f.t.run((ctx) => ctx.db.get(f.missionId))).toMatchObject({
        status: "waiting",
    });
    await f.t.mutation(internal.execution.operations.recordResult, {
        requestId: engagedId,
        expectedGeneration: 4,
        outcome: { kind: "unavailable", code: "missing_configuration" },
    });
    expect(await f.t.run((ctx) => ctx.db.get(f.runId))).toMatchObject({
        executionStatus: "paused",
        researchPauseRequested: false,
        executionGeneration: 5,
    });
});
