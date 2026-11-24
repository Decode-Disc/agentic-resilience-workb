import {
    preflightCompanyWithResolver,
    type SecCompanyResolver,
    searchCompaniesWithResolver,
} from "@convex/companyResolution";
import schema from "@convex/schema";
import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import rateLimiterTest from "../integrations/rate-limiter-test-register.js";

const company = {
    legalName: "CCC Intelligent Solutions Holdings Inc.",
    ticker: "CCCS",
    exchange: "NASDAQ",
    cik: "1818201",
    investorRelationsUrl: "https://ir.cccis.com/",
};

const modules = import.meta.glob("/convex/**/*.ts");
const originalFetch = globalThis.fetch;
const originalSecUserAgent = process.env.SEC_USER_AGENT;

afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalSecUserAgent === undefined) {
        delete process.env.SEC_USER_AGENT;
    } else {
        process.env.SEC_USER_AGENT = originalSecUserAgent;
    }
    vi.restoreAllMocks();
});

const persistPreflight = makeFunctionReference<
    "mutation",
    {
        query: string;
        company: typeof company;
        expiresAt: number;
        resolverVersion: string;
    },
    {
        preflightId: string;
        company: typeof company;
        expiresAt: number;
    }
>("companyResolution:persistPreflight");
const preflightCompany = makeFunctionReference<
    "action",
    { cik: string },
    unknown
>("companyResolution:preflight");
const searchCompanies = makeFunctionReference<
    "action",
    { query: string },
    unknown
>("companyResolution:search");

describe("preflightCompanyWithResolver", () => {
    test("revalidates the explicitly selected CIK without reserving an analysis", async () => {
        const resolver: SecCompanyResolver = {
            search: vi.fn(async () => [company]),
            revalidate: vi.fn(async () => company),
        };
        const persist = vi.fn(async (input) => ({
            preflightId: "preflight-1",
            company: input.company,
            expiresAt: input.expiresAt,
        }));

        await expect(
            preflightCompanyWithResolver(
                { cik: "  1818201  " },
                {
                    resolver,
                    now: () => 1_000,
                    persist,
                    resolveWebsite: async () => null,
                },
            ),
        ).resolves.toEqual({
            preflightId: "preflight-1",
            company,
            expiresAt: 901_000,
        });
        expect(persist).toHaveBeenCalledWith({
            query: "1818201",
            company,
            expiresAt: 901_000,
            resolverVersion: "sec-company-v2",
        });
        expect(resolver.revalidate).toHaveBeenCalledWith("1818201");
    });

    test("rejects an invalid selected CIK", async () => {
        const resolver: SecCompanyResolver = {
            search: vi.fn(async () => [company]),
            revalidate: vi.fn(async () => company),
        };

        await expect(
            preflightCompanyWithResolver(
                { cik: "not-a-cik" },
                {
                    resolver,
                    now: () => 1_000,
                    persist: vi.fn(),
                    resolveWebsite: async () => null,
                },
            ),
        ).rejects.toThrow("valid CIK");
        expect(resolver.revalidate).not.toHaveBeenCalled();
    });

    test("enriches the company snapshot with the resolved website", async () => {
        const resolvedCompany = { ...company, websiteUrl: undefined };
        const resolver: SecCompanyResolver = {
            search: vi.fn(async () => [resolvedCompany]),
            revalidate: vi.fn(async () => resolvedCompany),
        };
        const persist = vi.fn(async (input) => ({
            preflightId: "preflight-2",
            company: input.company,
            expiresAt: input.expiresAt,
        }));
        // SEC IR url is a vendor subdomain → classifyIr rejects, Exa resolves.
        const resolveWebsite = vi.fn(async () => ({
            url: "https://servicenow.com/",
            source: "exa" as const,
        }));

        const result = await preflightCompanyWithResolver(
            { cik: "1818201" },
            {
                resolver,
                now: () => 1_000,
                persist,
                resolveWebsite,
            },
        );

        expect(resolveWebsite).toHaveBeenCalledTimes(1);
        expect(persist).toHaveBeenCalledWith(
            expect.objectContaining({
                company: expect.objectContaining({
                    websiteUrl: "https://servicenow.com/",
                    websiteUrlSource: "exa",
                }),
            }),
        );
        expect(result.company.websiteUrl).toBe("https://servicenow.com/");
        expect(result.company.websiteUrlSource).toBe("exa");
    });
});

test("searches for multiple matching companies without persisting a preflight", async () => {
    const secondCompany = {
        ...company,
        cik: "1000001",
        legalName: "Intelligent Systems Corporation",
        ticker: "INS",
    };
    const resolver: SecCompanyResolver = {
        search: vi.fn(async () => [secondCompany, company]),
        revalidate: vi.fn(async () => company),
    };

    await expect(
        searchCompaniesWithResolver({ query: " intelligent " }, { resolver }),
    ).resolves.toEqual([secondCompany, company]);
    expect(resolver.search).toHaveBeenCalledWith("intelligent");
    expect(resolver.revalidate).not.toHaveBeenCalled();
});

test("persists a preflight for an anonymous session before admission", async () => {
    const t = convexTest(schema, modules);
    rateLimiterTest.register(t);
    const userId = await t.run(async (ctx) => {
        const userId = await ctx.db.insert("users", { isAnonymous: true });
        return userId;
    });
    const anonymousSession = t.withIdentity({
        subject: `${userId}|preflight-session`,
    });

    const result = await anonymousSession.mutation(persistPreflight, {
        query: "CCCS",
        company,
        expiresAt: 901_000,
        resolverVersion: "sec-company-v1",
    });

    expect(result).toMatchObject({
        company,
        expiresAt: 901_000,
    });
    await expect(
        t.run(async (ctx) => ctx.db.query("companyPreflights").collect()),
    ).resolves.toHaveLength(1);
});

test("rejects unauthenticated preflight persistence", async () => {
    const t = convexTest(schema, modules);
    rateLimiterTest.register(t);

    await expect(
        t.mutation(persistPreflight, {
            query: "CCCS",
            company,
            expiresAt: 901_000,
            resolverVersion: "sec-company-v1",
        }),
    ).rejects.toThrow("Not authenticated");
});

test("rejects an unauthenticated public preflight", async () => {
    const t = convexTest(schema, modules);
    rateLimiterTest.register(t);

    await expect(
        t.action(preflightCompany, { cik: "1818201" }),
    ).rejects.toThrow("Not authenticated");
});

test("searches and preflights a selected company for an anonymous session before admission", async () => {
    process.env.SEC_USER_AGENT = "Evidence Workbench test@example.com";
    globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
        if (String(input).endsWith("/files/company_tickers_exchange.json")) {
            return new Response(
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
            );
        }
        return new Response(
            JSON.stringify({
                cik: "0001818201",
                name: "CCC Intelligent Solutions Holdings Inc.",
                tickers: ["CCCS"],
                exchanges: ["Nasdaq"],
                filings: { recent: { accessionNumber: ["0001"] } },
            }),
            { status: 200 },
        );
    });
    const t = convexTest(schema, modules);
    rateLimiterTest.register(t);
    const userId = await t.run((ctx) =>
        ctx.db.insert("users", { isAnonymous: true }),
    );
    const anonymousSession = t.withIdentity({
        subject: `${userId}|public-preflight-session`,
    });

    await expect(
        anonymousSession.action(searchCompanies, { query: "CCC" }),
    ).resolves.toEqual([
        expect.objectContaining({
            legalName: "CCC Intelligent Solutions Holdings Inc.",
            ticker: "CCCS",
            exchange: "NASDAQ",
            cik: "1818201",
        }),
    ]);
    await expect(
        anonymousSession.action(preflightCompany, { cik: "1818201" }),
    ).resolves.toMatchObject({
        company: {
            legalName: "CCC Intelligent Solutions Holdings Inc.",
            ticker: "CCCS",
            exchange: "NASDAQ",
            cik: "1818201",
        },
    });
});
