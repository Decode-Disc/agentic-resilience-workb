import type { Id } from "@convex/_generated/dataModel";
import schema from "@convex/schema";
import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import rateLimiterTest from "../integrations/rate-limiter-test-register.js";
import workflowTest from "../workflows/workflow-test-register.js";

const modules = import.meta.glob("/convex/**/*.ts");
const originalFetch = globalThis.fetch;
const originalSecUserAgent = process.env.SEC_USER_AGENT;

test("invalid preparation concurrency rejects launch before reserving quota or calling providers", async () => {
    vi.stubEnv("SOURCE_QUALIFICATION_ENABLED", "true");
    vi.stubEnv("SOURCE_PREPARATION_MAX_CONCURRENCY", "0");
    try {
        const t = convexTest(schema, modules);
        workflowTest.register(t);
        const { userId, preflightId } = await createAdmittedPreflight(t);
        const request = vi.fn<typeof fetch>(async () => {
            throw new Error("Unexpected provider call");
        });
        globalThis.fetch = request;
        await expect(
            t.withIdentity({ subject: userId }).action(confirmAndStart, {
                preflightId,
                idempotencyKey: "invalid-concurrency",
                coveragePreset: "balanced",
            }),
        ).rejects.toThrow("preparation_configuration_invalid");
        expect(
            await t.run((ctx) => ctx.db.query("researchRuns").take(1)),
        ).toEqual([]);
        expect(
            await t.run((ctx) => ctx.db.query("visitors").first()),
        ).toMatchObject({ analysesReserved: 0 });
        expect(request).not.toHaveBeenCalled();
    } finally {
        vi.unstubAllEnvs();
    }
});

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalSecUserAgent === undefined) {
        delete process.env.SEC_USER_AGENT;
    } else {
        process.env.SEC_USER_AGENT = originalSecUserAgent;
    }
    vi.useRealTimers();
});
const confirmAndStart = makeFunctionReference<
    "action",
    {
        preflightId: Id<"companyPreflights">;
        idempotencyKey: string;
        coveragePreset:
            | "balanced"
            | "first_party_depth"
            | "independent_scrutiny";
        researchAngle?: string;
        manualSourcePreparationIds?: Array<Id<"manualSourcePreparations">>;
    },
    { runId: Id<"researchRuns">; remainingAnalyses: number }
>("researchLaunch:confirmAndStart");
const confirmAndStartReserved = makeFunctionReference<
    "mutation",
    {
        preflightId: Id<"companyPreflights">;
        idempotencyKey: string;
        coveragePreset: "balanced";
        manualSourcePreparationIds: Array<Id<"manualSourcePreparations">>;
    },
    { runId: Id<"researchRuns">; remainingAnalyses: number }
>("researchLaunch:confirmAndStartReserved");
const getRun = makeFunctionReference<
    "query",
    { runId: Id<"researchRuns"> },
    unknown
>("researchRuns:get");
const getMine = makeFunctionReference<
    "query",
    { runId: Id<"researchRuns"> },
    unknown
>("researchRuns:getMine");
const transition = makeFunctionReference<
    "mutation",
    {
        runId: Id<"researchRuns">;
        expectedExecutionGeneration: number;
        lifecycleState:
            | "checking_public_evidence"
            | "awaiting_evidence_sufficiency_review";
        executionStatus: "running" | "paused";
        stepKey: "check_public_evidence" | "evidence_sufficiency_review";
    },
    null
>("researchRuns:transition");
const decideSufficiency = makeFunctionReference<
    "mutation",
    {
        runId: Id<"researchRuns">;
        decision:
            | { kind: "recheck"; decisionKey: string }
            | {
                  kind: "force_continue";
                  decisionKey: string;
                  reason: string;
              }
            | {
                  kind: "complete_insufficient";
                  decisionKey: string;
                  reason: string;
              };
    },
    { accepted: boolean }
>("evidenceSufficiency:decide");

async function createAdmittedPreflight(
    t: ReturnType<typeof convexTest>,
): Promise<{
    userId: Id<"users">;
    preflightId: Id<"companyPreflights">;
}> {
    return t.run(async (ctx) => {
        const userId = await ctx.db.insert("users", { isAnonymous: true });
        const invitationId = await ctx.db.insert("invitations", {
            slotKey: "analyst-1",
            role: "analyst",
            codeDigest: "launch-test-digest",
            status: "claimed",
            createdAt: 1,
        });
        const visitorId = await ctx.db.insert("visitors", {
            authUserId: userId,
            invitationId,
            role: "analyst",
            status: "active",
            analysesReserved: 0,
            admittedAt: 1,
        });
        const companyId = await ctx.db.insert("companies", {
            cik: "1818201",
            legalName: "CCC Intelligent Solutions Holdings Inc.",
            ticker: "CCCS",
            exchange: "NASDAQ",
            canonicalizedAt: Date.now(),
        });
        const preflightId = await ctx.db.insert("companyPreflights", {
            ownerVisitorId: visitorId,
            query: "CCCS",
            companyId,
            resolverVersion: "sec-company-v1",
            status: "resolved",
            expiresAt: Date.now() + 60_000,
            createdAt: Date.now(),
        });
        return { userId, preflightId };
    });
}

test("confirms a preflight and starts workflow version 2 once", async () => {
    const t = convexTest(schema, modules);
    rateLimiterTest.register(t);
    workflowTest.register(t);
    const { userId, preflightId } = await createAdmittedPreflight(t);
    const analyst = t.withIdentity({ subject: `${userId}|launch-session` });

    const first = await analyst.action(confirmAndStart, {
        preflightId,
        idempotencyKey: "launch-cccs",
        coveragePreset: "balanced",
        researchAngle: "Focus on claims workflow control.",
    });
    const replay = await analyst.action(confirmAndStart, {
        preflightId,
        idempotencyKey: "launch-cccs",
        coveragePreset: "balanced",
        researchAngle: "Focus on claims workflow control.",
    });

    expect(replay).toEqual(first);
    await expect(
        t.query(getRun, { runId: first.runId }),
    ).resolves.toMatchObject({
        companyPreflightId: preflightId,
        coveragePreset: "balanced",
        researchAngle: "Focus on claims workflow control.",
        reservationStatus: "consumed",
        executionStatus: "running",
        executionGeneration: 1,
        workflowVersion: 2,
    });
    await expect(
        t.run(async (ctx) => ctx.db.query("corpusRevisions").collect()),
    ).resolves.toEqual([
        expect.objectContaining({
            runId: first.runId,
            revision: 1,
            status: "draft",
        }),
    ]);
    await t.run(async (ctx) => {
        const run = await ctx.db.get(first.runId);
        if (!run?.companyId) {
            throw new Error("Confirmed company missing");
        }
        await ctx.db.patch(run.companyId, {
            legalName: "Changed canonical company name",
            ticker: "NEW",
            exchange: "NYSE",
        });
    });
    await expect(
        analyst.query(getMine, { runId: first.runId }),
    ).resolves.toMatchObject({
        company: {
            legalName: "CCC Intelligent Solutions Holdings Inc.",
            ticker: "CCCS",
            exchange: "NASDAQ",
        },
    });
});

test("persists validated launch references as pending sources in corpus revision 1", async () => {
    const t = convexTest(schema, modules);
    rateLimiterTest.register(t);
    workflowTest.register(t);
    const { userId, preflightId } = await createAdmittedPreflight(t);
    const analyst = t.withIdentity({
        subject: `${userId}|launch-reference-session`,
    });
    const preparationId = await t.run((ctx) =>
        ctx.db.insert("manualSourcePreparations", {
            ownerAuthUserId: userId,
            collectionKey: "research-composer",
            requestKey: "public-report",
            inputDigest: "public-report-digest",
            canonicalUrl: "https://example.com/public-report",
            title: "Public report",
            providerReference: "launch_url_metadata:public-report",
            expiresAt: Date.now() + 60_000,
            createdAt: Date.now(),
        }),
    );

    const { runId } = await analyst.mutation(confirmAndStartReserved, {
        preflightId,
        idempotencyKey: "launch-with-public-reference",
        coveragePreset: "balanced",
        manualSourcePreparationIds: [preparationId],
    });

    const persisted = await t.run(async (ctx) => {
        const run = await ctx.db.get(runId);
        const sources = await ctx.db
            .query("sources")
            .withIndex("by_run_and_url", (query) => query.eq("runId", runId))
            .collect();
        const decisions = await ctx.db
            .query("sourceDecisions")
            .withIndex("by_revision_and_source", (query) =>
                query.eq(
                    "corpusRevisionId",
                    run?.activeCorpusRevisionId as Id<"corpusRevisions">,
                ),
            )
            .collect();
        const reviewItems = await ctx.db
            .query("sourceReviewItems")
            .withIndex("by_revision_and_queue", (query) =>
                query.eq(
                    "corpusRevisionId",
                    run?.activeCorpusRevisionId as Id<"corpusRevisions">,
                ),
            )
            .collect();
        const preparation = await ctx.db.get(preparationId);
        return { sources, decisions, reviewItems, preparation };
    });

    expect(persisted.sources).toEqual([
        expect.objectContaining({
            canonicalUrl: "https://example.com/public-report",
            title: "Public report",
            origin: "analyst_url",
            category: "analyst_supplied",
        }),
    ]);
    expect(persisted.decisions).toEqual([
        expect.objectContaining({
            runId,
            decision: "pending",
        }),
    ]);
    expect(persisted.reviewItems).toEqual([
        expect.objectContaining({
            runId,
            decision: "pending",
            decisionRank: 0,
        }),
    ]);
    expect(persisted.preparation).toMatchObject({
        consumedAt: expect.any(Number),
    });
});

test("replays a launch after its preparation receipt was consumed", async () => {
    const t = convexTest(schema, modules);
    rateLimiterTest.register(t);
    workflowTest.register(t);
    const { userId, preflightId } = await createAdmittedPreflight(t);
    const preparationId = await t.run((ctx) =>
        ctx.db.insert("manualSourcePreparations", {
            ownerAuthUserId: userId,
            collectionKey: "research-composer",
            requestKey: "replay-report",
            inputDigest: "replay-report-digest",
            canonicalUrl: "https://example.com/replay-report",
            title: "Replay report",
            providerReference: "launch_url_metadata:replay-report",
            expiresAt: Date.now() + 60_000,
            createdAt: Date.now(),
        }),
    );
    const analyst = t.withIdentity({
        subject: `${userId}|receipt-replay-session`,
    });
    const args = {
        preflightId,
        idempotencyKey: "launch-with-consumed-reference",
        coveragePreset: "balanced" as const,
        manualSourcePreparationIds: [preparationId],
    };

    const first = await analyst.action(confirmAndStart, args);
    const replay = await analyst.action(confirmAndStart, args);

    expect(replay).toEqual(first);
    await expect(
        t.run(async (ctx) => ({
            runs: await ctx.db.query("researchRuns").collect(),
            sources: await ctx.db.query("sources").collect(),
            visitor: await ctx.db
                .query("visitors")
                .withIndex("by_auth_user_id", (query) =>
                    query.eq("authUserId", userId),
                )
                .unique(),
        })),
    ).resolves.toMatchObject({
        runs: [expect.objectContaining({ _id: first.runId })],
        sources: [
            expect.objectContaining({
                canonicalUrl: "https://example.com/replay-report",
            }),
        ],
        visitor: { analysesReserved: 1 },
    });
});

test("rejects an expired launch preparation without creating a run or reserving quota", async () => {
    const t = convexTest(schema, modules);
    rateLimiterTest.register(t);
    workflowTest.register(t);
    const { userId, preflightId } = await createAdmittedPreflight(t);
    const preparationId = await t.run((ctx) =>
        ctx.db.insert("manualSourcePreparations", {
            ownerAuthUserId: userId,
            collectionKey: "research-composer",
            requestKey: "expired-report",
            inputDigest: "expired-report-digest",
            canonicalUrl: "https://example.com/expired-report",
            title: "Expired report",
            providerReference: "launch_url_metadata:expired-report",
            expiresAt: Date.now() - 1,
            createdAt: Date.now() - 60_000,
        }),
    );
    const analyst = t.withIdentity({
        subject: `${userId}|expired-preparation-session`,
    });

    await expect(
        analyst.action(confirmAndStart, {
            preflightId,
            idempotencyKey: "launch-with-expired-reference",
            coveragePreset: "balanced",
            manualSourcePreparationIds: [preparationId],
        }),
    ).rejects.toMatchObject({
        data: {
            code: "preparation_expired",
            retryable: false,
            preparationId,
        },
    });

    await expect(
        t.run(async (ctx) => ({
            runs: await ctx.db.query("researchRuns").collect(),
            visitor: await ctx.db
                .query("visitors")
                .withIndex("by_auth_user_id", (query) =>
                    query.eq("authUserId", userId),
                )
                .unique(),
        })),
    ).resolves.toMatchObject({
        runs: [],
        visitor: { analysesReserved: 0 },
    });
});

test("rejects a foreign launch preparation without creating a run or reserving quota", async () => {
    const t = convexTest(schema, modules);
    rateLimiterTest.register(t);
    workflowTest.register(t);
    const { userId, preflightId } = await createAdmittedPreflight(t);
    const preparationId = await t.run(async (ctx) => {
        const otherUserId = await ctx.db.insert("users", {
            isAnonymous: true,
        });
        return ctx.db.insert("manualSourcePreparations", {
            ownerAuthUserId: otherUserId,
            collectionKey: "research-composer",
            requestKey: "foreign-report",
            inputDigest: "foreign-report-digest",
            canonicalUrl: "https://example.com/foreign-report",
            title: "Foreign report",
            providerReference: "launch_url_metadata:foreign-report",
            expiresAt: Date.now() + 60_000,
            createdAt: Date.now(),
        });
    });
    const analyst = t.withIdentity({
        subject: `${userId}|foreign-preparation-session`,
    });

    await expect(
        analyst.action(confirmAndStart, {
            preflightId,
            idempotencyKey: "launch-with-foreign-reference",
            coveragePreset: "balanced",
            manualSourcePreparationIds: [preparationId],
        }),
    ).rejects.toMatchObject({
        data: {
            code: "not_authorized",
            retryable: false,
            preparationId,
        },
    });

    await expect(
        t.run(async (ctx) => ({
            runs: await ctx.db.query("researchRuns").collect(),
            visitor: await ctx.db
                .query("visitors")
                .withIndex("by_auth_user_id", (query) =>
                    query.eq("authUserId", userId),
                )
                .unique(),
        })),
    ).resolves.toMatchObject({
        runs: [],
        visitor: { analysesReserved: 0 },
    });
});

test("adopts a pre-admission preflight for the admitted session", async () => {
    const t = convexTest(schema, modules);
    rateLimiterTest.register(t);
    workflowTest.register(t);
    const { userId, visitorId, preflightId } = await t.run(async (ctx) => {
        const userId = await ctx.db.insert("users", { isAnonymous: true });
        const companyId = await ctx.db.insert("companies", {
            cik: "1818201",
            legalName: "CCC Intelligent Solutions Holdings Inc.",
            ticker: "CCCS",
            exchange: "NASDAQ",
            canonicalizedAt: Date.now(),
        });
        const preflightId = await ctx.db.insert("companyPreflights", {
            ownerAuthUserId: userId,
            query: "CCCS",
            companyId,
            resolverVersion: "sec-company-v1",
            status: "resolved",
            expiresAt: Date.now() + 60_000,
            createdAt: Date.now(),
        });
        const invitationId = await ctx.db.insert("invitations", {
            slotKey: "analyst-1",
            role: "analyst",
            codeDigest: "pre-admission-launch-digest",
            status: "claimed",
            createdAt: 1,
        });
        const visitorId = await ctx.db.insert("visitors", {
            authUserId: userId,
            invitationId,
            role: "analyst",
            status: "active",
            analysesReserved: 0,
            admittedAt: 1,
        });
        return { userId, visitorId, preflightId };
    });
    const admittedSession = t.withIdentity({
        subject: `${userId}|pre-admission-session`,
    });

    const result = await admittedSession.action(confirmAndStart, {
        preflightId,
        idempotencyKey: "launch-after-admission",
        coveragePreset: "balanced",
    });

    await expect(
        t.run((ctx) => ctx.db.get(preflightId)),
    ).resolves.toMatchObject({
        ownerAuthUserId: userId,
        ownerVisitorId: visitorId,
        status: "consumed",
    });
    await expect(
        admittedSession.query(getMine, { runId: result.runId }),
    ).resolves.toMatchObject({
        company: { ticker: "CCCS" },
    });
});

test("allows exactly one running workflow per visitor", async () => {
    const t = convexTest(schema, modules);
    rateLimiterTest.register(t);
    workflowTest.register(t);
    const { userId, preflightId } = await createAdmittedPreflight(t);
    const secondPreflightId = await t.run(async (ctx) => {
        const first = await ctx.db.get(preflightId);
        if (!first) {
            throw new Error("Test preflight not found");
        }
        return ctx.db.insert("companyPreflights", {
            ownerVisitorId: first.ownerVisitorId,
            query: first.query,
            companyId: first.companyId,
            resolverVersion: first.resolverVersion,
            status: "resolved",
            createdAt: Date.now(),
            expiresAt: Date.now() + 60_000,
        });
    });
    const analyst = t.withIdentity({ subject: `${userId}|concurrent-session` });

    const starts = await Promise.allSettled([
        analyst.action(confirmAndStart, {
            preflightId,
            idempotencyKey: "concurrent-a",
            coveragePreset: "balanced",
        }),
        analyst.action(confirmAndStart, {
            preflightId: secondPreflightId,
            idempotencyKey: "concurrent-b",
            coveragePreset: "balanced",
        }),
    ]);

    const fulfilled = starts.filter(
        (
            result,
        ): result is PromiseFulfilledResult<{
            runId: Id<"researchRuns">;
            remainingAnalyses: number;
        }> => result.status === "fulfilled",
    );
    expect(fulfilled).toHaveLength(1);
    expect(starts.filter(({ status }) => status === "rejected")).toHaveLength(
        1,
    );

    const runningRunId = fulfilled[0]?.value.runId;
    if (!runningRunId) {
        throw new Error("Expected one running research run");
    }
    await t.mutation(transition, {
        runId: runningRunId,
        expectedExecutionGeneration: 1,
        lifecycleState: "checking_public_evidence",
        executionStatus: "running",
        stepKey: "check_public_evidence",
    });
    await t.mutation(transition, {
        runId: runningRunId,
        expectedExecutionGeneration: 1,
        lifecycleState: "awaiting_evidence_sufficiency_review",
        executionStatus: "paused",
        stepKey: "evidence_sufficiency_review",
    });

    await expect(
        analyst.action(confirmAndStart, {
            preflightId: secondPreflightId,
            idempotencyKey: "concurrent-b-retry",
            coveragePreset: "balanced",
        }),
    ).resolves.toMatchObject({ remainingAnalyses: 1 });
});

test("revalidates the confirmed CIK before evidence checks", async () => {
    process.env.SEC_USER_AGENT = "Evidence Workbench test@example.com";
    const fetchImplementation = vi.fn(async () =>
        Promise.resolve(
            new Response(
                JSON.stringify({
                    cik: "0001818201",
                    name: "CCC Intelligent Solutions Holdings Inc.",
                    tickers: ["CCCS"],
                    exchanges: ["Nasdaq"],
                    filings: { recent: { accessionNumber: ["0001"] } },
                }),
                { status: 200 },
            ),
        ),
    );
    globalThis.fetch = fetchImplementation;
    const t = convexTest(schema, modules);
    rateLimiterTest.register(t);
    workflowTest.register(t);
    const { userId, preflightId } = await createAdmittedPreflight(t);
    const analyst = t.withIdentity({ subject: `${userId}|revalidate-session` });

    const { runId } = await analyst.action(confirmAndStart, {
        preflightId,
        idempotencyKey: "revalidate-cccs",
        coveragePreset: "balanced",
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(fetchImplementation).toHaveBeenCalledWith(
        "https://data.sec.gov/submissions/CIK0001818201.json",
        expect.objectContaining({
            headers: expect.objectContaining({
                "User-Agent": "Evidence Workbench test@example.com",
            }),
        }),
    );
    await expect(t.query(getRun, { runId })).resolves.toMatchObject({
        lifecycleState: "awaiting_source_review",
        executionStatus: "paused",
    });
});

test("accepts mutable SEC metadata for the same confirmed CIK", async () => {
    process.env.SEC_USER_AGENT = "Evidence Workbench test@example.com";
    globalThis.fetch = vi.fn(async () =>
        Promise.resolve(
            new Response(
                JSON.stringify({
                    cik: "0001818201",
                    name: "CCC Intelligent Solutions Inc.",
                    tickers: ["CCCX"],
                    exchanges: ["NYSE"],
                    filings: { recent: { accessionNumber: ["0001"] } },
                }),
                { status: 200 },
            ),
        ),
    );
    const t = convexTest(schema, modules);
    rateLimiterTest.register(t);
    workflowTest.register(t);
    const { userId, preflightId } = await createAdmittedPreflight(t);
    await t.run(async (ctx) => {
        const preflight = await ctx.db.get(preflightId);
        if (!preflight) {
            throw new Error("Test preflight not found");
        }
        await ctx.db.patch(preflight.companyId, {
            websiteUrl: "https://www.cccis.com/",
            websiteUrlSource: "exa",
        });
        await ctx.db.patch(preflightId, {
            companySnapshot: {
                cik: "1818201",
                legalName: "CCC Intelligent Solutions Holdings Inc.",
                ticker: "CCCS",
                exchange: "NASDAQ",
                websiteUrl: "https://www.cccis.com/",
                websiteUrlSource: "exa",
            },
        });
    });
    const analyst = t.withIdentity({
        subject: `${userId}|mutable-metadata-session`,
    });

    const { runId } = await analyst.action(confirmAndStart, {
        preflightId,
        idempotencyKey: "revalidate-mutable-metadata",
        coveragePreset: "balanced",
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    await expect(analyst.query(getMine, { runId })).resolves.toMatchObject({
        lifecycleState: "awaiting_source_review",
        executionStatus: "paused",
        company: {
            cik: "1818201",
            legalName: "CCC Intelligent Solutions Inc.",
            ticker: "CCCX",
            exchange: "NYSE",
            websiteUrl: "https://www.cccis.com/",
            websiteUrlSource: "exa",
        },
    });
});

test("pauses when revalidation finds no public evidence", async () => {
    process.env.SEC_USER_AGENT = "Evidence Workbench test@example.com";
    globalThis.fetch = vi.fn(async () =>
        Promise.resolve(
            new Response(
                JSON.stringify({
                    cik: "0001818201",
                    name: "CCC Intelligent Solutions Holdings Inc.",
                    tickers: ["CCCS"],
                    exchanges: ["Nasdaq"],
                    filings: { recent: { accessionNumber: [] } },
                }),
                { status: 200 },
            ),
        ),
    );
    const t = convexTest(schema, modules);
    rateLimiterTest.register(t);
    workflowTest.register(t);
    const { userId, preflightId } = await createAdmittedPreflight(t);
    const analyst = t.withIdentity({
        subject: `${userId}|insufficient-session`,
    });

    const { runId } = await analyst.action(confirmAndStart, {
        preflightId,
        idempotencyKey: "insufficient-cccs",
        coveragePreset: "balanced",
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    await expect(t.query(getRun, { runId })).resolves.toMatchObject({
        lifecycleState: "awaiting_evidence_sufficiency_review",
        executionStatus: "paused",
        pauseReason: "evidence_sufficiency_review",
    });
    await expect(
        analyst.mutation(decideSufficiency, {
            runId,
            decision: {
                kind: "complete_insufficient",
                decisionKey: "complete-insufficient-cccs",
                reason: "Public evidence cannot support a credible assessment.",
            },
        }),
    ).resolves.toEqual({ accepted: true });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    await expect(t.query(getRun, { runId })).resolves.toMatchObject({
        lifecycleState: "completed",
        executionStatus: "completed",
        executionGeneration: 1,
    });
});

test("requires a justified force-continuation decision", async () => {
    process.env.SEC_USER_AGENT = "Evidence Workbench test@example.com";
    globalThis.fetch = vi.fn(async () =>
        Promise.resolve(
            new Response(
                JSON.stringify({
                    cik: "0001818201",
                    name: "CCC Intelligent Solutions Holdings Inc.",
                    tickers: ["CCCS"],
                    exchanges: ["Nasdaq"],
                    filings: { recent: { accessionNumber: [] } },
                }),
                { status: 200 },
            ),
        ),
    );
    const t = convexTest(schema, modules);
    rateLimiterTest.register(t);
    workflowTest.register(t);
    const { userId, preflightId } = await createAdmittedPreflight(t);
    const analyst = t.withIdentity({ subject: `${userId}|force-session` });
    const { runId } = await analyst.action(confirmAndStart, {
        preflightId,
        idempotencyKey: "force-cccs",
        coveragePreset: "balanced",
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    await expect(
        analyst.mutation(decideSufficiency, {
            runId,
            decision: {
                kind: "force_continue",
                decisionKey: "force-short",
                reason: "too short",
            },
        }),
    ).rejects.toThrow("12 characters");
    await expect(
        analyst.mutation(decideSufficiency, {
            runId,
            decision: {
                kind: "force_continue",
                decisionKey: "force-valid",
                reason: "Proceed with explicitly limited public evidence.",
            },
        }),
    ).resolves.toEqual({ accepted: true });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    await expect(t.query(getRun, { runId })).resolves.toMatchObject({
        lifecycleState: "awaiting_source_review",
        executionStatus: "paused",
        executionGeneration: 2,
    });
});
