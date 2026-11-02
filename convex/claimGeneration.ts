import { internal } from "./_generated/api";
import type { DataModel, Id } from "@convex/_generated/dataModel";
import {
    groupClaimsForCanonicalization,
    normalizeCanonicalText,
    type RawClaimInput,
} from "@convex/domain/claimCanonicalization";
import {
    claimClassificationValidator,
    claimDimensionLinkOriginValidator,
    evidenceRelationValidator,
} from "@convex/domain/claims";
import {
    type ClaimStructuralInput,
    validateClaimStructure,
} from "@convex/domain/claimValidation";
import { assertEvidenceExecutionFence } from "@convex/domain/evidenceAuthority";
import {
    ASSESSMENT_DIMENSION_KEYS,
    type AssessmentDimensionKey,
    assessmentDimensionKeyValidator,
} from "@convex/domain/researchPlan";
import {
    CLAIM_SCHEMA_VERSION,
    computeClaimInputHash,
    lookupShowcaseManifest,
    type NormalizedClaimInput,
    type NormalizedPassageInput,
    type NormalizedQuestionInput,
    SHOWCASE_ADAPTER_VERSION,
} from "@convex/domain/showcaseManifest";
import { coverageRoleValidator } from "@convex/domain/sourceDiscoveryRecovery";
import {
    computePassageKey,
    sha256Hex,
    sourceLocatorValidator,
} from "@convex/domain/sourcePassages";
import {
    constructAttributedHypothesis,
    readPreparedSourceUsage,
    validatePreparedEvidenceUse,
} from "@convex/domain/sourceUsage";
import { executeShowcaseClaimExtractionFromManifest } from "@convex/integrations/showcaseClaimAdapter";
import {
    MAX_CLAIM_INPUT_PASSAGES,
    MAX_CLAIMS_PER_RUN,
    MAX_PASSAGES_PER_SOURCE,
    sourceDossierCandidateLimit,
} from "@convex/resourceLimits";
import type { GenericDatabaseReader } from "convex/server";
import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import schema from "./schema";

const getFixtureManifestEntryRef =
    internal.fixtureManifestStore.getFixtureManifestEntry;

type LoadPlanResult =
    | { status: "missing_plan" }
    | { status: "missing_questions" }
    | {
          status: "ok";
          questions: NormalizedQuestionInput[];
          questionIdMap: Map<string, Id<"researchPlanQuestions">>;
      };

const assessmentDimensionKeySet = new Set<string>(ASSESSMENT_DIMENSION_KEYS);

function isAssessmentDimensionKey(
    value: string,
): value is AssessmentDimensionKey {
    return assessmentDimensionKeySet.has(value);
}

/**
 * Loads the latest research plan (highest version) and its validated questions.
 * Throws on integrity violations (wrong count, version mismatch, or missing
 * expected keys); returns a typed status for the honest empty/unavailable cases.
 */
async function loadLatestPlanAndQuestions(
    db: GenericDatabaseReader<DataModel>,
    runId: Id<"researchRuns">,
): Promise<LoadPlanResult> {
    const plan = await db
        .query("researchPlans")
        .withIndex("by_run_and_version", (q) => q.eq("runId", runId))
        .order("desc")
        .first();

    if (!plan) {
        return { status: "missing_plan" };
    }

    const questionDocs = await db
        .query("researchPlanQuestions")
        .withIndex("by_plan_and_key", (q) => q.eq("researchPlanId", plan._id))
        .take(ASSESSMENT_DIMENSION_KEYS.length + 2);

    if (questionDocs.length === 0) {
        return { status: "missing_questions" };
    }

    for (const q of questionDocs) {
        if (q.researchPlanId !== plan._id) {
            throw new Error(
                `Question "${q.questionKey}" references plan ${q.researchPlanId} but expected ${plan._id}`,
            );
        }
        if (q.planVersion !== plan.version) {
            throw new Error(
                `Question "${q.questionKey}" version ${q.planVersion} does not match plan version ${plan.version}`,
            );
        }
    }

    const hasResearchAngle =
        plan.researchAngle && plan.researchAngle.trim().length > 0;
    const expectedKeyCount =
        ASSESSMENT_DIMENSION_KEYS.length + (hasResearchAngle ? 1 : 0);
    if (questionDocs.length !== expectedKeyCount) {
        throw new Error(
            `Expected ${expectedKeyCount} research plan questions (including${hasResearchAngle ? "" : " no"} research-angle), got ${questionDocs.length}`,
        );
    }

    const questionKeySet = new Set(questionDocs.map((q) => q.questionKey));
    for (const dimensionKey of ASSESSMENT_DIMENSION_KEYS) {
        if (!questionKeySet.has(`dimension:${dimensionKey}`)) {
            throw new Error(
                `Missing required question key "dimension:${dimensionKey}" in research plan`,
            );
        }
    }
    if (hasResearchAngle && !questionKeySet.has("research-angle")) {
        throw new Error(
            "Plan has researchAngle but missing research-angle question key",
        );
    }

    const questions = questionDocs.map((question) => {
        if (!question.dimensionKeys.every(isAssessmentDimensionKey)) {
            throw new Error(
                `Question "${question.questionKey}" has an invalid assessment dimension key`,
            );
        }
        return {
            questionKey: question.questionKey,
            prompt: question.prompt,
            dimensionKeys: question.dimensionKeys,
        };
    });

    const questionIdMap = new Map<string, Id<"researchPlanQuestions">>();
    for (const q of questionDocs) {
        questionIdMap.set(q.questionKey, q._id);
    }

    return { status: "ok", questions, questionIdMap };
}

export const generateClaimsForRun = internalMutation({
    args: {
        runId: v.id("researchRuns"),
        executionGeneration: v.number(),
    },
    returns: v.object({
        status: v.union(
            v.literal("succeeded"),
            v.literal("unavailable"),
            v.literal("failed"),
        ),
        aiTaskResultId: v.optional(v.id("aiTaskResults")),
        claimCount: v.number(),
        reused: v.boolean(),
        reason: v.optional(v.string()),
    }),
    handler: async (ctx, args) => {
        const run = await ctx.db.get(args.runId);
        if (!run) {
            throw new Error("Research run not found");
        }
        if (run.executionGeneration !== args.executionGeneration) {
            throw new Error("Stale research execution generation");
        }
        if (
            run.lifecycleState !== "extracting_evidence" ||
            run.executionStatus !== "running"
        ) {
            throw new Error(
                "Research run must be in extracting_evidence + running state",
            );
        }
        if (!run.activeCorpusRevisionId) {
            throw new Error("Research run missing activeCorpusRevisionId");
        }

        const corpusRevision = await ctx.db.get(run.activeCorpusRevisionId);
        if (corpusRevision?.status !== "approved") {
            throw new Error("Active corpus revision is not approved");
        }
        const corpusRevisionId = corpusRevision._id;

        // 1. Load the latest research plan and its validated questions
        const loaded = await loadLatestPlanAndQuestions(ctx.db, run._id);
        if (loaded.status !== "ok") {
            return {
                status: "unavailable" as const,
                reason:
                    loaded.status === "missing_plan"
                        ? "no_research_plan"
                        : "no_research_plan_questions",
                claimCount: 0,
                reused: false,
            };
        }
        const questions = loaded.questions;

        // 2. Load frozen sources and their committed passages
        const frozenStatuses = await ctx.db
            .query("evidenceSourceStatuses")
            .withIndex("by_run_and_execution_generation", (q) =>
                q
                    .eq("runId", run._id)
                    .eq("executionGeneration", args.executionGeneration),
            )
            .take(sourceDossierCandidateLimit(run.sourcePreparationId) + 1);

        if (frozenStatuses.length === 0) {
            return {
                status: "unavailable" as const,
                reason: "no_frozen_sources",
                claimCount: 0,
                reused: false,
            };
        }

        if (
            frozenStatuses.length >
            sourceDossierCandidateLimit(run.sourcePreparationId)
        ) {
            throw new Error(
                `Frozen source statuses exceed configured candidate limit`,
            );
        }

        const normalizedPassages: NormalizedPassageInput[] = [];
        const activePassageMap = new Map<
            string,
            {
                _id: Id<"sourcePassages">;
                sourceId: Id<"sources">;
                sourceVersionHash: string;
                quotationHash: string;
                exactQuotation: string;
                passageOrder: number;
                preparedUsage: Awaited<
                    ReturnType<typeof readPreparedSourceUsage>
                >;
            }
        >();

        for (const statusDoc of frozenStatuses) {
            // Verify fence for every source
            await assertEvidenceExecutionFence(ctx.db, {
                runId: run._id,
                corpusRevisionId,
                sourceId: statusDoc.sourceId,
                acceptedDecisionId: statusDoc.acceptedDecisionId,
                executionGeneration: args.executionGeneration,
            });

            // Only succeeded or a valid partial are claim-input terminal
            // states. Failed rows are reusable acquisition limitations (never
            // claim authority); queued/running rows have not been finalized and
            // cannot authorize evidence at the claim boundary.
            if (statusDoc.status === "failed") {
                continue;
            }
            if (
                statusDoc.status !== "succeeded" &&
                statusDoc.status !== "partial"
            ) {
                throw new Error(
                    `Evidence source status ${statusDoc.status} for source ${statusDoc.sourceId} is non-terminal and cannot authorize claims`,
                );
            }
            if (!statusDoc.sourceVersionId) {
                throw new Error(
                    `Evidence source status missing sourceVersionId for source ${statusDoc.sourceId}; must be set during finalize`,
                );
            }
            const sourceVersion = await ctx.db.get(statusDoc.sourceVersionId);
            if (
                !sourceVersion ||
                sourceVersion.runId !== run._id ||
                sourceVersion.corpusRevisionId !== corpusRevisionId ||
                sourceVersion.sourceId !== statusDoc.sourceId ||
                sourceVersion.acceptedDecisionId !==
                    statusDoc.acceptedDecisionId
            ) {
                throw new Error(
                    `Source version identity mismatch for source ${statusDoc.sourceId}`,
                );
            }

            const preparedUsage = await readPreparedSourceUsage(
                ctx.db,
                sourceVersion,
            );
            // Read only remaining+1 to detect overflow before Convex transaction limits
            const remaining =
                MAX_CLAIM_INPUT_PASSAGES - normalizedPassages.length;
            if (remaining <= 0) {
                throw new Error(
                    `Claim input passages exceed MAX_CLAIM_INPUT_PASSAGES (${MAX_CLAIM_INPUT_PASSAGES})`,
                );
            }
            const passages = await ctx.db
                .query("sourcePassages")
                .withIndex("by_source_version_and_order", (q) =>
                    q.eq("sourceVersionId", sourceVersion._id),
                )
                .take(Math.min(MAX_PASSAGES_PER_SOURCE + 1, remaining + 1));

            if (passages.length > MAX_PASSAGES_PER_SOURCE) {
                throw new Error(
                    `Source passages exceed MAX_PASSAGES_PER_SOURCE (${MAX_PASSAGES_PER_SOURCE})`,
                );
            }
            if (passages.length > remaining) {
                throw new Error(
                    `Claim input passages exceed MAX_CLAIM_INPUT_PASSAGES (${MAX_CLAIM_INPUT_PASSAGES})`,
                );
            }

            for (const p of passages) {
                if (!p.passageKey) {
                    throw new Error(
                        `Source passage ${p._id} missing passageKey; must be computed on insertion`,
                    );
                }
                const normPassage: NormalizedPassageInput = {
                    sourceId: statusDoc.sourceId,
                    sourceVersionHash: sourceVersion.contentHash,
                    passageOrder: p.order,
                    quotationHash: p.quotationHash,
                    passageKey: p.passageKey,
                    exactQuotation: p.exactQuotation,
                    locator: p.locator,
                };
                normalizedPassages.push(normPassage);
                if (activePassageMap.has(p.passageKey)) {
                    throw new Error(
                        `Duplicate passageKey "${p.passageKey}" detected across source passages`,
                    );
                }
                activePassageMap.set(p.passageKey, {
                    _id: p._id,
                    sourceId: statusDoc.sourceId,
                    sourceVersionHash: sourceVersion.contentHash,
                    quotationHash: p.quotationHash,
                    exactQuotation: p.exactQuotation,
                    passageOrder: p.order,
                    preparedUsage,
                });
            }
        }

        if (normalizedPassages.length === 0) {
            return {
                status: "unavailable" as const,
                reason: "no_committed_passages",
                claimCount: 0,
                reused: false,
            };
        }

        // Check MAX_CLAIM_INPUT_PASSAGES overflow before building normalized input
        if (normalizedPassages.length > MAX_CLAIM_INPUT_PASSAGES) {
            throw new Error(
                `Claim input passages (${normalizedPassages.length}) exceed MAX_CLAIM_INPUT_PASSAGES (${MAX_CLAIM_INPUT_PASSAGES})`,
            );
        }

        // 3. Build normalized input and hash
        const normalizedInput: NormalizedClaimInput = {
            corpusRevisionId,
            schemaVersion: CLAIM_SCHEMA_VERSION,
            adapterVersion: SHOWCASE_ADAPTER_VERSION,
            questions,
            passages: normalizedPassages,
        };

        const inputHash = computeClaimInputHash(normalizedInput);

        // 4. Idempotency check: AITaskResult already exists for (runId, inputHash)?
        const existingTask = await ctx.db
            .query("aiTaskResults")
            .withIndex("by_run_and_task_type_and_input_hash", (q) =>
                q
                    .eq("runId", run._id)
                    .eq("taskType", "showcase_claim_extraction")
                    .eq("inputHash", inputHash),
            )
            .first();

        if (existingTask) {
            if (existingTask.output.kind !== "claim_extraction") {
                throw new Error(
                    "Claim extraction task has invalid output kind",
                );
            }
            return {
                status: "succeeded" as const,
                aiTaskResultId: existingTask._id,
                claimCount: existingTask.output.claimCount,
                reused: true,
            };
        }

        // 5. Execute showcase claim adapter lookup. The canonical in-memory
        // registry is checked first (convexTest source), then the gated durable
        // manifest store so a real local Convex deployment resolves the exact
        // same fixture claims across separate function invocations. Both paths
        // re-validate the entry through the same adapter gate; with the E2E
        // gate disabled the durable store returns null and live dossiers stay
        // on the unavailable pause.
        const manifest =
            lookupShowcaseManifest(inputHash) ??
            (await ctx.runQuery(getFixtureManifestEntryRef, { inputHash }));
        const extraction = executeShowcaseClaimExtractionFromManifest({
            manifest,
            normalizedInput,
        });

        if (extraction.status === "unavailable") {
            return {
                status: "unavailable" as const,
                reason: extraction.reason,
                claimCount: 0,
                reused: false,
            };
        }

        // 6. Validate every claim against active corpus passages
        const rawInputs: RawClaimInput[] = [];
        const questionKeyByCanonicalText = new Map<string, string>();

        for (const [cIdx, claim] of extraction.claims.entries()) {
            if (!claim.evidence || claim.evidence.length === 0) {
                throw new Error(
                    `Claim at index ${cIdx} has no evidence passages`,
                );
            }

            const rawEvidence = [];
            const seenEvidenceKeys = new Set<string>();
            for (const ev of claim.evidence) {
                if (!ev.passageKey) {
                    throw new Error(
                        `Claim ${cIdx} evidence is missing passageKey`,
                    );
                }
                const passage = activePassageMap.get(ev.passageKey);
                if (!passage) {
                    throw new Error(
                        `Passage key "${ev.passageKey}" for claim ${cIdx} is not in the active approved corpus`,
                    );
                }
                if (ev.quotationHash !== passage.quotationHash) {
                    throw new Error(
                        `Claim ${cIdx} evidence quotationHash does not match passage ${ev.passageKey}`,
                    );
                }
                if (
                    ev.sourceVersionHash &&
                    ev.sourceVersionHash !== passage.sourceVersionHash
                ) {
                    throw new Error(
                        `Claim ${cIdx} evidence sourceVersionHash does not match passage ${ev.passageKey}`,
                    );
                }
                const evidenceKey = `${passage._id}:::${ev.relation}`;
                if (seenEvidenceKeys.has(evidenceKey)) {
                    throw new Error(
                        `Claim ${cIdx} references duplicate evidence passage ${ev.passageKey}`,
                    );
                }
                seenEvidenceKeys.add(evidenceKey);
                rawEvidence.push({
                    sourcePassageId: passage._id,
                    relation: ev.relation,
                });
            }

            const rawLinks = [];
            for (const link of claim.dimensionLinks) {
                if (
                    !ASSESSMENT_DIMENSION_KEYS.includes(
                        link.dimensionKey as AssessmentDimensionKey,
                    )
                ) {
                    throw new Error(
                        `Invalid assessment dimension key "${link.dimensionKey}"`,
                    );
                }
                rawLinks.push({
                    dimensionKey: link.dimensionKey as AssessmentDimensionKey,
                    rationale: link.rationale,
                });
            }

            rawInputs.push({
                statement: claim.statement,
                classification: claim.classification,
                evidence: rawEvidence,
                dimensionLinks: rawLinks,
            });

            // Track questionKey for Unknown claims (used after canonicalization)
            if (claim.classification === "Unknown" && claim.questionKey) {
                const canonicalText = normalizeCanonicalText(claim.statement);
                questionKeyByCanonicalText.set(
                    `${canonicalText}:::Unknown`,
                    claim.questionKey,
                );
            }
        }

        // 7. Canonicalization: merge ONLY exact normalized text + classification
        const canonicalClaims = groupClaimsForCanonicalization(rawInputs);

        if (canonicalClaims.length > MAX_CLAIMS_PER_RUN) {
            throw new Error(
                `Generated claims count (${canonicalClaims.length}) exceeds MAX_CLAIMS_PER_RUN (${MAX_CLAIMS_PER_RUN})`,
            );
        }

        // 7a. Resolve questionKey → researchPlanQuestionId and run structural validation
        const questionIdMap = loaded.questionIdMap;
        const claimQuestionIds = new Map<
            string,
            Id<"researchPlanQuestions"> | undefined
        >();

        for (const canonical of canonicalClaims) {
            const groupKey = `${canonical.canonicalText}:::${canonical.classification}`;
            const questionKey = questionKeyByCanonicalText.get(groupKey);
            let researchPlanQuestionId: Id<"researchPlanQuestions"> | undefined;

            if (canonical.classification === "Unknown" && questionKey) {
                researchPlanQuestionId = questionIdMap.get(questionKey);
                if (!researchPlanQuestionId) {
                    throw new Error(
                        `Unknown claim references questionKey "${questionKey}" not found in research plan`,
                    );
                }
            }

            claimQuestionIds.set(groupKey, researchPlanQuestionId);

            // Run structural validation (non-overridable)
            // Build a reverse lookup from sourcePassageId to passageKey/quotationHash
            const passageIdToKey = new Map<
                string,
                {
                    passageKey: string;
                    quotationHash: string;
                    passageOrder: number;
                    exactQuotation: string;
                    preparedUsage: Awaited<
                        ReturnType<typeof readPreparedSourceUsage>
                    >;
                }
            >();
            for (const [pk, pv] of activePassageMap.entries()) {
                passageIdToKey.set(pv._id, {
                    passageKey: pk,
                    quotationHash: pv.quotationHash,
                    passageOrder: pv.passageOrder,
                    exactQuotation: pv.exactQuotation,
                    preparedUsage: pv.preparedUsage,
                });
            }

            const structuralInput: ClaimStructuralInput = {
                statement: canonical.statement,
                classification: canonical.classification,
                evidence: canonical.evidence.map((ev) => {
                    const lookup = passageIdToKey.get(ev.sourcePassageId);
                    if (lookup?.preparedUsage) {
                        const usage = validatePreparedEvidenceUse({
                            ...lookup.preparedUsage,
                            passage: {
                                order: lookup.passageOrder,
                                exactQuotation: lookup.exactQuotation,
                            },
                            statement: canonical.statement,
                            classification: canonical.classification,
                            relation: ev.relation,
                        });
                        if (!usage.allowed)
                            throw new Error(
                                `Claim evidence violates ${usage.reasonCode}`,
                            );
                    }
                    return {
                        sourcePassageId: ev.sourcePassageId,
                        passageKey: lookup?.passageKey ?? "",
                        quotationHash: lookup?.quotationHash ?? "",
                        relation: ev.relation,
                    };
                }),
                dimensionLinks: canonical.dimensionLinks.map((link) => ({
                    dimensionKey: link.dimensionKey,
                    rationale: link.rationale,
                })),
                researchPlanQuestionId,
            };

            // Verify every evidence row has valid passage identity
            for (const ev of structuralInput.evidence) {
                if (!ev.passageKey) {
                    throw new Error(
                        `Claim evidence references passage ${ev.sourcePassageId} not found in active corpus`,
                    );
                }
            }

            const structuralResult = validateClaimStructure(structuralInput);
            if (structuralResult.status === "blocked") {
                throw new Error(
                    `Structural validation blocked claim "${canonical.statement.slice(0, 50)}...": ${structuralResult.reason} [${structuralResult.ruleId}]`,
                );
            }
        }

        const now = Date.now();

        // 8. Insert AITaskResult (proposing task)
        const aiTaskResultId = await ctx.db.insert("aiTaskResults", {
            runId: run._id,
            corpusRevisionId,
            taskType: "showcase_claim_extraction" as const,
            executionMode: "showcase",
            fixtureId: extraction.fixtureId,
            fixtureVersion: extraction.fixtureVersion,
            schemaVersion: extraction.schemaVersion,
            adapterVersion: extraction.adapterVersion,
            inputHash,
            output: {
                kind: "claim_extraction" as const,
                claimCount: canonicalClaims.length,
                claimIds: [],
            },
            createdAt: now,
        });

        // 9. Persist claims, claimEvidence, and claimDimensionLinks idempotently
        const createdClaimIds: Array<Id<"claims">> = [];

        for (const canonical of canonicalClaims) {
            let claimId: Id<"claims">;
            const groupKey = `${canonical.canonicalText}:::${canonical.classification}`;
            const researchPlanQuestionId = claimQuestionIds.get(groupKey);

            const existingClaim = await ctx.db
                .query("claims")
                .withIndex("by_revision_input_hash_and_canonical", (q) =>
                    q
                        .eq("corpusRevisionId", corpusRevisionId)
                        .eq("inputHash", inputHash)
                        .eq("canonicalText", canonical.canonicalText)
                        .eq("classification", canonical.classification),
                )
                .first();

            if (existingClaim) {
                claimId = existingClaim._id;
            } else {
                claimId = await ctx.db.insert("claims", {
                    runId: run._id,
                    corpusRevisionId,
                    statement: canonical.statement,
                    canonicalText: canonical.canonicalText,
                    classification: canonical.classification,
                    inputHash,
                    proposingTaskId: aiTaskResultId,
                    researchPlanQuestionId,
                    schemaVersion: extraction.schemaVersion,
                    createdAt: now,
                });
            }
            createdClaimIds.push(claimId);

            // Persist claim evidence rows
            for (const ev of canonical.evidence) {
                const existingEvidence = await ctx.db
                    .query("claimEvidence")
                    .withIndex("by_claim_and_passage_and_relation", (q) =>
                        q
                            .eq("claimId", claimId)
                            .eq("sourcePassageId", ev.sourcePassageId)
                            .eq("relation", ev.relation),
                    )
                    .first();

                if (!existingEvidence) {
                    await ctx.db.insert("claimEvidence", {
                        claimId,
                        sourcePassageId: ev.sourcePassageId,
                        relation: ev.relation,
                        proposingTaskId: aiTaskResultId,
                        createdAt: now,
                    });
                }
            }

            // Persist proposed dimension links
            for (const link of canonical.dimensionLinks) {
                const existingLink = await ctx.db
                    .query("claimDimensionLinks")
                    .withIndex(
                        "by_corpus_and_claim_and_dimension_and_origin",
                        (q) =>
                            q
                                .eq("corpusRevisionId", corpusRevisionId)
                                .eq("claimId", claimId)
                                .eq("dimensionKey", link.dimensionKey)
                                .eq("origin", "generated"),
                    )
                    .first();

                if (!existingLink) {
                    await ctx.db.insert("claimDimensionLinks", {
                        claimId,
                        runId: run._id,
                        corpusRevisionId,
                        dimensionKey: link.dimensionKey,
                        proposalRevision: 1,
                        origin: "generated",
                        proposingTaskId: aiTaskResultId,
                        rationale: link.rationale,
                        createdAt: now,
                    });
                }
            }
        }

        // 10. Update AITaskResult output with claimIds
        await ctx.db.patch(aiTaskResultId, {
            output: {
                kind: "claim_extraction" as const,
                claimCount: canonicalClaims.length,
                claimIds: createdClaimIds,
            },
        });

        return {
            status: "succeeded" as const,
            aiTaskResultId,
            claimCount: canonicalClaims.length,
            reused: false,
        };
    },
});

export const listClaimsForRun = internalQuery({
    args: {
        runId: v.id("researchRuns"),
    },
    returns: v.array(
        v.object({
            _id: v.id("claims"),
            statement: v.string(),
            canonicalText: v.string(),
            classification: claimClassificationValidator,
            proposingTaskId: v.id("aiTaskResults"),
        }),
    ),
    handler: async (ctx, args) => {
        const claims = await ctx.db
            .query("claims")
            .withIndex("by_run", (q) => q.eq("runId", args.runId))
            .take(MAX_CLAIMS_PER_RUN);

        return claims.map((c) => ({
            _id: c._id,
            statement: c.statement,
            canonicalText: c.canonicalText,
            classification: c.classification,
            proposingTaskId: c.proposingTaskId,
        }));
    },
});

export const getClaimDetails = internalQuery({
    args: {
        claimId: v.id("claims"),
    },
    returns: v.object({
        claim: v.object({
            _id: v.id("claims"),
            statement: v.string(),
            canonicalText: v.string(),
            classification: claimClassificationValidator,
            proposingTaskId: v.id("aiTaskResults"),
        }),
        evidence: v.array(
            v.object({
                _id: v.id("claimEvidence"),
                sourcePassageId: v.id("sourcePassages"),
                relation: evidenceRelationValidator,
            }),
        ),
        dimensionLinks: v.array(
            v.object({
                _id: v.id("claimDimensionLinks"),
                dimensionKey: assessmentDimensionKeyValidator,
                origin: claimDimensionLinkOriginValidator,
                rationale: v.optional(v.string()),
            }),
        ),
    }),
    handler: async (ctx, args) => {
        const claim = await ctx.db.get(args.claimId);
        if (!claim) {
            throw new Error("Claim not found");
        }

        const evidence = await ctx.db
            .query("claimEvidence")
            .withIndex("by_claim", (q) => q.eq("claimId", claim._id))
            .take(32);

        const dimensionLinks = await ctx.db
            .query("claimDimensionLinks")
            .withIndex("by_claim", (q) => q.eq("claimId", claim._id))
            .take(16);

        return {
            claim: {
                _id: claim._id,
                statement: claim.statement,
                canonicalText: claim.canonicalText,
                classification: claim.classification,
                proposingTaskId: claim.proposingTaskId,
            },
            evidence: evidence.map((e) => ({
                _id: e._id,
                sourcePassageId: e.sourcePassageId,
                relation: e.relation,
            })),
            dimensionLinks: dimensionLinks.map((d) => ({
                _id: d._id,
                dimensionKey: d.dimensionKey,
                origin: d.origin,
                rationale: d.rationale,
            })),
        };
    },
});

export const getNormalizedClaimInput = internalQuery({
    args: {
        runId: v.id("researchRuns"),
        executionGeneration: v.number(),
    },
    returns: v.union(
        v.null(),
        v.object({
            normalizedInput: v.object({
                corpusRevisionId: v.string(),
                schemaVersion: v.string(),
                adapterVersion: v.string(),
                questions: v.array(
                    v.object({
                        questionKey: v.string(),
                        prompt: v.string(),
                        dimensionKeys: v.array(assessmentDimensionKeyValidator),
                    }),
                ),
                passages: v.array(
                    v.object({
                        sourceId: v.string(),
                        sourceVersionHash: v.string(),
                        passageOrder: v.number(),
                        quotationHash: v.string(),
                        passageKey: v.string(),
                        exactQuotation: v.string(),
                        locator: sourceLocatorValidator,
                    }),
                ),
            }),
            inputHash: v.string(),
        }),
    ),
    handler: async (ctx, args) => {
        const run = await ctx.db.get(args.runId);
        if (!run?.activeCorpusRevisionId) {
            return null;
        }

        const corpusRevision = await ctx.db.get(run.activeCorpusRevisionId);
        if (corpusRevision?.status !== "approved") {
            return null;
        }
        const corpusRevisionId = corpusRevision._id;

        // Load the latest research plan and its validated questions
        const loaded = await loadLatestPlanAndQuestions(ctx.db, run._id);
        if (loaded.status !== "ok") {
            return null;
        }
        const questions = loaded.questions;

        const frozenStatuses = await ctx.db
            .query("evidenceSourceStatuses")
            .withIndex("by_run_and_execution_generation", (q) =>
                q
                    .eq("runId", run._id)
                    .eq("executionGeneration", args.executionGeneration),
            )
            .take(sourceDossierCandidateLimit(run.sourcePreparationId) + 1);

        if (frozenStatuses.length === 0) {
            return null;
        }

        if (
            frozenStatuses.length >
            sourceDossierCandidateLimit(run.sourcePreparationId)
        ) {
            throw new Error(
                "Frozen source statuses exceed configured candidate limit",
            );
        }

        const normalizedPassages: NormalizedPassageInput[] = [];

        for (const statusDoc of frozenStatuses) {
            if (statusDoc.status === "failed") {
                continue;
            }
            if (
                statusDoc.status !== "succeeded" &&
                statusDoc.status !== "partial"
            ) {
                throw new Error(
                    `Evidence source status ${statusDoc.status} for source ${statusDoc.sourceId} is non-terminal and cannot authorize claims`,
                );
            }
            if (!statusDoc.sourceVersionId) {
                throw new Error(
                    `Evidence source status missing sourceVersionId for source ${statusDoc.sourceId}; must be set during finalize`,
                );
            }
            const sourceVersion = await ctx.db.get(statusDoc.sourceVersionId);
            if (
                !sourceVersion ||
                sourceVersion.runId !== run._id ||
                sourceVersion.corpusRevisionId !== corpusRevisionId ||
                sourceVersion.sourceId !== statusDoc.sourceId ||
                sourceVersion.acceptedDecisionId !==
                    statusDoc.acceptedDecisionId
            ) {
                throw new Error(
                    `Source version identity mismatch for source ${statusDoc.sourceId}`,
                );
            }

            const passages = await ctx.db
                .query("sourcePassages")
                .withIndex("by_source_version_and_order", (q) =>
                    q.eq("sourceVersionId", sourceVersion._id),
                )
                .take(MAX_PASSAGES_PER_SOURCE + 1);
            if (passages.length > MAX_PASSAGES_PER_SOURCE) {
                throw new Error(
                    `Source passages exceed MAX_PASSAGES_PER_SOURCE (${MAX_PASSAGES_PER_SOURCE})`,
                );
            }

            for (const p of passages) {
                if (normalizedPassages.length >= MAX_CLAIM_INPUT_PASSAGES) {
                    throw new Error(
                        `Claim input passages exceed MAX_CLAIM_INPUT_PASSAGES (${MAX_CLAIM_INPUT_PASSAGES})`,
                    );
                }
                normalizedPassages.push({
                    sourceId: statusDoc.sourceId,
                    sourceVersionHash: sourceVersion.contentHash,
                    passageOrder: p.order,
                    quotationHash: p.quotationHash,
                    passageKey: computePassageKey({
                        sourceId: statusDoc.sourceId,
                        sourceVersionHash: sourceVersion.contentHash,
                        locatorVersion: p.locatorVersion,
                        locator: p.locator,
                        order: p.order,
                        quotationHash: p.quotationHash,
                    }),
                    exactQuotation: p.exactQuotation,
                    locator: p.locator,
                });
            }
        }

        if (normalizedPassages.length === 0) {
            return null;
        }

        const normalizedInput: NormalizedClaimInput = {
            corpusRevisionId,
            schemaVersion: CLAIM_SCHEMA_VERSION,
            adapterVersion: SHOWCASE_ADAPTER_VERSION,
            questions,
            passages: normalizedPassages,
        };

        const inputHash = computeClaimInputHash(normalizedInput);
        return {
            normalizedInput,
            inputHash,
        };
    },
});

export const getAiTaskResult = internalQuery({
    args: {
        aiTaskResultId: v.id("aiTaskResults"),
    },
    returns: schema.doc("aiTaskResults"),
    handler: async (ctx, args) => {
        const task = await ctx.db.get(args.aiTaskResultId);
        if (!task) {
            throw new Error("AITaskResult not found");
        }
        return task;
    },
});

/** Proposes only an attributed hypothesis constructed from an approved, independently usable finding. */
export const proposeAttributedHypothesis = internalMutation({
    args: {
        runId: v.id("researchRuns"),
        corpusRevisionId: v.id("corpusRevisions"),
        sourceId: v.id("sources"),
        acceptedDecisionId: v.id("sourceDecisions"),
        executionGeneration: v.number(),
        role: coverageRoleValidator,
        findingIndex: v.optional(v.number()),
    },
    returns: v.id("claims"),
    handler: async (ctx, args) => {
        const { statusDoc } = await assertEvidenceExecutionFence(ctx.db, args);
        if (
            !["succeeded", "partial"].includes(statusDoc.status) ||
            !statusDoc.sourceVersionId
        )
            throw new Error("Inspected source has not been materialized");
        const version = await ctx.db.get(statusDoc.sourceVersionId);
        if (
            !version ||
            version.acceptedDecisionId !== args.acceptedDecisionId ||
            version.sourceId !== args.sourceId ||
            version.corpusRevisionId !== args.corpusRevisionId ||
            version.runId !== args.runId
        )
            throw new Error("Source version identity mismatch");
        const usage = await readPreparedSourceUsage(ctx.db, version);
        if (!usage?.qualification || !usage.qualificationTaskId)
            throw new Error("Approved qualification is unavailable");
        const attributed = constructAttributedHypothesis({
            ...usage,
            qualification: usage.qualification,
            role: args.role,
            findingIndex: args.findingIndex,
        });
        const passages = await ctx.db
            .query("sourcePassages")
            .withIndex("by_source_version_and_order", (q) =>
                q.eq("sourceVersionId", version._id),
            )
            .take(MAX_PASSAGES_PER_SOURCE);
        const citedPassages = attributed.passages.map((reference) =>
            passages.find(
                (passage) =>
                    reference.passageKey === `p${passage.order}` &&
                    reference.quotation === passage.exactQuotation,
            ),
        );
        if (citedPassages.some((passage) => !passage))
            throw new Error(
                "Attributed finding does not reproduce approved passages",
            );
        for (const passage of citedPassages) {
            if (
                !passage ||
                !validatePreparedEvidenceUse({
                    ...usage,
                    passage,
                    statement: attributed.statement,
                    classification: attributed.classification,
                    relation: "supporting",
                }).allowed
            )
                throw new Error("source_usage_restricted");
        }
        const inputHash = sha256Hex(
            JSON.stringify({
                qualificationTaskId: usage.qualificationTaskId,
                sourceVersionId: version._id,
                statement: attributed.statement,
            }),
        );
        const canonicalText = normalizeCanonicalText(attributed.statement);
        const existing = await ctx.db
            .query("claims")
            .withIndex("by_revision_input_hash_and_canonical", (q) =>
                q
                    .eq("corpusRevisionId", args.corpusRevisionId)
                    .eq("inputHash", inputHash)
                    .eq("canonicalText", canonicalText)
                    .eq("classification", "Hypothesis"),
            )
            .unique();
        if (existing) return existing._id;
        const claims = await ctx.db
            .query("claims")
            .withIndex("by_run", (q) => q.eq("runId", args.runId))
            .take(MAX_CLAIMS_PER_RUN);
        if (claims.length >= MAX_CLAIMS_PER_RUN)
            throw new Error("Claim limit reached");
        const now = Date.now();
        const claimId = await ctx.db.insert("claims", {
            runId: args.runId,
            corpusRevisionId: args.corpusRevisionId,
            statement: attributed.statement,
            canonicalText,
            classification: "Hypothesis",
            inputHash,
            proposingTaskId: usage.qualificationTaskId,
            schemaVersion: "attributed-hypothesis-v1",
            createdAt: now,
        });
        for (const passage of citedPassages) {
            if (!passage) throw new Error("Attributed passage is unavailable");
            await ctx.db.insert("claimEvidence", {
                claimId,
                sourcePassageId: passage._id,
                relation: "supporting",
                proposingTaskId: usage.qualificationTaskId,
                createdAt: now,
            });
        }
        return claimId;
    },
});
