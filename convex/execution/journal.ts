import type { Doc, Id } from "@convex/_generated/dataModel";
import {
    internalMutation,
    type MutationCtx,
    type QueryCtx,
} from "@convex/_generated/server";
import {
    completeCharacterBoundary,
    sha256Hex,
    stableStringify,
} from "@convex/domain/sourcePassages";
import {
    HISTORY_PAGE_SIZE,
    RETAINED_TEXT_INLINE_BYTES,
    MAX_OBSERVABLE_OUTPUT_BYTES,
    MAX_OPERATION_RESULT_BYTES,
} from "@convex/resourcePolicy";
import { getDocumentSize, type Infer, v } from "convex/values";
import { recordInvocationEvent, requireMissionAuthority } from "./authority";
import { executionError } from "./errors";
import {
    isCommonConsultation,
    type retainedPayloadValidator,
} from "./operationContracts";

import {
    completeRetainedText,
    retainCompleteText,
    readRetainedText,
    retainedTextParts,
    retainedTextRange,
    stageRetainedText,
} from "./retainedText";

type RetainedPayload = Infer<typeof retainedPayloadValidator>;

function retainablePayload(
    contentJson: string | undefined,
    capacityCode: string,
    missingCode: string,
): RetainedPayload {
    const json =
        contentJson === undefined
            ? undefined
            : stableStringify(JSON.parse(contentJson));
    const sizeBytes = new TextEncoder().encode(json ?? "").length;
    const contentHash = json === undefined ? undefined : sha256Hex(json);
    const complete =
        json !== undefined && sizeBytes <= MAX_OBSERVABLE_OUTPUT_BYTES;
    return {
        version: 1,
        state: complete ? "complete" : "incomplete",
        ...(complete ? { json } : {}),
        ...(contentHash ? { contentHash } : {}),
        sizeBytes,
        ...(!complete
            ? { code: json === undefined ? missingCode : capacityCode }
            : {}),
    };
}

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

/** Append-only event content is written in the same transaction as its observed effect/result. */
export async function retainExecutionEventPayload(
    ctx: MutationCtx,
    eventId: Id<"agentExecutionEvents">,
    value: unknown,
): Promise<void> {
    const event = await ctx.db.get(eventId);
    if (!event) throw executionError("journal_event_unavailable");
    const payload = retainablePayload(
        JSON.stringify(value),
        "journal_operation_capacity",
        "operation_observation_unavailable",
    );
    if (event.payload) {
        if (stableStringify(event.payload) !== stableStringify(payload))
            throw executionError("journal_payload_conflict");
        return;
    }
    await ctx.db.patch(eventId, { payload });
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

async function historyEventParts(
    ctx: QueryCtx,
    event: Doc<"agentExecutionEvents">,
) {
    const metadata = { ...event };
    delete metadata.payload;
    delete metadata.historySourceSequence;
    delete metadata.protectedDiagnostic;
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
    const observation = event.contextObservation
        ? {
              state: "complete" as const,
              value: JSON.parse(
                  await readRetainedText(ctx, event.contextObservation.textId),
              ) as unknown,
          }
        : event.payload
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

/** Historical fragments never join the current mutable execution documents. */
export async function projectMissionHistoryEvent(
    ctx: QueryCtx,
    event: Doc<"agentExecutionEvents">,
): Promise<{ json: string; contentHash: string }> {
    return projectMissionHistoryEventFromParts(
        ctx,
        event,
        await historyEventParts(ctx, event),
    );
}

async function projectMissionHistoryEventFromParts(
    ctx: QueryCtx,
    event: Doc<"agentExecutionEvents">,
    parts: Awaited<ReturnType<typeof historyEventParts>>,
): Promise<{ json: string; contentHash: string }> {
    const { metadata, part, invocationPayload, observation } = parts;
    const json = stableStringify({
        version: 1,
        event: metadata,
        ...(observation ? { observation } : {}),
        ...(part || event.invocationPayloadId
            ? {
                  invocation: invocationPayload
                      ? observablePayload(
                            invocationPayload.textId
                                ? {
                                      ...invocationPayload,
                                      json: await readRetainedText(
                                          ctx,
                                          invocationPayload.textId,
                                      ),
                                  }
                                : invocationPayload,
                        )
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
    const eventParts = await historyEventParts(ctx, event);
    const { metadata, invocationPayload, observation } = eventParts;
    if (!invocationPayload?.textId) {
        const source = await projectMissionHistoryEventFromParts(
            ctx,
            event,
            eventParts,
        );
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
    const suffix = "}}";
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
        contentHash: sha256Hex(
            stableStringify({
                ...envelope,
                contentHash: text.contentHash,
            }),
        ),
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
export async function admittedInputJson(
    ctx: QueryCtx,
    invocation: Doc<"agentInvocations">,
) {
    if (!invocation.inputTextId) {
        if (
            invocation.inputContentHash &&
            sha256Hex(invocation.inputJson) !== invocation.inputContentHash
        )
            throw executionError("invocation_input_invalid");
        return invocation.inputJson;
    }
    const text = await completeRetainedText(ctx, invocation.inputTextId);
    if (
        text.key !== `${invocation._id}:input` ||
        text.contentHash !== invocation.inputContentHash
    )
        throw executionError("invocation_input_invalid");
    return readRetainedText(ctx, text._id);
}

export function admittedInputHash(invocation: Doc<"agentInvocations">) {
    return invocation.inputContentHash ?? sha256Hex(invocation.inputJson);
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
            MAX_OBSERVABLE_OUTPUT_BYTES ||
        getDocumentSize({ ...invocation, rawOutputJson }) +
            2 * RETAINED_TEXT_INLINE_BYTES +
            MAX_OPERATION_RESULT_BYTES >=
            1_048_576;
    if (!large) return { rawOutputJson };
    if (invocation.generationBackend?.id !== "pi-durable")
        throw executionError("response_capacity");
    const textId = await retainCompleteText(
        ctx,
        `${invocation._id}:raw_output`,
        rawOutputJson,
    );
    return { rawOutputJson: undefined, rawOutputTextId: textId };
}

/** Native replay receives the exact original; ordinary metadata readers keep a bounded invocation document. */
export async function invocationRawOutputJson(
    ctx: QueryCtx,
    invocation: Doc<"agentInvocations">,
) {
    if (!invocation.rawOutputTextId) return invocation.rawOutputJson;
    const text = await completeRetainedText(ctx, invocation.rawOutputTextId);
    if (text.key !== `${invocation._id}:raw_output`)
        throw executionError("invocation_result_invalid");
    return readRetainedText(ctx, text._id);
}

/** Received and adopted response identities share immutable bytes, independent of inline storage. */
export async function retainInvocationResponse(
    ctx: MutationCtx,
    invocation: Doc<"agentInvocations">,
    json: string,
) {
    if (new TextEncoder().encode(json).length <= RETAINED_TEXT_INLINE_BYTES)
        return { json, textId: undefined };
    const textId = await retainCompleteText(
        ctx,
        `${invocation._id}:response:${sha256Hex(json)}`,
        json,
    );
    return { json: undefined, textId };
}

/** Rehydrates execution responses only at consumers that need their complete content. */
export async function invocationResponses(
    ctx: QueryCtx,
    invocation: Doc<"agentInvocations">,
) {
    const read = async (
        textId: Id<"retainedTexts"> | undefined,
        inline: string | undefined,
    ) => {
        if (!textId) return inline;
        const manifest = await completeRetainedText(ctx, textId);
        if (
            manifest.key !==
            `${invocation._id}:response:${manifest.contentHash}`
        )
            throw executionError("invocation_result_invalid");
        const json = await readRetainedText(ctx, textId);
        if (inline !== undefined && inline !== json)
            throw executionError("invocation_result_conflict");
        return json;
    };
    const receivedOutputJson = await read(
        invocation.receivedOutputTextId,
        invocation.receivedOutputJson,
    );
    const outputJson =
        invocation.outputTextId &&
        invocation.outputTextId === invocation.receivedOutputTextId &&
        invocation.outputJson === undefined
            ? receivedOutputJson
            : await read(invocation.outputTextId, invocation.outputJson);
    return { receivedOutputJson, outputJson };
}

export function hasReceivedResponse(invocation: Doc<"agentInvocations">) {
    return (
        invocation.receivedOutputJson !== undefined ||
        invocation.receivedOutputTextId !== undefined
    );
}

/** Without provider admission, a retained live response is a known local refusal. */
export function hasKnownNonDispatch(invocation: Doc<"agentInvocations">) {
    return (
        invocation.journalVersion === 1 &&
        invocation.provenance === "live" &&
        !invocation.providerCallId &&
        hasReceivedResponse(invocation)
    );
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
        payload.state === "incomplete" &&
        invocation.generationBackend?.id === "pi-durable"
    ) {
        const { manifest, parts } = retainedTextParts(
            stableStringify(JSON.parse(contentJson)),
        );
        let retainedId: Id<"retainedTexts"> | undefined;
        for (const [index, content] of parts.entries())
            retainedId = await stageRetainedText(
                ctx,
                `${invocation._id}:${part}`,
                { ...manifest, index, content },
            );
        if (!retainedId) throw executionError("journal_payload_invalid");
        await completeRetainedText(ctx, retainedId);
        payload = {
            version: 1,
            state: "complete",
            textId: retainedId,
            contentHash: manifest.contentHash,
            sizeBytes: manifest.sizeBytes,
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
    const existing = await ctx.db
        .query("agentInvocationPayloads")
        .withIndex("by_invocation_and_part", (q) =>
            q.eq("invocationId", invocation._id).eq("part", part),
        )
        .unique();
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
    response: Infer<
        typeof import("./executionProtocol").invocationResponseValidator
    >,
    rawOutputJson?: string,
) {
    const reply = await ctx.db
        .query("agentInvocationPayloads")
        .withIndex("by_invocation_and_part", (q) =>
            q.eq("invocationId", invocation._id).eq("part", "reply"),
        )
        .unique();
    const consultationOnly =
        response.kind === "operations" &&
        response.requests.length > 0 &&
        response.requests.every((request) =>
            isCommonConsultation(request.name),
        );
    return {
        historySource: consultationOnly ? undefined : ("observation" as const),
        invocationPayloadId: reply?._id,
        observation: {
            provenance: invocation.provenance,
            response,
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
        if (
            !previous.contextObservation ||
            (await readRetainedText(
                ctx,
                previous.contextObservation.textId,
            )) !== json
        )
            throw executionError("journal_payload_conflict");
        return previous._id;
    }
    const sequence = await nextNativeInputSequence(ctx, runId);
    const { parts, manifest } = retainedTextParts(json);
    let textId: Id<"retainedTexts"> | undefined;
    for (const [index, content] of parts.entries())
        textId = await stageRetainedText(ctx, `context:${runId}:${sequence}`, {
            ...manifest,
            index,
            content,
        });
    if (!textId) throw executionError("journal_payload_invalid");
    await completeRetainedText(ctx, textId);
    return ctx.db.insert("agentExecutionEvents", {
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
}

/** Current observation frontier is independent of invocation/lease bookkeeping. */
export async function contextObservationSequence(
    ctx: QueryCtx,
    runId: Id<"researchRuns">,
) {
    const last = await ctx.db
        .query("agentExecutionEvents")
        .withIndex("by_run_and_native_input_sequence", (q) =>
            q.eq("runId", runId).gt("nativeInputSequence", 0),
        )
        .order("desc")
        .first();
    return last?.nativeInputSequence ?? 0;
}

/** Run observations have their own dossier ordering and are never mistaken for mission events. */
export function isContextObservation(event: Doc<"agentExecutionEvents">) {
    return (
        event.kind === "context_observed" &&
        event.contextObservation?.version === 1 &&
        Number.isSafeInteger(event.nativeInputSequence) &&
        event.nativeInputSequence === event.sequence
    );
}

/** The latest command frontier is separate from business-state changes and queued user messages. */
export async function latestNativeControl(
    ctx: QueryCtx,
    runId: Id<"researchRuns">,
) {
    return ctx.db
        .query("agentMessageDeliveries")
        .withIndex("by_run_and_delivery_and_native_input_sequence", (q) =>
            q
                .eq("runId", runId)
                .eq("delivery", "control")
                .gt("nativeInputSequence", 0),
        )
        .order("desc")
        .first();
}
