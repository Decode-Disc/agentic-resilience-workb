import { api, internal } from "@convex/_generated/api";
import {
    SOURCE_COMPARISON_VERSION,
    type SourceComparisonOutput,
} from "@convex/domain/sourceComparison";
import { sha256Hex } from "@convex/domain/sourcePassages";
import {
    SOURCE_QUALIFICATION_VERSION,
    type SourceQualification,
} from "@convex/domain/sourceQualification";
import { upsertSourceReviewItem } from "@convex/domain/sourceReviewProjection";
import schema from "@convex/schema";
import type { FunctionArgs } from "convex/server";
import { convexTest, type TestConvex } from "convex-test";
import { vi } from "vitest";
import { installModel } from "./model-configuration";
import { SOURCES_TEST_WINDOW_MINUTES } from "./sources-mission";

const modules = import.meta.glob("/convex/**/*.ts");

/** Creates owned public candidates without corpus approval or analytical artifacts. */
export async function seedSourcePreparation(
    options: { models?: boolean } = {},
    existing?: TestConvex<typeof schema>,
) {
    vi.stubEnv(
        "SOURCES_PREPARATION_WINDOW_MINUTES",
        String(SOURCES_TEST_WINDOW_MINUTES),
    );
    const t = existing ?? convexTest(schema, modules);
    const fixture = await t.run(async (ctx) => {
        const userId = await ctx.db.insert("users", { isAnonymous: true });
        const invitationId = await ctx.db.insert("invitations", {
            slotKey: existing
                ? `source-preparation-test:${userId}`
                : "source-preparation-test",
            role: "analyst",
            codeDigest: "source-preparation-test-digest",
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
        await ctx.db.patch(invitationId, { claimedByVisitorId: visitorId });
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
            lifecycleState: "discovering_sources",
            executionStatus: "running",
            executionGeneration: 3,
            workflowVersion: 1,
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
        await ctx.db.patch(runId, { activeCorpusRevisionId: corpusRevisionId });
        const sourceId = await ctx.db.insert("sources", {
            runId,
            canonicalUrl: "https://www.servicenow.com/products/workflows.html",
            title: "Workflow products",
            origin: "exa",
            category: "official_product",
            createdAt: 1,
        });
        const decisionId = await ctx.db.insert("sourceDecisions", {
            runId,
            corpusRevisionId,
            sourceId,
            decisionKey: "initial-pending",
            decision: "pending",
            occurredAt: 1,
        });
        await upsertSourceReviewItem(ctx, {
            runId,
            corpusRevisionId,
            sourceId,
            decision: "pending",
            sourceCreatedAt: 1,
            latestDecisionId: decisionId,
            decisionOccurredAt: 1,
        });
        return {
            userId,
            visitorId,
            invitationId,
            companyId,
            runId,
            corpusRevisionId,
            sourceId,
        };
    });
    if (options.models)
        await installModel(
            t,
            {
                model: "z-ai/glm-5.3-flash",
                provider: "open-inference/fp4",
                reasoningEffort: "low",
            },
            "sources",
        );
    return { t, ...fixture };
}

/** Seeds an inspected proposal, records an analyst acceptance, then freezes its evidence execution. */
export async function seedInspectedEvidence(
    options: {
        qualification?: SourceQualification;
        text?: string;
        comparison?: boolean;
    } = {},
    existing?: TestConvex<typeof schema>,
) {
    const fixture = await seedSourcePreparation({}, existing);
    const { t, runId, corpusRevisionId, sourceId, userId } = fixture;
    await t.mutation(internal.researchPlanning.createForRun, {
        runId,
        expectedExecutionGeneration: 3,
    });
    const preparationId = await t.mutation(
        internal.sourcePreparation.claimForDiscovery,
        { runId, corpusRevisionId, expectedExecutionGeneration: 3 },
    );
    const text =
        options.text ??
        "# Workflow platform\n\nServiceNow provides workflow software through its platform.";
    const captureId = await t.run(async (ctx) => {
        const storageId = await ctx.storage.store(
            new Blob([text], { type: "text/plain" }),
        );
        return ctx.db.insert("sourceCaptures", {
            runId,
            corpusRevisionId,
            sourceId,
            preparationId,
            executionGeneration: 3,
            captureKey: "inspected-evidence",
            requestInputHash: sha256Hex("test-input"),
            status: "committed",
            requestedUrl: "https://www.servicenow.com/products/workflows.html",
            resolvedUrl: "https://www.servicenow.com/products/workflows.html",
            storageId,
            contentHash: sha256Hex(text),
            byteCount: new TextEncoder().encode(text).length,
            mediaType: "text/plain",
            retrievalVersion: "test-v1",
            normalizerVersion: "test-v1",
            retrievedAt: Date.now(),
            readingCompleteness: "complete",
            omittedPassageCount: 0,
            createdAt: Date.now(),
            updatedAt: Date.now(),
        });
    });
    const qualification = options.qualification;
    let qualificationTaskId: string | undefined;
    if (qualification)
        qualificationTaskId = await t.run(async (ctx) => {
            const capture = await ctx.db.get(captureId);
            if (!capture?.contentHash)
                throw new Error("Missing fixture capture");
            return ctx.db.insert("aiTaskResults", {
                runId,
                corpusRevisionId,
                sourceId,
                sourceCaptureId: captureId,
                taskType: "source_qualification",
                executionMode: "live",
                schemaVersion: SOURCE_QUALIFICATION_VERSION,
                adapterVersion: "qualification-fixture",
                inputHash: sha256Hex(text),
                output: {
                    kind: "source_qualification",
                    sourceCaptureId: captureId,
                    contentHash: capture.contentHash,
                    qualification,
                    readingCompleteness: "complete",
                    omittedPassageCount: 0,
                    selectedPassages: [
                        {
                            passageKey: "p0",
                            startOffset: 0,
                            endOffset: text.length,
                        },
                    ],
                },
                createdAt: Date.now(),
            });
        });
    if (options.comparison && qualification && qualificationTaskId) {
        await t.run(async (ctx) => {
            const primaryText =
                "The annual report says the company competes with enterprise software providers that bundle workflow applications into broader subscriptions.";
            const primarySourceId = await ctx.db.insert("sources", {
                runId,
                canonicalUrl:
                    "https://www.sec.gov/Archives/edgar/data/1373715/000137371526000005/annual-report.htm",
                title: "Annual report context",
                origin: "sec",
                category: "regulatory_annual",
                secForm: "10-K",
                createdAt: Date.now(),
            });
            const decisionId = await ctx.db.insert("sourceDecisions", {
                runId,
                corpusRevisionId,
                sourceId: primarySourceId,
                decisionKey: "primary-context-pending",
                decision: "pending",
                occurredAt: Date.now(),
            });
            await upsertSourceReviewItem(ctx, {
                runId,
                corpusRevisionId,
                sourceId: primarySourceId,
                decision: "pending",
                sourceCreatedAt: Date.now(),
                latestDecisionId: decisionId,
                decisionOccurredAt: Date.now(),
            });
            const primaryStorageId = await ctx.storage.store(
                new Blob([primaryText], { type: "text/plain" }),
            );
            const primaryCaptureId = await ctx.db.insert("sourceCaptures", {
                runId,
                corpusRevisionId,
                sourceId: primarySourceId,
                preparationId,
                executionGeneration: 3,
                captureKey: "primary-comparison-context",
                requestInputHash: sha256Hex("primary-comparison-context"),
                status: "committed",
                requestedUrl:
                    "https://www.sec.gov/Archives/edgar/data/1373715/000137371526000005/annual-report.htm",
                resolvedUrl:
                    "https://www.sec.gov/Archives/edgar/data/1373715/000137371526000005/annual-report.htm",
                storageId: primaryStorageId,
                contentHash: sha256Hex(primaryText),
                byteCount: new TextEncoder().encode(primaryText).length,
                mediaType: "text/plain",
                retrievalVersion: "test-v1",
                normalizerVersion: "test-v1",
                retrievedAt: Date.now(),
                readingCompleteness: "complete",
                omittedPassageCount: 0,
                createdAt: Date.now(),
                updatedAt: Date.now(),
            });
            const primaryCapture = await ctx.db.get(primaryCaptureId);
            const targetCapture = await ctx.db.get(captureId);
            const primaryContentHash = primaryCapture?.contentHash;
            const targetContentHash = targetCapture?.contentHash;
            if (
                !primaryCapture ||
                !primaryContentHash ||
                !targetCapture ||
                !targetContentHash
            )
                throw new Error("Missing comparison fixture capture");
            const comparableDimensions: SourceComparisonOutput["findings"][number]["comparableDimensions"] =
                [
                    "entity",
                    "concept",
                    "period",
                    "unit_basis",
                    "argument_effect",
                ];
            const findings: SourceComparisonOutput["findings"] =
                qualification.findings
                    .map((finding, findingIndex) => {
                        if (
                            !["attributed_argument", "forecast"].includes(
                                finding.kind,
                            )
                        )
                            return null;
                        const targetPassages = finding.passages.flatMap(
                            (reference) => {
                                const startOffset = text.indexOf(
                                    reference.quotation,
                                );
                                if (startOffset < 0) return [];
                                return [
                                    {
                                        passageKey: reference.passageKey,
                                        startOffset,
                                        endOffset:
                                            startOffset +
                                            reference.quotation.length,
                                        quotation: reference.quotation,
                                    },
                                ];
                            },
                        );
                        if (!targetPassages.length) return null;
                        return {
                            findingIndex,
                            disposition: "no_conflict_observed" as const,
                            explanation:
                                "The cited primary passage is comparable within the stated scope.",
                            comparableDimensions,
                            targetPassages,
                            primaryPassages: [
                                {
                                    sourceId: String(primarySourceId),
                                    captureId: String(primaryCaptureId),
                                    contentHash: primaryContentHash,
                                    passageKey: "p0",
                                    startOffset: 0,
                                    endOffset: primaryText.length,
                                    quotation: primaryText,
                                },
                            ],
                        };
                    })
                    .filter((finding) => finding !== null);
            const output: SourceComparisonOutput = {
                kind: "source_comparison",
                comparisonVersion: SOURCE_COMPARISON_VERSION,
                checkStatus: "compared",
                runId: String(runId),
                corpusRevisionId: String(corpusRevisionId),
                inputHash: sha256Hex(`fixture-comparison:${captureId}`),
                targetSourceId: String(sourceId),
                targetCaptureId: String(captureId),
                targetContentHash,
                qualificationTaskId: qualificationTaskId,
                completeness: "complete",
                omittedFindingIndexes: [],
                omittedPrimaryCaptureCount: 0,
                omittedPrimaryPassageCount: 0,
                findings,
            };
            return ctx.db.insert("aiTaskResults", {
                runId,
                corpusRevisionId,
                sourceId,
                sourceCaptureId: captureId,
                taskType: "source_comparison",
                executionMode: "live",
                schemaVersion: SOURCE_COMPARISON_VERSION,
                adapterVersion: "comparison-fixture",
                inputHash: sha256Hex(JSON.stringify(output)),
                output,
                createdAt: Date.now(),
            });
        });
    }
    await t.mutation(internal.sourceSelectionProposals.generateForRun, {
        runId,
        expectedExecutionGeneration: 3,
    });
    await t.run((ctx) =>
        ctx.db.patch(runId, {
            lifecycleState: "awaiting_source_review",
            executionStatus: "paused",
            pauseReason: "source_review",
        }),
    );
    await t.withIdentity({ subject: userId }).mutation(api.sources.decide, {
        runId,
        corpusRevisionId,
        sourceId,
        decision: "accepted",
        decisionKey: "accept-inspected",
        reason: "Analyst reviewed the captured document",
    });
    const acceptedDecisionId = await t.run(async (ctx) => {
        const head = await ctx.db
            .query("sourceReviewItems")
            .withIndex("by_revision_and_source", (q) =>
                q
                    .eq("corpusRevisionId", corpusRevisionId)
                    .eq("sourceId", sourceId),
            )
            .unique();
        if (!head) throw new Error("Missing accepted source head");
        await ctx.db.patch(corpusRevisionId, {
            status: "approved",
            approvedByVisitorId: fixture.visitorId,
            approvedAt: Date.now(),
        });
        await ctx.db.patch(runId, {
            lifecycleState: "extracting_evidence",
            executionStatus: "running",
            executionGeneration: 4,
            pauseReason: undefined,
        });
        await ctx.db.insert("evidenceSourceStatuses", {
            runId,
            corpusRevisionId,
            sourceId,
            acceptedDecisionId: head.latestDecisionId,
            executionGeneration: 4,
            status: "queued",
            requestKey: "test-evidence",
            createdAt: Date.now(),
            updatedAt: Date.now(),
        });
        return head.latestDecisionId;
    });
    return {
        ...fixture,
        captureId,
        text,
        args: {
            runId,
            corpusRevisionId,
            sourceId,
            acceptedDecisionId,
            executionGeneration: 4,
        },
    };
}

/** Assigns a retained inspection binding for fixtures that send the sourceId/passageOrder contract. */
export async function startRetainedInspection(
    t: Awaited<ReturnType<typeof seedInspectedEvidence>>["t"],
    args: Omit<
        FunctionArgs<typeof internal.execution.missions.start>,
        "definitionId"
    >,
) {
    const missionId = await t.mutation(internal.execution.missions.start, {
        ...args,
        definitionId: "saved_material_inspection_v1",
    });
    await t.run((ctx) => ctx.db.patch(missionId, { definitionVersion: 2 }));
    return missionId;
}
