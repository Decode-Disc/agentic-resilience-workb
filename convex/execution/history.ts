import type { Doc, Id } from "@convex/_generated/dataModel";
import {
    internalQuery,
    type MutationCtx,
    type QueryCtx,
} from "@convex/_generated/server";
import { sha256Hex, stableStringify } from "@convex/domain/sourcePassages";
import { readConversationMessages } from "@convex/integrations/agentStorage";
import { type Infer, v } from "convex/values";
import { validate } from "convex-helpers/validators";
import { requireMissionAuthority } from "./authority";
import { requireInstructionVersion } from "./conversations";
import { executionError } from "./errors";
import {
    type AgentOperationDefinition,
    HISTORY_PAGE_SIZE,
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

const MAX_HISTORY_RESULT_BYTES = 48 * 1024;
const MAX_CONVERSATION_SCAN = 4096;
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
    if ("reference" in input && input.reference !== undefined) {
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
    if ("cursor" in input && input.cursor !== undefined)
        return { kind: "available", pin: { kind: "history_read", source } };
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

async function resolvePosition(
    ctx: QueryCtx,
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
    if (!cursor.startsWith(CURSOR_PREFIX) || cursor.length > 160) return null;
    const id = ctx.db.normalizeId(
        "agentOperationRequests",
        cursor.slice(CURSOR_PREFIX.length),
    );
    const previous = id ? await ctx.db.get(id) : null;
    if (
        previous?.status !== "completed" ||
        previous.outcome?.kind !== "success" ||
        previous.adoptedAt === undefined ||
        previous.operationVersion < 2 ||
        historySourceFor(previous.input.kind) !== pin.source ||
        previous.missionId !== request.missionId ||
        previous.runId !== request.runId
    )
        return null;
    const receipt = previous.historyRead;
    if (
        !receipt ||
        !validate(historyReadReceiptValidator, receipt, { db: ctx.db }) ||
        receipt.source !== pin.source ||
        receipt.frontier.source !== pin.source ||
        receipt.runId !== previous.runId ||
        receipt.missionId !== previous.missionId
    )
        throw executionError("history_receipt_invalid");
    verifyHistoryReadReceipt(
        previous,
        receipt,
        receipt.generation,
        previous.outcome.valueJson,
    );
    if (
        receipt.generation !== generation ||
        receipt.instructionVersion !== request.instructionVersion ||
        !receipt.next
    )
        return null;
    if (!validPosition(receipt.next, pin.source))
        throw executionError("history_receipt_invalid");
    return {
        frontier: receipt.frontier,
        position: receipt.next,
        ...(previous.pin?.kind === "history_read" && previous.pin.reference
            ? { reference: previous.pin.reference }
            : {}),
    };
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
            maximumBytesRead: 512 * 1024,
        });
    const message = page.page[0];
    if (!message) {
        if (!page.isDone) return { capacity: true as const };
        throw executionError("conversation_message_unavailable");
    }
    if (message.conversationId !== conversation._id)
        throw executionError("conversation_message_unavailable");
    const [text] = await readConversationMessages(
        ctx,
        conversation.storageRef,
        [message.storageMessageRef],
    );
    if (!text) throw executionError("conversation_message_unavailable");
    const chunk = fragment(text, position.offset, 8192);
    const next: Position | null =
        chunk.end < text.length
            ? {
                  source: "conversation",
                  cursor: position.cursor,
                  offset: chunk.end,
              }
            : message._id === frontier.throughMessageId
              ? null
              : {
                    source: "conversation",
                    cursor: page.continueCursor,
                    offset: 0,
                };
    const entry = {
        messageId: message._id,
        turnId: message.turnId,
        role: message.role,
        offset: chunk.offset,
        totalCharacters: chunk.totalCharacters,
        content: chunk.content,
    };
    return {
        entry,
        next,
        fragmentId: fragmentIdentity(
            "conversation",
            message._id,
            sha256Hex(text),
            chunk.offset,
            chunk.end,
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
            MAX_HISTORY_RESULT_BYTES / 2,
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
            const chunk = await readMissionHistoryEventFragment(
                ctx,
                event,
                offset,
                4000,
            );
            const entry = {
                sequence: event.sequence,
                offset,
                totalCharacters: chunk.totalCharacters,
                content: chunk.content,
            };
            const continuation: Position | null =
                chunk.end < chunk.totalCharacters
                    ? {
                          source: "mission",
                          sequence: event.sequence,
                          offset: chunk.end,
                      }
                    : event.sequence < frontier.sequence
                      ? {
                            source: "mission",
                            sequence: event.sequence + 1,
                            offset: 0,
                        }
                      : null;
            if (
                new TextEncoder().encode(
                    pageJson(
                        pin.source,
                        [...entries, entry],
                        continuation,
                        request._id,
                        state,
                    ),
                ).length > MAX_HISTORY_RESULT_BYTES
            ) {
                if (!entries.length)
                    return {
                        outcome: {
                            kind: "unavailable",
                            code: "history_result_capacity",
                        },
                    };
                next = { source: "mission", sequence: event.sequence, offset };
                break;
            }
            entries.push(entry);
            fragmentIds.push(
                fragmentIdentity(
                    "mission",
                    event._id,
                    chunk.contentHash,
                    offset,
                    chunk.end,
                ),
            );
            next = continuation;
            if (
                chunk.end < chunk.totalCharacters ||
                sourcesRead >= HISTORY_PAGE_SIZE
            )
                break;
            offset = 0;
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
        if (result) {
            entries.push(result.entry);
            fragmentIds.push(result.fragmentId);
            next = result.next;
        }
    } else throw executionError("history_receipt_invalid");
    const valueJson = pageJson(pin.source, entries, next, request._id, state);
    if (new TextEncoder().encode(valueJson).length > MAX_HISTORY_RESULT_BYTES)
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
}

export const read = internalQuery({
    args: {
        requestId: v.id("agentOperationRequests"),
        expectedGeneration: v.number(),
    },
    returns: historyReadResultValidator,
    handler: readHistoryPage,
});
