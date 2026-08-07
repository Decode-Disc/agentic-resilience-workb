import type { Id } from "@convex/_generated/dataModel";
import schema from "@convex/schema";
import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import rateLimiterTest from "../integrations/rate-limiter-test-register.js";
import workflowTest from "./workflow-test-register.js";

const { exaSearch } = vi.hoisted(() => ({
    exaSearch: vi.fn(),
}));

vi.mock("exa-js", () => ({
    default: class MockExa {
        search(...args: unknown[]) {
            return exaSearch(...args);
        }
    },
}));

vi.mock("node:dns/promises", async (importOriginal) => {
    const dns = await importOriginal<typeof import("node:dns/promises")>();
    return {
        ...dns,
        lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]),
    };
});

const modules = import.meta.glob("/convex/**/*.ts");
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
const confirmAndStart = makeFunctionReference<
    "action",
    {
        preflightId: Id<"companyPreflights">;
        idempotencyKey: string;
        coveragePreset: "balanced";
    },
    { runId: Id<"researchRuns">; remainingAnalyses: number }
>("researchLaunch:confirmAndStart");
const decideSource = makeFunctionReference<
    "mutation",
    {
        runId: Id<"researchRuns">;
        corpusRevisionId: Id<"corpusRevisions">;
        sourceId: Id<"sources">;
        decision: "accepted";
        decisionKey: string;
    },
    { accepted: boolean }
>("sources:decide");
const approveCorpus = makeFunctionReference<
    "mutation",
    {
        runId: Id<"researchRuns">;
        corpusRevisionId: Id<"corpusRevisions">;
        proposalId: Id<"sourceSelectionProposals">;
        proposalVersion: number;
        decisionKey: string;
    },
    { accepted: boolean }
>("sourceSelectionProposals:approveProposedCorpus");
const getRun = makeFunctionReference<
    "query",
    { runId: Id<"researchRuns"> },
    unknown
>("researchRuns:get");
const listEvents = makeFunctionReference<
    "query",
    { runId: Id<"researchRuns"> },
    Array<{ lifecycleState: string }>
>("researchRuns:listEvents");

test("ends Phase 4 at an immutable approved corpus", async () => {
    vi.useFakeTimers();
    process.env.SEC_USER_AGENT = "Evidence Workbench test@example.com";
    process.env.EXA_API_KEY = "deterministic-test-key";
    exaSearch.mockResolvedValue({
        results: [
            {
                id: "deterministic-exa-source",
                url: "https://example.com/report",
                title: "Public report",
            },
        ],
    });
    globalThis.fetch = vi.fn(async () =>
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
    const t = convexTest(schema, modules);
    rateLimiterTest.register(t);
    workflowTest.register(t);
    const fixture = await t.run(async (ctx) => {
        const userId = await ctx.db.insert("users", { isAnonymous: true });
        const invitationId = await ctx.db.insert("invitations", {
            slotKey: "analyst-1",
            role: "analyst",
            codeDigest: "phase-4-digest",
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
            canonicalizedAt: 1,
        });
        const preflightId = await ctx.db.insert("companyPreflights", {
            ownerVisitorId: visitorId,
            query: "CCCS",
            companyId,
            resolverVersion: "sec-company-v1",
            status: "resolved",
            expiresAt: Date.now() + 60_000,
            createdAt: 1,
        });
        return { userId, preflightId };
    });
    const analyst = t.withIdentity({
        subject: `${fixture.userId}|phase-4-session`,
    });
    const { runId } = await analyst.action(confirmAndStart, {
        preflightId: fixture.preflightId,
        idempotencyKey: "phase-4-run",
        coveragePreset: "balanced",
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const exaCalls = await t.run(async (ctx) =>
        ctx.db
            .query("providerCalls")
            .filter((builder) =>
                builder.and(
                    builder.eq(builder.field("runId"), runId),
                    builder.eq(builder.field("service"), "exa"),
                ),
            )
            .collect(),
    );
    expect(exaCalls.length).toBeGreaterThan(0);
    expect(exaCalls.every(({ status }) => status === "succeeded")).toBe(true);
    const { corpusRevisionId, proposalId, sourceId } = await t.run(
        async (ctx) => {
            const run = await ctx.db.get(runId);
            if (!run?.activeCorpusRevisionId) {
                throw new Error("Draft corpus revision not found");
            }
            const source = await ctx.db
                .query("sources")
                .withIndex("by_run_and_url", (builder) =>
                    builder.eq("runId", runId),
                )
                .first();
            if (!source) {
                throw new Error("Discovery did not persist a source");
            }
            const revision = await ctx.db.get(run.activeCorpusRevisionId);
            if (!revision?.sourceSelectionProposalId) {
                throw new Error("Source selection proposal not found");
            }
            return {
                corpusRevisionId: run.activeCorpusRevisionId,
                proposalId: revision.sourceSelectionProposalId,
                sourceId: source._id,
            };
        },
    );
    await expect(t.run((ctx) => ctx.db.get(proposalId))).resolves.toMatchObject(
        {
            status: "ready",
            version: 1,
        },
    );

    await expect(
        analyst.mutation(approveCorpus, {
            runId,
            corpusRevisionId,
            proposalId,
            proposalVersion: 1,
            decisionKey: "approve-corpus-1",
        }),
    ).resolves.toEqual({ accepted: true });
    await expect(
        analyst.mutation(approveCorpus, {
            runId,
            corpusRevisionId,
            proposalId,
            proposalVersion: 1,
            decisionKey: "approve-corpus-1",
        }),
    ).resolves.toEqual({ accepted: false });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    await expect(t.query(getRun, { runId })).resolves.toMatchObject({
        lifecycleState: "corpus_approved",
        executionStatus: "idle",
        executionGeneration: 2,
        activeCorpusRevisionId: corpusRevisionId,
    });
    expect(
        (await t.query(listEvents, { runId })).some(
            ({ lifecycleState }) => lifecycleState === "extracting_evidence",
        ),
    ).toBe(false);
    await expect(
        t.run(async (ctx) => ctx.db.get(corpusRevisionId)),
    ).resolves.toMatchObject({ status: "approved" });
    const { acceptedDecisions, recommendedCount } = await t.run(async (ctx) => {
        const proposal = await ctx.db.get(proposalId);
        const decisions = await ctx.db
            .query("sourceDecisions")
            .withIndex("by_revision_and_source", (query) =>
                query.eq("corpusRevisionId", corpusRevisionId),
            )
            .collect();
        return {
            acceptedDecisions: decisions.filter(
                ({ decision }) => decision === "accepted",
            ).length,
            recommendedCount: proposal?.counts.recommended,
        };
    });
    expect(acceptedDecisions).toBe(recommendedCount);
    await expect(
        analyst.mutation(decideSource, {
            runId,
            corpusRevisionId,
            sourceId,
            decision: "accepted",
            decisionKey: "late-approved-edit",
        }),
    ).rejects.toThrow("immutable");
});
