import { api, internal } from "@convex/_generated/api";
import { requestPinnedPublicSource } from "@convex/sourceActions";
import { afterEach, assert, expect, test, vi } from "vitest";
import rateLimiterTest from "@/__tests__/convex/integrations/rate-limiter-test-register.js";
import { nativePiFixtureRoute } from "@/__tests__/setup/pi-native";
import { seedWorkbench } from "@/__tests__/setup/workbench";

vi.mock("node:dns/promises", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:dns/promises")>();
    const lookup = vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]);
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
async function enqueueLookup(query: string, readings = 1) {
    vi.stubEnv(
        "WORKBENCH_PUBLIC_CONTEXT_ALLOWANCE",
        JSON.stringify({ searches: 1, readings }),
    );
    const fixture = await seedWorkbench(
        false,
        nativePiFixtureRoute,
        undefined,
        `Read ${query}`,
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
            input: {
                kind: "verify_public_context",
                messageId: message._id,
                query,
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
    expect(JSON.parse(observation.valueJson)).toEqual({
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
    expect(JSON.parse(outcome.valueJson)).toEqual({
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
