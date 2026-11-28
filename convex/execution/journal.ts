import { retainablePayload } from "./journalPayloads";
import { admittedInputHash, contextObservationSequence } from "./journalReads";

export { retainExecutionEventPayload } from "./journalPayloads";
export {
    admittedInputHash,
    contextObservationSequence,
    hasKnownNonDispatch,
    hasReceivedResponse,
    invocationResponseManifest,
    isContextObservation,
    latestNativeControl,
    matchInvocationResponse,
    receivedResponseDigest,
    retainedNativeCalls,
} from "./journalReads";

import { internal } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import {
    internalAction,
    internalMutation,
    internalQuery,
    type MutationCtx,
    type QueryCtx,
} from "@convex/_generated/server";
import {
    completeCharacterBoundary,
    sha256Hex,
    stableStringify,
} from "@convex/domain/hashing";
import type { PreparedAnalystWording } from "@convex/domain/preparedAnalystWording";
import type { preparedResponseReviewDraft } from "@convex/domain/workbenchResponseControlContracts";
import {
    CONVEX_MAX_DOCUMENT_BYTES,
    DOSSIER_PURGE_BATCH,
    HISTORY_PAGE_SIZE,
    MAX_CONVERSATION_SCAN_BYTES,
    MAX_OPERATION_RESULT_BYTES,
    RETAINED_TEXT_INLINE_BYTES,
} from "@convex/resourcePolicy";
import {
    paginationOptsValidator,
    paginationResultValidator,
} from "convex/server";
import { getDocumentSize, type Infer, v } from "convex/values";
import { recordInvocationEvent, requireMissionAuthority } from "./authority";
import { executionError } from "./errors";
import type { preparedCompletionValidator } from "./executionProtocol";
import {
    isCommonConsultation,
    type retainedPayloadValidator,
} from "./operationContracts";

import {
    completeRetainedText,
    deleteRetainedTextBatch,
    retainedTextFragment,
    retainedTextParts,
    retainedTextRange,
    stageRetainedText,
    verifyRetainedText,
} from "./retainedText";

type RetainedPayload = Infer<typeof retainedPayloadValidator>;

const OPERATION_OBSERVATIONS = new Set([
    "operation_requested",
    "operation_refused",
    "operation_reused",
    "operation_effect_applied",
    "operation_observed",
    "operation_completed",
]);

/** Each immutable snapshot captures the input/result known at its own observation boundary. */
export function operationEventObservation(
    request: Doc<"agentOperationRequests">,
    kind: string,
    admissionOutcome?: Doc<"agentExecutionEvents">["admissionOutcome"],
): unknown | undefined {
    if (!OPERATION_OBSERVATIONS.has(kind)) return undefined;
    return kind === "operation_effect_applied"
        ? { input: request.input, effect: request.effect }
        : {
              input: request.input,
              pin: request.pin,
              outcome: admissionOutcome ?? request.outcome,
          };
}

function observablePayload(payload: RetainedPayload) {
    if (payload.state === "incomplete") return payload;
    if (
        payload.json === undefined ||
        payload.contentHash !== sha256Hex(payload.json) ||
        payload.sizeBytes !== new TextEncoder().encode(payload.json).length
    )
        throw executionError("journal_payload_invalid");
    const value: unknown = JSON.parse(payload.json);
    return { state: "complete", value };
}

/** Current operation status is compact; detailed input/result remains in its immutable observation. */
export function operationContextObservation(
    request: Doc<"agentOperationRequests">,
) {
    const outcome = request.outcome;
    return {
        requestId: request._id,
        input: { kind: request.input.kind },
        status: request.status,
        outcome: outcome
            ? {
                  kind: outcome.kind,
                  ...("captureId" in outcome && outcome.captureId
                      ? { captureId: outcome.captureId }
                      : {}),
                  ...("code" in outcome ? { code: outcome.code } : {}),
                  ...("validation" in outcome && outcome.validation
                      ? { validation: outcome.validation }
                      : {}),
              }
            : null,
        adopted:
            request.adoptedAt !== undefined && !request.adoptionRefusalCode,
        ...(request.adoptionRefusalCode
            ? {
                  adoption: {
                      kind: "refused",
                      code: request.adoptionRefusalCode,
                  },
              }
            : {}),
    };
}

/** References resolve to retained events, never a reconstructed historical request. */
export async function operationHistoryReference(
    ctx: Pick<QueryCtx, "db">,
    requestId: Id<"agentOperationRequests">,
) {
    for (const kind of [
        "operation_completed",
        "operation_observed",
        "operation_refused",
        "operation_requested",
    ]) {
        const event = await ctx.db
            .query("agentExecutionEvents")
            .withIndex("by_request_and_kind", (q) =>
                q.eq("requestId", requestId).eq("kind", kind),
            )
            .order("desc")
            .first();
        if (event) return event._id;
    }
    return null;
}

/** Locate an immutable observation without consulting mutable invocation output. */
export async function invocationHistoryReference(
    ctx: Pick<QueryCtx, "db">,
    invocationId: Id<"agentInvocations">,
) {
    for (const kind of [
        "invocation_refused",
        "invocation_returned",
        "invocation_reply_recorded",
    ]) {
        const event = await ctx.db
            .query("agentExecutionEvents")
            .withIndex("by_invocation_and_kind", (q) =>
                q.eq("invocationId", invocationId).eq("kind", kind),
            )
            .order("desc")
            .first();
        if (event) return event._id;
    }
    return null;
}

function historyEventMetadata(event: Doc<"agentExecutionEvents">) {
    const metadata = { ...event };
    delete metadata.payload;
    delete metadata.historySourceSequence;
    delete metadata.protectedDiagnostic;
    delete metadata.contextHistoryHash;
    return metadata;
}

function contextHistoryEnvelope(event: Doc<"agentExecutionEvents">) {
    return {
        prefix: `{"event":${stableStringify(historyEventMetadata(event))},"observation":{"state":"complete","value":`,
        suffix: '},"version":1}',
    };
}

async function contextHistoryText(
    ctx: QueryCtx,
    event: Doc<"agentExecutionEvents">,
) {
    if (!event.contextObservation || event.nativeInputSequence === undefined)
        throw executionError("journal_payload_invalid");
    const text = await completeRetainedText(
        ctx,
        event.contextObservation.textId,
    );
    if (
        text.key !==
        contextObservationTextKey(event.runId, event.nativeInputSequence)
    )
        throw executionError("journal_payload_invalid");
    return text;
}

const contextHistoryBackfillScope = {
    runId: v.id("researchRuns"),
    eventId: v.id("agentExecutionEvents"),
};

/** Enumerates old context observations without touching their retained bodies. */
export const pendingContextHistoryBackfills = internalQuery({
    args: { paginationOpts: paginationOptsValidator },
    returns: paginationResultValidator(v.object(contextHistoryBackfillScope)),
    handler: async (ctx, { paginationOpts }) => {
        const page = await ctx.db
            .query("agentExecutionEvents")
            .withIndex("by_kind_and_context_history_hash", (q) =>
                q
                    .eq("kind", "context_observed")
                    .eq("contextHistoryHash", undefined),
            )
            .paginate({
                ...paginationOpts,
                numItems: Math.min(paginationOpts.numItems, HISTORY_PAGE_SIZE),
                maximumRowsRead: HISTORY_PAGE_SIZE,
                maximumBytesRead: MAX_CONVERSATION_SCAN_BYTES,
            });
        return {
            ...page,
            page: page.page.map((event) => ({
                runId: event.runId,
                eventId: event._id,
            })),
        };
    },
});

async function contextHistoryBackfillSource(
    ctx: QueryCtx,
    args: { runId: Id<"researchRuns">; eventId: Id<"agentExecutionEvents"> },
) {
    const run = await ctx.db.get(args.runId);
    const event = await ctx.db.get(args.eventId);
    if (!run || run.withdrawnAt !== undefined || event?.runId !== run._id)
        throw executionError("journal_payload_unavailable");
    const text = await contextHistoryText(ctx, event);
    const envelope = contextHistoryEnvelope(event);
    const identity = sha256Hex(
        stableStringify({
            ...envelope,
            textId: text._id,
            contentHash: text.contentHash,
        }),
    );
    return { event, text, envelope, identity };
}

export const contextHistoryBackfillFragment = internalQuery({
    args: {
        ...contextHistoryBackfillScope,
        index: v.number(),
        identity: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const { text, envelope, identity } = await contextHistoryBackfillSource(
            ctx,
            args,
        );
        if (args.identity !== undefined && identity !== args.identity)
            throw executionError("journal_payload_conflict");
        return {
            ...envelope,
            identity,
            content: await retainedTextFragment(ctx, text, args.index),
            contentHash: text.contentHash,
            characters: text.characters,
            sizeBytes: text.sizeBytes,
            fragmentCount: text.fragmentHashes.length,
        };
    },
});

export const recordContextHistoryBackfill = internalMutation({
    args: {
        ...contextHistoryBackfillScope,
        identity: v.string(),
        historyHash: v.string(),
    },
    returns: v.string(),
    handler: async (ctx, args) => {
        const { event, identity } = await contextHistoryBackfillSource(
            ctx,
            args,
        );
        if (
            identity !== args.identity ||
            (event.contextHistoryHash &&
                event.contextHistoryHash !== args.historyHash)
        )
            throw executionError("journal_payload_conflict");
        if (!event.contextHistoryHash)
            await ctx.db.patch(event._id, {
                contextHistoryHash: args.historyHash,
            });
        return args.historyHash;
    },
});

/** Verifies historical observation bytes before making their original history envelope range-readable. */
export const backfillContextHistoryHash = internalAction({
    args: contextHistoryBackfillScope,
    returns: v.string(),
    handler: async (ctx, args): Promise<string> => {
        const read = internal.execution.journal.contextHistoryBackfillFragment;
        const first = await ctx.runQuery(read, { ...args, index: 0 });
        const scope = { ...args, identity: first.identity };
        const fragments = [first.content];
        for (let index = 1; index < first.fragmentCount; index++)
            fragments.push(
                (await ctx.runQuery(read, { ...scope, index })).content,
            );
        const json = verifyRetainedText(first, fragments.join(""));
        if (stableStringify(JSON.parse(json)) !== json)
            throw executionError("journal_payload_invalid");
        return ctx.runMutation(
            internal.execution.journal.recordContextHistoryBackfill,
            {
                ...scope,
                historyHash: sha256Hex(first.prefix + json + first.suffix),
            },
        );
    },
});

/** Advances the unresolved index by one verified observation. */
export const backfillNextContextHistoryHash = internalAction({
    args: {},
    returns: v.union(
        v.object({ ...contextHistoryBackfillScope, historyHash: v.string() }),
        v.null(),
    ),
    handler: async (
        ctx,
    ): Promise<{
        runId: Id<"researchRuns">;
        eventId: Id<"agentExecutionEvents">;
        historyHash: string;
    } | null> => {
        const pending = await ctx.runQuery(
            internal.execution.journal.pendingContextHistoryBackfills,
            { paginationOpts: { cursor: null, numItems: 1 } },
        );
        const scope = pending.page[0];
        if (!scope) {
            if (!pending.isDone)
                throw executionError("journal_payload_unavailable");
            return null;
        }
        const historyHash = await ctx.runAction(
            internal.execution.journal.backfillContextHistoryHash,
            scope,
        );
        return { ...scope, historyHash };
    },
});

async function historyEventParts(
    ctx: QueryCtx,
    event: Doc<"agentExecutionEvents">,
) {
    const metadata = historyEventMetadata(event);
    const part =
        event.kind === "invocation_request_recorded"
            ? "request"
            : event.kind === "invocation_reply_recorded"
              ? "reply"
              : undefined;
    const invocationId = event.invocationId;
    const invocationPayload = event.invocationPayloadId
        ? await ctx.db.get(event.invocationPayloadId)
        : part && invocationId
          ? await ctx.db
                .query("agentInvocationPayloads")
                .withIndex("by_invocation_and_part", (q) =>
                    q.eq("invocationId", invocationId).eq("part", part),
                )
                .unique()
          : null;
    if ((part || event.invocationPayloadId) && !invocationPayload)
        throw executionError("journal_payload_unavailable");
    if (
        invocationPayload &&
        (invocationPayload.runId !== event.runId ||
            invocationPayload.invocationId !== event.invocationId)
    )
        throw executionError("journal_payload_invalid");
    if (event.contextObservation)
        throw executionError("journal_payload_backfill_required");
    const observation = event.payload
        ? observablePayload(event.payload)
        : event.kind === "invocation_refused"
          ? {
                state: "incomplete",
                code: "invocation_observation_unavailable",
            }
          : event.requestId && OPERATION_OBSERVATIONS.has(event.kind)
            ? {
                  state: "incomplete",
                  code: "operation_observation_unavailable",
              }
            : undefined;
    return { metadata, part, invocationPayload, observation };
}

/** Returns a single fitting event; larger events must use its paged reader. */
export async function projectMissionHistoryEvent(
    ctx: QueryCtx,
    event: Doc<"agentExecutionEvents">,
): Promise<{ json: string; contentHash: string }> {
    const page = await readMissionHistoryEventFragment(ctx, event, 0);
    if (page.end !== page.totalCharacters)
        throw executionError("journal_payload_requires_pagination");
    return { json: page.content, contentHash: page.contentHash };
}

function projectMissionHistoryEventFromParts(
    event: Doc<"agentExecutionEvents">,
    parts: Awaited<ReturnType<typeof historyEventParts>>,
): { json: string; contentHash: string } {
    const { metadata, part, invocationPayload, observation } = parts;
    const json = stableStringify({
        version: 1,
        event: metadata,
        ...(observation ? { observation } : {}),
        ...(part || event.invocationPayloadId
            ? {
                  invocation: invocationPayload
                      ? observablePayload(invocationPayload)
                      : {
                            state: "incomplete",
                            code: "invocation_observation_unavailable",
                        },
              }
            : {}),
    });
    return { json, contentHash: sha256Hex(json) };
}

function isHighSurrogate(code: number) {
    return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number) {
    return code >= 0xdc00 && code <= 0xdfff;
}

/** The caller's private history receipt owns continuation offsets; only intersecting immutable chunks are loaded. */
export async function readMissionHistoryEventFragment(
    ctx: QueryCtx,
    event: Doc<"agentExecutionEvents">,
    offset: number,
    limit = MAX_OPERATION_RESULT_BYTES,
) {
    if (event.contextObservation && event.contextHistoryHash) {
        const text = await contextHistoryText(ctx, event);
        return readHistoryRange(ctx, text, {
            ...contextHistoryEnvelope(event),
            contentHash: event.contextHistoryHash,
            offset,
            limit,
        });
    }
    const eventParts = await historyEventParts(ctx, event);
    const { metadata, invocationPayload, observation } = eventParts;
    if (!invocationPayload?.textId) {
        const source = projectMissionHistoryEventFromParts(event, eventParts);
        return {
            ...historyTextFragment(source.json, offset, limit),
            contentHash: source.contentHash,
        };
    }
    const text = await completeRetainedText(ctx, invocationPayload.textId);
    if (
        text.contentHash !== invocationPayload.contentHash ||
        text.sizeBytes !== invocationPayload.sizeBytes
    )
        throw executionError("journal_payload_invalid");
    const envelope = {
        version: 2,
        event: metadata,
        ...(observation ? { observation } : {}),
    };
    const prefix = `${stableStringify(envelope).slice(0, -1)},"invocation":{"state":"complete","value":`;
    return readHistoryRange(ctx, text, {
        prefix,
        suffix: "}}",
        contentHash: sha256Hex(
            stableStringify({ ...envelope, contentHash: text.contentHash }),
        ),
        offset,
        limit,
    });
}

async function readHistoryRange(
    ctx: QueryCtx,
    text: Awaited<ReturnType<typeof completeRetainedText>>,
    range: {
        prefix: string;
        suffix: string;
        contentHash: string;
        offset: number;
        limit: number;
    },
) {
    const { prefix, suffix, offset, limit, contentHash } = range;
    const totalCharacters = prefix.length + text.characters + suffix.length;
    if (
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        offset >= totalCharacters ||
        !Number.isSafeInteger(limit) ||
        limit < 1
    )
        throw executionError("history_receipt_invalid");
    const readStart = offset > 0 ? offset - 1 : 0;
    let end = Math.min(totalCharacters, offset + limit);
    const parts = [prefix.slice(readStart, end)];
    if (end > prefix.length && readStart < prefix.length + text.characters) {
        const rangeStart = Math.max(0, readStart - prefix.length);
        const rangeEnd = Math.min(end - prefix.length, text.characters);
        parts.push(
            await retainedTextRange(
                ctx,
                text,
                rangeStart,
                rangeEnd - rangeStart,
            ),
        );
    }
    if (end > prefix.length + text.characters)
        parts.push(
            suffix.slice(
                Math.max(0, readStart - prefix.length - text.characters),
                end - prefix.length - text.characters,
            ),
        );
    const raw = parts.join("");
    if (
        offset > 0 &&
        raw.length >= 2 &&
        isHighSurrogate(raw.charCodeAt(0)) &&
        isLowSurrogate(raw.charCodeAt(1))
    )
        throw executionError("history_receipt_invalid");
    let content = offset > 0 ? raw.slice(1) : raw;
    if (
        end < totalCharacters &&
        content.length > 0 &&
        isHighSurrogate(content.charCodeAt(content.length - 1))
    ) {
        content = content.slice(0, -1);
        end--;
    }
    return {
        offset,
        totalCharacters,
        content,
        end,
        contentHash,
    };
}

/** Positions are authenticated by issued receipts; offsets must remain valid non-splitting UTF-16 boundaries. */
export function historyTextFragment(
    text: string,
    offset: number,
    limit: number,
) {
    if (
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        offset >= text.length ||
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        (offset > 0 &&
            isHighSurrogate(text.charCodeAt(offset - 1)) &&
            isLowSurrogate(text.charCodeAt(offset)))
    )
        throw executionError("history_receipt_invalid");
    const end = completeCharacterBoundary(
        text,
        Math.min(text.length, offset + limit),
    );
    return {
        offset,
        totalCharacters: text.length,
        content: text.slice(offset, end),
        end,
    };
}

/** The immutable admitted snapshot may span documents; historical inline invocations retain their exact input. */
export function admittedInputJson(invocation: Doc<"agentInvocations">) {
    if (!invocation.inputTextId) {
        if (
            invocation.inputContentHash &&
            sha256Hex(invocation.inputJson) !== invocation.inputContentHash
        )
            throw executionError("invocation_input_invalid");
        return invocation.inputJson;
    }
    throw executionError("invocation_input_requires_fragment");
}

export async function admittedInputManifest(
    ctx: QueryCtx,
    invocation: Doc<"agentInvocations">,
) {
    if (!invocation.inputTextId)
        throw executionError("invocation_input_invalid");
    const text = await completeRetainedText(ctx, invocation.inputTextId);
    if (
        text.key !== `${invocation._id}:input` ||
        text.contentHash !== invocation.inputContentHash
    )
        throw executionError("invocation_input_invalid");
    return text;
}

export async function admittedInputFragment(
    ctx: QueryCtx,
    invocation: Doc<"agentInvocations">,
    index: number,
    expectedHash: string,
) {
    if (admittedInputHash(invocation) !== expectedHash)
        throw executionError("invocation_input_invalid");
    if (invocation.inputTextId) {
        const text = await admittedInputManifest(ctx, invocation);
        return {
            content: await retainedTextFragment(ctx, text, index),
            contentHash: text.contentHash,
            sizeBytes: text.sizeBytes,
            characters: text.characters,
            fragmentCount: text.fragmentHashes.length,
        };
    }
    const content = invocation.inputJson;
    if (index !== 0 || sha256Hex(content) !== expectedHash)
        throw executionError("invocation_input_invalid");
    return {
        content,
        contentHash: expectedHash,
        sizeBytes: new TextEncoder().encode(content).length,
        characters: content.length,
        fragmentCount: 1,
    };
}

/** Recovery bytes share immutable retention; their size must not roll back an already observed provider result. */
export async function retainInvocationRawOutput(
    ctx: MutationCtx,
    invocation: Doc<"agentInvocations">,
    rawOutputJson?: string,
) {
    if (rawOutputJson === undefined) return {};
    if (invocation.rawOutputTextId) {
        const text = await completeRetainedText(
            ctx,
            invocation.rawOutputTextId,
        );
        if (
            text.key !== `${invocation._id}:raw_output` ||
            text.contentHash !== sha256Hex(rawOutputJson)
        )
            throw executionError("invocation_result_conflict");
        return { rawOutputTextId: text._id };
    }
    if (
        invocation.rawOutputJson !== undefined &&
        invocation.rawOutputJson !== rawOutputJson
    )
        throw executionError("invocation_result_conflict");
    // Inline responses and correction share the invocation document; larger responses live in fragments.
    const large =
        new TextEncoder().encode(rawOutputJson).length >
            RETAINED_TEXT_INLINE_BYTES ||
        getDocumentSize({ ...invocation, rawOutputJson }) +
            2 * RETAINED_TEXT_INLINE_BYTES +
            MAX_OPERATION_RESULT_BYTES >=
            CONVEX_MAX_DOCUMENT_BYTES;
    if (!large) return { rawOutputJson };
    if (invocation.generationBackend?.id !== "pi-durable")
        throw executionError("response_capacity");
    const staged = await ctx.db
        .query("retainedTexts")
        .withIndex("by_key", (q) => q.eq("key", `${invocation._id}:raw_output`))
        .unique();
    if (!staged || staged.contentHash !== sha256Hex(rawOutputJson))
        throw executionError("invocation_result_not_prepared");
    await completeRetainedText(ctx, staged._id);
    return { rawOutputJson: undefined, rawOutputTextId: staged._id };
}

/** Received and adopted response identities share immutable bytes, independent of inline storage. */
export async function retainInvocationResponse(
    ctx: MutationCtx,
    invocation: Doc<"agentInvocations">,
    json: string,
) {
    if (new TextEncoder().encode(json).length <= RETAINED_TEXT_INLINE_BYTES)
        return { json, textId: undefined };
    const staged = await ctx.db
        .query("retainedTexts")
        .withIndex("by_key", (q) =>
            q.eq("key", `${invocation._id}:response:${sha256Hex(json)}`),
        )
        .unique();
    if (!staged) throw executionError("invocation_result_not_prepared");
    await completeRetainedText(ctx, staged._id);
    return { json: undefined, textId: staged._id };
}

/** Stores immutable, bounded observations separately from model continuation state. */
export async function retainInvocationPayload(
    ctx: MutationCtx,
    invocation: Doc<"agentInvocations">,
    part: "request" | "reply",
    contentJson?: string,
    missingCode = "observable_reply_unavailable",
    retention?: {
        textId?: Id<"retainedTexts">;
        effectiveMaxOutputTokens?: number;
    },
) {
    const textId = retention?.textId;
    const text = textId ? await completeRetainedText(ctx, textId) : undefined;
    if (text && text.key !== `${invocation._id}:${part}`)
        throw executionError("journal_payload_conflict");
    const existing = await ctx.db
        .query("agentInvocationPayloads")
        .withIndex("by_invocation_and_part", (q) =>
            q.eq("invocationId", invocation._id).eq("part", part),
        )
        .unique();
    let payload: RetainedPayload = text
        ? {
              version: 1,
              state: "complete",
              textId,
              contentHash: text.contentHash,
              sizeBytes: text.sizeBytes,
          }
        : retainablePayload(
              contentJson,
              `journal_${part}_capacity`,
              missingCode,
          );
    if (
        !text &&
        contentJson !== undefined &&
        invocation.generationBackend?.id === "pi-durable" &&
        (payload.state === "incomplete" ||
            (part === "reply" &&
                existing?.json === undefined &&
                (payload.sizeBytes ?? 0) > RETAINED_TEXT_INLINE_BYTES))
    ) {
        const canonical =
            payload.json ?? stableStringify(JSON.parse(contentJson));
        const key = `${invocation._id}:${part}`;
        let retainedId = existing?.textId;
        if (!retainedId) {
            const { manifest, parts } = retainedTextParts(canonical);
            for (const [index, content] of parts.entries())
                retainedId = await stageRetainedText(ctx, key, {
                    ...manifest,
                    index,
                    content,
                });
        }
        if (!retainedId) throw executionError("journal_payload_invalid");
        const retained = await completeRetainedText(ctx, retainedId);
        if (existing?.textId) {
            const bytes = new TextEncoder().encode(canonical);
            if (
                retained.key !== key ||
                retained.contentHash !== sha256Hex(bytes) ||
                retained.sizeBytes !== bytes.length ||
                retained.characters !== canonical.length
            )
                throw executionError("journal_payload_conflict");
        }
        payload = {
            version: 1,
            state: "complete",
            textId: retainedId,
            contentHash: retained.contentHash,
            sizeBytes: retained.sizeBytes,
        };
    }
    const { contentHash, code } = payload;
    if (
        part === "request" &&
        payload.state === "complete" &&
        contentHash &&
        invocation.missionId &&
        invocation.providerCallId &&
        invocation.purpose !== "compaction"
    ) {
        const mission = await ctx.db.get(invocation.missionId);
        const firstReceipt = mission?.firstProviderInput
            ? await ctx.db.get(mission.firstProviderInput.providerCallId)
            : null;
        if (
            mission &&
            (!mission.firstProviderInput ||
                firstReceipt?.dispatchOutcome === "not_dispatched")
        )
            await ctx.db.patch(mission._id, {
                firstProviderInput: {
                    invocationId: invocation._id,
                    providerCallId: invocation.providerCallId,
                    contentHash,
                },
            });
    }
    if (existing) {
        if (existing.contentHash !== contentHash || existing.code !== code)
            throw executionError("journal_payload_conflict");
        return {
            state: existing.state,
            ...(existing.code ? { code: existing.code } : {}),
        };
    }
    await ctx.db.insert("agentInvocationPayloads", {
        invocationId: invocation._id,
        runId: invocation.runId,
        part,
        ...(retention?.effectiveMaxOutputTokens !== undefined
            ? { effectiveMaxOutputTokens: retention.effectiveMaxOutputTokens }
            : {}),
        ...payload,
        createdAt: Date.now(),
    });
    await recordInvocationEvent(ctx, invocation, {
        kind: `invocation_${part}_recorded`,
        ...(code ? { code } : {}),
    });
    return {
        state: payload.state,
        ...(code ? { code } : {}),
    };
}

export function preparedReplyBasisHash(
    basisHash: string,
    reviewDraft: Infer<typeof preparedResponseReviewDraft> | undefined,
    completion: Infer<typeof preparedCompletionValidator>,
    wording?: PreparedAnalystWording,
    exactFactsRevision?: string,
) {
    return sha256Hex(
        stableStringify({
            basisHash,
            reviewDraft,
            completion,
            wording,
            exactFactsRevision,
        }),
    );
}

export function preparedResultPrefix(invocationId: Id<"agentInvocations">) {
    return `${invocationId}:prepared_result`;
}

export function preparedReplyPrefix(invocationId: Id<"agentInvocations">) {
    return `${invocationId}:prepared_reply`;
}

export async function purgeInvocationJournalBatch(
    ctx: MutationCtx,
    invocationId: Id<"agentInvocations">,
) {
    const payload = await ctx.db
        .query("agentInvocationPayloads")
        .withIndex("by_invocation_and_part", (q) =>
            q.eq("invocationId", invocationId),
        )
        .first();
    if (payload) {
        if (
            payload.textId &&
            !(await deleteRetainedTextBatch(
                ctx,
                payload.textId,
                `${invocationId}:${payload.part}`,
                DOSSIER_PURGE_BATCH,
            ))
        )
            return true;
        await ctx.db.delete(payload._id);
        return true;
    }
    for (const part of ["request", "reply"]) {
        const key = `${invocationId}:${part}`;
        const staged = await ctx.db
            .query("retainedTexts")
            .withIndex("by_key", (q) => q.eq("key", key))
            .unique();
        if (staged) {
            await deleteRetainedTextBatch(
                ctx,
                staged._id,
                key,
                DOSSIER_PURGE_BATCH,
            );
            return true;
        }
    }
    for (const prefix of [
        preparedReplyPrefix(invocationId),
        preparedResultPrefix(invocationId),
        `${invocationId}:response`,
    ]) {
        const preparation = await ctx.db
            .query("retainedTexts")
            .withIndex("by_key", (q) =>
                q.gte("key", `${prefix}:`).lt("key", `${prefix};`),
            )
            .first();
        if (preparation) {
            await deleteRetainedTextBatch(
                ctx,
                preparation._id,
                preparation.key,
                DOSSIER_PURGE_BATCH,
            );
            return true;
        }
    }
    const rawKey = `${invocationId}:raw_output`;
    const raw = await ctx.db
        .query("retainedTexts")
        .withIndex("by_key", (q) => q.eq("key", rawKey))
        .unique();
    if (raw) {
        await deleteRetainedTextBatch(
            ctx,
            raw._id,
            rawKey,
            DOSSIER_PURGE_BATCH,
        );
        return true;
    }
    return false;
}

/** Advances a fixed pre-upgrade cutoff; caller strings are never used as paginator positions. */
export const indexRetainedHistory = internalMutation({
    args: {
        missionId: v.id("agentMissions"),
        expectedGeneration: v.number(),
        throughSequence: v.number(),
        cursor: v.optional(v.string()),
    },
    returns: v.object({
        done: v.boolean(),
        cursor: v.union(v.string(), v.null()),
    }),
    handler: async (ctx, args) => {
        const { mission } = await requireMissionAuthority(
            ctx,
            args.missionId,
            args.expectedGeneration,
        );
        let projection = mission.historyProjection;
        if (projection?.ready) return { done: true, cursor: null };
        if (!projection) {
            if (
                args.cursor !== undefined ||
                !Number.isSafeInteger(args.throughSequence) ||
                args.throughSequence !== mission.nextEventSequence - 1
            )
                throw executionError("history_projection_conflict");
            projection = {
                version: 1,
                throughSequence: args.throughSequence,
                cursor: null,
                ready: false,
            };
        }
        if (projection.throughSequence !== args.throughSequence)
            throw executionError("history_projection_conflict");
        if ((args.cursor ?? null) !== projection.cursor)
            return { done: false, cursor: projection.cursor };
        const page = await ctx.db
            .query("agentExecutionEvents")
            .withIndex("by_mission_and_sequence", (q) =>
                q
                    .eq("missionId", mission._id)
                    .lte("sequence", projection.throughSequence),
            )
            .paginate({
                numItems: HISTORY_PAGE_SIZE,
                cursor: projection.cursor,
            });
        for (const event of page.page) {
            if (event.sequence === undefined)
                throw executionError("mission_history_invalid");
            if (event.historySourceSequence === undefined)
                await ctx.db.patch(event._id, {
                    historySourceSequence: event.sequence,
                });
        }
        const cursor = page.isDone ? null : page.continueCursor;
        await ctx.db.patch(mission._id, {
            historyProjection: { ...projection, cursor, ready: page.isDone },
        });
        return { done: page.isDone, cursor };
    },
});

/** Capture application observations without substituting backend continuation state for a model reply. */
export async function invocationEventObservation(
    ctx: QueryCtx,
    invocation: Doc<"agentInvocations">,
    response:
        | Infer<
              typeof import("./executionProtocol").invocationResponseValidator
          >
        | { responseHash: string; operationNames?: string[] },
    rawOutputJson?: string,
    retainedResponseHash?: string,
) {
    const reply = await ctx.db
        .query("agentInvocationPayloads")
        .withIndex("by_invocation_and_part", (q) =>
            q.eq("invocationId", invocation._id).eq("part", "reply"),
        )
        .unique();
    const operationNames =
        "kind" in response
            ? response.kind === "operations"
                ? response.requests.map((request) => request.name)
                : []
            : (response.operationNames ?? []);
    const consultationOnly =
        operationNames.length > 0 && operationNames.every(isCommonConsultation);
    const responseHash =
        "responseHash" in response
            ? response.responseHash
            : retainedResponseHash;
    return {
        historySource: consultationOnly ? undefined : ("observation" as const),
        invocationPayloadId: reply?._id,
        observation: {
            provenance: invocation.provenance,
            response: responseHash
                ? {
                      kind: "retained_invocation_response",
                      invocationId: invocation._id,
                      contentHash: responseHash,
                  }
                : response,
            ...(invocation.provenance === "simulation" &&
            rawOutputJson !== undefined
                ? { rawOutputJson }
                : {}),
        },
    };
}

/** Allocates dossier order at admission/effect commit, independently of message publication. */
export async function nextNativeInputSequence(
    ctx: MutationCtx,
    runId: Id<"researchRuns">,
) {
    const run = await ctx.db.get(runId);
    if (!run) throw executionError("run_unavailable");
    const conversation = await ctx.db
        .query("agentConversations")
        .withIndex("by_run", (q) => q.eq("runId", runId))
        .unique();
    const sequence =
        Math.max(
            conversation?.nativeInputSequence ?? 0,
            await contextObservationSequence(ctx, runId),
        ) + 1;
    if (!Number.isSafeInteger(sequence))
        throw executionError("native_input_capacity");
    if (conversation)
        await ctx.db.patch(conversation._id, { nativeInputSequence: sequence });
    return sequence;
}

export function contextObservationTextKey(
    runId: Id<"researchRuns">,
    sequence: number,
) {
    return `context:${runId}:${sequence}`;
}

/** Records an immutable observation with the business effect; replay never allocates another order. */
export async function recordContextObservation(
    ctx: MutationCtx,
    runId: Id<"researchRuns">,
    args: {
        key: string;
        topic: NonNullable<
            Doc<"agentExecutionEvents">["contextObservation"]
        >["topic"];
        actor: NonNullable<Doc<"agentExecutionEvents">["actor"]>;
        value: unknown;
    },
) {
    const json = stableStringify(args.value);
    const previous = await ctx.db
        .query("agentExecutionEvents")
        .withIndex("by_run_and_context_key", (q) =>
            q.eq("runId", runId).eq("contextObservation.key", args.key),
        )
        .unique();
    if (previous) {
        if (!previous.contextObservation)
            throw executionError("journal_payload_conflict");
        const stored = await completeRetainedText(
            ctx,
            previous.contextObservation.textId,
        );
        const bytes = new TextEncoder().encode(json);
        if (
            stored.contentHash !== sha256Hex(bytes) ||
            stored.characters !== json.length ||
            stored.sizeBytes !== bytes.length
        )
            throw executionError("journal_payload_conflict");
        return previous._id;
    }
    const sequence = await nextNativeInputSequence(ctx, runId);
    const { parts, manifest } = retainedTextParts(json);
    let textId: Id<"retainedTexts"> | undefined;
    for (const [index, content] of parts.entries())
        textId = await stageRetainedText(
            ctx,
            contextObservationTextKey(runId, sequence),
            {
                ...manifest,
                index,
                content,
            },
        );
    if (!textId) throw executionError("journal_payload_invalid");
    await completeRetainedText(ctx, textId);
    const eventId = await ctx.db.insert("agentExecutionEvents", {
        runId,
        actor: args.actor,
        kind: "context_observed",
        cause: args.key,
        nativeInputSequence: sequence,
        sequence,
        contextObservation: {
            version: 1,
            key: args.key,
            topic: args.topic,
            textId,
        },
        occurredAt: Date.now(),
    });
    const event = await ctx.db.get(eventId);
    if (!event) throw executionError("journal_payload_unavailable");
    const { prefix, suffix } = contextHistoryEnvelope(event);
    await ctx.db.patch(eventId, {
        contextHistoryHash: sha256Hex(prefix + json + suffix),
    });
    return eventId;
}
