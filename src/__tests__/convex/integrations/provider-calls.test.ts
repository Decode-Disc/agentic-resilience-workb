import type { Id } from "@convex/_generated/dataModel";
import schema from "@convex/schema";
import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import rateLimiterTest from "./rate-limiter-test-register.js";

const modules = import.meta.glob("/convex/**/*.ts");

afterEach(() => vi.useRealTimers());
const reserveSecRateLimit = makeFunctionReference<
    "mutation",
    Record<string, never>,
    { retryAfter?: number }
>("providerCalls:reserveSecRateLimit");
const reserveExaWebsiteRateLimit = makeFunctionReference<
    "mutation",
    { authUserId: Id<"users"> },
    null
>("providerCalls:reserveExaWebsiteRateLimit");
const recordAttempt = makeFunctionReference<
    "mutation",
    {
        runId?: Id<"researchRuns">;
        corpusRevisionId?: Id<"corpusRevisions">;
        sourceId?: Id<"sources">;
        acceptedDecisionId?: Id<"sourceDecisions">;
        executionGeneration?: number;
        workflowVersion?: number;
        stepKey?: string;
        service: "sec" | "exa" | "url_metadata" | "pdf";
        operation: string;
        operationKey: string;
        status: "started" | "succeeded" | "failed";
        attempt: number;
        latencyMs?: number;
        errorCode?: string;
    },
    {
        providerCallId: Id<"providerCalls">;
        shouldExecute: boolean;
        status: "started" | "succeeded" | "failed";
    }
>("providerCalls:recordAttempt");

test("reserves SEC call slots through the rate-limiter component", async () => {
    const t = convexTest(schema, modules);
    rateLimiterTest.register(t);

    const reservations = await Promise.all([
        t.mutation(reserveSecRateLimit, {}),
        t.mutation(reserveSecRateLimit, {}),
        t.mutation(reserveSecRateLimit, {}),
    ]);

    // Token bucket with 8 tokens/sec — three calls should all succeed immediately
    expect(
        reservations.every(
            (r) =>
                typeof r.retryAfter === "number" || r.retryAfter === undefined,
        ),
    ).toBe(true);
    expect(reservations.filter((r) => (r.retryAfter ?? 0) > 0).length).toBe(0);
});

test("enforces SEC rate limit when bucket is exhausted", async () => {
    const t = convexTest(schema, modules);
    rateLimiterTest.register(t);

    // Exhaust the 8-token bucket with 9 concurrent calls
    const reservations = await Promise.all(
        Array.from({ length: 9 }, () => t.mutation(reserveSecRateLimit, {})),
    );

    // At least one call should have retryAfter > 0 (rate-limited)
    const rateLimited = reservations.filter((r) => (r.retryAfter ?? 0) > 0);
    expect(rateLimited.length).toBeGreaterThanOrEqual(1);
});

test("completes one persisted provider attempt", async () => {
    const t = convexTest(schema, modules);
    const input = {
        service: "sec" as const,
        operation: "resolve_company",
        operationKey: "resolve:CCCS",
        attempt: 1,
    };

    const started = await t.mutation(recordAttempt, {
        ...input,
        status: "started",
    });
    expect(started.shouldExecute).toBe(true);
    const replay = await t.mutation(recordAttempt, {
        ...input,
        status: "started",
    });
    expect(replay).toEqual({
        providerCallId: started.providerCallId,
        shouldExecute: false,
        status: "started",
    });
    await expect(
        t.mutation(recordAttempt, {
            ...input,
            status: "succeeded",
            latencyMs: 42,
        }),
    ).resolves.toEqual({
        providerCallId: started.providerCallId,
        shouldExecute: false,
        status: "succeeded",
    });
    await expect(
        t.run(async (ctx) => ctx.db.get(started.providerCallId)),
    ).resolves.toMatchObject({
        status: "succeeded",
        latencyMs: 42,
    });
});

test("separates runs and retry attempts", async () => {
    const t = convexTest(schema, modules);
    const [runA, runB] = await t.run(async (ctx) =>
        Promise.all([
            ctx.db.insert("researchRuns", {
                purpose: "research",
                lifecycleState: "discovering_sources",
                executionStatus: "running",
                executionGeneration: 1,
                nextEventSequence: 1,
                createdAt: 1,
                updatedAt: 1,
            }),
            ctx.db.insert("researchRuns", {
                purpose: "research",
                lifecycleState: "discovering_sources",
                executionStatus: "running",
                executionGeneration: 1,
                nextEventSequence: 1,
                createdAt: 1,
                updatedAt: 1,
            }),
        ]),
    );

    const starts = await Promise.all([
        t.mutation(recordAttempt, {
            runId: runA,
            executionGeneration: 1,
            service: "sec",
            operation: "revalidate_company",
            operationKey: "shared-logical-key",
            status: "started",
            attempt: 1,
        }),
        t.mutation(recordAttempt, {
            runId: runB,
            executionGeneration: 1,
            service: "sec",
            operation: "revalidate_company",
            operationKey: "shared-logical-key",
            status: "started",
            attempt: 1,
        }),
        t.mutation(recordAttempt, {
            runId: runA,
            executionGeneration: 1,
            service: "sec",
            operation: "revalidate_company",
            operationKey: "shared-logical-key",
            status: "started",
            attempt: 2,
        }),
    ]);

    expect(
        new Set(starts.map(({ providerCallId }) => providerCallId)).size,
    ).toBe(3);
    expect(starts.every(({ shouldExecute }) => shouldExecute)).toBe(true);
});

test("refuses a new provider lease after execution cancellation", async () => {
    const t = convexTest(schema, modules);
    const runId = await t.run((ctx) =>
        ctx.db.insert("researchRuns", {
            purpose: "research",
            lifecycleState: "discovering_sources",
            executionStatus: "cancelled",
            executionGeneration: 2,
            nextEventSequence: 1,
            createdAt: 1,
            updatedAt: 2,
        }),
    );

    await expect(
        t.mutation(recordAttempt, {
            runId,
            executionGeneration: 1,
            service: "sec",
            operation: "discover_sources",
            operationKey: "cancelled-generation",
            status: "started",
            attempt: 2,
        }),
    ).rejects.toThrow("no longer active");
});

test("reclaims an expired provider lease without creating a duplicate", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-06T00:00:00.000Z"));
    const t = convexTest(schema, modules);
    const input = {
        service: "sec" as const,
        operation: "resolve_company",
        operationKey: "lease:resolve:CCCS",
        attempt: 1,
        status: "started" as const,
    };

    const first = await t.mutation(recordAttempt, input);
    vi.setSystemTime(new Date("2026-08-06T00:00:15.001Z"));
    const reclaimed = await t.mutation(recordAttempt, input);

    expect(reclaimed).toEqual({
        providerCallId: first.providerCallId,
        shouldExecute: true,
        status: "started",
    });
    await expect(
        t.run((ctx) => ctx.db.query("providerCalls").collect()),
    ).resolves.toEqual([
        expect.objectContaining({
            _id: first.providerCallId,
            leaseExpiresAt: Date.parse("2026-08-06T00:00:30.001Z"),
        }),
    ]);
});

test("limits Exa website enrichment to twelve calls per session window", async () => {
    const t = convexTest(schema, modules);
    rateLimiterTest.register(t);
    const authUserId = await t.run((ctx) =>
        ctx.db.insert("users", { isAnonymous: true }),
    );

    for (let index = 0; index < 12; index += 1) {
        await expect(
            t.mutation(reserveExaWebsiteRateLimit, { authUserId }),
        ).resolves.toBeNull();
    }
    await expect(
        t.mutation(reserveExaWebsiteRateLimit, { authUserId }),
    ).rejects.toThrow("rate limit reached");
});

test("records pdf direct-retrieval telemetry without paid work gate", async () => {
    const t = convexTest(schema, modules);
    // Disable paid work globally
    await t.run(async (ctx) => {
        await ctx.db.insert("paidWorkControls", {
            key: "global",
            enabled: false,
            updatedAt: 100,
        });
    });

    // Exa started should return failed status and shouldExecute: false with paid work disabled error
    const exaAttempt = await t.mutation(recordAttempt, {
        service: "exa",
        operation: "get_contents",
        operationKey: "exa:disabled:url",
        status: "started",
        attempt: 1,
    });
    expect(exaAttempt.shouldExecute).toBe(false);
    expect(exaAttempt.status).toBe("failed");

    // PDF service is direct HTTPS retrieval, NOT paid work, so it should succeed
    const pdfAttempt = await t.mutation(recordAttempt, {
        service: "pdf",
        operation: "retrieve_pdf",
        operationKey: "pdf:direct:url",
        status: "started",
        attempt: 1,
    });
    expect(pdfAttempt.shouldExecute).toBe(true);
    expect(pdfAttempt.status).toBe("started");

    await t.mutation(recordAttempt, {
        service: "pdf",
        operation: "retrieve_pdf",
        operationKey: "pdf:direct:url",
        status: "succeeded",
        attempt: 1,
        latencyMs: 88,
    });

    await expect(
        t.run(async (ctx) => ctx.db.get(pdfAttempt.providerCallId)),
    ).resolves.toMatchObject({
        service: "pdf",
        status: "succeeded",
        latencyMs: 88,
    });
});

test("M9: paid-disabled gate atomically records failed providerCall row", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
        await ctx.db.insert("paidWorkControls", {
            key: "global",
            enabled: false,
            updatedAt: 100,
        });
    });

    const res = await t.mutation(recordAttempt, {
        service: "exa",
        operation: "get_contents",
        operationKey: "exa:disabled:atomic:url",
        status: "started",
        attempt: 1,
    });
    expect(res.shouldExecute).toBe(false);
    expect(res.status).toBe("failed");

    const row = await t.run(async (ctx) =>
        ctx.db
            .query("providerCalls")
            .withIndex("by_operation_key", (q) =>
                q.eq("operationKey", "exa:disabled:atomic:url"),
            )
            .first(),
    );

    expect(row).not.toBeNull();
    expect(row?.status).toBe("failed");
    expect(row?.errorCode).toBe("paid_work_disabled");
});

test("H2: exa get_contents attempt lease duration is at least 150 seconds and cannot be reclaimed while active", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();

    const started = await t.mutation(recordAttempt, {
        service: "exa",
        operation: "get_contents",
        operationKey: "exa:lease:test:url",
        status: "started",
        attempt: 1,
    });

    const callDoc = await t.run(async (ctx) =>
        ctx.db.get(started.providerCallId),
    );
    expect(callDoc?.leaseExpiresAt).toBeGreaterThanOrEqual(now + 150_000);

    // Concurrent replay while lease is active cannot execute
    const replay = await t.mutation(recordAttempt, {
        service: "exa",
        operation: "get_contents",
        operationKey: "exa:lease:test:url",
        status: "started",
        attempt: 1,
    });

    expect(replay.shouldExecute).toBe(false);
    expect(replay.status).toBe("started");
});

test("H1: recordAttempt atomically enforces execution fence for extracting_evidence attempts", async () => {
    const t = convexTest(schema, modules);
    const seed = await t.run(async (ctx) => {
        const userId = await ctx.db.insert("users", { isAnonymous: true });
        const invitationId = await ctx.db.insert("invitations", {
            slotKey: "analyst-phase-5-h1",
            role: "analyst",
            codeDigest: "digest-h1",
            status: "claimed",
            createdAt: 100,
        });
        const visitorId = await ctx.db.insert("visitors", {
            authUserId: userId,
            invitationId,
            role: "analyst",
            status: "active",
            analysesReserved: 1,
            admittedAt: 100,
        });
        const companyId = await ctx.db.insert("companies", {
            legalName: "Test Co",
            ticker: "TEST",
            cik: "1234567",
            exchange: "NASDAQ",
            canonicalizedAt: 100,
        });
        const runId = await ctx.db.insert("researchRuns", {
            purpose: "research",
            ownerVisitorId: visitorId,
            companyId,
            coveragePreset: "balanced",
            lifecycleState: "extracting_evidence",
            executionStatus: "running",
            executionGeneration: 1,
            nextEventSequence: 1,
            createdAt: 100,
            updatedAt: 100,
        });
        const corpusRevisionId = await ctx.db.insert("corpusRevisions", {
            runId,
            revision: 1,
            status: "approved",
            approvedByVisitorId: visitorId,
            approvedAt: 100,
            createdAt: 100,
        });
        await ctx.db.patch(runId, { activeCorpusRevisionId: corpusRevisionId });

        const sourceId = await ctx.db.insert("sources", {
            runId,
            canonicalUrl: "https://example.com/item",
            title: "Test Item",
            category: "analyst_research",
            origin: "exa",
            createdAt: 100,
        });

        const acceptedDecisionId = await ctx.db.insert("sourceDecisions", {
            runId,
            corpusRevisionId,
            sourceId,
            decision: "accepted",
            decisionKey: `dec-${sourceId}-1`,
            occurredAt: 100,
        });

        await ctx.db.insert("sourceReviewItems", {
            runId,
            corpusRevisionId,
            sourceId,
            decision: "accepted",
            latestDecisionId: acceptedDecisionId,
            decisionRank: 1,
            decisionOccurredAt: 100,
            sourceCreatedAt: 100,
        });

        await ctx.db.insert("evidenceSourceStatuses", {
            runId,
            corpusRevisionId,
            sourceId,
            acceptedDecisionId,
            executionGeneration: 1,
            status: "queued",
            createdAt: 100,
            updatedAt: 100,
        });

        return { runId, corpusRevisionId, sourceId, acceptedDecisionId };
    });

    // Valid fence call succeeds
    const validAttempt = await t.mutation(recordAttempt, {
        runId: seed.runId,
        corpusRevisionId: seed.corpusRevisionId,
        sourceId: seed.sourceId,
        acceptedDecisionId: seed.acceptedDecisionId,
        executionGeneration: 1,
        stepKey: "extracting_evidence",
        service: "exa",
        operation: "get_contents",
        operationKey: "exa:fence:valid",
        status: "started",
        attempt: 1,
    });
    expect(validAttempt.shouldExecute).toBe(true);

    // When run is cancelled or idle, recordAttempt throws
    await t.run(async (ctx) => {
        await ctx.db.patch(seed.runId, { executionStatus: "idle" });
    });

    await expect(
        t.mutation(recordAttempt, {
            runId: seed.runId,
            corpusRevisionId: seed.corpusRevisionId,
            sourceId: seed.sourceId,
            acceptedDecisionId: seed.acceptedDecisionId,
            executionGeneration: 1,
            stepKey: "extracting_evidence",
            service: "exa",
            operation: "get_contents",
            operationKey: "exa:fence:cancelled",
            status: "started",
            attempt: 1,
        }),
    ).rejects.toThrow(/execution fence violation/i);
});

test("Task5: recordAttempt runs execution fence BEFORE paidWorkControls check and creates NO telemetry for unauthorized calls", async () => {
    const t = convexTest(schema, modules);
    const seed = await t.run(async (ctx) => {
        await ctx.db.insert("paidWorkControls", {
            key: "global",
            enabled: false,
            updatedAt: 100,
        });
        const userId = await ctx.db.insert("users", { isAnonymous: true });
        const invitationId = await ctx.db.insert("invitations", {
            slotKey: "analyst-task5-pwc",
            role: "analyst",
            codeDigest: "digest-task5-pwc",
            status: "claimed",
            createdAt: 100,
        });
        const visitorId = await ctx.db.insert("visitors", {
            authUserId: userId,
            invitationId,
            role: "analyst",
            status: "active",
            analysesReserved: 1,
            admittedAt: 100,
        });
        const companyId = await ctx.db.insert("companies", {
            legalName: "Test Co",
            ticker: "TEST",
            cik: "1234567",
            exchange: "NASDAQ",
            canonicalizedAt: 100,
        });
        const runId = await ctx.db.insert("researchRuns", {
            purpose: "research",
            ownerVisitorId: visitorId,
            companyId,
            coveragePreset: "balanced",
            lifecycleState: "extracting_evidence",
            executionStatus: "running",
            executionGeneration: 1,
            nextEventSequence: 1,
            createdAt: 100,
            updatedAt: 100,
        });
        const corpusRevisionId = await ctx.db.insert("corpusRevisions", {
            runId,
            revision: 1,
            status: "approved",
            approvedByVisitorId: visitorId,
            approvedAt: 100,
            createdAt: 100,
        });
        await ctx.db.patch(runId, { activeCorpusRevisionId: corpusRevisionId });

        const sourceId = await ctx.db.insert("sources", {
            runId,
            canonicalUrl: "https://example.com/item",
            title: "Test Item",
            category: "analyst_research",
            origin: "exa",
            createdAt: 100,
        });

        const acceptedDecisionId = await ctx.db.insert("sourceDecisions", {
            runId,
            corpusRevisionId,
            sourceId,
            decision: "accepted",
            decisionKey: `dec-${sourceId}-1`,
            occurredAt: 100,
        });

        await ctx.db.insert("sourceReviewItems", {
            runId,
            corpusRevisionId,
            sourceId,
            decision: "accepted",
            latestDecisionId: acceptedDecisionId,
            decisionRank: 1,
            decisionOccurredAt: 100,
            sourceCreatedAt: 100,
        });

        await ctx.db.insert("evidenceSourceStatuses", {
            runId,
            corpusRevisionId,
            sourceId,
            acceptedDecisionId,
            executionGeneration: 1,
            status: "queued",
            createdAt: 100,
            updatedAt: 100,
        });

        // An unauthorized / rejected source
        const rejectedSourceId = await ctx.db.insert("sources", {
            runId,
            canonicalUrl: "https://example.com/rejected",
            title: "Rejected Item",
            category: "analyst_research",
            origin: "exa",
            createdAt: 100,
        });
        const rejectedDecisionId = await ctx.db.insert("sourceDecisions", {
            runId,
            corpusRevisionId,
            sourceId: rejectedSourceId,
            decision: "rejected",
            decisionKey: `dec-${rejectedSourceId}-1`,
            occurredAt: 100,
        });
        await ctx.db.insert("sourceReviewItems", {
            runId,
            corpusRevisionId,
            sourceId: rejectedSourceId,
            decision: "rejected",
            latestDecisionId: rejectedDecisionId,
            decisionRank: 2,
            decisionOccurredAt: 100,
            sourceCreatedAt: 100,
        });

        return {
            runId,
            corpusRevisionId,
            sourceId,
            acceptedDecisionId,
            rejectedSourceId,
            rejectedDecisionId,
        };
    });

    // 1. Unauthorized/rejected call with paidWork disabled MUST throw fence violation and create NO providerCalls row
    await expect(
        t.mutation(recordAttempt, {
            runId: seed.runId,
            corpusRevisionId: seed.corpusRevisionId,
            sourceId: seed.rejectedSourceId,
            acceptedDecisionId: seed.rejectedDecisionId,
            executionGeneration: 1,
            stepKey: "extracting_evidence",
            service: "exa",
            operation: "get_contents",
            operationKey: "exa:fence:rejected-source",
            status: "started",
            attempt: 1,
        }),
    ).rejects.toThrow(/execution fence violation/i);

    // Verify zero providerCalls rows were created for the rejected source
    const rejectedCalls = await t.run(async (ctx) =>
        ctx.db
            .query("providerCalls")
            .withIndex("by_operation_key", (q) =>
                q.eq("operationKey", "exa:fence:rejected-source"),
            )
            .collect(),
    );
    expect(rejectedCalls.length).toBe(0);

    // 2. Authorized call with paidWork disabled succeeds fence, creates paid_work_disabled row, returns failed
    const authorizedPaidDisabled = await t.mutation(recordAttempt, {
        runId: seed.runId,
        corpusRevisionId: seed.corpusRevisionId,
        sourceId: seed.sourceId,
        acceptedDecisionId: seed.acceptedDecisionId,
        executionGeneration: 1,
        stepKey: "extracting_evidence",
        service: "exa",
        operation: "get_contents",
        operationKey: "exa:fence:authorized-paid-disabled",
        status: "started",
        attempt: 1,
    });
    expect(authorizedPaidDisabled.shouldExecute).toBe(false);
    expect(authorizedPaidDisabled.status).toBe("failed");

    const authorizedCalls = await t.run(async (ctx) =>
        ctx.db
            .query("providerCalls")
            .withIndex("by_operation_key", (q) =>
                q.eq("operationKey", "exa:fence:authorized-paid-disabled"),
            )
            .collect(),
    );
    expect(authorizedCalls.length).toBe(1);
    expect(authorizedCalls[0]?.errorCode).toBe("paid_work_disabled");
    expect(authorizedCalls[0]?.status).toBe("failed");
});

test("Task5: recordAttempt prevents expired-lease reclaim on unauthorized or revoked sources", async () => {
    const t = convexTest(schema, modules);
    const seed = await t.run(async (ctx) => {
        const userId = await ctx.db.insert("users", { isAnonymous: true });
        const invitationId = await ctx.db.insert("invitations", {
            slotKey: "analyst-task5-reclaim",
            role: "analyst",
            codeDigest: "digest-task5-reclaim",
            status: "claimed",
            createdAt: 100,
        });
        const visitorId = await ctx.db.insert("visitors", {
            authUserId: userId,
            invitationId,
            role: "analyst",
            status: "active",
            analysesReserved: 1,
            admittedAt: 100,
        });
        const companyId = await ctx.db.insert("companies", {
            legalName: "Test Co",
            ticker: "TEST",
            cik: "1234567",
            exchange: "NASDAQ",
            canonicalizedAt: 100,
        });
        const runId = await ctx.db.insert("researchRuns", {
            purpose: "research",
            ownerVisitorId: visitorId,
            companyId,
            coveragePreset: "balanced",
            lifecycleState: "extracting_evidence",
            executionStatus: "running",
            executionGeneration: 1,
            nextEventSequence: 1,
            createdAt: 100,
            updatedAt: 100,
        });
        const corpusRevisionId = await ctx.db.insert("corpusRevisions", {
            runId,
            revision: 1,
            status: "approved",
            approvedByVisitorId: visitorId,
            approvedAt: 100,
            createdAt: 100,
        });
        await ctx.db.patch(runId, { activeCorpusRevisionId: corpusRevisionId });

        const sourceId = await ctx.db.insert("sources", {
            runId,
            canonicalUrl: "https://example.com/reclaim-item",
            title: "Reclaim Item",
            category: "analyst_research",
            origin: "exa",
            createdAt: 100,
        });

        const acceptedDecisionId = await ctx.db.insert("sourceDecisions", {
            runId,
            corpusRevisionId,
            sourceId,
            decision: "accepted",
            decisionKey: `dec-${sourceId}-1`,
            occurredAt: 100,
        });

        await ctx.db.insert("sourceReviewItems", {
            runId,
            corpusRevisionId,
            sourceId,
            decision: "accepted",
            latestDecisionId: acceptedDecisionId,
            decisionRank: 1,
            decisionOccurredAt: 100,
            sourceCreatedAt: 100,
        });

        await ctx.db.insert("evidenceSourceStatuses", {
            runId,
            corpusRevisionId,
            sourceId,
            acceptedDecisionId,
            executionGeneration: 1,
            status: "queued",
            createdAt: 100,
            updatedAt: 100,
        });

        // Insert an expired started call
        const expiredCallId = await ctx.db.insert("providerCalls", {
            runId,
            corpusRevisionId,
            executionGeneration: 1,
            workflowVersion: 2,
            stepKey: "extracting_evidence",
            service: "exa",
            operation: "get_contents",
            operationKey: "exa:reclaim:test",
            status: "started",
            attempt: 1,
            leaseExpiresAt: 50, // expired relative to now
            createdAt: 50,
        });

        return {
            runId,
            corpusRevisionId,
            sourceId,
            acceptedDecisionId,
            expiredCallId,
        };
    });

    // Revoke the source decision
    await t.run(async (ctx) => {
        const revDecisionId = await ctx.db.insert("sourceDecisions", {
            runId: seed.runId,
            corpusRevisionId: seed.corpusRevisionId,
            sourceId: seed.sourceId,
            decision: "rejected",
            decisionKey: `dec-${seed.sourceId}-2`,
            occurredAt: 200,
        });
        const item = await ctx.db
            .query("sourceReviewItems")
            .withIndex("by_revision_and_source", (q) =>
                q
                    .eq("corpusRevisionId", seed.corpusRevisionId)
                    .eq("sourceId", seed.sourceId),
            )
            .unique();
        if (item) {
            await ctx.db.patch(item._id, {
                decision: "rejected",
                latestDecisionId: revDecisionId,
            });
        }
    });

    // Reclaim attempt on revoked source MUST throw fence error
    await expect(
        t.mutation(recordAttempt, {
            runId: seed.runId,
            corpusRevisionId: seed.corpusRevisionId,
            sourceId: seed.sourceId,
            acceptedDecisionId: seed.acceptedDecisionId,
            executionGeneration: 1,
            stepKey: "extracting_evidence",
            service: "exa",
            operation: "get_contents",
            operationKey: "exa:reclaim:test",
            status: "started",
            attempt: 1,
        }),
    ).rejects.toThrow(/execution fence violation/i);

    // Lease on expired call must NOT have been refreshed
    const callAfter = await t.run(async (ctx) =>
        ctx.db.get(seed.expiredCallId),
    );
    expect(callAfter?.leaseExpiresAt).toBe(50);
});

test("Task5 defect 1: terminal telemetry unchanged after run cancellation", async () => {
    const t = convexTest(schema, modules);
    const seed = await t.run(async (ctx) => {
        const userId = await ctx.db.insert("users", { isAnonymous: true });
        const invitationId = await ctx.db.insert("invitations", {
            slotKey: "analyst-task5-cancel-term",
            role: "analyst",
            codeDigest: "digest-task5-cancel-term",
            status: "claimed",
            createdAt: 100,
        });
        const visitorId = await ctx.db.insert("visitors", {
            authUserId: userId,
            invitationId,
            role: "analyst",
            status: "active",
            analysesReserved: 1,
            admittedAt: 100,
        });
        const companyId = await ctx.db.insert("companies", {
            legalName: "Test Co",
            ticker: "TEST",
            cik: "1234567",
            exchange: "NASDAQ",
            canonicalizedAt: 100,
        });
        const runId = await ctx.db.insert("researchRuns", {
            purpose: "research",
            ownerVisitorId: visitorId,
            companyId,
            coveragePreset: "balanced",
            lifecycleState: "extracting_evidence",
            executionStatus: "running",
            executionGeneration: 1,
            nextEventSequence: 1,
            createdAt: 100,
            updatedAt: 100,
        });
        const corpusRevisionId = await ctx.db.insert("corpusRevisions", {
            runId,
            revision: 1,
            status: "approved",
            approvedByVisitorId: visitorId,
            approvedAt: 100,
            createdAt: 100,
        });
        await ctx.db.patch(runId, { activeCorpusRevisionId: corpusRevisionId });

        const sourceId = await ctx.db.insert("sources", {
            runId,
            canonicalUrl: "https://example.com/cancel-item",
            title: "Cancel Item",
            category: "analyst_research",
            origin: "exa",
            createdAt: 100,
        });

        const acceptedDecisionId = await ctx.db.insert("sourceDecisions", {
            runId,
            corpusRevisionId,
            sourceId,
            decision: "accepted",
            decisionKey: `dec-${sourceId}-1`,
            occurredAt: 100,
        });

        await ctx.db.insert("sourceReviewItems", {
            runId,
            corpusRevisionId,
            sourceId,
            decision: "accepted",
            latestDecisionId: acceptedDecisionId,
            decisionRank: 1,
            decisionOccurredAt: 100,
            sourceCreatedAt: 100,
        });

        await ctx.db.insert("evidenceSourceStatuses", {
            runId,
            corpusRevisionId,
            sourceId,
            acceptedDecisionId,
            executionGeneration: 1,
            status: "queued",
            createdAt: 100,
            updatedAt: 100,
        });

        return { runId, corpusRevisionId, sourceId, acceptedDecisionId };
    });

    // 1. Start provider attempt while running
    const startResult = await t.mutation(recordAttempt, {
        runId: seed.runId,
        corpusRevisionId: seed.corpusRevisionId,
        sourceId: seed.sourceId,
        acceptedDecisionId: seed.acceptedDecisionId,
        executionGeneration: 1,
        stepKey: "extracting_evidence",
        service: "exa",
        operation: "get_contents",
        operationKey: "exa:cancel-test",
        status: "started",
        attempt: 1,
    });
    expect(startResult.shouldExecute).toBe(true);

    const callBefore = await t.run(async (ctx) =>
        ctx.db.get(startResult.providerCallId),
    );
    expect(callBefore?.status).toBe("started");

    // 2. Cancel run
    await t.run(async (ctx) => {
        await ctx.db.patch(seed.runId, {
            executionStatus: "idle",
            lifecycleState: "awaiting_evidence_sufficiency_review",
        });
    });

    // 3. Attempt terminal recordAttempt (succeeded) on cancelled run -> MUST throw fence error
    await expect(
        t.mutation(recordAttempt, {
            runId: seed.runId,
            corpusRevisionId: seed.corpusRevisionId,
            sourceId: seed.sourceId,
            acceptedDecisionId: seed.acceptedDecisionId,
            executionGeneration: 1,
            stepKey: "extracting_evidence",
            service: "exa",
            operation: "get_contents",
            operationKey: "exa:cancel-test",
            status: "succeeded",
            attempt: 1,
            latencyMs: 150,
        }),
    ).rejects.toThrow(/execution fence violation/i);

    // 4. Verify providerCalls row is UNCHANGED (still started, no latency, no completedAt)
    const callAfter = await t.run(async (ctx) =>
        ctx.db.get(startResult.providerCallId),
    );
    expect(callAfter?.status).toBe("started");
    expect(callAfter?.completedAt).toBeUndefined();
    expect(callAfter?.latencyMs).toBeUndefined();
});

test("Task5 defect 1: terminal telemetry unchanged after decision revocation", async () => {
    const t = convexTest(schema, modules);
    const seed = await t.run(async (ctx) => {
        const userId = await ctx.db.insert("users", { isAnonymous: true });
        const invitationId = await ctx.db.insert("invitations", {
            slotKey: "analyst-task5-revoke-term",
            role: "analyst",
            codeDigest: "digest-task5-revoke-term",
            status: "claimed",
            createdAt: 100,
        });
        const visitorId = await ctx.db.insert("visitors", {
            authUserId: userId,
            invitationId,
            role: "analyst",
            status: "active",
            analysesReserved: 1,
            admittedAt: 100,
        });
        const companyId = await ctx.db.insert("companies", {
            legalName: "Test Co",
            ticker: "TEST",
            cik: "1234567",
            exchange: "NASDAQ",
            canonicalizedAt: 100,
        });
        const runId = await ctx.db.insert("researchRuns", {
            purpose: "research",
            ownerVisitorId: visitorId,
            companyId,
            coveragePreset: "balanced",
            lifecycleState: "extracting_evidence",
            executionStatus: "running",
            executionGeneration: 1,
            nextEventSequence: 1,
            createdAt: 100,
            updatedAt: 100,
        });
        const corpusRevisionId = await ctx.db.insert("corpusRevisions", {
            runId,
            revision: 1,
            status: "approved",
            approvedByVisitorId: visitorId,
            approvedAt: 100,
            createdAt: 100,
        });
        await ctx.db.patch(runId, { activeCorpusRevisionId: corpusRevisionId });

        const sourceId = await ctx.db.insert("sources", {
            runId,
            canonicalUrl: "https://example.com/revoke-item",
            title: "Revoke Item",
            category: "analyst_research",
            origin: "exa",
            createdAt: 100,
        });

        const acceptedDecisionId = await ctx.db.insert("sourceDecisions", {
            runId,
            corpusRevisionId,
            sourceId,
            decision: "accepted",
            decisionKey: `dec-${sourceId}-1`,
            occurredAt: 100,
        });

        await ctx.db.insert("sourceReviewItems", {
            runId,
            corpusRevisionId,
            sourceId,
            decision: "accepted",
            latestDecisionId: acceptedDecisionId,
            decisionRank: 1,
            decisionOccurredAt: 100,
            sourceCreatedAt: 100,
        });

        await ctx.db.insert("evidenceSourceStatuses", {
            runId,
            corpusRevisionId,
            sourceId,
            acceptedDecisionId,
            executionGeneration: 1,
            status: "queued",
            createdAt: 100,
            updatedAt: 100,
        });

        return { runId, corpusRevisionId, sourceId, acceptedDecisionId };
    });

    // 1. Start provider attempt while valid
    const startResult = await t.mutation(recordAttempt, {
        runId: seed.runId,
        corpusRevisionId: seed.corpusRevisionId,
        sourceId: seed.sourceId,
        acceptedDecisionId: seed.acceptedDecisionId,
        executionGeneration: 1,
        stepKey: "extracting_evidence",
        service: "exa",
        operation: "get_contents",
        operationKey: "exa:revoke-test",
        status: "started",
        attempt: 1,
    });
    expect(startResult.shouldExecute).toBe(true);

    // 2. Revoke decision
    await t.run(async (ctx) => {
        const revDecisionId = await ctx.db.insert("sourceDecisions", {
            runId: seed.runId,
            corpusRevisionId: seed.corpusRevisionId,
            sourceId: seed.sourceId,
            decision: "rejected",
            decisionKey: `dec-${seed.sourceId}-2`,
            occurredAt: 200,
        });
        const item = await ctx.db
            .query("sourceReviewItems")
            .withIndex("by_revision_and_source", (q) =>
                q
                    .eq("corpusRevisionId", seed.corpusRevisionId)
                    .eq("sourceId", seed.sourceId),
            )
            .unique();
        if (item) {
            await ctx.db.patch(item._id, {
                decision: "rejected",
                latestDecisionId: revDecisionId,
            });
        }
    });

    // 3. Attempt terminal recordAttempt (failed) on revoked decision -> MUST throw fence error
    await expect(
        t.mutation(recordAttempt, {
            runId: seed.runId,
            corpusRevisionId: seed.corpusRevisionId,
            sourceId: seed.sourceId,
            acceptedDecisionId: seed.acceptedDecisionId,
            executionGeneration: 1,
            stepKey: "extracting_evidence",
            service: "exa",
            operation: "get_contents",
            operationKey: "exa:revoke-test",
            status: "failed",
            attempt: 1,
            errorCode: "provider_error",
        }),
    ).rejects.toThrow(/execution fence violation/i);

    // 4. Verify providerCalls row is UNCHANGED (still started, no completedAt)
    const callAfter = await t.run(async (ctx) =>
        ctx.db.get(startResult.providerCallId),
    );
    expect(callAfter?.status).toBe("started");
    expect(callAfter?.completedAt).toBeUndefined();
    expect(callAfter?.errorCode).toBeUndefined();
});
