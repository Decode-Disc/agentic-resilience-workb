import { observedDestinationValidator } from "@convex/domain/sourcesContracts";
import { recordContextObservation } from "@convex/execution/journal";
import { readSourcesReplay } from "@convex/qualificationSourceReplay";
import { getDocumentSize, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";
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
        const normalizerVersion = `${source.origin === "sec" ? SEC_NORMALIZER_VERSION : EXA_NORMALIZER_VERSION}+${QUALIFICATION_NORMALIZER_VERSION}`;
        const requestInputHash = sha256Hex(
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
            ...(preparation.executionPlanVersion && preparation.retrievalVersion
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
        preparationId: v.id("sourceSelectionProposalRebuilds"),
        captureId: v.id("sourceCaptures"),
        resolvedUrl: v.string(),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        const capture = await ctx.db.get(args.captureId);
        if (
            !capture ||
            capture.preparationId !== args.preparationId ||
            capture.status !== "reserved"
        )
            throw sourcePreparationError("capture_identity_changed");
        const { run } = await assertPreparationExecutionFence(ctx.db, {
            preparationId: args.preparationId,
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

export const attachStorage = internalMutation({
    args: {
        preparationId: v.id("sourceSelectionProposalRebuilds"),
        captureId: v.id("sourceCaptures"),
        storageId: v.id("_storage"),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        const capture = await ctx.db.get(args.captureId);
        if (!capture || capture.preparationId !== args.preparationId)
            throw sourcePreparationError("capture_missing");
        await assertPreparationExecutionFence(ctx.db, {
            preparationId: args.preparationId,
            sourceId: capture.sourceId,
            now: Date.now(),
        });
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
            v.union(v.literal("complete"), v.literal("partial")),
        ),
        preparationId: v.id("sourceSelectionProposalRebuilds"),
        captureId: v.id("sourceCaptures"),
        contentHash: v.string(),
        byteCount: v.number(),
        resolvedUrl: v.string(),
        retrievalVersion: v.string(),
        normalizerVersion: v.string(),
        retrievedAt: v.number(),
        readingCompleteness: v.union(
            v.literal("complete"),
            v.literal("partial"),
        ),
        omittedPassageCount: v.number(),
    },
    returns: v.id("sourceCaptures"),
    handler: async (ctx, args) => {
        const capture = await ctx.db.get(args.captureId);
        if (!capture || capture.preparationId !== args.preparationId)
            throw sourcePreparationError("capture_missing");
        await assertPreparationExecutionFence(ctx.db, {
            preparationId: args.preparationId,
            sourceId: capture.sourceId,
            now: Date.now(),
        });
        if (capture.status === "committed") {
            if (capture.contentHash !== args.contentHash)
                throw sourcePreparationError("capture_identity_changed");
            return capture._id;
        }
        if (args.retrievalVersion.startsWith("sources-replay:")) {
            const replay = await readSourcesReplay(ctx, capture.runId);
            if (
                !replay ||
                args.retrievalVersion !==
                    `sources-replay:${replay.materialHash}` ||
                !replay.documents.some((doc) => doc.url === args.resolvedUrl)
            )
                throw sourcePreparationError("sources_replay_not_authorized");
        }
        if (
            capture.status !== "uploaded" ||
            !capture.storageId ||
            capture.normalizerVersion !== args.normalizerVersion ||
            !/^[a-f0-9]{64}$/.test(args.contentHash) ||
            !Number.isInteger(args.byteCount) ||
            args.byteCount < 1 ||
            args.byteCount > MAX_NORMALIZED_ARTIFACT_BYTES ||
            !Number.isInteger(args.omittedPassageCount) ||
            args.omittedPassageCount < 0
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
                preparationId: args.preparationId,
                contentHash: args.contentHash,
                resolvedUrl: args.resolvedUrl,
                readingCompleteness: args.readingCompleteness,
                omittedPassageCount: args.omittedPassageCount,
            },
        });
        return capture._id;
    },
});

/** Late failure can mark its own upload for cleanup, but cannot advance research state. */
export const markUnavailable = internalMutation({
    args: {
        preparationId: v.id("sourceSelectionProposalRebuilds"),
        captureId: v.id("sourceCaptures"),
        failureCode: v.string(),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        const capture = await ctx.db.get(args.captureId);
        if (!capture || capture.preparationId !== args.preparationId)
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
