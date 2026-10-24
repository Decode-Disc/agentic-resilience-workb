import type { DataModel, Doc, Id } from "@convex/_generated/dataModel";
import type { GenericDatabaseReader } from "convex/server";
import { mergeRunCompanyMetadata } from "./companyMetadata";
import {
    SOURCE_COMPARISON_MAX_CANDIDATES,
    SOURCE_COMPARISON_VERSION,
} from "./sourceComparison";
import { sha256Hex } from "./sourcePassages";
import {
    readPreparationSourceDecision,
    sourcePreparationError,
} from "./sourcePreparationAuthority";
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
};

/** Reads primary context once; preparation execution and recovery share its eligibility rules. */
export async function readComparisonPrimaryContext(
    db: GenericDatabaseReader<DataModel>,
    run: Doc<"researchRuns">,
    corpusRevisionId: Id<"corpusRevisions">,
) {
    const company = mergeRunCompanyMetadata(
        run.companySnapshot,
        run.companyId ? await db.get(run.companyId) : null,
    );
    if (!company) throw sourcePreparationError("company_unavailable");
    const sources = await db
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
        const decision = await readPreparationSourceDecision(db, {
            runId: run._id,
            corpusRevisionId: corpusRevisionId,
            sourceId: source._id,
        });
        if (decision === "rejected") continue;
        const capture = await db
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
        const priorQualification = await db
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
    const comparisonContextHash = sha256Hex(
        JSON.stringify({
            version: SOURCE_COMPARISON_VERSION,
            retrieval: [
                target.preparation.retrievalVersion ?? null,
                target.preparation.retrievalMode ?? null,
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
                target.qualification._id,
                target.qualification.inputHash,
            ],
            primary: primaryCandidates.map(
                ({
                    source,
                    capture,
                    context: sourceContext,
                    reportingPeriodEnd,
                }) => ({
                    sourceId: source._id,
                    title: source.title,
                    canonicalUrl: capture.resolvedUrl ?? source.canonicalUrl,
                    category: source.category,
                    publishedAt: source.publishedAt,
                    captureId: capture._id,
                    contentHash: capture.contentHash,
                    byteCount: capture.byteCount,
                    context: sourceContext,
                    reportingPeriodEnd,
                }),
            ),
            candidateMetadataLimitReached:
                context.candidateMetadataLimitReached,
        }),
    );
    return { primaryCandidates, comparisonContextHash };
}
