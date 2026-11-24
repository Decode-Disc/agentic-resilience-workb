import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { api, internal } from "@convex/_generated/api";
import type { ActionCtx } from "@convex/_generated/server";
import { getAgentDefinition } from "@convex/execution/agentCatalog";
import {
    agentToolSchemas,
    modelOperationOutcome,
} from "@convex/execution/agentDefinition";
import { buildMissionContext } from "@convex/execution/context";
import { examineDocumentaryContributions } from "@convex/integrations/documentaryControl";
import { piToolMetadata } from "@convex/integrations/modelInput";
import { SOURCE_CONTEXT_PAGE_CHARACTERS } from "@convex/resourcePolicy";
import { requestPinnedPublicSource } from "@convex/sourceActions";
import { acquireDocument } from "@convex/sourceCaptureActions";
import { type FunctionArgs, getFunctionName } from "convex/server";
import { afterEach, assert, expect, test, vi } from "vitest";
import { nativePiFixtureRoute } from "@/__tests__/setup/pi-native";
import {
    dispatchSourcesOperation,
    sourcesTestEnvelope,
} from "@/__tests__/setup/sources-mission";
import { seedWorkbench } from "@/__tests__/setup/workbench";

vi.mock("node:dns/promises", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:dns/promises")>();
    const lookup = vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]);
    return { ...actual, default: { ...actual, lookup }, lookup };
});

vi.mock("@convex/sourceActions", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@convex/sourceActions")>()),
    requestPinnedPublicSource: vi.fn(),
}));
vi.mock("@convex/integrations/documentaryControl", async (importOriginal) => ({
    ...(await importOriginal<
        typeof import("@convex/integrations/documentaryControl")
    >()),
    examineDocumentaryContributions: vi.fn(),
}));

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
});

async function documentaryTurn(
    definitionVersion: 7 | 10 | 11 | 12 | null = 7,
    excerpt = "Investigate insurer estimate review after the latest announcement.",
    requireContextRead = false,
) {
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
    const { t, client, runId } = await seedWorkbench(
        false,
        nativePiFixtureRoute,
        60000,
        excerpt,
        undefined,
        definitionVersion,
    );
    const adminUserId = await t.run(async (ctx) => {
        const slot = await ctx.db
            .query("invitations")
            .withIndex("by_slot_key", (q) => q.eq("slotKey", "admin"))
            .unique();
        const visitor =
            slot?.claimedByVisitorId &&
            (await ctx.db.get(slot.claimedByVisitorId));
        assert(visitor?.authUserId);
        return visitor.authUserId;
    });
    const admin = t.withIdentity({ subject: adminUserId });
    if (requireContextRead)
        await admin.mutation(api.framingCitationPolicy.set, {
            expectedRevision: 0,
            requireContextRead: true,
        });
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
    return {
        t,
        client,
        admin,
        runId,
        active,
        message,
        dispatch,
        calls,
        excerpt,
    };
}

test.each([
    { basis: "event", requireContextRead: true, definitionVersion: 11 },
    { basis: "event", requireContextRead: false, definitionVersion: 10 },
    { basis: "condition", requireContextRead: true, definitionVersion: 11 },
    { basis: "condition", requireContextRead: false, definitionVersion: 10 },
    { basis: "event", requireContextRead: true, definitionVersion: 12 },
    { basis: "condition", requireContextRead: false, definitionVersion: 12 },
] as const)("Workbench $definitionVersion $basis citation follows the frozen context requirement $requireContextRead", async ({
    basis,
    requireContextRead,
    definitionVersion,
}) => {
    const { client, admin, runId, message, dispatch, t, excerpt, active } =
        await documentaryTurn(definitionVersion, undefined, requireContextRead);
    const search = await dispatch("discover-citation", {
        kind: "search_public_context",
        messageId: message._id,
        query: "validation rights",
    });
    assert(search.outcome.kind === "success");
    const acquire = await dispatch("acquire-citation-source", {
        kind: "acquire_document",
        reference: JSON.parse(search.outcome.valueJson).candidates[0].reference,
    });
    const acquired = await t.action(
        internal.sourceCaptureActions.acquireDocument,
        {
            requestId: acquire.id,
            expectedGeneration: 1,
        },
    );
    assert(acquired?.kind === "success");
    const document = JSON.parse(acquired.valueJson);
    const found = await dispatch("search-citation-capture", {
        kind: "search_available_material",
        reference: document.readingReference,
        query: "validation rights",
    });
    assert(found.outcome.kind === "success");
    const match = JSON.parse(found.outcome.valueJson).passages[0];
    const content = {
        scope: excerpt,
        questions: [
            {
                id: "review",
                shortLabel: "Review",
                text: "Who sets the validation rules?",
                rationale: "Identify authority over estimate review.",
            },
        ],
    };
    const basisFor = (reference: string) =>
        basis === "event"
            ? {
                  kind: "public" as const,
                  label: "Insurer estimate validation",
                  references: [reference],
              }
            : {
                  kind: "open" as const,
                  activityExcerpt: excerpt,
                  conditions: [
                      {
                          questionId: "review",
                          hypothesis:
                              "validation authority remains with the insurer",
                          basis: {
                              kind: "public" as const,
                              references: [reference],
                          },
                      },
                  ],
              };
    const propose = (
        cause: string,
        reference: string,
        expectedRevision: number,
    ) =>
        dispatch(cause, {
            kind: "adjust_framing",
            messageId: message._id,
            expectedRevision,
            content,
            eventBasis: basisFor(reference),
        });
    await admin.mutation(api.framingCitationPolicy.set, {
        expectedRevision: requireContextRead ? 1 : 0,
        requireContextRead: !requireContextRead,
    });
    const first = (await propose("try-unopened-match", match.reference, 1))
        .outcome;
    if (requireContextRead) {
        expect(first).toMatchObject({
            kind: "refused",
            code: "framing_public_context_required",
        });
    } else {
        expect(first.kind).toBe("success");
    }
    const revision = requireContextRead ? 1 : 2;
    expect(await client.query(api.framing.get, { runId })).toMatchObject({
        revision,
        ...(requireContextRead
            ? {}
            : { eventBasis: basisFor(match.reference) }),
    });
    if (requireContextRead && basis === "event")
        expect(
            (
                await propose(
                    "cite-acquisition",
                    document.readingReference,
                    revision,
                )
            ).outcome,
        ).toMatchObject({
            kind: "refused",
            code: "framing_public_lookup_invalid",
        });
    const opened = await dispatch("open-citation-in-context", {
        kind: "read_in_context",
        reference: requireContextRead
            ? document.readingReference
            : match.reference,
    });
    assert(opened.outcome.kind === "success");
    let page = JSON.parse(opened.outcome.valueJson);
    if (requireContextRead) {
        expect(page).toMatchObject({
            readKind: "beginning",
            range: { startOffset: 0 },
        });
        if (basis === "condition") {
            assert(page.nextReference);
            expect(
                (
                    await propose(
                        "cite-unread-page",
                        page.nextReference,
                        revision,
                    )
                ).outcome,
            ).toMatchObject({
                kind: "refused",
                code: "framing_public_lookup_invalid",
            });
            const next = await dispatch("read-next-citation-page", {
                kind: "read_in_context",
                reference: page.nextReference,
            });
            assert(next.outcome.kind === "success");
            const continuation = JSON.parse(next.outcome.valueJson);
            expect(continuation).toMatchObject({
                readKind: "beginning",
                range: { startOffset: page.range.endOffset },
            });
            page = continuation;
        }
    }
    const receipt = (
        await propose("cite-displayed-page", page.reference, revision)
    ).outcome;
    assert(receipt.kind === "success");
    const publicCitations =
        basis === "event"
            ? { event: [page.reference], conditions: [] }
            : {
                  event: [],
                  conditions: [
                      { questionId: "review", references: [page.reference] },
                  ],
              };
    expect(JSON.parse(receipt.valueJson)).toEqual({
        revision: revision + 1,
        ...(definitionVersion === 11 || definitionVersion === 12
            ? {
                  eventBasis: basis === "event" ? "public" : "open",
                  publicCitations,
              }
            : {}),
    });
    const saved = await client.query(api.framing.get, { runId });
    expect(saved).toMatchObject({
        revision: revision + 1,
        eventBasis: basisFor(page.reference),
    });
    const context = await t.run((ctx) =>
        buildMissionContext(ctx, active.missionId, 1),
    );
    assert(context.kind === "ready");
    const framing = JSON.parse(context.inputJson).domain.framing;
    expect(
        basis === "event"
            ? framing.eventReferences
            : framing.conditionReferences,
    ).toMatchObject([
        {
            reference: page.reference,
            range: page.range,
            excerpt: page.text,
        },
    ]);
    if (basis === "condition") {
        assert(saved);
        const [question] = saved.content.questions;
        assert(question);
        await client.mutation(api.framing.save, {
            runId,
            expectedRevision: saved.revision,
            requestKey: "refine-rationale",
            content: {
                ...saved.content,
                questions: [
                    {
                        ...question,
                        rationale:
                            "Identify how approval authority affects financial exposure.",
                    },
                ],
            },
        });
        expect(await client.query(api.framing.get, { runId })).toMatchObject({
            revision: saved.revision + 1,
            eventBasis: basisFor(page.reference),
        });
    }
});

test("acquires an analyst's exact URL and reuses its capture after a provisional save", async () => {
    const url = "https://example.com/analyst-announcement";
    const excerpt = `Investigate insurer estimate review using ${url}`;
    const leading = "Insurers decide which validation rules apply. ".padEnd(
        SOURCE_CONTEXT_PAGE_CHARACTERS - 1,
        "x",
    );
    const ending = "🚗 End of publication.";
    const text = leading + ending;
    const { t, runId, message, dispatch } = await documentaryTurn(10, excerpt);
    const records = () =>
        t.run(async (ctx) => ({
            source: await ctx.db
                .query("sources")
                .withIndex("by_run_and_url", (q) =>
                    q.eq("runId", runId).eq("canonicalUrl", url),
                )
                .unique(),
            receipts: await ctx.db
                .query("providerCalls")
                .withIndex("by_run", (q) => q.eq("runId", runId))
                .collect(),
        }));
    const before = await records();
    expect(before.source).toBeNull();
    const dnsCalls = vi.mocked(lookup).mock.calls.length;
    const unobserved = await dispatch("unobserved-url", {
        kind: "acquire_document",
        reference: "https://example.com/unobserved",
    });
    expect(unobserved.outcome).toMatchObject({
        code: "source_reference_not_observed",
    });
    expect(vi.mocked(lookup).mock.calls.length).toBe(dnsCalls);
    expect(await records()).toEqual(before);
    const initial = await dispatch("acquire-supplied", {
        kind: "acquire_document",
        reference: url,
    });
    assert(initial.outcome.kind === "waiting", JSON.stringify(initial.outcome));
    const competing = await dispatch("acquire-concurrent", {
        kind: "acquire_document",
        reference: url,
    });
    assert(
        competing.outcome.kind === "waiting",
        JSON.stringify(competing.outcome),
    );
    expect(competing.id).toBe(initial.id);
    const transport = vi.mocked(requestPinnedPublicSource);
    let competingOutcome: unknown;
    transport
        .mockClear()
        .mockImplementationOnce(async (_url, _address, options) => {
            options?.observeDispatch?.("unknown");
            competingOutcome = await t.action(
                internal.sourceCaptureActions.acquireDocument,
                {
                    requestId: competing.id,
                    expectedGeneration: 1,
                },
            );
            options?.observeDispatch?.("response_received");
            return new Response(text, {
                headers: { "Content-Type": "text/plain" },
            });
        });
    await t.action(internal.sourceCaptureActions.acquireDocument, {
        requestId: initial.id,
        expectedGeneration: 1,
    });
    expect(competingOutcome).toBeNull();
    const readOutcome = (id: typeof initial.id) =>
        t.run(async (ctx) => {
            const request = await ctx.db.get(id);
            assert(
                request?.outcome?.kind === "success",
                JSON.stringify(request?.outcome),
            );
            return JSON.parse(request.outcome.valueJson);
        });
    const result = await readOutcome(initial.id);
    expect(result).toMatchObject({
        canonicalUrl: url,
        contentHash: createHash("sha256").update(text).digest("hex"),
        representationCompleteness: "complete",
    });
    const retained = await records();
    expect(retained.source?.origin).toBe("analyst_url");
    expect(retained.receipts).toEqual([
        expect.objectContaining({
            operation: "framing_context_read",
            operationRequestId: initial.id,
            status: "succeeded",
        }),
    ]);
    expect(retained.receipts[0]?.sourceId).toBeUndefined();
    expect(retained.receipts[0]?.preparationId).toBeUndefined();

    const saved = await dispatch("save-between-acquisitions", {
        kind: "adjust_framing",
        expectedRevision: 1,
        messageId: message._id,
        eventBasis: { kind: "open", activityExcerpt: excerpt },
        content: {
            scope: excerpt,
            questions: [
                {
                    id: "validation",
                    shortLabel: "Validation rules",
                    text: "Who sets the validation rules?",
                    rationale: "Locate control of the evidence workflow.",
                },
            ],
        },
    });
    assert(saved.outcome.kind === "success", JSON.stringify(saved.outcome));
    const reuse = await dispatch("acquire-same-url-after-save", {
        kind: "acquire_document",
        reference: url,
    });
    expect(reuse.id).not.toBe(initial.id);
    assert(reuse.outcome.kind === "waiting", JSON.stringify(reuse.outcome));
    await t.action(internal.sourceCaptureActions.acquireDocument, {
        requestId: reuse.id,
        expectedGeneration: 1,
    });
    expect(await readOutcome(reuse.id)).toMatchObject({
        captureId: result.captureId,
        contentHash: result.contentHash,
        retrievedAt: result.retrievedAt,
    });
    const opening = await dispatch("read-from-beginning", {
        kind: "read_in_context",
        reference: result.readingReference,
    });
    assert(opening.outcome.kind === "success", JSON.stringify(opening.outcome));
    const page = JSON.parse(opening.outcome.valueJson);
    expect(page).toMatchObject({
        captureId: result.captureId,
        text: leading,
        range: { startOffset: 0, endOffset: leading.length },
        nextReference: expect.any(String),
    });
    const continued = await dispatch("read-final-page", {
        kind: "read_in_context",
        reference: page.nextReference,
    });
    assert(
        continued.outcome.kind === "success",
        JSON.stringify(continued.outcome),
    );
    expect(JSON.parse(continued.outcome.valueJson)).toMatchObject({
        captureId: result.captureId,
        text: ending,
        range: { startOffset: leading.length, endOffset: text.length },
    });
    expect(
        JSON.parse(continued.outcome.valueJson).nextReference,
    ).toBeUndefined();
    expect(await records()).toEqual(retained);
    expect(transport).toHaveBeenCalledOnce();
});

test("an uncertain scheduled acquisition preserves its receipt without fetching again", async () => {
    const url = "https://example.com/uncertain-publication";
    const { t, runId, dispatch } = await documentaryTurn(10, `Examine ${url}`);
    const transport = vi.mocked(requestPinnedPublicSource);
    transport
        .mockClear()
        .mockImplementationOnce(async (_url, _address, options) => {
            options?.observeDispatch?.("unknown");
            throw new TypeError("Controlled transport interruption");
        });
    const admitted = await dispatch("uncertain-acquisition", {
        kind: "acquire_document",
        reference: url,
    });
    assert(admitted.outcome.kind === "waiting");
    const args = { requestId: admitted.id, expectedGeneration: 1 };
    const outcome = await t.action(
        internal.sourceCaptureActions.acquireDocument,
        args,
    );
    expect(outcome).toMatchObject({ kind: "unavailable" });
    expect(
        await t.action(internal.execution.operations.dispatch, args),
    ).toEqual(outcome);
    expect(transport).toHaveBeenCalledOnce();
    const receipts = await t.run((ctx) =>
        ctx.db
            .query("providerCalls")
            .withIndex("by_run", (q) => q.eq("runId", runId))
            .collect(),
    );
    expect(receipts).toEqual([
        expect.objectContaining({
            operationRequestId: admitted.id,
            dispatchOutcome: "unknown",
            status: "failed",
            retryable: false,
        }),
    ]);
    expect(
        await t.run((ctx) => ctx.db.query("sourceCaptures").unique()),
    ).toMatchObject({
        status: "unavailable",
        operationRequestId: admitted.id,
    });
});

test.each([
    "sourceCaptures:finalize",
    "execution/operations:recordResult",
])("the scheduled acquisition survives a lost acknowledgement from %s", async (commit) => {
    const url = "https://example.com/commit-acknowledgement";
    const text = "The underwriting team approves the procedure.";
    const { t, runId, dispatch } = await documentaryTurn(10, `Review ${url}`);
    const transport = vi.mocked(requestPinnedPublicSource);
    transport
        .mockClear()
        .mockImplementationOnce(async (_url, _address, options) => {
            options?.observeDispatch?.("response_received");
            return new Response(text, {
                headers: { "Content-Type": "text/plain" },
            });
        });
    const admitted = await dispatch("capture-lost-acknowledgement", {
        kind: "acquire_document",
        reference: url,
    });
    assert(admitted.outcome.kind === "waiting");
    const args = { requestId: admitted.id, expectedGeneration: 1 };
    const registered = acquireDocument as typeof acquireDocument & {
        _handler(
            ctx: ActionCtx,
            args: FunctionArgs<
                typeof internal.sourceCaptureActions.acquireDocument
            >,
        ): Promise<unknown>;
    };
    let lost = false;
    const outcome = await t.action((ctx) =>
        registered._handler(
            {
                ...ctx,
                async runMutation(reference, ...parameters) {
                    const result = await ctx.runMutation(
                        reference,
                        ...parameters,
                    );
                    if (getFunctionName(reference) === commit && !lost) {
                        lost = true;
                        throw new Error("Capture commit acknowledgement lost");
                    }
                    return result;
                },
            },
            args,
        ),
    );
    expect(lost).toBe(true);
    const persisted = await t.run(async (ctx) => ({
        capture: await ctx.db.query("sourceCaptures").unique(),
        request: await ctx.db.get(admitted.id),
        receipts: await ctx.db
            .query("providerCalls")
            .withIndex("by_run", (q) => q.eq("runId", runId))
            .collect(),
    }));
    expect(persisted.capture).toMatchObject({
        status: "committed",
        contentHash: createHash("sha256").update(text).digest("hex"),
    });
    expect(persisted.request).toMatchObject({
        adoptedAt: expect.any(Number),
        outcome: { kind: "success" },
    });
    expect(outcome).toEqual(persisted.request?.outcome);
    expect(persisted.receipts).toEqual([
        expect.objectContaining({
            operationRequestId: admitted.id,
            status: "succeeded",
        }),
    ]);
    expect(
        await t.action(internal.execution.operations.dispatch, args),
    ).toEqual(outcome);
    expect(transport).toHaveBeenCalledOnce();
});

test("a stopped Workbench turn settles the provider response without adopting its capture", async () => {
    const { t, client, runId, active, message, dispatch } =
        await documentaryTurn(10);
    const search = await dispatch("find-late-publication", {
        kind: "search_public_context",
        messageId: message._id,
        query: "validation rights",
    });
    assert(search.outcome.kind === "success");
    const reference = JSON.parse(search.outcome.valueJson).candidates[0]
        .reference;
    vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>(async () => {
            await client.mutation(api.execution.conversations.stopResponse, {
                runId,
                turnId: active.turnId,
            });
            return Response.json({
                results: [
                    {
                        id: "late",
                        url: "https://example.com/first",
                        text: "Late publication.",
                    },
                ],
                costDollars: { total: 0.001 },
            });
        }),
    );
    const admitted = await dispatch("late-acquisition", {
        kind: "acquire_document",
        reference,
    });
    assert(admitted.outcome.kind === "waiting");
    await t.action(internal.sourceCaptureActions.acquireDocument, {
        requestId: admitted.id,
        expectedGeneration: 1,
    });
    const persisted = await t.run(async (ctx) => ({
        capture: await ctx.db.query("sourceCaptures").unique(),
        request: await ctx.db.get(admitted.id),
        receipts: await ctx.db
            .query("providerCalls")
            .withIndex("by_run", (q) => q.eq("runId", runId))
            .collect(),
    }));
    expect(persisted.request?.adoptedAt).toBeUndefined();
    expect(persisted.request?.outcome?.kind).toBe("refused");
    expect(persisted.capture?.status).not.toBe("committed");
    expect(persisted.capture?.storageId).toBeUndefined();
    expect(persisted.receipts).toContainEqual(
        expect.objectContaining({
            operationRequestId: admitted.id,
            status: "succeeded",
            reportedCost: 0.001,
            dispatchOutcome: "response_received",
        }),
    );
});

test("Workbench exposes each retained capture and issues references for each active message", async () => {
    const { t, client, runId, active, message, dispatch } =
        await documentaryTurn(10);
    const lead = await dispatch("inventory-lead", {
        kind: "search_public_context",
        messageId: message._id,
        query: "validation rights",
    });
    assert(lead.outcome.kind === "success");
    const acquisition = await dispatch("inventory-capture", {
        kind: "acquire_document",
        reference: JSON.parse(lead.outcome.valueJson).candidates[0].reference,
    });
    assert(acquisition.outcome.kind === "waiting");
    await t.action(internal.sourceCaptureActions.acquireDocument, {
        requestId: acquisition.id,
        expectedGeneration: 1,
    });
    const original = await t.run((ctx) =>
        ctx.db.query("sourceCaptures").unique(),
    );
    assert(original?.storageId);
    const seeded = await t.run(async (ctx) => {
        const { _id, _creationTime, ...capture } = original;
        const insert = async (index: number, sameSource: boolean) => {
            const url = sameSource
                ? capture.requestedUrl
                : `https://example.com/inventory/${index}`;
            const sourceId = sameSource
                ? capture.sourceId
                : await ctx.db.insert("sources", {
                      runId,
                      canonicalUrl: url,
                      title: `Retained document ${index}`,
                      origin: "analyst_url",
                      category: "public_context",
                      createdAt: capture.createdAt,
                  });
            return ctx.db.insert("sourceCaptures", {
                ...capture,
                sourceId,
                captureKey: `inventory-${index}`,
                requestedUrl: url,
                resolvedUrl: url,
            });
        };
        const extra = await insert(0, true);
        for (let index = 1; index <= 60; index++) await insert(index, false);
        return extra;
    });
    const readContext = async () => {
        const context = await t.run((ctx) =>
            buildMissionContext(ctx, active.missionId, 1),
        );
        assert(context.kind === "ready", JSON.stringify(context));
        return JSON.parse(context.inputJson).domain.availableMaterials;
    };
    const earlier = await readContext();
    expect(earlier).toHaveLength(62);
    const before = earlier.find(
        (item: { captureId: string }) => item.captureId === seeded,
    );
    const earlierReference = before.readingReferences[0].reference;
    const steered = await client.mutation(api.execution.conversations.submit, {
        runId,
        turnId: active.turnId,
        requestKey: "include-controls",
        text: "Also investigate who can alter the validation controls.",
        delivery: "steer",
    });
    const available = await readContext();
    expect(
        new Set(available.map((item: { sourceId: string }) => item.sourceId))
            .size,
    ).toBe(61);
    const material = available.find(
        (item: { captureId: string }) => item.captureId === seeded,
    );
    expect(material.readingReferences).toEqual([
        {
            messageId: message._id,
            reference: expect.any(String),
            refreshReference: expect.any(String),
        },
        {
            messageId: steered,
            reference: expect.any(String),
            refreshReference: expect.any(String),
        },
    ]);
    const stale = await dispatch("superseded-inventory-read", {
        kind: "read_in_context",
        reference: earlierReference,
    });
    expect(stale.outcome.kind).not.toBe("success");
    const read = await dispatch("read-inventory-from-steering", {
        kind: "read_in_context",
        reference: material.readingReferences[1].reference,
    });
    assert(read.outcome.kind === "success", JSON.stringify(read.outcome));
    expect(JSON.parse(read.outcome.valueJson)).toMatchObject({
        captureId: seeded,
        contentHash: original.contentHash,
        text: expect.stringContaining("The insurer retains validation rights."),
    });
    expect(await t.run((ctx) => ctx.db.get(read.id))).toMatchObject({
        pin: { scope: { cause: { messageId: steered } } },
    });
});

test.each([
    { binding: "retained reference", version: 10 as const },
    { binding: "current", version: null },
])("$binding Workbench hands committed captures to Sources after Start and preserves paused reading authority", async ({
    version,
}) => {
    const { t, client, runId, active, message, dispatch, calls } =
        await documentaryTurn(version);
    const search = await dispatch("research-search", {
        kind: "search_public_context",
        messageId: message._id,
        query: "validation rights",
    });
    assert(search.outcome.kind === "success", JSON.stringify(search.outcome));
    const reference = JSON.parse(search.outcome.valueJson).candidates[0]
        ?.reference;
    expect(reference).toBeTypeOf("string");
    const url = "https://example.com/first";
    const sourceForUrl = () =>
        t.run((ctx) =>
            ctx.db
                .query("sources")
                .withIndex("by_run_and_url", (q) =>
                    q.eq("runId", runId).eq("canonicalUrl", url),
                )
                .unique(),
        );
    expect(await sourceForUrl()).toBeNull();
    const acquisition = await dispatch("acquire-publication", {
        kind: "acquire_document",
        reference,
    });
    assert(
        acquisition.outcome.kind === "waiting",
        JSON.stringify(acquisition.outcome),
    );
    await t.action(internal.sourceCaptureActions.acquireDocument, {
        requestId: acquisition.id,
        expectedGeneration: 1,
    });

    const request = await t.run((ctx) => ctx.db.get(acquisition.id));
    assert(
        request?.outcome?.kind === "success",
        JSON.stringify(request?.outcome),
    );
    expect(request.adoptedAt).toBeTypeOf("number");
    expect(request.pin).toMatchObject({
        kind: "documentary_v1",
        scope: { kind: "framing", cause: { messageId: message._id } },
        target: { kind: "acquisition", canonicalUrl: url },
    });
    const source = await sourceForUrl();
    assert(source);
    const capture = await t.run((ctx) =>
        ctx.db
            .query("sourceCaptures")
            .withIndex("by_source_and_updated_at", (q) =>
                q.eq("sourceId", source._id),
            )
            .unique(),
    );
    assert(capture?.storageId);
    const expectedText = "The insurer retains validation rights. "
        .repeat(400)
        .trim();
    const contentHash = createHash("sha256").update(expectedText).digest("hex");
    expect(capture).toMatchObject({
        runId,
        sourceId: source._id,
        status: "committed",
        resolvedUrl: url,
        contentHash,
        byteCount: Buffer.byteLength(expectedText),
        representationCompleteness: "unknown",
    });
    expect(capture.preparationId).toBeUndefined();
    const storageId = capture.storageId;
    const storedText = await t.run(
        async (ctx) => (await ctx.storage.get(storageId))?.text() ?? null,
    );
    expect(storedText).toBe(expectedText);
    expect(JSON.parse(request.outcome.valueJson)).toMatchObject({
        sourceId: source._id,
        captureId: capture._id,
        contentHash,
        canonicalUrl: url,
        document: { title: "First announcement" },
        representationCompleteness: "unknown",
        readingReference: expect.any(String),
    });
    expect(request.outcome.valueJson).not.toContain(
        "insurer retains validation rights",
    );
    expect(calls.filter((call) => call.endsWith("/contents"))).toHaveLength(1);

    const available = JSON.parse(request.outcome.valueJson);
    const prepared = await t.run((ctx) =>
        buildMissionContext(ctx, active.missionId, 1),
    );
    assert(prepared.kind === "ready");
    const input = JSON.parse(prepared.inputJson);
    expect(input.domain.availableMaterials).toEqual([
        expect.objectContaining({
            captureId: capture._id,
            contentHash,
            readingReferences: [
                {
                    messageId: message._id,
                    reference: expect.any(String),
                    refreshReference: expect.any(String),
                },
            ],
        }),
    ]);
    const found = await dispatch("search-captured-publication", {
        kind: "search_available_material",
        reference: available.readingReference,
        query: "validation rights",
    });
    assert(found.outcome.kind === "success", JSON.stringify(found.outcome));
    const match = JSON.parse(found.outcome.valueJson).passages[0];
    expect(match.exactQuote).toContain("insurer retains validation rights");
    const opening = await dispatch("open-matched-passage", {
        kind: "read_in_context",
        reference: match.reference,
    });
    assert(opening.outcome.kind === "success", JSON.stringify(opening.outcome));
    const firstPage = JSON.parse(opening.outcome.valueJson);
    expect(firstPage).toMatchObject({ captureId: capture._id, contentHash });
    expect(firstPage.text).toContain(match.exactQuote);
    expect(firstPage.text).toBe(
        expectedText.slice(
            firstPage.range.startOffset,
            firstPage.range.endOffset,
        ),
    );
    expect(firstPage.nextReference).toBeTypeOf("string");

    const excerpt =
        "Investigate insurer estimate review after the latest announcement.";
    const saved = await dispatch("provisional-program", {
        kind: "adjust_framing",
        messageId: message._id,
        expectedRevision: 1,
        eventBasis: { kind: "open", activityExcerpt: excerpt },
        content: {
            scope: excerpt,
            questions: [
                {
                    id: "control",
                    shortLabel: "Control",
                    text: "Who sets the estimate validation rules?",
                    rationale: "Identify which participant controls review.",
                },
            ],
        },
    });
    assert(saved.outcome.kind === "success", JSON.stringify(saved.outcome));
    const continued = await dispatch("continue-matched-document", {
        kind: "read_in_context",
        reference: firstPage.nextReference,
    });
    assert(
        continued.outcome.kind === "success",
        JSON.stringify(continued.outcome),
    );
    const nextPage = JSON.parse(continued.outcome.valueJson);
    expect(nextPage).toMatchObject({
        captureId: capture._id,
        contentHash,
        range: { startOffset: firstPage.range.endOffset },
    });
    expect(nextPage.range.endOffset).toBeGreaterThan(
        nextPage.range.startOffset,
    );
    expect(nextPage.text).toBe(
        expectedText.slice(
            nextPage.range.startOffset,
            nextPage.range.endOffset,
        ),
    );
    expect(calls.filter((call) => call.endsWith("/contents"))).toHaveLength(1);
    expect(
        (await t.run((ctx) => ctx.db.get(runId)))?.sourcePreparationId,
    ).toBeUndefined();
    const cited = await dispatch("cite-adopted-documentary-match", {
        kind: "adjust_framing",
        messageId: message._id,
        expectedRevision: 2,
        eventBasis: {
            kind: "public",
            label: "Insurer estimate validation",
            references: [match.reference],
        },
        content: {
            scope: excerpt,
            questions: [
                {
                    id: "control",
                    shortLabel: "Control",
                    text: "Who sets the estimate validation rules?",
                    rationale: "Identify which participant controls review.",
                },
            ],
        },
    });
    assert(cited.outcome.kind === "success", JSON.stringify(cited.outcome));
    expect(
        await t.run(async (ctx) => {
            const run = await ctx.db.get(runId);
            return run?.currentFramingRevisionId
                ? ctx.db.get(run.currentFramingRevisionId)
                : null;
        }),
    ).toMatchObject({
        revision: 3,
        eventBasis: {
            kind: "public",
            references: [match.reference],
        },
    });
    const uncited = await dispatch("acquire-uncited-lead", {
        kind: "acquire_document",
        reference: JSON.parse(search.outcome.valueJson).candidates[1].reference,
    });
    assert(uncited.outcome.kind === "waiting", JSON.stringify(uncited.outcome));
    const uncitedResult = await t.action(
        internal.sourceCaptureActions.acquireDocument,
        {
            requestId: uncited.id,
            expectedGeneration: 1,
        },
    );
    assert(uncitedResult?.kind === "success", JSON.stringify(uncitedResult));
    const uncitedCaptureId = JSON.parse(uncitedResult.valueJson).captureId;
    expect(uncitedCaptureId).not.toBe(capture._id);

    const paidBeforeStart = [...calls];
    vi.stubEnv("SOURCES_MISSION_ENABLED", "true");
    vi.stubEnv("SOURCES_MISSION_ENVELOPE", JSON.stringify(sourcesTestEnvelope));
    await client.mutation(api.framing.startResearch, {
        runId,
        expectedRevision: 3,
        requestKey: "start",
    });
    const started = await t.run((ctx) => ctx.db.get(runId));
    assert(started?.activeCorpusRevisionId);
    for (const state of [
        {
            lifecycleState: "checking_public_evidence",
            stepKey: "check_public_evidence",
        },
        { lifecycleState: "discovering_sources", stepKey: "prepare_sources" },
    ] as const) {
        await t.mutation(internal.researchRuns.transition, {
            runId,
            expectedExecutionGeneration: started.executionGeneration,
            executionStatus: "running",
            ...state,
        });
    }
    const preparationId = await t.mutation(internal.sourcesMission.claim, {
        runId,
        corpusRevisionId: started.activeCorpusRevisionId,
        expectedGeneration: started.executionGeneration,
        envelope: sourcesTestEnvelope,
    });
    expect(
        (await t.run((ctx) => ctx.db.get(preparationId)))?.sourcesMission,
    ).toMatchObject({
        captureIds: expect.arrayContaining([capture._id, uncitedCaptureId]),
        acquisitions: 0,
        qualifications: [],
        work: [],
    });
    expect(calls).toEqual(paidBeforeStart);
    const sourcesMission = await t.mutation(internal.execution.missions.start, {
        runId,
        expectedGeneration: started.executionGeneration,
        definitionId: "sources_v1",
        scope: { kind: "sources_v1", preparationId },
        requestKey: "read-shared-capture",
    });
    if (version !== null)
        await t.run((ctx) =>
            ctx.db.patch(sourcesMission, { definitionVersion: 7 }),
        );
    const model = await t.run(async (ctx) => {
        const setting = await ctx.db
            .query("agentModelSettings")
            .withIndex("by_agent", (q) => q.eq("agent", "workbench"))
            .unique();
        const invitation = await ctx.db
            .query("invitations")
            .withIndex("by_slot_key", (q) => q.eq("slotKey", "admin"))
            .unique();
        const admin = invitation?.claimedByVisitorId
            ? await ctx.db.get(invitation.claimedByVisitorId)
            : null;
        assert(setting && admin?.authUserId);
        return { catalogId: setting.catalogId, subject: admin.authUserId };
    });
    await t
        .withIdentity({ subject: model.subject })
        .mutation(api.modelConfiguration.assign, {
            agent: "sources",
            catalogId: model.catalogId,
            expectedRevision: 0,
            requestKey: "assign-sources-for-documentary-test",
        });
    await t.mutation(internal.execution.missions.resume, {
        missionId: sourcesMission,
        expectedGeneration: started.executionGeneration,
        simulation: false,
    });
    const sourcesContext = await t.run((ctx) =>
        buildMissionContext(ctx, sourcesMission, started.executionGeneration),
    );
    assert(sourcesContext.kind === "ready");
    const sourcesMaterial = JSON.parse(
        sourcesContext.inputJson,
    ).activeWork.captures.find(
        (entry: { captureId: string }) => entry.captureId === uncitedCaptureId,
    );
    expect(sourcesMaterial?.readingReferences).toEqual([
        { reference: expect.any(String), refreshReference: expect.any(String) },
    ]);
    const sourcesRequest = await t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: sourcesMission,
            expectedGeneration: started.executionGeneration,
            cause: "search-uncited-shared-capture",
            input: {
                kind: "search_available_material",
                reference: sourcesMaterial.readingReferences[0].reference,
                query: "validation rights",
            },
        },
    );
    const sourcesRead = await t.action(internal.execution.operations.dispatch, {
        requestId: sourcesRequest,
        expectedGeneration: started.executionGeneration,
    });
    assert(sourcesRead.kind === "success", JSON.stringify(sourcesRead));
    expect(JSON.parse(sourcesRead.valueJson)).toMatchObject({
        captureId: uncitedCaptureId,
        passages: expect.arrayContaining([
            expect.objectContaining({
                exactQuote: expect.stringContaining(
                    "insurer retains validation rights",
                ),
            }),
        ]),
    });
    expect(calls).toEqual(paidBeforeStart);
    const candidate = JSON.parse(
        sourcesContext.inputJson,
    ).activeWork.candidates.find(
        (entry: { canonicalUrl: string }) =>
            entry.canonicalUrl === "https://example.com/second",
    );
    const sourcesAcquisition = await t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: sourcesMission,
            expectedGeneration: started.executionGeneration,
            cause: "reuse-sources-acquisition",
            input: {
                kind: "acquire_document",
                reference: candidate.acquisitionReference,
            },
        },
    );
    expect(
        await t.action(internal.execution.operations.dispatch, {
            requestId: sourcesAcquisition,
            expectedGeneration: started.executionGeneration,
        }),
    ).toMatchObject({ kind: "waiting" });
    const reused = await t.action(
        internal.sourceCaptureActions.acquireDocument,
        {
            requestId: sourcesAcquisition,
            expectedGeneration: started.executionGeneration,
        },
    );
    assert(reused?.kind === "success", JSON.stringify(reused));
    expect(JSON.parse(reused.valueJson)).toMatchObject({
        captureId: uncitedCaptureId,
        indexStatus: "indexed",
    });
    expect(
        (await t.run((ctx) => ctx.db.get(preparationId)))?.sourcesMission,
    ).toMatchObject({
        acquisitions: 1,
        captureIds: expect.arrayContaining([capture._id, uncitedCaptureId]),
        qualifications: [],
    });
    expect(calls).toEqual(paidBeforeStart);
    const observed = JSON.parse(sourcesRead.valueJson);
    const contextualRequestId = await t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: sourcesMission,
            expectedGeneration: started.executionGeneration,
            cause: "open-uncited-indexed-passage",
            input: {
                kind: "read_in_context",
                reference: observed.passages[0].reference,
            },
        },
    );
    const contextual = await t.action(internal.execution.operations.dispatch, {
        requestId: contextualRequestId,
        expectedGeneration: started.executionGeneration,
    });
    assert(contextual.kind === "success", JSON.stringify(contextual));
    const contextPassage = JSON.parse(contextual.valueJson).indexedPassage;
    expect(contextPassage).toEqual(
        expect.objectContaining({
            passageOrder: observed.passages[0].passageOrder,
            exactQuote: observed.passages[0].exactQuote,
        }),
    );
    vi.stubEnv("OPENROUTER_API_KEY", "fixture-only");
    vi.mocked(examineDocumentaryContributions).mockImplementation(
        async (input, route, dependencies) => {
            assert(dependencies.beforeDispatch && route.descriptor);
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
                    coherence: true,
                    limitations: [],
                    findings: input.contributions.map(({ id }) => ({
                        contributionId: id,
                        conclusion: "supported",
                        permittedUse: "attributed_argument_only",
                        diagnostic:
                            "The cited publisher explicitly describes the insurer's control.",
                    })),
                },
            };
        },
    );
    const qualification = await t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: sourcesMission,
            expectedGeneration: started.executionGeneration,
            cause: "qualify-uncited-framing-capture",
            input: {
                kind: "submit_documentary_qualification",
                sourceId: observed.sourceId,
                captureId: uncitedCaptureId,
                expectedTaskId: null,
                changes: [
                    {
                        contribution: {
                            needIds: ["common-context"],
                            statement:
                                "The publisher describes insurer validation rights.",
                            period: "undated",
                            modality: "publisher statement",
                            attribution: "Example.com",
                            kind: "attributed_argument",
                            evidence: [
                                {
                                    readRequestId: contextualRequestId,
                                    passageOrder: contextPassage.passageOrder,
                                },
                            ],
                        },
                    },
                ],
            },
        },
    );
    const qualified = await dispatchSourcesOperation(t, {
        requestId: qualification,
        expectedGeneration: started.executionGeneration,
    });
    assert(qualified?.kind === "success", JSON.stringify(qualified));
    const qualificationId = JSON.parse(qualified.valueJson).taskId;
    expect(
        await t.run((ctx) =>
            ctx.db
                .query("aiTaskResults")
                .withIndex("by_run", (q) => q.eq("runId", runId))
                .collect(),
        ),
    ).toContainEqual(
        expect.objectContaining({
            _id: qualificationId,
            sourceCaptureId: uncitedCaptureId,
            output: expect.objectContaining({
                kind: "documentary_qualification",
                contributions: [
                    expect.objectContaining({
                        evidence: [
                            {
                                captureId: uncitedCaptureId,
                                passageOrder: contextPassage.passageOrder,
                                quotation: contextPassage.exactQuote,
                            },
                        ],
                    }),
                ],
            }),
        }),
    );
    expect(calls).toEqual(paidBeforeStart);
    await client.mutation(api.execution.researchControl.pause, {
        runId,
        expectedGeneration: started.executionGeneration,
    });
    expect(
        await t.mutation(internal.execution.researchControl.checkpoint, {
            runId,
        }),
    ).toMatchObject({ waiting: true });
    const stateBeforeRead = await t.run(async (ctx) => ({
        run: await ctx.db.get(runId),
        preparation: await ctx.db.get(preparationId),
    }));
    expect(stateBeforeRead.run?.executionStatus).toBe("paused");
    const pausedContext = await t.run((ctx) =>
        buildMissionContext(ctx, active.missionId, 1),
    );
    assert(pausedContext.kind === "ready");
    const inPause = JSON.parse(
        pausedContext.inputJson,
    ).domain.availableMaterials.find(
        (entry: { captureId: string }) => entry.captureId === uncitedCaptureId,
    );
    expect(inPause?.readingReferences).toEqual([
        { messageId: message._id, reference: expect.any(String) },
    ]);
    const denied = await dispatch("no-acquisition-after-start", {
        kind: "acquire_document",
        reference: JSON.parse(search.outcome.valueJson).candidates[1].reference,
    });
    expect(denied.outcome).toMatchObject({ code: "framing_fixed" });
    const stale = await dispatch("do-not-use-a-framing-reference-after-start", {
        kind: "read_in_context",
        reference: firstPage.nextReference,
    });
    expect(stale.outcome).toMatchObject({ code: "framing_observation_stale" });
    const duringPause = await dispatch("read-uncited-during-pause", {
        kind: "read_in_context",
        reference: inPause.readingReferences[0].reference,
    });
    assert(
        duringPause.outcome.kind === "success",
        JSON.stringify(duringPause.outcome),
    );
    expect(JSON.parse(duringPause.outcome.valueJson)).toMatchObject({
        captureId: uncitedCaptureId,
        readKind: "beginning",
        text: expect.stringContaining("insurer retains validation rights"),
    });
    expect(
        await t.run(async (ctx) => ({
            run: await ctx.db.get(runId),
            preparation: await ctx.db.get(preparationId),
        })),
    ).toEqual(stateBeforeRead);
    expect(calls).toEqual(paidBeforeStart);
});

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

test("framing refuses a new source when it would overflow the eventual Sources library", async () => {
    const url = "https://example.com/over-capacity";
    const { t, runId, dispatch } = await documentaryTurn(10, `Examine ${url}`);
    const requestPinned = vi.mocked(requestPinnedPublicSource);
    requestPinned.mockClear().mockImplementation(
        async () =>
            new Response("Fixture evidence.", {
                headers: { "Content-Type": "text/plain" },
            }),
    );
    await t.run(async (ctx) => {
        for (let count = 0; count < 60; count++)
            await ctx.db.insert("sources", {
                runId,
                canonicalUrl: `https://example.com/source/${count}`,
                title: `Retained source ${count}`,
                origin: "analyst_url",
                category: "public_context",
                createdAt: Date.now(),
            });
    });
    const acquisition = await dispatch("capacity-guard", {
        kind: "acquire_document",
        reference: url,
    });
    const outcome =
        acquisition.outcome.kind === "waiting"
            ? await t.action(internal.sourceCaptureActions.acquireDocument, {
                  requestId: acquisition.id,
                  expectedGeneration: 1,
              })
            : acquisition.outcome;
    expect(outcome).toMatchObject({ code: "source_candidate_limit" });
    expect(requestPinned).not.toHaveBeenCalled();
    expect(
        await t.run((ctx) =>
            ctx.db
                .query("sources")
                .withIndex("by_run_and_url", (q) => q.eq("runId", runId))
                .collect(),
        ),
    ).toHaveLength(60);
});

test("an issued refresh gets a new version while the original capture remains readable", async () => {
    const url = "https://example.com/updated-disclosure";
    const { t, active, dispatch } = await documentaryTurn(10, `Examine ${url}`);
    const requestPinned = vi.mocked(requestPinnedPublicSource);
    const versions = [
        "First report preserves local review authority.",
        "Updated report transfers review authority.",
    ];
    requestPinned.mockClear();
    for (const version of versions)
        requestPinned.mockImplementationOnce(
            async () =>
                new Response(version, {
                    headers: { "Content-Type": "text/plain" },
                }),
        );
    const acquire = async (reference: string, cause: string) => {
        const admitted = await dispatch(cause, {
            kind: "acquire_document",
            reference,
        });
        assert(
            admitted.outcome.kind === "waiting",
            JSON.stringify(admitted.outcome),
        );
        const outcome = await t.action(
            internal.sourceCaptureActions.acquireDocument,
            { requestId: admitted.id, expectedGeneration: 1 },
        );
        assert(outcome?.kind === "success", JSON.stringify(outcome));
        return JSON.parse(outcome.valueJson);
    };
    const original = await acquire(url, "get-first-version");
    const context = await t.run((ctx) =>
        buildMissionContext(ctx, active.missionId, 1),
    );
    assert(context.kind === "ready");
    const material = JSON.parse(
        context.inputJson,
    ).domain.availableMaterials.find(
        (item: { captureId: string }) => item.captureId === original.captureId,
    );
    const refresh = material?.readingReferences[0]?.refreshReference;
    expect(refresh).toBeTypeOf("string");
    const updated = await acquire(refresh, "get-updated-version");
    expect(updated.captureId).not.toBe(original.captureId);
    expect(updated.sourceId).toBe(original.sourceId);
    expect(updated.contentHash).not.toBe(original.contentHash);
    for (const [capture, version] of [
        [original, versions[0]],
        [updated, versions[1]],
    ]) {
        const read = await dispatch(`check-${capture.captureId}`, {
            kind: "read_in_context",
            reference: capture.readingReference,
        });
        assert(read.outcome.kind === "success", JSON.stringify(read.outcome));
        expect(JSON.parse(read.outcome.valueJson)).toMatchObject({
            captureId: capture.captureId,
            text: version,
        });
    }
    expect(requestPinned).toHaveBeenCalledTimes(2);
});

test.each([
    { binding: "retained reference", version: 10 as const },
    { binding: "current", version: null },
])("$binding Workbench offers the reference argument named by its method and recovery guidance", async ({
    version,
}) => {
    const { t, active, message, dispatch } = await documentaryTurn(version);
    const search = await dispatch("discover-reading-contract", {
        kind: "search_public_context",
        messageId: message._id,
        query: "validation rights",
    });
    assert(search.outcome.kind === "success");
    const acquisition = await dispatch("acquire-reading-contract", {
        kind: "acquire_document",
        reference: JSON.parse(search.outcome.valueJson).candidates[0].reference,
    });
    const captured = await t.action(
        internal.sourceCaptureActions.acquireDocument,
        {
            requestId: acquisition.id,
            expectedGeneration: 1,
        },
    );
    assert(captured?.kind === "success");
    const document = JSON.parse(captured.valueJson);
    const context = await t.run((ctx) =>
        buildMissionContext(ctx, active.missionId, 1),
    );
    assert(context.kind === "ready");
    const current = getAgentDefinition("workbench_v1", version ?? undefined);
    const reading = agentToolSchemas(
        current,
        JSON.parse(context.inputJson),
    ).read_in_context;
    assert(reading);
    const input = (await piToolMetadata("read_in_context", reading)).parameters;
    expect(input).toMatchObject({
        type: "object",
        properties: { reference: { type: "string" } },
        required: expect.arrayContaining(["reference"]),
    });
    expect(input).not.toHaveProperty("properties.passageOrder");
    const read = await dispatch("consume-offered-reading-contract", {
        kind: "read_in_context",
        reference: document.readingReference,
    });
    assert(read.outcome.kind === "success");
    expect(JSON.parse(read.outcome.valueJson)).toMatchObject({
        captureId: document.captureId,
        text: expect.stringContaining("The insurer retains validation rights."),
    });
    expect(current.instructions).toContain("issued reference");
    expect(current.instructions).not.toContain("passageOrder");
    const diagnostic = current.operationDiagnostic?.("passage_unavailable");
    expect(diagnostic).toMatch(/reference/);
    expect(diagnostic).not.toContain("passageOrder");
    expect(getAgentDefinition("workbench_v1", 9).instructions).toContain(
        "passageOrder",
    );
});
