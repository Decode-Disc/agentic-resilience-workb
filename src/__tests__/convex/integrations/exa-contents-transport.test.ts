import { internal } from "@convex/_generated/api";
import schema from "@convex/schema";
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";

const modules = import.meta.glob("/convex/**/*.ts");

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
});

async function seedApprovedSource(
    t: ReturnType<typeof convexTest>,
    canonicalUrl = "https://example.com/slow",
) {
    return t.run(async (ctx) => {
        const userId = await ctx.db.insert("users", { isAnonymous: true });
        const invitationId = await ctx.db.insert("invitations", {
            slotKey: "transport",
            role: "analyst",
            codeDigest: "fixture",
            status: "claimed",
            createdAt: 1,
        });
        const visitorId = await ctx.db.insert("visitors", {
            invitationId,
            authUserId: userId,
            role: "analyst",
            status: "active",
            admittedAt: 1,
            analysesReserved: 1,
        });
        const runId = await ctx.db.insert("researchRuns", {
            ownerVisitorId: visitorId,
            lifecycleState: "extracting_evidence",
            executionStatus: "running",
            executionGeneration: 1,
            nextEventSequence: 1,
            createdAt: 1,
            updatedAt: 1,
        });
        const corpusRevisionId = await ctx.db.insert("corpusRevisions", {
            runId,
            revision: 1,
            status: "approved",
            approvedByVisitorId: visitorId,
            approvedAt: 1,
            createdAt: 1,
        });
        await ctx.db.patch(runId, { activeCorpusRevisionId: corpusRevisionId });
        const sourceId = await ctx.db.insert("sources", {
            runId,
            canonicalUrl,
            title: "Transport fixture",
            origin: "exa",
            category: "official_product",
            createdAt: 1,
        });
        const acceptedDecisionId = await ctx.db.insert("sourceDecisions", {
            runId,
            corpusRevisionId,
            sourceId,
            decisionKey: "accepted",
            decision: "accepted",
            reviewerVisitorId: visitorId,
            occurredAt: 1,
        });
        await ctx.db.insert("sourceReviewItems", {
            runId,
            corpusRevisionId,
            sourceId,
            latestDecisionId: acceptedDecisionId,
            decision: "accepted",
            decisionRank: 0,
            sourceCreatedAt: 1,
            decisionOccurredAt: 1,
        });
        await ctx.db.insert("evidenceSourceStatuses", {
            runId,
            corpusRevisionId,
            sourceId,
            acceptedDecisionId,
            executionGeneration: 1,
            status: "queued",
            createdAt: 1,
            updatedAt: 1,
        });
        return {
            runId,
            corpusRevisionId,
            sourceId,
            acceptedDecisionId,
            executionGeneration: 1,
        };
    });
}

test("real SDK Contents requests abort before retry and exhaustion", async () => {
    vi.useFakeTimers();
    vi.stubEnv("EXA_API_KEY", "fixture-key");
    let active = 0;
    let peak = 0;
    const signals: AbortSignal[] = [];
    const fetchMock = vi.fn(
        (_url: unknown, options?: RequestInit) =>
            new Promise<Response>((_resolve, reject) => {
                active += 1;
                peak = Math.max(peak, active);
                const signal = options?.signal;
                if (signal) {
                    signals.push(signal);
                    signal.addEventListener(
                        "abort",
                        () => {
                            active -= 1;
                            reject(signal.reason);
                        },
                        { once: true },
                    );
                }
            }),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.resetModules();
    const t = convexTest(schema, modules);
    const args = await seedApprovedSource(t);
    const work = t.action(
        internal.evidenceActions.retrieveAndNormalizeExaSource,
        args,
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(240_001);
    const result = await work;
    expect(result.status).toBe("failed");
    expect(peak).toBe(1);
    expect(active).toBe(0);
    expect(signals).toHaveLength(2);
    expect(signals[0]).not.toBe(signals[1]);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    const calls = await t.run((ctx) =>
        ctx.db
            .query("providerCalls")
            .withIndex("by_run", (q) => q.eq("runId", args.runId))
            .take(3),
    );
    expect(
        calls.map((call) => ({ status: call.status, attempt: call.attempt })),
    ).toEqual([
        { status: "failed", attempt: 1 },
        { status: "failed", attempt: 2 },
    ]);
    expect(
        await t.run((ctx) =>
            ctx.db
                .query("sourceVersions")
                .withIndex("by_run", (q) => q.eq("runId", args.runId))
                .take(1),
        ),
    ).toEqual([]);
});

test("concurrent SDK instances keep their cancellation independent", async () => {
    vi.useFakeTimers();
    vi.stubEnv("EXA_API_KEY", "fixture-key");
    const signals: AbortSignal[] = [];
    const fetchMock = vi.fn((_url: unknown, options?: RequestInit) => {
        const signal = options?.signal;
        if (!signal) throw new Error("Expected cancellation signal");
        signals.push(signal);
        const payload = JSON.parse(String(options?.body)) as { urls: string[] };
        if (payload.urls[0] === "https://example.com/fast") {
            return Promise.resolve(
                Response.json({
                    results: [
                        {
                            id: "fast",
                            url: payload.urls[0],
                            text: "The public documentation describes the platform integration and workflow APIs.",
                        },
                    ],
                }),
            );
        }
        return new Promise<Response>((_resolve, reject) =>
            signal.addEventListener("abort", () => reject(signal.reason), {
                once: true,
            }),
        );
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.resetModules();
    const t = convexTest(schema, modules);
    const slow = await seedApprovedSource(t);
    const fast = await seedApprovedSource(t, "https://example.com/fast");
    const slowWork = t.action(
        internal.evidenceActions.retrieveAndNormalizeExaSource,
        slow,
    );
    const fastWork = t.action(
        internal.evidenceActions.retrieveAndNormalizeExaSource,
        fast,
    );
    const completed = await fastWork;
    expect(completed.status).toBe("succeeded");
    await vi.advanceTimersByTimeAsync(240_001);
    expect((await slowWork).status).toBe("failed");
    expect(new Set(signals).size).toBe(3);
    expect(signals.filter((signal) => signal.aborted)).toHaveLength(2);
    expect(
        await t.action(
            internal.evidenceActions.retrieveAndNormalizeExaSource,
            fast,
        ),
    ).toMatchObject({
        status: "succeeded",
        sourceVersionId: completed.sourceVersionId,
        reused: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
});

test.each([
    {
        label: "HTTP failure",
        response: () => new Response("unavailable", { status: 503 }),
        calls: 2,
    },
    {
        label: "invalid JSON",
        response: () => new Response("invalid"),
        calls: 1,
    },
    {
        label: "invalid schema",
        response: () => Response.json({ results: [{ id: "missing-url" }] }),
        calls: 1,
    },
    {
        label: "oversized response",
        response: () =>
            new Response("{}", {
                headers: { "content-length": String(16 * 1024 * 1024 + 1) },
            }),
        calls: 1,
    },
])("Contents transport reports $label without committing evidence", async ({
    response,
    calls,
}) => {
    vi.stubEnv("EXA_API_KEY", "fixture-key");
    const fetchMock = vi.fn(async () => response());
    vi.stubGlobal("fetch", fetchMock);
    vi.resetModules();
    const t = convexTest(schema, modules);
    const args = await seedApprovedSource(t);
    const result = await t.action(
        internal.evidenceActions.retrieveAndNormalizeExaSource,
        args,
    );
    expect(result.status).toBe("failed");
    expect(fetchMock).toHaveBeenCalledTimes(calls);
    expect(
        await t.run((ctx) =>
            ctx.db
                .query("sourceVersions")
                .withIndex("by_run", (q) => q.eq("runId", args.runId))
                .take(1),
        ),
    ).toEqual([]);
});
