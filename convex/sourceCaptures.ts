import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { mergeRunCompanyMetadata } from "./domain/companyMetadata";
import { sha256Hex } from "./domain/sourcePassages";
import {
    assertPreparationExecutionFence,
    sourcePreparationError,
} from "./domain/sourcePreparationAuthority";
import { companySnapshotValidator } from "./domain/validators";
import {
    EXA_NORMALIZER_VERSION,
    QUALIFICATION_NORMALIZER_VERSION,
    SEC_NORMALIZER_VERSION,
} from "./integrations/evidenceNormalization";
import {
    MAX_HISTORICAL_SOURCE_CANDIDATES,
    MAX_NORMALIZED_ARTIFACT_BYTES,
} from "./resourceLimits";
import schema from "./schema";

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
        const previous = previousCaptures.find(
            (capture) =>
                ![
                    "missing_configuration",
                    "paid_work_disabled",
                    "source_url_unavailable",
                    "source_url_not_public",
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
            return { capture: previous, source, company, shouldExecute: false };
        }
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
            runId: run._id,
            corpusRevisionId: revision._id,
            sourceId: source._id,
            preparationId: preparation._id,
            executionGeneration: run.executionGeneration,
            captureKey,
            requestInputHash,
            status: "reserved",
            requestedUrl: source.canonicalUrl,
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
