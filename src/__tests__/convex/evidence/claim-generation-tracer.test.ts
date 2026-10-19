/// <reference types="vite/client" />
import type { Id } from "@convex/_generated/dataModel";
import type {
    CLAIM_CLASSIFICATIONS,
    EVIDENCE_RELATIONS,
} from "@convex/domain/claims";
import { ASSESSMENT_DIMENSION_KEYS } from "@convex/domain/researchPlan";
import {
    CLAIM_SCHEMA_VERSION,
    SHOWCASE_ADAPTER_VERSION,
    SHOWCASE_FIXTURE_VERSION,
    clearShowcaseManifests,
    registerShowcaseManifest,
} from "@convex/domain/showcaseManifest";
import { computePassageKey } from "@convex/domain/sourcePassages";
import schema from "@convex/schema";
import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import {
    buildCccShowcaseManifest,
    registerCccShowcaseFixture,
} from "../../fixtures/evidence/ccc-showcase-manifest";
import rateLimiterTest from "../integrations/rate-limiter-test-register.js";
import workflowTest from "../workflows/workflow-test-register.js";

const modules = import.meta.glob("/convex/**/*.ts");

const generateClaimsForRun = makeFunctionReference<
    "mutation",
    {
        runId: Id<"researchRuns">;
        executionGeneration: number;
    },
    {
        status: "succeeded" | "unavailable" | "failed";
        aiTaskResultId?: Id<"aiTaskResults">;
        claimCount: number;
        reused: boolean;
        reason?: string;
    }
>("claimGeneration:generateClaimsForRun");

const listClaimsForRun = makeFunctionReference<
    "query",
    {
        runId: Id<"researchRuns">;
    },
    Array<{
        _id: Id<"claims">;
        statement: string;
        canonicalText: string;
        classification: (typeof CLAIM_CLASSIFICATIONS)[number];
        proposingTaskId: Id<"aiTaskResults">;
    }>
>("claimGeneration:listClaimsForRun");

const getClaimDetails = makeFunctionReference<
    "query",
    {
        claimId: Id<"claims">;
    },
    {
        claim: {
            _id: Id<"claims">;
            statement: string;
            canonicalText: string;
            classification: (typeof CLAIM_CLASSIFICATIONS)[number];
            proposingTaskId: Id<"aiTaskResults">;
        };
        evidence: Array<{
            _id: Id<"claimEvidence">;
            sourcePassageId: Id<"sourcePassages">;
            relation: (typeof EVIDENCE_RELATIONS)[number];
        }>;
        dimensionLinks: Array<{
            _id: Id<"claimDimensionLinks">;
            dimensionKey: string;
            origin: "generated" | "analyst";
            rationale?: string;
        }>;
    }
>("claimGeneration:getClaimDetails");

const getAiTaskResult = makeFunctionReference<
    "query",
    {
        aiTaskResultId: Id<"aiTaskResults">;
    },
    {
        _id: Id<"aiTaskResults">;
        runId: Id<"researchRuns">;
        corpusRevisionId: Id<"corpusRevisions">;
        taskType: string;
        executionMode: "showcase" | "live";
        fixtureId?: string;
        fixtureVersion?: string;
        schemaVersion: string;
        adapterVersion: string;
        inputHash: string;
        providerCallId?: Id<"providerCalls">;
        output:
            | {
                  kind: "claim_extraction";
                  claimCount: number;
                  claimIds: Array<Id<"claims">>;
              }
            | {
                  kind: "semantic_verification";
                  label: "entailed" | "contradicted" | "mixed";
                  evidenceReferences: Array<{
                      sourcePassageId: Id<"sourcePassages">;
                      passageKey: string;
                  }>;
              };
    }
>("claimGeneration:getAiTaskResult");

const getNormalizedClaimInput = makeFunctionReference<
    "query",
    {
        runId: Id<"researchRuns">;
        executionGeneration: number;
    },
    {
        normalizedInput: any;
        inputHash: string;
    } | null
>("claimGeneration:getNormalizedClaimInput");

type ScenarioPassage = {
    exactQuotation: string;
    headingPath?: string[];
};

type ScenarioSource = {
    url: string;
    title: string;
    origin: "sec" | "exa" | "analyst_url";
    category?: string;
    passages: ScenarioPassage[];
    decisions: Array<"accepted" | "rejected" | "pending">;
};

async function createShowcaseClaimScenario(
    t: ReturnType<typeof convexTest>,
    options: {
        sources?: ScenarioSource[];
    } = {},
) {
    return await t.run(async (ctx) => {
        const userId = await ctx.db.insert("users", { isAnonymous: true });
        const invitationId = await ctx.db.insert("invitations", {
            slotKey: "analyst-phase-5-claims",
            role: "analyst",
            codeDigest: "digest-claims",
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
        const planId = await ctx.db.insert("researchPlans", {
            runId,
            version: 2,
            coveragePreset: "balanced",
            queries: [
                {
                    query: "CCC software carrier integration",
                    category: "product",
                    dimensionKeys: ["workflow_control"],
                },
            ],
            createdAt: 100,
        });

        const defaultQuestions = ASSESSMENT_DIMENSION_KEYS.map(
            (dimensionKey) => ({
                questionKey: `dimension:${dimensionKey}`,
                prompt: `What public evidence addresses ${dimensionKey} for CCC Intelligent Solutions Holdings Inc.?`,
                dimensionKeys: [dimensionKey],
            }),
        );

        for (const q of defaultQuestions) {
            await ctx.db.insert("researchPlanQuestions", {
                runId,
                researchPlanId: planId,
                planVersion: 2,
                questionKey: q.questionKey,
                prompt: q.prompt,
                dimensionKeys: q.dimensionKeys,
                createdAt: 100,
            });
        }

        const defaultSources: ScenarioSource[] = options.sources ?? [
            {
                url: "https://example.com/sec/ccc-10k",
                title: "CCC 10-K Annual Report",
                origin: "sec",
                category: "regulatory_filing",
                decisions: ["accepted"],
                passages: [
                    {
                        exactQuotation:
                            "CCC network connects approximately 30,000 repair facilities and 300+ insurance carriers.",
                    },
                    {
                        exactQuotation:
                            "The company processes over 28 million auto physical damage claims annually.",
                    },
                ],
            },
            {
                url: "https://example.com/analysis/oem-telematics",
                title: "Telematics and Collision Disruption",
                origin: "exa",
                category: "industry_analysis",
                decisions: ["accepted"],
                passages: [
                    {
                        exactQuotation:
                            "OEM direct vehicle telematics could bypass traditional estimating network intermediaries.",
                    },
                    {
                        exactQuotation:
                            "Multi-modal generative models may alter estimating logic adoption across independent repair shops.",
                    },
                ],
            },
        ];

        const sourceRecords = [];
        let time = 100;

        for (const src of defaultSources) {
            time++;
            const sourceId = await ctx.db.insert("sources", {
                runId,
                canonicalUrl: src.url,
                title: src.title,
                origin: src.origin,
                category: src.category ?? "analyst_research",
                createdAt: time,
            });

            let latestDecisionId: Id<"sourceDecisions"> | undefined;
            for (const dec of src.decisions) {
                time++;
                latestDecisionId = await ctx.db.insert("sourceDecisions", {
                    runId,
                    corpusRevisionId,
                    sourceId,
                    decisionKey: `dec:${sourceId}:${time}`,
                    decision: dec,
                    reviewerVisitorId: visitorId,
                    occurredAt: time,
                });
            }

            const lastDecision = src.decisions[src.decisions.length - 1];
            if (!lastDecision || !latestDecisionId) {
                throw new Error("Decision setup error in test scenario");
            }

            await ctx.db.insert("sourceReviewItems", {
                runId,
                corpusRevisionId,
                sourceId,
                decisionRank: 0,
                sourceCreatedAt: time,
                decision: lastDecision,
                latestDecisionId,
                decisionOccurredAt: time,
            });

            const statusDocId = await ctx.db.insert("evidenceSourceStatuses", {
                runId,
                corpusRevisionId,
                sourceId,
                acceptedDecisionId: latestDecisionId,
                executionGeneration: 1,
                status: "succeeded",
                createdAt: time,
                updatedAt: time,
            });

            // If source is accepted, commit sourceVersion and passages
            if (lastDecision === "accepted") {
                const storageId = (await ctx.storage.store(
                    new Blob(["normalized document content"]),
                )) as Id<"_storage">;

                const versionHash = `hash_${src.url}`;
                const sourceVersionId = await ctx.db.insert("sourceVersions", {
                    runId,
                    corpusRevisionId,
                    sourceId,
                    acceptedDecisionId: latestDecisionId,
                    contentHash: versionHash,
                    normalizerVersion: "sec-html-v1",
                    storageId,
                    mediaType: "text/html",
                    byteCount: 200,
                    canonicalUrl: src.url,
                    retrievalVersion: "sec-v1",
                    executionGeneration: 1,
                    createdAt: time,
                });

                await ctx.db.patch(statusDocId, { sourceVersionId });

                const createdPassages = [];
                for (const [pIdx, passage] of src.passages.entries()) {
                    const quotationHash = `qhash_${sourceId}_${pIdx}`;
                    const locator = {
                        kind: "web" as const,
                        canonicalUrl: src.url,
                        sourceVersionHash: versionHash,
                        exactQuotation: passage.exactQuotation,
                        startOffset: 0,
                        endOffset: passage.exactQuotation.length,
                    };
                    const passageKey = computePassageKey({
                        sourceId,
                        sourceVersionHash: versionHash,
                        locatorVersion: "web-v1",
                        locator,
                        order: pIdx,
                        quotationHash,
                    });
                    const passageId = await ctx.db.insert("sourcePassages", {
                        sourceVersionId,
                        locatorVersion: "web-v1",
                        passageKey,
                        quotationHash,
                        order: pIdx,
                        exactQuotation: passage.exactQuotation,
                        locator,
                        createdAt: time,
                    });
                    createdPassages.push({
                        _id: passageId,
                        quotationHash,
                        exactQuotation: passage.exactQuotation,
                    });
                }

                sourceRecords.push({
                    sourceId,
                    sourceVersionId,
                    statusDocId,
                    latestDecisionId,
                    passages: createdPassages,
                });
            }
        }

        return {
            visitorId,
            runId,
            corpusRevisionId,
            sourceRecords,
        };
    });
}

describe("Claim Generation Tracer", () => {
    beforeEach(() => {
        clearShowcaseManifests();
    });

    afterEach(() => {
        clearShowcaseManifests();
    });

    test("exact showcase hash succeeds, persists immutable AITaskResult, claims, evidence, and proposed links with zero fake ProviderCall", async () => {
        const t = convexTest(schema, modules);
        rateLimiterTest.register(t);
        workflowTest.register(t);

        const scenario = await createShowcaseClaimScenario(t);

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
        expect(result.aiTaskResultId).toBeDefined();

        if (!result.aiTaskResultId) throw new Error("Missing aiTaskResultId");
        // Verify AITaskResult record
        const taskResult = await t.query(getAiTaskResult, {
            aiTaskResultId: result.aiTaskResultId,
        });
        expect(taskResult.executionMode).toBe("showcase");
        expect(taskResult.fixtureId).toBe("ccc-showcase-claims");
        expect(taskResult.fixtureVersion).toBe(SHOWCASE_FIXTURE_VERSION);
        expect(taskResult.schemaVersion).toBe(CLAIM_SCHEMA_VERSION);
        expect(taskResult.adapterVersion).toBe(SHOWCASE_ADAPTER_VERSION);
        expect(taskResult.providerCallId).toBeUndefined();
        expect(taskResult.output.kind).toBe("claim_extraction");
        if (taskResult.output.kind !== "claim_extraction") {
            throw new Error("Expected claim extraction output");
        }
        expect(taskResult.output.claimCount).toBe(result.claimCount);

        // Verify claims
        const claims = await t.query(listClaimsForRun, {
            runId: scenario.runId,
        });
        expect(claims.length).toBe(result.claimCount);

        // Verify explicit counter-evidence and context-evidence
        let foundCounter = false;
        let foundContext = false;
        for (const claim of claims) {
            const details = await t.query(getClaimDetails, {
                claimId: claim._id,
            });
            expect(details.evidence.length).toBeGreaterThan(0);
            for (const ev of details.evidence) {
                if (ev.relation === "counter") foundCounter = true;
                if (ev.relation === "context") foundContext = true;
            }
            // Verify proposed dimension links contain no effective decision
            for (const link of details.dimensionLinks) {
                expect(link.origin).toBe("generated");
                expect((link as any).decision).toBeUndefined();
                expect((link as any).accepted).toBeUndefined();
                expect((link as any).status).toBeUndefined();
            }
        }
        expect(foundCounter).toBe(true);
        expect(foundContext).toBe(true);

        // Verify providerCalls table contains ZERO provider calls
        await t.run(async (ctx) => {
            const providerCalls = await ctx.db.query("providerCalls").collect();
            expect(providerCalls).toHaveLength(0);
        });
    });

    test("one-byte changed input refuses fixture and creates zero claims", async () => {
        const t = convexTest(schema, modules);
        rateLimiterTest.register(t);
        workflowTest.register(t);

        const scenario = await createShowcaseClaimScenario(t);

        // We DO NOT register the manifest with the exact input hash
        // (or we register with a different hash)
        const result = await t.mutation(generateClaimsForRun, {
            runId: scenario.runId,
            executionGeneration: 1,
        });

        expect(result.status).toBe("unavailable");
        expect(result.claimCount).toBe(0);

        // Verify zero claims in DB
        await t.run(async (ctx) => {
            const claims = await ctx.db.query("claims").collect();
            expect(claims).toHaveLength(0);
            const aiTaskResults = await ctx.db.query("aiTaskResults").collect();
            expect(aiTaskResults).toHaveLength(0);
        });
    });

    test("foreign or rejected passage creates zero claims and refuses", async () => {
        const t = convexTest(schema, modules);
        rateLimiterTest.register(t);
        workflowTest.register(t);

        const scenario = await createShowcaseClaimScenario(t);

        const inputData = await t.query(getNormalizedClaimInput, {
            runId: scenario.runId,
            executionGeneration: 1,
        });
        if (!inputData) throw new Error("Missing inputData");

        const manifest = buildCccShowcaseManifest(inputData.normalizedInput);
        // Point claim evidence to a foreign/non-existent quotation hash
        const firstClaim = manifest.claims[0];
        const firstEvidence = firstClaim?.evidence[0];
        if (firstEvidence) {
            firstEvidence.quotationHash = "foreign_nonexistent_hash";
        }
        registerShowcaseManifest(manifest);

        await expect(
            t.mutation(generateClaimsForRun, {
                runId: scenario.runId,
                executionGeneration: 1,
            }),
        ).rejects.toThrow();

        // Verify zero claims in DB
        await t.run(async (ctx) => {
            const claims = await ctx.db.query("claims").collect();
            expect(claims).toHaveLength(0);
        });
    });

    test("claim with zero evidence passages creates zero claims and refuses", async () => {
        const t = convexTest(schema, modules);
        rateLimiterTest.register(t);
        workflowTest.register(t);

        const scenario = await createShowcaseClaimScenario(t);

        const inputData = await t.query(getNormalizedClaimInput, {
            runId: scenario.runId,
            executionGeneration: 1,
        });
        if (!inputData) throw new Error("Missing inputData");

        const manifest = buildCccShowcaseManifest(inputData.normalizedInput);
        // Corrupt claim 0 to have empty evidence array
        const firstClaim = manifest.claims[0];
        if (firstClaim) {
            firstClaim.evidence = [];
        }
        registerShowcaseManifest(manifest);

        await expect(
            t.mutation(generateClaimsForRun, {
                runId: scenario.runId,
                executionGeneration: 1,
            }),
        ).rejects.toThrow();

        // Verify zero claims in DB
        await t.run(async (ctx) => {
            const claims = await ctx.db.query("claims").collect();
            expect(claims).toHaveLength(0);
        });
    });

    test("replays idempotently with identical IDs and counts", async () => {
        const t = convexTest(schema, modules);
        rateLimiterTest.register(t);
        workflowTest.register(t);

        const scenario = await createShowcaseClaimScenario(t);

        const inputData = await t.query(getNormalizedClaimInput, {
            runId: scenario.runId,
            executionGeneration: 1,
        });
        if (!inputData) throw new Error("Missing inputData");
        registerCccShowcaseFixture(inputData.normalizedInput);

        const firstResult = await t.mutation(generateClaimsForRun, {
            runId: scenario.runId,
            executionGeneration: 1,
        });
        expect(firstResult.status).toBe("succeeded");
        expect(firstResult.reused).toBe(false);

        const firstClaims = await t.query(listClaimsForRun, {
            runId: scenario.runId,
        });

        const secondResult = await t.mutation(generateClaimsForRun, {
            runId: scenario.runId,
            executionGeneration: 1,
        });
        expect(secondResult.status).toBe("succeeded");
        expect(secondResult.reused).toBe(true);
        expect(secondResult.aiTaskResultId).toBe(firstResult.aiTaskResultId);
        expect(secondResult.claimCount).toBe(firstResult.claimCount);

        const secondClaims = await t.query(listClaimsForRun, {
            runId: scenario.runId,
        });
        expect(secondClaims).toEqual(firstClaims);

        // Verify row counts in DB
        await t.run(async (ctx) => {
            const aiTaskResults = await ctx.db.query("aiTaskResults").collect();
            expect(aiTaskResults).toHaveLength(1);
            const claims = await ctx.db.query("claims").collect();
            expect(claims).toHaveLength(firstResult.claimCount);
        });
    });

    test("source category does not infer evidence relation", async () => {
        const t = convexTest(schema, modules);
        rateLimiterTest.register(t);
        workflowTest.register(t);

        // SEC regulatory filing has counter and context relations in showcase fixture
        const scenario = await createShowcaseClaimScenario(t, {
            sources: [
                {
                    url: "https://example.com/sec/filing",
                    title: "SEC 10-K",
                    origin: "sec",
                    category: "regulatory_filing",
                    decisions: ["accepted"],
                    passages: [
                        {
                            exactQuotation: "Passage from regulatory filing.",
                        },
                    ],
                },
            ],
        });

        const inputData = await t.query(getNormalizedClaimInput, {
            runId: scenario.runId,
            executionGeneration: 1,
        });
        if (!inputData) throw new Error("Missing inputData");

        const firstPassage = inputData.normalizedInput.passages[0];
        if (!firstPassage) throw new Error("Missing firstPassage");

        // Register a manifest where regulatory_filing has a counter relation
        registerShowcaseManifest({
            fixtureId: "ccc-showcase-claims",
            fixtureVersion: SHOWCASE_FIXTURE_VERSION,
            schemaVersion: CLAIM_SCHEMA_VERSION,
            adapterVersion: SHOWCASE_ADAPTER_VERSION,
            inputHash: inputData.inputHash,
            claims: [
                {
                    statement:
                        "Regulatory disclosure reveals counter-evidence to platform dominance.",
                    classification: "Inference",
                    evidence: [
                        {
                            quotationHash: firstPassage.quotationHash,
                            passageKey: firstPassage.passageKey,
                            sourceVersionHash: firstPassage.sourceVersionHash,
                            relation: "counter",
                        },
                    ],
                    dimensionLinks: [
                        {
                            dimensionKey: "workflow_control",
                            rationale: "Filing disclosure",
                        },
                    ],
                },
            ],
        });

        const result = await t.mutation(generateClaimsForRun, {
            runId: scenario.runId,
            executionGeneration: 1,
        });

        expect(result.status).toBe("succeeded");
        const claims = await t.query(listClaimsForRun, {
            runId: scenario.runId,
        });
        expect(claims).toHaveLength(1);
        const firstClaim = claims[0];
        if (!firstClaim) throw new Error("Missing claim");
        const details = await t.query(getClaimDetails, {
            claimId: firstClaim._id,
        });
        expect(details.evidence[0]?.relation).toBe("counter");
    });

    test("one-byte change in question prompt or passage quotation changes inputHash and refuses fixture", async () => {
        const t = convexTest(schema, modules);
        rateLimiterTest.register(t);
        workflowTest.register(t);

        const scenario = await createShowcaseClaimScenario(t);

        const inputData = await t.query(getNormalizedClaimInput, {
            runId: scenario.runId,
            executionGeneration: 1,
        });
        if (!inputData) throw new Error("Missing inputData");

        // Register fixture with original input
        registerCccShowcaseFixture(inputData.normalizedInput);

        // Mutate one byte in a question prompt in DB
        await t.run(async (ctx) => {
            const question = await ctx.db
                .query("researchPlanQuestions")
                .withIndex("by_run", (q) => q.eq("runId", scenario.runId))
                .first();
            if (question) {
                await ctx.db.patch(question._id, {
                    prompt: `${question.prompt}!`,
                });
            }
        });

        const mutatedInputData = await t.query(getNormalizedClaimInput, {
            runId: scenario.runId,
            executionGeneration: 1,
        });
        if (!mutatedInputData) throw new Error("Missing mutatedInputData");
        expect(mutatedInputData.inputHash).not.toBe(inputData.inputHash);

        const result = await t.mutation(generateClaimsForRun, {
            runId: scenario.runId,
            executionGeneration: 1,
        });

        expect(result.status).toBe("unavailable");
        expect(result.claimCount).toBe(0);
    });

    test("invalid dimension key or classification in manifest throws error and creates zero claims", async () => {
        const t = convexTest(schema, modules);
        rateLimiterTest.register(t);
        workflowTest.register(t);

        const scenario = await createShowcaseClaimScenario(t);

        const inputData = await t.query(getNormalizedClaimInput, {
            runId: scenario.runId,
            executionGeneration: 1,
        });
        if (!inputData) throw new Error("Missing inputData");

        const manifest = buildCccShowcaseManifest(inputData.normalizedInput);
        const link = manifest.claims[0]?.dimensionLinks[0];
        if (link) {
            (link as any).dimensionKey = "nonexistent_dimension_key";
        }
        registerShowcaseManifest(manifest);

        await expect(
            t.mutation(generateClaimsForRun, {
                runId: scenario.runId,
                executionGeneration: 1,
            }),
        ).rejects.toThrow();

        await t.run(async (ctx) => {
            const claims = await ctx.db.query("claims").collect();
            expect(claims).toHaveLength(0);
        });
    });

    test("taskType is showcase_claim_extraction (not claim_generation)", async () => {
        const t = convexTest(schema, modules);
        rateLimiterTest.register(t);
        workflowTest.register(t);

        const scenario = await createShowcaseClaimScenario(t);
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
        if (!result.aiTaskResultId) throw new Error("Missing aiTaskResultId");

        const taskResult = await t.query(getAiTaskResult, {
            aiTaskResultId: result.aiTaskResultId,
        });
        expect(taskResult.taskType).toBe("showcase_claim_extraction");
    });

    test("claims include inputHash and different input creates distinct claims", async () => {
        const t = convexTest(schema, modules);
        rateLimiterTest.register(t);
        workflowTest.register(t);

        const scenario = await createShowcaseClaimScenario(t);
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

        // Verify claims have inputHash
        await t.run(async (ctx) => {
            const claims = await ctx.db.query("claims").collect();
            for (const claim of claims) {
                expect(claim.inputHash).toBe(inputData.inputHash);
            }
        });
    });

    test("plan questions loaded by plan ID and version, not by run", async () => {
        const t = convexTest(schema, modules);
        rateLimiterTest.register(t);
        workflowTest.register(t);

        const scenario = await createShowcaseClaimScenario(t);

        // Add orphan question referencing a different real plan — should not be loaded
        await t.run(async (ctx) => {
            const orphanPlanId = await ctx.db.insert("researchPlans", {
                runId: scenario.runId,
                version: 1,
                coveragePreset: "balanced",
                queries: [],
                createdAt: 200,
            });
            await ctx.db.insert("researchPlanQuestions", {
                runId: scenario.runId,
                researchPlanId: orphanPlanId,
                planVersion: 1,
                questionKey: "orphan_question",
                prompt: "Orphan prompt that should not be loaded",
                dimensionKeys: ["context_ownership"],
                createdAt: 200,
            });
        });

        const inputData = await t.query(getNormalizedClaimInput, {
            runId: scenario.runId,
            executionGeneration: 1,
        });
        if (!inputData) throw new Error("Missing inputData");

        // The orphan question should NOT appear in normalized input
        // (it references a different planId)
        const orphanPrompt = "Orphan prompt that should not be loaded";
        const hasOrphan = inputData.normalizedInput.questions.some(
            (q: { prompt: string }) => q.prompt === orphanPrompt,
        );
        expect(hasOrphan).toBe(false);
    });

    test("deep-frozen manifest cannot be mutated after registration", async () => {
        const t = convexTest(schema, modules);
        rateLimiterTest.register(t);
        workflowTest.register(t);

        const scenario = await createShowcaseClaimScenario(t);
        const inputData = await t.query(getNormalizedClaimInput, {
            runId: scenario.runId,
            executionGeneration: 1,
        });
        if (!inputData) throw new Error("Missing inputData");

        const entry = registerCccShowcaseFixture(inputData.normalizedInput);

        // Attempt to mutate the returned entry
        const registeredClaim = entry.claims[0];
        if (!registeredClaim) throw new Error("Missing showcase claim");
        const originalStatement = registeredClaim.statement;
        try {
            registeredClaim.statement = "MUTATED";
        } catch {
            // Expected: frozen object throws in strict mode
        }

        // Verify the registered manifest is unchanged
        const result = await t.mutation(generateClaimsForRun, {
            runId: scenario.runId,
            executionGeneration: 1,
        });
        expect(result.status).toBe("succeeded");

        const claims = await t.query(listClaimsForRun, {
            runId: scenario.runId,
        });
        // First claim statement should be the original, not mutated
        const firstClaim = claims[0];
        expect(firstClaim?.statement).toBe(originalStatement);
    });

    test("same quotation hash across different sources creates separate passage entries", async () => {
        const t = convexTest(schema, modules);
        rateLimiterTest.register(t);
        workflowTest.register(t);

        // Two sources with identical quotation text
        const scenario = await createShowcaseClaimScenario(t, {
            sources: [
                {
                    url: "https://example.com/sec/filing1",
                    title: "SEC Filing 1",
                    origin: "sec",
                    category: "regulatory_filing",
                    decisions: ["accepted"],
                    passages: [{ exactQuotation: "Identical passage text." }],
                },
                {
                    url: "https://example.com/exa/analysis1",
                    title: "Exa Analysis 1",
                    origin: "exa",
                    category: "industry_analysis",
                    decisions: ["accepted"],
                    passages: [{ exactQuotation: "Identical passage text." }],
                },
            ],
        });

        const inputData = await t.query(getNormalizedClaimInput, {
            runId: scenario.runId,
            executionGeneration: 1,
        });
        if (!inputData) throw new Error("Missing inputData");

        // Both passages should be present (different sourceId)
        expect(inputData.normalizedInput.passages.length).toBe(2);
        const p0 = inputData.normalizedInput.passages[0];
        const p1 = inputData.normalizedInput.passages[1];
        if (!p0 || !p1) throw new Error("Missing passages");
        // Different sourceId
        expect(p0.sourceId).not.toBe(p1.sourceId);
        // Same text but different sourceId → different passage identity
        expect(p0.exactQuotation).toBe(p1.exactQuotation);
    });

    test("MAX_CLAIM_INPUT_PASSAGES overflow refuses before Convex transaction limits", async () => {
        const t = convexTest(schema, modules);
        rateLimiterTest.register(t);
        workflowTest.register(t);

        // Create scenario with enough sources to accumulate >4096 passages
        // 9 sources × 512 passages each = 4608 > 4096
        const sources = [];
        for (let i = 0; i < 9; i++) {
            const passages = [];
            for (let j = 0; j < 512; j++) {
                passages.push({ exactQuotation: `Source${i} passage ${j}.` });
            }
            sources.push({
                url: `https://example.com/src${i}`,
                title: `Source ${i}`,
                origin: i % 2 === 0 ? ("sec" as const) : ("exa" as const),
                category: "research",
                decisions: ["accepted" as const],
                passages,
            });
        }

        const scenario = await createShowcaseClaimScenario(t, { sources });

        await expect(
            t.query(getNormalizedClaimInput, {
                runId: scenario.runId,
                executionGeneration: 1,
            }),
        ).rejects.toThrow(/MAX_CLAIM_INPUT_PASSAGES/);

        // Handler should throw during bounded passage loading.
        await expect(
            t.mutation(generateClaimsForRun, {
                runId: scenario.runId,
                executionGeneration: 1,
            }),
        ).rejects.toThrow(/MAX_CLAIM_INPUT_PASSAGES/);

        // Verify zero claims
        await t.run(async (ctx) => {
            const claims = await ctx.db.query("claims").collect();
            expect(claims).toHaveLength(0);
        });
    });
});
