import type { Infer } from "convex/values";
import type { publicReadResultValidator } from "@convex/domain/workbenchContracts";
import { api, internal } from "@convex/_generated/api";
import { sha256Hex, stableStringify } from "@convex/domain/sourcePassages";
import { MAX_EXA_TEXT_CHARACTERS } from "@convex/resourcePolicy";
import { requestPinnedPublicSource } from "@convex/sourceActions";
import { afterEach, assert, expect, test, vi } from "vitest";
import rateLimiterTest from "@/__tests__/convex/integrations/rate-limiter-test-register.js";
import { nativePiFixtureRoute } from "@/__tests__/setup/pi-native";
import { seedWorkbench } from "@/__tests__/setup/workbench";

const dnsLookup = vi.hoisted(() =>
    vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]),
);
vi.mock("node:dns/promises", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:dns/promises")>();
    const lookup = dnsLookup;
    return { ...actual, default: { ...actual, lookup }, lookup };
});
vi.mock("@convex/sourceActions", () => ({
    requestPinnedPublicSource: vi.fn(),
}));

const secSubmissions = "https://data.sec.gov/submissions/CIK0001818201.json";
const secFiling =
    "https://www.sec.gov/Archives/edgar/data/1818201/000095017025000001/filing.htm";

function simulatePublisher(responseFor: (url: string) => Response) {
    vi.mocked(requestPinnedPublicSource).mockImplementation(
        async (url, _address, options) => {
            options?.observeDispatch?.("unknown");
            const response = responseFor(url);
            options?.observeDispatch?.("response_received");
            return response;
        },
    );
}

function simulateSec(filingStatus = 200) {
    simulatePublisher((url) => {
        if (url === secSubmissions)
            return Response.json({
                cik: "1818201",
                name: "Fixture issuer",
                tickers: ["FIX"],
                exchanges: ["NYSE"],
                filings: {
                    recent: {
                        accessionNumber: [
                            "0000950170-25-000002",
                            "0000950170-25-000001",
                        ],
                        filingDate: ["2025-05-01", "2025-04-15"],
                        primaryDocument: ["filing.htm", "filing.htm"],
                    },
                },
            });
        expect(url).toBe(secFiling);
        return new Response(
            "<html><body><p>Date of Report (Date of earliest event reported): April 9, 2025</p><p>On April 9, 2025, the issuer was notified that its export license was required.</p></body></html>",
            {
                status: filingStatus,
                headers: {
                    "content-type": "text/html",
                    ...(filingStatus === 302 ? { location: secFiling } : {}),
                },
            },
        );
    });
}

afterEach(() => {
    vi.mocked(requestPinnedPublicSource).mockReset();
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
});
async function enqueueLookup(
    query: string,
    readings = 1,
    kind:
        | "verify_public_context"
        | "search_public_context"
        | "read_public_context" = "verify_public_context",
    originalText?: string,
    version?: 4 | 5 | 6 | 7,
    preset:
        | "balanced"
        | "first_party_depth"
        | "independent_scrutiny" = "balanced",
    focus?: "mixed" | "official" | "independent",
) {
    vi.stubEnv(
        "WORKBENCH_PUBLIC_CONTEXT_ALLOWANCE",
        JSON.stringify({
            searches: kind === "search_public_context" ? 5 : 1,
            readings,
        }),
    );
    const fixture = await seedWorkbench(
        false,
        nativePiFixtureRoute,
        undefined,
        originalText ?? `Read ${query}`,
        undefined,
        version ?? (kind !== "verify_public_context" ? 5 : 4),
        preset,
    );
    rateLimiterTest.register(fixture.t);
    const active = await fixture.t.mutation(
        internal.execution.conversations.startTurn,
        {
            runId: fixture.runId,
            definitionId: "workbench_v1",
            scope: { kind: "workbench_v1" },
            simulation: false,
        },
    );
    assert(active);
    const message = await fixture.t.run((ctx) =>
        ctx.db
            .query("agentMessageDeliveries")
            .withIndex("by_turn", (q) => q.eq("turnId", active.turnId))
            .first(),
    );
    assert(message);
    const requestId = await fixture.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: active.missionId,
            expectedGeneration: 1,
            cause: "public-context-lookup",
            input:
                kind === "read_public_context"
                    ? {
                          kind,
                          messageId: message._id,
                          target: { kind: "supplied", url: query },
                      }
                    : {
                          kind,
                          messageId: message._id,
                          query,
                          ...(kind === "search_public_context" && focus
                              ? { focus }
                              : {}),
                      },
        },
    );
    return {
        ...fixture,
        missionId: active.missionId,
        messageId: message._id,
        requestId,
    };
}

type Lookup = Awaited<ReturnType<typeof enqueueLookup>>;

function dispatchLookup(f: Lookup) {
    return f.t.action(internal.execution.operations.dispatch, {
        requestId: f.requestId,
        expectedGeneration: 1,
    });
}

function providerReceipts(f: Lookup) {
    return f.t.run((ctx) =>
        ctx.db
            .query("providerCalls")
            .withIndex("by_run", (q) => q.eq("runId", f.runId))
            .collect(),
    );
}

async function adoptLookup(f: Lookup) {
    const lookupRequestId = f.requestId;
    const before = await f.client.query(api.framing.get, { runId: f.runId });
    assert(before);
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: f.missionId,
            expectedGeneration: 1,
            cause: "save-supplied-sec-event",
            input: {
                kind: "adjust_framing",
                expectedRevision: before.revision,
                messageId: f.messageId,
                eventBasisRequired: true,
                content: { scope: "April 2025 licensing event", questions: [] },
                eventBasis: {
                    kind: "public",
                    label: "April 2025 licensing event",
                    lookupRequestId,
                    referenceIndexes: [0],
                },
            },
        },
    );
    return f.t.action(internal.execution.operations.dispatch, {
        requestId,
        expectedGeneration: 1,
    });
}

test("a fresh SEC filing with one reading admits submissions and explicitly blocks the filing", async () => {
    simulateSec();
    const f = await enqueueLookup(secFiling);
    const result = await dispatchLookup(f);
    expect(
        vi.mocked(requestPinnedPublicSource).mock.calls.map(([url]) => url),
    ).toEqual([secSubmissions]);
    expect(result).toEqual({
        kind: "unavailable",
        code: "public_context_allowance_exhausted",
    });
    expect(await providerReceipts(f)).toMatchObject([
        {
            service: "sec",
            status: "succeeded",
            dispatchOutcome: "response_received",
        },
    ]);
});

test("two readings account for both SEC requests and supply adoptable dated provenance", async () => {
    simulateSec();
    const f = await enqueueLookup(secFiling, 2);
    const observation = await dispatchLookup(f);
    assert(observation.kind === "success", JSON.stringify(observation));
    expect(JSON.parse(observation.valueJson)).toMatchObject({
        status: "observed",
        references: [
            {
                url: secFiling,
                publisher: "www.sec.gov",
                excerpt: expect.stringContaining("April 9, 2025"),
                eventAt: Date.UTC(2025, 3, 9),
                publishedAt: Date.UTC(2025, 3, 15),
            },
        ],
    });
    const calls = await providerReceipts(f);
    expect(calls).toMatchObject([
        {
            service: "sec",
            operation: "framing_context_read",
            status: "succeeded",
            dispatchOutcome: "response_received",
        },
        {
            service: "sec",
            operation: "framing_context_read",
            status: "succeeded",
            dispatchOutcome: "response_received",
        },
    ]);
    for (const key of ["stepKey", "operationKey", "inputHash"] as const) {
        expect(calls[0]?.[key]).toBeTruthy();
        expect(calls[1]?.[key]).toBeTruthy();
        expect(calls[0]?.[key]).not.toBe(calls[1]?.[key]);
    }
    expect(await dispatchLookup(f)).toEqual(observation);
    expect(
        vi.mocked(requestPinnedPublicSource).mock.calls.map(([url]) => url),
    ).toEqual([secSubmissions, secFiling]);
    expect(await providerReceipts(f)).toHaveLength(2);
    expect(await adoptLookup(f)).toMatchObject({ kind: "success" });
    expect(
        await f.client.query(api.framing.get, { runId: f.runId }),
    ).toMatchObject({
        eventBasis: { kind: "public", lookupRequestId: f.requestId },
    });
});

test.each([
    { status: 503, code: "source_read_unavailable" },
    { status: 302, code: "sec_filing_identity_changed" },
])("a filing HTTP $status leaves the prior submissions receipt intact", async ({
    status,
    code,
}) => {
    simulateSec(status);
    const f = await enqueueLookup(secFiling, 2);
    expect(await dispatchLookup(f)).toMatchObject({
        kind: "unavailable",
        code,
    });
    expect(
        vi.mocked(requestPinnedPublicSource).mock.calls.map(([url]) => url),
    ).toEqual([secSubmissions, secFiling]);
    expect(await providerReceipts(f)).toMatchObject([
        {
            service: "sec",
            status: "succeeded",
            dispatchOutcome: "response_received",
        },
        {
            service: "sec",
            status: "failed",
            dispatchOutcome: "response_received",
            errorCode: code,
        },
    ]);
});

test.each([
    true,
    false,
])("a supplied article with explicit publication metadata=%s", async (dated) => {
    const url = "https://publisher.example/technology/licensing";
    simulatePublisher(
        () =>
            new Response(
                `<!doctype html><html><head>
        ${
            dated
                ? '<meta content="2025-04-15T12:30:00+02:00" property="article:published_time">'
                : `
        <meta property="article:modified_time" content="2025-04-16T12:30:00+02:00">
        <!-- <meta property="article:published_time" content="2025-04-15"> -->
        <template><template></template><meta property="article:published_time" content="2025-04-15"></template>
        `
        }
        </head><body><article><time datetime="2025-04-15T12:30:00+02:00">April 15</time>
        <p>On April 9, 2025, the issuer was notified that its export license was required.</p>
        </article></body></html>`,
                { headers: { "content-type": "text/html" } },
            ),
    );
    const f = await enqueueLookup(url);
    const outcome = await dispatchLookup(f);
    assert(outcome.kind === "success", JSON.stringify(outcome));
    expect(JSON.parse(outcome.valueJson)).toMatchObject({
        status: dated ? "observed" : "inconclusive",
        references: [
            {
                url,
                publisher: "publisher.example",
                excerpt: expect.stringContaining("April 9, 2025"),
                ...(dated
                    ? { publishedAt: Date.UTC(2025, 3, 15, 10, 30) }
                    : {}),
            },
        ],
    });
    const adoption = await adoptLookup(f);
    if (dated) {
        expect(adoption).toMatchObject({ kind: "success" });
        expect(
            await f.client.query(api.framing.get, { runId: f.runId }),
        ).toMatchObject({
            eventBasis: { kind: "public", lookupRequestId: f.requestId },
        });
    } else {
        expect(adoption).toMatchObject({
            kind: "refused",
            code: "framing_public_reference_undated",
        });
    }
});

test("private supplied link retains a known non-dispatch receipt", async () => {
    const f = await enqueueLookup("https://127.0.0.1/private");
    const { requestId } = f;
    const beforeRequests = vi.mocked(requestPinnedPublicSource).mock.calls
        .length;
    const result = await f.t.action(internal.execution.operations.dispatch, {
        requestId,
        expectedGeneration: 1,
    });
    expect(result).toEqual({
        kind: "unavailable",
        code: "source_url_not_public",
    });
    expect(vi.mocked(requestPinnedPublicSource).mock.calls.length).toBe(
        beforeRequests,
    );
    const calls = await f.t.run((ctx) =>
        ctx.db
            .query("providerCalls")
            .withIndex("by_run", (q) => q.eq("runId", f.runId))
            .collect(),
    );
    expect(calls).toMatchObject([
        {
            status: "failed",
            dispatchOutcome: "not_dispatched",
            errorCode: "source_url_not_public",
            operation: "framing_context_read",
        },
    ]);
});

test("a provider HTTP refusal retains the known response and typed error", async () => {
    vi.stubEnv("EXA_API_KEY", "fixture-only");
    vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(null, { status: 429 })),
    );
    const f = await enqueueLookup("licensing requirements");
    const outcome = await f.t.action(internal.execution.operations.dispatch, {
        requestId: f.requestId,
        expectedGeneration: 1,
    });
    expect(outcome).toEqual({ kind: "unavailable", code: "http_429" });
    const receipts = await f.t.run((ctx) =>
        ctx.db
            .query("providerCalls")
            .withIndex("by_run", (q) => q.eq("runId", f.runId))
            .collect(),
    );
    expect(receipts).toMatchObject([
        {
            operation: "framing_context_search",
            status: "failed",
            dispatchOutcome: "response_received",
            errorCode: "http_429",
        },
    ]);
});

test("public discovery returns dated leads without reading and deduplicates factual progress", async () => {
    vi.stubEnv("EXA_API_KEY", "fixture-only");
    const contentsRequests: unknown[] = [];
    const results = [
        {
            id: "old",
            url: "https://example.com/april",
            title: "April announcement",
            publishedDate: "2026-04-09",
        },
        {
            id: "unknown",
            url: "https://example.org/context",
            title: "Undated context",
        },
        {
            id: "private",
            url: "https://127.0.0.1/private",
            title: "Private destination",
        },
    ];
    vi.stubGlobal(
        "fetch",
        vi.fn(async (url, init) => {
            if (String(url).endsWith("/contents"))
                contentsRequests.push(JSON.parse(init.body));
            return Response.json({ results, costDollars: { total: 0.01 } });
        }),
    );
    const f = await enqueueLookup(
        "recent announcement",
        1,
        "search_public_context",
    );
    const first = await dispatchLookup(f);
    assert(first.kind === "success", JSON.stringify(first));
    expect(JSON.parse(first.valueJson)).toEqual({
        searchId: f.requestId,
        candidates: [
            {
                url: "https://example.com/april",
                title: "April announcement",
                publisher: "example.com",
                publishedAt: "2026-04-09T00:00:00.000Z",
            },
            {
                url: "https://example.org/context",
                title: "Undated context",
                publisher: "example.org",
            },
        ],
    });
    const progress = (await f.t.run((ctx) => ctx.db.get(f.missionId)))
        ?.progressKeys;
    expect(progress).toHaveLength(2);
    expect(await dispatchLookup(f)).toEqual(first);
    results.reverse();
    const secondId = await f.t.mutation(internal.execution.operations.enqueue, {
        missionId: f.missionId,
        expectedGeneration: 1,
        cause: "reformulation",
        input: {
            kind: "search_public_context",
            query: "reformulated announcement",
            messageId: f.messageId,
        },
    });
    const second = await f.t.action(internal.execution.operations.dispatch, {
        requestId: secondId,
        expectedGeneration: 1,
    });
    assert(second.kind === "success", JSON.stringify(second));
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.missionId)))?.progressKeys,
    ).toEqual(progress);
    expect(contentsRequests).toEqual([]);
    expect(await providerReceipts(f)).toMatchObject([
        {
            operation: "framing_context_search",
            status: "succeeded",
            searchQuery:
                "CCC Intelligent Solutions Holdings Inc.: recent announcement",
        },
        {
            operation: "framing_context_search",
            status: "succeeded",
            searchQuery:
                "CCC Intelligent Solutions Holdings Inc.: reformulated announcement",
        },
    ]);
    expect(await f.t.run((ctx) => ctx.db.get(f.runId))).not.toHaveProperty(
        "sourcePreparationId",
    );
    expect(
        (await f.client.query(api.framing.get, { runId: f.runId }))?.revision,
    ).toBe(1);
});

test.each([
    "empty",
    "unconfigured",
    "unknown dispatch",
] as const)("public discovery distinguishes %s without adopting progress or retrying", async (state) => {
    vi.stubEnv("EXA_API_KEY", state === "unconfigured" ? "" : "fixture-only");
    const transport = vi.fn(async () => {
        if (state === "unknown dispatch")
            throw new TypeError("Connection lost after dispatch");
        return Response.json({ results: [], costDollars: { total: 0.007 } });
    });
    vi.stubGlobal("fetch", transport);
    const f = await enqueueLookup(
        "an unresolved event",
        1,
        "search_public_context",
    );
    const outcome = await dispatchLookup(f);
    expect(outcome).toEqual(
        state === "empty"
            ? {
                  kind: "success",
                  valueJson: JSON.stringify({
                      searchId: f.requestId,
                      candidates: [],
                  }),
                  progressKeys: [],
              }
            : {
                  kind: "unavailable",
                  code:
                      state === "unconfigured"
                          ? "missing_configuration"
                          : "framing_provider_failed",
              },
    );
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.missionId)))?.progressKeys,
    ).toEqual([]);
    expect(await dispatchLookup(f)).toEqual(outcome);
    expect(transport).toHaveBeenCalledTimes(state === "unconfigured" ? 0 : 1);
    const receipts = await providerReceipts(f);
    expect(receipts).toHaveLength(state === "unconfigured" ? 0 : 1);
    if (state === "unknown dispatch")
        expect(receipts[0]).toMatchObject({
            status: "failed",
            dispatchOutcome: "unknown",
            retryable: false,
        });
});

test.each([
    "Keep the saved program unchanged.",
    "Pause research.",
])("public discovery refuses unauthorized analyst instructions before I/O: %s", async (text) => {
    vi.stubEnv("EXA_API_KEY", "fixture-only");
    const transport = vi.fn(() => {
        throw new Error("Unauthorized I/O");
    });
    vi.stubGlobal("fetch", transport);
    const f = await enqueueLookup(
        "recent event",
        1,
        "search_public_context",
        text,
    );
    expect(await dispatchLookup(f)).toEqual({
        kind: "unavailable",
        code: "instruction_not_authorized",
    });
    expect(transport).not.toHaveBeenCalled();
    expect(await providerReceipts(f)).toEqual([]);
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.missionId)))?.progressKeys,
    ).toEqual([]);
});

test("selected publication opens only the chosen retained discovery destination", async () => {
    vi.stubEnv("EXA_API_KEY", "fixture-only");
    const contentRequests: unknown[] = [];
    vi.stubGlobal(
        "fetch",
        vi.fn(async (url, init) => {
            if (String(url).endsWith("/search"))
                return Response.json({
                    results: [
                        {
                            id: "one",
                            url: "https://example.com/one",
                            title: "First lead",
                            publishedDate: "2026-11-16",
                        },
                        {
                            id: "two",
                            url: "https://example.org/two",
                            title: "Second lead",
                            publishedDate: "2026-11-17",
                        },
                    ],
                });
            contentRequests.push(JSON.parse(init.body));
            return Response.json({
                results: [
                    {
                        id: "two",
                        url: "https://example.org/two",
                        text: "The second publication describes the changed validation rights.",
                    },
                ],
            });
        }),
    );
    const f = await enqueueLookup(
        "changed validation rights",
        2,
        "search_public_context",
    );
    const search = await dispatchLookup(f);
    assert(search.kind === "success");
    const readId = await f.t.mutation(internal.execution.operations.enqueue, {
        missionId: f.missionId,
        expectedGeneration: 1,
        cause: "selected-publication",
        input: {
            kind: "read_public_context",
            target: { kind: "candidate", searchId: f.requestId, index: 1 },
            messageId: f.messageId,
        },
    });
    const read = await f.t.action(internal.execution.operations.dispatch, {
        requestId: readId,
        expectedGeneration: 1,
    });
    assert(read.kind === "success", JSON.stringify(read));
    expect(JSON.parse(read.valueJson)).toMatchObject({
        readId,
        status: "observed",
        reference: {
            url: "https://example.org/two",
            publisher: "example.org",
            excerpt:
                "The second publication describes the changed validation rights.",
            publishedAt: "2026-11-17T00:00:00.000Z",
        },
    });
    expect(contentRequests).toEqual([
        expect.objectContaining({ urls: ["https://example.org/two"] }),
    ]);
    expect(await providerReceipts(f)).toMatchObject([
        { operation: "framing_context_search" },
        { operation: "framing_context_read" },
    ]);
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.missionId)))?.progressKeys,
    ).toHaveLength(3);
});

test("selected publication continues the retained representation to its decisive passage without reacquiring", async () => {
    vi.stubEnv("EXA_API_KEY", "fixture-only");
    const decisive =
        "On November 17, 2026, validation rights moved to the insurer.";
    const text = `${"Background context. ".repeat(1500)}\n${decisive}`;
    let acquisitions = 0;
    vi.stubGlobal(
        "fetch",
        vi.fn(async (url) => {
            if (String(url).endsWith("/search"))
                return Response.json({
                    results: [
                        {
                            id: "long",
                            url: "https://example.com/long",
                            title: "Detailed announcement",
                            publishedDate: "2026-11-17",
                        },
                    ],
                });
            acquisitions++;
            return Response.json({
                results: [
                    { id: "long", url: "https://example.com/long", text },
                ],
            });
        }),
    );
    const f = await enqueueLookup(
        "validation rights",
        2,
        "search_public_context",
    );
    assert((await dispatchLookup(f)).kind === "success");
    let continuation: typeof f.requestId | undefined;
    let content = "";
    let documentHash: string | undefined;
    do {
        const readId = await f.t.mutation(
            internal.execution.operations.enqueue,
            {
                missionId: f.missionId,
                expectedGeneration: 1,
                cause: "continue-publication",
                input: {
                    kind: "read_public_context",
                    messageId: f.messageId,
                    target: {
                        kind: "candidate",
                        searchId: f.requestId,
                        index: 0,
                    },
                    ...(continuation ? { continuation } : {}),
                },
            },
        );
        const outcome = await f.t.action(
            internal.execution.operations.dispatch,
            { requestId: readId, expectedGeneration: 1 },
        );
        assert(outcome.kind === "success", JSON.stringify(outcome));
        const page = JSON.parse(outcome.valueJson);
        expect(page.document).toMatchObject({
            contentHash: documentHash ?? expect.any(String),
            characters: text.length,
            acquisitionCompleteness: "unknown",
        });
        documentHash = page.document.contentHash;
        expect(page.range.start).toBe(content.length);
        content += page.reference.excerpt;
        expect(page.range.end).toBe(content.length);
        expect(
            await f.t.action(internal.execution.operations.dispatch, {
                requestId: readId,
                expectedGeneration: 1,
            }),
        ).toEqual(outcome);
        continuation = page.continuation;
        if (content.length < text.length) expect(continuation).toBe(readId);
        expect(content.length).toBeLessThanOrEqual(text.length);
    } while (continuation);
    expect(content).toBe(text);
    expect(content).toContain(decisive);
    expect(acquisitions).toBe(1);
});

test.each([
    "article",
    "SEC",
] as const)("supplied publication opens an analyst's %s reference without a search", async (kind) => {
    const url = kind === "SEC" ? secFiling : "https://example.org/article";
    if (kind === "SEC") simulateSec();
    else
        simulatePublisher(
            () =>
                new Response(
                    '<html><head><meta property="article:published_time" content="2026-11-17T00:00:00Z"></head><body>The insurer may retain validation rights.</body></html>',
                    { headers: { "content-type": "text/html" } },
                ),
        );
    const f = await enqueueLookup(url, 2, "read_public_context");
    const result = await dispatchLookup(f);
    assert(result.kind === "success", JSON.stringify(result));
    expect(JSON.parse(result.valueJson)).toMatchObject({
        readId: f.requestId,
        status: "observed",
        reference: {
            url,
            excerpt: expect.stringContaining(
                kind === "SEC" ? "April 9, 2025" : "validation rights",
            ),
            publishedAt:
                kind === "SEC"
                    ? "2025-04-15T00:00:00.000Z"
                    : "2026-11-17T00:00:00.000Z",
            ...(kind === "SEC" ? { eventAt: "2025-04-09T00:00:00.000Z" } : {}),
        },
        document: { acquisitionCompleteness: "complete" },
    });
    const receipts = await providerReceipts(f);
    expect(
        receipts.every(
            (receipt) => receipt.operation === "framing_context_read",
        ),
    ).toBe(true);
    expect(receipts).toHaveLength(kind === "SEC" ? 2 : 1);
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.missionId)))?.progressKeys,
    ).toHaveLength(1);
});

test("selected publication refuses invalid locators and retains prior readings after an inconclusive acquisition", async () => {
    vi.stubEnv("EXA_API_KEY", "fixture-only");
    let reads = 0;
    const transport = vi.fn(async (url, init) => {
        if (String(url).endsWith("/search"))
            return Response.json({
                results: [
                    {
                        id: "one",
                        url: "https://example.com/one",
                        title: "First publication",
                    },
                    {
                        id: "two",
                        url: "https://example.com/two",
                        title: "Unreadable publication",
                    },
                ],
            });
        reads++;
        const request = JSON.parse(init.body);
        return Response.json({
            results: [
                {
                    id: "content",
                    url: request.urls[0],
                    text:
                        reads === 1
                            ? "The first publication retains a useful passage."
                            : "",
                },
            ],
        });
    });
    vi.stubGlobal("fetch", transport);
    const f = await enqueueLookup("publication", 2, "search_public_context");
    assert((await dispatchLookup(f)).kind === "success");
    const read = async (index: number) => {
        const requestId = await f.t.mutation(
            internal.execution.operations.enqueue,
            {
                missionId: f.missionId,
                expectedGeneration: 1,
                cause: `read-${index}`,
                input: {
                    kind: "read_public_context",
                    messageId: f.messageId,
                    target: { kind: "candidate", searchId: f.requestId, index },
                },
            },
        );
        return {
            requestId,
            outcome: await f.t.action(internal.execution.operations.dispatch, {
                requestId,
                expectedGeneration: 1,
            }),
        };
    };
    for (const index of [-1, 0.5, 2])
        expect((await read(index)).outcome).toMatchObject({
            kind: "unavailable",
            code: "source_reference_not_observed",
        });
    expect(reads).toBe(0);
    const first = await read(0);
    assert(first.outcome.kind === "success");
    const progress = (await f.t.run((ctx) => ctx.db.get(f.missionId)))
        ?.progressKeys;
    const empty = await read(1);
    assert(empty.outcome.kind === "success", JSON.stringify(empty.outcome));
    expect(JSON.parse(empty.outcome.valueJson)).toMatchObject({
        status: "inconclusive",
        readId: empty.requestId,
    });
    expect(JSON.parse(empty.outcome.valueJson).reference).toBeUndefined();
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.missionId)))?.progressKeys,
    ).toEqual(progress);
    expect(
        await f.t.action(internal.execution.operations.dispatch, {
            requestId: first.requestId,
            expectedGeneration: 1,
        }),
    ).toEqual(first.outcome);
    expect(reads).toBe(2);
});

test("selected publication settles a late acquisition but cannot adopt it after an analyst framing edit", async () => {
    vi.stubEnv("EXA_API_KEY", "fixture-only");
    let f: Lookup;
    vi.stubGlobal(
        "fetch",
        vi.fn(async (url) => {
            if (String(url).endsWith("/search"))
                return Response.json({
                    results: [
                        {
                            id: "lead",
                            url: "https://example.com/late",
                            title: "Announcement",
                        },
                    ],
                });
            await f.client.mutation(api.framing.save, {
                runId: f.runId,
                expectedRevision: 1,
                requestKey: "newer-analyst-edit",
                content: { scope: "New analyst scope", questions: [] },
            });
            return Response.json({
                results: [
                    {
                        id: "late",
                        url: "https://example.com/late",
                        text: "Late passage must not advance this revised program.",
                    },
                ],
                costDollars: { total: 0.001 },
            });
        }),
    );
    f = await enqueueLookup("announcement", 1, "search_public_context");
    assert((await dispatchLookup(f)).kind === "success");
    const progress = (await f.t.run((ctx) => ctx.db.get(f.missionId)))
        ?.progressKeys;
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: f.missionId,
            expectedGeneration: 1,
            cause: "late-read",
            input: {
                kind: "read_public_context",
                messageId: f.messageId,
                target: { kind: "candidate", searchId: f.requestId, index: 0 },
            },
        },
    );
    expect(
        await f.t.action(internal.execution.operations.dispatch, {
            requestId,
            expectedGeneration: 1,
        }),
    ).toMatchObject({ kind: "refused" });
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.missionId)))?.progressKeys,
    ).toEqual(progress);
    expect(
        (await f.client.query(api.framing.get, { runId: f.runId }))?.content
            .scope,
    ).toBe("New analyst scope");
    expect(await providerReceipts(f)).toMatchObject([
        { operation: "framing_context_search", status: "succeeded" },
        {
            operation: "framing_context_read",
            status: "succeeded",
            reportedCost: 0.001,
        },
    ]);
    expect(
        (await f.t.run((ctx) => ctx.db.get(requestId)))?.adoptedAt,
    ).toBeUndefined();
});

test("selected publication ledger refuses a different destination before reserving an acquisition", async () => {
    vi.stubEnv("EXA_API_KEY", "fixture-only");
    vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
            Response.json({
                results: [
                    {
                        id: "lead",
                        url: "https://example.com/authorized",
                        title: "Authorized lead",
                    },
                ],
            }),
        ),
    );
    const f = await enqueueLookup("announcement", 2, "search_public_context");
    assert((await dispatchLookup(f)).kind === "success");
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: f.missionId,
            expectedGeneration: 1,
            cause: "authorize-read",
            input: {
                kind: "read_public_context",
                messageId: f.messageId,
                target: { kind: "candidate", searchId: f.requestId, index: 0 },
            },
        },
    );
    await f.t.run((ctx) => ctx.db.patch(requestId, { status: "running" }));
    const authority = await f.t.query(
        internal.workbenchPublicContext.forExecution,
        { requestId, expectedGeneration: 1 },
    );
    await expect(
        f.t.mutation(internal.providerCalls.recordAttempt, {
            missionId: authority.missionId,
            runId: authority.runId,
            workflowVersion: authority.workflowVersion,
            corpusRevisionId: authority.corpusRevisionId,
            executionGeneration: 1,
            operationRequestId: requestId,
            service: "exa",
            operation: "framing_context_read",
            stepKey: "framing_context_read",
            operationKey: `workbench:${requestId}:framing_context_read`,
            status: "started",
            attempt: 1,
            inputHash: sha256Hex(
                stableStringify({
                    urls: ["https://example.org/different"],
                    options: {
                        text: { maxCharacters: MAX_EXA_TEXT_CHARACTERS },
                    },
                }),
            ),
        }),
    ).rejects.toThrow("attempt_identity_conflict");
    expect(await providerReceipts(f)).toHaveLength(1);
});

test("selected publication and supplied publication share passage progress across distinct read requests", async () => {
    vi.stubEnv("EXA_API_KEY", "fixture-only");
    const url = "https://example.com/same";
    const text = "The insurer retains validation rights.";
    simulatePublisher(
        () => new Response(text, { headers: { "content-type": "text/plain" } }),
    );
    vi.stubGlobal(
        "fetch",
        vi.fn(async (endpoint) =>
            Response.json({
                results: String(endpoint).endsWith("/search")
                    ? [{ id: "same", url, title: "Validation rights" }]
                    : [{ id: "same", url, text }],
            }),
        ),
    );
    const f = await enqueueLookup(
        "validation rights",
        2,
        "search_public_context",
        `Investigate validation rights using ${url}`,
    );
    assert((await dispatchLookup(f)).kind === "success");
    const readIds = [];
    for (const target of [
        { kind: "candidate" as const, searchId: f.requestId, index: 0 },
        { kind: "supplied" as const, url },
    ]) {
        const requestId = await f.t.mutation(
            internal.execution.operations.enqueue,
            {
                missionId: f.missionId,
                expectedGeneration: 1,
                cause: "same-passage",
                input: {
                    kind: "read_public_context",
                    messageId: f.messageId,
                    target,
                },
            },
        );
        readIds.push(requestId);
        const result = await f.t.action(
            internal.execution.operations.dispatch,
            { requestId, expectedGeneration: 1 },
        );
        assert(result.kind === "success", JSON.stringify(result));
        expect(JSON.parse(result.valueJson)).toMatchObject({
            readId: requestId,
            reference: { url, excerpt: text },
        });
        expect(
            (await f.t.run((ctx) => ctx.db.get(f.missionId)))?.progressKeys,
        ).toHaveLength(2);
    }
    expect(readIds[0]).not.toBe(readIds[1]);
});

test("selected publication continues past a blank first extent and attributes a date found in the next passage", async () => {
    vi.stubEnv("EXA_API_KEY", "fixture-only");
    const text = `${" ".repeat(8192)}BOSTON, November 17, 2026 (GLOBE NEWSWIRE) — The insurer now retains validation rights.${"x".repeat(16384)}`;
    let acquisitions = 0;
    vi.stubGlobal(
        "fetch",
        vi.fn(async (url) => {
            if (String(url).endsWith("/search"))
                return Response.json({
                    results: [
                        {
                            id: "undated",
                            url: "https://example.com/dated-later",
                            title: "Undated lead",
                        },
                    ],
                });
            acquisitions++;
            return Response.json({
                results: [
                    {
                        id: "article",
                        url: "https://example.com/dated-later",
                        text,
                    },
                ],
            });
        }),
    );
    const f = await enqueueLookup(
        "validation rights",
        1,
        "search_public_context",
    );
    assert((await dispatchLookup(f)).kind === "success");
    const target = {
        kind: "candidate" as const,
        searchId: f.requestId,
        index: 0,
    };
    const firstId = await f.t.mutation(internal.execution.operations.enqueue, {
        missionId: f.missionId,
        expectedGeneration: 1,
        cause: "blank-extent",
        input: { kind: "read_public_context", messageId: f.messageId, target },
    });
    const first = await f.t.action(internal.execution.operations.dispatch, {
        requestId: firstId,
        expectedGeneration: 1,
    });
    assert(first.kind === "success");
    expect(JSON.parse(first.valueJson)).toMatchObject({
        status: "inconclusive",
        continuation: firstId,
    });
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.missionId)))?.progressKeys,
    ).toHaveLength(1);
    const secondId = await f.t.mutation(internal.execution.operations.enqueue, {
        missionId: f.missionId,
        expectedGeneration: 1,
        cause: "dated-extent",
        input: {
            kind: "read_public_context",
            messageId: f.messageId,
            target,
            continuation: firstId,
        },
    });
    const second = await f.t.action(internal.execution.operations.dispatch, {
        requestId: secondId,
        expectedGeneration: 1,
    });
    assert(second.kind === "success", JSON.stringify(second));
    expect(JSON.parse(second.valueJson)).toMatchObject({
        status: "observed",
        reference: {
            publishedAt: "2026-11-17T00:00:00.000Z",
            excerpt: expect.stringContaining("validation rights"),
        },
    });
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.missionId)))?.progressKeys,
    ).toHaveLength(2);
    const thirdId = await f.t.mutation(internal.execution.operations.enqueue, {
        missionId: f.missionId,
        expectedGeneration: 1,
        cause: "retained-date-page",
        input: {
            kind: "read_public_context",
            messageId: f.messageId,
            target,
            continuation: secondId,
        },
    });
    const third = await f.t.action(internal.execution.operations.dispatch, {
        requestId: thirdId,
        expectedGeneration: 1,
    });
    assert(third.kind === "success", JSON.stringify(third));
    expect(
        JSON.parse(third.valueJson).reference.dates.publication.evidence,
    ).toEqual([
        expect.objectContaining({
            value: "2026-11-17",
            precision: "day",
            origin: expect.objectContaining({ kind: "dateline" }),
        }),
    ]);
    expect(acquisitions).toBe(1);
});

test.each([
    "different target",
    "search cursor",
    "unadopted page",
    "foreign dossier",
    "foreign mission",
    "stale revision",
] as const)("selected publication refuses a %s continuation before external I/O", async (failure) => {
    vi.stubEnv("EXA_API_KEY", "fixture-only");
    let acquisitions = 0;
    vi.stubGlobal(
        "fetch",
        vi.fn(async (url) => {
            if (String(url).endsWith("/search"))
                return Response.json({
                    results: [
                        {
                            id: "one",
                            url: "https://example.com/one",
                            title: "First",
                        },
                        {
                            id: "two",
                            url: "https://example.org/two",
                            title: "Second",
                        },
                    ],
                });
            acquisitions++;
            return Response.json({
                results: [
                    {
                        id: "long",
                        url: "https://example.com/one",
                        text: "Retained context. ".repeat(1000),
                    },
                ],
            });
        }),
    );
    const f = await enqueueLookup("event", 1, "search_public_context");
    assert((await dispatchLookup(f)).kind === "success");
    const target = {
        kind: "candidate" as const,
        searchId: f.requestId,
        index: 0,
    };
    const firstId = await f.t.mutation(internal.execution.operations.enqueue, {
        missionId: f.missionId,
        expectedGeneration: 1,
        cause: "retained-read",
        input: { kind: "read_public_context", messageId: f.messageId, target },
    });
    const first = await f.t.action(internal.execution.operations.dispatch, {
        requestId: firstId,
        expectedGeneration: 1,
    });
    assert(first.kind === "success");
    expect(JSON.parse(first.valueJson).continuation).toBe(firstId);
    if (failure === "unadopted page")
        await f.t.run((ctx) => ctx.db.patch(firstId, { adoptedAt: undefined }));
    if (failure === "foreign dossier")
        await f.t.run(async (ctx) => {
            const run = await ctx.db.get(f.runId);
            assert(run);
            const { _id, _creationTime, ...fields } = run;
            const foreignId = await ctx.db.insert("researchRuns", fields);
            await ctx.db.patch(firstId, { runId: foreignId });
        });
    if (failure === "foreign mission")
        await f.t.run(async (ctx) => {
            const mission = await ctx.db.get(f.missionId);
            assert(mission);
            const { _id, _creationTime, ...fields } = mission;
            const foreignId = await ctx.db.insert("agentMissions", fields);
            await ctx.db.patch(firstId, { missionId: foreignId });
        });
    if (failure === "stale revision")
        await f.client.mutation(api.framing.save, {
            runId: f.runId,
            expectedRevision: 1,
            requestKey: "new-scope",
            content: { scope: "Analyst's new activity", questions: [] },
        });
    const nextId = await f.t.mutation(internal.execution.operations.enqueue, {
        missionId: f.missionId,
        expectedGeneration: 1,
        cause: "invalid-continuation",
        input: {
            kind: "read_public_context",
            messageId: f.messageId,
            target:
                failure === "different target"
                    ? { ...target, index: 1 }
                    : target,
            continuation: failure === "search cursor" ? f.requestId : firstId,
        },
    });
    expect(
        await f.t.action(internal.execution.operations.dispatch, {
            requestId: nextId,
            expectedGeneration: 1,
        }),
    ).toMatchObject({
        kind: "unavailable",
        code: "source_reference_not_observed",
    });
    expect(acquisitions).toBe(1);
    expect(await providerReceipts(f)).toHaveLength(2);
});

test("selected publication reports acquisition truncation separately from the returned extent", async () => {
    vi.stubEnv("EXA_API_KEY", "fixture-only");
    const text = "x".repeat(MAX_EXA_TEXT_CHARACTERS);
    vi.stubGlobal(
        "fetch",
        vi.fn(async (url) =>
            Response.json({
                results: String(url).endsWith("/search")
                    ? [
                          {
                              id: "long",
                              url: "https://example.com/limited",
                              title: "Long publication",
                          },
                      ]
                    : [
                          {
                              id: "long",
                              url: "https://example.com/limited",
                              text,
                          },
                      ],
            }),
        ),
    );
    const f = await enqueueLookup(
        "long publication",
        1,
        "search_public_context",
    );
    assert((await dispatchLookup(f)).kind === "success");
    const readId = await f.t.mutation(internal.execution.operations.enqueue, {
        missionId: f.missionId,
        expectedGeneration: 1,
        cause: "limited-read",
        input: {
            kind: "read_public_context",
            messageId: f.messageId,
            target: { kind: "candidate", searchId: f.requestId, index: 0 },
        },
    });
    const result = await f.t.action(internal.execution.operations.dispatch, {
        requestId: readId,
        expectedGeneration: 1,
    });
    assert(result.kind === "success", JSON.stringify(result));
    const page = JSON.parse(result.valueJson);
    expect(page.document).toMatchObject({
        characters: text.length,
        acquisitionCompleteness: "partial",
    });
    expect(page.range.end).toBeLessThan(text.length);
    expect(page.continuation).toBe(readId);
});

test.each([
    "missing grant",
    "paid work disabled",
    "unknown dispatch",
    "HTTP failure",
    "DNS failure",
    "changed destination",
] as const)("selected publication contains %s without adopting a passage or retrying", async (failure) => {
    vi.stubEnv("EXA_API_KEY", "fixture-only");
    let acquisitions = 0;
    vi.stubGlobal(
        "fetch",
        vi.fn(async (url) => {
            if (String(url).endsWith("/search"))
                return Response.json({
                    results: [
                        {
                            id: "lead",
                            url: "https://example.com/lead",
                            title: "Observed lead",
                        },
                    ],
                });
            acquisitions++;
            if (failure === "unknown dispatch")
                throw new TypeError("Lost response");
            if (failure === "HTTP failure")
                return new Response("Unavailable", { status: 503 });
            return Response.json({
                results: [
                    {
                        id: "changed",
                        url: "https://example.org/unrelated",
                        text: "Unrelated publication.",
                    },
                ],
            });
        }),
    );
    const f = await enqueueLookup("event", 1, "search_public_context");
    assert((await dispatchLookup(f)).kind === "success");
    if (failure === "missing grant")
        await f.t.run((ctx) =>
            ctx.db.patch(f.runId, { publicContextAllowance: undefined }),
        );
    if (failure === "paid work disabled")
        await f.t.run((ctx) =>
            ctx.db.insert("paidWorkControls", {
                key: "global",
                enabled: false,
                updatedAt: Date.now(),
            }),
        );
    if (failure === "DNS failure") {
        const dns = await import("node:dns/promises");
        vi.mocked(dns.lookup).mockRejectedValueOnce(
            new Error("DNS unavailable"),
        );
    }
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: f.missionId,
            expectedGeneration: 1,
            cause: "unavailable-publication",
            input: {
                kind: "read_public_context",
                messageId: f.messageId,
                target: { kind: "candidate", searchId: f.requestId, index: 0 },
            },
        },
    );
    const result = await f.t.action(internal.execution.operations.dispatch, {
        requestId,
        expectedGeneration: 1,
    });
    const codes = {
        "missing grant": "public_context_allowance_unavailable",
        "paid work disabled": "paid_work_disabled",
        "unknown dispatch": "framing_provider_failed",
        "HTTP failure": "http_503",
        "DNS failure": "source_url_unavailable",
    };
    if (failure === "changed destination") {
        assert(result.kind === "success");
        expect(JSON.parse(result.valueJson)).toMatchObject({
            status: "inconclusive",
        });
        expect(JSON.parse(result.valueJson).reference).toBeUndefined();
    } else
        expect(result).toMatchObject({
            kind: "unavailable",
            code: codes[failure],
        });
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.missionId)))?.progressKeys,
    ).toHaveLength(1);
    expect(
        await f.t.action(internal.execution.operations.dispatch, {
            requestId,
            expectedGeneration: 1,
        }),
    ).toEqual(result);
    expect(acquisitions).toBe(
        ["missing grant", "paid work disabled", "DNS failure"].includes(failure)
            ? 0
            : 1,
    );
    const receipts = await providerReceipts(f);
    if (failure === "unknown dispatch")
        expect(receipts.at(-1)).toMatchObject({
            status: "failed",
            dispatchOutcome: "unknown",
            retryable: false,
        });
    if (failure === "HTTP failure")
        expect(receipts.at(-1)).toMatchObject({
            status: "failed",
            dispatchOutcome: "response_received",
            retryable: false,
        });
    if (failure === "DNS failure")
        expect(receipts.at(-1)).toMatchObject({
            status: "failed",
            dispatchOutcome: "not_dispatched",
            retryable: false,
        });
});

test("selected publication reuses the known SEC filing date without fetching submissions", async () => {
    vi.stubEnv("EXA_API_KEY", "fixture-only");
    simulateSec();
    vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
            Response.json({
                results: [
                    {
                        id: "filing",
                        url: secFiling,
                        title: "Material event",
                        publishedDate: "2025-04-15",
                    },
                ],
            }),
        ),
    );
    const f = await enqueueLookup("filing", 1, "search_public_context");
    assert((await dispatchLookup(f)).kind === "success");
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: f.missionId,
            expectedGeneration: 1,
            cause: "selected-filing",
            input: {
                kind: "read_public_context",
                messageId: f.messageId,
                target: { kind: "candidate", searchId: f.requestId, index: 0 },
            },
        },
    );
    const result = await f.t.action(internal.execution.operations.dispatch, {
        requestId,
        expectedGeneration: 1,
    });
    assert(result.kind === "success", JSON.stringify(result));
    expect(JSON.parse(result.valueJson)).toMatchObject({
        reference: {
            publishedAt: "2025-04-15T00:00:00.000Z",
            eventAt: "2025-04-09T00:00:00.000Z",
        },
    });
    expect(
        vi.mocked(requestPinnedPublicSource).mock.calls.map(([url]) => url),
    ).toEqual([secFiling]);
    expect(await providerReceipts(f)).toHaveLength(2);
});

test("selected publication exhausts the reading grant without losing an earlier passage", async () => {
    vi.stubEnv("EXA_API_KEY", "fixture-only");
    let acquisitions = 0;
    vi.stubGlobal(
        "fetch",
        vi.fn(async (url) => {
            if (String(url).endsWith("/search"))
                return Response.json({
                    results: [
                        {
                            id: "one",
                            url: "https://example.com/one",
                            title: "First",
                        },
                        {
                            id: "two",
                            url: "https://example.org/two",
                            title: "Second",
                        },
                    ],
                });
            acquisitions++;
            return Response.json({
                results: [
                    {
                        id: "one",
                        url: "https://example.com/one",
                        text: "The earlier useful passage remains available.",
                    },
                ],
            });
        }),
    );
    const f = await enqueueLookup("event", 1, "search_public_context");
    assert((await dispatchLookup(f)).kind === "success");
    const results = [];
    for (const index of [0, 1]) {
        const requestId = await f.t.mutation(
            internal.execution.operations.enqueue,
            {
                missionId: f.missionId,
                expectedGeneration: 1,
                cause: `read-${index}`,
                input: {
                    kind: "read_public_context",
                    messageId: f.messageId,
                    target: { kind: "candidate", searchId: f.requestId, index },
                },
            },
        );
        results.push({
            requestId,
            outcome: await f.t.action(internal.execution.operations.dispatch, {
                requestId,
                expectedGeneration: 1,
            }),
        });
    }
    expect(results[0]?.outcome.kind).toBe("success");
    expect(results[1]?.outcome).toEqual({
        kind: "unavailable",
        code: "public_context_allowance_exhausted",
    });
    assert(results[0]);
    expect(
        await f.t.action(internal.execution.operations.dispatch, {
            requestId: results[0].requestId,
            expectedGeneration: 1,
        }),
    ).toEqual(results[0].outcome);
    expect(acquisitions).toBe(1);
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.missionId)))?.progressKeys,
    ).toHaveLength(3);
});

test("selected publication settles an in-flight response after cancellation without adopting it", async () => {
    vi.stubEnv("EXA_API_KEY", "fixture-only");
    let f: Lookup;
    vi.stubGlobal(
        "fetch",
        vi.fn(async (url) => {
            if (String(url).endsWith("/search"))
                return Response.json({
                    results: [
                        {
                            id: "lead",
                            url: "https://example.com/late",
                            title: "Announcement",
                        },
                    ],
                });
            const conversation = await f.client.query(
                api.execution.conversations.get,
                { runId: f.runId },
            );
            assert(conversation.activeTurn);
            await f.client.mutation(api.execution.conversations.stopResponse, {
                runId: f.runId,
                turnId: conversation.activeTurn._id,
            });
            return Response.json({
                results: [
                    {
                        id: "late",
                        url: "https://example.com/late",
                        text: "Cancelled passage.",
                    },
                ],
                costDollars: { total: 0.001 },
            });
        }),
    );
    f = await enqueueLookup("event", 1, "search_public_context");
    assert((await dispatchLookup(f)).kind === "success");
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: f.missionId,
            expectedGeneration: 1,
            cause: "cancelled-read",
            input: {
                kind: "read_public_context",
                messageId: f.messageId,
                target: { kind: "candidate", searchId: f.requestId, index: 0 },
            },
        },
    );
    const result = await f.t.action(internal.execution.operations.dispatch, {
        requestId,
        expectedGeneration: 1,
    });
    expect(result).toMatchObject({ kind: "refused" });
    expect(
        (await f.t.run((ctx) => ctx.db.get(requestId)))?.adoptedAt,
    ).toBeUndefined();
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.missionId)))?.progressKeys,
    ).toHaveLength(1);
    expect((await providerReceipts(f)).at(-1)).toMatchObject({
        status: "succeeded",
        reportedCost: 0.001,
        dispatchOutcome: "response_received",
    });
});

test.each([
    "cancel",
    "edit",
] as const)("selected publication revoked during DNS never dispatches Contents (%s)", async (revocation) => {
    vi.stubEnv("EXA_API_KEY", "fixture-only");
    let contents = 0;
    vi.stubGlobal(
        "fetch",
        vi.fn(async (url) => {
            if (String(url).endsWith("/search"))
                return Response.json({
                    results: [
                        {
                            id: "lead",
                            url: "https://example.com/rights",
                            title: "Rights",
                        },
                    ],
                });
            contents++;
            return Response.json({
                results: [
                    {
                        id: "lead",
                        url: "https://example.com/rights",
                        text: "Late reading.",
                    },
                ],
            });
        }),
    );
    const f = await enqueueLookup("rights", 1, "search_public_context");
    assert((await dispatchLookup(f)).kind === "success");
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: f.missionId,
            expectedGeneration: 1,
            cause: "held-dns",
            input: {
                kind: "read_public_context",
                messageId: f.messageId,
                target: { kind: "candidate", searchId: f.requestId, index: 0 },
            },
        },
    );
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
        entered = resolve;
    });
    const held = new Promise<void>((resolve) => {
        release = resolve;
    });
    dnsLookup.mockImplementationOnce(async () => {
        entered();
        await held;
        return [{ address: "93.184.216.34", family: 4 }];
    });
    const dispatch = f.t.action(internal.execution.operations.dispatch, {
        requestId,
        expectedGeneration: 1,
    });
    await started;
    try {
        if (revocation === "cancel") {
            const conversation = await f.client.query(
                api.execution.conversations.get,
                { runId: f.runId },
            );
            assert(conversation.activeTurn);
            await f.client.mutation(api.execution.conversations.stopResponse, {
                runId: f.runId,
                turnId: conversation.activeTurn._id,
            });
        } else {
            await f.client.mutation(api.framing.save, {
                runId: f.runId,
                expectedRevision: 1,
                requestKey: "during-dns",
                content: { scope: "Analyst's changed scope", questions: [] },
            });
        }
    } finally {
        release();
    }
    await dispatch;
    expect(contents).toBe(0);
    expect((await providerReceipts(f)).at(-1)).toMatchObject({
        status: "failed",
        dispatchOutcome: "not_dispatched",
    });
    expect(
        (await f.t.run((ctx) => ctx.db.get(requestId)))?.adoptedAt,
    ).toBeUndefined();
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.missionId)))?.progressKeys,
    ).toHaveLength(1);
}, 30000);

test("conditional questions share one retained passage in the actual mission context", async () => {
    const { readFileSync } = await import("node:fs");
    const { estimateTextTokens } = await import(
        "@earendil-works/pi-ai/utils/estimate"
    );
    const material = readFileSync(
        "scripts/evaluations/workbench-browser/fixtures/directed-framing-20261118/nvidia-governance.html",
        "utf8",
    );
    vi.stubEnv("EXA_API_KEY", "fixture-only");
    vi.stubGlobal(
        "fetch",
        vi.fn(async (url) =>
            String(url).endsWith("/search")
                ? Response.json({
                      results: [
                          {
                              id: "rights",
                              url: "https://example.com/rights",
                              title: "Replay fixture",
                              publishedDate: "2026-11-12",
                          },
                      ],
                  })
                : Response.json({
                      results: [
                          {
                              id: "rights",
                              url: "https://example.com/rights",
                              text: material,
                          },
                      ],
                  }),
        ),
    );
    const f = await enqueueLookup(
        "rights",
        1,
        "search_public_context",
        "Company workflows",
    );
    assert((await dispatchLookup(f)).kind === "success");
    const readId = await f.t.mutation(internal.execution.operations.enqueue, {
        missionId: f.missionId,
        expectedGeneration: 1,
        cause: "shared-reading",
        input: {
            kind: "read_public_context",
            messageId: f.messageId,
            target: { kind: "candidate", searchId: f.requestId, index: 0 },
        },
    });
    const reading = await f.t.action(internal.execution.operations.dispatch, {
        requestId: readId,
        expectedGeneration: 1,
    });
    assert(reading.kind === "success");
    const reference = JSON.parse(reading.valueJson).reference;
    const questions = ["a", "b", "c"].map((id) => ({
        id,
        shortLabel: id,
        text: `Which ${id} workflow decisions depend on the platform?`,
        rationale: "Test control.",
    }));
    const editId = await f.t.mutation(internal.execution.operations.enqueue, {
        missionId: f.missionId,
        expectedGeneration: 1,
        cause: "shared-conditions",
        input: {
            kind: "adjust_framing",
            messageId: f.messageId,
            expectedRevision: 1,
            content: { scope: "Company workflows", questions },
            eventBasis: {
                kind: "open",
                activityExcerpt: "Company workflows",
                conditions: questions.map((question) => ({
                    questionId: question.id,
                    hypothesis: `the ${question.id} condition holds`,
                    basis: { kind: "public" as const, readIds: [readId] },
                })),
            },
        },
    });
    expect(
        await f.t.action(internal.execution.operations.dispatch, {
            requestId: editId,
            expectedGeneration: 1,
        }),
    ).toMatchObject({ kind: "success" });
    const context = await f.t.query(internal.execution.context.build, {
        missionId: f.missionId,
        expectedGeneration: 1,
    });
    assert(context.kind === "ready");
    const wire = JSON.parse(context.inputJson);
    const projected = JSON.stringify(wire.domain.framing.conditionReferences);
    const copies =
        projected.split(JSON.stringify(reference.excerpt).slice(1, -1)).length -
        1;
    const measurements = {
        passageCharacters: reference.excerpt.length,
        bytes: new TextEncoder().encode(projected).length,
        estimatedTokens: estimateTextTokens(projected),
    };
    process.stdout.write(
        `Conditional provenance real-capture sizing ${JSON.stringify(measurements)}\n`,
    );
    expect(copies).toBe(1);
    expect(wire.domain.framing.conditionReferences).toEqual([
        { readId, ...reference },
    ]);
    for (const condition of wire.domain.framing.eventBasis.conditions)
        expect(condition.basis.readIds).toEqual([readId]);
});

test.each([
    [
        "balanced",
        "Seek official material and independent sources that can challenge it.",
    ],
    [
        "first_party_depth",
        "Prioritize relevant issuer and regulatory publications.",
    ],
    [
        "independent_scrutiny",
        "Prioritize independent material that can test the account.",
    ],
] as const)("framing discovery applies the selected coverage priority before provider dispatch: %s", async (preset, orientation) => {
    vi.stubEnv("EXA_API_KEY", "fixture-only");
    const bodies: Array<{ query: string }> = [];
    vi.stubGlobal(
        "fetch",
        vi.fn(async (_url, init) => {
            bodies.push(JSON.parse(String(init.body)));
            return Response.json({
                results: [
                    {
                        id: "context",
                        url: "https://example.org/context",
                        title: "Workflow announcement",
                        publishedDate: "2026-11-01",
                    },
                ],
                costDollars: { total: 0.01 },
            });
        }),
    );
    const f = await enqueueLookup(
        "recent announcement",
        1,
        "search_public_context",
        undefined,
        6,
        preset,
    );
    const result = await dispatchLookup(f);
    assert(result.kind === "success", JSON.stringify(result));
    expect(JSON.parse(result.valueJson)).toMatchObject({
        searchId: f.requestId,
        candidates: [
            {
                url: "https://example.org/context",
                title: "Workflow announcement",
            },
        ],
    });
    const run = await f.t.run((ctx) => ctx.db.get(f.runId));
    assert(run?.companySnapshot);
    assert(bodies[0]);
    expect(bodies[0].query).toBe(
        `${run.companySnapshot.legalName}: recent announcement\n${orientation}`,
    );
    const receipts = await providerReceipts(f);
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({
        status: "succeeded",
        searchQuery: bodies[0].query,
    });
});

test.each([
    6, 7,
] as const)("framing discovery can request an official filing under independent scrutiny on version %s", async (version) => {
    vi.stubEnv("EXA_API_KEY", "fixture-only");
    const bodies: Array<{ query: string }> = [];
    vi.stubGlobal(
        "fetch",
        vi.fn(async (_url, init) => {
            bodies.push(JSON.parse(String(init.body)));
            return Response.json({ results: [], costDollars: { total: 0.01 } });
        }),
    );
    const f = await enqueueLookup(
        "filing",
        1,
        "search_public_context",
        undefined,
        version,
        "independent_scrutiny",
        "official",
    );
    expect(await dispatchLookup(f)).toMatchObject({ kind: "success" });
    assert(bodies[0]);
    expect(bodies[0].query).toBe(
        "CCC Intelligent Solutions Holdings Inc.: filing\nPrioritize relevant issuer and regulatory publications.",
    );
    const run = await f.t.run((ctx) => ctx.db.get(f.runId));
    expect(run?.coveragePreset).toBe("independent_scrutiny");
    expect(run?.publicContextAllowance).toEqual({ searches: 5, readings: 1 });
    expect((await providerReceipts(f))[0]).toMatchObject({
        searchQuery: bodies[0].query,
        status: "succeeded",
    });
});

test.each([
    512, 513,
])("framing discovery counts orientation within the %s character query", async (length) => {
    vi.stubEnv("EXA_API_KEY", "fixture-only");
    const fetcher = vi.fn(async () =>
        Response.json({ results: [], costDollars: { total: 0.01 } }),
    );
    vi.stubGlobal("fetch", fetcher);
    const orientation =
        "Prioritize relevant issuer and regulatory publications.";
    const f = await enqueueLookup(
        "x".repeat(length - orientation.length - 1),
        1,
        "search_public_context",
        undefined,
        6,
        "first_party_depth",
    );
    const result = await dispatchLookup(f);
    if (length === 512) {
        expect(result).toMatchObject({ kind: "success" });
        expect((await providerReceipts(f))[0]).toMatchObject({
            status: "succeeded",
            searchQuery: `CCC Intelligent Solutions Holdings Inc.: ${"x".repeat(length - orientation.length - 1)}\n${orientation}`,
        });
    } else {
        expect(result).toMatchObject({
            kind: "unavailable",
            code: "discovery_query_invalid",
            validation: { path: "query" },
        });
        expect(fetcher).not.toHaveBeenCalled();
        expect(await providerReceipts(f)).toEqual([]);
    }
});

test("retained v5 rejects a forged search focus before provider I/O", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const f = await enqueueLookup(
        "filing",
        1,
        "search_public_context",
        undefined,
        5,
        "balanced",
        "official",
    );
    expect(await dispatchLookup(f)).toMatchObject({
        kind: "unavailable",
        code: "operation_not_allowed",
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect(await providerReceipts(f)).toEqual([]);
});

test("framing discovery refuses an invalid focus at input validation", async () => {
    const f = await enqueueLookup(
        "filing",
        1,
        "search_public_context",
        undefined,
        6,
    );
    const before = await f.t.run((ctx) =>
        ctx.db.query("agentOperationRequests").collect(),
    );
    await expect(
        f.t.mutation(internal.execution.operations.enqueue, {
            missionId: f.missionId,
            expectedGeneration: 1,
            cause: "invalid-focus",
            input: {
                kind: "search_public_context",
                messageId: f.messageId,
                query: "filing",
                // @ts-expect-error Exercise untrusted runtime input rather than a valid typed caller.
                focus: "issuer-only",
            },
        }),
    ).rejects.toThrow();
    expect(
        await f.t.run((ctx) =>
            ctx.db.query("agentOperationRequests").collect(),
        ),
    ).toEqual(before);
    expect(await providerReceipts(f)).toEqual([]);
});

test.each([
    ["CHICAGO, Oct. 29, 2026 (GLOBE NEWSWIRE) --", "2026-10-29"],
    ["CHICAGO--(BUSINESS WIRE)--Jul. 30, 2024--", "2024-07-30"],
])("explicit release datelines retain publication evidence: %s", async (text, date) => {
    vi.stubEnv("EXA_API_KEY", "fixture-only");
    const url =
        date === "2026-10-29"
            ? "https://ir.cccis.com/node/10861/pdf"
            : "https://ir.cccis.com/news-releases/news-release-details/ccc-launches-cccr-intelligent-reinspection-help-auto-insurers";
    vi.stubGlobal(
        "fetch",
        vi.fn(async (endpoint) =>
            Response.json({
                results: String(endpoint).endsWith("/search")
                    ? [
                          {
                              id: "release",
                              url,
                              title: "Captured release dateline",
                          },
                      ]
                    : [{ id: "release", url, text }],
            }),
        ),
    );
    const f = await enqueueLookup("announcement", 1, "search_public_context");
    assert((await dispatchLookup(f)).kind === "success");
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: f.missionId,
            expectedGeneration: 1,
            cause: "dated-release",
            input: {
                kind: "read_public_context",
                messageId: f.messageId,
                target: { kind: "candidate", searchId: f.requestId, index: 0 },
            },
        },
    );
    const result = await f.t.action(internal.execution.operations.dispatch, {
        requestId,
        expectedGeneration: 1,
    });
    assert(result.kind === "success", JSON.stringify(result));
    expect(JSON.parse(result.valueJson).reference.dates).toMatchObject({
        publication: {
            status: "known",
            evidence: [
                {
                    value: date,
                    precision: "day",
                    origin: { kind: "dateline", raw: text },
                },
            ],
        },
        event: { status: "unknown", evidence: [] },
    });
});

test("independent stored and HTML publication dates retain their conflict", async () => {
    const url = "https://example.com/article";
    simulatePublisher(
        () =>
            new Response(
                '<html><head><meta property="article:published_time" content="2026-10-29T12:00:00Z"></head><body><p>Routing rights are retained.</p></body></html>',
                { headers: { "content-type": "text/html" } },
            ),
    );
    const f = await enqueueLookup(url, 1, "read_public_context", undefined, 7);
    await f.t.run((ctx) =>
        ctx.db.insert("sources", {
            runId: f.runId,
            canonicalUrl: url,
            title: "Article",
            origin: "analyst_url",
            category: "analyst",
            publishedAt: Date.UTC(2026, 9, 28),
            createdAt: Date.now(),
        }),
    );
    const result = await dispatchLookup(f);
    assert(result.kind === "success", JSON.stringify(result));
    const reading = JSON.parse(result.valueJson).reference;
    expect(reading.dates.publication.status).toBe("conflict");
    expect(
        reading.dates.publication.evidence.map(
            (item: { value: string }) => item.value,
        ),
    ).toEqual(expect.arrayContaining(["2026-10-28", "2026-10-29T12:00:00Z"]));
    expect(reading.publishedAt).toBeUndefined();
});

test("a dateline split across public read pages remains dated without reacquisition", async () => {
    vi.stubEnv("EXA_API_KEY", "fixture-only");
    const text =
        "X".repeat(8170) +
        "\nBOSTON, October 29, 2026 (GLOBE NEWSWIRE) -- Routing control remains manual.";
    const request = vi.fn(async (url: Parameters<typeof fetch>[0]) =>
        Response.json({
            results: String(url).endsWith("/search")
                ? [
                      {
                          id: "release",
                          url: "https://example.com/release",
                          title: "Release",
                      },
                  ]
                : [{ id: "release", url: "https://example.com/release", text }],
        }),
    );
    vi.stubGlobal("fetch", request);
    const f = await enqueueLookup(
        "routing",
        1,
        "search_public_context",
        undefined,
        7,
    );
    assert((await dispatchLookup(f)).kind === "success");
    let continuation: typeof f.requestId | undefined;
    let last: Infer<typeof publicReadResultValidator> | undefined;
    let consumed = "";
    do {
        const readId = await f.t.mutation(
            internal.execution.operations.enqueue,
            {
                missionId: f.missionId,
                expectedGeneration: 1,
                cause: `split-date-${consumed.length}`,
                input: {
                    kind: "read_public_context",
                    messageId: f.messageId,
                    target: {
                        kind: "candidate",
                        searchId: f.requestId,
                        index: 0,
                    },
                    ...(continuation ? { continuation } : {}),
                },
            },
        );
        const outcome = await f.t.action(
            internal.execution.operations.dispatch,
            { requestId: readId, expectedGeneration: 1 },
        );
        assert(outcome.kind === "success", JSON.stringify(outcome));
        last = JSON.parse(outcome.valueJson);
        assert(last?.reference);
        consumed += last.reference.excerpt;
        continuation = last.continuation;
    } while (continuation);
    expect(consumed).toBe(text);
    assert(last?.reference?.dates);
    expect(last.reference.dates.publication).toMatchObject({
        status: "known",
        evidence: [{ value: "2026-10-29", precision: "day" }],
    });
    expect(last.reference.publishedAt).toBe("2026-10-29T00:00:00.000Z");
    expect(
        request.mock.calls.filter(([url]) => !String(url).endsWith("/search")),
    ).toHaveLength(1);
});

test.each([
    false,
    true,
])("continuation preserves conflicting event dates from historical aliases: %s", async (historical) => {
    vi.stubEnv("SEC_USER_AGENT", "Fixture contact fixture@example.com");
    simulatePublisher((url) =>
        url === secSubmissions
            ? Response.json({
                  cik: "1818201",
                  name: "Fixture issuer",
                  tickers: ["FIX"],
                  exchanges: ["NYSE"],
                  filings: {
                      recent: {
                          accessionNumber: ["0000950170-25-000001"],
                          filingDate: ["2025-04-15"],
                          primaryDocument: ["filing.htm"],
                      },
                  },
              })
            : new Response(
                  `<html><body><p>Date of Report (Date of earliest event reported): April 9, 2025</p><p>${"x".repeat(9000)}</p><p>Date of Report (Date of earliest event reported): April 10, 2025</p></body></html>`,
                  { headers: { "content-type": "text/html" } },
              ),
    );
    const f = await enqueueLookup(
        secFiling,
        2,
        "read_public_context",
        undefined,
        7,
    );
    const first = await dispatchLookup(f);
    assert(first.kind === "success", JSON.stringify(first));
    const retained = JSON.parse(first.valueJson);
    if (historical) {
        delete retained.reference.dates;
        retained.reference.eventAt = "2025-04-09T00:00:00.000Z";
        await f.t.run((ctx) =>
            ctx.db.patch(f.requestId, {
                outcome: {
                    kind: "success",
                    valueJson: JSON.stringify(retained),
                },
            }),
        );
    }
    const readId = await f.t.mutation(internal.execution.operations.enqueue, {
        missionId: f.missionId,
        expectedGeneration: 1,
        cause: "event-continuation",
        input: {
            kind: "read_public_context",
            messageId: f.messageId,
            target: { kind: "supplied", url: secFiling },
            continuation: f.requestId,
        },
    });
    const second = await f.t.action(internal.execution.operations.dispatch, {
        requestId: readId,
        expectedGeneration: 1,
    });
    assert(second.kind === "success", JSON.stringify(second));
    const reading = JSON.parse(second.valueJson).reference;
    expect(reading.dates.event.status).toBe("conflict");
    expect(
        reading.dates.event.evidence.map(
            (item: { value: string }) => item.value,
        ),
    ).toEqual(expect.arrayContaining(["2025-04-09", "2025-04-10"]));
    expect(reading.eventAt).toBeUndefined();
});
