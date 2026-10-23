import type { Doc, Id } from "@convex/_generated/dataModel";
import { SOURCE_RETRIEVAL_VERSION } from "@convex/domain/sourceRetrievalPolicy";
import { readPreparationSourceDecision } from "@convex/domain/sourcePreparationAuthority";
import {
    readPinnedComparisonReview,
    readPinnedSourceQualification,
} from "@convex/domain/sourceUsage";
import { getAuthUserId } from "@convex-dev/auth/server";
import { type Infer, v } from "convex/values";
import { doc } from "convex-helpers/validators";
import {
    env,
    internalMutation,
    internalQuery,
    type MutationCtx,
    mutation,
    type QueryCtx,
} from "./_generated/server";
import { assertEvidenceExecutionFence } from "./domain/evidenceAuthority";
import { computePassageKey } from "./domain/sourcePassages";
import {
    MAX_PASSAGES_PER_SOURCE,
    sourceDossierCandidateLimit,
} from "./resourceLimits";
import schema from "./schema";

const webLocatorValidator = v.object({
    kind: v.literal("web"),
    canonicalUrl: v.string(),
    sourceVersionHash: v.string(),
    headingPath: v.optional(v.array(v.string())),
    exactQuotation: v.string(),
    startOffset: v.optional(v.number()),
    endOffset: v.optional(v.number()),
    boundingText: v.optional(v.string()),
    contextBefore: v.optional(v.string()),
    contextAfter: v.optional(v.string()),
});

const pdfLocatorValidator = v.object({
    kind: v.literal("pdf"),
    canonicalUrl: v.string(),
    sourceVersionHash: v.string(),
    pageNumber: v.number(),
    headingPath: v.optional(v.array(v.string())),
    exactQuotation: v.string(),
    startOffset: v.optional(v.number()),
    endOffset: v.optional(v.number()),
    boundingText: v.optional(v.string()),
    contextBefore: v.optional(v.string()),
    contextAfter: v.optional(v.string()),
});

const sourcePassageInputValidator = v.object({
    order: v.number(),
    exactQuotation: v.string(),
    quotationHash: v.string(),
    passageKey: v.optional(v.string()),
    locatorVersion: v.string(),
    locator: v.union(webLocatorValidator, pdfLocatorValidator),
    contextBefore: v.optional(v.string()),
    contextAfter: v.optional(v.string()),
    headingPath: v.optional(v.array(v.string())),
});

const retrievalMetadataValidator = v.object({
    secAccessionNumber: v.optional(v.string()),
    secForm: v.optional(v.string()),
    companyCik: v.optional(v.string()),
    primaryDocument: v.optional(v.string()),
    providerReference: v.optional(v.string()),
    searchTime: v.optional(v.number()),
    costDollars: v.optional(v.number()),
    contentType: v.optional(v.string()),
    pageCount: v.optional(v.number()),
    pdfFingerprint: v.optional(v.string()),
});

const statusDocValidator = doc(schema, "evidenceSourceStatuses");
const sourceDocValidator = doc(schema, "sources");

async function readApprovedPreparation(
    ctx: QueryCtx | MutationCtx,
    args: {
        corpusRevisionId: Id<"corpusRevisions">;
        sourceId: Id<"sources">;
        runId: Id<"researchRuns">;
    },
) {
    const revision = await ctx.db.get(args.corpusRevisionId);
    const proposal = revision?.sourceSelectionProposalId
        ? await ctx.db.get(revision.sourceSelectionProposalId)
        : null;
    if (!proposal?.sourcePreparationId) {
        const run = await ctx.db.get(args.runId);
        return run?.sourcePreparationId ? null : undefined;
    }
    if (
        revision?.status !== "approved" ||
        proposal.runId !== args.runId ||
        proposal.corpusRevisionId !== args.corpusRevisionId
    )
        return null;
    const item = await ctx.db
        .query("sourceSelectionProposalItems")
        .withIndex("by_proposal_and_source", (q) =>
            q.eq("proposalId", proposal._id).eq("sourceId", args.sourceId),
        )
        .unique();
    const capture = item?.sourceCaptureId
        ? await ctx.db.get(item.sourceCaptureId)
        : null;
    if (
        capture?.status !== "committed" ||
        capture.runId !== args.runId ||
        capture.sourceId !== args.sourceId
    )
        return null;
    const requiredSpans: Array<{
        startOffset: number;
        endOffset: number;
        quotation?: string;
    }> = [];
    const items = await ctx.db
        .query("sourceSelectionProposalItems")
        .withIndex("by_proposal_and_source", (q) =>
            q.eq("proposalId", proposal._id),
        )
        .take(61);
    if (items.length > 60) throw new Error("Approved source limit exceeded");
    for (const target of items) {
        if (
            !target.comparisonTaskIds?.length ||
            (await readPreparationSourceDecision(ctx.db, target)) !== "accepted"
        )
            continue;
        const review = await readPinnedComparisonReview(
            ctx.db,
            target,
            await readPinnedSourceQualification(ctx.db, target),
        );
        for (const reference of review.requiredPrimaryReferences) {
            if (reference.sourceId !== args.sourceId) continue;
            if (
                reference.captureId !== capture._id ||
                reference.contentHash !== capture.contentHash ||
                !Number.isSafeInteger(reference.startOffset) ||
                !Number.isSafeInteger(reference.endOffset) ||
                reference.startOffset < 0 ||
                reference.endOffset - reference.startOffset !==
                    reference.quotation.length
            )
                throw new Error(
                    "Approved comparison reference identity mismatch",
                );
            requiredSpans.push({
                startOffset: reference.startOffset,
                endOffset: reference.endOffset,
                quotation: reference.quotation,
            });
        }
    }
    const task = item?.qualificationTaskId
        ? await ctx.db.get(item.qualificationTaskId)
        : null;
    const output = task?.output;
    if (output?.kind !== "source_qualification")
        return {
            capture,
            ...(requiredSpans.length
                ? {
                      requiredSpans,
                      preparationVersion:
                          SOURCE_RETRIEVAL_VERSION as typeof SOURCE_RETRIEVAL_VERSION,
                  }
                : {}),
        };
    if (
        task?.runId !== args.runId ||
        task.sourceId !== args.sourceId ||
        output.sourceCaptureId !== capture._id ||
        output.contentHash !== capture.contentHash
    )
        throw new Error("Approved qualification identity mismatch");
    const q = output.qualification;
    const keys = new Set(
        [
            ...q.companyPassages,
            ...q.reportingPeriodPassages,
            ...q.findings.flatMap((f) => [...f.passages, ...f.periodPassages]),
            ...q.limitations.flatMap((l) => l.passages),
        ].map((p) => p.passageKey),
    );
    const references = output.selectedPassages.filter((p) =>
        keys.has(p.passageKey),
    );
    if (keys.size !== references.length)
        throw new Error("Approved qualification references are unavailable");
    requiredSpans.push(
        ...references.map(({ startOffset, endOffset }) => ({
            startOffset,
            endOffset,
        })),
    );
    return {
        capture,
        requiredSpans,
        preparationVersion: output.retrieval?.version,
    };
}

async function assertMaterializedReferences(
    ctx: QueryCtx | MutationCtx,
    sourceVersionId: Id<"sourceVersions">,
    references: Array<{
        startOffset: number;
        endOffset: number;
        quotation?: string;
    }>,
) {
    const persisted = await ctx.db
        .query("sourcePassages")
        .withIndex("by_source_version_and_order", (q) =>
            q.eq("sourceVersionId", sourceVersionId),
        )
        .take(MAX_PASSAGES_PER_SOURCE + 1);
    if (
        persisted.length > MAX_PASSAGES_PER_SOURCE ||
        references.some(
            (ref) =>
                !persisted.some(
                    (p) =>
                        p.locator.startOffset !== undefined &&
                        p.locator.endOffset !== undefined &&
                        p.locator.startOffset <= ref.startOffset &&
                        p.locator.endOffset >= ref.endOffset &&
                        (!ref.quotation ||
                            p.exactQuotation.slice(
                                ref.startOffset - p.locator.startOffset,
                                ref.endOffset - p.locator.startOffset,
                            ) === ref.quotation),
                ),
        )
    )
        throw new Error("existing_materialization_incomplete");
}

async function requireMatchingSourceVersion(
    db: QueryCtx["db"],
    sourceVersionId: Id<"sourceVersions">,
    identity: Pick<
        Doc<"sourceVersions">,
        "runId" | "corpusRevisionId" | "sourceId" | "acceptedDecisionId"
    >,
) {
    const version = await db.get(sourceVersionId);
    if (
        !version ||
        version.runId !== identity.runId ||
        version.corpusRevisionId !== identity.corpusRevisionId ||
        version.sourceId !== identity.sourceId ||
        version.acceptedDecisionId !== identity.acceptedDecisionId
    ) {
        throw new Error("Source version identity mismatch");
    }
    return version;
}

export const assertExecutionFence = assertEvidenceExecutionFence;

export const assertExecutionFenceQuery = internalQuery({
    args: {
        runId: v.id("researchRuns"),
        corpusRevisionId: v.id("corpusRevisions"),
        sourceId: v.id("sources"),
        acceptedDecisionId: v.id("sourceDecisions"),
        executionGeneration: v.number(),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        await assertExecutionFence(ctx.db, args);
        return null;
    },
});

export const getFrozenSourceForExecution = internalQuery({
    args: {
        runId: v.id("researchRuns"),
        corpusRevisionId: v.id("corpusRevisions"),
        sourceId: v.id("sources"),
        acceptedDecisionId: v.id("sourceDecisions"),
        executionGeneration: v.number(),
    },
    returns: v.union(
        v.null(),
        v.object({
            statusDoc: statusDocValidator,
            source: sourceDocValidator,
            companyCik: v.optional(v.string()),
            preparationVersion: v.optional(v.literal(SOURCE_RETRIEVAL_VERSION)),
            preparedPassageReferences: v.optional(
                v.array(
                    v.object({
                        startOffset: v.number(),
                        endOffset: v.number(),
                        quotation: v.optional(v.string()),
                    }),
                ),
            ),
            preparedCapture: v.optional(
                v.union(schema.doc("sourceCaptures"), v.null()),
            ),
        }),
    ),
    handler: async (ctx, args) => {
        let fenced: Awaited<ReturnType<typeof assertExecutionFence>>;
        try {
            fenced = await assertExecutionFence(ctx.db, args);
        } catch {
            return null;
        }
        const { run, statusDoc, source } = fenced;
        if (
            statusDoc.status === "succeeded" ||
            statusDoc.status === "partial"
        ) {
            if (!statusDoc.sourceVersionId) {
                throw new Error(
                    "Terminal evidence source has no committed version",
                );
            }
            await requireMatchingSourceVersion(
                ctx.db,
                statusDoc.sourceVersionId,
                args,
            );
        }

        let companyCik: string | undefined;
        if (run.companyId) {
            const company = await ctx.db.get(run.companyId);
            companyCik = company?.cik;
        }

        const approved = await readApprovedPreparation(ctx, args);
        if (statusDoc.sourceVersionId && approved?.requiredSpans?.length)
            await assertMaterializedReferences(
                ctx,
                statusDoc.sourceVersionId,
                approved.requiredSpans,
            );
        return {
            statusDoc,
            source,
            companyCik,
            preparedCapture: approved ? approved.capture : approved,
            preparationVersion: approved?.preparationVersion,
            ...(approved?.requiredSpans
                ? { preparedPassageReferences: approved.requiredSpans }
                : {}),
        };
    },
});

export const listFrozenSourcesForRun = internalQuery({
    args: {
        runId: v.id("researchRuns"),
        executionGeneration: v.number(),
    },
    returns: v.array(
        v.object({
            sourceId: v.id("sources"),
            corpusRevisionId: v.id("corpusRevisions"),
            acceptedDecisionId: v.id("sourceDecisions"),
            origin: v.union(
                v.literal("sec"),
                v.literal("exa"),
                v.literal("analyst_url"),
            ),
            status: v.union(
                v.literal("queued"),
                v.literal("running"),
                v.literal("succeeded"),
                v.literal("partial"),
                v.literal("failed"),
            ),
            sourceVersionId: v.optional(v.id("sourceVersions")),
        }),
    ),
    handler: async (ctx, args) => {
        const run = await ctx.db.get(args.runId);
        const candidateLimit = sourceDossierCandidateLimit(
            run?.sourcePreparationId,
        );
        const statuses = await ctx.db
            .query("evidenceSourceStatuses")
            .withIndex("by_run_and_execution_generation", (q) =>
                q
                    .eq("runId", args.runId)
                    .eq("executionGeneration", args.executionGeneration),
            )
            .take(candidateLimit + 1);

        if (statuses.length > candidateLimit) {
            throw new Error(
                `Frozen evidence sources exceed configured candidate limit: ${statuses.length} > ${candidateLimit}`,
            );
        }

        const results = [];
        for (const st of statuses) {
            const source = await ctx.db.get(st.sourceId);
            if (!source || source.runId !== args.runId) {
                throw new Error(
                    "Frozen source is missing or belongs to another run",
                );
            }
            results.push({
                sourceId: st.sourceId,
                corpusRevisionId: st.corpusRevisionId,
                acceptedDecisionId: st.acceptedDecisionId,
                origin: source.origin,
                status: st.status,
                sourceVersionId: st.sourceVersionId,
            });
        }
        return results;
    },
});

export const updateEvidenceSourceStatus = internalMutation({
    args: {
        runId: v.id("researchRuns"),
        corpusRevisionId: v.id("corpusRevisions"),
        sourceId: v.id("sources"),
        acceptedDecisionId: v.id("sourceDecisions"),
        executionGeneration: v.number(),
        status: v.union(
            v.literal("queued"),
            v.literal("running"),
            v.literal("succeeded"),
            v.literal("partial"),
            v.literal("failed"),
        ),
        sourceVersionId: v.optional(v.id("sourceVersions")),
        failureReason: v.optional(v.string()),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        const { statusDoc } = await assertExecutionFence(ctx.db, args);
        const patch: Record<string, unknown> = {
            status: args.status,
            updatedAt: Date.now(),
        };
        if (args.sourceVersionId) {
            // Verify the sourceVersion exists and matches run/revision/source/current acceptedDecision
            await requireMatchingSourceVersion(
                ctx.db,
                args.sourceVersionId,
                args,
            );
            patch.sourceVersionId = args.sourceVersionId;
            // Only a fully succeeded finalization clears persisted limitation
            // detail. A partial result keeps the exact acquisition reason: the
            // retry clone must carry the same failureReason forward.
            if (args.status === "succeeded") {
                patch.failureReason = undefined;
            } else if (args.failureReason !== undefined) {
                patch.failureReason = args.failureReason;
            }
        } else if (args.failureReason !== undefined) {
            patch.failureReason = args.failureReason;
        }
        if (
            (statusDoc.status === "succeeded" ||
                statusDoc.status === "partial") &&
            (args.status === "queued" ||
                args.status === "running" ||
                args.status === "failed")
        ) {
            if (!statusDoc.sourceVersionId) {
                throw new Error(
                    "Terminal evidence source has no committed version",
                );
            }
            await requireMatchingSourceVersion(
                ctx.db,
                statusDoc.sourceVersionId,
                args,
            );
            return null;
        }
        await ctx.db.patch(statusDoc._id, patch);
        return null;
    },
});

export const reserveUploadLease = internalMutation({
    args: {
        runId: v.id("researchRuns"),
        corpusRevisionId: v.id("corpusRevisions"),
        sourceId: v.id("sources"),
        acceptedDecisionId: v.id("sourceDecisions"),
        contentHash: v.string(),
        normalizerVersion: v.string(),
        executionGeneration: v.number(),
    },
    returns: v.object({
        leaseId: v.union(v.id("artifactUploadLeases"), v.null()),
        reuseSourceVersionId: v.union(v.id("sourceVersions"), v.null()),
    }),
    handler: async (ctx, args) => {
        await assertExecutionFence(ctx.db, args);

        const existingVersion = await ctx.db
            .query("sourceVersions")
            .withIndex("by_full_identity", (q) =>
                q
                    .eq("corpusRevisionId", args.corpusRevisionId)
                    .eq("sourceId", args.sourceId)
                    .eq("acceptedDecisionId", args.acceptedDecisionId)
                    .eq("contentHash", args.contentHash)
                    .eq("normalizerVersion", args.normalizerVersion),
            )
            .first();

        if (existingVersion) {
            return {
                leaseId: null,
                reuseSourceVersionId: existingVersion._id,
            };
        }

        const now = Date.now();
        const leaseId = await ctx.db.insert("artifactUploadLeases", {
            runId: args.runId,
            corpusRevisionId: args.corpusRevisionId,
            sourceId: args.sourceId,
            acceptedDecisionId: args.acceptedDecisionId,
            contentHash: args.contentHash,
            normalizerVersion: args.normalizerVersion,
            executionGeneration: args.executionGeneration,
            status: "reserved",
            createdAt: now,
            updatedAt: now,
        });

        return {
            leaseId,
            reuseSourceVersionId: null,
        };
    },
});

export const attachStorageToLease = internalMutation({
    args: {
        runId: v.id("researchRuns"),
        corpusRevisionId: v.id("corpusRevisions"),
        sourceId: v.id("sources"),
        acceptedDecisionId: v.id("sourceDecisions"),
        executionGeneration: v.number(),
        leaseId: v.id("artifactUploadLeases"),
        storageId: v.id("_storage"),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        await assertExecutionFence(ctx.db, args);

        const lease = await ctx.db.get(args.leaseId);
        if (
            !lease ||
            lease.runId !== args.runId ||
            lease.corpusRevisionId !== args.corpusRevisionId ||
            lease.sourceId !== args.sourceId ||
            lease.acceptedDecisionId !== args.acceptedDecisionId ||
            lease.executionGeneration !== args.executionGeneration ||
            lease.status !== "reserved"
        ) {
            throw new Error(
                "Artifact upload lease is invalid or not in reserved state",
            );
        }

        await ctx.db.patch(lease._id, {
            storageId: args.storageId,
            status: "uploaded",
            updatedAt: Date.now(),
        });
        return null;
    },
});

export const markLeaseOrphaned = internalMutation({
    args: {
        leaseId: v.id("artifactUploadLeases"),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        const lease = await ctx.db.get(args.leaseId);
        if (lease && lease.status !== "committed") {
            await ctx.db.patch(lease._id, {
                status: "orphaned",
                updatedAt: Date.now(),
            });
        }
        return null;
    },
});

type SourceVersionContent = Pick<
    Doc<"sourceVersions">,
    | "sourceCaptureId"
    | "runId"
    | "corpusRevisionId"
    | "sourceId"
    | "acceptedDecisionId"
    | "contentHash"
    | "normalizerVersion"
    | "storageId"
    | "mediaType"
    | "byteCount"
    | "pageCount"
    | "canonicalUrl"
    | "retrievalVersion"
    | "retrievalMetadata"
    | "executionGeneration"
> & { passages: Array<Infer<typeof sourcePassageInputValidator>> };

async function insertSourceVersionWithPassages(
    ctx: MutationCtx,
    args: SourceVersionContent,
    now: number,
) {
    const sourceVersionId = await ctx.db.insert("sourceVersions", {
        sourceCaptureId: args.sourceCaptureId,
        runId: args.runId,
        corpusRevisionId: args.corpusRevisionId,
        sourceId: args.sourceId,
        acceptedDecisionId: args.acceptedDecisionId,
        contentHash: args.contentHash,
        normalizerVersion: args.normalizerVersion,
        storageId: args.storageId,
        mediaType: args.mediaType,
        byteCount: args.byteCount,
        pageCount: args.pageCount,
        canonicalUrl: args.canonicalUrl,
        retrievalVersion: args.retrievalVersion,
        retrievalMetadata: args.retrievalMetadata,
        executionGeneration: args.executionGeneration,
        createdAt: now,
    });

    for (const passage of args.passages) {
        const passageKey =
            passage.passageKey ??
            computePassageKey({
                sourceId: args.sourceId,
                sourceVersionHash: args.contentHash,
                locatorVersion: passage.locatorVersion,
                locator: passage.locator,
                order: passage.order,
                quotationHash: passage.quotationHash,
            });
        await ctx.db.insert("sourcePassages", {
            sourceVersionId,
            locatorVersion: passage.locatorVersion,
            quotationHash: passage.quotationHash,
            passageKey,
            order: passage.order,
            exactQuotation: passage.exactQuotation,
            locator: passage.locator,
            contextBefore: passage.contextBefore,
            contextAfter: passage.contextAfter,
            headingPath: passage.headingPath,
            createdAt: now,
        });
    }
    return sourceVersionId;
}

export const materializeInspectedSource = internalMutation({
    args: {
        runId: v.id("researchRuns"),
        corpusRevisionId: v.id("corpusRevisions"),
        sourceId: v.id("sources"),
        acceptedDecisionId: v.id("sourceDecisions"),
        executionGeneration: v.number(),
        contentHash: v.string(),
        passages: v.array(sourcePassageInputValidator),
    },
    returns: v.object({
        sourceVersionId: v.id("sourceVersions"),
        reused: v.boolean(),
        status: v.union(v.literal("succeeded"), v.literal("partial")),
    }),
    handler: async (ctx, args) => {
        const { statusDoc } = await assertExecutionFence(ctx.db, args);
        const approved = await readApprovedPreparation(ctx, args);
        const capture = approved?.capture;
        if (
            !capture?.storageId ||
            !capture.normalizerVersion ||
            !capture.retrievalVersion ||
            capture.byteCount === undefined ||
            capture.contentHash !== args.contentHash
        )
            throw new Error("Approved source capture is unavailable");
        if (
            args.passages.length === 0 ||
            args.passages.length > MAX_PASSAGES_PER_SOURCE
        )
            throw new Error("Invalid inspected source passages");
        if (
            approved?.requiredSpans?.some(
                (span) =>
                    !args.passages.some(
                        (p) =>
                            p.locator.startOffset !== undefined &&
                            p.locator.endOffset !== undefined &&
                            p.locator.startOffset <= span.startOffset &&
                            p.locator.endOffset >= span.endOffset,
                    ),
            )
        )
            throw new Error("required_passage_unavailable");
        const existing = await ctx.db
            .query("sourceVersions")
            .withIndex("by_full_identity", (q) =>
                q
                    .eq("corpusRevisionId", args.corpusRevisionId)
                    .eq("sourceId", args.sourceId)
                    .eq("acceptedDecisionId", args.acceptedDecisionId)
                    .eq("contentHash", args.contentHash)
                    .eq("normalizerVersion", capture.normalizerVersion ?? ""),
            )
            .first();
        if (existing && approved?.requiredSpans?.length)
            await assertMaterializedReferences(
                ctx,
                existing._id,
                approved.requiredSpans,
            );
        const now = Date.now();
        const sourceVersionId =
            existing?._id ??
            (await insertSourceVersionWithPassages(
                ctx,
                {
                    ...args,
                    sourceCaptureId: capture._id,
                    normalizerVersion: capture.normalizerVersion,
                    storageId: capture.storageId,
                    mediaType: capture.mediaType ?? "text/plain",
                    byteCount: capture.byteCount,
                    canonicalUrl: capture.resolvedUrl ?? capture.requestedUrl,
                    retrievalVersion: capture.retrievalVersion,
                },
                now,
            ));
        const status =
            capture.readingCompleteness === "complete"
                ? ("succeeded" as const)
                : ("partial" as const);
        await ctx.db.patch(statusDoc._id, {
            status,
            sourceVersionId,
            failureReason: status === "partial" ? "partial_reading" : undefined,
            updatedAt: now,
        });
        return { sourceVersionId, reused: Boolean(existing), status };
    },
});

export const finalizeSourceVersion = internalMutation({
    args: {
        runId: v.id("researchRuns"),
        corpusRevisionId: v.id("corpusRevisions"),
        sourceId: v.id("sources"),
        acceptedDecisionId: v.id("sourceDecisions"),
        executionGeneration: v.number(),
        leaseId: v.id("artifactUploadLeases"),
        storageId: v.id("_storage"),
        contentHash: v.string(),
        normalizerVersion: v.string(),
        mediaType: v.string(),
        byteCount: v.number(),
        pageCount: v.optional(v.number()),
        canonicalUrl: v.string(),
        retrievalVersion: v.string(),
        retrievalMetadata: v.optional(retrievalMetadataValidator),
        finalStatus: v.union(v.literal("succeeded"), v.literal("partial")),
        failureReason: v.optional(v.string()),
        passages: v.array(sourcePassageInputValidator),
    },
    returns: v.object({
        sourceVersionId: v.id("sourceVersions"),
        reused: v.boolean(),
        loserStorageId: v.optional(v.id("_storage")),
    }),
    handler: async (ctx, args) => {
        const { statusDoc } = await assertExecutionFence(ctx.db, args);
        const now = Date.now();
        const applyTerminalStatus = async (
            statusDocId: Id<"evidenceSourceStatuses">,
            sourceVersionId: Id<"sourceVersions">,
        ) => {
            if (args.finalStatus === "partial") {
                await ctx.db.patch(statusDocId, {
                    status: "partial",
                    sourceVersionId,
                    ...(args.failureReason !== undefined
                        ? { failureReason: args.failureReason }
                        : {}),
                    updatedAt: now,
                });
            } else {
                await ctx.db.patch(statusDocId, {
                    status: "succeeded",
                    sourceVersionId,
                    failureReason: undefined,
                    updatedAt: now,
                });
            }
        };

        const lease = await ctx.db.get(args.leaseId);
        if (
            !lease ||
            lease.runId !== args.runId ||
            lease.corpusRevisionId !== args.corpusRevisionId ||
            lease.sourceId !== args.sourceId ||
            lease.acceptedDecisionId !== args.acceptedDecisionId ||
            lease.executionGeneration !== args.executionGeneration ||
            lease.contentHash !== args.contentHash ||
            lease.normalizerVersion !== args.normalizerVersion ||
            lease.status !== "uploaded" ||
            lease.storageId !== args.storageId
        ) {
            throw new Error(
                "Artifact upload lease mismatch or invalid state during finalization",
            );
        }

        // Check if an identical version was committed concurrently
        const existingVersion = await ctx.db
            .query("sourceVersions")
            .withIndex("by_full_identity", (q) =>
                q
                    .eq("corpusRevisionId", args.corpusRevisionId)
                    .eq("sourceId", args.sourceId)
                    .eq("acceptedDecisionId", args.acceptedDecisionId)
                    .eq("contentHash", args.contentHash)
                    .eq("normalizerVersion", args.normalizerVersion),
            )
            .first();

        if (existingVersion) {
            await ctx.db.patch(args.leaseId, {
                status: "orphaned",
                updatedAt: now,
            });
            await applyTerminalStatus(statusDoc._id, existingVersion._id);
            return {
                sourceVersionId: existingVersion._id,
                reused: true,
                loserStorageId: args.storageId,
            };
        }

        const sourceVersionId = await insertSourceVersionWithPassages(
            ctx,
            args,
            now,
        );

        await ctx.db.patch(args.leaseId, {
            status: "committed",
            updatedAt: now,
        });

        await applyTerminalStatus(statusDoc._id, sourceVersionId);

        return {
            sourceVersionId,
            reused: false,
        };
    },
});

export const getCommittedSourceVersionCount = internalQuery({
    args: {
        corpusRevisionId: v.optional(v.id("corpusRevisions")),
        sourceId: v.id("sources"),
        contentHash: v.string(),
        normalizerVersion: v.string(),
    },
    returns: v.number(),
    handler: async (ctx, args) => {
        if (args.corpusRevisionId) {
            const corpusRevisionId = args.corpusRevisionId;
            const versions = await ctx.db
                .query("sourceVersions")
                .withIndex("by_revision_and_source", (q) =>
                    q
                        .eq("corpusRevisionId", corpusRevisionId)
                        .eq("sourceId", args.sourceId),
                )
                .take(10);
            return versions.filter(
                (v) =>
                    v.contentHash === args.contentHash &&
                    v.normalizerVersion === args.normalizerVersion,
            ).length;
        }
        const versions = await ctx.db
            .query("sourceVersions")
            .withIndex("by_source_and_hash", (q) =>
                q
                    .eq("sourceId", args.sourceId)
                    .eq("contentHash", args.contentHash)
                    .eq("normalizerVersion", args.normalizerVersion),
            )
            .take(10);
        return versions.length;
    },
});

export const listSourcePassages = internalQuery({
    args: {
        sourceVersionId: v.id("sourceVersions"),
    },
    returns: v.array(
        v.object({
            _id: v.id("sourcePassages"),
            _creationTime: v.number(),
            sourceVersionId: v.id("sourceVersions"),
            locatorVersion: v.string(),
            passageKey: v.optional(v.string()),
            quotationHash: v.string(),
            order: v.number(),
            exactQuotation: v.string(),
            locator: v.union(webLocatorValidator, pdfLocatorValidator),
            contextBefore: v.optional(v.string()),
            contextAfter: v.optional(v.string()),
            headingPath: v.optional(v.array(v.string())),
            createdAt: v.number(),
        }),
    ),
    handler: async (ctx, args) => {
        return await ctx.db
            .query("sourcePassages")
            .withIndex("by_source_version_and_order", (q) =>
                q.eq("sourceVersionId", args.sourceVersionId),
            )
            .take(MAX_PASSAGES_PER_SOURCE);
    },
});

// Default safety window before cleanup may delete an unattached storage object
// or mark an expired upload lease reconciled. Crashed/abandoned uploads are
// tolerated only inside this window; recent in-flight uploads are always kept.
export const ARTIFACT_CLEANUP_SAFETY_INTERVAL_DEFAULT_MS = 24 * 60 * 60 * 1000;
export const ARTIFACT_CLEANUP_PAGE_SIZE = 100;

function artifactCleanupSafetyIntervalMs(): number {
    const raw =
        typeof process !== "undefined"
            ? process.env?.ARTIFACT_CLEANUP_SAFETY_INTERVAL_MS
            : undefined;
    if (raw === undefined || raw.trim().length === 0) {
        return ARTIFACT_CLEANUP_SAFETY_INTERVAL_DEFAULT_MS;
    }
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < 0) {
        throw new Error(
            "ARTIFACT_CLEANUP_SAFETY_INTERVAL_MS must be a non-negative integer",
        );
    }
    return parsed;
}

async function requireArtifactCleanupAdmin(ctx: MutationCtx) {
    const authUserId = await getAuthUserId(ctx);
    if (!authUserId) {
        throw new Error("Not authenticated");
    }
    const visitor = await ctx.db
        .query("visitors")
        .withIndex("by_auth_user_id", (index) =>
            index.eq("authUserId", authUserId),
        )
        .unique();
    if (visitor?.status !== "active" || visitor.role !== "admin") {
        throw new Error("Unauthorized");
    }
}

function forceStorageDeleteFailure(): boolean {
    if (env.E2E_FIXTURES_ENABLED !== "true") {
        // Test-only seam: forcing delete failures outside a fixture-enabled
        // deployment would silently disable cleanup in production.
        return false;
    }
    const raw =
        typeof process !== "undefined"
            ? process.env?.ARTIFACT_CLEANUP_FORCE_DELETE_FAILURE
            : undefined;
    return raw !== undefined && raw.trim().length > 0 && raw.trim() !== "0";
}

async function hasRetainedArtifactReference(
    ctx: MutationCtx,
    storageId: Id<"_storage">,
    cutoff: number,
): Promise<boolean> {
    const version = await ctx.db
        .query("sourceVersions")
        .withIndex("by_storage_id", (index) => index.eq("storageId", storageId))
        .first();
    if (version) return true;
    for (const status of ["committed", "reserved", "uploaded"] as const) {
        const capture = await ctx.db
            .query("sourceCaptures")
            .withIndex("by_storage_id_and_status_and_updated_at", (index) => {
                const range = index
                    .eq("storageId", storageId)
                    .eq("status", status);
                return status === "committed"
                    ? range
                    : range.gt("updatedAt", cutoff);
            })
            .first();
        if (capture) return true;
    }
    const lease = await ctx.db
        .query("artifactUploadLeases")
        .withIndex("by_storage_id", (index) => index.eq("storageId", storageId))
        .first();
    return (
        !!lease &&
        lease.updatedAt > cutoff &&
        (lease.status === "reserved" || lease.status === "uploaded")
    );
}

async function ensureStorageObjectAbsent(
    ctx: MutationCtx,
    storageId: Id<"_storage">,
): Promise<boolean> {
    if (
        await hasRetainedArtifactReference(
            ctx,
            storageId,
            Date.now() - artifactCleanupSafetyIntervalMs(),
        )
    )
        return false;
    if (forceStorageDeleteFailure()) {
        return false;
    }
    try {
        await ctx.storage.delete(storageId);
        return true;
    } catch {
        try {
            const existing = await ctx.db.system.get(storageId);
            return existing === null;
        } catch {
            return false;
        }
    }
}

/** Transactional reference check protects shared captures from immediate upload cleanup. */
export const deleteUnreferencedArtifact = internalMutation({
    args: { storageId: v.id("_storage") },
    returns: v.boolean(),
    handler: async (ctx, args) =>
        ensureStorageObjectAbsent(ctx, args.storageId),
});

/** Shareable composite cursor: phase progress plus the _storage index cursor. */
type ArtifactCleanupCursor = {
    storage?: string | null;
};

function encodeReconcileCursor(c: ArtifactCleanupCursor): string {
    return JSON.stringify({
        storage: c.storage ?? null,
    });
}
function decodeReconcileCursor(raw?: string): ArtifactCleanupCursor {
    if (!raw) return {};
    try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        return {
            storage:
                typeof parsed.storage === "string"
                    ? (parsed.storage as string)
                    : null,
        };
    } catch {
        return {};
    }
}

async function reconcileArtifactStorageCore(
    ctx: MutationCtx,
    args: { cursor?: string; limit?: number },
): Promise<{
    processedLeaseCount: number;
    reconciledLeaseCount: number;
    scannedObjectCount: number;
    deletedStorageCount: number;
    referencedStorageCount: number;
    deletionFailureCount: number;
    nextCursor: string | null;
    done: boolean;
}> {
    const pageSize = Math.max(
        1,
        Math.min(
            args.limit ?? ARTIFACT_CLEANUP_PAGE_SIZE,
            ARTIFACT_CLEANUP_PAGE_SIZE,
        ),
    );
    const cutoff = Date.now() - artifactCleanupSafetyIntervalMs();
    const now = Date.now();

    let processedLeaseCount = 0;
    let reconciledLeaseCount = 0;
    let scannedObjectCount = 0;
    let deletedStorageCount = 0;
    let referencedStorageCount = 0;
    let deletionFailureCount = 0;

    const cursor = decodeReconcileCursor(args.cursor);

    // ---- Lease reconciliation (oldest-first across stale statuses) ----
    // Convex allows exactly one paginated query per function execution, so the
    // lease scans must not use .paginate().  Each status is read with an
    // oldest-first indexed take(); stale rows (updatedAt <= cutoff) sort before
    // fresh in-flight rows, so reclamation can never be starved by recent leases
    // and repeated sweeps naturally advance as reclaimed rows leave the status.
    // A failed deletion keeps the lease unreconciled (visible via
    // deletionFailureCount) so a later sweep retries it; the sweep never reports
    // done while a deletion failed or while a page still had work to drain.
    const leaseStatuses: Array<"reserved" | "uploaded" | "orphaned"> = [
        "reserved",
        "uploaded",
        "orphaned",
    ];
    let leasePageMayHaveMore = false;
    for (const status of leaseStatuses) {
        const leaseRows = await ctx.db
            .query("artifactUploadLeases")
            .withIndex("by_status_and_updated_at", (index) =>
                index.eq("status", status),
            )
            .take(pageSize);
        const captureRows = await ctx.db
            .query("sourceCaptures")
            .withIndex("by_status_and_updated_at", (index) =>
                index.eq("status", status),
            )
            .take(pageSize);
        if (leaseRows.length >= pageSize || captureRows.length >= pageSize) {
            // A full page: this status may still hold reclaimable rows and a
            // later sweep must keep going, rather than claiming the sweep is
            // done while unreconciled work remains.
            leasePageMayHaveMore = true;
        }
        for (const lease of [...leaseRows, ...captureRows]) {
            processedLeaseCount += 1;
            if (lease.updatedAt > cutoff) {
                continue;
            }
            let objectConfirmedAbsent = !lease.storageId;
            if (lease.storageId) {
                const referenced = await hasRetainedArtifactReference(
                    ctx,
                    lease.storageId,
                    cutoff,
                );
                if (referenced) {
                    referencedStorageCount += 1;
                } else {
                    objectConfirmedAbsent = await ensureStorageObjectAbsent(
                        ctx,
                        lease.storageId as Id<"_storage">,
                    );
                    if (objectConfirmedAbsent) {
                        deletedStorageCount += 1;
                    }
                }
            }
            if (!objectConfirmedAbsent) {
                deletionFailureCount += 1;
                continue;
            }
            await ctx.db.patch(lease._id, {
                status: "reconciled" as const,
                reconciledAt: now,
                updatedAt: now,
            });
            reconciledLeaseCount += 1;
        }
    }

    // ---- _storage orphan phase (single paginated query) ----
    // Committed SourceVersion rows own referenced artifact identity. Only an
    // active (reserved/uploaded) lease still inside its safety window protects
    // its object; reconciled and expired orphaned leases do not protect forever.
    const storageResult = await ctx.db.system
        .query("_storage")
        .withIndex("by_creation_time", (index) =>
            index.lt("_creationTime", cutoff),
        )
        .paginate({ cursor: cursor.storage ?? null, numItems: pageSize });

    for (const storageRow of storageResult.page) {
        scannedObjectCount += 1;
        if (await hasRetainedArtifactReference(ctx, storageRow._id, cutoff)) {
            referencedStorageCount += 1;
            continue;
        }
        const absent = await ensureStorageObjectAbsent(ctx, storageRow._id);
        if (!absent) {
            deletionFailureCount += 1;
            continue;
        }
        deletedStorageCount += 1;
    }
    const storageDone = storageResult.isDone;
    const storageCursor = storageDone ? null : storageResult.continueCursor;

    const leaseDone = !leasePageMayHaveMore && deletionFailureCount === 0;
    const done = leaseDone && storageDone;
    const nextCursorCode =
        storageCursor === null
            ? null
            : encodeReconcileCursor({ storage: storageCursor });

    return {
        processedLeaseCount,
        reconciledLeaseCount,
        scannedObjectCount,
        deletedStorageCount,
        referencedStorageCount,
        deletionFailureCount,
        nextCursor: nextCursorCode === undefined ? null : nextCursorCode,
        done,
    };
}

const reconcileCleanupArgs = {
    cursor: v.optional(v.string()),
    limit: v.optional(v.number()),
};
const reconcileCleanupReturns = v.object({
    processedLeaseCount: v.number(),
    reconciledLeaseCount: v.number(),
    scannedObjectCount: v.number(),
    deletedStorageCount: v.number(),
    referencedStorageCount: v.number(),
    deletionFailureCount: v.number(),
    nextCursor: v.union(v.null(), v.string()),
    done: v.boolean(),
});

/**
 * Public admin-authorized artifact cleanup boundary.
 *
 * Authenticates an active admin visitor, then runs the shared paginated
 * reconciliation implementation. Internal callers and the scheduler loop do
 * not need to carry end-user identity.
 */
export const adminReconcileArtifactStorage = mutation({
    args: reconcileCleanupArgs,
    returns: reconcileCleanupReturns,
    handler: async (ctx, args) => {
        await requireArtifactCleanupAdmin(ctx);
        return reconcileArtifactStorageCore(ctx, args);
    },
});

/**
 * Internal scheduler-only artifact cleanup (no end-user identity check).
 * Shares the single reconciliation implementation with the admin boundary.
 */
export const reconcileArtifactStorage = internalMutation({
    args: reconcileCleanupArgs,
    returns: reconcileCleanupReturns,
    handler: async (ctx, args) => {
        return reconcileArtifactStorageCore(ctx, args);
    },
});
