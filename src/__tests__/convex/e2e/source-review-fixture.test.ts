import { api, internal } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
    extractPassagesFromNormalizedText,
    sha256Hex,
} from "@convex/domain/sourcePassages";
import { SOURCE_RETRIEVAL_VERSION } from "@convex/domain/sourceRetrievalPolicy";
import "@convex/evidenceActions";
import "@convex/e2eFixtures";
import "@convex/evidenceWorkflow";
import "@convex/claimGeneration";
import "@convex/evidenceExecution";
import "@convex/sourceSelectionProposalActions";
import { lookup } from "node:dns/promises";
import schema from "@convex/schema";
import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import rateLimiterTest from "../integrations/rate-limiter-test-register.js";
import workflowTest from "../workflows/workflow-test-register.js";

const modules = import.meta.glob("/convex/**/*.ts");
const originalE2eFixturesEnabled = process.env.E2E_FIXTURES_ENABLED;

vi.mock("node:dns/promises", () => {
    const lookup = vi
        .fn()
        .mockRejectedValue(new Error("Fixture must not resolve DNS"));
    return { lookup, default: { lookup } };
});

const seedSourceReviewScenario = internal.e2eFixtures.seedSourceReviewScenario;

const inspectSourceReviewScenario = makeFunctionReference<
    "query",
    { runId: Id<"researchRuns">; fixtureKey: string },
    {
        lifecycleState: string;
        executionStatus: string;
        revisionStatus: string;
        decisions: Array<{
            title: string;
            decision: "accepted" | "pending" | "rejected";
        }>;
        providerCallCount: number;
    }
>("e2eFixtures:inspectSourceReviewScenario");

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    if (originalE2eFixturesEnabled === undefined) {
        delete process.env.E2E_FIXTURES_ENABLED;
    } else {
        process.env.E2E_FIXTURES_ENABLED = originalE2eFixturesEnabled;
    }
});

async function createAdmittedVisitor(t: ReturnType<typeof convexTest>) {
    return t.run(async (ctx) => {
        const userId = await ctx.db.insert("users", { isAnonymous: true });
        const invitationId = await ctx.db.insert("invitations", {
            slotKey: "e2e-analyst",
            role: "analyst",
            codeDigest: "e2e-digest",
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
        await ctx.db.patch(invitationId, {
            claimedByVisitorId: visitorId,
            claimedAt: 1,
        });
        return { visitorId, userId };
    });
}

test("the sixty-source review fixture is bounded, idempotent, local and owned", async () => {
    vi.useFakeTimers();
    vi.stubEnv("E2E_FIXTURES_ENABLED", "true");
    vi.stubEnv("CONVEX_CLOUD_URL", "http://127.0.0.1:3210");
    const t = convexTest(schema, modules);
    workflowTest.register(t);
    const { userId } = await createAdmittedVisitor(t);
    const seeded = await t.action(
        internal.e2eFixtures.seedInspectedSourceReviewScenario,
        {
            slotKey: "e2e-analyst",
            fixtureKey: "performance-projection",
            comparisonOutcome: "no_conflict_observed",
        },
    );
    const args = {
        slotKey: "e2e-analyst",
        fixtureKey: "performance-projection",
        runId: seeded.runId,
    };
    await expect(
        t.mutation(internal.e2eFixtures.scaleSourceReviewFixture, {
            ...args,
            slotKey: "foreign",
        }),
    ).rejects.toThrow("Editable owned E2E fixture required");
    const result = await t.mutation(
        internal.e2eFixtures.scaleSourceReviewFixture,
        args,
    );
    expect(result.sourceCount).toBe(60);
    await expect(
        t.mutation(internal.e2eFixtures.scaleSourceReviewFixture, args),
    ).resolves.toEqual(result);
    expect(
        await t
            .withIdentity({ subject: userId })
            .query(api.sourceSelectionProposals.getCurrent, {
                runId: seeded.runId,
                corpusRevisionId: seeded.corpusRevisionId,
            }),
    ).toMatchObject({
        revisionStatus: "draft",
        preparation: { assessed: 58, total: 60 },
    });
    expect(await t.run((ctx) => ctx.db.query("providerCalls").take(1))).toEqual(
        [],
    );
    vi.stubEnv("CONVEX_CLOUD_URL", "https://example.com");
    await expect(
        t.mutation(internal.e2eFixtures.scaleSourceReviewFixture, args),
    ).rejects.toThrow("Local E2E fixtures are disabled");
    vi.stubEnv("CONVEX_CLOUD_URL", "http://127.0.0.1:3210");
    vi.stubEnv("E2E_FIXTURES_ENABLED", "false");
    await expect(
        t.mutation(internal.e2eFixtures.scaleSourceReviewFixture, args),
    ).rejects.toThrow("Local E2E fixtures are disabled");
});

test("seeds a historical explanation gap for explicit draft refresh without provider work", async () => {
    vi.useFakeTimers();
    vi.stubEnv("E2E_FIXTURES_ENABLED", "true");
    vi.stubEnv("CONVEX_CLOUD_URL", "http://127.0.0.1:3210");
    const t = convexTest(schema, modules);
    workflowTest.register(t);
    const { userId } = await createAdmittedVisitor(t);
    const seeded = await t.mutation(seedSourceReviewScenario, {
        slotKey: "e2e-analyst",
        fixtureKey: "legacy-explanation",
        legacySelectionReasons: true,
    });
    const owner = t.withIdentity({
        subject: `${userId}|legacy-explanation-session`,
    });
    const args = {
        runId: seeded.runId,
        corpusRevisionId: seeded.corpusRevisionId,
    };
    await expect(
        owner.query(api.sourceSelectionProposals.getCurrent, args),
    ).resolves.toMatchObject({
        effectiveStatus: "ready",
        selectionExplanationRefreshAvailable: true,
    });
    const refreshed = await owner.mutation(
        api.sourceSelectionProposals.recompute,
        { ...args, expectedProposalId: seeded.proposalId },
    );
    expect(refreshed.version).toBe(seeded.proposalVersion + 1);
    await expect(
        owner.query(api.sourceSelectionProposals.getCurrent, args),
    ).resolves.toMatchObject({ selectionExplanationRefreshAvailable: false });
    await expect(
        t.query(inspectSourceReviewScenario, {
            runId: seeded.runId,
            fixtureKey: "legacy-explanation",
        }),
    ).resolves.toMatchObject({ providerCallCount: 0 });
});

test("keeps the retrieval fixture compact while preserving evidence beyond the initial 512 passages", async () => {
    vi.useFakeTimers();
    vi.stubEnv("E2E_FIXTURES_ENABLED", "true");
    vi.stubEnv("CONVEX_CLOUD_URL", "http://127.0.0.1:3210");
    const fetchSpy = vi
        .fn()
        .mockRejectedValue(new Error("Fixture must not fetch"));
    vi.stubGlobal("fetch", fetchSpy);
    const t = convexTest(schema, modules);
    workflowTest.register(t);
    await createAdmittedVisitor(t);
    const runId = await t.action(internal.retrievalEvaluation.seedReview, {
        slotKey: "e2e-analyst",
        fixtureKey: "retrieval-review-compact",
    });
    const saved = await t.run(async (ctx) => {
        const run = await ctx.db.get(runId);
        const revision = run?.activeCorpusRevisionId
            ? await ctx.db.get(run.activeCorpusRevisionId)
            : null;
        if (!revision?.sourceSelectionProposalId)
            throw new Error("Missing fixture proposal");
        const proposalId = revision.sourceSelectionProposalId;
        const items = await ctx.db
            .query("sourceSelectionProposalItems")
            .withIndex("by_proposal_and_rank_and_source", (q) =>
                q.eq("proposalId", proposalId),
            )
            .take(4);
        const item = items.find(
            (i) => i.sourceCaptureId && i.qualificationTaskId,
        );
        const capture = item?.sourceCaptureId
            ? await ctx.db.get(item.sourceCaptureId)
            : null;
        const task = item?.qualificationTaskId
            ? await ctx.db.get(item.qualificationTaskId)
            : null;
        const blob = capture?.storageId
            ? await ctx.storage.get(capture.storageId)
            : null;
        if (
            !capture?.contentHash ||
            !blob ||
            task?.output.kind !== "source_qualification"
        )
            throw new Error("Missing prepared fixture");
        return {
            text: await blob.text(),
            bytes: blob.size,
            capture,
            contentHash: capture.contentHash,
            qualification: task.output,
        };
    });
    expect(saved.bytes).toBeLessThan(1.2 * 1024 * 1024);
    expect(sha256Hex(saved.text)).toBe(saved.capture.contentHash);
    const input = {
        text: saved.text,
        canonicalUrl: saved.capture.requestedUrl,
        sourceVersionHash: saved.contentHash,
        preparationVersion: SOURCE_RETRIEVAL_VERSION,
    } satisfies Parameters<typeof extractPassagesFromNormalizedText>[0];
    const searchable = extractPassagesFromNormalizedText(input);
    const initial = extractPassagesFromNormalizedText({
        ...input,
        maxPassages: 512,
        requiredSpans: saved.qualification.selectedPassages,
    });
    expect(searchable.length).toBeGreaterThan(512);
    expect(initial).toHaveLength(512);
    expect(
        searchable.some((p) =>
            p.exactQuotation.includes("Illustrative background paragraph 550."),
        ),
    ).toBe(true);
    expect(
        initial.some((p) =>
            p.exactQuotation.includes("Illustrative background paragraph 550."),
        ),
    ).toBe(false);
    for (const reference of saved.qualification.selectedPassages) {
        expect(
            saved.text.slice(reference.startOffset, reference.endOffset),
        ).toBe(
            "The author argues that agents could change the economics of workflow software at Reactive Systems Test Company. This is illustrative material for interface verification.",
        );
        expect(
            initial.some(
                (p) =>
                    p.locator.startOffset <= reference.startOffset &&
                    p.locator.endOffset >= reference.endOffset,
            ),
        ).toBe(true);
    }
    expect(saved.qualification.retrieval?.omittedCandidateCount).toBe(600);
    expect(fetchSpy).not.toHaveBeenCalled();
});

test("recognizes retained late evidence by candidate order rather than document size", async () => {
    vi.useFakeTimers();
    vi.stubEnv("E2E_FIXTURES_ENABLED", "true");
    vi.stubEnv("CONVEX_CLOUD_URL", "http://127.0.0.1:3210");
    const t = convexTest(schema, modules);
    workflowTest.register(t);
    const { visitorId } = await createAdmittedVisitor(t);
    const seeded = await t.mutation(seedSourceReviewScenario, {
        slotKey: "e2e-analyst",
        fixtureKey: "retrieval-review-ordinal-inspection",
    });
    const quotation = "The author argues that operational context matters.";
    const text = [
        ...Array.from(
            { length: 513 },
            (_, i) => `# Section ${i}\n\nContext ${i}.`,
        ),
        "# Late evidence",
        quotation,
    ].join("\n\n");
    const contentHash = sha256Hex(text);
    const passage = extractPassagesFromNormalizedText({
        text,
        canonicalUrl: "https://fixture.example/late-evidence",
        sourceVersionHash: contentHash,
        preparationVersion: SOURCE_RETRIEVAL_VERSION,
    }).find((p) => p.exactQuotation === quotation);
    if (!passage) throw new Error("Missing late passage");
    expect(passage.order).toBeGreaterThanOrEqual(512);
    expect(passage.locator.startOffset).toBeLessThan(2000000);
    const sourceId = seeded.sourceIds[0];
    if (!sourceId) throw new Error("Missing fixture source");
    await t.run(async (ctx) => {
        const acceptedDecisionId = await ctx.db.insert("sourceDecisions", {
            runId: seeded.runId,
            corpusRevisionId: seeded.corpusRevisionId,
            sourceId,
            decision: "accepted",
            decisionKey: "late-inspection",
            reviewerVisitorId: visitorId,
            occurredAt: 1,
        });
        const sourceVersionId = await ctx.db.insert("sourceVersions", {
            runId: seeded.runId,
            corpusRevisionId: seeded.corpusRevisionId,
            sourceId,
            acceptedDecisionId,
            contentHash,
            normalizerVersion: "fixture-v1",
            storageId: await ctx.storage.store(new Blob([text])),
            mediaType: "text/plain",
            byteCount: new TextEncoder().encode(text).length,
            canonicalUrl: passage.locator.canonicalUrl,
            retrievalVersion: "fixture-v1",
            executionGeneration: 1,
            createdAt: 1,
        });
        await ctx.db.insert("sourcePassages", {
            ...passage,
            sourceVersionId,
            passageKey: "fixture:late-inspection",
            createdAt: 1,
        });
    });
    expect(
        await t.query(internal.retrievalEvaluation.inspectReview, {
            runId: seeded.runId,
        }),
    ).toMatchObject({
        lateEvidence: true,
        versionCount: 1,
        passageCount: 1,
    });
});

test("seeds an explicitly illustrative inspected source for the admitted owner's review without provider I/O", async () => {
    vi.useFakeTimers();
    vi.stubEnv("E2E_FIXTURES_ENABLED", "true");
    const fetchSpy = vi
        .fn()
        .mockRejectedValue(new Error("Fixture must not fetch"));
    vi.stubGlobal("fetch", fetchSpy);
    const t = convexTest(schema, modules);
    workflowTest.register(t);
    const { userId } = await createAdmittedVisitor(t);
    const seeded = await t.action(
        internal.e2eFixtures.seedInspectedSourceReviewScenario,
        {
            slotKey: "e2e-analyst",
            fixtureKey: "illustrative-reading",
        },
    );
    const selected = await t
        .withIdentity({ subject: userId })
        .query(api.sources.getReviewSource, {
            runId: seeded.runId,
            corpusRevisionId: seeded.corpusRevisionId,
            sourceId: seeded.sourceIds[0] as Id<"sources">,
        });
    expect(selected).toMatchObject({
        qualificationExecutionMode: "showcase",
        qualificationStatus: "available",
        inspectionStatus: "partial",
        qualification: {
            companyMatch: "subject",
            findings: [{ kind: "attributed_argument" }],
        },
    });
    expect(
        await t.action(internal.e2eFixtures.seedInspectedSourceReviewScenario, {
            slotKey: "e2e-analyst",
            fixtureKey: "illustrative-reading",
        }),
    ).toEqual(seeded);
    const artifacts = await t.run(async (ctx) => ({
        captures: await ctx.db.query("sourceCaptures").take(4),
        tasks: await ctx.db.query("aiTaskResults").take(4),
        versions: await ctx.db.query("sourceVersions").take(1),
        claims: await ctx.db.query("claims").take(1),
    }));
    expect(artifacts.captures).toHaveLength(1);
    expect(artifacts.tasks).toHaveLength(1);
    expect(artifacts.versions).toHaveLength(0);
    expect(artifacts.claims).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(lookup).not.toHaveBeenCalled();
});

test("rejects source review fixtures unless E2E mode is enabled", async () => {
    process.env.E2E_FIXTURES_ENABLED = "true";
    const t = convexTest(schema, modules);
    workflowTest.register(t);
    await createAdmittedVisitor(t);

    const seeded = await t.mutation(seedSourceReviewScenario, {
        slotKey: "e2e-analyst",
        fixtureKey: "disabled",
    });
    delete process.env.E2E_FIXTURES_ENABLED;

    await expect(
        t.mutation(seedSourceReviewScenario, {
            slotKey: "e2e-analyst",
            fixtureKey: "disabled",
        }),
    ).rejects.toThrow("E2E fixtures are disabled");
    await expect(
        t.query(inspectSourceReviewScenario, {
            runId: seeded.runId,
            fixtureKey: "disabled",
        }),
    ).rejects.toThrow("E2E fixtures are disabled");
});

test.each([
    "no_conflict_observed",
    "possible_conflict",
] as const)("shows an illustrative %s with exact primary context and independent material", async (comparisonOutcome) => {
    vi.useFakeTimers();
    vi.stubEnv("E2E_FIXTURES_ENABLED", "true");
    const request = vi
        .fn()
        .mockRejectedValue(new Error("Fixture must not fetch"));
    vi.stubGlobal("fetch", request);
    const t = convexTest(schema, modules);
    workflowTest.register(t);
    const { userId } = await createAdmittedVisitor(t);
    const input = {
        slotKey: "e2e-analyst",
        fixtureKey: `illustrative-comparison-${comparisonOutcome}`,
        comparisonOutcome,
    };
    const seeded = await t.action(
        internal.e2eFixtures.seedInspectedSourceReviewScenario,
        input,
    );
    const source = await t
        .withIdentity({ subject: userId })
        .query(api.sources.getReviewSource, {
            runId: seeded.runId,
            corpusRevisionId: seeded.corpusRevisionId,
            sourceId: seeded.sourceIds[0] as Id<"sources">,
        });
    expect(source).toMatchObject({
        qualificationExecutionMode: "showcase",
        qualification: {
            findings: [
                {
                    comparisonOutcome,
                    usage:
                        comparisonOutcome === "possible_conflict"
                            ? "verification_required"
                            : "attributed_argument_only",
                    comparisonDetails: {
                        primaryPassages: [
                            {
                                title: "Illustrative primary company report",
                                canonicalUrl:
                                    "https://example.com/e2e/product-architecture",
                                quotation:
                                    comparisonOutcome === "possible_conflict"
                                        ? "Reactive Systems Test Company reports outstanding borrowing. This is illustrative evidence for interface verification."
                                        : "Reactive Systems Test Company reports no outstanding borrowing. This is illustrative evidence for interface verification.",
                            },
                        ],
                    },
                },
                {
                    comparisonOutcome: "no_conflict_observed",
                    usage: "attributed_argument_only",
                },
            ],
        },
    });
    expect(
        await t.action(
            internal.e2eFixtures.seedInspectedSourceReviewScenario,
            input,
        ),
    ).toEqual(seeded);
    const changed = {
        ...input,
        comparisonOutcome:
            comparisonOutcome === "possible_conflict"
                ? ("no_conflict_observed" as const)
                : ("possible_conflict" as const),
    };
    await expect(
        t.action(
            internal.e2eFixtures.seedInspectedSourceReviewScenario,
            changed,
        ),
    ).rejects.toThrow("E2E reading scenario replay mismatch");
    const state = await t.run(async (ctx) => ({
        captures: await ctx.db.query("sourceCaptures").take(5),
        tasks: await ctx.db.query("aiTaskResults").take(5),
        providerCalls: await ctx.db.query("providerCalls").take(1),
        versions: await ctx.db.query("sourceVersions").take(1),
        claims: await ctx.db.query("claims").take(1),
    }));
    expect(state.captures).toHaveLength(2);
    expect(
        state.tasks.filter((task) => task.taskType === "source_comparison"),
    ).toMatchObject([{ executionMode: "showcase" }]);
    expect(state.providerCalls).toEqual([]);
    expect(state.versions).toEqual([]);
    expect(state.claims).toEqual([]);
    expect(request).not.toHaveBeenCalled();
    expect(lookup).not.toHaveBeenCalled();
});

test("source approval starts real extraction with explicit fixture failures and no provider I/O", async () => {
    vi.useFakeTimers();
    vi.stubEnv("E2E_FIXTURES_ENABLED", "true");
    vi.stubEnv("EXA_API_KEY", "");
    const fetchSpy = vi
        .fn()
        .mockRejectedValue(new Error("Fixture must not fetch"));
    vi.stubGlobal("fetch", fetchSpy);
    const t = convexTest(schema, modules);
    workflowTest.register(t);
    rateLimiterTest.register(t);
    const { userId } = await createAdmittedVisitor(t);
    const seeded = await t.mutation(seedSourceReviewScenario, {
        slotKey: "e2e-analyst",
        fixtureKey: "automatic-evidence-continuation",
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    await t
        .withIdentity({ subject: `${userId}|fixture-session` })
        .mutation(api.sourceSelectionProposals.approveProposedCorpus, {
            runId: seeded.runId,
            corpusRevisionId: seeded.corpusRevisionId,
            proposalId: seeded.proposalId,
            proposalVersion: seeded.proposalVersion,
            decisionKey: "approve-fixture-once",
        });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const result = await t.query(inspectSourceReviewScenario, {
        runId: seeded.runId,
        fixtureKey: "automatic-evidence-continuation",
    });
    expect(result).toMatchObject({
        lifecycleState: "extracting_evidence",
        executionStatus: "failed",
        revisionStatus: "approved",
        providerCallCount: 0,
    });
    expect(lookup).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    await t.run(async (ctx) => {
        const run = await ctx.db.get(seeded.runId);
        expect(run).toMatchObject({
            executionGeneration: 3,
            workflowVersion: 2,
        });
        const frozen = await ctx.db
            .query("evidenceSourceStatuses")
            .withIndex("by_run_and_execution_generation", (q) =>
                q.eq("runId", seeded.runId).eq("executionGeneration", 3),
            )
            .take(4);
        expect(frozen).toHaveLength(3);
        expect(
            frozen.every(
                (row) =>
                    row.status === "failed" &&
                    row.failureReason === "e2e_fixture_acquisition_unavailable",
            ),
        ).toBe(true);
        expect(await ctx.db.query("sourceVersions").take(1)).toEqual([]);
    });
});

test("seeds an owned source review checkpoint through production projections", async () => {
    process.env.E2E_FIXTURES_ENABLED = "true";
    const t = convexTest(schema, modules);
    workflowTest.register(t);
    const { visitorId } = await createAdmittedVisitor(t);

    await t.run(async (ctx) => {
        const companyId = await ctx.db.insert("companies", {
            cik: "e2e-noise",
            legalName: "E2E Noise Company",
            ticker: "NOISE",
            exchange: "NASDAQ",
            canonicalizedAt: 1,
        });
        for (let index = 0; index < 101; index += 1) {
            await ctx.db.insert("researchRuns", {
                ownerVisitorId: visitorId,
                reservationKey: `e2e:noise-${index}`,
                reservationStatus: "consumed",
                companyId,
                companySnapshot: {
                    cik: "e2e-noise",
                    legalName: "E2E Noise Company",
                    ticker: "NOISE",
                    exchange: "NASDAQ",
                },
                coveragePreset: "balanced",
                lifecycleState: "draft",
                executionStatus: "idle",
                executionGeneration: 1,
                nextEventSequence: 1,
                workflowVersion: 1,
                createdAt: index + 1,
                updatedAt: index + 1,
            });
        }
    });

    const seeded = await t.mutation(seedSourceReviewScenario, {
        slotKey: "e2e-analyst",
        fixtureKey: "source-review-reactivity",
    });

    expect(seeded.sourceIds).toHaveLength(3);
    const snapshot = await t.run(async (ctx) => {
        const run = await ctx.db.get(seeded.runId);
        const revision = await ctx.db.get(seeded.corpusRevisionId);
        const proposal = await ctx.db.get(seeded.proposalId);
        const proposalItems = await ctx.db
            .query("sourceSelectionProposalItems")
            .withIndex("by_proposal_and_rank_and_source", (query) =>
                query.eq("proposalId", seeded.proposalId),
            )
            .collect();
        const reviewItems = await ctx.db
            .query("sourceReviewItems")
            .withIndex("by_revision_and_queue", (query) =>
                query.eq("corpusRevisionId", seeded.corpusRevisionId),
            )
            .collect();
        return { run, revision, proposal, proposalItems, reviewItems };
    });

    expect(snapshot.run).toMatchObject({
        ownerVisitorId: visitorId,
        reservationKey: "e2e:source-review-reactivity",
        lifecycleState: "awaiting_source_review",
        executionStatus: "paused",
        pauseReason: "source_review",
        activeCorpusRevisionId: seeded.corpusRevisionId,
        workflowId: expect.any(String),
    });
    expect(snapshot.revision).toMatchObject({
        status: "draft",
        sourceSelectionProposalId: seeded.proposalId,
    });
    expect(snapshot.proposal).toMatchObject({
        status: "ready",
        version: seeded.proposalVersion,
        counts: { recommended: 3, needsAttention: 0, alternative: 0 },
    });
    expect(snapshot.proposalItems).toHaveLength(3);
    expect(snapshot.reviewItems).toHaveLength(3);
    expect(snapshot.reviewItems.map(({ decision }) => decision)).toEqual([
        "pending",
        "pending",
        "pending",
    ]);

    await expect(
        t.query(inspectSourceReviewScenario, {
            runId: seeded.runId,
            fixtureKey: "source-review-reactivity",
        }),
    ).resolves.toEqual({
        preparationEnabled: false,
        lifecycleState: "awaiting_source_review",
        executionStatus: "paused",
        revisionStatus: "draft",
        decisions: [
            { title: "Annual report", decision: "pending" },
            {
                title: "Product architecture overview",
                decision: "pending",
            },
            {
                title: "Reactive Systems Test Company analysis",
                decision: "pending",
            },
        ],
        providerCallCount: 0,
    });
});

test("source recovery fixture exercises capacity and reactive coverage without provider I/O", async () => {
    process.env.E2E_FIXTURES_ENABLED = "true";
    vi.stubEnv("SOURCE_CANDIDATE_LIMIT", "3");
    const t = convexTest(schema, modules);
    workflowTest.register(t);
    rateLimiterTest.register(t);
    const { userId } = await createAdmittedVisitor(t);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const seeded = await t.mutation(seedSourceReviewScenario, {
        slotKey: "e2e-analyst",
        fixtureKey: "recovery-capacity",
        recoveryScenario: true,
    });
    expect(seeded.sourceIds).toHaveLength(3);
    const owner = t.withIdentity({ subject: `${userId}|fixture-session` });
    const args = {
        runId: seeded.runId,
        corpusRevisionId: seeded.corpusRevisionId,
    };
    const current = await owner.query(
        api.sourceSelectionProposals.getCurrent,
        args,
    );
    expect(current).toMatchObject({
        rebuildOutcome: "partial",
        failedDiscoveryFamilies: ["official_product"],
    });
    expect(current?.coverageGaps).not.toContain("official_product_platform");
    expect(
        await owner.action(
            api.sourceSelectionProposalActions.recoverDiscovery,
            {
                ...args,
                expectedProposalId: seeded.proposalId,
                requestId: "capacity-fixture",
                target: { kind: "failed_discovery" },
            },
        ),
    ).toMatchObject({ reason: "capacity_reached" });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(
        (
            await t.query(inspectSourceReviewScenario, {
                runId: seeded.runId,
                fixtureKey: "recovery-capacity",
            })
        ).providerCallCount,
    ).toBe(0);
});

test("approving an illustrative inspected corpus materializes the same captured bytes through the real workflow without provider I/O", async () => {
    vi.useFakeTimers();
    vi.stubEnv("E2E_FIXTURES_ENABLED", "true");
    vi.stubEnv("EXA_API_KEY", "");
    const request = vi
        .fn()
        .mockRejectedValue(new Error("Fixture must not fetch"));
    vi.stubGlobal("fetch", request);
    const t = convexTest(schema, modules);
    workflowTest.register(t);
    rateLimiterTest.register(t);
    const { userId } = await createAdmittedVisitor(t);
    const seeded = await t.action(
        internal.e2eFixtures.seedInspectedSourceReviewScenario,
        {
            slotKey: "e2e-analyst",
            fixtureKey: "inspected-approval-materialization",
        },
    );
    const sourceId = seeded.sourceIds[0];
    if (!sourceId) throw new Error("Missing inspected source");
    const owned = t.withIdentity({ subject: userId });
    await owned.mutation(api.sources.decide, {
        runId: seeded.runId,
        corpusRevisionId: seeded.corpusRevisionId,
        sourceId,
        decision: "accepted",
        decisionKey: "include-inspected-source",
    });
    expect(
        await t.run((ctx) => ctx.db.query("sourceVersions").take(1)),
    ).toEqual([]);
    const approval = {
        runId: seeded.runId,
        corpusRevisionId: seeded.corpusRevisionId,
        proposalId: seeded.proposalId,
        proposalVersion: seeded.proposalVersion,
        decisionKey: "approve-inspected-corpus",
    };
    await owned.mutation(
        api.sourceSelectionProposals.approveProposedCorpus,
        approval,
    );
    for (let tick = 0; tick < 100; tick += 1) {
        await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(100));
        const run = await t.run((ctx) => ctx.db.get(seeded.runId));
        if (
            run?.lifecycleState === "extracting_evidence" &&
            run.executionStatus !== "running" &&
            !run.workflowId
        )
            break;
    }
    const result = await t.run(async (ctx) => ({
        run: await ctx.db.get(seeded.runId),
        captures: await ctx.db.query("sourceCaptures").take(2),
        versions: await ctx.db.query("sourceVersions").take(2),
        passages: await ctx.db.query("sourcePassages").take(10),
        calls: await ctx.db.query("providerCalls").take(1),
        claims: await ctx.db.query("claims").take(1),
    }));
    expect(result.versions).toHaveLength(1);
    expect(result.versions[0]).toMatchObject({
        sourceId,
        storageId: result.captures[0]?.storageId,
        contentHash: result.captures[0]?.contentHash,
    });
    expect(
        await t.query(internal.e2eFixtures.inspectSourceReviewScenario, {
            runId: seeded.runId,
            fixtureKey: "inspected-approval-materialization",
        }),
    ).toMatchObject({
        sourceReading: {
            contentHash: result.captures[0]?.contentHash,
            storageId: result.captures[0]?.storageId,
            materializedVersion: {
                sourceVersionId: result.versions[0]?._id,
                contentHash: result.captures[0]?.contentHash,
                storageId: result.captures[0]?.storageId,
                passageCount: result.passages.length,
            },
        },
    });
    expect(result.passages.length).toBeGreaterThan(0);
    expect(result.run).toMatchObject({
        executionStatus: "paused",
        pauseReason: "claim_generation_unavailable",
    });
    expect(result.calls).toEqual([]);
    expect(result.claims).toEqual([]);
    expect(
        await owned.mutation(
            api.sourceSelectionProposals.approveProposedCorpus,
            approval,
        ),
    ).toEqual({ accepted: false });
    expect(
        await t.run((ctx) => ctx.db.query("sourceVersions").take(2)),
    ).toHaveLength(1);
    expect(request).not.toHaveBeenCalled();
    expect(lookup).not.toHaveBeenCalled();
});

test("seeds distinct recorded companies and supplied sources without replacing them by the generic fixture", async () => {
    vi.useFakeTimers();
    vi.stubEnv("E2E_FIXTURES_ENABLED", "true");
    vi.stubEnv("CONVEX_CLOUD_URL", "http://127.0.0.1:3210");
    const t = convexTest(schema, modules);
    workflowTest.register(t);
    const { userId } = await createAdmittedVisitor(t);
    const seeded = await t.mutation(seedSourceReviewScenario, {
        slotKey: "e2e-analyst",
        fixtureKey: "recorded-terms",
        recordedScenario: {
            companyName: "Adobe — recorded review",
            companyCik: "796343",
            ticker: "ADBE",
            websiteUrl: "https://www.adobe.com/",
            researchAngle: "Scope of the supplied agreement",
            sources: [
                {
                    canonicalUrl: "https://www.adobe.com/legal/terms.html",
                    title: "Recorded terms",
                    origin: "analyst_url",
                    category: "analyst_supplied",
                },
                {
                    canonicalUrl:
                        "https://www.sec.gov/Archives/edgar/data/796343/annual.htm",
                    title: "Recorded annual",
                    origin: "sec",
                    category: "sec_annual",
                    secForm: "10-K",
                },
            ],
        },
    });
    expect(seeded.sourceIds).toHaveLength(2);
    expect(
        await t.run((ctx) =>
            ctx.db
                .query("sources")
                .withIndex("by_run_and_url", (q) => q.eq("runId", seeded.runId))
                .collect(),
        ),
    ).toEqual(
        expect.arrayContaining([
            expect.objectContaining({ secForm: "10-K", origin: "sec" }),
        ]),
    );
    const sourceId = seeded.sourceIds[0];
    if (!sourceId) throw new Error("Missing recorded source");
    const selected = await t
        .withIdentity({ subject: userId })
        .query(api.sources.getReviewSource, {
            runId: seeded.runId,
            corpusRevisionId: seeded.corpusRevisionId,
            sourceId,
        });
    expect(selected).toMatchObject({
        title: "Recorded terms",
        canonicalUrl: "https://www.adobe.com/legal/terms.html",
    });
    expect(await t.run((ctx) => ctx.db.get(seeded.runId))).toMatchObject({
        companySnapshot: { legalName: "Adobe — recorded review" },
        researchAngle: "Scope of the supplied agreement",
    });
    await t.finishInProgressScheduledFunctions();
});

test.each([
    "source-qualification-v3",
    "source-qualification-v4",
] as const)("recorded %s reading enforces exact input identity and preserves rejected responses without provider I/O", async (protocolVersion) => {
    vi.useFakeTimers();
    vi.stubEnv("E2E_FIXTURES_ENABLED", "true");
    vi.stubEnv("CONVEX_CLOUD_URL", "http://127.0.0.1:3210");
    const fetchSpy = vi.fn().mockRejectedValue(new Error("No external I/O"));
    vi.stubGlobal("fetch", fetchSpy);
    const { prepareQualificationInput } = await import(
        "@convex/domain/sourceQualification"
    );
    const { SOURCE_COVERAGE_ROLES } = await import(
        "@convex/domain/sourceSelectionPolicy"
    );
    const t = convexTest(schema, modules);
    workflowTest.register(t);
    const { userId } = await createAdmittedVisitor(t);
    const company = { cik: "796343", legalName: "Adobe", ticker: "ADBE" };
    const text =
        "Adobe licenses the software under the subscription agreement. The customer may use the service only for the subscription term.";
    const prepared = prepareQualificationInput({
        protocolVersion,
        company,
        text,
        canonicalUrl: "https://www.adobe.com/terms",
        title: "Terms",
        asOfTime: 1,
    });
    const passage = prepared.request.document.passages[0];
    if (!passage) throw new Error("Missing fixture passage");
    const response = {
        companyMatch: "subject",
        companyPassageKeys: [passage.passageKey],
        documentKind: "official_commercial_terms",
        reportingPeriodEnd: null,
        reportingPeriodPassageKeys: [],
        contributions: Object.fromEntries(
            SOURCE_COVERAGE_ROLES.map((role) => [
                role,
                role === "official_commercial_terms"
                    ? [
                          {
                              kind: "asserted_fact",
                              period: "unspecified",
                              dependsOnFlaggedAssertion: false,
                              passageKeys: [passage.passageKey],
                              periodPassageKeys: [],
                          },
                      ]
                    : null,
            ]),
        ),
        limitations: [],
    };
    const source = {
        ...(protocolVersion === "source-qualification-v4"
            ? { protocolVersion }
            : {}),
        canonicalUrl: "https://www.adobe.com/terms",
        title: "Terms",
        origin: "analyst_url" as const,
        category: "analyst_supplied",
        text,
        contentHash: prepared.request.document.contentHash,
        originalInputHash: prepared.inputHash,
        asOfTime: 1,
        originalResearchAngle: "",
        responseJson: JSON.stringify(response),
    };
    const args = {
        slotKey: "e2e-analyst",
        fixtureKey: "recorded-identity",
        company,
        websiteUrl: "https://www.adobe.com/",
        researchAngle: "Commercial use",
        sources: [source],
    };
    await expect(
        t.action(internal.e2eFixtures.seedRecordedSourceReview, {
            ...args,
            sources: [{ ...source, originalInputHash: "wrong" }],
        }),
    ).rejects.toThrow("Recorded qualification input changed");
    expect(
        await t.run((ctx) => ctx.db.query("researchRuns").take(1)),
    ).toHaveLength(0);
    const seeded = await t.action(
        internal.e2eFixtures.seedRecordedSourceReview,
        args,
    );
    const sourceId = seeded.sourceIds[0];
    if (!sourceId) throw new Error("Missing recorded source");
    const selected = await t
        .withIdentity({ subject: userId })
        .query(api.sources.getReviewSource, {
            runId: seeded.runId,
            corpusRevisionId: seeded.corpusRevisionId,
            sourceId,
        });
    expect(selected).toMatchObject({
        qualificationExecutionMode: "showcase",
        qualificationStatus: "available",
        qualification: { findings: [{ role: "official_commercial_terms" }] },
    });
    expect(
        await t.action(internal.e2eFixtures.seedRecordedSourceReview, args),
    ).toEqual(seeded);
    expect(
        await t
            .withIdentity({ subject: userId })
            .query(api.browserPreviewInternals.getPreview, { sourceId }),
    ).toMatchObject({ dataUrl: expect.stringContaining("Recorded%20fixture") });
    const rejected = await t.action(
        internal.e2eFixtures.seedRecordedSourceReview,
        {
            ...args,
            fixtureKey: "recorded-rejected",
            sources: [{ ...source, responseJson: "{}" }],
        },
    );
    const snapshot = await t.query(
        internal.e2eFixtures.inspectRecordedSourceReview,
        { runId: rejected.runId, fixtureKey: "recorded-rejected" },
    );
    expect(snapshot.tasks).toHaveLength(0);
    expect(snapshot.providerCalls).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(lookup).not.toHaveBeenCalled();
    await t.finishInProgressScheduledFunctions();
});

test.each([
    "source-selection-v10",
    "source-selection-v11",
    "source-selection-v12",
    "source-selection-v13",
])("refreshes %s from saved candidates without discovery or lost analyst decisions", async (previousPolicy) => {
    vi.useFakeTimers();
    vi.stubEnv("E2E_FIXTURES_ENABLED", "true");
    const request = vi.fn().mockRejectedValue(new Error("No provider I/O"));
    vi.stubGlobal("fetch", request);
    const t = convexTest(schema, modules);
    workflowTest.register(t);
    const { userId } = await createAdmittedVisitor(t);
    const seeded = await t.mutation(seedSourceReviewScenario, {
        slotKey: "e2e-analyst",
        fixtureKey: "ordering-policy-refresh",
    });
    const sourceId = seeded.sourceIds[0];
    if (!sourceId) throw new Error("Missing fixture source");
    const owner = t.withIdentity({ subject: userId });
    await owner.mutation(api.sources.decide, {
        runId: seeded.runId,
        corpusRevisionId: seeded.corpusRevisionId,
        sourceId,
        decision: "rejected",
        decisionKey: "keep-rejection",
    });
    await t.run((ctx) =>
        ctx.db.patch(seeded.proposalId, {
            policyVersion: previousPolicy,
            candidateFingerprint: "previous-policy-fingerprint",
        }),
    );
    const context = {
        runId: seeded.runId,
        corpusRevisionId: seeded.corpusRevisionId,
    };
    expect(
        await owner.query(api.sourceSelectionProposals.getCurrent, context),
    ).toMatchObject({ effectiveStatus: "stale" });
    const decisionsBefore = await t.run((ctx) =>
        ctx.db.query("sourceDecisions").collect(),
    );
    const refreshed = await owner.mutation(
        api.sourceSelectionProposals.recompute,
        { ...context, expectedProposalId: seeded.proposalId },
    );
    expect(refreshed.proposalId).not.toBe(seeded.proposalId);
    const sets = await owner.query(
        api.sourceSelectionProposals.getAdjustmentSets,
        context,
    );
    expect(
        sets.available.find((source) => source.sourceId === sourceId),
    ).toMatchObject({ decision: "rejected", included: false });
    expect(
        await owner.query(api.sourceSelectionProposals.getCurrent, context),
    ).toMatchObject({ effectiveStatus: "ready" });
    expect(await t.run((ctx) => ctx.db.get(seeded.proposalId))).toMatchObject({
        policyVersion: previousPolicy,
    });
    expect(
        await t.run((ctx) => ctx.db.get(refreshed.proposalId)),
    ).toMatchObject({ policyVersion: "source-selection-v14" });
    expect(
        await t.run((ctx) => ctx.db.query("sourceDecisions").collect()),
    ).toEqual(decisionsBefore);
    expect(await t.run((ctx) => ctx.db.query("providerCalls").take(1))).toEqual(
        [],
    );
    expect(request).not.toHaveBeenCalled();
    expect(lookup).not.toHaveBeenCalled();
    await t.finishInProgressScheduledFunctions();
});

test("local progress fixtures advance real review projections without providers or new analyst decisions", async () => {
    vi.stubEnv("E2E_FIXTURES_ENABLED", "true");
    vi.stubEnv("CONVEX_CLOUD_URL", "http://127.0.0.1:3210");
    const t = convexTest(schema, modules);
    workflowTest.register(t);
    const { userId } = await createAdmittedVisitor(t);
    const fixtureKey = "live-progress";
    const seeded = await t.action(
        internal.e2eFixtures.seedInspectedSourceReviewScenario,
        { slotKey: "e2e-analyst", fixtureKey },
    );
    const args = { runId: seeded.runId, fixtureKey, slotKey: "e2e-analyst" };
    const before = await t.query(
        internal.e2eFixtures.inspectSourceReviewScenario,
        { runId: seeded.runId, fixtureKey },
    );
    const owner = t.withIdentity({ subject: userId });
    const summaryArgs = {
        runId: seeded.runId,
        corpusRevisionId: seeded.corpusRevisionId,
    };
    await expect(
        t.mutation(internal.e2eFixtures.advanceSourcePreparationFixture, {
            ...args,
            phase: "reading",
            fixtureKey: "another-fixture",
        }),
    ).rejects.toThrow("Owned progress fixture");
    for (const phase of [
        "reading",
        "comparison",
        "comparison_progress",
        "supplement",
        "additional_reading",
        "proposal",
        "complete",
    ] as const) {
        await t.mutation(internal.e2eFixtures.advanceSourcePreparationFixture, {
            ...args,
            phase,
        });
        const summary = await owner.query(
            api.sourceSelectionProposals.getCurrent,
            summaryArgs,
        );
        if (phase === "complete") {
            expect(summary?.preparation?.status).toBe("partial");
            expect(summary?.effectiveStatus).toBe("ready");
            expect(summary?.preparation?.proposalPublished).toBe(true);
        } else
            expect(summary?.preparation).toMatchObject({
                status: "started",
                progress: {
                    phase:
                        phase === "comparison_progress"
                            ? "comparison"
                            : phase === "additional_reading"
                              ? "reading"
                              : phase,
                },
            });
        if (phase !== "reading")
            expect(summary?.preparation?.initialReadingsCompletedAt).toEqual(
                expect.any(Number),
            );
    }
    const after = await t.query(
        internal.e2eFixtures.inspectSourceReviewScenario,
        { runId: seeded.runId, fixtureKey },
    );
    expect(after.decisions).toEqual(before.decisions);
    expect(after.sourceReading).toEqual(before.sourceReading);
    expect(after.providerCallCount).toBe(0);
    vi.stubEnv("CONVEX_CLOUD_URL", "https://example.convex.cloud");
    await expect(
        t.mutation(internal.e2eFixtures.advanceSourcePreparationFixture, {
            ...args,
            phase: "reading",
        }),
    ).rejects.toThrow("Local progress fixtures");
});

test("recovery fixtures retain the inspected capture and require an owned local draft", async () => {
    vi.useFakeTimers();
    vi.stubEnv("E2E_FIXTURES_ENABLED", "true");
    vi.stubEnv("CONVEX_CLOUD_URL", "http://127.0.0.1:3210");
    vi.stubEnv("SOURCE_QUALIFICATION_ENABLED", "true");
    const t = convexTest(schema, modules);
    workflowTest.register(t);
    const { userId } = await createAdmittedVisitor(t);
    const fixtureKey = "bounded-recovery";
    const seeded = await t.action(
        internal.e2eFixtures.seedInspectedSourceReviewScenario,
        { slotKey: "e2e-analyst", fixtureKey },
    );
    const before = await t.query(
        internal.e2eFixtures.inspectSourceReviewScenario,
        { runId: seeded.runId, fixtureKey },
    );
    const args = { runId: seeded.runId, fixtureKey, slotKey: "e2e-analyst" };
    const staged = await t.mutation(
        internal.e2eFixtures.stageSourcePreparationRecoveryFixture,
        args,
    );
    expect(
        await t.mutation(
            internal.e2eFixtures.stageSourcePreparationRecoveryFixture,
            args,
        ),
    ).toEqual(staged);
    const after = await t.query(
        internal.e2eFixtures.inspectSourceReviewScenario,
        { runId: seeded.runId, fixtureKey },
    );
    expect(after.sourceReading).toEqual(before.sourceReading);
    expect(after.decisions).toEqual(before.decisions);
    expect(after.providerCallCount).toBe(0);
    expect(
        (
            await t
                .withIdentity({ subject: userId })
                .query(api.sourceSelectionProposals.getCurrent, {
                    runId: staged.runId,
                    corpusRevisionId: staged.corpusRevisionId,
                })
        )?.preparationAction,
    ).toMatchObject({ available: true });
    await expect(
        t.mutation(internal.e2eFixtures.stageSourcePreparationRecoveryFixture, {
            ...args,
            slotKey: "another-slot",
        }),
    ).rejects.toThrow("Owned recovery fixture");
    vi.stubEnv("CONVEX_CLOUD_URL", "https://example.convex.cloud");
    await expect(
        t.mutation(
            internal.e2eFixtures.stageSourcePreparationRecoveryFixture,
            args,
        ),
    ).rejects.toThrow("Local recovery fixtures");
});
