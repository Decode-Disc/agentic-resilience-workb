import { internal } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { mergeRunCompanyMetadata } from "@convex/domain/companyMetadata";
import schema from "@convex/schema";
import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { expect, test } from "vitest";

const modules = import.meta.glob("/convex/**/*.ts");
const getRunCompany = makeFunctionReference<
    "query",
    { runId: Id<"researchRuns"> },
    {
        executionGeneration: number;
        company: {
            cik: string;
            legalName: string;
            ticker: string;
            exchange: string;
            websiteUrl?: string;
            investorRelationsUrl?: string;
        };
    }
>("companyResolution:getRunCompany");
const verifyRevalidation = makeFunctionReference<
    "mutation",
    {
        runId: Id<"researchRuns">;
        executionGeneration: number;
        resolved: {
            cik: string;
            legalName: string;
            ticker: string;
            exchange: string;
        };
    },
    boolean
>("companyResolution:verifyRevalidation");
const createForRun = makeFunctionReference<
    "mutation",
    { runId: Id<"researchRuns">; expectedExecutionGeneration: number },
    Id<"researchPlans">
>("researchPlanning:createForRun");
const persistRunCompanyWebsite = makeFunctionReference<
    "mutation",
    {
        runId: Id<"researchRuns">;
        companyId: Id<"companies">;
        websiteUrl: string;
        websiteUrlSource?: "sec_ir" | "exa" | "probe";
    },
    null
>("companyResolution:persistRunCompanyWebsite");

const staleSnapshot = {
    cik: "1373715",
    legalName: "ServiceNow, Inc.",
    ticker: "NOW",
    exchange: "NYSE",
    websiteUrl: "https://old.example/",
    investorRelationsUrl: "https://ir.old.example/",
};

async function seedRun(lifecycleState: "draft" | "discovering_sources") {
    const t = convexTest(schema, modules);
    const fixture = await t.run(async (ctx) => {
        const companyId = await ctx.db.insert("companies", {
            cik: "1373715",
            legalName: "ServiceNow, Inc.",
            ticker: "NOW",
            exchange: "NYSE",
            websiteUrl: "https://www.servicenow.com/",
            investorRelationsUrl: "https://investor.servicenow.com/",
            canonicalizedAt: 2,
        });
        const runId = await ctx.db.insert("researchRuns", {
            purpose: "research",
            companyId,
            companySnapshot: staleSnapshot,
            coveragePreset: "balanced",
            lifecycleState,
            executionStatus: "running",
            executionGeneration: 3,
            nextEventSequence: 1,
            createdAt: 1,
            updatedAt: 1,
        });
        return { companyId, runId };
    });
    return { t, fixture };
}

test("reads mutable company domains from the current CIK record", async () => {
    const { t, fixture } = await seedRun("draft");

    await expect(
        t.query(getRunCompany, { runId: fixture.runId }),
    ).resolves.toMatchObject({
        company: {
            cik: "1373715",
            websiteUrl: "https://www.servicenow.com/",
            investorRelationsUrl: "https://investor.servicenow.com/",
        },
    });
});

test("revalidation does not let stale snapshot domains overwrite current metadata", async () => {
    const { t, fixture } = await seedRun("draft");

    await expect(
        t.mutation(verifyRevalidation, {
            runId: fixture.runId,
            executionGeneration: 3,
            resolved: {
                cik: "1373715",
                legalName: "ServiceNow, Inc.",
                ticker: "NOW",
                exchange: "NYSE",
            },
        }),
    ).resolves.toBe(true);
    await expect(
        t.run((ctx) => ctx.db.get(fixture.runId)),
    ).resolves.toMatchObject({
        companySnapshot: {
            websiteUrl: "https://www.servicenow.com/",
            investorRelationsUrl: "https://investor.servicenow.com/",
        },
    });
});

test("website persistence replaces a stale run snapshot value", async () => {
    const { t, fixture } = await seedRun("draft");

    await t.mutation(persistRunCompanyWebsite, {
        runId: fixture.runId,
        companyId: fixture.companyId,
        websiteUrl: "https://www.servicenow.com/",
        websiteUrlSource: "exa",
    });

    await expect(
        t.run((ctx) => ctx.db.get(fixture.runId)),
    ).resolves.toMatchObject({
        companySnapshot: {
            websiteUrl: "https://www.servicenow.com/",
            websiteUrlSource: "exa",
        },
    });
});

test.each([
    "",
    "   ",
    "not-a-url",
    "http://example.com/",
    "https://user:secret@example.com/",
    " https://example.com/ ",
])("website persistence rejects invalid websiteUrl %j without replacing metadata", async (websiteUrl) => {
    const { t, fixture } = await seedRun("draft");
    const before = await t.run(async (ctx) => ({
        company: await ctx.db.get(fixture.companyId),
        run: await ctx.db.get(fixture.runId),
    }));
    await expect(
        t.mutation(persistRunCompanyWebsite, {
            runId: fixture.runId,
            companyId: fixture.companyId,
            websiteUrl,
            websiteUrlSource: "exa",
        }),
    ).rejects.toThrow(
        "websiteUrl must be an absolute HTTPS URL without credentials",
    );
    expect(
        await t.run(async (ctx) => ({
            company: await ctx.db.get(fixture.companyId),
            run: await ctx.db.get(fixture.runId),
        })),
    ).toEqual(before);
});

test("company reads report a legacy blank website instead of mixing its value with snapshot provenance", async () => {
    const { t, fixture } = await seedRun("draft");
    await t.run((ctx) => ctx.db.patch(fixture.companyId, { websiteUrl: "" }));
    await expect(
        t.query(getRunCompany, { runId: fixture.runId }),
    ).rejects.toThrow(
        "websiteUrl must be an absolute HTTPS URL without credentials",
    );
});

test("an absent current website preserves the snapshot URL and its provenance", async () => {
    const { t, fixture } = await seedRun("draft");
    await t.run(async (ctx) => {
        await ctx.db.patch(fixture.companyId, {
            websiteUrl: undefined,
            websiteUrlSource: "exa",
        });
        await ctx.db.patch(fixture.runId, {
            companySnapshot: { ...staleSnapshot, websiteUrlSource: "sec_ir" },
        });
    });
    expect(
        await t.query(getRunCompany, { runId: fixture.runId }),
    ).toMatchObject({
        company: { websiteUrl: "https://old.example/" },
    });
    expect(
        await t.run(async (ctx) =>
            mergeRunCompanyMetadata(
                (await ctx.db.get(fixture.runId))?.companySnapshot,
                await ctx.db.get(fixture.companyId),
            ),
        ),
    ).toMatchObject({
        websiteUrl: "https://old.example/",
        websiteUrlSource: "sec_ir",
    });
});

test.each([
    "",
    "https://www.servicenow.com/",
])("explicit valid website persistence repairs a legacy blank value with snapshot %j", async (snapshotUrl) => {
    const { t, fixture } = await seedRun("draft");
    await t.run(async (ctx) => {
        await ctx.db.patch(fixture.companyId, { websiteUrl: "" });
        await ctx.db.patch(fixture.runId, {
            companySnapshot: {
                ...staleSnapshot,
                websiteUrl: snapshotUrl,
                websiteUrlSource: "exa",
            },
        });
    });
    await t.mutation(persistRunCompanyWebsite, {
        runId: fixture.runId,
        companyId: fixture.companyId,
        websiteUrl: "https://www.servicenow.com/",
        websiteUrlSource: "exa",
    });
    expect(
        await t.query(getRunCompany, { runId: fixture.runId }),
    ).toMatchObject({
        company: { websiteUrl: "https://www.servicenow.com/" },
    });
    expect(await t.run((ctx) => ctx.db.get(fixture.companyId))).toMatchObject({
        websiteUrl: "https://www.servicenow.com/",
        websiteUrlSource: "exa",
    });
    expect(await t.run((ctx) => ctx.db.get(fixture.runId))).toMatchObject({
        companySnapshot: {
            websiteUrl: "https://www.servicenow.com/",
            websiteUrlSource: "exa",
        },
    });
});

test("website provider persistence rejects an empty URL before changing metadata or settling its receipt", async () => {
    const { t, fixture } = await seedRun("draft");
    const providerCallId = await t.run((ctx) =>
        ctx.db.insert("providerCalls", {
            service: "exa",
            operation: "resolve_company_website",
            operationKey: "empty-website",
            status: "started",
            attempt: 1,
            createdAt: Date.now(),
        }),
    );
    const before = await t.run(async (ctx) => ({
        company: await ctx.db.get(fixture.companyId),
        receipt: await ctx.db.get(providerCallId),
    }));
    await expect(
        t.mutation(internal.companyResolution.persistWebsiteResolution, {
            company: staleSnapshot,
            websiteUrl: "",
            websiteUrlSource: "exa",
            providerCallId,
            status: "succeeded",
            latencyMs: 1,
            accepted: 1,
            rejected: 0,
        }),
    ).rejects.toThrow(
        "websiteUrl must be an absolute HTTPS URL without credentials",
    );
    expect(
        await t.run(async (ctx) => ({
            company: await ctx.db.get(fixture.companyId),
            receipt: await ctx.db.get(providerCallId),
        })),
    ).toEqual(before);
});

test.each([
    "preflight",
    "revalidation",
])("%s rejects supplied blank website metadata instead of replacing a usable URL", async (boundary) => {
    const { t, fixture } = await seedRun("draft");
    const authUserId = await t.run((ctx) =>
        ctx.db.insert("users", { isAnonymous: true }),
    );
    const session = t.withIdentity({
        subject: `${authUserId}|metadata-contract`,
    });
    const before = await t.run(async (ctx) => ({
        company: await ctx.db.get(fixture.companyId),
        run: await ctx.db.get(fixture.runId),
    }));
    const company = { ...staleSnapshot, websiteUrl: "" };
    const result =
        boundary === "preflight"
            ? session.mutation(internal.companyResolution.persistPreflight, {
                  query: "NOW",
                  company,
                  expiresAt: Date.now() + 60_000,
                  resolverVersion: "fixture",
              })
            : t.mutation(internal.companyResolution.verifyRevalidation, {
                  runId: fixture.runId,
                  executionGeneration: 3,
                  resolved: company,
              });
    await expect(result).rejects.toThrow(
        "websiteUrl must be an absolute HTTPS URL without credentials",
    );
    expect(
        await t.run(async (ctx) => ({
            company: await ctx.db.get(fixture.companyId),
            run: await ctx.db.get(fixture.runId),
        })),
    ).toEqual(before);
});

test("website persistence clears provenance inherited from a replaced URL", async () => {
    const { t, fixture } = await seedRun("draft");
    await t.run((ctx) =>
        ctx.db.patch(fixture.runId, {
            companySnapshot: {
                ...staleSnapshot,
                websiteUrlSource: "probe",
            },
        }),
    );

    await t.mutation(persistRunCompanyWebsite, {
        runId: fixture.runId,
        companyId: fixture.companyId,
        websiteUrl: "https://www.servicenow.com/",
    });

    const [run, company] = await t.run(async (ctx) =>
        Promise.all([ctx.db.get(fixture.runId), ctx.db.get(fixture.companyId)]),
    );
    expect(run?.companySnapshot).toMatchObject({
        websiteUrl: "https://www.servicenow.com/",
    });
    expect(run?.companySnapshot).not.toHaveProperty("websiteUrlSource");
    expect(company).not.toHaveProperty("websiteUrlSource");
});

test("builds official discovery queries from current company domains", async () => {
    const { t, fixture } = await seedRun("discovering_sources");

    const planId = await t.mutation(createForRun, {
        runId: fixture.runId,
        expectedExecutionGeneration: 3,
    });
    const plan = await t.run((ctx) => ctx.db.get(planId));

    expect(plan?.queries).toEqual(
        expect.arrayContaining([
            expect.objectContaining({
                discoveryIntent: "investor_relations",
                includeDomains: ["servicenow.com", "investor.servicenow.com"],
            }),
            expect.objectContaining({
                discoveryIntent: "official_product",
                includeDomains: ["servicenow.com"],
            }),
        ]),
    );
});
