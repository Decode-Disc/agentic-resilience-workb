/// <reference types="vite/client" />
import type { Id } from "@convex/_generated/dataModel";
import {
    type ClaimStructuralInput,
    deriveQuestionCoverage,
    STRUCTURAL_RULE_IDS,
    validateClaimStructure,
} from "@convex/domain/claimValidation";
import { MAX_VERIFIER_EVIDENCE_REFERENCES } from "@convex/domain/evidenceLimits";
import {
    derivePublisherIdentity,
    evaluateEvidencePolicy,
    POLICY_RULE_IDS,
    POLICY_VERSION,
    type PolicyNormalizedInputs,
} from "@convex/domain/evidencePolicy";
import {
    CLAIM_SCHEMA_VERSION,
    clearShowcaseManifests,
    registerShowcaseManifest,
    SHOWCASE_ADAPTER_VERSION,
    SHOWCASE_FIXTURE_VERSION,
    type ShowcaseClaimOutput,
} from "@convex/domain/showcaseManifest";
import {
    clearShowcaseVerifiers,
    computeVerifierInputHash,
    executeShowcaseVerifier,
    registerShowcaseVerifier,
    VERIFIER_ADAPTER_VERSION,
    VERIFIER_SCHEMA_VERSION,
    type VerifierInput,
} from "@convex/integrations/showcaseVerifierAdapter";
import schema from "@convex/schema";
import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { registerCccShowcaseFixture } from "../../fixtures/evidence/ccc-showcase-manifest";
import rateLimiterTest from "../integrations/rate-limiter-test-register.js";
import workflowTest from "../workflows/workflow-test-register.js";

const modules = import.meta.glob("/convex/**/*.ts");

const generateClaimsForRun = makeFunctionReference<
    "mutation",
    { runId: Id<"researchRuns">; executionGeneration: number },
    {
        status: string;
        aiTaskResultId?: Id<"aiTaskResults">;
        claimCount: number;
        reused: boolean;
        reason?: string;
    }
>("claimGeneration:generateClaimsForRun");

const evaluatePolicyForRun = makeFunctionReference<
    "action",
    { runId: Id<"researchRuns">; executionGeneration: number },
    {
        evaluationCount: number;
        blockedCount: number;
        needsReviewCount: number;
        passCount: number;
    }
>("policyEvaluations:evaluatePolicyForRun");

const getNormalizedClaimInput = makeFunctionReference<
    "query",
    { runId: Id<"researchRuns">; executionGeneration: number },
    { normalizedInput: any; inputHash: string } | null
>("claimGeneration:getNormalizedClaimInput");

const commitEvaluation = makeFunctionReference<
    "mutation",
    {
        runId: Id<"researchRuns">;
        executionGeneration: number;
        corpusRevisionId: Id<"corpusRevisions">;
        claimId: Id<"claims">;
        normalizedInputs: any;
        structuralResult:
            | { status: "valid" }
            | { status: "blocked"; ruleId: string };
        rules: Array<{ ruleId: string; outcome: string; reasonCode: string }>;
        reasonCodes: string[];
        result: "pass" | "needs_review" | "blocked";
        inputHash: string;
        verifier?: {
            inputHash: string;
            output: {
                label: "entailed" | "contradicted" | "mixed";
                evidenceReferences: Array<{
                    sourcePassageId: Id<"sourcePassages">;
                    passageKey: string;
                }>;
            };
        };
        citedEvidence: Array<{
            sourcePassageId: Id<"sourcePassages">;
            sourceVersionId: Id<"sourceVersions">;
            sourceId: Id<"sources">;
            acceptedDecisionId: Id<"sourceDecisions">;
        }>;
        createdAt: number;
    },
    Id<"policyEvaluations">
>("policyEvaluations:commitEvaluation");

async function createPolicyScenario(
    t: ReturnType<typeof convexTest>,
    opts?: { withProposal?: boolean },
) {
    return await t.run(async (ctx) => {
        const userId = await ctx.db.insert("users", { isAnonymous: true });
        const invitationId = await ctx.db.insert("invitations", {
            slotKey: "analyst-policy-test",
            role: "analyst",
            codeDigest: "digest-policy",
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
            cik: "1818201",
            legalName: "CCC Intelligent Solutions Holdings Inc.",
            ticker: "CCCS",
            exchange: "NASDAQ",
            canonicalizedAt: 100,
        });

        const runId = await ctx.db.insert("researchRuns", {
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

        // Seed research plan and questions
        const { ASSESSMENT_DIMENSION_KEYS } = await import(
            "@convex/domain/researchPlan"
        );
        const planId = await ctx.db.insert("researchPlans", {
            runId,
            version: 2,
            coveragePreset: "balanced",
            queries: [],
            createdAt: 100,
        });

        for (const dimensionKey of ASSESSMENT_DIMENSION_KEYS) {
            await ctx.db.insert("researchPlanQuestions", {
                runId,
                researchPlanId: planId,
                planVersion: 2,
                questionKey: `dimension:${dimensionKey}`,
                prompt: `What public evidence addresses ${dimensionKey}?`,
                dimensionKeys: [dimensionKey],
                createdAt: 100,
            });
        }

        // Seed sources, versions, passages (4 passages for standard fixture)
        const passageTexts = [
            "CCC network connects approximately 30,000 repair facilities.",
            "The company processes over 28 million claims annually.",
            "OEM telematics could bypass traditional estimating networks.",
            "Multi-modal generative models may alter estimating logic.",
        ];
        const artifactText = passageTexts.join("\n");
        const storageId = (await ctx.storage.store(
            new Blob([artifactText]),
        )) as Id<"_storage">;

        const sourceId = await ctx.db.insert("sources", {
            runId,
            canonicalUrl: "https://example.com/sec/ccc-10k",
            title: "CCC 10-K Annual Report",
            origin: "sec",
            category: "regulatory_filing",
            createdAt: 100,
        });

        const decisionId = await ctx.db.insert("sourceDecisions", {
            runId,
            corpusRevisionId,
            sourceId,
            decisionKey: `dec:${sourceId}:100`,
            decision: "accepted",
            reviewerVisitorId: visitorId,
            occurredAt: 100,
        });

        await ctx.db.insert("sourceReviewItems", {
            runId,
            corpusRevisionId,
            sourceId,
            decisionRank: 0,
            sourceCreatedAt: 100,
            decision: "accepted",
            latestDecisionId: decisionId,
            decisionOccurredAt: 100,
        });

        // Seed the source-selection proposal and its accepted item so the
        // policy snapshot projects real authority/document-kind metadata. The
        // proposal also carries a persisted discovery/coverage gap (selection
        // gap alone must never fabricate Unknown claims or coverage).
        if (opts?.withProposal !== false) {
            const proposalId = await ctx.db.insert("sourceSelectionProposals", {
                runId,
                corpusRevisionId,
                version: 1,
                policyVersion: "source-selection-v6",
                coveragePreset: "balanced",
                recommendedTarget: 12,
                candidateFingerprint: "ccc-policy-fixture",
                status: "ready",
                counts: { recommended: 1, needsAttention: 0, alternative: 0 },
                gaps: [],
                failedDiscoveryFamilies: [
                    "official_product",
                    "independent_analysis",
                ],
                coverageGaps: ["official_product_platform"],
                createdAt: 100,
            });
            await ctx.db.patch(corpusRevisionId, {
                sourceSelectionProposalId: proposalId,
            });
            await ctx.db.insert("sourceSelectionProposalItems", {
                runId,
                corpusRevisionId,
                proposalId,
                sourceId,
                disposition: "recommended",
                sourceFamily: "regulatory",
                documentKind: "regulatory_annual",
                authorityTier: "regulator_primary",
                companyLinkageBasis: "structural",
                coverageContributions: ["regulatory_annual"],
                rank: 0,
                reasonCodes: [],
                createdAt: 100,
            });
        }

        const { computePassageKey, sha256Hex } = await import(
            "@convex/domain/sourcePassages"
        );
        const versionHash = sha256Hex(artifactText);
        const sourceVersionId = await ctx.db.insert("sourceVersions", {
            runId,
            corpusRevisionId,
            sourceId,
            acceptedDecisionId: decisionId,
            contentHash: versionHash,
            normalizerVersion: "sec-html-v1",
            storageId,
            mediaType: "text/html",
            byteCount: 200,
            canonicalUrl: "https://example.com/sec/ccc-10k",
            retrievalVersion: "sec-v1",
            executionGeneration: 1,
            createdAt: 100,
        });

        await ctx.db.insert("evidenceSourceStatuses", {
            runId,
            corpusRevisionId,
            sourceId,
            acceptedDecisionId: decisionId,
            sourceVersionId,
            executionGeneration: 1,
            status: "succeeded",
            createdAt: 100,
            updatedAt: 100,
        });

        let startOffset = 0;
        for (const [pIdx, text] of passageTexts.entries()) {
            const quotationHash = `qhash_${pIdx}`;
            const locator = {
                kind: "web" as const,
                canonicalUrl: "https://example.com/sec/ccc-10k",
                sourceVersionHash: versionHash,
                exactQuotation: text,
                startOffset,
                endOffset: startOffset + text.length,
            };
            const passageKey = computePassageKey({
                sourceId,
                sourceVersionHash: versionHash,
                locatorVersion: "web-v1",
                locator,
                order: pIdx,
                quotationHash,
            });
            await ctx.db.insert("sourcePassages", {
                sourceVersionId,
                locatorVersion: "web-v1",
                passageKey,
                quotationHash,
                order: pIdx,
                exactQuotation: text,
                locator,
                createdAt: 100,
            });
            startOffset += text.length + 1;
        }

        return { runId, corpusRevisionId, visitorId };
    });
}

describe("Structural Validation", () => {
    test("invalid classification is blocked", () => {
        const input: ClaimStructuralInput = {
            statement: "A valid statement",
            classification: "Invalid" as any,
            evidence: [
                {
                    sourcePassageId: "pass" as any,
                    passageKey: "pk",
                    quotationHash: "qh",
                    relation: "supporting",
                },
            ],
            dimensionLinks: [],
        };
        const result = validateClaimStructure(input);
        expect(result.status).toBe("blocked");
        if (result.status === "blocked") {
            expect(result.ruleId).toBe(
                STRUCTURAL_RULE_IDS.INVALID_CLASSIFICATION,
            );
        }
    });

    test("empty statement is blocked", () => {
        const input: ClaimStructuralInput = {
            statement: "",
            classification: "Fact",
            evidence: [
                {
                    sourcePassageId: "pass" as any,
                    passageKey: "pk",
                    quotationHash: "qh",
                    relation: "supporting",
                },
            ],
            dimensionLinks: [],
        };
        const result = validateClaimStructure(input);
        expect(result.status).toBe("blocked");
        if (result.status === "blocked") {
            expect(result.ruleId).toBe(STRUCTURAL_RULE_IDS.EMPTY_STATEMENT);
        }
    });

    test("missing evidence is blocked", () => {
        const input: ClaimStructuralInput = {
            statement: "A valid statement",
            classification: "Fact",
            evidence: [],
            dimensionLinks: [],
        };
        const result = validateClaimStructure(input);
        expect(result.status).toBe("blocked");
        if (result.status === "blocked") {
            expect(result.ruleId).toBe(STRUCTURAL_RULE_IDS.MISSING_EVIDENCE);
        }
    });

    test("Unknown without questionId is blocked", () => {
        const input: ClaimStructuralInput = {
            statement: "An unknown claim",
            classification: "Unknown",
            evidence: [
                {
                    sourcePassageId: "pass" as any,
                    passageKey: "pk",
                    quotationHash: "qh",
                    relation: "context",
                },
            ],
            dimensionLinks: [],
            // No researchPlanQuestionId
        };
        const result = validateClaimStructure(input);
        expect(result.status).toBe("blocked");
        if (result.status === "blocked") {
            expect(result.ruleId).toBe(
                STRUCTURAL_RULE_IDS.UNKNOWN_MISSING_QUESTION,
            );
        }
    });

    test("Unknown without context evidence is blocked", () => {
        const input: ClaimStructuralInput = {
            statement: "An unknown claim",
            classification: "Unknown",
            evidence: [
                {
                    sourcePassageId: "pass" as any,
                    passageKey: "pk",
                    quotationHash: "qh",
                    relation: "supporting",
                },
            ],
            dimensionLinks: [],
            researchPlanQuestionId: "q1" as Id<"researchPlanQuestions">,
        };
        const result = validateClaimStructure(input);
        expect(result.status).toBe("blocked");
        if (result.status === "blocked") {
            expect(result.ruleId).toBe(
                STRUCTURAL_RULE_IDS.UNKNOWN_MISSING_CONTEXT_EVIDENCE,
            );
        }
    });

    test("Unknown with questionId and context evidence passes", () => {
        const input: ClaimStructuralInput = {
            statement: "An unknown claim",
            classification: "Unknown",
            evidence: [
                {
                    sourcePassageId: "pass" as any,
                    passageKey: "pk",
                    quotationHash: "qh",
                    relation: "context",
                },
            ],
            dimensionLinks: [],
            researchPlanQuestionId: "q1" as Id<"researchPlanQuestions">,
        };
        const result = validateClaimStructure(input);
        expect(result.status).toBe("valid");
    });

    test("duplicate evidence is blocked", () => {
        const input: ClaimStructuralInput = {
            statement: "A claim",
            classification: "Fact",
            evidence: [
                {
                    sourcePassageId: "pass" as any,
                    passageKey: "pk1",
                    quotationHash: "qh1",
                    relation: "supporting",
                },
                {
                    sourcePassageId: "pass" as any,
                    passageKey: "pk1",
                    quotationHash: "qh1",
                    relation: "supporting",
                },
            ],
            dimensionLinks: [],
        };
        const result = validateClaimStructure(input);
        expect(result.status).toBe("blocked");
        if (result.status === "blocked") {
            expect(result.ruleId).toBe(STRUCTURAL_RULE_IDS.DUPLICATE_EVIDENCE);
        }
    });

    test("valid claim passes structural validation", () => {
        const input: ClaimStructuralInput = {
            statement: "CCC processes 28 million claims annually.",
            classification: "Fact",
            evidence: [
                {
                    sourcePassageId: "pass" as any,
                    passageKey: "pk",
                    quotationHash: "qh",
                    relation: "supporting",
                },
            ],
            dimensionLinks: [
                {
                    dimensionKey: "workflow_control",
                    rationale: "Deep integration",
                },
            ],
        };
        const result = validateClaimStructure(input);
        expect(result.status).toBe("valid");
    });
});

const basePolicyInputs: PolicyNormalizedInputs = {
    classification: "Fact",
    asOfTime: 1_800_000_000_000,
    supportingSourceIds: ["source-1", "source-2"],
    sources: [
        {
            sourceId: "source-1",
            origin: "sec",
            category: "regulatory_filing",
            secForm: "10-K",
            authorityTier: "regulator_primary",
            documentKind: "regulatory_annual",
            publisherIdentity: "sec.gov",
            publishedAt: 1_790_000_000_000,
        },
        {
            sourceId: "source-2",
            origin: "exa",
            category: "industry_analysis",
            authorityTier: "institutional_independent",
            documentKind: "independent_analysis",
            publisherIdentity: "reuters.com",
            publishedAt: 1_790_000_000_000,
        },
    ],
    supportingEvidenceCount: 2,
    counterEvidenceCount: 0,
    contextEvidenceCount: 0,
    distinctSourceCount: 2,
    distinctPublisherCount: 2,
    distinctPassageCount: 2,
    unresolvedCounterCount: 0,
    coveredQuestionCount: 10,
    totalQuestionCount: 10,
    currentPlanQuestionCovered: true,
};

describe("Deterministic Policy Evaluation", () => {
    test("same normalized inputs replay identically", () => {
        expect(evaluateEvidencePolicy(basePolicyInputs)).toEqual(
            evaluateEvidencePolicy(structuredClone(basePolicyInputs)),
        );
    });

    test("explicit support-counter conflict is the only verifier trigger", () => {
        expect(evaluateEvidencePolicy(basePolicyInputs).requiresVerifier).toBe(
            false,
        );
        const conflict = evaluateEvidencePolicy({
            ...basePolicyInputs,
            counterEvidenceCount: 1,
            unresolvedCounterCount: 1,
            distinctPassageCount: 3,
        });
        expect(conflict.requiresVerifier).toBe(true);
        expect(conflict.verifierRuleId).toBe("policy.semantic_conflict");
        expect(
            evaluateEvidencePolicy({
                ...basePolicyInputs,
                classification: "Hypothesis",
                distinctSourceCount: 1,
            }).requiresVerifier,
        ).toBe(false);
    });

    test("policy version is immutable", () => {
        expect(POLICY_VERSION).toBe("evidence-policy-v4");
        expect(evaluateEvidencePolicy(basePolicyInputs).policyVersion).toBe(
            POLICY_VERSION,
        );
    });
});

describe("Question Coverage Derivation", () => {
    test("derives coverage from claims with questionIds", () => {
        const claims = [
            {
                classification: "Fact" as const,
                researchPlanQuestionId: "q1" as Id<"researchPlanQuestions">,
            },
            {
                classification: "Fact" as const,
                researchPlanQuestionId: "q1" as Id<"researchPlanQuestions">,
            },
            {
                classification: "Inference" as const,
                researchPlanQuestionId: "q2" as Id<"researchPlanQuestions">,
            },
            { classification: "Hypothesis" as const },
        ];

        const coverage = deriveQuestionCoverage(claims);
        expect(coverage.get("q1" as Id<"researchPlanQuestions">)).toBe(2);
        expect(coverage.get("q2" as Id<"researchPlanQuestions">)).toBe(1);
        expect(coverage.size).toBe(2);
    });
});

describe("E2E: Claim Generation with Structural Validation + Policy", () => {
    beforeEach(() => {
        clearShowcaseManifests();
        clearShowcaseVerifiers();
    });

    afterEach(() => {
        clearShowcaseManifests();
        clearShowcaseVerifiers();
    });

    test("valid showcase claims persist with structural validation passing and policy evaluation created", async () => {
        const t = convexTest(schema, modules);
        rateLimiterTest.register(t);
        workflowTest.register(t);

        const scenario = await createPolicyScenario(t);

        const inputData = await t.query(getNormalizedClaimInput, {
            runId: scenario.runId,
            executionGeneration: 1,
        });
        if (!inputData) throw new Error("Missing inputData");
        registerCccShowcaseFixture(inputData.normalizedInput);

        const result = await t.mutation(generateClaimsForRun, {
            runId: scenario.runId,
            executionGeneration: 1,
        });

        expect(result.status).toBe("succeeded");
        expect(result.claimCount).toBeGreaterThan(0);

        const policy = await t.action(evaluatePolicyForRun, {
            runId: scenario.runId,
            executionGeneration: 1,
        });
        expect(policy.evaluationCount).toBe(result.claimCount);
        expect(policy.blockedCount).toBe(0);
        const replay = await t.action(evaluatePolicyForRun, {
            runId: scenario.runId,
            executionGeneration: 1,
        });
        expect(replay).toEqual(policy);

        await t.run(async (ctx) => {
            const allClaims = await ctx.db
                .query("claims")
                .withIndex("by_run", (query) =>
                    query.eq("runId", scenario.runId),
                )
                .take(129);
            const evaluations = await ctx.db
                .query("policyEvaluations")
                .withIndex("by_run", (query) =>
                    query.eq("runId", scenario.runId),
                )
                .take(129);
            expect(evaluations).toHaveLength(allClaims.length);
            expect(
                new Set(evaluations.map((evaluation) => evaluation.claimId))
                    .size,
            ).toBe(allClaims.length);
            expect(
                evaluations.every(
                    (evaluation) =>
                        evaluation.structuralResult.status === "valid",
                ),
            ).toBe(true);
            for (const unknown of allClaims.filter(
                (claim) => claim.classification === "Unknown",
            )) {
                expect(unknown.researchPlanQuestionId).toBeDefined();
            }
        });
    });

    test.each([
        true,
        false,
    ])("keeps the first evidence failure across shared artifacts (missing first: %s)", async (missingFirst) => {
        const t = convexTest(schema, modules);
        rateLimiterTest.register(t);
        workflowTest.register(t);
        const scenario = await createPolicyScenario(t);
        const input = await t.query(getNormalizedClaimInput, {
            runId: scenario.runId,
            executionGeneration: 1,
        });
        if (!input) throw new Error("Missing normalized input");
        registerCccShowcaseFixture(input.normalizedInput);
        await t.mutation(generateClaimsForRun, {
            runId: scenario.runId,
            executionGeneration: 1,
        });
        const targetClaimId = await t.run(async (ctx) => {
            const claims = await ctx.db
                .query("claims")
                .withIndex("by_run", (q) => q.eq("runId", scenario.runId))
                .take(129);
            const target = claims.at(-1);
            const passage = await ctx.db.query("sourcePassages").first();
            const version = passage
                ? await ctx.db.get(passage.sourceVersionId)
                : null;
            const source = version ? await ctx.db.get(version.sourceId) : null;
            const item = await ctx.db
                .query("sourceSelectionProposalItems")
                .first();
            if (!target || !passage || !version || !source || !item)
                throw new Error("Missing policy fixture");
            const sourceId = await ctx.db.insert("sources", {
                runId: scenario.runId,
                canonicalUrl: "https://example.com/sec/missing-artifact",
                title: "Missing source artifact",
                origin: "sec",
                category: source.category,
                createdAt: 100,
            });
            const decisionId = await ctx.db.insert("sourceDecisions", {
                runId: scenario.runId,
                corpusRevisionId: scenario.corpusRevisionId,
                sourceId,
                decisionKey: "missing-artifact-decision",
                decision: "accepted",
                reviewerVisitorId: scenario.visitorId,
                occurredAt: 100,
            });
            await ctx.db.insert("sourceReviewItems", {
                runId: scenario.runId,
                corpusRevisionId: scenario.corpusRevisionId,
                sourceId,
                decisionRank: 0,
                sourceCreatedAt: 100,
                decision: "accepted",
                latestDecisionId: decisionId,
                decisionOccurredAt: 100,
            });
            const {
                _id: _itemId,
                _creationTime: _itemTime,
                ...itemData
            } = item;
            await ctx.db.insert("sourceSelectionProposalItems", {
                ...itemData,
                sourceId,
            });
            const storageId = await ctx.storage.store(
                new Blob(["removed artifact"]),
            );
            await ctx.storage.delete(storageId);
            const {
                _id: _versionId,
                _creationTime: _versionTime,
                ...versionData
            } = version;
            const sourceVersionId = await ctx.db.insert("sourceVersions", {
                ...versionData,
                sourceId,
                acceptedDecisionId: decisionId,
                storageId,
            });
            await ctx.db.insert("evidenceSourceStatuses", {
                runId: scenario.runId,
                corpusRevisionId: scenario.corpusRevisionId,
                sourceId,
                acceptedDecisionId: decisionId,
                sourceVersionId,
                executionGeneration: 1,
                status: "succeeded",
                createdAt: 100,
                updatedAt: 100,
            });
            const {
                _id: _passageId,
                _creationTime: _passageTime,
                ...passageData
            } = passage;
            const missingPassageId = await ctx.db.insert("sourcePassages", {
                ...passageData,
                sourceVersionId,
                passageKey: "missing-artifact-passage",
            });
            await ctx.db.patch(passage._id, {
                locator: {
                    ...passage.locator,
                    startOffset: 1,
                    endOffset: passage.exactQuotation.length + 1,
                },
            });
            const rows = await ctx.db
                .query("claimEvidence")
                .withIndex("by_claim", (q) => q.eq("claimId", target._id))
                .take(33);
            await ctx.db.patch(target._id, { classification: "Fact" });
            for (const row of rows) await ctx.db.delete(row._id);
            for (const sourcePassageId of missingFirst
                ? [missingPassageId, passage._id]
                : [passage._id, missingPassageId]) {
                await ctx.db.insert("claimEvidence", {
                    claimId: target._id,
                    sourcePassageId,
                    relation: "supporting",
                    proposingTaskId: target.proposingTaskId,
                    createdAt: 100,
                });
            }
            return target._id;
        });
        const result = await t.action(evaluatePolicyForRun, {
            runId: scenario.runId,
            executionGeneration: 1,
        });
        expect(result.blockedCount).toBeGreaterThan(0);
        const evaluation = await t.run((ctx) =>
            ctx.db
                .query("policyEvaluations")
                .withIndex("by_claim", (q) => q.eq("claimId", targetClaimId))
                .unique(),
        );
        expect(evaluation?.structuralResult).toEqual({
            status: "blocked",
            ruleId: missingFirst
                ? STRUCTURAL_RULE_IDS.ARTIFACT_MISSING
                : STRUCTURAL_RULE_IDS.QUOTATION_NOT_REPRODUCIBLE,
        });
    });

    test("semantic verifier persists only for explicit support-counter conflict and replays identity", async () => {
        const t = convexTest(schema, modules);
        rateLimiterTest.register(t);
        workflowTest.register(t);
        const scenario = await createPolicyScenario(t);
        const inputData = await t.query(getNormalizedClaimInput, {
            runId: scenario.runId,
            executionGeneration: 1,
        });
        if (!inputData) throw new Error("Missing inputData");
        registerCccShowcaseFixture(inputData.normalizedInput);
        await t.mutation(generateClaimsForRun, {
            runId: scenario.runId,
            executionGeneration: 1,
        });
        const verifierInput = await t.run(
            async (ctx): Promise<VerifierInput> => {
                const claims = await ctx.db
                    .query("claims")
                    .withIndex("by_run", (query) =>
                        query.eq("runId", scenario.runId),
                    )
                    .take(129);
                for (const claim of claims) {
                    const evidence = await ctx.db
                        .query("claimEvidence")
                        .withIndex("by_claim", (query) =>
                            query.eq("claimId", claim._id),
                        )
                        .take(33);
                    if (
                        !evidence.some((item) => item.relation === "supporting")
                    )
                        continue;
                    const passages = await ctx.db
                        .query("sourcePassages")
                        .take(10);
                    const unused = passages.find(
                        (passage) =>
                            !evidence.some(
                                (item) => item.sourcePassageId === passage._id,
                            ),
                    );
                    if (!unused?.passageKey) continue;
                    await ctx.db.insert("claimEvidence", {
                        claimId: claim._id,
                        sourcePassageId: unused._id,
                        relation: "counter",
                        proposingTaskId: claim.proposingTaskId,
                        createdAt: 100,
                    });
                    const allEvidence = [
                        ...evidence,
                        { sourcePassageId: unused._id },
                    ];
                    const references = [];
                    for (const item of allEvidence) {
                        const passage = await ctx.db.get(item.sourcePassageId);
                        if (!passage?.passageKey)
                            throw new Error("Missing passage key");
                        references.push({
                            sourcePassageId: passage._id,
                            passageKey: passage.passageKey,
                        });
                    }
                    return {
                        schemaVersion: VERIFIER_SCHEMA_VERSION,
                        adapterVersion: VERIFIER_ADAPTER_VERSION,
                        claimId: claim._id,
                        ruleId: "policy.semantic_conflict",
                        statement: claim.statement,
                        evidenceReferences: references,
                    };
                }
                throw new Error("Missing supporting claim");
            },
        );
        const inputHash = computeVerifierInputHash(verifierInput);
        registerShowcaseVerifier({
            schemaVersion: VERIFIER_SCHEMA_VERSION,
            adapterVersion: VERIFIER_ADAPTER_VERSION,
            inputHash,
            output: {
                label: "mixed",
                evidenceReferences: verifierInput.evidenceReferences,
            },
        });

        await t.action(evaluatePolicyForRun, {
            runId: scenario.runId,
            executionGeneration: 1,
        });
        await t.action(evaluatePolicyForRun, {
            runId: scenario.runId,
            executionGeneration: 1,
        });
        await t.run(async (ctx) => {
            const tasks = await ctx.db
                .query("aiTaskResults")
                .withIndex("by_run", (query) =>
                    query.eq("runId", scenario.runId),
                )
                .take(129);
            const verifierTasks = tasks.filter(
                (task) => task.taskType === "semantic_verification",
            );
            expect(verifierTasks).toHaveLength(1);
            expect(verifierTasks[0]?.inputHash).toBe(inputHash);
            expect(verifierTasks[0]?.output.kind).toBe("semantic_verification");
            const evaluations = await ctx.db
                .query("policyEvaluations")
                .withIndex("by_run", (query) =>
                    query.eq("runId", scenario.runId),
                )
                .take(129);
            expect(
                evaluations.filter(
                    (evaluation) => evaluation.verifierTaskId !== undefined,
                ),
            ).toHaveLength(1);
        });
    });

    test("tampered locator persists structural block and never invokes verifier", async () => {
        const t = convexTest(schema, modules);
        rateLimiterTest.register(t);
        workflowTest.register(t);
        const scenario = await createPolicyScenario(t);
        const inputData = await t.query(getNormalizedClaimInput, {
            runId: scenario.runId,
            executionGeneration: 1,
        });
        if (!inputData) throw new Error("Missing inputData");
        registerCccShowcaseFixture(inputData.normalizedInput);
        await t.mutation(generateClaimsForRun, {
            runId: scenario.runId,
            executionGeneration: 1,
        });
        await t.run(async (ctx) => {
            const passage = await ctx.db.query("sourcePassages").first();
            if (!passage) throw new Error("Missing passage");
            await ctx.db.patch(passage._id, {
                locator: {
                    ...passage.locator,
                    exactQuotation: `${passage.locator.exactQuotation}!`,
                },
            });
        });

        const result = await t.action(evaluatePolicyForRun, {
            runId: scenario.runId,
            executionGeneration: 1,
        });
        expect(result.blockedCount).toBeGreaterThan(0);
        await t.run(async (ctx) => {
            const evaluations = await ctx.db
                .query("policyEvaluations")
                .withIndex("by_run", (query) =>
                    query.eq("runId", scenario.runId),
                )
                .take(129);
            expect(
                evaluations.some(
                    (evaluation) =>
                        evaluation.structuralResult.status === "blocked" &&
                        evaluation.structuralResult.ruleId ===
                            STRUCTURAL_RULE_IDS.QUOTATION_NOT_REPRODUCIBLE,
                ),
            ).toBe(true);
            const verifierTasks = await ctx.db
                .query("aiTaskResults")
                .withIndex("by_run", (query) =>
                    query.eq("runId", scenario.runId),
                )
                .take(129);
            expect(
                verifierTasks.filter(
                    (task) => task.taskType === "semantic_verification",
                ),
            ).toHaveLength(0);
        });
    });

    // Task 7 review repairs: stale-question structural block, recency exact
    // reason codes, publisher-independent corroboration, verifier replay
    // immutability, and policy-payload bounds.

    test("Unknown claim with a stale question ID is structurally blocked", () => {
        const current = new Set<Id<"researchPlanQuestions">>([
            "current-q" as Id<"researchPlanQuestions">,
        ]);
        const input: ClaimStructuralInput = {
            statement: "An unknown claim resolved against an old plan",
            classification: "Unknown",
            evidence: [
                {
                    sourcePassageId: "pass" as any,
                    passageKey: "pk",
                    quotationHash: "qh",
                    relation: "context",
                },
            ],
            dimensionLinks: [],
            researchPlanQuestionId: "stale-q" as Id<"researchPlanQuestions">,
            currentQuestionIds: current,
        };
        const result = validateClaimStructure(input);
        expect(result.status).toBe("blocked");
        if (result.status === "blocked") {
            expect(result.ruleId).toBe(
                STRUCTURAL_RULE_IDS.QUESTION_NOT_CURRENT,
            );
        }
    });

    test("recency treats future and stale dates as needs_review with distinct reasons", () => {
        const base = structuredClone(basePolicyInputs);
        const future = evaluateEvidencePolicy({
            ...base,
            supportingSourceIds: ["source-1"],
            sources: [
                {
                    sourceId: "source-1",
                    origin: "sec",
                    category: "regulatory_filing",
                    secForm: "10-K",
                    authorityTier: "regulator_primary",
                    documentKind: "regulatory_annual",
                    publisherIdentity: "sec.gov",
                    publishedAt: base.asOfTime + 1000,
                },
            ],
        });
        const futureRule = future.rules.find(
            (rule) => rule.ruleId === POLICY_RULE_IDS.RECENCY,
        );
        expect(futureRule?.outcome).toBe("needs_review");
        expect(futureRule?.reasonCode).toBe("publication_date_future");

        const stale = evaluateEvidencePolicy({
            ...base,
            supportingSourceIds: ["source-1"],
            sources: [
                {
                    sourceId: "source-1",
                    origin: "sec",
                    category: "regulatory_filing",
                    secForm: "10-K",
                    authorityTier: "regulator_primary",
                    documentKind: "regulatory_annual",
                    publisherIdentity: "sec.gov",
                    publishedAt: base.asOfTime - 3 * 365 * 24 * 60 * 60 * 1000,
                },
            ],
        });
        const staleRule = stale.rules.find(
            (rule) => rule.ruleId === POLICY_RULE_IDS.RECENCY,
        );
        expect(staleRule?.outcome).toBe("needs_review");
        expect(staleRule?.reasonCode).toBe("publication_date_stale");
    });

    test("corroboration counts distinct independent publishers, not sources", () => {
        const same = evaluateEvidencePolicy({
            ...basePolicyInputs,
            supportingSourceIds: ["a", "b"],
            sources: [
                {
                    sourceId: "a",
                    origin: "sec",
                    category: "regulatory_filing",
                    secForm: "10-K",
                    authorityTier: "regulator_primary",
                    documentKind: "regulatory_annual",
                    publisherIdentity: "sec.gov",
                    publishedAt: 1_790_000_000_000,
                },
                {
                    sourceId: "b",
                    origin: "sec",
                    category: "regulatory_filing",
                    secForm: "10-K",
                    authorityTier: "regulator_primary",
                    documentKind: "regulatory_annual",
                    publisherIdentity: "sec.gov",
                    publishedAt: 1_790_000_000_000,
                },
            ],
            distinctSourceCount: 2,
            distinctPublisherCount: 1,
        });
        const rule = same.rules.find(
            (rule) => rule.ruleId === POLICY_RULE_IDS.CORROBORATION,
        );
        expect(rule?.outcome).toBe("needs_review");
        expect(rule?.reasonCode).toBe("single_publisher_only");
    });

    test("derivePublisherIdentity collapses cross-subdomains to one controlling domain", () => {
        expect(
            derivePublisherIdentity(
                "https://research.publisher.example/report",
            ),
        ).toBe("publisher.example");
        expect(
            derivePublisherIdentity("https://news.publisher.example/article"),
        ).toBe("publisher.example");
        // Same hostname and www-prefixed variant share the key.
        expect(derivePublisherIdentity("https://publisher.example/root")).toBe(
            "publisher.example",
        );
        expect(
            derivePublisherIdentity("https://www.publisher.example/root"),
        ).toBe("publisher.example");
        // A known multi-label public suffix keeps its registrable span.
        expect(derivePublisherIdentity("https://bbc.co.uk/news")).toBe(
            "bbc.co.uk",
        );
        // Invalid and IP-literal hosts have no registrable identity.
        expect(derivePublisherIdentity("not a url")).toBeUndefined();
        expect(derivePublisherIdentity("https://192.168.1.1/admin")).toBe(
            undefined,
        );
    });

    test("missing publisher identity is never independent corroboration", () => {
        const missing = evaluateEvidencePolicy({
            ...basePolicyInputs,
            supportingSourceIds: ["a", "b"],
            sources: [
                {
                    sourceId: "a",
                    origin: "sec",
                    category: "regulatory_filing",
                    authorityTier: "regulator_primary",
                    documentKind: "regulatory_annual",
                    publisherIdentity: "",
                    publishedAt: 1_790_000_000_000,
                },
                {
                    sourceId: "b",
                    origin: "exa",
                    category: "industry_analysis",
                    authorityTier: "institutional_independent",
                    documentKind: "independent_analysis",
                    publisherIdentity: "reuters.com",
                    publishedAt: 1_790_000_000_000,
                },
            ],
            distinctSourceCount: 2,
            distinctPublisherCount: 1,
        });
        const rule = missing.rules.find(
            (rule) => rule.ruleId === POLICY_RULE_IDS.CORROBORATION,
        );
        expect(rule?.outcome).toBe("needs_review");
        expect(rule?.reasonCode).toBe("publisher_identity_unavailable");
    });

    test("verifier registry entry for a hash is immutable", async () => {
        const input: VerifierInput = {
            schemaVersion: VERIFIER_SCHEMA_VERSION,
            adapterVersion: VERIFIER_ADAPTER_VERSION,
            claimId: "claim-x" as Id<"claims">,
            ruleId: "policy.semantic_conflict",
            statement: "Conflict statement",
            evidenceReferences: [
                {
                    sourcePassageId: "pass-1" as Id<"sourcePassages">,
                    passageKey: "k1",
                },
                {
                    sourcePassageId: "pass-2" as Id<"sourcePassages">,
                    passageKey: "k2",
                },
            ],
        };
        const hash = computeVerifierInputHash(input);
        registerShowcaseVerifier({
            schemaVersion: VERIFIER_SCHEMA_VERSION,
            adapterVersion: VERIFIER_ADAPTER_VERSION,
            inputHash: hash,
            output: {
                label: "mixed",
                evidenceReferences: input.evidenceReferences,
            },
        });
        expect(() =>
            registerShowcaseVerifier({
                schemaVersion: VERIFIER_SCHEMA_VERSION,
                adapterVersion: VERIFIER_ADAPTER_VERSION,
                inputHash: hash,
                output: {
                    label: "contradicted",
                    evidenceReferences: input.evidenceReferences,
                },
            }),
        ).toThrow(/replay mismatch/);
    });

    test("verifier register and execute reject overlong statement, rule id, and references", () => {
        const baseInput: VerifierInput = {
            schemaVersion: VERIFIER_SCHEMA_VERSION,
            adapterVersion: VERIFIER_ADAPTER_VERSION,
            claimId: "claim-x" as Id<"claims">,
            ruleId: "policy.semantic_conflict",
            statement: "Statement",
            evidenceReferences: [
                {
                    sourcePassageId:
                        "sourcePassages:pass-1" as Id<"sourcePassages">,
                    passageKey: "k1",
                },
            ],
        };

        expect(() =>
            executeShowcaseVerifier({
                ...baseInput,
                statement: "s".repeat(1001),
            }),
        ).toThrow(/exceeds upper bound/);
        expect(() =>
            executeShowcaseVerifier({
                ...baseInput,
                ruleId: "r".repeat(65),
            }),
        ).toThrow(/exceeds upper bound/);
        expect(() =>
            executeShowcaseVerifier({
                ...baseInput,
                evidenceReferences: [
                    {
                        sourcePassageId:
                            "sourcePassages:pass-1" as Id<"sourcePassages">,
                        passageKey: "k".repeat(257),
                    },
                ],
            }),
        ).toThrow(/exceeds upper bound/);
        expect(() =>
            executeShowcaseVerifier({
                ...baseInput,
                evidenceReferences: [
                    {
                        sourcePassageId: (`sourcePassages:` +
                            "s".repeat(400)) as Id<"sourcePassages">,
                        passageKey: "k1",
                    },
                ],
            }),
        ).toThrow(/exceeds upper bound/);

        // Registration is a real boundary too: an oversized reference in the
        // registry entry must never be accepted.
        expect(() =>
            registerShowcaseVerifier({
                schemaVersion: VERIFIER_SCHEMA_VERSION,
                adapterVersion: VERIFIER_ADAPTER_VERSION,
                inputHash: "registration-hash",
                output: {
                    label: "entailed",
                    evidenceReferences: [
                        {
                            sourcePassageId:
                                "sourcePassages:pass-1" as Id<"sourcePassages">,
                            passageKey: "k".repeat(257),
                        },
                    ],
                },
            }),
        ).toThrow(/exceeds upper bound/);
    });

    test("commitEvaluation rejects oversized reason, rule, source, publisher, and inputHash before any row is written", async () => {
        const t = convexTest(schema, modules);
        rateLimiterTest.register(t);
        workflowTest.register(t);

        const scenario = await createPolicyScenario(t);
        const inputData = await t.query(getNormalizedClaimInput, {
            runId: scenario.runId,
            executionGeneration: 1,
        });
        if (!inputData) throw new Error("Missing inputData");
        registerCccShowcaseFixture(inputData.normalizedInput);
        const generation = await t.mutation(generateClaimsForRun, {
            runId: scenario.runId,
            executionGeneration: 1,
        });
        expect(generation.status).toBe("succeeded");
        const claimId = await t.run(async (ctx) => {
            const claims = await ctx.db
                .query("claims")
                .withIndex("by_run", (query) =>
                    query.eq("runId", scenario.runId),
                )
                .take(1);
            return claims[0]?._id;
        });
        if (!claimId) throw new Error("Missing claim");

        const baseArgs = {
            runId: scenario.runId,
            executionGeneration: 1,
            corpusRevisionId: scenario.corpusRevisionId,
            claimId,
            normalizedInputs: {
                classification: "Fact",
                asOfTime: 1_800_000_000_000,
                supportingSourceIds: [],
                sources: [
                    {
                        sourceId: "s1",
                        origin: "sec",
                        category: "regulatory_filing",
                        publisherIdentity: "sec.gov",
                        authorityTier: "regulator_primary",
                        documentKind: "regulatory_annual",
                    },
                ],
                supportingEvidenceCount: 0,
                counterEvidenceCount: 0,
                contextEvidenceCount: 0,
                distinctSourceCount: 1,
                distinctPublisherCount: 1,
                distinctPassageCount: 1,
                unresolvedCounterCount: 0,
                coveredQuestionCount: 1,
                totalQuestionCount: 1,
                currentPlanQuestionCovered: true,
            },
            structuralResult: { status: "valid" as const },
            rules: [],
            reasonCodes: [],
            result: "pass" as const,
            inputHash: "hash",
            citedEvidence: [],
            createdAt: 100,
        };
        const oversizedSource = (
            sourceId: string,
            publisherIdentity: string,
        ) => ({
            ...baseArgs,
            normalizedInputs: {
                ...baseArgs.normalizedInputs,
                sources: [
                    {
                        sourceId,
                        origin: "sec",
                        category: "regulatory_filing",
                        publisherIdentity,
                        authorityTier: "regulator_primary",
                        documentKind: "regulatory_annual",
                    },
                ],
            },
        });
        const oversized = [
            { ...baseArgs, inputHash: "i".repeat(129) },
            {
                ...baseArgs,
                rules: [
                    {
                        ruleId: "r".repeat(65),
                        outcome: "pass",
                        reasonCode: "ok",
                    },
                ],
            },
            { ...baseArgs, reasonCodes: ["m".repeat(65)] },
            oversizedSource("s".repeat(129), "sec.gov"),
            oversizedSource("s1", "p".repeat(129)),
            // Structural rule id bound.
            {
                ...baseArgs,
                structuralResult: {
                    status: "blocked" as const,
                    ruleId: "r".repeat(65),
                },
            },
            // Normalized source secForm bound.
            {
                ...baseArgs,
                normalizedInputs: {
                    ...baseArgs.normalizedInputs,
                    sources: [
                        {
                            sourceId: "s1",
                            origin: "sec",
                            category: "regulatory_filing",
                            secForm: "s".repeat(65),
                            publisherIdentity: "sec.gov",
                            authorityTier: "regulator_primary",
                            documentKind: "regulatory_annual",
                        },
                    ],
                },
            },
            // Verifier input hash bound.
            {
                ...baseArgs,
                verifier: {
                    inputHash: "i".repeat(129),
                    output: {
                        label: "entailed" as const,
                        evidenceReferences: [],
                    },
                },
            },
            // Verifier output passage key bound.
            {
                ...baseArgs,
                verifier: {
                    inputHash: "vhash",
                    output: {
                        label: "entailed" as const,
                        evidenceReferences: [
                            {
                                sourcePassageId:
                                    "00000sourcePassages" as Id<"sourcePassages">,
                                passageKey: "k".repeat(257),
                            },
                        ],
                    },
                },
            },
            // Verifier output source passage identity bound.
            {
                ...baseArgs,
                verifier: {
                    inputHash: "vhash2",
                    output: {
                        label: "entailed" as const,
                        evidenceReferences: [
                            {
                                sourcePassageId: ("0".repeat(400) +
                                    "sourcePassages") as Id<"sourcePassages">,
                                passageKey: "k1",
                            },
                        ],
                    },
                },
            },
        ];
        for (const args of oversized) {
            await expect(t.mutation(commitEvaluation, args)).rejects.toThrow(
                /exceeds upper bound/,
            );
        }
        // Verifier output evidence reference ARRAY COUNT is bounded separately
        // (not a string ceiling), still before any insert.
        await expect(
            t.mutation(commitEvaluation, {
                ...baseArgs,
                verifier: {
                    inputHash: "vhash3",
                    output: {
                        label: "entailed" as const,
                        evidenceReferences: Array.from(
                            { length: MAX_VERIFIER_EVIDENCE_REFERENCES + 1 },
                            (_, index) => ({
                                sourcePassageId:
                                    "00000sourcePassages" as Id<"sourcePassages">,
                                passageKey: `pk${index}`,
                            }),
                        ),
                    },
                },
            }),
        ).rejects.toThrow(/evidence references exceed bounds/);
        await t.run(async (ctx) => {
            const evaluations = await ctx.db
                .query("policyEvaluations")
                .withIndex("by_run", (query) =>
                    query.eq("runId", scenario.runId),
                )
                .take(129);
            expect(evaluations).toHaveLength(0);
            const tasks = await ctx.db
                .query("aiTaskResults")
                .withIndex("by_run", (query) =>
                    query.eq("runId", scenario.runId),
                )
                .take(129);
            expect(
                tasks.filter(
                    (task) => task.taskType === "semantic_verification",
                ),
            ).toHaveLength(0);
        });
    });

    test("storage-backed Unknown on a stale question is structurally blocked with zero verifier", async () => {
        const t = convexTest(schema, modules);
        rateLimiterTest.register(t);
        workflowTest.register(t);

        const scenario = await createPolicyScenario(t);
        const inputData = await t.query(getNormalizedClaimInput, {
            runId: scenario.runId,
            executionGeneration: 1,
        });
        if (!inputData) throw new Error("Missing inputData");
        registerCccShowcaseFixture(inputData.normalizedInput);
        const generation = await t.mutation(generateClaimsForRun, {
            runId: scenario.runId,
            executionGeneration: 1,
        });
        expect(generation.status).toBe("succeeded");

        const unknownClaim = await t.run(async (ctx) => {
            const claims = await ctx.db
                .query("claims")
                .withIndex("by_run", (query) =>
                    query.eq("runId", scenario.runId),
                )
                .take(129);
            const unknown = claims.find(
                (claim) => claim.classification === "Unknown",
            );
            if (!unknown) throw new Error("Missing Unknown claim");
            if (!unknown.researchPlanQuestionId) {
                throw new Error("Unknown claim missing researchPlanQuestionId");
            }
            // Replace the latest plan so the persisted question is no longer
            // part of the current plan at evaluation time.
            const planId = await ctx.db.insert("researchPlans", {
                runId: scenario.runId,
                version: 3,
                coveragePreset: "balanced",
                queries: [],
                createdAt: 100,
            });
            for (const dimensionKey of [
                "workflow_control",
                "data_defensibility",
                "switching_costs",
            ]) {
                await ctx.db.insert("researchPlanQuestions", {
                    runId: scenario.runId,
                    researchPlanId: planId,
                    planVersion: 3,
                    questionKey: `dimension:${dimensionKey}`,
                    prompt: `What public evidence addresses ${dimensionKey}?`,
                    dimensionKeys: [dimensionKey],
                    createdAt: 100,
                });
            }
            return { claimId: unknown._id };
        });

        const policy = await t.action(evaluatePolicyForRun, {
            runId: scenario.runId,
            executionGeneration: 1,
        });
        expect(policy.blockedCount).toBeGreaterThan(0);
        await t.run(async (ctx) => {
            const evaluations = await ctx.db
                .query("policyEvaluations")
                .withIndex("by_run", (query) =>
                    query.eq("runId", scenario.runId),
                )
                .take(129);
            const unknownEvaluation = evaluations.find(
                (evaluation) => evaluation.claimId === unknownClaim.claimId,
            );
            expect(unknownEvaluation?.structuralResult).toEqual({
                status: "blocked",
                ruleId: STRUCTURAL_RULE_IDS.QUESTION_NOT_CURRENT,
            });
            expect(unknownEvaluation?.result).toBe("blocked");
            const tasks = await ctx.db
                .query("aiTaskResults")
                .withIndex("by_run", (query) =>
                    query.eq("runId", scenario.runId),
                )
                .take(129);
            expect(
                tasks.filter(
                    (task) => task.taskType === "semantic_verification",
                ),
            ).toHaveLength(0);
        });
    });

    test("missing proposal projection blocks with SOURCE_AUTHORITY_MISSING and never infers authority", async () => {
        const t = convexTest(schema, modules);
        rateLimiterTest.register(t);
        workflowTest.register(t);

        const scenario = await createPolicyScenario(t, {
            withProposal: false,
        });
        const inputData = await t.query(getNormalizedClaimInput, {
            runId: scenario.runId,
            executionGeneration: 1,
        });
        if (!inputData) throw new Error("Missing inputData");
        registerCccShowcaseFixture(inputData.normalizedInput);
        const generation = await t.mutation(generateClaimsForRun, {
            runId: scenario.runId,
            executionGeneration: 1,
        });
        expect(generation.status).toBe("succeeded");

        const policy = await t.action(evaluatePolicyForRun, {
            runId: scenario.runId,
            executionGeneration: 1,
        });
        expect(policy.blockedCount).toBe(generation.claimCount);
        await t.run(async (ctx) => {
            const evaluations = await ctx.db
                .query("policyEvaluations")
                .withIndex("by_run", (query) =>
                    query.eq("runId", scenario.runId),
                )
                .take(129);
            expect(evaluations).toHaveLength(generation.claimCount);
            for (const evaluation of evaluations) {
                expect(evaluation.structuralResult.status).toBe("blocked");
                if (evaluation.structuralResult.status === "blocked") {
                    expect(evaluation.structuralResult.ruleId).toBe(
                        STRUCTURAL_RULE_IDS.SOURCE_AUTHORITY_MISSING,
                    );
                }
                // Structural block means the deterministic policy never ran:
                // no authority rule, therefore never a high-authority pass.
                expect(evaluation.rules).toHaveLength(0);
            }
            const tasks = await ctx.db
                .query("aiTaskResults")
                .withIndex("by_run", (query) =>
                    query.eq("runId", scenario.runId),
                )
                .take(129);
            expect(
                tasks.filter(
                    (task) => task.taskType === "semantic_verification",
                ),
            ).toHaveLength(0);
        });
    });

    test("verifier replay with a different resolved output is rejected without new task or evaluation", async () => {
        const t = convexTest(schema, modules);
        rateLimiterTest.register(t);
        workflowTest.register(t);

        const scenario = await createPolicyScenario(t);
        const inputData = await t.query(getNormalizedClaimInput, {
            runId: scenario.runId,
            executionGeneration: 1,
        });
        if (!inputData) throw new Error("Missing inputData");
        registerCccShowcaseFixture(inputData.normalizedInput);
        await t.mutation(generateClaimsForRun, {
            runId: scenario.runId,
            executionGeneration: 1,
        });

        const verifierInput = await t.run(
            async (ctx): Promise<VerifierInput> => {
                const claims = await ctx.db
                    .query("claims")
                    .withIndex("by_run", (query) =>
                        query.eq("runId", scenario.runId),
                    )
                    .take(129);
                for (const claim of claims) {
                    const evidence = await ctx.db
                        .query("claimEvidence")
                        .withIndex("by_claim", (query) =>
                            query.eq("claimId", claim._id),
                        )
                        .take(33);
                    if (
                        !evidence.some((item) => item.relation === "supporting")
                    )
                        continue;
                    const passages = await ctx.db
                        .query("sourcePassages")
                        .take(10);
                    const unused = passages.find(
                        (passage) =>
                            !evidence.some(
                                (item) => item.sourcePassageId === passage._id,
                            ),
                    );
                    if (!unused?.passageKey) continue;
                    await ctx.db.insert("claimEvidence", {
                        claimId: claim._id,
                        sourcePassageId: unused._id,
                        relation: "counter",
                        proposingTaskId: claim.proposingTaskId,
                        createdAt: 100,
                    });
                    const references = [];
                    for (const item of [
                        ...evidence,
                        { sourcePassageId: unused._id },
                    ]) {
                        const passage = await ctx.db.get(item.sourcePassageId);
                        if (!passage?.passageKey)
                            throw new Error("Missing passage key");
                        references.push({
                            sourcePassageId: passage._id,
                            passageKey: passage.passageKey,
                        });
                    }
                    return {
                        schemaVersion: VERIFIER_SCHEMA_VERSION,
                        adapterVersion: VERIFIER_ADAPTER_VERSION,
                        claimId: claim._id,
                        ruleId: "policy.semantic_conflict",
                        statement: claim.statement,
                        evidenceReferences: references,
                    };
                }
                throw new Error("Missing supporting claim");
            },
        );
        const inputHash = computeVerifierInputHash(verifierInput);
        registerShowcaseVerifier({
            schemaVersion: VERIFIER_SCHEMA_VERSION,
            adapterVersion: VERIFIER_ADAPTER_VERSION,
            inputHash,
            output: {
                label: "mixed",
                evidenceReferences: verifierInput.evidenceReferences,
            },
        });

        const first = await t.action(evaluatePolicyForRun, {
            runId: scenario.runId,
            executionGeneration: 1,
        });
        expect(first.blockedCount).toBe(0);
        await t.run(async (ctx) => {
            const tasks = await ctx.db
                .query("aiTaskResults")
                .withIndex("by_run", (query) =>
                    query.eq("runId", scenario.runId),
                )
                .take(129);
            expect(
                tasks.filter(
                    (task) => task.taskType === "semantic_verification",
                ),
            ).toHaveLength(1);
        });

        // Same input hash resolves to a different output on replay: the
        // commit boundary must reject it and write nothing new.
        clearShowcaseVerifiers();
        registerShowcaseVerifier({
            schemaVersion: VERIFIER_SCHEMA_VERSION,
            adapterVersion: VERIFIER_ADAPTER_VERSION,
            inputHash,
            output: {
                label: "contradicted",
                evidenceReferences: verifierInput.evidenceReferences,
            },
        });
        await expect(
            t.action(evaluatePolicyForRun, {
                runId: scenario.runId,
                executionGeneration: 1,
            }),
        ).rejects.toThrow(/replay output mismatch/);
        await t.run(async (ctx) => {
            const tasks = await ctx.db
                .query("aiTaskResults")
                .withIndex("by_run", (query) =>
                    query.eq("runId", scenario.runId),
                )
                .take(129);
            expect(
                tasks.filter(
                    (task) => task.taskType === "semantic_verification",
                ),
            ).toHaveLength(1);
            const evaluations = await ctx.db
                .query("policyEvaluations")
                .withIndex("by_run", (query) =>
                    query.eq("runId", scenario.runId),
                )
                .take(129);
            expect(evaluations).toHaveLength(first.evaluationCount);
            expect(
                evaluations.filter(
                    (evaluation) => evaluation.verifierTaskId !== undefined,
                ),
            ).toHaveLength(1);
        });
    });

    test("persisted selection gap creates no Unknown claim and derives zero stored coverage", async () => {
        const t = convexTest(schema, modules);
        rateLimiterTest.register(t);
        workflowTest.register(t);

        const scenario = await createPolicyScenario(t);
        // The shared scenario seeds a proposal with failedDiscoveryFamilies
        // and coverageGaps; the gap is persisted state, not a claim trigger.
        const inputData = await t.query(getNormalizedClaimInput, {
            runId: scenario.runId,
            executionGeneration: 1,
        });
        if (!inputData) throw new Error("Missing inputData");
        const manifestClaims: ShowcaseClaimOutput[] = [
            {
                statement:
                    "CCC network connects approximately 30,000 repair facilities.",
                classification: "Fact",
                evidence: [
                    {
                        quotationHash:
                            inputData.normalizedInput.passages[0].quotationHash,
                        passageKey:
                            inputData.normalizedInput.passages[0].passageKey,
                        sourceVersionHash:
                            inputData.normalizedInput.passages[0]
                                .sourceVersionHash,
                        relation: "supporting",
                    },
                ],
                dimensionLinks: [],
            },
            {
                statement:
                    "Multi-modal generative models may alter estimating logic.",
                classification: "Inference",
                evidence: [
                    {
                        quotationHash:
                            inputData.normalizedInput.passages[1].quotationHash,
                        passageKey:
                            inputData.normalizedInput.passages[1].passageKey,
                        sourceVersionHash:
                            inputData.normalizedInput.passages[1]
                                .sourceVersionHash,
                        relation: "supporting",
                    },
                ],
                dimensionLinks: [],
            },
        ];
        registerShowcaseManifest({
            fixtureId: "selection-gap-fixture",
            fixtureVersion: SHOWCASE_FIXTURE_VERSION,
            schemaVersion: CLAIM_SCHEMA_VERSION,
            adapterVersion: SHOWCASE_ADAPTER_VERSION,
            inputHash: inputData.inputHash,
            claims: manifestClaims,
        });
        const questionsBefore = await t.run(async (ctx) => {
            const questions = await ctx.db
                .query("researchPlanQuestions")
                .withIndex("by_run", (query) =>
                    query.eq("runId", scenario.runId),
                )
                .take(129);
            return questions.map((question) => ({
                _id: question._id,
                planVersion: question.planVersion,
                questionKey: question.questionKey,
                prompt: question.prompt,
            }));
        });

        const generation = await t.mutation(generateClaimsForRun, {
            runId: scenario.runId,
            executionGeneration: 1,
        });
        expect(generation.status).toBe("succeeded");
        expect(generation.claimCount).toBe(2);
        await t.run(async (ctx) => {
            const allClaims = await ctx.db
                .query("claims")
                .withIndex("by_run", (query) =>
                    query.eq("runId", scenario.runId),
                )
                .take(129);
            expect(allClaims).toHaveLength(2);
            expect(
                allClaims.filter((claim) => claim.classification === "Unknown"),
            ).toHaveLength(0);
            expect(
                allClaims.every(
                    (claim) =>
                        claim.classification === "Fact" ||
                        claim.classification === "Inference",
                ),
            ).toBe(true);
            // Coverage is derived from claims, never persisted: no claim
            // references a question, so derived coverage is empty and the
            // question rows carry no coverage mutation.
            const coverage = deriveQuestionCoverage(allClaims);
            expect(coverage.size).toBe(0);
            const questionsAfter = await ctx.db
                .query("researchPlanQuestions")
                .withIndex("by_run", (query) =>
                    query.eq("runId", scenario.runId),
                )
                .take(129);
            expect(
                questionsAfter.map((question) => ({
                    _id: question._id,
                    planVersion: question.planVersion,
                    questionKey: question.questionKey,
                    prompt: question.prompt,
                })),
            ).toEqual(questionsBefore);
            expect(
                questionsAfter.every((question) => !("coverage" in question)),
            ).toBe(true);
        });
    });
});

test.each([
    "context",
    "counter",
] as const)("%s citations cannot supply authority, recency or corroboration for a claim", (relation) => {
    const originalSource = basePolicyInputs.sources[0];
    if (!originalSource) throw new Error("Missing supporting fixture source");
    const supporting = {
        ...originalSource,
        sourceId: "limited-support",
        authorityTier: "unverified" as const,
        publisherIdentity: "independent.example",
        publishedAt: basePolicyInputs.asOfTime - 3 * 365 * 24 * 60 * 60 * 1000,
    };
    const inputs = {
        ...basePolicyInputs,
        sources: [supporting],
        supportingSourceIds: [supporting.sourceId],
        supportingEvidenceCount: 1,
        distinctSourceCount: 1,
        distinctPublisherCount: 1,
        distinctPassageCount: 1,
    };
    const initial = evaluateEvidencePolicy(inputs);
    const withContext = evaluateEvidencePolicy({
        ...inputs,
        sources: [supporting, ...basePolicyInputs.sources],
        contextEvidenceCount: relation === "context" ? 2 : 0,
        counterEvidenceCount: relation === "counter" ? 2 : 0,
        unresolvedCounterCount: relation === "counter" ? 2 : 0,
        distinctSourceCount: 3,
        distinctPublisherCount: 3,
        distinctPassageCount: 3,
    });
    for (const ruleId of [
        POLICY_RULE_IDS.AUTHORITY,
        POLICY_RULE_IDS.RECENCY,
        POLICY_RULE_IDS.CORROBORATION,
    ]) {
        expect(
            withContext.rules.find((rule) => rule.ruleId === ruleId),
        ).toEqual(initial.rules.find((rule) => rule.ruleId === ruleId));
    }
});

test("persisted policy inputs derive supporting identities from citation relations", async () => {
    const t = convexTest(schema, modules);
    const scenario = await createPolicyScenario(t);
    const input = await t.query(getNormalizedClaimInput, {
        runId: scenario.runId,
        executionGeneration: 1,
    });
    if (!input) throw new Error("Missing claim input");
    registerCccShowcaseFixture(input.normalizedInput);
    await t.mutation(generateClaimsForRun, {
        runId: scenario.runId,
        executionGeneration: 1,
    });
    const claimId = await t.run(async (ctx) => {
        const claim = await ctx.db
            .query("claims")
            .withIndex("by_run", (q) => q.eq("runId", scenario.runId))
            .first();
        if (!claim) throw new Error("Missing fixture claim");
        const evidence = await ctx.db
            .query("claimEvidence")
            .withIndex("by_claim", (q) => q.eq("claimId", claim._id))
            .collect();
        for (const row of evidence)
            await ctx.db.patch(row._id, { relation: "context" });
        return claim._id;
    });
    await t.action(evaluatePolicyForRun, {
        runId: scenario.runId,
        executionGeneration: 1,
    });
    const evaluation = await t.run((ctx) =>
        ctx.db
            .query("policyEvaluations")
            .withIndex("by_claim", (q) => q.eq("claimId", claimId))
            .first(),
    );
    expect(evaluation?.normalizedInputs.supportingSourceIds).toEqual([]);
    expect(evaluation?.normalizedInputs.sources[0]?.publisherIdentity).toBe(
        "issuer:1818201",
    );
    expect(
        evaluation?.rules.find(
            (rule) => rule.ruleId === POLICY_RULE_IDS.AUTHORITY,
        )?.outcome,
    ).toBe("needs_review");
});

test("SEC, corporate and hosted investor-relations documents retain one issuer identity", () => {
    const identities = [
        derivePublisherIdentity("https://www.sec.gov/Archives/company/filing", {
            authorityTier: "regulator_primary",
            issuerCik: "0001373715",
        }),
        derivePublisherIdentity(
            "https://www.servicenow.com/investors/results",
            { authorityTier: "company_primary", issuerCik: "1373715" },
        ),
        derivePublisherIdentity("https://s203.q4cdn.com/results.pdf", {
            authorityTier: "company_hosted_ir",
            issuerCik: "1373715",
        }),
    ];
    expect(identities).toEqual([
        "issuer:1373715",
        "issuer:1373715",
        "issuer:1373715",
    ]);
});

test("unverified domains and partner provenance do not establish editorial independence", () => {
    for (const authorityTier of [
        "unverified",
        "analyst_supplied",
        "qualified_partner",
    ] as const)
        expect(
            derivePublisherIdentity("https://different-host.example/analysis", {
                authorityTier,
            }),
        ).toBeUndefined();
    expect(
        derivePublisherIdentity("https://www.reuters.com/report", {
            authorityTier: "institutional_independent",
        }),
    ).toBe("reuters.com");
});

test.each([
    "file:///private/report",
    "https://127.0.0.1/report",
    "invalid-url",
])("issuer metadata cannot give an invalid source URL a publisher identity: %s", (canonicalUrl) => {
    expect(
        derivePublisherIdentity(canonicalUrl, {
            authorityTier: "company_primary",
            issuerCik: "1373715",
        }),
    ).toBeUndefined();
});
