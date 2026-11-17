/// <reference types="vite/client" />
import type { Id } from "@convex/_generated/dataModel";
import { CLAIM_SCHEMA_VERSION } from "@convex/domain/showcaseManifest";
import schema from "@convex/schema";
import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

const modules = import.meta.glob("/convex/**/*.ts");

type ClaimSeed = {
    statement: string;
    classification: "Fact" | "Inference" | "Hypothesis" | "Unknown";
    questionIndex: number;
    dimensionKeys: Array<string>;
    relations: Array<"supporting" | "counter" | "context">;
    policyResult?: "pass" | "needs_review" | "blocked";
    sourceIndex?: number;
    attachEvidence?: boolean;
};

type SourceStatus = "succeeded" | "partial" | "failed";

type Fixture = {
    ownerUserId: Id<"users">;
    runId: Id<"researchRuns">;
    corpusRevisionId: Id<"corpusRevisions">;
    questionIds: Array<Id<"researchPlanQuestions">>;
    claimIds: Array<Id<"claims">>;
    extractionTaskId: Id<"aiTaskResults">;
    sourceIds: Array<Id<"sources">>;
    decisionIds: Array<Id<"sourceDecisions">>;
    passageIds: Array<Id<"sourcePassages">>;
};

/**
 * Seeds a corpus_approved run lineage: an active analyst visitor, an approved
 * corpus revision, three research plan questions, a showcase claim-extraction
 * task, then per-source accepted decisions, committed source versions and
 * passages, terminal frozen statuses, claims with cited evidence, and optional
 * policy evaluations.
 */
async function createFixture(
    t: ReturnType<typeof convexTest>,
    options: {
        sourceStatuses?: SourceStatus[];
        claims?: ClaimSeed[];
        pauseClaimGeneration?: boolean;
    } = {},
): Promise<Fixture> {
    return await t.run(async (ctx) => {
        const ownerUserId = await ctx.db.insert("users", { isAnonymous: true });
        const invitationId = await ctx.db.insert("invitations", {
            slotKey: "matrix-owner",
            role: "analyst",
            codeDigest: "matrix-owner-digest",
            status: "claimed",
            createdAt: 1,
        });
        const visitorId = await ctx.db.insert("visitors", {
            authUserId: ownerUserId,
            invitationId,
            role: "analyst",
            status: "active",
            analysesReserved: 1,
            admittedAt: 1,
        });

        const companyId = await ctx.db.insert("companies", {
            cik: "1818201",
            legalName: "CCC Intelligent Solutions Holdings Inc.",
            ticker: "CCCS",
            exchange: "NASDAQ",
            canonicalizedAt: 1,
        });

        const runId = await ctx.db.insert("researchRuns", {
            purpose: "research",
            ownerVisitorId: visitorId,
            companyId,
            coveragePreset: "balanced",
            lifecycleState: "evidence_ready",
            executionStatus: options.pauseClaimGeneration
                ? "paused"
                : "completed",
            executionGeneration: 1,
            nextEventSequence: 1,
            createdAt: 1,
            updatedAt: 1,
            pauseReason: options.pauseClaimGeneration
                ? "claim_generation_unavailable"
                : undefined,
        });

        const corpusRevisionId = await ctx.db.insert("corpusRevisions", {
            runId,
            revision: 1,
            status: "approved",
            approvedByVisitorId: visitorId,
            approvedAt: 100,
            createdAt: 1,
        });
        await ctx.db.patch(runId, { activeCorpusRevisionId: corpusRevisionId });

        const planId = await ctx.db.insert("researchPlans", {
            runId,
            version: 1,
            coveragePreset: "balanced",
            queries: [],
            createdAt: 1,
        });
        const dimensionKeys = [
            "workflow_control",
            "orchestration_position",
            "data_defensibility",
        ];
        const questionIds: Array<Id<"researchPlanQuestions">> = [];
        for (const [i, dimensionKey] of dimensionKeys.entries()) {
            questionIds.push(
                await ctx.db.insert("researchPlanQuestions", {
                    runId,
                    researchPlanId: planId,
                    planVersion: 1,
                    questionKey: `q${i}`,
                    prompt: `Prompt for ${dimensionKey}.`,
                    dimensionKeys: [dimensionKey],
                    createdAt: 1,
                }),
            );
        }

        const extractionTaskId = await ctx.db.insert("aiTaskResults", {
            runId,
            corpusRevisionId,
            taskType: "showcase_claim_extraction",
            executionMode: "showcase",
            schemaVersion: CLAIM_SCHEMA_VERSION,
            adapterVersion: "showcase-adapter-v1",
            inputHash: "fixture-input",
            output: { kind: "claim_extraction", claimCount: 0, claimIds: [] },
            createdAt: 100,
        });

        const sourceStatuses = options.sourceStatuses ?? [
            "succeeded",
            "succeeded",
            "succeeded",
        ];
        let seq = 100;
        const passageIdsBySource: Array<Id<"sourcePassages"> | undefined> = [];
        const sourceIds: Array<Id<"sources">> = [];
        const decisionIds: Array<Id<"sourceDecisions">> = [];
        for (const [sIdx, status] of sourceStatuses.entries()) {
            seq++;
            const canonicalUrl = `https://example.com/source-${sIdx}`;
            const sourceId = await ctx.db.insert("sources", {
                runId,
                canonicalUrl,
                title: `Source ${sIdx}`,
                origin: sIdx % 2 === 0 ? "sec" : "exa",
                category: "regulatory_filing",
                createdAt: seq,
            });
            sourceIds.push(sourceId);
            const acceptedId = await ctx.db.insert("sourceDecisions", {
                runId,
                corpusRevisionId,
                sourceId,
                decisionKey: `accept-${sIdx}`,
                decision: "accepted",
                reviewerVisitorId: visitorId,
                occurredAt: seq,
            });
            decisionIds.push(acceptedId);
            await ctx.db.insert("sourceReviewItems", {
                runId,
                corpusRevisionId,
                sourceId,
                decision: "accepted",
                decisionRank: sIdx,
                sourceCreatedAt: seq,
                latestDecisionId: acceptedId,
                decisionOccurredAt: seq,
            });
            const statusDocId = await ctx.db.insert("evidenceSourceStatuses", {
                runId,
                corpusRevisionId,
                sourceId,
                acceptedDecisionId: acceptedId,
                executionGeneration: 1,
                status,
                createdAt: seq,
                updatedAt: seq,
            });
            if (status === "succeeded" || status === "partial") {
                const storageId = (await ctx.storage.store(
                    new Blob(["normalized"]),
                )) as Id<"_storage">;
                const contentHash = `hash-${sIdx}`;
                const sourceVersionId = await ctx.db.insert("sourceVersions", {
                    runId,
                    corpusRevisionId,
                    sourceId,
                    acceptedDecisionId: acceptedId,
                    contentHash,
                    normalizerVersion: "web-v1",
                    storageId,
                    mediaType: "text/html",
                    byteCount: 100,
                    canonicalUrl,
                    retrievalVersion: "html-v1",
                    executionGeneration: 1,
                    createdAt: seq,
                });
                const passageId = await ctx.db.insert("sourcePassages", {
                    sourceVersionId,
                    locatorVersion: "web-v1",
                    passageKey: `passage-${sIdx}`,
                    quotationHash: `quotation-${sIdx}`,
                    order: 0,
                    exactQuotation: `Quotation from source ${sIdx}.`,
                    locator: {
                        kind: "web",
                        canonicalUrl,
                        sourceVersionHash: contentHash,
                        exactQuotation: `Quotation from source ${sIdx}.`,
                    },
                    createdAt: seq,
                });
                passageIdsBySource[sIdx] = passageId;
                // Bind the frozen status doc to its committed source version so
                // the current-status fence resolves this source as current.
                await ctx.db.patch(statusDocId, { sourceVersionId });
            }
        }

        const defaultClaim: ClaimSeed = {
            statement: "CCC connects many carriers.",
            classification: "Fact",
            questionIndex: 0,
            dimensionKeys: ["workflow_control"],
            relations: ["supporting"],
        };
        const claims = options.claims ?? [defaultClaim];
        const claimIds: Array<Id<"claims">> = [];

        for (const [cIdx, claim] of claims.entries()) {
            seq++;
            const claimId = await ctx.db.insert("claims", {
                runId,
                corpusRevisionId,
                statement: claim.statement,
                canonicalText: claim.statement.toLowerCase(),
                classification: claim.classification,
                proposingTaskId: extractionTaskId,
                researchPlanQuestionId: questionIds[claim.questionIndex],
                schemaVersion: CLAIM_SCHEMA_VERSION,
                createdAt: seq,
            });
            claimIds.push(claimId);
            const passageId =
                claim.attachEvidence === false
                    ? undefined
                    : (passageIdsBySource[claim.sourceIndex ?? 0] ?? undefined);
            if (passageId) {
                for (const relation of claim.relations) {
                    await ctx.db.insert("claimEvidence", {
                        claimId,
                        sourcePassageId: passageId,
                        relation,
                        proposingTaskId: extractionTaskId,
                        createdAt: seq,
                    });
                }
            }
            for (const dimensionKey of claim.dimensionKeys) {
                await ctx.db.insert("claimDimensionLinks", {
                    claimId,
                    runId,
                    corpusRevisionId,
                    dimensionKey,
                    proposalRevision: 1,
                    origin: "generated",
                    proposingTaskId: extractionTaskId,
                    createdAt: seq,
                });
            }
            if (claim.policyResult) {
                await ctx.db.insert("policyEvaluations", {
                    runId,
                    corpusRevisionId,
                    claimId,
                    policyVersion: "policy-v1",
                    normalizedInputs: {
                        classification: claim.classification,
                        asOfTime: seq,
                        sources: [],
                        supportingEvidenceCount: 0,
                        counterEvidenceCount: 0,
                        contextEvidenceCount: 0,
                        distinctSourceCount: 0,
                        distinctPublisherCount: 0,
                        distinctPassageCount: 0,
                        unresolvedCounterCount: 0,
                        coveredQuestionCount: 0,
                        totalQuestionCount: questionIds.length,
                        currentPlanQuestionCovered: false,
                    },
                    structuralResult: { status: "valid" },
                    rules: [],
                    reasonCodes: [],
                    result: claim.policyResult,
                    inputHash: `policy-hash-${cIdx}`,
                    createdAt: seq,
                });
            }
        }

        return {
            ownerUserId,
            runId,
            corpusRevisionId,
            questionIds,
            claimIds,
            extractionTaskId,
            sourceIds,
            decisionIds,
            passageIds: passageIdsBySource.filter(
                (id): id is Id<"sourcePassages"> => id !== undefined,
            ),
        };
    });
}

const summaryReference = makeFunctionReference<
    "query",
    { runId: Id<"researchRuns"> },
    {
        runId: Id<"researchRuns">;
        corpusRevisionId?: Id<"corpusRevisions">;
        lifecycleState: string;
        executionGeneration: number;
        executionStatus: string;
        pauseReason?: string;
        questionCoverage: {
            total: number;
            covered: number;
            buckets: Array<{
                questionId: Id<"researchPlanQuestions">;
                claimCount: number;
            }>;
        };
        frozenSources: {
            accepted: number;
            processed: number;
            partial: number;
            failed: number;
        };
        claimCount: number;
        executionMode: "showcase" | "live" | "unavailable" | "not_started";
        isShowcase: boolean;
    }
>("evidenceMatrix:getSummary");

const listClaimsReference = makeFunctionReference<
    "query",
    {
        runId: Id<"researchRuns">;
        paginationOpts: { numItems: number; cursor: string | null };
        filters?: {
            classification?: "Fact" | "Inference" | "Hypothesis" | "Unknown";
            policyResult?: "pass" | "needs_review" | "blocked";
            dimensionKey?: string;
            hasCounterEvidence?: boolean;
            processing?: "complete" | "partial" | "failed";
        };
    },
    {
        page: Array<{
            claimId: Id<"claims">;
            statement: string;
            canonicalText: string;
            classification: "Fact" | "Inference" | "Hypothesis" | "Unknown";
            dimensions: Array<string>;
            hasCounterEvidence: boolean;
            processing: "complete" | "partial" | "failed";
        }>;
        isDone: boolean;
        continueCursor: string;
        splitCursor?: string | null;
        pageStatus?: "SplitRecommended" | "SplitRequired" | null;
    }
>("evidenceMatrix:listClaims");

const claimDetailReference = makeFunctionReference<
    "query",
    { runId: Id<"researchRuns">; claimId: Id<"claims"> },
    {
        claim: {
            claimId: Id<"claims">;
            statement: string;
            canonicalText: string;
            classification: "Fact" | "Inference" | "Hypothesis" | "Unknown";
            researchPlanQuestionId?: Id<"researchPlanQuestions">;
            questionKey?: string;
            proposingTaskId: Id<"aiTaskResults">;
        };
        policy?: {
            policyVersion: string;
            result: "pass" | "needs_review" | "blocked";
            reasonCodes: Array<string>;
        };
        dimensions: Array<{
            dimensionKey: string;
            origin: "generated" | "analyst";
            rationale?: string;
        }>;
        evidence: Array<{
            relation: "supporting" | "counter" | "context";
            sourcePassageId: Id<"sourcePassages">;
            passageKey?: string;
            exactQuotation: string;
            order: number;
            sourceVersion: {
                sourceVersionId: Id<"sourceVersions">;
                contentHash: string;
            };
            source: {
                sourceId: Id<"sources">;
                canonicalUrl: string;
                title: string;
            };
            accepted: {
                acceptedDecisionId: Id<"sourceDecisions">;
                occurredAt: number;
            };
        }>;
    }
>("evidenceMatrix:getClaimDetail");

describe("Evidence matrix projection", () => {
    test("summary reflects complete processed sources and showcase disclosure", async () => {
        const t = convexTest(schema, modules);
        const fixture = await createFixture(t);
        const owner = t.withIdentity({
            subject: `${fixture.ownerUserId}|owner`,
        });
        const summary = await owner.query(summaryReference, {
            runId: fixture.runId,
        });
        expect(summary.executionMode).toBe("showcase");
        expect(summary.isShowcase).toBe(true);
        expect(summary.lifecycleState).toBe("evidence_ready");
        expect(summary.executionStatus).toBe("completed");
        expect(summary.frozenSources).toEqual({
            accepted: 3,
            processed: 3,
            partial: 0,
            failed: 0,
        });
        expect(summary.questionCoverage.total).toBe(3);
        expect(summary.questionCoverage.covered).toBe(1);
        expect(summary.claimCount).toBe(1);
        expect(summary.pauseReason).toBeUndefined();
    });

    test("summary reports partial and failed source processing", async () => {
        const t = convexTest(schema, modules);
        const fixture = await createFixture(t, {
            sourceStatuses: ["succeeded", "partial", "failed"],
        });
        const owner = t.withIdentity({
            subject: `${fixture.ownerUserId}|partial`,
        });
        const summary = await owner.query(summaryReference, {
            runId: fixture.runId,
        });
        expect(summary.frozenSources).toEqual({
            accepted: 3,
            processed: 1,
            partial: 1,
            failed: 1,
        });
    });

    test("summary exposes the unavailable pause tuple", async () => {
        const t = convexTest(schema, modules);
        const fixture = await createFixture(t, { pauseClaimGeneration: true });
        const owner = t.withIdentity({
            subject: `${fixture.ownerUserId}|unavailable`,
        });
        const summary = await owner.query(summaryReference, {
            runId: fixture.runId,
        });
        expect(summary.executionMode).toBe("unavailable");
        expect(summary.isShowcase).toBe(false);
        expect(summary.pauseReason).toBe("claim_generation_unavailable");
    });

    test("question coverage is derived from claims per question", async () => {
        const t = convexTest(schema, modules);
        const fixture = await createFixture(t, {
            sourceStatuses: ["succeeded", "partial", "failed"],
            claims: [
                {
                    statement: "Fact A.",
                    classification: "Fact",
                    questionIndex: 0,
                    dimensionKeys: ["workflow_control"],
                    relations: ["supporting"],
                },
                {
                    statement: "Inference B.",
                    classification: "Inference",
                    questionIndex: 1,
                    dimensionKeys: ["orchestration_position"],
                    relations: ["supporting", "counter"],
                },
                {
                    statement: "Hypothesis C.",
                    classification: "Hypothesis",
                    questionIndex: 2,
                    dimensionKeys: ["data_defensibility"],
                    relations: ["supporting"],
                },
            ],
        });
        const owner = t.withIdentity({
            subject: `${fixture.ownerUserId}|coverage`,
        });
        const summary = await owner.query(summaryReference, {
            runId: fixture.runId,
        });
        expect(summary.claimCount).toBe(3);
        expect(summary.questionCoverage.covered).toBe(3);
        expect(summary.questionCoverage.buckets).toHaveLength(3);
    });

    test("pagination filters by classification, dimension, counter, policy and processing", async () => {
        const t = convexTest(schema, modules);
        const fixture = await createFixture(t, {
            sourceStatuses: ["succeeded", "partial", "failed"],
            claims: [
                {
                    statement: "Fact with counter.",
                    classification: "Fact",
                    questionIndex: 0,
                    dimensionKeys: ["workflow_control"],
                    relations: ["supporting", "counter"],
                    policyResult: "needs_review",
                },
                {
                    statement: "Inference workflow.",
                    classification: "Inference",
                    questionIndex: 1,
                    dimensionKeys: ["workflow_control"],
                    relations: ["supporting"],
                    sourceIndex: 1,
                },
                {
                    statement: "Hypothesis orchestration.",
                    classification: "Hypothesis",
                    questionIndex: 2,
                    dimensionKeys: ["orchestration_position"],
                    relations: ["supporting"],
                    policyResult: "blocked",
                },
            ],
        });
        const owner = t.withIdentity({
            subject: `${fixture.ownerUserId}|filters`,
        });

        const byClassification = await owner.query(listClaimsReference, {
            runId: fixture.runId,
            paginationOpts: { numItems: 20, cursor: null },
            filters: { classification: "Fact" },
        });
        expect(byClassification.page).toHaveLength(1);

        const byDimension = await owner.query(listClaimsReference, {
            runId: fixture.runId,
            paginationOpts: { numItems: 20, cursor: null },
            filters: { dimensionKey: "orchestration_position" },
        });
        expect(byDimension.page).toHaveLength(1);

        const byCounter = await owner.query(listClaimsReference, {
            runId: fixture.runId,
            paginationOpts: { numItems: 20, cursor: null },
            filters: { hasCounterEvidence: true },
        });
        expect(byCounter.page).toHaveLength(1);

        const byPolicy = await owner.query(listClaimsReference, {
            runId: fixture.runId,
            paginationOpts: { numItems: 20, cursor: null },
            filters: { policyResult: "blocked" },
        });
        expect(byPolicy.page).toHaveLength(1);

        const byProcessing = await owner.query(listClaimsReference, {
            runId: fixture.runId,
            paginationOpts: { numItems: 20, cursor: null },
            filters: { processing: "partial" },
        });
        expect(byProcessing.page).toHaveLength(1);
    });

    test("pagination steps across pages with the continue cursor", async () => {
        const t = convexTest(schema, modules);
        const fixture = await createFixture(t, {
            sourceStatuses: ["succeeded", "partial", "failed"],
            claims: [
                {
                    statement: "A.",
                    classification: "Fact",
                    questionIndex: 0,
                    dimensionKeys: ["workflow_control"],
                    relations: ["supporting"],
                },
                {
                    statement: "B.",
                    classification: "Inference",
                    questionIndex: 1,
                    dimensionKeys: ["workflow_control"],
                    relations: ["supporting"],
                },
            ],
        });
        const owner = t.withIdentity({
            subject: `${fixture.ownerUserId}|pages`,
        });
        const first = await owner.query(listClaimsReference, {
            runId: fixture.runId,
            paginationOpts: { numItems: 1, cursor: null },
        });
        expect(first.page).toHaveLength(1);
        const second = await owner.query(listClaimsReference, {
            runId: fixture.runId,
            paginationOpts: { numItems: 1, cursor: first.continueCursor },
        });
        expect(second.page).toHaveLength(1);
        expect(second.page[0]?.statement).not.toBe(first.page[0]?.statement);
    });

    test("claim detail returns exact quotation, locator, source version and accepted decision provenance", async () => {
        const t = convexTest(schema, modules);
        const fixture = await createFixture(t, {});
        const owner = t.withIdentity({
            subject: `${fixture.ownerUserId}|detail`,
        });
        const claimId = fixture.claimIds[0];
        if (!claimId) throw new Error("missing claim");
        const detail = await owner.query(claimDetailReference, {
            runId: fixture.runId,
            claimId,
        });
        expect(detail.claim.statement).toBe("CCC connects many carriers.");
        expect(detail.evidence).toHaveLength(1);
        const citation = detail.evidence[0];
        if (!citation) throw new Error("missing citation");
        expect(citation.exactQuotation).toBe("Quotation from source 0.");
        expect(citation.source.canonicalUrl).toBe(
            "https://example.com/source-0",
        );
        expect(citation.sourceVersion.sourceVersionId).toBeDefined();
        expect(citation.accepted.acceptedDecisionId).toBeDefined();
    });

    test("a foreign analyst cannot read another analyst's run", async () => {
        const t = convexTest(schema, modules);
        const fixture = await createFixture(t, {});
        const foreignUserId = await t.run(async (ctx) => {
            const uid = await ctx.db.insert("users", { isAnonymous: true });
            const iid = await ctx.db.insert("invitations", {
                slotKey: "matrix-foreign",
                role: "analyst",
                codeDigest: "foreign-digest",
                status: "claimed",
                createdAt: 1,
            });
            await ctx.db.insert("visitors", {
                authUserId: uid,
                invitationId: iid,
                role: "analyst",
                status: "active",
                analysesReserved: 0,
                admittedAt: 1,
            });
            return uid;
        });
        const identity = t.withIdentity({
            subject: `${foreignUserId}|intruder`,
        });
        await expect(
            identity.query(summaryReference, { runId: fixture.runId }),
        ).rejects.toThrow("Unauthorized");
    });

    test("read of a claim in a foreign run is rejected", async () => {
        const t = convexTest(schema, modules);
        const fixture = await createFixture(t, {});
        const foreignClaimId = await t.run(async (ctx) => {
            const otherUserId = await ctx.db.insert("users", {
                isAnonymous: true,
            });
            const iid = await ctx.db.insert("invitations", {
                slotKey: "foreign-run",
                role: "analyst",
                codeDigest: "foreign-run-digest",
                status: "claimed",
                createdAt: 1,
            });
            const otherVisitorId = await ctx.db.insert("visitors", {
                authUserId: otherUserId,
                invitationId: iid,
                role: "analyst",
                status: "active",
                analysesReserved: 0,
                admittedAt: 1,
            });
            const companyId = await ctx.db.insert("companies", {
                cik: "1618",
                legalName: "Other Co.",
                ticker: "OTH",
                exchange: "NASDAQ",
                canonicalizedAt: 1,
            });
            const foreignRunId = await ctx.db.insert("researchRuns", {
                purpose: "research",
                ownerVisitorId: otherVisitorId,
                companyId,
                coveragePreset: "balanced",
                lifecycleState: "evidence_ready",
                executionStatus: "completed",
                executionGeneration: 1,
                nextEventSequence: 1,
                createdAt: 1,
                updatedAt: 1,
            });
            const foreignCorpusId = await ctx.db.insert("corpusRevisions", {
                runId: foreignRunId,
                revision: 1,
                status: "approved",
                approvedByVisitorId: otherVisitorId,
                approvedAt: 100,
                createdAt: 1,
            });
            await ctx.db.patch(foreignRunId, {
                activeCorpusRevisionId: foreignCorpusId,
            });
            const ebTaskId = await ctx.db.insert("aiTaskResults", {
                runId: foreignRunId,
                corpusRevisionId: foreignCorpusId,
                taskType: "showcase_claim_extraction",
                executionMode: "showcase",
                schemaVersion: CLAIM_SCHEMA_VERSION,
                adapterVersion: "showcase-adapter-v1",
                inputHash: "foreign-input",
                output: {
                    kind: "claim_extraction",
                    claimCount: 0,
                    claimIds: [],
                },
                createdAt: 100,
            });
            return await ctx.db.insert("claims", {
                runId: foreignRunId,
                corpusRevisionId: foreignCorpusId,
                statement: "Foreign claim.",
                canonicalText: "foreign claim",
                classification: "Fact",
                proposingTaskId: ebTaskId,
                schemaVersion: CLAIM_SCHEMA_VERSION,
                createdAt: 100,
            });
        });

        const owner = t.withIdentity({
            subject: `${fixture.ownerUserId}|owner-claim`,
        });
        await expect(
            owner.query(claimDetailReference, {
                runId: fixture.runId,
                claimId: foreignClaimId,
            }),
        ).rejects.toThrow("Unauthorized");
    });

    test("excludes evidence whose accepted decision belongs to another run", async () => {
        const t = convexTest(schema, modules);
        const fixture = await createFixture(t, {});
        const decisionId = fixture.decisionIds[0];
        if (!decisionId) throw new Error("missing decision");
        const otherRunId = await t.run(async (ctx) => {
            const companyId = await ctx.db.insert("companies", {
                cik: "999",
                legalName: "Other Co.",
                ticker: "OTHER",
                exchange: "NASDAQ",
                canonicalizedAt: 1,
            });
            const foreignRunId = await ctx.db.insert("researchRuns", {
                purpose: "research",
                ownerVisitorId: undefined,
                companyId,
                coveragePreset: "balanced",
                lifecycleState: "evidence_ready",
                executionStatus: "completed",
                executionGeneration: 2,
                nextEventSequence: 1,
                createdAt: 1,
                updatedAt: 1,
            });
            await ctx.db.patch(decisionId, { runId: foreignRunId });
            return foreignRunId;
        });
        expect(otherRunId).toBeDefined();

        const owner = t.withIdentity({
            subject: `${fixture.ownerUserId}|wrong-run`,
        });
        const summary = await owner.query(summaryReference, {
            runId: fixture.runId,
        });
        expect(summary.claimCount).toBe(0);
        expect(summary.questionCoverage.covered).toBe(0);
        expect(summary.frozenSources.accepted).toBe(2);

        const list = await owner.query(listClaimsReference, {
            runId: fixture.runId,
            paginationOpts: { numItems: 20, cursor: null },
        });
        expect(list.page).toHaveLength(0);

        const claimId = fixture.claimIds[0];
        if (!claimId) throw new Error("missing claim");
        await expect(
            owner.query(claimDetailReference, {
                runId: fixture.runId,
                claimId,
            }),
        ).rejects.toThrow(
            "Claim evidence no longer resolves to the current corpus",
        );
    });

    test("excludes evidence whose accepted decision belongs to another corpus revision", async () => {
        const t = convexTest(schema, modules);
        const fixture = await createFixture(t, {});
        const decisionId = fixture.decisionIds[0];
        if (!decisionId) throw new Error("missing decision");
        await t.run(async (ctx) => {
            const otherCorpusId = await ctx.db.insert("corpusRevisions", {
                runId: fixture.runId,
                revision: 99,
                status: "draft",
                approvedByVisitorId: undefined,
                approvedAt: undefined,
                createdAt: 1,
            });
            await ctx.db.patch(decisionId, { corpusRevisionId: otherCorpusId });
        });

        const owner = t.withIdentity({
            subject: `${fixture.ownerUserId}|wrong-corpus`,
        });
        const summary = await owner.query(summaryReference, {
            runId: fixture.runId,
        });
        expect(summary.claimCount).toBe(0);
        expect(summary.frozenSources.accepted).toBe(2);

        const list = await owner.query(listClaimsReference, {
            runId: fixture.runId,
            paginationOpts: { numItems: 20, cursor: null },
        });
        expect(list.page).toHaveLength(0);

        const claimId = fixture.claimIds[0];
        if (!claimId) throw new Error("missing claim");
        await expect(
            owner.query(claimDetailReference, {
                runId: fixture.runId,
                claimId,
            }),
        ).rejects.toThrow(
            "Claim evidence no longer resolves to the current corpus",
        );
    });

    test("excludes evidence whose accepted decision belongs to another source", async () => {
        const t = convexTest(schema, modules);
        const fixture = await createFixture(t, {});
        const decisionId = fixture.decisionIds[0];
        const otherSourceId = fixture.sourceIds[1];
        if (!decisionId || !otherSourceId) throw new Error("missing seed");
        await t.run(async (ctx) => {
            await ctx.db.patch(decisionId, { sourceId: otherSourceId });
        });

        const owner = t.withIdentity({
            subject: `${fixture.ownerUserId}|wrong-source`,
        });
        const summary = await owner.query(summaryReference, {
            runId: fixture.runId,
        });
        expect(summary.claimCount).toBe(0);
        expect(summary.frozenSources.accepted).toBe(2);

        const list = await owner.query(listClaimsReference, {
            runId: fixture.runId,
            paginationOpts: { numItems: 20, cursor: null },
        });
        expect(list.page).toHaveLength(0);

        const claimId = fixture.claimIds[0];
        if (!claimId) throw new Error("missing claim");
        await expect(
            owner.query(claimDetailReference, {
                runId: fixture.runId,
                claimId,
            }),
        ).rejects.toThrow(
            "Claim evidence no longer resolves to the current corpus",
        );
    });

    test("a claim with no cited evidence rows is not matrix-visible", async () => {
        const t = convexTest(schema, modules);
        const fixture = await createFixture(t, {
            claims: [
                {
                    statement: "Evidenced claim.",
                    classification: "Fact",
                    questionIndex: 0,
                    dimensionKeys: ["workflow_control"],
                    relations: ["supporting"],
                },
                {
                    statement: "Orphan claim.",
                    classification: "Fact",
                    questionIndex: 1,
                    dimensionKeys: ["workflow_control"],
                    relations: ["supporting"],
                    attachEvidence: false,
                },
            ],
        });
        const owner = t.withIdentity({
            subject: `${fixture.ownerUserId}|orphan-claim`,
        });
        const summary = await owner.query(summaryReference, {
            runId: fixture.runId,
        });
        expect(summary.claimCount).toBe(1);
        expect(summary.questionCoverage.covered).toBe(1);

        const list = await owner.query(listClaimsReference, {
            runId: fixture.runId,
            paginationOpts: { numItems: 20, cursor: null },
        });
        expect(list.page).toHaveLength(1);
        expect(list.page[0]?.statement).toBe("Evidenced claim.");

        const orphanId = fixture.claimIds[1];
        if (!orphanId) throw new Error("missing orphan claim");
        await expect(
            owner.query(claimDetailReference, {
                runId: fixture.runId,
                claimId: orphanId,
            }),
        ).rejects.toThrow(
            "Claim evidence no longer resolves to the current corpus",
        );
    });

    test("an all-orphan claim set yields a true empty matrix", async () => {
        const t = convexTest(schema, modules);
        const fixture = await createFixture(t, {
            claims: [
                {
                    statement: "Only orphan.",
                    classification: "Fact",
                    questionIndex: 0,
                    dimensionKeys: ["workflow_control"],
                    relations: ["supporting"],
                    attachEvidence: false,
                },
            ],
        });
        const owner = t.withIdentity({
            subject: `${fixture.ownerUserId}|orphan-only`,
        });
        const summary = await owner.query(summaryReference, {
            runId: fixture.runId,
        });
        expect(summary.claimCount).toBe(0);
        expect(summary.questionCoverage.covered).toBe(0);

        const list = await owner.query(listClaimsReference, {
            runId: fixture.runId,
            paginationOpts: { numItems: 20, cursor: null },
        });
        expect(list.page).toHaveLength(0);

        const onlyId = fixture.claimIds[0];
        if (!onlyId) throw new Error("missing claim");
        await expect(
            owner.query(claimDetailReference, {
                runId: fixture.runId,
                claimId: onlyId,
            }),
        ).rejects.toThrow(
            "Claim evidence no longer resolves to the current corpus",
        );
    });

    test("stale research plan questions never inflate question coverage", async () => {
        const t = convexTest(schema, modules);
        const fixture = await createFixture(t, {});
        // Adds a superseding plan version whose questions replace the original
        // set. The default fixture claim cites the original (now stale) question.
        const currentQuestionId = await t.run(async (ctx) => {
            const planV2Id = await ctx.db.insert("researchPlans", {
                runId: fixture.runId,
                version: 2,
                coveragePreset: "balanced",
                queries: [],
                createdAt: 2,
            });
            const qV2 = await ctx.db.insert("researchPlanQuestions", {
                runId: fixture.runId,
                researchPlanId: planV2Id,
                planVersion: 2,
                questionKey: "current-q0",
                prompt: "Current question.",
                dimensionKeys: ["workflow_control"],
                createdAt: 2,
            });
            await ctx.db.insert("researchPlanQuestions", {
                runId: fixture.runId,
                researchPlanId: planV2Id,
                planVersion: 2,
                questionKey: "current-q1",
                prompt: "Current question 2.",
                dimensionKeys: ["orchestration_position"],
                createdAt: 3,
            });
            await ctx.db.insert("researchPlanQuestions", {
                runId: fixture.runId,
                researchPlanId: planV2Id,
                planVersion: 2,
                questionKey: "current-q2",
                prompt: "Current question 3.",
                dimensionKeys: ["data_defensibility"],
                createdAt: 4,
            });
            // A second valid claim anchored to a current-plan question.
            const secondClaimId = await ctx.db.insert("claims", {
                runId: fixture.runId,
                corpusRevisionId: fixture.corpusRevisionId,
                statement: "Current from new plan.",
                canonicalText: "current from new plan",
                classification: "Fact",
                proposingTaskId: fixture.extractionTaskId,
                researchPlanQuestionId: qV2,
                schemaVersion: CLAIM_SCHEMA_VERSION,
                createdAt: 5,
            });
            await ctx.db.insert("claimEvidence", {
                claimId: secondClaimId,
                sourcePassageId: fixture.passageIds[1] as Id<"sourcePassages">,
                relation: "supporting",
                proposingTaskId: fixture.extractionTaskId,
                createdAt: 6,
            });
            return qV2;
        });
        expect(currentQuestionId).toBeDefined();

        const owner = t.withIdentity({
            subject: `${fixture.ownerUserId}|superseded`,
        });
        const summary = await owner.query(summaryReference, {
            runId: fixture.runId,
        });
        // The default claim references the stale (removed) question, so only
        // the second claim lands inside the current plan's question set.
        expect(summary.claimCount).toBe(2);
        expect(summary.questionCoverage.total).toBe(3);
        expect(summary.questionCoverage.covered).toBe(1);
        expect(summary.questionCoverage.buckets).toHaveLength(1);
        expect(summary.questionCoverage.buckets[0]).toEqual({
            questionId: currentQuestionId,
            claimCount: 1,
        });
        expect(summary.questionCoverage.covered).toBeLessThanOrEqual(
            summary.questionCoverage.total,
        );
    });

    test("sparse filtered pagination never presents a false terminal empty state", async () => {
        const t = convexTest(schema, modules);
        const fixture = await createFixture(t, {
            sourceStatuses: [
                "succeeded",
                "succeeded",
                "succeeded",
                "succeeded",
            ],
            claims: [
                {
                    statement: "First fact.",
                    classification: "Fact",
                    questionIndex: 0,
                    dimensionKeys: ["workflow_control"],
                    relations: ["supporting"],
                },
                {
                    statement: "Second fact.",
                    classification: "Fact",
                    questionIndex: 1,
                    dimensionKeys: ["workflow_control"],
                    relations: ["supporting"],
                    sourceIndex: 1,
                },
                {
                    statement: "Third fact.",
                    classification: "Fact",
                    questionIndex: 2,
                    dimensionKeys: ["workflow_control"],
                    relations: ["supporting"],
                    sourceIndex: 2,
                },
                {
                    statement: "Hypothesis later.",
                    classification: "Hypothesis",
                    questionIndex: 0,
                    dimensionKeys: ["orchestration_position"],
                    relations: ["supporting"],
                    sourceIndex: 3,
                },
            ],
        });
        const owner = t.withIdentity({
            subject: `${fixture.ownerUserId}|sparse`,
        });
        const filters = { classification: "Hypothesis" as const };

        // The first raw claim page holds no match. The sparse page must be
        // reported as empty but never terminal, and must keep a valid raw
        // cursor so subsequent continuation pages can still surface the match.
        let sawSparseEmpty = false;
        let cursor: string | null = null;
        const found: Array<{ statement: string }> = [];
        type SparsePage = {
            page: Array<{ statement: string }>;
            isDone: boolean;
            continueCursor: string;
        };
        for (let step = 0; step < 10; step++) {
            const page: SparsePage = await owner.query(listClaimsReference, {
                runId: fixture.runId,
                paginationOpts: { numItems: 1, cursor },
                filters,
            });
            if (page.page.length === 0) {
                if (page.isDone) {
                    break;
                }
                sawSparseEmpty = true;
                expect(page.continueCursor).not.toBe("");
            }
            found.push(...page.page);
            cursor = page.isDone ? null : page.continueCursor;
            if (page.isDone) break;
        }
        expect(sawSparseEmpty).toBe(true);
        expect(found.map((f) => f.statement)).toContain("Hypothesis later.");
    });
});
