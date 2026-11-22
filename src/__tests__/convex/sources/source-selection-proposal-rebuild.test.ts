import "@convex/sourceSelectionProposalActions";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { SOURCE_SELECTION_POLICY_VERSION } from "@convex/domain/sourceSelectionPolicy";
import schema from "@convex/schema";
import { makeFunctionReference } from "convex/server";
import { convexTest, type TestConvex } from "convex-test";
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
const recoverDiscovery = makeFunctionReference<
    "action",
    {
        runId: Id<"researchRuns">;
        corpusRevisionId: Id<"corpusRevisions">;
        expectedProposalId: Id<"sourceSelectionProposals">;
        requestId: string;
        target:
            | { kind: "failed_discovery" }
            | { kind: "coverage"; role: string };
    },
    {
        outcome: string;
        reason?: string;
        proposalId: Id<"sourceSelectionProposals">;
        failedDiscoveryFamilies: string[];
    }
>("sourceSelectionProposalActions:recoverDiscovery");
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
const claimRebuild = makeFunctionReference<
    "mutation",
    {
        authUserId: Id<"users">;
        runId: Id<"researchRuns">;
        corpusRevisionId: Id<"corpusRevisions">;
        expectedProposalId: Id<"sourceSelectionProposals">;
    },
    {
        shouldExecute: boolean;
        company?: { websiteUrl?: string };
        queries?: Array<{
            category: string;
            includeDomains?: Array<string>;
        }>;
    }
>("sourceSelectionProposals:claimRebuild");

const originalSecUserAgent = process.env.SEC_USER_AGENT;
const originalExaKey = process.env.EXA_API_KEY;

afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    if (originalSecUserAgent === undefined) delete process.env.SEC_USER_AGENT;
    else process.env.SEC_USER_AGENT = originalSecUserAgent;
    if (originalExaKey === undefined) delete process.env.EXA_API_KEY;
    else process.env.EXA_API_KEY = originalExaKey;
});

async function seedDraft(existing?: TestConvex<typeof schema>) {
    const t = existing ?? convexTest(schema, modules);
    if (!existing) rateLimiterTest.register(t);
    const fixture = await t.run(async (ctx) => {
        const userId = await ctx.db.insert("users", { isAnonymous: true });
        const invitationId = await ctx.db.insert("invitations", {
            slotKey: `rebuild-owner:${userId}`,
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
            purpose: "research",
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

test("coverage follows effective source decisions without rewriting the proposal", async () => {
    const { t, fixture } = await seedDraft();
    await t.run(async (ctx) => {
        await ctx.db.patch(fixture.sourceId, {
            origin: "sec",
            canonicalUrl:
                "https://www.sec.gov/Archives/edgar/data/1373715/000137371526000001/now-20251231.htm",
            secForm: "10-K",
            secAccessionNumber: "0001373715-26-000001",
        });
        await ctx.db.patch(fixture.proposalId, {
            policyVersion: SOURCE_SELECTION_POLICY_VERSION,
        });
    });
    const owner = t.withIdentity({
        subject: `${fixture.userId}|coverage-session`,
    });
    const args = {
        runId: fixture.runId,
        corpusRevisionId: fixture.corpusRevisionId,
    };
    const proposal = await owner.mutation(
        api.sourceSelectionProposals.recompute,
        {
            ...args,
            expectedProposalId: fixture.proposalId,
        },
    );
    const before = await owner.query(
        api.sourceSelectionProposals.getCurrent,
        args,
    );
    expect(before?.coverageGaps).not.toContain("regulatory_annual");
    await owner.mutation(api.sources.decide, {
        ...args,
        sourceId: fixture.sourceId,
        decision: "rejected",
        decisionKey: "remove-annual",
    });
    const after = await owner.query(
        api.sourceSelectionProposals.getCurrent,
        args,
    );
    expect(after?.coverageGaps).toContain("regulatory_annual");
    expect(after?.proposalId).toBe(proposal.proposalId);
    await owner.mutation(api.sources.decide, {
        ...args,
        sourceId: fixture.sourceId,
        decision: "accepted",
        decisionKey: "restore-annual",
    });
    expect(
        (await owner.query(api.sourceSelectionProposals.getCurrent, args))
            ?.coverageGaps,
    ).not.toContain("regulatory_annual");
});

async function seedRecoverableDraft(existing?: TestConvex<typeof schema>) {
    const { t, fixture } = await seedDraft(existing);
    const owner = t.withIdentity({
        subject: `${fixture.userId}|recovery-session`,
    });
    await t.run((ctx) =>
        ctx.db.patch(fixture.proposalId, {
            policyVersion: SOURCE_SELECTION_POLICY_VERSION,
        }),
    );
    const current = await owner.mutation(
        api.sourceSelectionProposals.recompute,
        {
            runId: fixture.runId,
            corpusRevisionId: fixture.corpusRevisionId,
            expectedProposalId: fixture.proposalId,
        },
    );
    await t.run((ctx) =>
        ctx.db.patch(current.proposalId, {
            rebuildOutcome: "partial",
            failedDiscoveryFamilies: ["official_product"],
        }),
    );
    return {
        t,
        fixture: { ...fixture, proposalId: current.proposalId },
        owner,
    };
}

test("retries only failed discovery and replays without another external call", async () => {
    process.env.EXA_API_KEY = "fixture-exa-key";
    process.env.SEC_USER_AGENT = "prototype@example.com";
    const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(
            new Response(JSON.stringify({ results: [] }), { status: 200 }),
        );
    const { t, fixture, owner } = await seedRecoverableDraft();
    const args = {
        runId: fixture.runId,
        corpusRevisionId: fixture.corpusRevisionId,
        expectedProposalId: fixture.proposalId,
        requestId: "retry-failed-product",
        target: { kind: "failed_discovery" as const },
    };
    const result = await owner.action(recoverDiscovery, args);
    expect(result).toMatchObject({
        outcome: "complete",
        reason: "no_new_candidates",
        failedDiscoveryFamilies: [],
    });
    expect(
        (await t.run((ctx) => ctx.db.query("runEvents").collect())).map(
            (event) => event.type,
        ),
    ).toEqual(["source_recovery_started", "source_recovery_completed"]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const call = fetchSpy.mock.calls[0];
    if (!call) throw new Error("Expected authorized external request");
    const [url, init] = call;
    expect(url).toBe("https://api.exa.ai/search");
    expect(JSON.parse(String(init?.body))).toMatchObject({
        includeDomains: ["servicenow.com"],
    });
    expect(JSON.parse(String(init?.body))).not.toHaveProperty("contents");
    expect(String(init?.body)).toContain("official product");
    expect(await owner.action(recoverDiscovery, args)).toEqual(result);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(
        await t.run((ctx) => ctx.db.query("providerCalls").collect()),
    ).toHaveLength(1);
    expect(await t.run((ctx) => ctx.db.get(fixture.sourceId))).not.toBeNull();
    expect(
        await t.run((ctx) =>
            ctx.db
                .query("sourceReviewItems")
                .withIndex("by_revision_and_source", (q) =>
                    q
                        .eq("corpusRevisionId", fixture.corpusRevisionId)
                        .eq("sourceId", fixture.sourceId),
                )
                .unique(),
        ),
    ).toMatchObject({ decision: "accepted" });
});

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

test("claims a rebuild with current company domains when the run snapshot is incomplete", async () => {
    const { t, fixture } = await seedDraft();
    await t.run((ctx) =>
        ctx.db.patch(fixture.runId, {
            companySnapshot: {
                cik: "1373715",
                legalName: "ServiceNow, Inc.",
                ticker: "NOW",
                exchange: "NYSE",
            },
        }),
    );

    const claim = await t.mutation(claimRebuild, {
        authUserId: fixture.userId,
        runId: fixture.runId,
        corpusRevisionId: fixture.corpusRevisionId,
        expectedProposalId: fixture.proposalId,
    });

    expect(claim).toMatchObject({
        shouldExecute: true,
        company: { websiteUrl: "https://www.servicenow.com/" },
    });
    expect(claim.queries).toEqual(
        expect.arrayContaining([
            expect.objectContaining({
                category: "official_product",
                includeDomains: ["servicenow.com"],
            }),
            expect.objectContaining({
                category: "official_commercial",
                includeDomains: ["servicenow.com"],
            }),
        ]),
    );
});

test("rejects mismatched snapshot and company CIK before rebuild I/O", async () => {
    process.env.SEC_USER_AGENT = "prototype@example.com";
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { t, fixture } = await seedDraft();
    await t.run(async (ctx) => {
        const run = await ctx.db.get(fixture.runId);
        if (!run?.companyId) {
            throw new Error("Fixture company was not found");
        }
        await ctx.db.patch(fixture.runId, {
            companySnapshot: {
                cik: "1373715",
                legalName: "ServiceNow, Inc.",
                ticker: "NOW",
                exchange: "NYSE",
            },
        });
        await ctx.db.patch(run.companyId, { cik: "1818201" });
    });
    const owner = t.withIdentity({
        subject: `${fixture.userId}|rebuild-mismatch-session`,
    });

    await expect(
        owner.action(rebuild, {
            runId: fixture.runId,
            corpusRevisionId: fixture.corpusRevisionId,
            expectedProposalId: fixture.proposalId,
        }),
    ).rejects.toThrow("company identity is inconsistent");
    expect(fetchSpy).not.toHaveBeenCalled();
    await expect(
        t.run((ctx) =>
            ctx.db.query("sourceSelectionProposalRebuilds").collect(),
        ),
    ).resolves.toHaveLength(0);
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
        .mockRejectedValue(new TypeError("SEC unavailable"));
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

test("targets one coverage role without clearing unrelated discovery failures", async () => {
    process.env.EXA_API_KEY = "fixture-key";
    const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(new Response(JSON.stringify({ results: [] })));
    const { fixture, owner } = await seedRecoverableDraft();
    const result = await owner.action(recoverDiscovery, {
        runId: fixture.runId,
        corpusRevisionId: fixture.corpusRevisionId,
        expectedProposalId: fixture.proposalId,
        requestId: "target-product",
        target: { kind: "coverage", role: "official_product_integration" },
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({
        includeDomains: ["servicenow.com"],
        numResults: 4,
    });
    expect(body).not.toHaveProperty("contents");
    expect(body.query).toContain("API integration documentation");
    expect(result.failedDiscoveryFamilies).toEqual(["official_product"]);
});

test("an expired recovery cannot persist returned candidates or replace the proposal", async () => {
    process.env.SEC_USER_AGENT = "prototype@example.com";
    let release!: (response: Response) => void;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
        () =>
            new Promise<Response>((resolve) => {
                release = resolve;
            }),
    );
    const { t, fixture, owner } = await seedRecoverableDraft();
    const pending = owner.action(recoverDiscovery, {
        runId: fixture.runId,
        corpusRevisionId: fixture.corpusRevisionId,
        expectedProposalId: fixture.proposalId,
        requestId: "expired-annual",
        target: { kind: "coverage", role: "regulatory_annual" },
    });
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    await t.run(async (ctx) => {
        const attempt = (
            await ctx.db.query("sourceSelectionProposalRebuilds").collect()
        )[0];
        if (!attempt) throw new Error("Expected active recovery fixture");
        await ctx.db.patch(attempt._id, { leaseExpiresAt: 0 });
    });
    release(
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
        ),
    );
    await expect(pending).rejects.toThrow("no longer active");
    expect(
        await t.run((ctx) => ctx.db.query("sources").collect()),
    ).toHaveLength(1);
    expect(
        (
            await owner.query(api.sourceSelectionProposals.getCurrent, {
                runId: fixture.runId,
                corpusRevisionId: fixture.corpusRevisionId,
            })
        )?.proposalId,
    ).toBe(fixture.proposalId);
});

test("concurrent recovery targets share one active lease and expose persisted progress", async () => {
    process.env.EXA_API_KEY = "fixture-key";
    let release!: (response: Response) => void;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
        () =>
            new Promise<Response>((resolve) => {
                release = resolve;
            }),
    );
    const { fixture, owner } = await seedRecoverableDraft();
    const args = {
        runId: fixture.runId,
        corpusRevisionId: fixture.corpusRevisionId,
        expectedProposalId: fixture.proposalId,
        requestId: "first",
        target: { kind: "failed_discovery" as const },
    };
    const pending = owner.action(recoverDiscovery, args);
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const projection = await owner.query(
        api.sourceSelectionProposals.getCurrent,
        { runId: fixture.runId, corpusRevisionId: fixture.corpusRevisionId },
    );
    expect(
        await owner.action(recoverDiscovery, {
            ...args,
            requestId: "second",
            target: { kind: "coverage", role: "official_commercial_terms" },
        }),
    ).toMatchObject({ outcome: "blocked", reason: "in_progress" });
    release(new Response(JSON.stringify({ results: [] })));
    await pending;
    expect(projection).toMatchObject({
        recovery: { status: "started", requestId: "first" },
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
});

test.each([
    400, 401, 503,
])("records safe diagnostics and retryability for HTTP %s", async (status) => {
    process.env.EXA_API_KEY = "fixture-key";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
        async () =>
            new Response("provider diagnostic must not be persisted", {
                status,
            }),
    );
    const { t, fixture, owner } = await seedRecoverableDraft();
    const args = {
        runId: fixture.runId,
        corpusRevisionId: fixture.corpusRevisionId,
        expectedProposalId: fixture.proposalId,
        requestId: `http-${status}`,
        target: { kind: "failed_discovery" as const },
    };
    expect(await owner.action(recoverDiscovery, args)).toMatchObject({
        outcome: "blocked",
        reason: status === 503 ? "unavailable" : "request_rejected",
    });
    const calls = await t.run((ctx) => ctx.db.query("providerCalls").collect());
    expect(calls).toHaveLength(status === 503 ? 2 : 1);
    for (const call of calls)
        expect(call).toMatchObject({
            errorCode: `http_${status}`,
            retryable: status === 503,
        });
    expect(JSON.stringify(calls)).not.toContain("provider diagnostic");
    expect(
        await owner.action(recoverDiscovery, {
            ...args,
            requestId: "new-click",
        }),
    ).toMatchObject({ outcome: "blocked", reason: "cooldown" });
    expect(fetchSpy).toHaveBeenCalledTimes(status === 503 ? 2 : 1);
});

test("refreshing a proposal preserves unresolved discovery warnings", async () => {
    const { fixture, owner } = await seedRecoverableDraft();
    await owner.mutation(api.sourceSelectionProposals.recompute, {
        runId: fixture.runId,
        corpusRevisionId: fixture.corpusRevisionId,
        expectedProposalId: fixture.proposalId,
    });
    expect(
        await owner.query(api.sourceSelectionProposals.getCurrent, {
            runId: fixture.runId,
            corpusRevisionId: fixture.corpusRevisionId,
        }),
    ).toMatchObject({
        rebuildOutcome: "partial",
        failedDiscoveryFamilies: ["official_product"],
    });
});

test("recovery authorizes before any external call", async () => {
    process.env.EXA_API_KEY = "fixture-key";
    const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockImplementation(
            async () => new Response(JSON.stringify({ results: [] })),
        );
    const { t, fixture } = await seedRecoverableDraft();
    const foreign = await seedRecoverableDraft(t);
    const ownResult = await foreign.owner.action(recoverDiscovery, {
        runId: foreign.fixture.runId,
        corpusRevisionId: foreign.fixture.corpusRevisionId,
        expectedProposalId: foreign.fixture.proposalId,
        requestId: "own-recovery",
        target: { kind: "failed_discovery" },
    });
    expect(ownResult).toMatchObject({
        outcome: "complete",
        failedDiscoveryFamilies: [],
    });
    expect(fetchSpy).toHaveBeenCalled();
    fetchSpy.mockClear();
    const before = await t.run(async (ctx) => ({
        run: await ctx.db.get(fixture.runId),
        proposals: await ctx.db.query("sourceSelectionProposals").collect(),
        attempts: await ctx.db
            .query("sourceSelectionProposalRebuilds")
            .collect(),
        sources: await ctx.db.query("sources").collect(),
    }));
    const args = {
        runId: fixture.runId,
        corpusRevisionId: fixture.corpusRevisionId,
        expectedProposalId: fixture.proposalId,
        requestId: "unauthorized",
        target: { kind: "failed_discovery" as const },
    };
    await expect(t.action(recoverDiscovery, args)).rejects.toThrow(
        "Not authenticated",
    );
    await expect(foreign.owner.action(recoverDiscovery, args)).rejects.toThrow(
        "Unauthorized",
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(
        await t.run(async (ctx) => ({
            run: await ctx.db.get(fixture.runId),
            proposals: await ctx.db.query("sourceSelectionProposals").collect(),
            attempts: await ctx.db
                .query("sourceSelectionProposalRebuilds")
                .collect(),
            sources: await ctx.db.query("sources").collect(),
        })),
    ).toEqual(before);
});

test("capacity exhaustion blocks recovery before external work", async () => {
    const { fixture, owner } = await seedRecoverableDraft();
    const previous = process.env.SOURCE_CANDIDATE_LIMIT;
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    process.env.SOURCE_CANDIDATE_LIMIT = "1";
    try {
        // Capacity is independently enforced even if the caller has refreshed its proposal.
        const current = await owner.mutation(
            api.sourceSelectionProposals.recompute,
            {
                runId: fixture.runId,
                corpusRevisionId: fixture.corpusRevisionId,
                expectedProposalId: fixture.proposalId,
            },
        );
        expect(
            await owner.action(recoverDiscovery, {
                runId: fixture.runId,
                corpusRevisionId: fixture.corpusRevisionId,
                expectedProposalId: current.proposalId,
                requestId: "capacity",
                target: { kind: "failed_discovery" },
            }),
        ).toMatchObject({ outcome: "blocked", reason: "capacity_reached" });
        expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
        if (previous === undefined) delete process.env.SOURCE_CANDIDATE_LIMIT;
        else process.env.SOURCE_CANDIDATE_LIMIT = previous;
    }
});

test("manual inclusion does not manufacture automatic coverage", async () => {
    const { t, fixture, owner } = await seedRecoverableDraft();
    await t.run((ctx) =>
        ctx.db.patch(fixture.sourceId, { origin: "analyst_url" }),
    );
    await owner.mutation(api.sourceSelectionProposals.recompute, {
        runId: fixture.runId,
        corpusRevisionId: fixture.corpusRevisionId,
        expectedProposalId: fixture.proposalId,
    });
    const current = await owner.query(api.sourceSelectionProposals.getCurrent, {
        runId: fixture.runId,
        corpusRevisionId: fixture.corpusRevisionId,
    });
    expect(current?.effectiveIncludedCount).toBe(1);
    expect(current?.coverageGaps).toContain("official_product_platform");
});

test("a source search aborts each timed out request before starting its next attempt", async () => {
    process.env.EXA_API_KEY = "fixture-key";
    const { fixture, owner } = await seedRecoverableDraft();
    await import("@convex/sourceSelectionProposalActions");
    const signals: AbortSignal[] = [];
    let active = 0;
    let maximumActive = 0;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
        (_input, init) =>
            new Promise<Response>((_resolve, reject) => {
                const signal = init?.signal as AbortSignal;
                signals.push(signal);
                active += 1;
                maximumActive = Math.max(maximumActive, active);
                signal.addEventListener(
                    "abort",
                    () => {
                        active -= 1;
                        reject(
                            new DOMException("Request aborted", "AbortError"),
                        );
                    },
                    { once: true },
                );
            }),
    );
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const pending = owner.action(recoverDiscovery, {
        runId: fixture.runId,
        corpusRevisionId: fixture.corpusRevisionId,
        expectedProposalId: fixture.proposalId,
        requestId: "timeout",
        target: { kind: "failed_discovery" },
    });
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(10_001);
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
    await vi.advanceTimersByTimeAsync(10_001);
    expect(await pending).toMatchObject({ outcome: "blocked" });
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    expect(maximumActive).toBe(1);
    expect(active).toBe(0);
});

test("approval cannot race an active discovery recovery", async () => {
    process.env.EXA_API_KEY = "fixture-key";
    let release!: (response: Response) => void;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
        () =>
            new Promise<Response>((resolve) => {
                release = resolve;
            }),
    );
    const { t, fixture, owner } = await seedRecoverableDraft();
    await t.run((ctx) =>
        ctx.db.patch(fixture.runId, { workflowId: "fixture-workflow" }),
    );
    const pending = owner.action(recoverDiscovery, {
        runId: fixture.runId,
        corpusRevisionId: fixture.corpusRevisionId,
        expectedProposalId: fixture.proposalId,
        requestId: "approval-race",
        target: { kind: "failed_discovery" },
    });
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const approval = owner.mutation(approveProposedCorpus, {
        runId: fixture.runId,
        corpusRevisionId: fixture.corpusRevisionId,
        proposalId: fixture.proposalId,
        proposalVersion: 2,
        decisionKey: "race-approval",
    });
    await expect(approval).rejects.toThrow("Source discovery is still active");
    release(new Response(JSON.stringify({ results: [] })));
    await pending;
    expect(
        (await t.run((ctx) => ctx.db.get(fixture.corpusRevisionId)))?.status,
    ).toBe("draft");
});

test.each([
    "blocked",
    "started",
] as const)("an expired %s recovery request never opens another paid attempt on replay", async (status) => {
    process.env.EXA_API_KEY = "fixture-key";
    const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockImplementation(
            async () => new Response("unavailable", { status: 401 }),
        );
    const { t, fixture, owner } = await seedRecoverableDraft();
    const args = {
        runId: fixture.runId,
        corpusRevisionId: fixture.corpusRevisionId,
        expectedProposalId: fixture.proposalId,
        requestId: "terminal-blocked",
        target: { kind: "failed_discovery" as const },
    };
    const first = await owner.action(recoverDiscovery, args);
    await t.run(async (ctx) => {
        const row = await ctx.db
            .query("sourceSelectionProposalRebuilds")
            .first();
        if (row) await ctx.db.patch(row._id, { leaseExpiresAt: 0, status });
    });
    expect(await owner.action(recoverDiscovery, args)).toEqual({
        ...first,
        reason: status === "started" ? "unavailable" : first.reason,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
});
