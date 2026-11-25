import type { Doc, Id } from "@convex/_generated/dataModel";
import {
    internalQuery,
    type MutationCtx,
    type QueryCtx,
} from "@convex/_generated/server";
import {
    completeCharacterBoundary,
    sha256Hex,
    stableStringify,
} from "@convex/domain/sourcePassages";
import {
    readConversationMessages,
    retainedDeliveryBody,
} from "@convex/integrations/agentStorage";
import {
    HISTORY_PAGE_SIZE,
    MAX_CONVERSATION_SCAN,
    MAX_CONVERSATION_SCAN_BYTES,
    MAX_OPERATION_RESULT_BYTES,
} from "@convex/resourcePolicy";
import { type Infer, v } from "convex/values";
import { validate } from "convex-helpers/validators";
import { requireMissionAuthority } from "./authority";
import { requireInstructionVersion } from "./conversations";
import { executionError, executionFailureCode } from "./errors";
import {
    type AgentOperationDefinition,
    historyReadResultValidator,
} from "./executionProtocol";
import {
    historyTextFragment as fragment,
    isContextObservation,
    readMissionHistoryEventFragment,
} from "./journal";
import { readMissionState } from "./missionHistory";
import {
    type HistoryReadReceipt,
    historyPageValidator,
    type historyPositionValidator,
    historyReadReceiptValidator,
    historySourceFor,
} from "./operationContracts";
import { retainedTextRange } from "./retainedText";

const CURSOR_PREFIX = "history:";
type Frontier = Infer<typeof historyReadReceiptValidator>["frontier"];
type Position = Infer<typeof historyPositionValidator>;
type HistoryResult = Infer<typeof historyReadResultValidator>;
type HistoryEntry = Infer<typeof historyPageValidator>["entries"][number];
type HistoryPin = Extract<
    import("./agentDefinition").OperationPin,
    { kind: "history_read" }
>;

function validPosition(position: Position, source: HistoryPin["source"]) {
    return (
        position.source === source &&
        Number.isSafeInteger(position.offset) &&
        position.offset >= 0 &&
        (position.source !== "mission" ||
            (Number.isSafeInteger(position.sequence) && position.sequence >= 1))
    );
}

/** Cache the first source window until independently verified material advances it. */
export async function prepareMissionHistorySnapshot(
    ctx: MutationCtx,
    mission: Doc<"agentMissions">,
) {
    const current = await ctx.db.get(mission._id);
    if (!current) throw executionError("mission_unavailable");
    const projection = current.historyProjection;
    if (!projection?.ready) return current;
    const anchorSequence =
        current.historyMaterialSequence ?? projection.throughSequence;
    if (projection.snapshot?.anchorSequence === anchorSequence) return current;
    const historyProjection = {
        ...projection,
        snapshot: {
            anchorSequence,
            throughSequence: current.nextEventSequence - 1,
        },
    };
    await ctx.db.patch(current._id, { historyProjection });
    return { ...current, historyProjection };
}

/** Pin a first-page frontier before admission writes; continuation resolution remains in the read boundary. */
export const pinHistoryRead: AgentOperationDefinition["pin"] = async (
    ctx,
    mission,
    input,
    _runId,
    retained,
) => {
    const source = historySourceFor(input.kind);
    if (!mission || !source)
        return { kind: "unavailable", code: "mission_required" };
    if (retained?.kind === "history_read") {
        if (retained.source !== source)
            throw executionError("history_receipt_invalid");
        return { kind: "available", pin: retained };
    }
    if (
        input.kind === "consult_mission_state" &&
        input.reference !== undefined
    ) {
        if (
            source !== "mission" ||
            ("cursor" in input && input.cursor !== undefined)
        )
            return { kind: "unavailable", code: "history_reference_invalid" };
        const event = await ctx.db.get(input.reference);
        if (
            !event ||
            (event.missionId !== mission._id && !isContextObservation(event)) ||
            event.runId !== mission.runId ||
            !event.sequence
        )
            return {
                kind: "unavailable",
                code: "history_reference_unavailable",
            };
        return {
            kind: "available",
            pin: {
                kind: "history_read",
                source,
                reference: event._id,
                frontier: { source, sequence: event.sequence },
            },
        };
    }
    if ("cursor" in input && input.cursor !== undefined) {
        const turn = mission.conversationTurnId
            ? await ctx.db.get(mission.conversationTurnId)
            : null;
        try {
            const resolved = await resolveCursorChain(ctx, {
                mission,
                source,
                cursor: input.cursor,
                generation: mission.generation,
                instructionVersion: turn?.instructionVersion,
            });
            if (resolved)
                return {
                    kind: "available",
                    pin: {
                        kind: "history_read",
                        source,
                        frontier: resolved.frontier,
                        ...(resolved.reference
                            ? { reference: resolved.reference }
                            : {}),
                    },
                };
        } catch (error) {
            if (executionFailureCode(error) !== "history_receipt_invalid")
                throw error;
        }
        return { kind: "available", pin: { kind: "history_read", source } };
    }
    let frontier: Frontier;
    if (source === "mission") {
        if (!mission.historyProjection?.ready)
            return { kind: "unavailable", code: "history_index_pending" };
        const last = await ctx.db
            .query("agentExecutionEvents")
            .withIndex("by_mission_and_history_source", (q) =>
                q
                    .eq("missionId", mission._id)
                    .gt("historySourceSequence", 0)
                    .lte(
                        "historySourceSequence",
                        mission.historyProjection?.snapshot?.throughSequence ??
                            mission.nextEventSequence - 1,
                    ),
            )
            .order("desc")
            .first();
        frontier = { source, sequence: last?.historySourceSequence ?? 0 };
    } else {
        const conversation = await ctx.db
            .query("agentConversations")
            .withIndex("by_run", (q) => q.eq("runId", mission.runId))
            .unique();
        if (!conversation)
            return { kind: "unavailable", code: "conversation_unavailable" };
        const last = await ctx.db
            .query("agentMessageDeliveries")
            .withIndex("by_run_and_status", (q) =>
                q.eq("runId", mission.runId).eq("status", "processed"),
            )
            .order("desc")
            .first();
        frontier = {
            source,
            throughCreationTime: last?._creationTime ?? 0,
            throughMessageId: last?._id ?? null,
            publicationRevision: conversation.publicationRevision ?? 0,
        };
    }
    return {
        kind: "available",
        pin: { kind: "history_read", source, frontier },
    };
};

async function resolveCursorChain(
    ctx: QueryCtx,
    args: {
        mission: Doc<"agentMissions">;
        source: HistoryPin["source"];
        cursor: string;
        generation: number;
        instructionVersion: number | undefined;
        currentRequestId?: Id<"agentOperationRequests">;
    },
): Promise<{
    frontier: Frontier;
    position: Position;
    reference?: Id<"agentExecutionEvents">;
} | null> {
    const { mission, source, cursor, generation, instructionVersion } = args;
    if (!cursor.startsWith(CURSOR_PREFIX) || cursor.length > 160) return null;
    const immediateId = ctx.db.normalizeId(
        "agentOperationRequests",
        cursor.slice(CURSOR_PREFIX.length),
    );
    if (!immediateId) return null;

    const visited = new Set<Id<"agentOperationRequests">>();
    if (args.currentRequestId) visited.add(args.currentRequestId);
    let currentId: Id<"agentOperationRequests"> | null = immediateId;
    let expectedFrontier: Frontier | undefined;
    let immediateNext: Position | undefined;
    let resolvedPin:
        | { frontier: Frontier; reference?: Id<"agentExecutionEvents"> }
        | undefined;
    const legacySteps: {
        request: Doc<"agentOperationRequests">;
        receipt: HistoryReadReceipt;
        valueJson: string;
    }[] = [];

    while (currentId) {
        if (visited.has(currentId))
            throw executionError("history_receipt_invalid");
        visited.add(currentId);
        const prev: Doc<"agentOperationRequests"> | null =
            await ctx.db.get(currentId);
        const isImmediate = currentId === immediateId;
        if (
            prev?.status !== "completed" ||
            prev.outcome?.kind !== "success" ||
            prev.adoptedAt === undefined ||
            prev.operationVersion < 2 ||
            historySourceFor(prev.input.kind) !== source ||
            prev.missionId !== mission._id ||
            prev.runId !== mission.runId
        ) {
            if (isImmediate) return null;
            throw executionError("history_receipt_invalid");
        }
        const receipt = prev.historyRead;
        if (
            !receipt ||
            !validate(historyReadReceiptValidator, receipt, { db: ctx.db }) ||
            receipt.source !== source ||
            receipt.frontier.source !== source ||
            receipt.runId !== prev.runId ||
            receipt.missionId !== prev.missionId
        )
            throw executionError("history_receipt_invalid");
        verifyHistoryReadReceipt(
            prev,
            receipt,
            receipt.generation,
            prev.outcome.valueJson,
        );
        if (
            receipt.generation !== generation ||
            receipt.instructionVersion !== instructionVersion ||
            !receipt.next
        ) {
            if (isImmediate) return null;
            throw executionError("history_receipt_invalid");
        }
        if (!validPosition(receipt.next, source))
            throw executionError("history_receipt_invalid");
        if (expectedFrontier === undefined) {
            expectedFrontier = receipt.frontier;
            immediateNext = receipt.next;
        } else if (
            stableStringify(receipt.frontier) !==
            stableStringify(expectedFrontier)
        ) {
            throw executionError("history_receipt_invalid");
        }
        if (prev.pin?.kind !== "history_read" || prev.pin.source !== source)
            throw executionError("history_receipt_invalid");
        if (prev.pin.frontier !== undefined) {
            resolvedPin = {
                frontier: prev.pin.frontier,
                ...(prev.pin.reference
                    ? { reference: prev.pin.reference }
                    : {}),
            };
            break;
        }
        // Legacy intermediate pin omits frontier/reference; follow its predecessor cursor.
        const prevCursor: string | undefined =
            "cursor" in prev.input ? prev.input.cursor : undefined;
        if (!prevCursor?.startsWith(CURSOR_PREFIX) || prevCursor.length > 160)
            throw executionError("history_receipt_invalid");
        const ancestorId: Id<"agentOperationRequests"> | null =
            ctx.db.normalizeId(
                "agentOperationRequests",
                prevCursor.slice(CURSOR_PREFIX.length),
            );
        if (!ancestorId) throw executionError("history_receipt_invalid");
        legacySteps.push({
            request: prev,
            receipt,
            valueJson: prev.outcome.valueJson,
        });
        currentId = ancestorId;
    }

    if (!resolvedPin || !immediateNext)
        throw executionError("history_receipt_invalid");

    // Verify legacy intermediate targeted fragments against the resolved event to detect an already-diverged chain.
    if (
        legacySteps.length > 0 &&
        source === "mission" &&
        resolvedPin.reference &&
        resolvedPin.frontier.source === "mission"
    ) {
        const targetEvent = await ctx.db.get(resolvedPin.reference);
        if (
            !targetEvent ||
            (targetEvent.missionId !== mission._id &&
                !isContextObservation(targetEvent)) ||
            targetEvent.runId !== mission.runId ||
            targetEvent.sequence !== resolvedPin.frontier.sequence
        )
            throw executionError("history_receipt_invalid");
        for (const step of legacySteps) {
            const parsed = JSON.parse(step.valueJson) as {
                history: {
                    entries: {
                        sequence: number;
                        offset: number;
                        totalCharacters: number;
                        content: string;
                    }[];
                };
            };
            if (
                parsed.history.entries.length !==
                step.receipt.fragmentIds.length
            )
                throw executionError("history_receipt_invalid");
            for (const [idx, entry] of parsed.history.entries.entries()) {
                if (
                    entry.sequence !== targetEvent.sequence ||
                    entry.content.length < 1
                )
                    throw executionError("history_receipt_invalid");
                const chunk = await readMissionHistoryEventFragment(
                    ctx,
                    targetEvent,
                    entry.offset,
                    entry.content.length,
                );
                if (
                    chunk.content !== entry.content ||
                    chunk.totalCharacters !== entry.totalCharacters ||
                    fragmentIdentity(
                        "mission",
                        targetEvent._id,
                        chunk.contentHash,
                        entry.offset,
                        chunk.end,
                    ) !== step.receipt.fragmentIds[idx]
                )
                    throw executionError("history_receipt_invalid");
            }
        }
    }

    return {
        frontier: resolvedPin.frontier,
        position: immediateNext,
        ...(resolvedPin.reference ? { reference: resolvedPin.reference } : {}),
    };
}

async function resolvePosition(
    ctx: QueryCtx,
    mission: Doc<"agentMissions">,
    request: Doc<"agentOperationRequests">,
    pin: HistoryPin,
    generation: number,
): Promise<{
    frontier: Frontier;
    position: Position;
    reference?: Id<"agentExecutionEvents">;
} | null> {
    const cursor = "cursor" in request.input ? request.input.cursor : undefined;
    if (cursor === undefined) {
        if (!pin.frontier || pin.frontier.source !== pin.source)
            throw executionError("history_receipt_invalid");
        return {
            frontier: pin.frontier,
            reference: pin.reference,
            position:
                pin.source === "mission"
                    ? {
                          source: "mission",
                          sequence:
                              pin.reference && pin.frontier.source === "mission"
                                  ? pin.frontier.sequence
                                  : 1,
                          offset: 0,
                      }
                    : {
                          source: "conversation",
                          cursor: null,
                          offset: 0,
                      },
        };
    }
    const resolved = await resolveCursorChain(ctx, {
        mission,
        source: pin.source,
        cursor,
        generation,
        instructionVersion: request.instructionVersion,
        currentRequestId: request._id,
    });
    if (!resolved) return null;
    if (
        pin.frontier &&
        (stableStringify(pin.frontier) !== stableStringify(resolved.frontier) ||
            pin.reference !== resolved.reference)
    )
        throw executionError("history_receipt_invalid");
    return resolved;
}

function fragmentIdentity(
    source: string,
    id: string,
    textHash: string,
    offset: number,
    end: number,
) {
    return sha256Hex(stableStringify({ source, id, textHash, offset, end }));
}

const utf8Encoder = new TextEncoder();

function utf8Bytes(text: string) {
    return utf8Encoder.encode(text).length;
}

/** Fit the complete candidate first (preserving terminal cursor overhead), otherwise the largest Unicode-safe prefix. */
function fitHistoryContent(args: {
    candidate: string;
    offset: number;
    totalCharacters: number;
    completeNext: Position | null;
    partialNext: (end: number) => Position;
    measure: (content: string, next: Position | null) => number;
    maxBytes: number;
}):
    | {
          kind: "fit";
          content: string;
          end: number;
          next: Position | null;
          completedItem: boolean;
      }
    | { kind: "none" } {
    const {
        candidate,
        offset,
        totalCharacters,
        completeNext,
        partialNext,
        measure,
        maxBytes,
    } = args;
    const reachesEnd = offset + candidate.length === totalCharacters;
    if (reachesEnd && measure(candidate, completeNext) <= maxBytes) {
        return {
            kind: "fit",
            content: candidate,
            end: totalCharacters,
            next: completeNext,
            completedItem: true,
        };
    }
    const maxLen = completeCharacterBoundary(
        candidate,
        reachesEnd ? Math.max(0, candidate.length - 1) : candidate.length,
    );
    if (maxLen === 0) return { kind: "none" };
    if (
        measure(candidate.slice(0, maxLen), partialNext(offset + maxLen)) <=
        maxBytes
    ) {
        return {
            kind: "fit",
            content: candidate.slice(0, maxLen),
            end: offset + maxLen,
            next: partialNext(offset + maxLen),
            completedItem: false,
        };
    }
    let lo = 0;
    let hi = maxLen;
    while (lo + 1 < hi) {
        const midRaw = Math.floor((lo + hi) / 2);
        let mid = completeCharacterBoundary(candidate, midRaw);
        if (mid <= lo) {
            mid = Math.min(hi, midRaw + 1);
            if (mid >= hi) break;
        }
        if (
            measure(candidate.slice(0, mid), partialNext(offset + mid)) <=
            maxBytes
        ) {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    if (lo === 0) return { kind: "none" };
    return {
        kind: "fit",
        content: candidate.slice(0, lo),
        end: offset + lo,
        next: partialNext(offset + lo),
        completedItem: false,
    };
}

async function conversationFragment(
    ctx: QueryCtx,
    request: Doc<"agentOperationRequests">,
    frontier: Extract<Frontier, { source: "conversation" }>,
    position: Extract<Position, { source: "conversation" }>,
) {
    if (!frontier.throughMessageId) return null;
    const runId = request.runId;
    if (!runId) throw executionError("history_receipt_invalid");
    const conversation = await ctx.db
        .query("agentConversations")
        .withIndex("by_run", (q) => q.eq("runId", runId))
        .unique();
    if (
        !conversation ||
        !Number.isSafeInteger(frontier.publicationRevision) ||
        frontier.publicationRevision < 0
    )
        throw executionError("history_receipt_invalid");
    const page = await ctx.db
        .query("agentMessageDeliveries")
        .withIndex("by_run_and_status", (q) =>
            q
                .eq("runId", runId)
                .eq("status", "processed")
                .lte("_creationTime", frontier.throughCreationTime),
        )
        .filter((q) =>
            q.or(
                q.eq(q.field("publicationRevision"), undefined),
                q.lte(
                    q.field("publicationRevision"),
                    frontier.publicationRevision,
                ),
            ),
        )
        .paginate({
            numItems: 1,
            cursor: position.cursor,
            maximumRowsRead: MAX_CONVERSATION_SCAN,
            maximumBytesRead: MAX_CONVERSATION_SCAN_BYTES,
        });
    const message = page.page[0];
    if (!message) {
        if (!page.isDone) return { capacity: true as const };
        throw executionError("conversation_message_unavailable");
    }
    if (message.conversationId !== conversation._id)
        throw executionError("conversation_message_unavailable");
    let candidate: ReturnType<typeof fragment>;
    let contentHash: string;
    if (message.bodyTextId) {
        const body = await retainedDeliveryBody(ctx, message);
        const offset = position.offset;
        if (
            !Number.isSafeInteger(offset) ||
            offset < 0 ||
            offset >= body.characters
        )
            throw executionError("history_receipt_invalid");
        // One neighboring code unit on each side preserves the existing surrogate checks.
        const start = Math.max(0, offset - 1);
        const end = Math.min(
            body.characters,
            offset + MAX_OPERATION_RESULT_BYTES + 1,
        );
        const window = await retainedTextRange(ctx, body, start, end - start);
        const local = fragment(
            window,
            offset - start,
            MAX_OPERATION_RESULT_BYTES,
        );
        candidate = {
            offset,
            totalCharacters: body.characters,
            content: local.content,
            end: start + local.end,
        };
        contentHash = body.contentHash;
    } else {
        const [text] = await readConversationMessages(
            ctx,
            conversation.storageRef,
            [message],
        );
        if (!text) throw executionError("conversation_message_unavailable");
        candidate = fragment(text, position.offset, MAX_OPERATION_RESULT_BYTES);
        contentHash = sha256Hex(text);
    }
    const mission = request.missionId
        ? await ctx.db.get(request.missionId)
        : null;
    const buildEntry = (content: string) => ({
        messageId: message._id,
        ...(message.role === "user" &&
        mission?.definitionId === "workbench_v1" &&
        mission.definitionVersion >= 5
            ? { receivedAt: new Date(message.createdAt).toISOString() }
            : {}),
        turnId: message.turnId,
        role: message.role,
        offset: candidate.offset,
        totalCharacters: candidate.totalCharacters,
        content,
    });
    const completeNext: Position | null =
        message._id === frontier.throughMessageId
            ? null
            : {
                  source: "conversation",
                  cursor: page.continueCursor,
                  offset: 0,
              };
    const fitted = fitHistoryContent({
        candidate: candidate.content,
        offset: candidate.offset,
        totalCharacters: candidate.totalCharacters,
        completeNext,
        partialNext: (end) => ({
            source: "conversation",
            cursor: position.cursor,
            offset: end,
        }),
        measure: (content, next) =>
            utf8Bytes(
                pageJson(
                    "conversation",
                    [buildEntry(content)],
                    next,
                    request._id,
                ),
            ),
        maxBytes: MAX_OPERATION_RESULT_BYTES,
    });
    if (fitted.kind === "none") return { resultCapacity: true as const };
    return {
        entry: buildEntry(fitted.content),
        next: fitted.next,
        fragmentId: fragmentIdentity(
            "conversation",
            message._id,
            contentHash,
            candidate.offset,
            fitted.end,
        ),
    };
}

function pageJson(
    source: HistoryPin["source"],
    entries: HistoryEntry[],
    next: Position | null,
    requestId: Id<"agentOperationRequests">,
    state?: Record<string, unknown>,
) {
    const page = {
        entries,
        continueCursor: next ? `${CURSOR_PREFIX}${requestId}` : null,
    };
    return JSON.stringify(
        source === "mission"
            ? { kind: "consult_mission_state", state, history: page }
            : page,
    );
}

/** Typed page generation is the only issuer of continuation positions and fragment receipts. */
export async function readHistoryPage(
    ctx: QueryCtx,
    args: {
        requestId: Id<"agentOperationRequests">;
        expectedGeneration: number;
    },
): Promise<HistoryResult> {
    const request = await ctx.db.get(args.requestId);
    if (
        !request?.missionId ||
        request.status !== "running" ||
        (request.adoptionGeneration ?? request.expectedGeneration) !==
            args.expectedGeneration
    )
        throw executionError("operation_not_dispatched");
    const { mission } = await requireMissionAuthority(
        ctx,
        request.missionId,
        args.expectedGeneration,
    );
    await requireInstructionVersion(ctx, mission, request.instructionVersion);
    const pin = request.pin;
    if (
        pin?.kind !== "history_read" ||
        historySourceFor(request.input.kind) !== pin.source
    )
        throw executionError("history_receipt_invalid");
    const resolved = await resolvePosition(
        ctx,
        mission,
        request,
        pin,
        args.expectedGeneration,
    );
    if (!resolved)
        return { outcome: { kind: "refused", code: "history_cursor_invalid" } };
    const { frontier, position, reference } = resolved;
    const entries: HistoryEntry[] = [];
    const fragmentIds: string[] = [];
    let next: Position | null = null;
    let state: Record<string, unknown> | undefined;
    let restorable = true;
    if (frontier.source === "mission" && position.source === "mission") {
        // Keep room for an immutable history fragment and its continuation envelope.
        const current = await readMissionState(
            ctx,
            {
                missionId: mission._id,
                expectedGeneration: args.expectedGeneration,
            },
            MAX_OPERATION_RESULT_BYTES / 2,
        );
        if (current.kind !== "ready") return { outcome: current };
        state = current.state;
        if (!Number.isSafeInteger(frontier.sequence) || frontier.sequence < 0)
            throw executionError("history_receipt_invalid");
        const referenced = reference ? await ctx.db.get(reference) : null;
        if (
            reference &&
            (!referenced ||
                (referenced.missionId !== mission._id &&
                    !isContextObservation(referenced)) ||
                referenced.runId !== mission.runId ||
                referenced.sequence !== frontier.sequence)
        )
            return {
                outcome: {
                    kind: "refused",
                    code: "history_reference_unavailable",
                },
            };
        if (referenced && referenced.historySourceSequence === undefined)
            restorable = false;
        const events = referenced
            ? [referenced]
            : position.sequence > frontier.sequence
              ? []
              : ctx.db
                    .query("agentExecutionEvents")
                    .withIndex("by_mission_and_history_source", (q) =>
                        q
                            .eq("missionId", mission._id)
                            .gte("historySourceSequence", position.sequence)
                            .lte("historySourceSequence", frontier.sequence),
                    );
        const baseBytesWithNext = utf8Bytes(
            pageJson(pin.source, [], position, request._id, state),
        );
        const baseBytesTerminal = utf8Bytes(
            pageJson(pin.source, [], null, request._id, state),
        );
        const baseBytesFor = (next: Position | null) =>
            next ? baseBytesWithNext : baseBytesTerminal;
        let entriesBytes = 0;
        let offset = position.offset;
        let sourcesRead = 0;
        for await (const event of events) {
            sourcesRead++;
            if (
                event.sequence === undefined ||
                (!reference &&
                    event.sequence !== event.historySourceSequence) ||
                event.runId !== mission.runId
            )
                throw executionError("mission_history_invalid");
            const remainingBytes =
                MAX_OPERATION_RESULT_BYTES -
                baseBytesWithNext -
                entriesBytes -
                (entries.length ? 1 : 0);
            const candidate = await readMissionHistoryEventFragment(
                ctx,
                event,
                offset,
                Math.max(1, remainingBytes),
            );
            const buildEntry = (content: string) => ({
                sequence: event.sequence as number,
                offset,
                totalCharacters: candidate.totalCharacters,
                content,
            });
            const completeNext: Position | null =
                !reference && event.sequence < frontier.sequence
                    ? {
                          source: "mission",
                          sequence: event.sequence + 1,
                          offset: 0,
                      }
                    : null;
            const reachesEnd =
                offset + candidate.content.length === candidate.totalCharacters;
            const entry = buildEntry(candidate.content);
            const entryBytes =
                utf8Bytes(JSON.stringify(entry)) + (entries.length ? 1 : 0);
            const fullFits =
                reachesEnd &&
                baseBytesFor(completeNext) + entriesBytes + entryBytes <=
                    MAX_OPERATION_RESULT_BYTES;
            if (fullFits) {
                entries.push(entry);
                entriesBytes += entryBytes;
                fragmentIds.push(
                    fragmentIdentity(
                        "mission",
                        event._id,
                        candidate.contentHash,
                        offset,
                        candidate.end,
                    ),
                );
                next = completeNext;
                if (sourcesRead >= HISTORY_PAGE_SIZE) break;
                offset = 0;
                continue;
            }
            if (entries.length > 0) {
                next = { source: "mission", sequence: event.sequence, offset };
                break;
            }
            const fitted = fitHistoryContent({
                candidate: candidate.content,
                offset,
                totalCharacters: candidate.totalCharacters,
                completeNext,
                partialNext: (end) => ({
                    source: "mission",
                    sequence: event.sequence as number,
                    offset: end,
                }),
                measure: (content, candidateNext) =>
                    baseBytesFor(candidateNext) +
                    utf8Bytes(JSON.stringify(buildEntry(content))),
                maxBytes: MAX_OPERATION_RESULT_BYTES,
            });
            if (fitted.kind === "none")
                return {
                    outcome: {
                        kind: "unavailable",
                        code: "history_result_capacity",
                    },
                };
            entries.push(buildEntry(fitted.content));
            fragmentIds.push(
                fragmentIdentity(
                    "mission",
                    event._id,
                    candidate.contentHash,
                    offset,
                    fitted.end,
                ),
            );
            next = fitted.next;
            break;
        }
        if (!sourcesRead && position.sequence <= frontier.sequence)
            throw executionError("mission_history_unavailable");
    } else if (
        frontier.source === "conversation" &&
        position.source === "conversation"
    ) {
        const result = await conversationFragment(
            ctx,
            request,
            frontier,
            position,
        );
        if (result && "capacity" in result)
            return {
                outcome: { kind: "unavailable", code: "history_scan_capacity" },
            };
        if (result && "resultCapacity" in result)
            return {
                outcome: {
                    kind: "unavailable",
                    code: "history_result_capacity",
                },
            };
        if (result) {
            entries.push(result.entry);
            fragmentIds.push(result.fragmentId);
            next = result.next;
        }
    } else throw executionError("history_receipt_invalid");
    const valueJson = pageJson(pin.source, entries, next, request._id, state);
    if (utf8Bytes(valueJson) > MAX_OPERATION_RESULT_BYTES)
        return {
            outcome: { kind: "unavailable", code: "history_result_capacity" },
        };
    return {
        outcome: { kind: "success", valueJson },
        historyRead: {
            version: 1,
            source: pin.source,
            runId: mission.runId,
            missionId: mission._id,
            generation: args.expectedGeneration,
            instructionVersion: request.instructionVersion,
            frontier,
            fragmentIds,
            ...(!restorable ? { restorable: false } : {}),
            next,
        },
    };
}

/** Result recording accepts history metadata only for the common issued-read contract. */
export function verifyHistoryReadReceipt(
    request: Doc<"agentOperationRequests">,
    receipt: HistoryReadReceipt,
    generation: number,
    valueJson: string,
) {
    const source = historySourceFor(request.input.kind);
    const pin = request.pin;
    const value: unknown = JSON.parse(valueJson);
    const page =
        value && typeof value === "object" && "history" in value
            ? value.history
            : value;
    if (
        !source ||
        pin?.kind !== "history_read" ||
        pin.source !== source ||
        receipt.source !== source ||
        receipt.frontier.source !== source ||
        receipt.runId !== request.runId ||
        receipt.missionId !== request.missionId ||
        receipt.generation !== generation ||
        receipt.instructionVersion !== request.instructionVersion ||
        (pin.frontier &&
            stableStringify(pin.frontier) !==
                stableStringify(receipt.frontier)) ||
        receipt.fragmentIds.length > HISTORY_PAGE_SIZE ||
        new Set(receipt.fragmentIds).size !== receipt.fragmentIds.length ||
        receipt.fragmentIds.some((id) => !/^[a-f0-9]{64}$/.test(id)) ||
        (receipt.next && !validPosition(receipt.next, source)) ||
        !validate(historyPageValidator, page) ||
        page.entries.length !== receipt.fragmentIds.length ||
        page.entries.some(
            (entry) => (source === "mission") !== "sequence" in entry,
        ) ||
        page.continueCursor !==
            (receipt.next ? `${CURSOR_PREFIX}${request._id}` : null)
    )
        throw executionError("history_receipt_invalid");
    for (const [index, entry] of page.entries.entries()) {
        if (
            !Number.isSafeInteger(entry.offset) ||
            entry.offset < 0 ||
            !Number.isSafeInteger(entry.totalCharacters) ||
            entry.totalCharacters < 0 ||
            entry.offset + entry.content.length > entry.totalCharacters ||
            (entry.totalCharacters > 0 && entry.content.length === 0)
        )
            throw executionError("history_receipt_invalid");
        if (index < page.entries.length - 1) {
            if (entry.offset + entry.content.length !== entry.totalCharacters)
                throw executionError("history_receipt_invalid");
            const nextEntry = page.entries[index + 1];
            if (
                source === "mission" &&
                "sequence" in entry &&
                nextEntry &&
                "sequence" in nextEntry &&
                nextEntry.sequence <= entry.sequence
            )
                throw executionError("history_receipt_invalid");
        }
    }
    const last = page.entries.at(-1);
    if (last) {
        const lastEnd = last.offset + last.content.length;
        const partial = lastEnd < last.totalCharacters;
        if (source === "mission" && "sequence" in last) {
            if (partial) {
                if (
                    receipt.next?.source !== "mission" ||
                    receipt.next.sequence !== last.sequence ||
                    receipt.next.offset !== lastEnd
                )
                    throw executionError("history_receipt_invalid");
            } else if (
                receipt.next &&
                (receipt.next.source !== "mission" ||
                    receipt.next.offset !== 0 ||
                    receipt.next.sequence <= last.sequence ||
                    (receipt.frontier.source === "mission" &&
                        receipt.next.sequence > receipt.frontier.sequence))
            ) {
                throw executionError("history_receipt_invalid");
            }
        } else if (source === "conversation") {
            if (partial) {
                if (
                    receipt.next?.source !== "conversation" ||
                    receipt.next.offset !== lastEnd
                )
                    throw executionError("history_receipt_invalid");
            } else if (
                receipt.next &&
                (receipt.next.source !== "conversation" ||
                    receipt.next.offset !== 0)
            ) {
                throw executionError("history_receipt_invalid");
            }
        }
    }
}

export const read = internalQuery({
    args: {
        requestId: v.id("agentOperationRequests"),
        expectedGeneration: v.number(),
    },
    returns: historyReadResultValidator,
    handler: readHistoryPage,
});
