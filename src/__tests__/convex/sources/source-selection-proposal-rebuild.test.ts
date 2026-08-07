import type { Id } from "@convex/_generated/dataModel";
import schema from "@convex/schema";
import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";

import rateLimiterTest from "../integrations/rate-limiter-test-register.js";

const modules = import.meta.glob("/convex/**/*.ts");
const rebuild = makeFunctionReference<
    "action",
    {
        runId: Id<"researchRuns">;
        corpusRevisionId: Id<"corpusRevisions">;
        expectedProposalId: Id<"sourceSelectionProposals">;
    },
    {
        proposalId: Id<"sourceSelectionProposals">;
        version: number;
        outcome: "complete" | "partial" | "blocked";
        failedDiscoveryFamilies: Array<
            | "regulatory"
            | "investor_relations"
            | "official_product"
            | "official_commercial"
            | "counter_evidence"
            | "official_security"
            | "independent_analysis"
        >;
    }
>("sourceSelectionProposalActions:rebuild");
const getCurrent = makeFunctionReference<
    "query",
    {
        runId: Id<"researchRuns">;
        corpusRevisionId: Id<"corpusRevisions">;
    },
    unknown
>("sourceSelectionProposals:getCurrent");
const approveProposedCorpus = makeFunctionReference<
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

const originalSecUserAgent = process.env.SEC_USER_AGENT;
const originalExaKey = process.env.EXA_API_KEY;

afterEach(() => {
    vi.restoreAllMocks();
    if (originalSecUserAgent === undefined) delete process.env.SEC_USER_AGENT;
    else process.env.SEC_USER_AGENT = originalSecUserAgent;
    if (originalExaKey === undefined) delete process.env.EXA_API_KEY;
    else process.env.EXA_API_KEY = originalExaKey;
});

async function seedDraft() {
    const t = convexTest(schema, modules);
    rateLimiterTest.register(t);
    const fixture = await t.run(async (ctx) => {
        const userId = await ctx.db.insert("users", { isAnonymous: true });
        const invitationId = await ctx.db.insert("invitations", {
            slotKey: "rebuild-owner",
            role: "analyst",
            codeDigest: "rebuild-digest",
            status: "claimed",
            createdAt: 1,
        });
        const visitorId = await ctx.db.insert("visitors", {
            authUserId: userId,
            invitationId,
            role: "analyst",
            status: "active",
            analysesReserved: 1,
            admittedAt: 1,
        });
        const companyId = await ctx.db.insert("companies", {
            cik: "1373715",
            legalName: "ServiceNow, Inc.",
            ticker: "NOW",
            exchange: "NYSE",
            websiteUrl: "https://www.servicenow.com/",
            canonicalizedAt: 1,
        });
        const runId = await ctx.db.insert("researchRuns", {
            ownerVisitorId: visitorId,
            companyId,
            coveragePreset: "balanced",
            lifecycleState: "awaiting_source_review",
            executionStatus: "paused",
            pauseReason: "source_review",
            executionGeneration: 4,
            nextEventSequence: 1,
            createdAt: 1,
            updatedAt: 1,
        });
        const corpusRevisionId = await ctx.db.insert("corpusRevisions", {
            runId,
            revision: 1,
            status: "draft",
            createdAt: 1,
        });
        const sourceId = await ctx.db.insert("sources", {
            runId,
            canonicalUrl: "https://www.servicenow.com/products.html",
            title: "Products",
            origin: "exa",
            category: "official_product",
            createdAt: 1,
        });
        const decisionId = await ctx.db.insert("sourceDecisions", {
            runId,
            corpusRevisionId,
            sourceId,
            decisionKey: "accepted-before-rebuild",
            decision: "accepted",
            reviewerVisitorId: visitorId,
            occurredAt: 2,
        });
        await ctx.db.insert("sourceReviewItems", {
            runId,
            corpusRevisionId,
            sourceId,
            decision: "accepted",
            decisionRank: 0,
            sourceCreatedAt: 1,
            latestDecisionId: decisionId,
            decisionOccurredAt: 2,
        });
        const proposalId = await ctx.db.insert("sourceSelectionProposals", {
            runId,
            corpusRevisionId,
            version: 1,
            policyVersion: "source-selection-v1",
            coveragePreset: "balanced",
            recommendedTarget: 12,
            candidateFingerprint: "legacy",
            status: "ready",
            counts: { recommended: 1, needsAttention: 0, alternative: 0 },
            gaps: [],
            createdAt: 2,
        });
        await ctx.db.patch(corpusRevisionId, {
            sourceSelectionProposalId: proposalId,
        });
        await ctx.db.patch(runId, { activeCorpusRevisionId: corpusRevisionId });
        return { userId, runId, corpusRevisionId, proposalId, sourceId };
    });
    return { t, fixture };
}

test("authorizes before provider I/O", async () => {
    process.env.SEC_USER_AGENT = "prototype@example.com";
    delete process.env.EXA_API_KEY;
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { t, fixture } = await seedDraft();

    await expect(
        t.action(rebuild, {
            runId: fixture.runId,
            corpusRevisionId: fixture.corpusRevisionId,
            expectedProposalId: fixture.proposalId,
        }),
    ).rejects.toThrow("Not authenticated");
    expect(fetchSpy).not.toHaveBeenCalled();
});

test("persists a partial rebuild, keeps analyst decisions, and replays idempotently", async () => {
    process.env.SEC_USER_AGENT = "prototype@example.com";
    delete process.env.EXA_API_KEY;
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(
            JSON.stringify({
                cik: 1373715,
                filings: {
                    recent: {
                        accessionNumber: ["0001373715-26-000001"],
                        form: ["10-K"],
                        filingDate: ["2026-01-29"],
                        primaryDocument: ["now-20251231.htm"],
                    },
                },
            }),
            { status: 200 },
        ),
    );
    const { t, fixture } = await seedDraft();
    const owner = t.withIdentity({
        subject: `${fixture.userId}|rebuild-session`,
    });
    const args = {
        runId: fixture.runId,
        corpusRevisionId: fixture.corpusRevisionId,
        expectedProposalId: fixture.proposalId,
    };

    await expect(
        owner.query(getCurrent, {
            runId: fixture.runId,
            corpusRevisionId: fixture.corpusRevisionId,
        }),
    ).resolves.toMatchObject({ effectiveStatus: "outdated" });
    await expect(
        owner.mutation(approveProposedCorpus, {
            runId: fixture.runId,
            corpusRevisionId: fixture.corpusRevisionId,
            proposalId: fixture.proposalId,
            proposalVersion: 1,
            decisionKey: "must-not-approve-v1",
        }),
    ).rejects.toThrow("cannot be approved");

    const first = await owner.action(rebuild, args);
    const replay = await owner.action(rebuild, args);

    expect(first).toMatchObject({
        version: 2,
        outcome: "partial",
        failedDiscoveryFamilies: [
            "investor_relations",
            "official_product",
            "official_commercial",
            "counter_evidence",
        ],
    });
    expect(replay).toEqual(first);
    await expect(
        owner.query(getCurrent, {
            runId: fixture.runId,
            corpusRevisionId: fixture.corpusRevisionId,
        }),
    ).resolves.toMatchObject({
        rebuildOutcome: "partial",
        failedDiscoveryFamilies: [
            "investor_relations",
            "official_product",
            "official_commercial",
            "counter_evidence",
        ],
    });
    await expect(
        t.run((ctx) =>
            ctx.db
                .query("sourceSelectionProposals")
                .withIndex("by_corpus_revision_id_and_version", (query) =>
                    query.eq("corpusRevisionId", fixture.corpusRevisionId),
                )
                .collect(),
        ),
    ).resolves.toHaveLength(2);
    await expect(
        t.run((ctx) =>
            ctx.db
                .query("sourceReviewItems")
                .withIndex("by_revision_and_source", (query) =>
                    query
                        .eq("corpusRevisionId", fixture.corpusRevisionId)
                        .eq("sourceId", fixture.sourceId),
                )
                .unique(),
        ),
    ).resolves.toMatchObject({ decision: "accepted" });
});

test("returns blocked without replacing the outdated proposal when discovery is unavailable", async () => {
    delete process.env.SEC_USER_AGENT;
    delete process.env.EXA_API_KEY;
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { t, fixture } = await seedDraft();
    const owner = t.withIdentity({
        subject: `${fixture.userId}|rebuild-session`,
    });

    const result = await owner.action(rebuild, {
        runId: fixture.runId,
        corpusRevisionId: fixture.corpusRevisionId,
        expectedProposalId: fixture.proposalId,
    });

    expect(result).toMatchObject({
        proposalId: fixture.proposalId,
        version: 1,
        outcome: "blocked",
        failedDiscoveryFamilies: [
            "regulatory",
            "investor_relations",
            "official_product",
            "official_commercial",
            "counter_evidence",
        ],
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    await expect(
        owner.query(getCurrent, {
            runId: fixture.runId,
            corpusRevisionId: fixture.corpusRevisionId,
        }),
    ).resolves.toMatchObject({ effectiveStatus: "outdated" });
    await expect(
        t.run((ctx) =>
            ctx.db
                .query("sourceSelectionProposals")
                .withIndex("by_corpus_revision_id_and_version", (query) =>
                    query.eq("corpusRevisionId", fixture.corpusRevisionId),
                )
                .collect(),
        ),
    ).resolves.toHaveLength(1);
});

test("allows a blocked rebuild to retry after its cooldown without duplicating the proposal", async () => {
    delete process.env.SEC_USER_AGENT;
    delete process.env.EXA_API_KEY;
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { t, fixture } = await seedDraft();
    const owner = t.withIdentity({
        subject: `${fixture.userId}|rebuild-session`,
    });
    const args = {
        runId: fixture.runId,
        corpusRevisionId: fixture.corpusRevisionId,
        expectedProposalId: fixture.proposalId,
    };

    await expect(owner.action(rebuild, args)).resolves.toMatchObject({
        proposalId: fixture.proposalId,
        version: 1,
        outcome: "blocked",
    });
    await t.run(async (ctx) => {
        const rebuildAttempt = await ctx.db
            .query("sourceSelectionProposalRebuilds")
            .withIndex("by_operation_key")
            .unique();
        if (!rebuildAttempt) throw new Error("Expected a rebuild record");
        await ctx.db.patch(rebuildAttempt._id, { leaseExpiresAt: 0 });
    });

    process.env.SEC_USER_AGENT = "prototype@example.com";
    fetchSpy.mockResolvedValue(
        new Response(
            JSON.stringify({
                cik: 1373715,
                filings: {
                    recent: {
                        accessionNumber: ["0001373715-26-000001"],
                        form: ["10-K"],
                        filingDate: ["2026-01-29"],
                        primaryDocument: ["now-20251231.htm"],
                    },
                },
            }),
            { status: 200 },
        ),
    );

    await expect(owner.action(rebuild, args)).resolves.toMatchObject({
        version: 2,
        outcome: "partial",
        failedDiscoveryFamilies: [
            "investor_relations",
            "official_product",
            "official_commercial",
            "counter_evidence",
        ],
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    await expect(
        t.run((ctx) =>
            ctx.db
                .query("sourceSelectionProposals")
                .withIndex("by_corpus_revision_id_and_version", (query) =>
                    query.eq("corpusRevisionId", fixture.corpusRevisionId),
                )
                .collect(),
        ),
    ).resolves.toHaveLength(2);
});

test("returns blocked after two terminal failures when no discovery family succeeds", async () => {
    process.env.SEC_USER_AGENT = "prototype@example.com";
    delete process.env.EXA_API_KEY;
    const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockRejectedValue(new Error("SEC unavailable"));
    const { t, fixture } = await seedDraft();
    const owner = t.withIdentity({
        subject: `${fixture.userId}|rebuild-session`,
    });

    const result = await owner.action(rebuild, {
        runId: fixture.runId,
        corpusRevisionId: fixture.corpusRevisionId,
        expectedProposalId: fixture.proposalId,
    });

    expect(result).toMatchObject({
        proposalId: fixture.proposalId,
        version: 1,
        outcome: "blocked",
        failedDiscoveryFamilies: [
            "regulatory",
            "investor_relations",
            "official_product",
            "official_commercial",
            "counter_evidence",
        ],
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
});

test("persists a partial proposal when web discovery succeeds but regulatory discovery is unavailable", async () => {
    delete process.env.SEC_USER_AGENT;
    process.env.EXA_API_KEY = "test-exa-key";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
        async () =>
            new Response(
                JSON.stringify({
                    results: [],
                    searchTime: 1,
                    costDollars: { total: 0 },
                }),
                { status: 200 },
            ),
    );
    const { t, fixture } = await seedDraft();
    const owner = t.withIdentity({
        subject: `${fixture.userId}|rebuild-session`,
    });

    const result = await owner.action(rebuild, {
        runId: fixture.runId,
        corpusRevisionId: fixture.corpusRevisionId,
        expectedProposalId: fixture.proposalId,
    });

    expect(result).toMatchObject({
        version: 2,
        outcome: "partial",
        failedDiscoveryFamilies: ["regulatory"],
    });
    expect(fetchSpy).toHaveBeenCalledTimes(4);
});

test("persists a partial outcome when paid web discovery is disabled", async () => {
    process.env.SEC_USER_AGENT = "prototype@example.com";
    process.env.EXA_API_KEY = "test-exa-key";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(
            JSON.stringify({
                cik: 1373715,
                filings: {
                    recent: {
                        accessionNumber: ["0001373715-26-000001"],
                        form: ["10-K"],
                        filingDate: ["2026-01-29"],
                        primaryDocument: ["now-20251231.htm"],
                    },
                },
            }),
            { status: 200 },
        ),
    );
    const { t, fixture } = await seedDraft();
    await t.run((ctx) =>
        ctx.db.insert("paidWorkControls", {
            key: "global",
            enabled: false,
            reason: "maintenance",
            updatedAt: 1,
        }),
    );
    const owner = t.withIdentity({
        subject: `${fixture.userId}|rebuild-session`,
    });

    const result = await owner.action(rebuild, {
        runId: fixture.runId,
        corpusRevisionId: fixture.corpusRevisionId,
        expectedProposalId: fixture.proposalId,
    });

    expect(result).toMatchObject({
        version: 2,
        outcome: "partial",
        failedDiscoveryFamilies: [
            "investor_relations",
            "official_product",
            "official_commercial",
            "counter_evidence",
        ],
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    await expect(
        t.run((ctx) =>
            ctx.db
                .query("sourceSelectionProposalRebuilds")
                .withIndex("by_operation_key")
                .unique(),
        ),
    ).resolves.toMatchObject({
        status: "partial",
        failedDiscoveryFamilies: [
            "investor_relations",
            "official_product",
            "official_commercial",
            "counter_evidence",
        ],
    });
});

test("does not translate an unexpected provider-lease invariant failure into a partial outcome", async () => {
    process.env.SEC_USER_AGENT = "prototype@example.com";
    process.env.EXA_API_KEY = "test-exa-key";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(
            JSON.stringify({
                cik: 1373715,
                filings: {
                    recent: {
                        accessionNumber: ["0001373715-26-000001"],
                        form: ["10-K"],
                        filingDate: ["2026-01-29"],
                        primaryDocument: ["now-20251231.htm"],
                    },
                },
            }),
            { status: 200 },
        ),
    );
    const { t, fixture } = await seedDraft();
    await t.run(async (ctx) => {
        for (const updatedAt of [1, 2]) {
            await ctx.db.insert("paidWorkControls", {
                key: "global",
                enabled: true,
                updatedAt,
            });
        }
    });
    const owner = t.withIdentity({
        subject: `${fixture.userId}|rebuild-session`,
    });

    await expect(
        owner.action(rebuild, {
            runId: fixture.runId,
            corpusRevisionId: fixture.corpusRevisionId,
            expectedProposalId: fixture.proposalId,
        }),
    ).rejects.toThrow();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    await expect(
        t.run((ctx) =>
            ctx.db
                .query("sourceSelectionProposalRebuilds")
                .withIndex("by_operation_key")
                .unique(),
        ),
    ).resolves.toMatchObject({ status: "started" });
});

test("allows only one concurrent rebuild to issue provider I/O", async () => {
    process.env.SEC_USER_AGENT = "prototype@example.com";
    delete process.env.EXA_API_KEY;
    let resolveFetch: ((response: Response) => void) | undefined;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
        () =>
            new Promise<Response>((resolve) => {
                resolveFetch = resolve;
            }),
    );
    const { t, fixture } = await seedDraft();
    const owner = t.withIdentity({
        subject: `${fixture.userId}|rebuild-session`,
    });
    const args = {
        runId: fixture.runId,
        corpusRevisionId: fixture.corpusRevisionId,
        expectedProposalId: fixture.proposalId,
    };

    const firstPromise = owner.action(rebuild, args);
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1), {
        timeout: 5_000,
    });
    const concurrent = await owner.action(rebuild, args);

    expect(concurrent).toMatchObject({
        proposalId: fixture.proposalId,
        version: 1,
        outcome: "blocked",
        failedDiscoveryFamilies: [],
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    resolveFetch?.(
        new Response(
            JSON.stringify({
                cik: 1373715,
                filings: {
                    recent: {
                        accessionNumber: ["0001373715-26-000001"],
                        form: ["10-K"],
                        filingDate: ["2026-01-29"],
                        primaryDocument: ["now-20251231.htm"],
                    },
                },
            }),
            { status: 200 },
        ),
    );
    await expect(firstPromise).resolves.toMatchObject({
        version: 2,
        outcome: "partial",
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
});

test("rejects a superseded expected proposal before provider I/O", async () => {
    process.env.SEC_USER_AGENT = "prototype@example.com";
    delete process.env.EXA_API_KEY;
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { t, fixture } = await seedDraft();
    await t.run(async (ctx) => {
        const replacementId = await ctx.db.insert("sourceSelectionProposals", {
            runId: fixture.runId,
            corpusRevisionId: fixture.corpusRevisionId,
            version: 2,
            policyVersion: "source-selection-v2",
            coveragePreset: "balanced",
            recommendedTarget: 24,
            recommendationCeiling: 24,
            publisherRegistryVersion: "source-publishers-v1",
            candidateFingerprint: "replacement",
            status: "ready",
            counts: { recommended: 1, needsAttention: 0, alternative: 0 },
            gaps: [],
            coverageGaps: [],
            createdAt: 3,
        });
        await ctx.db.patch(fixture.corpusRevisionId, {
            sourceSelectionProposalId: replacementId,
        });
    });
    const owner = t.withIdentity({
        subject: `${fixture.userId}|rebuild-session`,
    });

    await expect(
        owner.action(rebuild, {
            runId: fixture.runId,
            corpusRevisionId: fixture.corpusRevisionId,
            expectedProposalId: fixture.proposalId,
        }),
    ).rejects.toThrow("cannot be rebuilt");
    expect(fetchSpy).not.toHaveBeenCalled();
});
