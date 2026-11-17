import type { Id } from "@convex/_generated/dataModel";
import {
    STRUCTURAL_RULE_IDS,
    type StructuralValidationResult,
    validateClaimStructure,
} from "@convex/domain/claimValidation";
import { assertEvidenceExecutionFence } from "@convex/domain/evidenceAuthority";
import {
    derivePublisherIdentity,
    evaluateEvidencePolicy,
    POLICY_VERSION,
    type PolicyNormalizedInputs,
    type PolicyRuleResult,
    type PolicySourceInput,
} from "@convex/domain/evidencePolicy";
import {
    preparePassageReproduction,
    type SourceLocator,
    sha256Hex,
    sourceLocatorValidator,
} from "@convex/domain/sourcePassages";
import {
    SOURCE_AUTHORITY_TIERS,
    SOURCE_DOCUMENT_KINDS,
} from "@convex/domain/sourceSelectionPolicy";
import {
    readPreparedSourceUsage,
    validatePreparedEvidenceUse,
} from "@convex/domain/sourceUsage";
import {
    computeVerifierInputHash,
    executeShowcaseVerifier,
    VERIFIER_ADAPTER_VERSION,
    VERIFIER_SCHEMA_VERSION,
    type VerifierInput,
    type VerifierOutput,
} from "@convex/integrations/showcaseVerifierAdapter";
import {
    assertWithinLength,
    MAX_CLAIMS_PER_RUN,
    MAX_DIMENSION_LINKS_PER_CLAIM,
    MAX_EVIDENCE_ARTIFACT_BYTES,
    MAX_EVIDENCE_PER_CLAIM,
    MAX_POLICY_INPUT_HASH_CHARS,
    MAX_POLICY_PUBLISHER_IDENTITY_CHARS,
    MAX_POLICY_REASON_CODE_CHARS,
    MAX_POLICY_REASON_CODES,
    MAX_POLICY_RULE_ID_CHARS,
    MAX_POLICY_RULES,
    MAX_POLICY_SOURCE_CATEGORY_CHARS,
    MAX_POLICY_SOURCE_ID_CHARS,
    MAX_POLICY_SOURCE_SEC_FORM_CHARS,
    MAX_VERIFIER_EVIDENCE_REFERENCES,
    MAX_VERIFIER_INPUT_HASH_CHARS,
    MAX_VERIFIER_REFERENCE_IDENTITY_CHARS,
} from "@convex/resourcePolicy";
import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";

import {
    internalAction,
    internalMutation,
    internalQuery,
} from "./_generated/server";
import {
    claimClassificationValidator,
    evidenceRelationValidator,
} from "./domain/claims";
import {
    assessmentDimensionKeyValidator,
    MAX_RESEARCH_PLAN_QUESTIONS,
} from "./domain/researchPlan";

const authorityTierValidator = v.union(
    ...SOURCE_AUTHORITY_TIERS.map((value) => v.literal(value)),
);
const documentKindValidator = v.union(
    ...SOURCE_DOCUMENT_KINDS.map((value) => v.literal(value)),
);
const policySourceInputValidator = v.object({
    sourceId: v.string(),
    origin: v.union(
        v.literal("sec"),
        v.literal("exa"),
        v.literal("analyst_url"),
    ),
    category: v.string(),
    secForm: v.optional(v.string()),
    publisherIdentity: v.string(),
    authorityTier: authorityTierValidator,
    documentKind: documentKindValidator,
    publishedAt: v.optional(v.number()),
});
const normalizedInputsValidator = v.object({
    classification: claimClassificationValidator,
    asOfTime: v.number(),
    sources: v.array(policySourceInputValidator),
    supportingSourceIds: v.array(v.string()),
    supportingEvidenceCount: v.number(),
    counterEvidenceCount: v.number(),
    contextEvidenceCount: v.number(),
    distinctSourceCount: v.number(),
    distinctPublisherCount: v.number(),
    distinctPassageCount: v.number(),
    unresolvedCounterCount: v.number(),
    coveredQuestionCount: v.number(),
    totalQuestionCount: v.number(),
    currentPlanQuestionCovered: v.boolean(),
});
const structuralResultValidator = v.union(
    v.object({ status: v.literal("valid") }),
    v.object({ status: v.literal("blocked"), ruleId: v.string() }),
);
const policyRuleValidator = v.object({
    ruleId: v.string(),
    outcome: v.union(
        v.literal("pass"),
        v.literal("needs_review"),
        v.literal("blocked"),
    ),
    reasonCode: v.string(),
});
const verifierOutputValidator = v.object({
    label: v.union(
        v.literal("entailed"),
        v.literal("contradicted"),
        v.literal("mixed"),
    ),
    evidenceReferences: v.array(
        v.object({
            sourcePassageId: v.id("sourcePassages"),
            passageKey: v.string(),
        }),
    ),
});
const citedEvidenceValidator = v.object({
    strengthensFactualSupport: v.boolean(),
    relation: evidenceRelationValidator,
    sourcePassageId: v.id("sourcePassages"),
    passageKey: v.string(),
    exactQuotation: v.string(),
    locator: sourceLocatorValidator,
    sourceVersionId: v.id("sourceVersions"),
    storageId: v.id("_storage"),
    sourceId: v.id("sources"),
    acceptedDecisionId: v.id("sourceDecisions"),
    source: policySourceInputValidator,
});
const snapshotClaimValidator = v.object({
    claimId: v.id("claims"),
    statement: v.string(),
    classification: claimClassificationValidator,
    researchPlanQuestionId: v.optional(v.id("researchPlanQuestions")),
    dimensionLinks: v.array(
        v.object({ dimensionKey: assessmentDimensionKeyValidator }),
    ),
    evidence: v.array(citedEvidenceValidator),
    preblockedRuleId: v.optional(v.string()),
});

type CitedEvidence = {
    strengthensFactualSupport: boolean;
    relation: "supporting" | "counter" | "context";
    sourcePassageId: Id<"sourcePassages">;
    passageKey: string;
    exactQuotation: string;
    locator: SourceLocator;
    sourceVersionId: Id<"sourceVersions">;
    storageId: Id<"_storage">;
    sourceId: Id<"sources">;
    acceptedDecisionId: Id<"sourceDecisions">;
    source: PolicySourceInput;
};
type SnapshotClaim = {
    claimId: Id<"claims">;
    statement: string;
    classification: "Fact" | "Inference" | "Hypothesis" | "Unknown";
    researchPlanQuestionId?: Id<"researchPlanQuestions">;
    dimensionLinks: Array<{
        dimensionKey: Parameters<
            typeof validateClaimStructure
        >[0]["dimensionLinks"][number]["dimensionKey"];
    }>;
    evidence: CitedEvidence[];
    preblockedRuleId?: string;
};
type PolicySnapshot = {
    corpusRevisionId: Id<"corpusRevisions">;
    asOfTime: number;
    totalQuestionCount: number;
    currentQuestionIds: Array<Id<"researchPlanQuestions">>;
    claims: SnapshotClaim[];
};
type CommitEvaluationArgs = {
    runId: Id<"researchRuns">;
    executionGeneration: number;
    corpusRevisionId: Id<"corpusRevisions">;
    claimId: Id<"claims">;
    normalizedInputs: PolicyNormalizedInputs;
    structuralResult:
        | { status: "valid" }
        | { status: "blocked"; ruleId: string };
    rules: PolicyRuleResult[];
    reasonCodes: string[];
    result: "pass" | "needs_review" | "blocked";
    inputHash: string;
    verifier?: { inputHash: string; output: VerifierOutput };
    citedEvidence: Array<{
        sourcePassageId: Id<"sourcePassages">;
        sourceVersionId: Id<"sourceVersions">;
        sourceId: Id<"sources">;
        acceptedDecisionId: Id<"sourceDecisions">;
    }>;
    createdAt: number;
};

const loadPolicySnapshotRef = makeFunctionReference<
    "query",
    { runId: Id<"researchRuns">; executionGeneration: number },
    PolicySnapshot
>("policyEvaluations:loadPolicySnapshot");
const commitEvaluationRef = makeFunctionReference<
    "mutation",
    CommitEvaluationArgs,
    Id<"policyEvaluations">
>("policyEvaluations:commitEvaluation");

function stableStringify(value: unknown): string {
    if (value === null || typeof value !== "object")
        return JSON.stringify(value);
    if (Array.isArray(value))
        return `[${value.map(stableStringify).join(",")}]`;
    return `{${Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
        .join(",")}}`;
}

function deepEqual(left: unknown, right: unknown): boolean {
    if (left === right) return true;
    if (
        typeof left !== "object" ||
        typeof right !== "object" ||
        left === null ||
        right === null
    ) {
        return false;
    }
    if (Array.isArray(left) || Array.isArray(right)) {
        if (!Array.isArray(left) || !Array.isArray(right)) return false;
        return (
            left.length === right.length &&
            left.every((item, index) => deepEqual(item, right[index]))
        );
    }
    const leftRecord = left as Record<string, unknown>;
    const rightRecord = right as Record<string, unknown>;
    if (Object.keys(leftRecord).length !== Object.keys(rightRecord).length) {
        return false;
    }
    return Object.keys(leftRecord).every((key) =>
        deepEqual(leftRecord[key], rightRecord[key]),
    );
}

export const loadPolicySnapshot = internalQuery({
    args: {
        runId: v.id("researchRuns"),
        executionGeneration: v.number(),
    },
    returns: v.object({
        corpusRevisionId: v.id("corpusRevisions"),
        asOfTime: v.number(),
        totalQuestionCount: v.number(),
        currentQuestionIds: v.array(v.id("researchPlanQuestions")),
        claims: v.array(snapshotClaimValidator),
    }),
    handler: async (ctx, args) => {
        const run = await ctx.db.get(args.runId);
        if (
            run?.lifecycleState !== "extracting_evidence" ||
            run.executionStatus !== "running" ||
            run.executionGeneration !== args.executionGeneration ||
            !run.activeCorpusRevisionId
        ) {
            throw new Error("Policy execution fence violation");
        }
        const corpus = await ctx.db.get(run.activeCorpusRevisionId);
        if (
            !corpus ||
            corpus.runId !== run._id ||
            corpus.status !== "approved"
        ) {
            throw new Error("Active corpus revision is not approved");
        }
        const plan = await ctx.db
            .query("researchPlans")
            .withIndex("by_run_and_version", (query) =>
                query.eq("runId", run._id),
            )
            .order("desc")
            .first();
        const questions = plan
            ? await ctx.db
                  .query("researchPlanQuestions")
                  .withIndex("by_plan_and_key", (query) =>
                      query.eq("researchPlanId", plan._id),
                  )
                  .take(MAX_RESEARCH_PLAN_QUESTIONS + 1)
            : [];
        if (questions.length > MAX_RESEARCH_PLAN_QUESTIONS) {
            throw new Error("Research plan question limit exceeded");
        }
        const claims = await ctx.db
            .query("claims")
            .withIndex("by_run_and_corpus", (query) =>
                query.eq("runId", run._id).eq("corpusRevisionId", corpus._id),
            )
            .take(MAX_CLAIMS_PER_RUN + 1);
        if (claims.length > MAX_CLAIMS_PER_RUN) {
            throw new Error("Claim policy evaluation limit exceeded");
        }

        const result: SnapshotClaim[] = [];
        const issuerCik =
            run.companySnapshot?.cik ??
            (run.companyId
                ? (await ctx.db.get(run.companyId))?.cik
                : undefined);
        const preparedUsageByVersion = new Map<
            Id<"sourceVersions">,
            Awaited<ReturnType<typeof readPreparedSourceUsage>>
        >();
        for (const claim of claims) {
            const evidenceRows = await ctx.db
                .query("claimEvidence")
                .withIndex("by_claim", (query) =>
                    query.eq("claimId", claim._id),
                )
                .take(MAX_EVIDENCE_PER_CLAIM + 1);
            if (evidenceRows.length > MAX_EVIDENCE_PER_CLAIM) {
                throw new Error("Claim evidence limit exceeded");
            }
            const dimensionRows = await ctx.db
                .query("claimDimensionLinks")
                .withIndex("by_claim", (query) =>
                    query.eq("claimId", claim._id),
                )
                .take(MAX_DIMENSION_LINKS_PER_CLAIM + 1);
            if (dimensionRows.length > MAX_DIMENSION_LINKS_PER_CLAIM) {
                throw new Error("Claim dimension link limit exceeded");
            }
            const evidence: CitedEvidence[] = [];
            let preblockedRuleId: string | undefined;
            for (const row of evidenceRows) {
                const passage = await ctx.db.get(row.sourcePassageId);
                if (!passage) {
                    preblockedRuleId = STRUCTURAL_RULE_IDS.PASSAGE_NOT_ACTIVE;
                    continue;
                }
                const sourceVersion = await ctx.db.get(passage.sourceVersionId);
                if (
                    !sourceVersion ||
                    sourceVersion.runId !== run._id ||
                    sourceVersion.corpusRevisionId !== corpus._id
                ) {
                    preblockedRuleId =
                        STRUCTURAL_RULE_IDS.SOURCE_VERSION_NOT_CURRENT;
                    continue;
                }
                const status = await ctx.db
                    .query("evidenceSourceStatuses")
                    .withIndex("by_run_corpus_generation_source", (query) =>
                        query
                            .eq("runId", run._id)
                            .eq("corpusRevisionId", corpus._id)
                            .eq("executionGeneration", args.executionGeneration)
                            .eq("sourceId", sourceVersion.sourceId),
                    )
                    .unique();
                const review = await ctx.db
                    .query("sourceReviewItems")
                    .withIndex("by_revision_and_source", (query) =>
                        query
                            .eq("corpusRevisionId", corpus._id)
                            .eq("sourceId", sourceVersion.sourceId),
                    )
                    .unique();
                const decision = review
                    ? await ctx.db.get(review.latestDecisionId)
                    : null;
                if (
                    !status ||
                    status.sourceVersionId !== sourceVersion._id ||
                    status.acceptedDecisionId !==
                        sourceVersion.acceptedDecisionId
                ) {
                    preblockedRuleId =
                        STRUCTURAL_RULE_IDS.SOURCE_VERSION_NOT_CURRENT;
                    continue;
                }
                if (
                    review?.decision !== "accepted" ||
                    review.latestDecisionId !==
                        sourceVersion.acceptedDecisionId ||
                    decision?.decision !== "accepted"
                ) {
                    preblockedRuleId = STRUCTURAL_RULE_IDS.SOURCE_NOT_ACCEPTED;
                    continue;
                }
                const source = await ctx.db.get(sourceVersion.sourceId);
                if (!source || source.runId !== run._id) {
                    preblockedRuleId = STRUCTURAL_RULE_IDS.PASSAGE_NOT_ACTIVE;
                    continue;
                }
                const proposalId = corpus.sourceSelectionProposalId;
                const proposalItem = proposalId
                    ? await ctx.db
                          .query("sourceSelectionProposalItems")
                          .withIndex("by_proposal_and_source", (query) =>
                              query
                                  .eq("proposalId", proposalId)
                                  .eq("sourceId", source._id),
                          )
                          .unique()
                    : null;
                if (!passage.passageKey) {
                    preblockedRuleId = STRUCTURAL_RULE_IDS.PASSAGE_NOT_ACTIVE;
                    continue;
                }
                // Authority and document kind must come from the accepted
                // proposal item. No origin-derived fallback: a missing
                // projection is a structural block, not a silent weaker input.
                if (
                    !proposalItem?.authorityTier ||
                    !proposalItem?.documentKind
                ) {
                    preblockedRuleId =
                        STRUCTURAL_RULE_IDS.SOURCE_AUTHORITY_MISSING;
                    continue;
                }
                if (
                    status.status !== "succeeded" &&
                    status.status !== "partial"
                ) {
                    preblockedRuleId =
                        STRUCTURAL_RULE_IDS.SOURCE_STATUS_NOT_TERMINAL;
                    continue;
                }
                if (!preparedUsageByVersion.has(sourceVersion._id))
                    preparedUsageByVersion.set(
                        sourceVersion._id,
                        await readPreparedSourceUsage(ctx.db, sourceVersion),
                    );
                const preparedUsage = preparedUsageByVersion.get(
                    sourceVersion._id,
                );
                const usage = preparedUsage
                    ? validatePreparedEvidenceUse({
                          ...preparedUsage,
                          passage,
                          statement: claim.statement,
                          classification: claim.classification,
                          relation: row.relation,
                      })
                    : {
                          allowed: true as const,
                          strengthensFactualSupport:
                              row.relation === "supporting",
                      };
                if (!usage.allowed)
                    preblockedRuleId =
                        STRUCTURAL_RULE_IDS.SOURCE_USAGE_RESTRICTED;
                evidence.push({
                    strengthensFactualSupport:
                        usage.allowed && usage.strengthensFactualSupport,
                    relation: row.relation,
                    sourcePassageId: passage._id,
                    passageKey: passage.passageKey,
                    exactQuotation: passage.exactQuotation,
                    locator: passage.locator,
                    sourceVersionId: sourceVersion._id,
                    storageId: sourceVersion.storageId,
                    sourceId: source._id,
                    acceptedDecisionId: sourceVersion.acceptedDecisionId,
                    source: {
                        sourceId: source._id,
                        origin: source.origin,
                        category: source.category,
                        secForm: source.secForm,
                        authorityTier: proposalItem.authorityTier,
                        documentKind: proposalItem.documentKind,
                        publisherIdentity:
                            derivePublisherIdentity(source.canonicalUrl, {
                                authorityTier: proposalItem.authorityTier,
                                issuerCik,
                            }) ?? "",
                        publishedAt: source.publishedAt,
                    },
                });
            }
            result.push({
                claimId: claim._id,
                statement: claim.statement,
                classification: claim.classification,
                researchPlanQuestionId: claim.researchPlanQuestionId,
                dimensionLinks: dimensionRows.map((row) => ({
                    dimensionKey: row.dimensionKey,
                })),
                evidence,
                preblockedRuleId,
            });
        }
        return {
            corpusRevisionId: corpus._id,
            asOfTime: corpus.approvedAt ?? corpus.createdAt,
            totalQuestionCount: questions.length,
            currentQuestionIds: questions.map((question) => question._id),
            claims: result,
        };
    },
});

export const commitEvaluation = internalMutation({
    args: {
        runId: v.id("researchRuns"),
        executionGeneration: v.number(),
        corpusRevisionId: v.id("corpusRevisions"),
        claimId: v.id("claims"),
        normalizedInputs: normalizedInputsValidator,
        structuralResult: structuralResultValidator,
        rules: v.array(policyRuleValidator),
        reasonCodes: v.array(v.string()),
        result: v.union(
            v.literal("pass"),
            v.literal("needs_review"),
            v.literal("blocked"),
        ),
        inputHash: v.string(),
        verifier: v.optional(
            v.object({
                inputHash: v.string(),
                output: verifierOutputValidator,
            }),
        ),
        citedEvidence: v.array(
            v.object({
                sourcePassageId: v.id("sourcePassages"),
                sourceVersionId: v.id("sourceVersions"),
                sourceId: v.id("sources"),
                acceptedDecisionId: v.id("sourceDecisions"),
            }),
        ),
        createdAt: v.number(),
    },
    returns: v.id("policyEvaluations"),
    handler: async (ctx, args) => {
        if (
            args.rules.length > MAX_POLICY_RULES ||
            args.reasonCodes.length > MAX_POLICY_REASON_CODES ||
            args.citedEvidence.length > MAX_EVIDENCE_PER_CLAIM
        ) {
            throw new Error("Policy commit limit exceeded");
        }
        assertWithinLength(
            args.inputHash,
            MAX_POLICY_INPUT_HASH_CHARS,
            "policy input hash",
        );
        for (const rule of args.rules) {
            assertWithinLength(
                rule.ruleId,
                MAX_POLICY_RULE_ID_CHARS,
                "policy rule id",
            );
            assertWithinLength(
                rule.reasonCode,
                MAX_POLICY_REASON_CODE_CHARS,
                "policy reason code",
            );
        }
        for (const reason of args.reasonCodes) {
            assertWithinLength(
                reason,
                MAX_POLICY_REASON_CODE_CHARS,
                "policy reason code",
            );
        }
        for (const source of args.normalizedInputs.sources) {
            assertWithinLength(
                source.sourceId,
                MAX_POLICY_SOURCE_ID_CHARS,
                "policy source id",
            );
            assertWithinLength(
                source.category,
                MAX_POLICY_SOURCE_CATEGORY_CHARS,
                "policy source category",
            );
            assertWithinLength(
                source.publisherIdentity,
                MAX_POLICY_PUBLISHER_IDENTITY_CHARS,
                "policy publisher identity",
            );
            if (source.secForm !== undefined) {
                assertWithinLength(
                    source.secForm,
                    MAX_POLICY_SOURCE_SEC_FORM_CHARS,
                    "policy source sec form",
                );
            }
        }
        if (args.structuralResult.status === "blocked") {
            assertWithinLength(
                args.structuralResult.ruleId,
                MAX_POLICY_RULE_ID_CHARS,
                "structural rule id",
            );
        }
        if (args.verifier) {
            assertWithinLength(
                args.verifier.inputHash,
                MAX_VERIFIER_INPUT_HASH_CHARS,
                "verifier input hash",
            );
            if (
                args.verifier.output.evidenceReferences.length >
                MAX_VERIFIER_EVIDENCE_REFERENCES
            ) {
                throw new Error(
                    "Verifier output evidence references exceed bounds",
                );
            }
            for (const reference of args.verifier.output.evidenceReferences) {
                assertWithinLength(
                    reference.sourcePassageId,
                    MAX_VERIFIER_REFERENCE_IDENTITY_CHARS,
                    "verifier source passage identity",
                );
                assertWithinLength(
                    reference.passageKey,
                    MAX_VERIFIER_REFERENCE_IDENTITY_CHARS,
                    "verifier passage key",
                );
            }
        }
        const run = await ctx.db.get(args.runId);
        const corpus = await ctx.db.get(args.corpusRevisionId);
        const claim = await ctx.db.get(args.claimId);
        if (
            !run ||
            run.executionGeneration !== args.executionGeneration ||
            run.executionStatus !== "running" ||
            run.lifecycleState !== "extracting_evidence" ||
            run.activeCorpusRevisionId !== args.corpusRevisionId ||
            !corpus ||
            corpus.status !== "approved" ||
            claim?.runId !== run._id ||
            claim.corpusRevisionId !== corpus._id
        ) {
            throw new Error("Policy commit fence violation");
        }
        for (const cited of args.citedEvidence) {
            await assertEvidenceExecutionFence(ctx.db, {
                runId: run._id,
                corpusRevisionId: corpus._id,
                sourceId: cited.sourceId,
                acceptedDecisionId: cited.acceptedDecisionId,
                executionGeneration: args.executionGeneration,
            });
            const passage = await ctx.db.get(cited.sourcePassageId);
            const sourceVersion = await ctx.db.get(cited.sourceVersionId);
            const status = await ctx.db
                .query("evidenceSourceStatuses")
                .withIndex("by_run_corpus_generation_source", (query) =>
                    query
                        .eq("runId", run._id)
                        .eq("corpusRevisionId", corpus._id)
                        .eq("executionGeneration", args.executionGeneration)
                        .eq("sourceId", cited.sourceId),
                )
                .unique();
            if (
                passage?.sourceVersionId !== cited.sourceVersionId ||
                sourceVersion?.sourceId !== cited.sourceId ||
                status?.sourceVersionId !== cited.sourceVersionId
            ) {
                throw new Error(
                    "Policy cited source version is no longer current",
                );
            }
        }

        const existing = await ctx.db
            .query("policyEvaluations")
            .withIndex("by_claim_and_input_hash", (query) =>
                query.eq("claimId", claim._id).eq("inputHash", args.inputHash),
            )
            .unique();
        if (existing) return existing._id;

        // Recompute the complete policy logical input hash from the commit args
        // and reject a mismatch so the persisted evaluation can only ever be
        // stamped by the exact deterministic input that produced its result.
        const recomputedHash = sha256Hex(
            stableStringify({
                policyVersion: POLICY_VERSION,
                normalizedInputs: args.normalizedInputs,
                structuralResult: args.structuralResult,
                rules: args.rules,
                verifier: args.verifier,
            }),
        );
        if (recomputedHash !== args.inputHash) {
            throw new Error("Policy commit input hash mismatch");
        }

        let verifierTaskId: Id<"aiTaskResults"> | undefined;
        if (args.verifier) {
            const existingVerifier = await ctx.db
                .query("aiTaskResults")
                .withIndex("by_run_and_task_type_and_input_hash", (query) =>
                    query
                        .eq("runId", run._id)
                        .eq("taskType", "semantic_verification")
                        .eq("inputHash", args.verifier?.inputHash ?? ""),
                )
                .unique();
            if (existingVerifier) {
                if (
                    existingVerifier.schemaVersion !==
                        VERIFIER_SCHEMA_VERSION ||
                    existingVerifier.adapterVersion !==
                        VERIFIER_ADAPTER_VERSION ||
                    existingVerifier.output.kind !== "semantic_verification"
                ) {
                    throw new Error("Verifier replay identity mismatch");
                }
                const { kind: _kind, ...persistedOutput } =
                    existingVerifier.output;
                const { output: incomingOutput, ...incoming } = args.verifier;
                if (
                    !deepEqual(persistedOutput, incomingOutput) ||
                    existingVerifier.inputHash !== incoming.inputHash
                ) {
                    throw new Error(
                        "Verifier replay output mismatch for same input hash",
                    );
                }
                verifierTaskId = existingVerifier._id;
            } else {
                verifierTaskId = await ctx.db.insert("aiTaskResults", {
                    runId: run._id,
                    corpusRevisionId: corpus._id,
                    taskType: "semantic_verification",
                    executionMode: "showcase",
                    schemaVersion: VERIFIER_SCHEMA_VERSION,
                    adapterVersion: VERIFIER_ADAPTER_VERSION,
                    inputHash: args.verifier.inputHash,
                    output: {
                        kind: "semantic_verification",
                        ...args.verifier.output,
                    },
                    createdAt: args.createdAt,
                });
            }
        }
        return ctx.db.insert("policyEvaluations", {
            runId: run._id,
            corpusRevisionId: corpus._id,
            claimId: claim._id,
            policyVersion: POLICY_VERSION,
            normalizedInputs: args.normalizedInputs,
            structuralResult: args.structuralResult,
            rules: args.rules,
            reasonCodes: args.reasonCodes,
            result: args.result,
            inputHash: args.inputHash,
            verifierTaskId,
            createdAt: args.createdAt,
        });
    },
});

/** Storage-backed structural validation followed by deterministic policy. */
export const evaluatePolicyForRun = internalAction({
    args: {
        runId: v.id("researchRuns"),
        executionGeneration: v.number(),
    },
    returns: v.object({
        evaluationCount: v.number(),
        blockedCount: v.number(),
        needsReviewCount: v.number(),
        passCount: v.number(),
    }),
    handler: async (ctx, args) => {
        const snapshot = await ctx.runQuery(loadPolicySnapshotRef, args);
        const currentQuestionIds = new Set(snapshot.currentQuestionIds);
        const referencesByArtifact = new Map<
            Id<"_storage">,
            Array<{
                claimId: Id<"claims">;
                index: number;
                evidence: CitedEvidence;
            }>
        >();
        const failures = new Map<
            Id<"claims">,
            { index: number; ruleId: string }
        >();
        const structuralResults = new Map<
            Id<"claims">,
            StructuralValidationResult
        >();
        for (const claim of snapshot.claims) {
            const result: StructuralValidationResult = claim.preblockedRuleId
                ? {
                      status: "blocked",
                      ruleId: claim.preblockedRuleId,
                      reason: claim.preblockedRuleId,
                  }
                : validateClaimStructure({
                      statement: claim.statement,
                      classification: claim.classification,
                      researchPlanQuestionId: claim.researchPlanQuestionId,
                      currentQuestionIds,
                      evidence: claim.evidence.map((item) => ({
                          sourcePassageId: item.sourcePassageId,
                          passageKey: item.passageKey,
                          quotationHash: "validated_at_persistence",
                          relation: item.relation,
                      })),
                      dimensionLinks: claim.dimensionLinks,
                  });
            if (result.status === "valid") {
                for (const [index, evidence] of claim.evidence.entries()) {
                    const references =
                        referencesByArtifact.get(evidence.storageId) ?? [];
                    references.push({
                        claimId: claim.claimId,
                        index,
                        evidence,
                    });
                    referencesByArtifact.set(evidence.storageId, references);
                }
            }
            structuralResults.set(claim.claimId, result);
        }
        for (const [storageId, references] of referencesByArtifact) {
            const pending = references.filter(
                ({ claimId, index }) =>
                    index < (failures.get(claimId)?.index ?? Infinity),
            );
            if (!pending.length) continue;
            const blob = await ctx.storage.get(storageId);
            const artifact =
                blob && blob.size <= MAX_EVIDENCE_ARTIFACT_BYTES
                    ? new Uint8Array(await blob.arrayBuffer())
                    : null;
            let reproduce:
                | ReturnType<typeof preparePassageReproduction>
                | undefined;
            for (const { claimId, index, evidence } of pending) {
                if (index >= (failures.get(claimId)?.index ?? Infinity))
                    continue;
                if (!artifact) {
                    failures.set(claimId, {
                        index,
                        ruleId: STRUCTURAL_RULE_IDS.ARTIFACT_MISSING,
                    });
                    continue;
                }
                try {
                    reproduce ??= preparePassageReproduction(artifact);
                    const reproduced = reproduce(evidence.locator);
                    if (reproduced !== evidence.exactQuotation)
                        throw new Error("quotation mismatch");
                } catch {
                    failures.set(claimId, {
                        index,
                        ruleId: STRUCTURAL_RULE_IDS.QUOTATION_NOT_REPRODUCIBLE,
                    });
                }
            }
        }
        for (const [claimId, { ruleId }] of failures) {
            structuralResults.set(claimId, {
                status: "blocked",
                ruleId,
                reason: ruleId,
            });
        }
        const coveredQuestionIds = new Set(
            snapshot.claims
                .filter(
                    (claim) =>
                        structuralResults.get(claim.claimId)?.status ===
                        "valid",
                )
                .map((claim) => claim.researchPlanQuestionId)
                .filter(
                    (questionId): questionId is Id<"researchPlanQuestions"> =>
                        questionId !== undefined &&
                        currentQuestionIds.has(questionId),
                ),
        );

        let blockedCount = 0;
        let needsReviewCount = 0;
        let passCount = 0;
        for (const claim of snapshot.claims) {
            const structural = structuralResults.get(claim.claimId) ?? {
                status: "blocked" as const,
                ruleId: STRUCTURAL_RULE_IDS.MISSING_EVIDENCE,
                reason: STRUCTURAL_RULE_IDS.MISSING_EVIDENCE,
            };
            const distinctSources = new Map<string, PolicySourceInput>();
            for (const evidence of claim.evidence) {
                distinctSources.set(evidence.source.sourceId, evidence.source);
            }
            const normalizedInputs: PolicyNormalizedInputs = {
                classification: claim.classification,
                asOfTime: snapshot.asOfTime,
                sources: [...distinctSources.values()].sort((left, right) =>
                    left.sourceId.localeCompare(right.sourceId),
                ),
                supportingSourceIds: [
                    ...new Set(
                        claim.evidence
                            .filter(
                                (item) =>
                                    item.relation === "supporting" &&
                                    item.strengthensFactualSupport,
                            )
                            .map((item) => item.sourceId),
                    ),
                ].sort(),
                supportingEvidenceCount: claim.evidence.filter(
                    (item) => item.relation === "supporting",
                ).length,
                counterEvidenceCount: claim.evidence.filter(
                    (item) => item.relation === "counter",
                ).length,
                contextEvidenceCount: claim.evidence.filter(
                    (item) => item.relation === "context",
                ).length,
                distinctSourceCount: distinctSources.size,
                distinctPublisherCount: new Set(
                    claim.evidence
                        .map((item) => item.source.publisherIdentity)
                        .filter((identity) => identity.length > 0),
                ).size,
                distinctPassageCount: new Set(
                    claim.evidence.map((item) => item.sourcePassageId),
                ).size,
                unresolvedCounterCount: claim.evidence.filter(
                    (item) => item.relation === "counter",
                ).length,
                coveredQuestionCount: coveredQuestionIds.size,
                totalQuestionCount: snapshot.totalQuestionCount,
                currentPlanQuestionCovered:
                    claim.researchPlanQuestionId !== undefined &&
                    currentQuestionIds.has(claim.researchPlanQuestionId),
            };
            let rules: PolicyRuleResult[] = [];
            let result: "pass" | "needs_review" | "blocked" = "blocked";
            let verifier:
                | { inputHash: string; output: VerifierOutput }
                | undefined;
            if (structural.status === "valid") {
                const policy = evaluateEvidencePolicy(normalizedInputs);
                rules = policy.rules;
                result = policy.result;
                if (policy.requiresVerifier && policy.verifierRuleId) {
                    const evidenceReferences = claim.evidence.map((item) => ({
                        sourcePassageId: item.sourcePassageId,
                        passageKey: item.passageKey,
                    }));
                    if (
                        evidenceReferences.length >
                        MAX_VERIFIER_EVIDENCE_REFERENCES
                    ) {
                        throw new Error("Verifier evidence limit exceeded");
                    }
                    const verifierInput: VerifierInput = {
                        schemaVersion: VERIFIER_SCHEMA_VERSION,
                        adapterVersion: VERIFIER_ADAPTER_VERSION,
                        claimId: claim.claimId,
                        ruleId: policy.verifierRuleId,
                        statement: claim.statement,
                        evidenceReferences,
                    };
                    const verifierResult =
                        executeShowcaseVerifier(verifierInput);
                    if (verifierResult.status === "success") {
                        if (
                            verifierResult.inputHash !==
                            computeVerifierInputHash(verifierInput)
                        ) {
                            throw new Error("Verifier input hash mismatch");
                        }
                        verifier = {
                            inputHash: verifierResult.inputHash,
                            output: verifierResult.output,
                        };
                    }
                }
            }
            const reasonCodes =
                structural.status === "blocked"
                    ? [structural.ruleId]
                    : rules.map((rule) => rule.reasonCode);
            const inputHash = sha256Hex(
                stableStringify({
                    policyVersion: POLICY_VERSION,
                    normalizedInputs,
                    structuralResult:
                        structural.status === "valid"
                            ? { status: "valid" }
                            : { status: "blocked", ruleId: structural.ruleId },
                    rules,
                    verifier,
                }),
            );
            await ctx.runMutation(commitEvaluationRef, {
                runId: args.runId,
                executionGeneration: args.executionGeneration,
                corpusRevisionId: snapshot.corpusRevisionId,
                claimId: claim.claimId,
                normalizedInputs,
                structuralResult:
                    structural.status === "valid"
                        ? { status: "valid" }
                        : { status: "blocked", ruleId: structural.ruleId },
                rules,
                reasonCodes,
                result,
                inputHash,
                verifier,
                citedEvidence: claim.evidence.map((item) => ({
                    sourcePassageId: item.sourcePassageId,
                    sourceVersionId: item.sourceVersionId,
                    sourceId: item.sourceId,
                    acceptedDecisionId: item.acceptedDecisionId,
                })),
                createdAt: snapshot.asOfTime,
            });
            if (result === "blocked") blockedCount++;
            else if (result === "needs_review") needsReviewCount++;
            else passCount++;
        }
        return {
            evaluationCount: snapshot.claims.length,
            blockedCount,
            needsReviewCount,
            passCount,
        };
    },
});
