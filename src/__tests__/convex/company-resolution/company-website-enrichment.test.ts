import schema from "@convex/schema";
import { withWebsiteTimeout } from "@convex/companyResolution";
import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import rateLimiterTest from "../integrations/rate-limiter-test-register.js";

const { exaSearch } = vi.hoisted(() => ({ exaSearch: vi.fn() }));

vi.mock("exa-js", () => ({
    default: class MockExa {
        search(...args: unknown[]) {
            return exaSearch(...args);
        }
    },
}));

const modules = import.meta.glob("/convex/**/*.ts");
const searchCompanies = makeFunctionReference<
    "action",
    { query: string },
    Array<{ cik: string; websiteUrl?: string }>
>("companyResolution:search");
const originalFetch = globalThis.fetch;
const originalSecUserAgent = process.env.SEC_USER_AGENT;
const originalExaApiKey = process.env.EXA_API_KEY;

afterEach(() => {
    exaSearch.mockReset();
    globalThis.fetch = originalFetch;
    if (originalSecUserAgent === undefined) {
        delete process.env.SEC_USER_AGENT;
    } else {
        process.env.SEC_USER_AGENT = originalSecUserAgent;
    }
    if (originalExaApiKey === undefined) {
        delete process.env.EXA_API_KEY;
    } else {
        process.env.EXA_API_KEY = originalExaApiKey;
    }
    vi.useRealTimers();
});

async function createSession(t: ReturnType<typeof convexTest>) {
    const userId = await t.run((ctx) =>
        ctx.db.insert("users", { isAnonymous: true }),
    );
    return t.withIdentity({ subject: `${userId}|website-enrichment` });
}

function mockSecCompanyIndex() {
    globalThis.fetch = vi.fn(async () =>
        Promise.resolve(
            new Response(
                JSON.stringify({
                    fields: ["cik", "name", "ticker", "exchange"],
                    data: [
                        [
                            1818201,
                            "CCC Intelligent Solutions Holdings Inc.",
                            "CCCS",
                            "Nasdaq",
                        ],
                    ],
                }),
                { status: 200 },
            ),
        ),
    );
}

test("checks the paid-work switch before Exa website enrichment", async () => {
    process.env.SEC_USER_AGENT = "Evidence Workbench test@example.com";
    process.env.EXA_API_KEY = "test-key";
    mockSecCompanyIndex();
    const t = convexTest(schema, modules);
    rateLimiterTest.register(t);
    const session = await createSession(t);
    await t.run((ctx) =>
        ctx.db.insert("paidWorkControls", {
            key: "global",
            enabled: false,
            updatedAt: 1,
        }),
    );

    await expect(
        session.action(searchCompanies, { query: "CCCS" }),
    ).resolves.toEqual([expect.objectContaining({ cik: "1818201" })]);
    expect(exaSearch).not.toHaveBeenCalled();
});

test("uses a fresh CIK website cache without calling Exa", async () => {
    process.env.SEC_USER_AGENT = "Evidence Workbench test@example.com";
    process.env.EXA_API_KEY = "test-key";
    mockSecCompanyIndex();
    const t = convexTest(schema, modules);
    rateLimiterTest.register(t);
    await t.run((ctx) =>
        ctx.db.insert("companies", {
            cik: "1818201",
            legalName: "CCC Intelligent Solutions Holdings Inc.",
            ticker: "CCCS",
            exchange: "NASDAQ",
            websiteUrl: "https://www.cccis.com/",
            websiteUrlSource: "exa",
            websiteResolvedAt: Date.now(),
            canonicalizedAt: 1,
        }),
    );
    const session = await createSession(t);

    await expect(
        session.action(searchCompanies, { query: "CCCS" }),
    ).resolves.toEqual([
        expect.objectContaining({
            cik: "1818201",
            websiteUrl: "https://www.cccis.com/",
        }),
    ]);
    expect(exaSearch).not.toHaveBeenCalled();
});

test("keeps a stale cached website when Exa refresh fails", async () => {
    process.env.SEC_USER_AGENT = "Evidence Workbench test@example.com";
    process.env.EXA_API_KEY = "test-key";
    mockSecCompanyIndex();
    exaSearch.mockRejectedValue(new Error("Temporary Exa failure"));
    const t = convexTest(schema, modules);
    rateLimiterTest.register(t);
    await t.run((ctx) =>
        ctx.db.insert("companies", {
            cik: "1818201",
            legalName: "CCC Intelligent Solutions Holdings Inc.",
            ticker: "CCCS",
            exchange: "NASDAQ",
            websiteUrl: "https://www.cccis.com/",
            websiteUrlSource: "exa",
            websiteResolvedAt: Date.now() - 31 * 24 * 60 * 60 * 1_000,
            canonicalizedAt: 1,
        }),
    );
    const session = await createSession(t);

    await expect(
        session.action(searchCompanies, { query: "CCCS" }),
    ).resolves.toEqual([
        expect.objectContaining({ websiteUrl: "https://www.cccis.com/" }),
    ]);
    expect(exaSearch).toHaveBeenCalledOnce();
    await expect(
        t.run((ctx) =>
            ctx.db
                .query("providerCalls")
                .filter((query) => query.eq(query.field("service"), "exa"))
                .collect(),
        ),
    ).resolves.toEqual([
        expect.objectContaining({
            service: "exa",
            status: "failed",
            errorCode: "Error",
        }),
    ]);
});

test("persists a partial Exa website result and replays it from the CIK cache", async () => {
    process.env.SEC_USER_AGENT = "Evidence Workbench test@example.com";
    process.env.EXA_API_KEY = "test-key";
    mockSecCompanyIndex();
    exaSearch.mockResolvedValue({
        results: [
            {
                id: "valid",
                url: "https://www.cccis.com/",
                title: "CCC Intelligent Solutions",
                entities: [
                    {
                        type: "company",
                        properties: {
                            name: "CCC Intelligent Solutions Holdings Inc.",
                        },
                    },
                ],
            },
            {
                id: "invalid",
                url: "http://invalid.example/",
                title: "Invalid",
            },
        ],
        searchTime: 19,
        costDollars: { total: 0.001 },
    });
    const t = convexTest(schema, modules);
    rateLimiterTest.register(t);
    const session = await createSession(t);

    await expect(
        session.action(searchCompanies, { query: "CCCS" }),
    ).resolves.toEqual([
        expect.objectContaining({ websiteUrl: "https://www.cccis.com/" }),
    ]);
    await expect(
        session.action(searchCompanies, { query: "CCCS" }),
    ).resolves.toEqual([
        expect.objectContaining({ websiteUrl: "https://www.cccis.com/" }),
    ]);
    expect(exaSearch).toHaveBeenCalledOnce();
    await expect(
        t.run((ctx) =>
            ctx.db
                .query("providerCalls")
                .filter((query) => query.eq(query.field("service"), "exa"))
                .collect(),
        ),
    ).resolves.toEqual([
        expect.objectContaining({
            status: "partial",
            usage: { accepted: 1, rejected: 1, searchTime: 19 },
            reportedCost: 0.001,
        }),
    ]);
    await expect(
        t.run((ctx) =>
            ctx.db
                .query("companies")
                .withIndex("by_cik", (query) => query.eq("cik", "1818201"))
                .unique(),
        ),
    ).resolves.toMatchObject({
        websiteUrl: "https://www.cccis.com/",
        websiteUrlSource: "exa",
        websiteResolvedAt: expect.any(Number),
    });
});

test("ignores a website resolver result that arrives after its timeout", async () => {
    let release: ((value: string) => void) | undefined;
    const lateResult = new Promise<string>((resolve) => {
        release = resolve;
    });

    await expect(withWebsiteTimeout(lateResult, 5)).rejects.toThrow(
        "application timeout",
    );
    release?.("https://late.example/");
});
