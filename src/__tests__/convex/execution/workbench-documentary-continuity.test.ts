import { api, internal } from "@convex/_generated/api";
import { getAgentDefinition } from "@convex/execution/agentCatalog";
import { modelOperationOutcome } from "@convex/execution/agentDefinition";
import type { FunctionArgs } from "convex/server";
import { afterEach, assert, expect, test, vi } from "vitest";
import { nativePiFixtureRoute } from "@/__tests__/setup/pi-native";
import { seedWorkbench } from "@/__tests__/setup/workbench";

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
});

async function documentaryTurn() {
    vi.stubEnv("EXA_API_KEY", "fixture-only");
    vi.stubEnv(
        "WORKBENCH_PUBLIC_CONTEXT_ALLOWANCE",
        JSON.stringify({ searches: 3, readings: 3 }),
    );
    const calls: string[] = [];
    vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>(async (url, init) => {
            const endpoint = String(url);
            calls.push(endpoint);
            if (endpoint.endsWith("/search"))
                return Response.json({
                    results: [
                        {
                            id: "first",
                            url: "https://example.com/first",
                            title: "First announcement",
                            publishedDate: "2026-11-17",
                        },
                        {
                            id: "second",
                            url: "https://example.com/second",
                            title: "Second announcement",
                            publishedDate: "2026-11-17",
                        },
                    ],
                });
            if (endpoint.endsWith("/contents"))
                return Response.json({
                    results: [
                        {
                            id: JSON.parse(String(init?.body)).urls[0],
                            url: JSON.parse(String(init?.body)).urls[0],
                            publishedDate: "2026-11-17",
                            text: "The insurer retains validation rights. ".repeat(
                                400,
                            ),
                        },
                    ],
                });
            throw new Error(`Unexpected external boundary: ${endpoint}`);
        }),
    );
    const excerpt =
        "Investigate insurer estimate review after the latest announcement.";
    const { t, client, runId } = await seedWorkbench(
        false,
        nativePiFixtureRoute,
        60000,
        excerpt,
        undefined,
        7,
    );
    const active = await t.mutation(
        internal.execution.conversations.startTurn,
        {
            runId,
            definitionId: "workbench_v1",
            scope: { kind: "workbench_v1" },
            simulation: false,
        },
    );
    assert(active);
    const missionId = active.missionId;
    const message = await t.run((ctx) =>
        ctx.db
            .query("agentMessageDeliveries")
            .withIndex("by_turn", (q) => q.eq("turnId", active.turnId))
            .first(),
    );
    assert(message);
    async function dispatch(
        cause: string,
        input: FunctionArgs<
            typeof internal.execution.operations.enqueue
        >["input"],
    ) {
        const id = await t.mutation(internal.execution.operations.enqueue, {
            missionId,
            expectedGeneration: 1,
            cause,
            input,
        });
        const outcome = await t.action(internal.execution.operations.dispatch, {
            requestId: id,
            expectedGeneration: 1,
        });
        return { id, outcome };
    }
    return { t, client, runId, active, message, dispatch, calls, excerpt };
}

test("provisional saves preserve candidate, continuation and new citation authority", async () => {
    const { t, client, runId, active, message, dispatch, calls, excerpt } =
        await documentaryTurn();
    const search = await dispatch("research-search", {
        kind: "search_public_context",
        messageId: message._id,
        query: "validation rights",
    });
    expect(search.outcome.kind).toBe("success");
    const read = await dispatch("research-read-first", {
        kind: "read_public_context",
        messageId: message._id,
        target: { kind: "candidate", searchId: search.id, index: 0 },
    });
    assert(read.outcome.kind === "success", JSON.stringify(read.outcome));
    expect(JSON.parse(read.outcome.valueJson)).toMatchObject({
        readId: read.id,
        continuation: read.id,
        reference: { url: "https://example.com/first" },
    });
    const content = {
        scope: excerpt,
        questions: [
            {
                id: "rights",
                shortLabel: "Validation rights",
                text: "Who controls estimate validation?",
                rationale: "Identify control of the workflow.",
            },
        ],
    };
    const saved = await dispatch("research-save-open", {
        kind: "adjust_framing",
        messageId: message._id,
        expectedRevision: 1,
        eventBasis: { kind: "open", activityExcerpt: excerpt },
        content,
    });
    expect(saved.outcome.kind).toBe("success");
    expect(await client.query(api.framing.get, { runId })).toMatchObject({
        revision: 2,
        content,
    });
    const beforeContinuation = [...calls];
    const unread = await dispatch("research-read-second", {
        kind: "read_public_context",
        messageId: message._id,
        target: { kind: "candidate", searchId: search.id, index: 1 },
    });
    expect(unread.outcome.kind).toBe("success");
    const afterSecondRead = [...calls];
    const continued = await dispatch("research-continue-first", {
        kind: "read_public_context",
        messageId: message._id,
        target: { kind: "candidate", searchId: search.id, index: 0 },
        continuation: read.id,
    });
    assert(continued.outcome.kind === "success");
    expect(JSON.parse(continued.outcome.valueJson).range.start).toBeGreaterThan(
        0,
    );
    expect(calls).toEqual(afterSecondRead);
    const cited = await dispatch("research-cite-prior-reading", {
        kind: "adjust_framing",
        messageId: message._id,
        expectedRevision: 2,
        content,
        eventBasis: {
            kind: "public",
            label: "Validation rights",
            readIds: [read.id],
        },
    });
    expect(cited.outcome.kind).toBe("success");
    expect(calls.filter((url) => url.endsWith("/contents"))).toHaveLength(2);
    expect(
        beforeContinuation.filter((url) => url.endsWith("/contents")),
    ).toHaveLength(1);
    expect(await client.query(api.framing.get, { runId })).toMatchObject({
        revision: 3,
        content,
        eventBasis: { kind: "public", readIds: [read.id] },
    });
    const records = await t.run(async (ctx) => ({
        search: await ctx.db.get(search.id),
        read: await ctx.db.get(read.id),
        unread: await ctx.db.get(unread.id),
        run: await ctx.db.get(runId),
    }));
    expect(records.search).toMatchObject({
        status: "completed",
        adoptedAt: expect.any(Number),
        missionId: active.missionId,
        instructionVersion: records.unread?.instructionVersion,
    });
    expect(records.read).toMatchObject({
        status: "completed",
        adoptedAt: expect.any(Number),
    });
    expect(records.search?.pin).not.toEqual(records.unread?.pin);
    expect(records.unread?.pin).not.toEqual({
        kind: "framing_revision",
        revisionId: records.run?.currentFramingRevisionId,
    });
    expect(records.run?.sourcePreparationId).toBeUndefined();
});

test.each([
    ["unadopted", "source_reference_not_observed"],
    ["foreign mission", "source_reference_not_observed"],
    ["changed instruction", "framing_observation_stale"],
    ["invalid index", "source_candidate_invalid"],
    ["different continuation target", "source_continuation_invalid"],
] as const)("%s is refused before acquisition", async (fault, code) => {
    const { t, client, runId, message, dispatch, calls } =
        await documentaryTurn();
    const search = await dispatch("search", {
        kind: "search_public_context",
        messageId: message._id,
        query: "validation rights",
    });
    expect(search.outcome.kind).toBe("success");
    const read = await dispatch("read", {
        kind: "read_public_context",
        messageId: message._id,
        target: { kind: "candidate", searchId: search.id, index: 0 },
    });
    expect(read.outcome.kind).toBe("success");
    await t.run(async (ctx) => {
        if (fault === "unadopted")
            await ctx.db.patch(search.id, { adoptedAt: undefined });
        if (fault === "foreign mission")
            await ctx.db.patch(search.id, { missionId: undefined });
        if (fault === "changed instruction")
            await ctx.db.patch(search.id, { instructionVersion: -1 });
    });
    const before = [...calls];
    const attempt = await dispatch("invalid-read", {
        kind: "read_public_context",
        messageId: message._id,
        target: {
            kind: "candidate",
            searchId: search.id,
            index: fault === "invalid index" ? 99 : 1,
        },
        ...(fault === "different continuation target"
            ? { continuation: read.id }
            : {}),
    });
    expect(attempt.outcome).toMatchObject({ kind: "unavailable", code });
    const rendered = JSON.parse(
        modelOperationOutcome(
            getAgentDefinition("workbench_v1", 7),
            attempt.outcome,
        ),
    );
    expect(rendered.diagnostic).toMatch(
        code === "framing_observation_stale"
            ? /active message|instructions/
            : code === "source_candidate_invalid"
              ? /index/
              : code === "source_continuation_invalid"
                ? /continuation/
                : /observed|adopted/,
    );
    expect(calls).toEqual(before);
    expect(await client.query(api.framing.get, { runId })).toMatchObject({
        revision: 1,
        content: { scope: "", questions: [] },
    });
});

test("new citations distinguish superseded instruction authority from an invalid reading identifier", async () => {
    const { t, client, runId, message, dispatch, excerpt } =
        await documentaryTurn();
    const search = await dispatch("search", {
        kind: "search_public_context",
        messageId: message._id,
        query: "validation rights",
    });
    const read = await dispatch("read", {
        kind: "read_public_context",
        messageId: message._id,
        target: { kind: "candidate", searchId: search.id, index: 0 },
    });
    expect(read.outcome.kind).toBe("success");
    await t.run((ctx) => ctx.db.patch(read.id, { instructionVersion: -1 }));
    const cited = await dispatch("cite-stale-reading", {
        kind: "adjust_framing",
        messageId: message._id,
        expectedRevision: 1,
        content: {
            scope: excerpt,
            questions: [
                {
                    id: "rights",
                    shortLabel: "Rights",
                    text: "Who controls validation?",
                    rationale: "Locate authority.",
                },
            ],
        },
        eventBasis: {
            kind: "public",
            label: "Validation rights",
            readIds: [read.id],
        },
    });
    expect(cited.outcome).toMatchObject({
        kind: "refused",
        code: "framing_observation_stale",
        validation: { path: "eventBasis.readIds" },
    });
    expect(await client.query(api.framing.get, { runId })).toMatchObject({
        revision: 1,
        content: { scope: "", questions: [] },
    });
});
