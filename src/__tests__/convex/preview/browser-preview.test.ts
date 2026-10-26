import { api } from "@convex/_generated/api";
import schema from "@convex/schema";
import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import rateLimiterTest from "../integrations/rate-limiter-test-register.js";

const modules = import.meta.glob("/convex/**/*.ts");

const checkRateLimit = makeFunctionReference<"mutation">(
    "browserPreviewInternals:checkRateLimit",
);
const getSourceForPreview = makeFunctionReference<"query">(
    "browserPreviewInternals:getSourceForPreview",
);
const getPreview = makeFunctionReference<"query">(
    "browserPreviewInternals:getPreview",
);
const storePreview = makeFunctionReference<"mutation">(
    "browserPreviewInternals:storePreview",
);
const purgePreviewForSource = makeFunctionReference<"mutation">(
    "browserPreviewInternals:purgePreviewForSource",
);

type TestCtx = ReturnType<typeof convexTest>;

async function seedVisitorAndRun(t: TestCtx) {
    return t.run(async (ctx) => {
        const authUserId = await ctx.db.insert("users", {
            name: "test-user",
            email: "test@test.test",
            isAnonymous: true,
        } as any);
        const invitationId = await ctx.db.insert("invitations", {
            slotKey: "test-slot",
            role: "analyst",
            codeDigest: "test-digest",
            status: "claimed",
            createdAt: Date.now(),
        });
        const visitorId = await ctx.db.insert("visitors", {
            authUserId,
            invitationId,
            role: "analyst",
            status: "active",
            analysesReserved: 3,
            admittedAt: Date.now(),
        });
        await ctx.db.patch(invitationId, { claimedByVisitorId: visitorId });
        const companyId = await ctx.db.insert("companies", {
            cik: "0000320193",
            legalName: "Apple Inc.",
            ticker: "AAPL",
            exchange: "NASDAQ",
            canonicalizedAt: Date.now(),
        });
        const runId = await ctx.db.insert("researchRuns", {
            purpose: "research",
            ownerVisitorId: visitorId,
            companyId,
            executionGeneration: 1,
            lifecycleState: "discovering_sources",
            executionStatus: "running",
            nextEventSequence: 1,
            createdAt: Date.now(),
            updatedAt: Date.now(),
        });
        const sourceId = await ctx.db.insert("sources", {
            runId,
            canonicalUrl: "https://example.com/report",
            title: "Test Report",
            origin: "exa",
            category: "independent_analysis",
            createdAt: Date.now(),
        });
        return {
            authUserId,
            invitationId,
            visitorId,
            companyId,
            runId,
            sourceId,
        };
    });
}

describe("browserPreviewInternals", () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
    });

    it.each([
        "visitor",
        "invitation",
        "evaluation",
    ] as const)("denies cached and rendered previews after %s revocation", async (revoked) => {
        const t = convexTest(schema, modules);
        rateLimiterTest.register(t);
        const fixture = await seedVisitorAndRun(t);
        await t.mutation(storePreview, {
            visitorId: fixture.visitorId,
            sourceId: fixture.sourceId,
            dataUrl: "data:image/png;base64,PRIVATE",
            sizeBytes: 7,
            expiresAt: Date.now() + 60_000,
        });
        await t.run((ctx) =>
            revoked === "visitor"
                ? ctx.db.patch(fixture.visitorId, { status: "revoked" })
                : revoked === "invitation"
                  ? ctx.db.patch(fixture.invitationId, { status: "revoked" })
                  : ctx.db.patch(fixture.runId, { purpose: "evaluation" }),
        );
        const fetch = vi.fn();
        vi.stubGlobal("fetch", fetch);
        const owner = t.withIdentity({ subject: fixture.authUserId });
        expect(
            await owner.query(getPreview, { sourceId: fixture.sourceId }),
        ).toBeNull();
        expect(
            await owner.action(api.browserPreview.renderPreview, {
                runId: fixture.runId,
                sourceId: fixture.sourceId,
            }),
        ).toMatchObject({ status: "unavailable" });
        expect(fetch).not.toHaveBeenCalled();
    });

    it("does not return or cache a rendering completed after revocation", async () => {
        const t = convexTest(schema, modules);
        rateLimiterTest.register(t);
        const fixture = await seedVisitorAndRun(t);
        vi.stubEnv("PREVIEW_SERVICE_URL", "https://renderer.example");
        vi.stubEnv("PREVIEW_SERVICE_SECRET", "test-renderer-secret");
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => {
                await t.run((ctx) =>
                    ctx.db.patch(fixture.visitorId, { status: "revoked" }),
                );
                return new Response(new Uint8Array([137, 80, 78, 71]), {
                    headers: { "content-type": "image/png" },
                });
            }),
        );
        const result = await t
            .withIdentity({ subject: fixture.authUserId })
            .action(api.browserPreview.renderPreview, {
                runId: fixture.runId,
                sourceId: fixture.sourceId,
            });
        expect(result).toMatchObject({ status: "unavailable" });
        expect(
            await t.run((ctx) =>
                ctx.db
                    .query("previewCaches")
                    .withIndex("by_source", (q) =>
                        q.eq("sourceId", fixture.sourceId),
                    )
                    .first(),
            ),
        ).toBeNull();
    });

    describe("checkRateLimit", () => {
        it("allows first request", async () => {
            const t = convexTest(schema, modules);
            rateLimiterTest.register(t);
            const result = await t.mutation(checkRateLimit, {
                key: "test-key-001",
            });
            expect(result.allowed).toBe(true);
        });

        it("denies after exhausting rate limit", async () => {
            const t = convexTest(schema, modules);
            rateLimiterTest.register(t);
            await t.mutation(checkRateLimit, { key: "test-key-002" });
            await t.mutation(checkRateLimit, { key: "test-key-002" });
            const result = await t.mutation(checkRateLimit, {
                key: "test-key-002",
            });
            expect(result.allowed).toBe(false);
            expect(typeof result.retryAfterMs).toBe("number");
        });
    });

    describe("getSourceForPreview", () => {
        it("returns null when visitor is not the run owner", async () => {
            const t = convexTest(schema, modules);
            const { runId, sourceId } = await seedVisitorAndRun(t);

            const otherVisitorId = await t.run(async (ctx) => {
                const a = await ctx.db.insert("users", {
                    name: "other",
                    email: "o@t.t",
                    isAnonymous: true,
                } as any);
                const i = await ctx.db.insert("invitations", {
                    slotKey: "other",
                    role: "analyst",
                    codeDigest: "digest-other",
                    status: "claimed",
                    createdAt: Date.now(),
                });
                return await ctx.db.insert("visitors", {
                    authUserId: a,
                    invitationId: i,
                    role: "analyst",
                    status: "active",
                    analysesReserved: 1,
                    admittedAt: Date.now(),
                });
            });

            const result = await t.query(getSourceForPreview, {
                sourceId,
                runId,
                visitorId: otherVisitorId,
            });
            expect(result).toBeNull();
        });

        it("returns null when source does not belong to run", async () => {
            const t = convexTest(schema, modules);
            const { visitorId, runId: runA } = await seedVisitorAndRun(t);

            const runB = await t.run(async (ctx) => {
                const c = await ctx.db.insert("companies", {
                    cik: "0000789019",
                    legalName: "Microsoft Corp",
                    ticker: "MSFT",
                    exchange: "NASDAQ",
                    canonicalizedAt: Date.now(),
                });
                return await ctx.db.insert("researchRuns", {
                    purpose: "research",
                    ownerVisitorId: visitorId,
                    companyId: c,
                    executionGeneration: 1,
                    lifecycleState: "discovering_sources",
                    executionStatus: "running",
                    nextEventSequence: 1,
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                });
            });
            const otherSourceId = await t.run(async (ctx) => {
                return await ctx.db.insert("sources", {
                    runId: runB,
                    canonicalUrl: "https://other.example/report",
                    title: "Other Report",
                    origin: "sec",
                    category: "regulatory_annual",
                    createdAt: Date.now(),
                });
            });

            const result = await t.query(getSourceForPreview, {
                sourceId: otherSourceId,
                runId: runA,
                visitorId,
            });
            expect(result).toBeNull();
        });

        it("returns source metadata for a valid pending source", async () => {
            const t = convexTest(schema, modules);
            const { visitorId, runId, sourceId } = await seedVisitorAndRun(t);

            const result = await t.query(getSourceForPreview, {
                sourceId,
                runId,
                visitorId,
            });
            expect(result).not.toBeNull();
            expect(result?.canonicalUrl).toBe("https://example.com/report");
            expect(result?.title).toBe("Test Report");
            expect(result?.decision).toBe("pending");
        });
    });

    describe("preview cache", () => {
        it("returns a cached preview only to its authenticated owner", async () => {
            const t = convexTest(schema, modules);
            const { authUserId, sourceId, visitorId } =
                await seedVisitorAndRun(t);
            const other = await t.run((ctx) =>
                ctx.db.insert("users", { isAnonymous: true }),
            );
            await t.mutation(storePreview, {
                sourceId,
                visitorId,
                dataUrl: "data:image/png;base64,PRIVATE",
                sizeBytes: 7,
                expiresAt: Date.now() + 60_000,
            });
            expect(await t.query(getPreview, { sourceId })).toBeNull();
            expect(
                await t
                    .withIdentity({ subject: other })
                    .query(getPreview, { sourceId }),
            ).toBeNull();
            expect(
                await t
                    .withIdentity({ subject: authUserId })
                    .query(getPreview, { sourceId }),
            ).toEqual({ dataUrl: "data:image/png;base64,PRIVATE" });
        });

        it("returns null when no cache entry exists", async () => {
            const t = convexTest(schema, modules);
            const { sourceId, authUserId } = await seedVisitorAndRun(t);

            const result = await t
                .withIdentity({ subject: authUserId })
                .query(getPreview, { sourceId });
            expect(result).toBeNull();
        });

        it("stores then returns a fresh cached preview", async () => {
            const t = convexTest(schema, modules);
            const { sourceId, authUserId, visitorId } =
                await seedVisitorAndRun(t);

            await t.mutation(storePreview, {
                sourceId,
                visitorId,
                dataUrl: "data:image/png;base64,AAAA",
                sizeBytes: 4,
                expiresAt: Date.now() + 60_000,
            });

            const result = await t
                .withIdentity({ subject: authUserId })
                .query(getPreview, { sourceId });
            expect(result).toEqual({ dataUrl: "data:image/png;base64,AAAA" });
        });

        it("treats an expired entry as a miss", async () => {
            const t = convexTest(schema, modules);
            const { sourceId, authUserId, visitorId } =
                await seedVisitorAndRun(t);

            await t.mutation(storePreview, {
                sourceId,
                visitorId,
                dataUrl: "data:image/png;base64,BBBB",
                sizeBytes: 4,
                expiresAt: Date.now() - 1000,
            });

            const result = await t
                .withIdentity({ subject: authUserId })
                .query(getPreview, { sourceId });
            expect(result).toBeNull();
        });

        it("purges a cached entry for a source", async () => {
            const t = convexTest(schema, modules);
            const { sourceId, authUserId, visitorId } =
                await seedVisitorAndRun(t);

            await t.mutation(storePreview, {
                sourceId,
                visitorId,
                dataUrl: "data:image/png;base64,CCCC",
                sizeBytes: 4,
                expiresAt: Date.now() + 60_000,
            });

            await t.mutation(purgePreviewForSource, { sourceId });

            const result = await t
                .withIdentity({ subject: authUserId })
                .query(getPreview, { sourceId });
            expect(result).toBeNull();
        });
    });
});
