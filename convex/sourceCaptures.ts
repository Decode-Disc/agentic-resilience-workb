import {
    activeDocumentaryCaptureOwner,
    documentaryMaterialContext,
    requireFramingAcquisitionRequest,
    requireSourcesAcquisitionRequest,
} from "@convex/domain/documentaryAccess";
import {
    requireDocumentaryMaterialRequest,
    retainedDocumentRoot,
} from "@convex/domain/savedMaterial";
import { captureRepresentationCompleteness } from "@convex/domain/savedMaterialOperations";
import { readSourceCandidateCapacity } from "@convex/domain/sourceCandidateCapacity";
import {
    readCaptureIndexState,
    sourceDocumentMetadataValidator,
} from "@convex/domain/sourceRetrievalPolicy";
import { observedDestinationValidator } from "@convex/domain/sourcesContracts";
import { framingObservationRefusal } from "@convex/domain/workbenchContracts";
import { executionError } from "@convex/execution/errors";
import { recordContextObservation } from "@convex/execution/journal";
import { operationObservationFragment } from "@convex/execution/retainedText";
import { readSourcesReplay } from "@convex/qualificationSourceReplay";
import { requirePublicContextRequest } from "@convex/workbenchPublicContext";
import { getDocumentSize, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
    internalMutation,
    internalQuery,
    type QueryCtx,
} from "./_generated/server";
import { mergeRunCompanyMetadata } from "./domain/companyMetadata";
import { sha256Hex } from "./domain/sourcePassages";
import {
    assertPreparationExecutionFence,
    nextPreparationAttempt,
    sourcePreparationError,
} from "./domain/sourcePreparationAuthority";
import { SOURCE_QUALIFICATION_INPUT_POLICY } from "./domain/sourceQualification";
import { companySnapshotValidator } from "./domain/validators";
import {
    EXA_NORMALIZER_VERSION,
    QUALIFICATION_NORMALIZER_VERSION,
    SEC_NORMALIZER_VERSION,
} from "./integrations/evidenceNormalization";
import { resolveDirectFilingUrl } from "./integrations/secEvidence";
import {
    MAX_CAPTURE_OBSERVED_METADATA_BYTES,
    MAX_HISTORICAL_SOURCE_CANDIDATES,
    MAX_NORMALIZED_ARTIFACT_BYTES,
} from "./resourcePolicy";
import schema from "./schema";

const scheduledCaptureRequest = {
    requestId: v.id("agentOperationRequests"),
    expectedGeneration: v.number(),
};

const captureWriteOwner = {
    preparationId: v.optional(v.id("sourceSelectionProposalRebuilds")),
    operationRequestId: v.optional(v.id("agentOperationRequests")),
    attemptRevision: v.optional(v.number()),
};

function matchesCaptureWriter(
    capture: Doc<"sourceCaptures"> | null,
    owner: {
        preparationId?: Id<"sourceSelectionProposalRebuilds">;
        operationRequestId?: Id<"agentOperationRequests">;
        attemptRevision?: number;
    },
): capture is Doc<"sourceCaptures"> {
    return (
        !!capture &&
        capture.retainedImport?.attemptRevision === owner.attemptRevision &&
        (owner.operationRequestId !== undefined
            ? owner.preparationId === undefined &&
              capture.operationRequestId === owner.operationRequestId
            : owner.preparationId !== undefined &&
              capture.operationRequestId === undefined &&
              capture.preparationId === owner.preparationId)
    );
}

async function requireCaptureWriter(
    ctx: QueryCtx,
    capture: Doc<"sourceCaptures"> | null,
    owner: Parameters<typeof matchesCaptureWriter>[1],
) {
    if (!matchesCaptureWriter(capture, owner))
        throw sourcePreparationError("capture_missing");
    if (owner.operationRequestId) {
        if (capture.retainedImport) {
            const selected = await requireRetainedImport(ctx, {
                requestId: owner.operationRequestId,
                expectedGeneration: capture.executionGeneration,
            });
            if (
                selected.runId !== capture.runId ||
                selected.retained.rootOperationId !==
                    capture.retainedImport.rootOperationId ||
                selected.retained.captureKey !== capture.captureKey ||
                selected.retained.contentHash !== capture.contentHash ||
                selected.retained.canonicalUrl !== capture.requestedUrl
            )
                throw executionError("capture_identity_changed");
            return capture;
        }
        const request = await ctx.db.get(owner.operationRequestId);
        const target = capture.preparationId
            ? await requireSourcesAcquisitionRequest(
                  ctx,
                  request,
                  capture.executionGeneration,
              )
            : await requireFramingAcquisitionRequest(
                  ctx,
                  owner.operationRequestId,
                  capture.executionGeneration,
              );
        if (
            target.run._id !== capture.runId ||
            ("preparation" in target
                ? target.preparation._id !== capture.preparationId ||
                  target.revision._id !== capture.corpusRevisionId ||
                  target.source?._id !== capture.sourceId ||
                  !target.data.work.some(
                      ({ requestId, sourceId }) =>
                          requestId === owner.operationRequestId &&
                          sourceId === capture.sourceId,
                  )
                : target.corpusRevisionId !== capture.corpusRevisionId) ||
            target.pin.target.canonicalUrl !== capture.requestedUrl ||
            target.pin.target.requestInputHash !== capture.requestInputHash
        )
            throw executionError("capture_identity_changed");
    } else if (owner.preparationId) {
        await assertPreparationExecutionFence(ctx.db, {
            preparationId: owner.preparationId,
            sourceId: capture.sourceId,
            now: Date.now(),
        });
    }
    return capture;
}

const RETAINED_TEXT_IMPORT_VERSION = "retained-public-text-v1";

async function verifiedImportStorage(
    ctx: QueryCtx,
    storageId: Id<"_storage"> | undefined,
    contentHash: string | undefined,
    sizeBytes: number | undefined,
) {
    if (!storageId || !contentHash || sizeBytes === undefined) return undefined;
    const storage = await ctx.db.system.get("_storage", storageId);
    if (storage?.size !== sizeBytes) return undefined;
    const hash = Array.from(atob(storage.sha256), (byte) =>
        byte.charCodeAt(0).toString(16).padStart(2, "0"),
    ).join("");
    return hash === contentHash ? storageId : undefined;
}

async function requireRetainedImport(
    ctx: QueryCtx,
    args: {
        requestId: Id<"agentOperationRequests">;
        expectedGeneration: number;
    },
) {
    const request = await ctx.db.get(args.requestId);
    if (request?.input.kind === "read_public_context") {
        const authority = await requirePublicContextRequest(
            ctx,
            args.requestId,
            args.expectedGeneration,
        );
        const previous = authority.retainedRead;
        if (!previous?.document || !previous.range)
            throw executionError("source_continuation_invalid");
        const frame = await documentaryMaterialContext(ctx, authority.mission);
        const root = await ctx.db.get(previous.document.readId);
        const refusal = framingObservationRefusal(root, {
            ...request,
            messageId: request.input.messageId,
        });
        if (refusal) throw executionError(refusal);
        const retained = await retainedDocumentRoot(
            ctx,
            frame,
            root,
            "continuation",
        );
        if (
            !retained ||
            retained.contentHash !== previous.document.contentHash ||
            retained.characters !== previous.document.characters
        )
            throw executionError("retained_text_invalid");
        return {
            retained,
            runId: frame.run._id,
            corpusRevisionId: frame.corpusRevisionId,
            continuationOffset: previous.range.end,
        };
    }
    const selected = await requireDocumentaryMaterialRequest(ctx, args);
    if (!("retained" in selected))
        throw executionError("source_reference_not_observed");
    return {
        retained: selected.retained,
        runId: selected.runId,
        corpusRevisionId: selected.corpusRevisionId,
        preparationId:
            selected.pin.scope.kind === "sources"
                ? selected.pin.scope.preparationId
                : undefined,
    };
}

export const retainedContinuationCapture = internalQuery({
    args: { ...scheduledCaptureRequest, captureId: v.id("sourceCaptures") },
    returns: v.object({
        capture: schema
            .doc("sourceCaptures")
            .extend({ contentHash: v.string() }),
        rootId: v.id("agentOperationRequests"),
        start: v.number(),
        characters: v.number(),
    }),
    async handler(ctx, args) {
        const selected = await requireRetainedImport(ctx, args);
        const { retained, continuationOffset } = selected;
        const capture = await ctx.db.get(args.captureId);
        if (
            continuationOffset === undefined ||
            capture?.runId !== selected.runId ||
            capture.retainedImport?.rootOperationId !==
                retained.rootOperationId ||
            capture.captureKey !== retained.captureKey ||
            capture.contentHash !== retained.contentHash ||
            capture.status !== "committed"
        )
            throw executionError("capture_identity_changed");
        return {
            capture: { ...capture, contentHash: retained.contentHash },
            rootId: retained.rootOperationId,
            start: continuationOffset,
            characters: retained.characters,
        };
    },
});

export const reserveRetainedImport = internalMutation({
    args: scheduledCaptureRequest,
    returns: v.union(
        v.object({ status: v.literal("unavailable"), reason: v.string() }),
        v.object({
            status: v.literal("ready"),
            capture: schema.doc("sourceCaptures"),
        }),
        v.object({
            status: v.literal("claimed"),
            capture: schema.doc("sourceCaptures"),
            characters: v.number(),
            sizeBytes: v.number(),
            fragments: v.number(),
        }),
    ),
    async handler(ctx, args) {
        const selected = await requireRetainedImport(ctx, args);
        const root = selected.retained;
        const existing = await ctx.db
            .query("sourceCaptures")
            .withIndex("by_capture_key", (q) =>
                q.eq("captureKey", root.captureKey),
            )
            .unique();
        if (
            existing &&
            (existing.runId !== selected.runId ||
                existing.retainedImport?.rootOperationId !==
                    root.rootOperationId ||
                existing.requestedUrl !== root.canonicalUrl ||
                existing.contentHash !== root.contentHash)
        )
            throw executionError("capture_identity_changed");
        if (existing?.status === "committed")
            return { status: "ready" as const, capture: existing };
        if (existing && (await activeDocumentaryCaptureOwner(ctx, existing)))
            return {
                status: "unavailable" as const,
                reason: "documentary_import_in_progress",
            };
        if (
            !existing?.sourceId &&
            !root.sourceId &&
            (
                await readSourceCandidateCapacity(
                    ctx.db,
                    selected.runId,
                    "before_sources",
                )
            ).remaining === 0
        )
            throw executionError("source_candidate_limit");
        const sourceId =
            existing?.sourceId ??
            root.sourceId ??
            (await ctx.db.insert("sources", {
                runId: selected.runId,
                canonicalUrl: root.canonicalUrl,
                title: root.document.title,
                origin: root.origin,
                category: "public_context",
                createdAt: Date.now(),
            }));
        const storageId = await verifiedImportStorage(
            ctx,
            existing?.storageId,
            root.contentHash,
            root.sizeBytes,
        );
        const values = {
            protocol: "documentary_v1" as const,
            operationRequestId: args.requestId,
            retainedImport: {
                rootOperationId: root.rootOperationId,
                attemptRevision:
                    (existing?.retainedImport?.attemptRevision ?? 0) + 1,
            },
            runId: selected.runId,
            corpusRevisionId: selected.corpusRevisionId,
            preparationId: selected.preparationId,
            sourceId,
            executionGeneration: args.expectedGeneration,
            captureKey: root.captureKey,
            requestInputHash: root.contentHash,
            status: storageId ? ("uploaded" as const) : ("reserved" as const),
            storageId,
            requestedUrl: root.canonicalUrl,
            contentHash: root.contentHash,
            byteCount: root.sizeBytes,
            normalizerVersion: RETAINED_TEXT_IMPORT_VERSION,
            representationCompleteness: root.representationCompleteness,
            document: existing?.document ?? root.document,
            retrievedAt: root.retrievedAt,
            updatedAt: Date.now(),
        };
        let captureId = existing?._id;
        if (captureId)
            await ctx.db.patch(captureId, {
                ...values,
                reconciledAt: undefined,
                failureCode: undefined,
            });
        else
            captureId = await ctx.db.insert("sourceCaptures", {
                ...values,
                createdAt: Date.now(),
            });
        const capture = await ctx.db.get(captureId);
        if (!capture) throw executionError("capture_missing");
        return {
            status: "claimed" as const,
            capture,
            characters: root.characters,
            sizeBytes: root.sizeBytes,
            fragments: root.fragments,
        };
    },
});

export const readRetainedImportPart = internalQuery({
    args: {
        ...captureWriteOwner,
        captureId: v.id("sourceCaptures"),
        index: v.number(),
    },
    returns: v.string(),
    async handler(ctx, args) {
        const capture = await requireCaptureWriter(
            ctx,
            await ctx.db.get(args.captureId),
            args,
        );
        if (
            !capture.retainedImport ||
            capture.status === "committed" ||
            !capture.contentHash
        )
            throw executionError("capture_identity_changed");
        return operationObservationFragment(
            ctx,
            capture.retainedImport.rootOperationId,
            args.index,
            capture.contentHash,
        );
    },
});

/** Bind a source and reserve its capture in one transaction under the admitted URL pin. */
export const reserveFramingUpload = internalMutation({
    args: scheduledCaptureRequest,
    returns: v.object({
        capture: schema.doc("sourceCaptures"),
        source: schema.doc("sources"),
        shouldExecute: v.boolean(),
    }),
    async handler(ctx, args) {
        const target = await requireFramingAcquisitionRequest(
            ctx,
            args.requestId,
            args.expectedGeneration,
        );
        const { canonicalUrl, requestInputHash } = target.pin.target;
        const revision = await ctx.db.get(target.corpusRevisionId);
        if (revision?.runId !== target.run._id || revision.status !== "draft")
            throw executionError("framing_version_conflict");
        const now = Date.now();
        const existingSource = await ctx.db
            .query("sources")
            .withIndex("by_run_and_url", (q) =>
                q.eq("runId", target.run._id).eq("canonicalUrl", canonicalUrl),
            )
            .first();
        if (
            !existingSource &&
            (
                await readSourceCandidateCapacity(
                    ctx.db,
                    target.run._id,
                    "before_sources",
                )
            ).remaining === 0
        )
            throw executionError("source_candidate_limit");
        const sourceId =
            existingSource?._id ??
            (await ctx.db.insert("sources", {
                runId: target.run._id,
                canonicalUrl,
                origin: target.origin,
                title: target.title,
                category: "public_context",
                publishedAt: target.reference.publishedAt,
                secAccessionNumber: target.reference.confirmedSec?.accession,
                createdAt: now,
            }));
        const source = existingSource ?? (await ctx.db.get(sourceId));
        if (!source) throw executionError("capture_identity_changed");
        const captureKey = `${args.requestId}:${requestInputHash}`;
        const owned = await ctx.db
            .query("sourceCaptures")
            .withIndex("by_capture_key", (q) => q.eq("captureKey", captureKey))
            .unique();
        if (owned) return { source, capture: owned, shouldExecute: false };

        for (const status of ["committed", "reserved", "uploaded"] as const) {
            const existing = await ctx.db
                .query("sourceCaptures")
                .withIndex("by_source_and_input_hash_and_status", (q) =>
                    q
                        .eq("sourceId", sourceId)
                        .eq("requestInputHash", requestInputHash)
                        .eq("status", status),
                )
                .first();
            if (existing)
                return { source, capture: existing, shouldExecute: false };
        }
        const captureId = await ctx.db.insert("sourceCaptures", {
            protocol: "documentary_v1",
            operationRequestId: args.requestId,
            runId: target.run._id,
            corpusRevisionId: target.corpusRevisionId,
            sourceId,
            executionGeneration: args.expectedGeneration,
            captureKey,
            requestInputHash,
            requestedUrl: canonicalUrl,
            normalizerVersion: target.normalizerVersion,
            status: "reserved",
            createdAt: now,
            updatedAt: now,
        });
        const capture = await ctx.db.get(captureId);
        if (!capture) throw executionError("capture_missing");
        return { source, capture, shouldExecute: true };
    },
});

function assertSecDocumentUrl(
    resolvedUrl: string,
    source: Doc<"sources">,
    cik: string,
) {
    let url: URL;
    try {
        url = new URL(resolvedUrl);
    } catch {
        throw sourcePreparationError("capture_identity_changed");
    }
    const prefix = `/Archives/edgar/data/${cik.replace(/^0+/, "")}/${source.secAccessionNumber?.replaceAll("-", "")}/`;
    if (
        source.origin !== "sec" ||
        resolvedUrl.length > 2048 ||
        url.origin !== "https://www.sec.gov" ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
    )
        throw sourcePreparationError("capture_identity_changed");
    if (
        resolvedUrl === source.canonicalUrl &&
        resolveDirectFilingUrl(resolvedUrl)
    )
        return;
    if (
        !source.secAccessionNumber ||
        !url.pathname.startsWith(prefix) ||
        !/^[\w.-]+$/.test(url.pathname.slice(prefix.length))
    )
        throw sourcePreparationError("capture_identity_changed");
}

export const reserveUpload = internalMutation({
    args: {
        preparationId: v.id("sourceSelectionProposalRebuilds"),
        sourceId: v.id("sources"),
        operationRequestId: v.optional(v.id("agentOperationRequests")),
    },
    returns: v.object({
        capture: schema.doc("sourceCaptures"),
        source: schema.doc("sources"),
        company: companySnapshotValidator,
        shouldExecute: v.boolean(),
    }),
    handler: async (ctx, args) => {
        const { run, revision, preparation } =
            await assertPreparationExecutionFence(ctx.db, {
                ...args,
                now: Date.now(),
            });
        const source = await ctx.db.get(args.sourceId);
        const company = mergeRunCompanyMetadata(
            run.companySnapshot,
            run.companyId ? await ctx.db.get(run.companyId) : null,
        );
        if (!source || !company)
            throw sourcePreparationError("company_unavailable");
        const acquisition = args.operationRequestId
            ? await requireSourcesAcquisitionRequest(
                  ctx,
                  await ctx.db.get(args.operationRequestId),
                  run.executionGeneration,
              )
            : undefined;
        if (
            acquisition &&
            (acquisition.preparation._id !== preparation._id ||
                acquisition.source?._id !== source._id ||
                !acquisition.data.work.some(
                    ({ requestId, sourceId }) =>
                        requestId === args.operationRequestId &&
                        sourceId === source._id,
                ))
        )
            throw executionError("capture_identity_changed");
        const normalizerVersion =
            acquisition?.normalizerVersion ??
            `${source.origin === "sec" ? SEC_NORMALIZER_VERSION : EXA_NORMALIZER_VERSION}+${QUALIFICATION_NORMALIZER_VERSION}`;
        const requestInputHash =
            acquisition?.pin.target.requestInputHash ??
            sha256Hex(
                JSON.stringify({
                    sourceId: source._id,
                    canonicalUrl: source.canonicalUrl,
                    origin: source.origin,
                    cik: company.cik,
                    accession: source.secAccessionNumber ?? "",
                    primaryDocument: source.secPrimaryDocument ?? "",
                    retrievalProtocol: "source-capture-v1",
                    normalizerVersion,
                }),
            );
        const cached = await ctx.db
            .query("sourceCaptures")
            .withIndex("by_source_and_input_hash_and_status", (q) =>
                q
                    .eq("sourceId", source._id)
                    .eq("requestInputHash", requestInputHash)
                    .eq("status", "committed"),
            )
            .first();
        if (cached)
            return { capture: cached, source, company, shouldExecute: false };
        const captureKey = `${preparation._id}:${source._id}:${requestInputHash}`;
        const existing = await ctx.db
            .query("sourceCaptures")
            .withIndex("by_capture_key", (q) => q.eq("captureKey", captureKey))
            .unique();
        if (existing)
            return { capture: existing, source, company, shouldExecute: false };
        const previousCaptures = await ctx.db
            .query("sourceCaptures")
            .withIndex("by_source_and_input_hash_and_status", (q) =>
                q
                    .eq("sourceId", source._id)
                    .eq("requestInputHash", requestInputHash),
            )
            .take(MAX_HISTORICAL_SOURCE_CANDIDATES + 1);
        if (previousCaptures.length > MAX_HISTORICAL_SOURCE_CANDIDATES)
            throw sourcePreparationError("capture_history_limit_reached");
        let resolvedUrl =
            source.origin === "sec"
                ? previousCaptures.find((capture) => capture.resolvedUrl)
                      ?.resolvedUrl
                : undefined;
        const previous = previousCaptures.find(
            (capture) =>
                ![
                    "missing_configuration",
                    "paid_work_disabled",
                    "source_url_unavailable",
                ].includes(capture.failureCode ?? ""),
        );
        if (previous) {
            if (["reserved", "uploaded"].includes(previous.status)) {
                if (previous.operationRequestId) {
                    const previousRequest = await ctx.db.get(
                        previous.operationRequestId,
                    );
                    if (
                        previousRequest &&
                        ["running", "waiting", "observed"].includes(
                            previousRequest.status,
                        )
                    )
                        return {
                            capture: previous,
                            source,
                            company,
                            shouldExecute: false,
                        };
                }
                const outcome = {
                    status: previous.storageId
                        ? ("orphaned" as const)
                        : ("unavailable" as const),
                    failureCode: "attempt_outcome_unknown",
                    updatedAt: Date.now(),
                };
                await ctx.db.patch(previous._id, outcome);
                return {
                    capture: { ...previous, ...outcome },
                    source,
                    company,
                    shouldExecute: false,
                };
            }
            let calls = await ctx.db
                .query("providerCalls")
                .withIndex("by_run_source_operation", (q) =>
                    q
                        .eq("runId", run._id)
                        .eq("sourceId", source._id)
                        .eq(
                            "operation",
                            source.origin === "sec"
                                ? "retrieve_filing_html"
                                : "get_contents",
                        ),
                )
                .take(4);
            if (!calls.length && source.origin === "sec")
                calls = await ctx.db
                    .query("providerCalls")
                    .withIndex("by_run_source_operation", (q) =>
                        q
                            .eq("runId", run._id)
                            .eq("sourceId", source._id)
                            .eq("operation", "revalidate_company"),
                    )
                    .take(4);
            const plan = nextPreparationAttempt(
                calls.filter(
                    (c) => !c.inputHash || c.inputHash === requestInputHash,
                ),
                preparation,
                Date.now(),
            );
            if (!plan.attempt || !calls.length)
                return {
                    capture: previous,
                    source,
                    company,
                    shouldExecute: false,
                };
            if (source.origin === "sec" && !resolvedUrl) {
                const marker = ":retrieve_filing_html:";
                const urls = new Set(
                    calls
                        .filter(
                            (call) =>
                                call.operation === "retrieve_filing_html" &&
                                (!call.inputHash ||
                                    call.inputHash === requestInputHash) &&
                                call.operationKey.includes(marker),
                        )
                        .map((call) =>
                            call.operationKey.slice(
                                call.operationKey.lastIndexOf(marker) +
                                    marker.length,
                            ),
                        ),
                );
                if (urls.size > 1)
                    throw sourcePreparationError("capture_identity_changed");
                resolvedUrl = [...urls][0];
            }
        }
        if (resolvedUrl) assertSecDocumentUrl(resolvedUrl, source, company.cik);
        const captures = await ctx.db
            .query("sourceCaptures")
            .withIndex("by_preparation_and_source", (q) =>
                q.eq("preparationId", preparation._id),
            )
            .take(MAX_HISTORICAL_SOURCE_CANDIDATES + 1);
        if (captures.length >= MAX_HISTORICAL_SOURCE_CANDIDATES)
            throw sourcePreparationError("capture_limit_reached");
        const now = Date.now();
        const id = await ctx.db.insert("sourceCaptures", {
            ...(acquisition && args.operationRequestId
                ? {
                      protocol: "documentary_v1" as const,
                      operationRequestId: args.operationRequestId,
                  }
                : preparation.executionPlanVersion &&
                    preparation.retrievalVersion
                  ? {
                        qualificationInputPolicy:
                            SOURCE_QUALIFICATION_INPUT_POLICY,
                    }
                  : {}),
            runId: run._id,
            corpusRevisionId: revision._id,
            sourceId: source._id,
            preparationId: preparation._id,
            executionGeneration: run.executionGeneration,
            captureKey,
            requestInputHash,
            status: "reserved",
            requestedUrl: source.canonicalUrl,
            resolvedUrl,
            normalizerVersion,
            createdAt: now,
            updatedAt: now,
        });
        const capture = await ctx.db.get(id);
        if (!capture) throw sourcePreparationError("capture_missing");
        return { capture, source, company, shouldExecute: true };
    },
});

export const assertActive = internalQuery({
    args: {
        preparationId: v.id("sourceSelectionProposalRebuilds"),
        sourceId: v.id("sources"),
        now: v.number(),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        await assertPreparationExecutionFence(ctx.db, args);
        return null;
    },
});

/** Retains the resolved SEC prerequisite independently of the document download outcome. */
export const retainSecDocumentUrl = internalMutation({
    args: {
        ...captureWriteOwner,
        captureId: v.id("sourceCaptures"),
        resolvedUrl: v.string(),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        const capture = await requireCaptureWriter(
            ctx,
            await ctx.db.get(args.captureId),
            args,
        );
        if (!capture.preparationId || capture.status !== "reserved")
            throw sourcePreparationError("capture_identity_changed");
        const { run } = await assertPreparationExecutionFence(ctx.db, {
            preparationId: capture.preparationId,
            sourceId: capture.sourceId,
            now: Date.now(),
        });
        const source = await ctx.db.get(capture.sourceId);
        const company = mergeRunCompanyMetadata(
            run.companySnapshot,
            run.companyId ? await ctx.db.get(run.companyId) : null,
        );
        if (
            !source ||
            !company ||
            (capture.resolvedUrl && capture.resolvedUrl !== args.resolvedUrl)
        )
            throw sourcePreparationError("capture_identity_changed");
        assertSecDocumentUrl(args.resolvedUrl, source, company.cik);
        await ctx.db.patch(capture._id, {
            resolvedUrl: args.resolvedUrl,
            updatedAt: Date.now(),
        });
        return null;
    },
});

export const acquiredDocumentaryCapture = internalQuery({
    args: { ...scheduledCaptureRequest, captureId: v.id("sourceCaptures") },
    returns: v.object({
        capture: schema.doc("sourceCaptures"),
        indexed: v.boolean(),
    }),
    async handler(ctx, args) {
        const request = await ctx.db.get(args.requestId);
        const target =
            request?.pin?.kind === "documentary_v1" &&
            request.pin.scope.kind === "sources"
                ? await requireSourcesAcquisitionRequest(
                      ctx,
                      request,
                      args.expectedGeneration,
                  )
                : await requireFramingAcquisitionRequest(
                      ctx,
                      args.requestId,
                      args.expectedGeneration,
                  );
        const capture = await ctx.db.get(args.captureId);
        if (
            capture?.status !== "committed" ||
            capture.runId !== target.run._id ||
            capture.requestedUrl !== target.pin.target.canonicalUrl ||
            capture.requestInputHash !== target.pin.target.requestInputHash
        )
            throw executionError("capture_identity_conflict");
        const state = await readCaptureIndexState(
            ctx.db,
            {
                runId: capture.runId,
                corpusRevisionId: capture.corpusRevisionId,
            },
            capture._id,
        );
        return { capture, indexed: state?.contentHash === capture.contentHash };
    },
});

export const attachStorage = internalMutation({
    args: {
        ...captureWriteOwner,
        captureId: v.id("sourceCaptures"),
        storageId: v.id("_storage"),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        const capture = await requireCaptureWriter(
            ctx,
            await ctx.db.get(args.captureId),
            args,
        );
        if (capture.status !== "reserved") {
            if (capture.storageId === args.storageId) return null;
            throw sourcePreparationError("capture_already_attached");
        }
        await ctx.db.patch(capture._id, {
            status: "uploaded",
            storageId: args.storageId,
            updatedAt: Date.now(),
        });
        return null;
    },
});

export const finalize = internalMutation({
    args: {
        observedDestinations: v.optional(v.array(observedDestinationValidator)),
        representationCompleteness: v.optional(
            captureRepresentationCompleteness,
        ),
        document: v.optional(sourceDocumentMetadataValidator),
        ...captureWriteOwner,
        captureId: v.id("sourceCaptures"),
        contentHash: v.string(),
        byteCount: v.number(),
        resolvedUrl: v.string(),
        retrievalVersion: v.optional(v.string()),
        normalizerVersion: v.string(),
        retrievedAt: v.optional(v.number()),
        readingCompleteness: v.optional(
            v.union(v.literal("complete"), v.literal("partial")),
        ),
        omittedPassageCount: v.optional(v.number()),
    },
    returns: v.id("sourceCaptures"),
    handler: async (ctx, args) => {
        const capture = await requireCaptureWriter(
            ctx,
            await ctx.db.get(args.captureId),
            args,
        );
        if (capture.status === "committed") {
            if (capture.contentHash !== args.contentHash)
                throw sourcePreparationError("capture_identity_changed");
            return capture._id;
        }
        if (args.retrievalVersion?.startsWith("sources-replay:")) {
            const replay = await readSourcesReplay(ctx, capture.runId);
            if (
                !replay ||
                args.retrievalVersion !==
                    `sources-replay:${replay.materialHash}` ||
                !replay.documents.some((doc) => doc.url === args.resolvedUrl)
            )
                throw sourcePreparationError("sources_replay_not_authorized");
        }
        if (capture.retainedImport) {
            if (
                args.contentHash !== capture.contentHash ||
                args.byteCount !== capture.byteCount ||
                args.resolvedUrl !== capture.requestedUrl ||
                args.retrievalVersion !== undefined ||
                args.retrievedAt !== capture.retrievedAt ||
                !(await verifiedImportStorage(
                    ctx,
                    capture.storageId,
                    args.contentHash,
                    args.byteCount,
                ))
            )
                throw sourcePreparationError("capture_invalid");
        } else if (!args.retrievalVersion || args.retrievedAt === undefined) {
            throw sourcePreparationError("capture_invalid");
        }
        if (
            capture.status !== "uploaded" ||
            !capture.storageId ||
            capture.normalizerVersion !== args.normalizerVersion ||
            !/^[a-f0-9]{64}$/.test(args.contentHash) ||
            !Number.isInteger(args.byteCount) ||
            args.byteCount < 1 ||
            args.byteCount > MAX_NORMALIZED_ARTIFACT_BYTES ||
            (args.operationRequestId
                ? !args.document ||
                  !args.representationCompleteness ||
                  args.readingCompleteness !== undefined ||
                  args.omittedPassageCount !== undefined
                : args.document !== undefined ||
                  args.representationCompleteness === "unknown" ||
                  !args.readingCompleteness ||
                  args.omittedPassageCount === undefined ||
                  !Number.isInteger(args.omittedPassageCount) ||
                  args.omittedPassageCount < 0)
        )
            throw sourcePreparationError("capture_invalid");
        if (
            (args.observedDestinations?.length ?? 0) > 64 ||
            getDocumentSize({
                observedDestinations: args.observedDestinations ?? [],
            }) > MAX_CAPTURE_OBSERVED_METADATA_BYTES
        )
            throw sourcePreparationError("capture_invalid");
        const {
            preparationId: _preparationId,
            operationRequestId: _operationRequestId,
            attemptRevision: _attemptRevision,
            captureId: _captureId,
            ...metadata
        } = args;
        await ctx.db.patch(capture._id, {
            ...metadata,
            status: "committed",
            mediaType: "text/plain",
            updatedAt: Date.now(),
        });
        await recordContextObservation(ctx, capture.runId, {
            key: `capture:${capture._id}:${args.contentHash}`,
            topic: "documentary",
            actor: { type: "system" },
            value: {
                event: "capture_available",
                captureId: capture._id,
                sourceId: capture.sourceId,
                ...(args.preparationId
                    ? { preparationId: args.preparationId }
                    : {}),
                contentHash: args.contentHash,
                resolvedUrl: args.resolvedUrl,
                ...(args.readingCompleteness
                    ? { readingCompleteness: args.readingCompleteness }
                    : {}),
                ...(args.omittedPassageCount === undefined
                    ? {}
                    : { omittedPassageCount: args.omittedPassageCount }),
                ...(args.operationRequestId
                    ? {
                          operationRequestId: args.operationRequestId,
                          representationCompleteness:
                              args.representationCompleteness,
                      }
                    : {}),
            },
        });
        return capture._id;
    },
});

/** Late failure can mark its own upload for cleanup, but cannot advance research state. */
export const markUnavailable = internalMutation({
    args: {
        ...captureWriteOwner,
        captureId: v.id("sourceCaptures"),
        failureCode: v.string(),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        const capture = await ctx.db.get(args.captureId);
        if (!matchesCaptureWriter(capture, args))
            throw sourcePreparationError("capture_missing");
        if (capture.status === "committed") return null;
        await ctx.db.patch(capture._id, {
            status: capture.storageId ? "orphaned" : "unavailable",
            failureCode: args.failureCode.slice(0, 100),
            updatedAt: Date.now(),
        });
        return null;
    },
});
