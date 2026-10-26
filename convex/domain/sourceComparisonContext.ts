import type { DataModel, Doc, Id } from "@convex/_generated/dataModel";
import { SOURCE_EMBEDDING_PROFILE_VERSION } from "@convex/resourceLimits";
import type { GenericDatabaseReader } from "convex/server";
import { mergeRunCompanyMetadata } from "./companyMetadata";
import {
    SOURCE_COMPARISON_MAX_CANDIDATES,
    SOURCE_COMPARISON_VERSION,
    sourceComparisonInputPolicyHash,
    sourceFindingNeedsComparison,
} from "./sourceComparison";
import { sha256Hex } from "./sourcePassages";
import {
    readPreparationSourceDecision,
    sourcePreparationError,
} from "./sourcePreparationAuthority";
import {
    readCaptureIndexState,
    SOURCE_RETRIEVAL_VERSION,
} from "./sourceRetrievalPolicy";
import type { SourceReviewReads } from "./sourceReviewReads";
import { classifySourceComparisonContext } from "./sourceSelectionPolicy";

type ComparisonPrimaryCandidate = {
    source: Doc<"sources">;
    capture: Doc<"sourceCaptures">;
    context: ReturnType<typeof classifySourceComparisonContext> & {
        authorityTier:
            | "regulator_primary"
            | "company_primary"
            | "company_hosted_ir";
    };
    reportingPeriodEnd?: string | null;
    retrievalStateHash: string;
};

/** Reads primary context once; preparation execution and recovery share its eligibility rules. */
export async function readComparisonPrimaryContext(
    db: GenericDatabaseReader<DataModel>,
    run: Doc<"researchRuns">,
    corpusRevisionId: Id<"corpusRevisions">,
    reads?: SourceReviewReads,
) {
    const company = mergeRunCompanyMetadata(
        run.companySnapshot,
        run.companyId ? await db.get(run.companyId) : null,
    );
    if (!company) throw sourcePreparationError("company_unavailable");
    const sources = reads
        ? (await reads.sources()).slice(0, SOURCE_COMPARISON_MAX_CANDIDATES)
        : await db
              .query("sources")
              .withIndex("by_run_and_url", (q) => q.eq("runId", run._id))
              .take(SOURCE_COMPARISON_MAX_CANDIDATES);
    const primaryCandidates: Array<ComparisonPrimaryCandidate> = [];
    const seenCaptures = new Set<string>();
    for (const source of sources) {
        const context = classifySourceComparisonContext(
            {
                sourceId: source._id,
                canonicalUrl: source.canonicalUrl,
                title: source.title,
                origin: source.origin,
                category: source.category,
                publishedAt: source.publishedAt,
                providerReference: source.providerReference,
                secForm: source.secForm,
                secAccessionNumber: source.secAccessionNumber,
                providerResultPosition: source.providerResultPosition,
                discoveryQueryIndex: source.discoveryQueryIndex,
                createdAt: source.createdAt,
            },
            company,
        );
        if (
            (context.authorityTier !== "regulator_primary" &&
                context.authorityTier !== "company_primary" &&
                context.authorityTier !== "company_hosted_ir") ||
            !context.companyIdentityConfirmed
        )
            continue;
        const authorityTier = context.authorityTier;
        const decision = reads
            ? await reads.decision(corpusRevisionId, source._id)
            : await readPreparationSourceDecision(db, {
                  runId: run._id,
                  corpusRevisionId: corpusRevisionId,
                  sourceId: source._id,
              });
        if (decision === "rejected") continue;
        const capture = reads
            ? (await reads.captureHistory(source._id))[0]
            : await db
                  .query("sourceCaptures")
                  .withIndex("by_source_and_status_and_updated_at", (q) =>
                      q.eq("sourceId", source._id).eq("status", "committed"),
                  )
                  .order("desc")
                  .first();
        if (
            !capture?.storageId ||
            !capture.contentHash ||
            capture.runId !== run._id ||
            source.runId !== run._id
        )
            continue;
        const identity = `${source._id}:${capture._id}:${capture.contentHash}`;
        if (seenCaptures.has(identity)) continue;
        seenCaptures.add(identity);
        const priorQualification = reads
            ? (await reads.qualificationHistory(source._id))[0]
            : await db
                  .query("aiTaskResults")
                  .withIndex("by_source_and_task_type_and_created_at", (q) =>
                      q
                          .eq("sourceId", source._id)
                          .eq("taskType", "source_qualification"),
                  )
                  .order("desc")
                  .first();
        const matchingQualification =
            priorQualification?.runId === run._id &&
            priorQualification.corpusRevisionId === capture.corpusRevisionId &&
            priorQualification.output.kind === "source_qualification" &&
            priorQualification.output.sourceCaptureId === capture._id &&
            priorQualification.output.contentHash === capture.contentHash
                ? priorQualification
                : null;
        primaryCandidates.push({
            source,
            capture,
            retrievalStateHash: sha256Hex(
                JSON.stringify(
                    await readCaptureIndexState(
                        db,
                        { runId: run._id, corpusRevisionId },
                        capture._id,
                    ),
                ),
            ),
            context: { ...context, authorityTier },
            ...(matchingQualification?.output.kind === "source_qualification"
                ? {
                      reportingPeriodEnd:
                          matchingQualification.output.qualification
                              .reportingPeriodEnd,
                  }
                : {}),
        });
    }
    return {
        company,
        primaryCandidates,
        candidateMetadataLimitReached:
            sources.length === SOURCE_COMPARISON_MAX_CANDIDATES,
    };
}

/** Identifies current comparison work without reading the retained document bodies. */
export function comparisonContextForTarget(
    context: Awaited<ReturnType<typeof readComparisonPrimaryContext>>,
    target: {
        source: Doc<"sources">;
        capture: Doc<"sourceCaptures">;
        qualification: Doc<"aiTaskResults">;
        preparation: Doc<"sourceSelectionProposalRebuilds">;
    },
) {
    const primaryCandidates = context.primaryCandidates.filter(
        (candidate) => candidate.source._id !== target.source._id,
    );
    const identity = {
        version: SOURCE_COMPARISON_VERSION,
        preparationPolicy: sourceComparisonInputPolicyHash(
            target.qualification.schemaVersion,
        ),
        retrievalPolicy: SOURCE_RETRIEVAL_VERSION,
        embeddingProfile:
            target.preparation.retrievalMode === "hybrid"
                ? SOURCE_EMBEDDING_PROFILE_VERSION
                : null,
        retrieval: [
            target.preparation.retrievalVersion ?? null,
            target.preparation.retrievalMode ?? null,
            ...(target.preparation.retrievalRankingPolicy
                ? [target.preparation.retrievalRankingPolicy]
                : []),
        ],
        company: {
            cik: context.company.cik,
            legalName: context.company.legalName,
            ticker: context.company.ticker,
        },
        target: [
            target.source._id,
            target.source.title,
            target.capture.resolvedUrl ?? target.source.canonicalUrl,
            target.capture._id,
            target.capture.contentHash,
            target.capture.storageId,
            target.qualification._id,
            target.qualification.inputHash,
        ],
        primary: primaryCandidates.map(
            ({
                source,
                capture,
                context: sourceContext,
                reportingPeriodEnd,
                retrievalStateHash,
            }) => ({
                sourceId: source._id,
                title: source.title,
                canonicalUrl: capture.resolvedUrl ?? source.canonicalUrl,
                category: source.category,
                publishedAt: source.publishedAt,
                captureId: capture._id,
                contentHash: capture.contentHash,
                byteCount: capture.byteCount,
                storageId: capture.storageId,
                retrievalStateHash,
                context: sourceContext,
                reportingPeriodEnd,
            }),
        ),
        candidateMetadataLimitReached: context.candidateMetadataLimitReached,
    };
    const comparisonContextHash = sha256Hex(JSON.stringify(identity));
    const comparisonBaseContextHash = sha256Hex(
        JSON.stringify({
            ...identity,
            primary: identity.primary.map(
                ({ retrievalStateHash: _state, ...metadata }) => metadata,
            ),
        }),
    );
    return {
        primaryCandidates,
        comparisonContextHash,
        comparisonBaseContextHash,
    };
}

/** Recovery and execution share the decision; callers still validate references and captured bytes. */
export function sourceComparisonWork(
    qualification: Doc<"aiTaskResults">,
    tasks: Doc<"aiTaskResults">[],
    contextHash: string | undefined,
) {
    const output = qualification.output;
    if (
        output.kind !== "source_qualification" ||
        !output.qualification.findings.some((finding) =>
            sourceFindingNeedsComparison(
                finding,
                output.qualification.limitations,
            ),
        )
    )
        return { kind: "not_needed" as const };
    const contentHash = output.contentHash;
    const current = tasks.find(
        (task) =>
            task.taskType === "source_comparison" &&
            task.schemaVersion === SOURCE_COMPARISON_VERSION &&
            task.comparisonContextHash === contextHash &&
            !!contextHash &&
            task.runId === qualification.runId &&
            task.corpusRevisionId === qualification.corpusRevisionId &&
            task.output.kind === "source_comparison" &&
            task.output.targetCaptureId === qualification.sourceCaptureId &&
            task.output.targetContentHash === contentHash &&
            task.output.qualificationTaskId === qualification._id &&
            ["compared", "not_run"].includes(task.output.checkStatus),
    );
    return current
        ? { kind: "reusable" as const, task: current }
        : { kind: "rebuild" as const };
}
