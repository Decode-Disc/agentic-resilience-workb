import { api, internal } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import schema from "@convex/schema";
import agentTest from "@convex-dev/agent/test";
import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
    createAdmittedPreflight,
    seedHistoricalResearch,
} from "@/__tests__/setup/research-launch";
import { activateSourcesMission } from "@/__tests__/setup/sources-mission";
import rateLimiterTest from "../integrations/rate-limiter-test-register.js";
import workflowTest from "../workflows/workflow-test-register.js";

const modules = import.meta.glob("/convex/**/*.ts");
const originalFetch = globalThis.fetch;
const originalSecUserAgent = process.env.SEC_USER_AGENT;
const researchProgram = {
    scope: "Auto claims coordination",
    questions: [
        {
            id: "coordination",
            text: "Who controls claims coordination?",
            shortLabel: "Coordination",
            rationale: "Distinguish orchestration from supplying modules.",
        },
    ],
};

test.each([
    "public",
    "internal",
] as const)("%s admission refuses fresh legacy research without consuming or scheduling work", async (boundary) => {
    vi.stubEnv("SOURCES_MISSION_ENABLED", "false");
    vi.stubEnv("SOURCE_QUALIFICATION_ENABLED", "false");
    try {
        const t = convexTest(schema, modules);
        rateLimiterTest.register(t);
        workflowTest.register(t);
        const { userId, preflightId } = await createAdmittedPreflight(t);
        const analyst = t.withIdentity({ subject: `${userId}|retired-launch` });
        const snapshot = () =>
            t.run(async (ctx) => ({
                runs: await ctx.db.query("researchRuns").collect(),
                revisions: await ctx.db.query("corpusRevisions").collect(),
                preflight: await ctx.db.get(preflightId),
                visitors: await ctx.db.query("visitors").collect(),
                events: await ctx.db.query("runEvents").collect(),
                audit: await ctx.db.query("auditEvents").collect(),
                calls: await ctx.db.query("providerCalls").collect(),
                scheduled: await ctx.db.system
                    .query("_scheduled_functions")
                    .collect(),
            }));
        const before = await snapshot();
        const args = {
            preflightId,
            idempotencyKey: "retired-launch",
            coveragePreset: "balanced" as const,
        };

        await expect(
            boundary === "public"
                ? analyst.action(api.researchLaunch.confirmAndStart, args)
                : analyst.mutation(
                      internal.researchLaunch.confirmAndStartReserved,
                      { ...args, framingOnly: false },
                  ),
        ).rejects.toMatchObject({ data: { code: "framing_required" } });

        expect(await snapshot()).toEqual(before);
    } finally {
        vi.unstubAllEnvs();
    }
});

test.each([
    "framed",
    "historical",
] as const)("refuses replaying a %s dossier through the other launch path", async (mode) => {
    const t = convexTest(schema, modules);
    agentTest.register(t);
    workflowTest.register(t);
    const { userId, preflightId } = await createAdmittedPreflight(t);
    const analyst = t.withIdentity({ subject: userId });
    const args = {
        preflightId,
        idempotencyKey: "mode-specific-replay",
        coveragePreset: "balanced" as const,
    };
    if (mode === "framed")
        await analyst.mutation(api.framing.confirmCompany, args);
    else await seedHistoricalResearch(t, args);
    const snapshot = () =>
        t.run(async (ctx) => ({
            runs: await ctx.db.query("researchRuns").collect(),
            visitors: await ctx.db.query("visitors").collect(),
            framing: await ctx.db.query("framingRevisions").collect(),
            events: await ctx.db.query("runEvents").collect(),
            scheduled: await ctx.db.system
                .query("_scheduled_functions")
                .collect(),
        }));
    const before = await snapshot();
    await expect(
        mode === "framed"
            ? analyst.action(api.researchLaunch.confirmAndStart, args)
            : analyst.mutation(api.framing.confirmCompany, args),
    ).rejects.toThrow("Idempotency key belongs to another company preflight");
    expect(await snapshot()).toEqual(before);
});

test("invalid preparation concurrency rejects explicit research start before reserving quota or calling providers", async () => {
    activateSourcesMission();
    vi.stubEnv("SOURCE_QUALIFICATION_ENABLED", "true");
    vi.stubEnv("SOURCE_PREPARATION_MAX_CONCURRENCY", "0");
    try {
        const t = convexTest(schema, modules);
        workflowTest.register(t);
        const { userId, preflightId } = await createAdmittedPreflight(t);
        agentTest.register(t);
        const analyst = t.withIdentity({ subject: userId });
        const { runId } = await analyst.mutation(api.framing.confirmCompany, {
            preflightId,
            idempotencyKey: "invalid-concurrency",
            coveragePreset: "balanced",
        });
        const revision = await analyst.mutation(api.framing.save, {
            runId,
            expectedRevision: 1,
            requestKey: "prepare-start",
            content: researchProgram,
        });
        const before = await t.run((ctx) => ctx.db.get(runId));
        const request = vi.fn<typeof fetch>(async () => {
            throw new Error("Unexpected provider call");
        });
        globalThis.fetch = request;
        await expect(
            analyst.mutation(api.framing.startResearch, {
                runId,
                expectedRevision: revision,
                requestKey: "start-invalid-concurrency",
            }),
        ).rejects.toThrow("preparation_configuration_invalid");
        expect(await t.run((ctx) => ctx.db.get(runId))).toEqual(before);
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
    vi.unstubAllEnvs();
});
const confirmAndStart = api.researchLaunch.confirmAndStart;
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

test("replays a historical workflow without reserving or scheduling it again", async () => {
    const t = convexTest(schema, modules);
    rateLimiterTest.register(t);
    workflowTest.register(t);
    const { userId, preflightId } = await createAdmittedPreflight(t);
    const analyst = t.withIdentity({ subject: `${userId}|launch-session` });

    const first = await seedHistoricalResearch(t, {
        preflightId,
        idempotencyKey: "launch-cccs",
        coveragePreset: "balanced",
        researchAngle: "Focus on claims workflow control.",
    });
    const beforeReplay = await t.run(async (ctx) => ({
        run: await ctx.db.get(first.runId),
        visitor: await ctx.db.query("visitors").first(),
        events: await ctx.db.query("runEvents").collect(),
        scheduled: await ctx.db.system.query("_scheduled_functions").collect(),
    }));
    const replay = await analyst.action(confirmAndStart, {
        preflightId,
        idempotencyKey: "launch-cccs",
        coveragePreset: "balanced",
        researchAngle: "Focus on claims workflow control.",
    });

    expect(replay).toEqual({ runId: first.runId, remainingAnalyses: 2 });
    expect(
        await t.run(async (ctx) => ({
            run: await ctx.db.get(first.runId),
            visitor: await ctx.db.query("visitors").first(),
            events: await ctx.db.query("runEvents").collect(),
            scheduled: await ctx.db.system
                .query("_scheduled_functions")
                .collect(),
        })),
    ).toEqual(beforeReplay);
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

    agentTest.register(t);
    const { runId } = await analyst.mutation(api.framing.confirmCompany, {
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

    agentTest.register(t);
    const first = await analyst.mutation(api.framing.confirmCompany, args);
    const replay = await analyst.mutation(api.framing.confirmCompany, args);

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
        visitor: { analysesReserved: 0 },
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
        analyst.mutation(api.framing.confirmCompany, {
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
        analyst.mutation(api.framing.confirmCompany, {
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
        await ctx.db.patch(invitationId, { claimedByVisitorId: visitorId });
        return { userId, visitorId, preflightId };
    });
    const admittedSession = t.withIdentity({
        subject: `${userId}|pre-admission-session`,
    });

    agentTest.register(t);
    const result = await admittedSession.mutation(api.framing.confirmCompany, {
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

test("explicit research start atomically admits one workflow per visitor and permits another after pause", async () => {
    activateSourcesMission();
    const t = convexTest(schema, modules);
    agentTest.register(t);
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

    const programs = [];
    for (const [index, candidate] of [
        preflightId,
        secondPreflightId,
    ].entries()) {
        const { runId } = await analyst.mutation(api.framing.confirmCompany, {
            preflightId: candidate,
            idempotencyKey: `concurrent-${index}`,
            coveragePreset: "balanced",
        });
        const expectedRevision = await analyst.mutation(api.framing.save, {
            runId,
            expectedRevision: 1,
            requestKey: "prepare-start",
            content: researchProgram,
        });
        programs.push({
            runId,
            expectedRevision,
            requestKey: `start-${index}`,
        });
    }
    const starts = await Promise.allSettled(
        programs.map((args) =>
            analyst.mutation(api.framing.startResearch, args),
        ),
    );
    const fulfilled = starts.filter((result) => result.status === "fulfilled");
    expect(fulfilled).toHaveLength(1);
    const rejected = starts.filter((result) => result.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason.message).toContain("execution_slot_unavailable");
    expect(
        await t.run((ctx) => ctx.db.query("visitors").first()),
    ).toMatchObject({ analysesReserved: 1 });
    const runningRunId = fulfilled[0]?.value;
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

    const waiting = programs.find(({ runId }) => runId !== runningRunId);
    if (!waiting) throw new Error("Expected a waiting research program");
    expect(await t.run((ctx) => ctx.db.get(waiting.runId))).toMatchObject({
        lifecycleState: "framing",
        executionStatus: "idle",
    });
    await expect(
        analyst.mutation(api.framing.startResearch, waiting),
    ).resolves.toBe(waiting.runId);
    expect(
        await t.run((ctx) => ctx.db.query("visitors").first()),
    ).toMatchObject({ analysesReserved: 2 });
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
    const { preflightId } = await createAdmittedPreflight(t);

    const { runId } = await seedHistoricalResearch(t, {
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

    const { runId } = await seedHistoricalResearch(t, {
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

    const { runId } = await seedHistoricalResearch(t, {
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
    const { runId } = await seedHistoricalResearch(t, {
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
