import type { Doc } from "@convex/_generated/dataModel";
import {
    internalMutation,
    internalQuery,
    type QueryCtx,
} from "@convex/_generated/server";
import { readConversationMessages } from "@convex/integrations/agentStorage";
import {
    PI_COMMIT_MAX_BYTES,
    PI_SESSION_MAX_BYTES,
} from "@convex/resourceLimits";
import schema from "@convex/schema";
import {
    paginationOptsValidator,
    paginationResultValidator,
} from "convex/server";
import { type Infer, v } from "convex/values";
import { getAgentDefinition } from "./agentCatalog";
import {
    executionError,
    requireDossierAuthority,
    requireMissionAuthority,
    requireMissionObservationAuthority,
} from "./authority";

const LEASE_MS = 90_000;

/** Resolves the pinned storage owner without moving historical mission journals. */
export async function sessionForMission(
    ctx: QueryCtx,
    mission: Doc<"agentMissions">,
) {
    const turn =
        getAgentDefinition(mission.definitionId, mission.definitionVersion)
            .nativeConversation && mission.conversationTurnId
            ? await ctx.db.get(mission.conversationTurnId)
            : null;
    return turn
        ? ctx.db
              .query("piSessions")
              .withIndex("by_conversation", (q) =>
                  q.eq("conversationId", turn.conversationId),
              )
              .unique()
        : ctx.db
              .query("piSessions")
              .withIndex("by_mission", (q) => q.eq("missionId", mission._id))
              .unique();
}

export function needsNativeSettlement(
    mission: Doc<"agentMissions">,
    session: Doc<"piSessions"> | null,
) {
    return (
        !!session?.conversationId &&
        session.missionId === mission._id &&
        session.settledSequence !== session.sequence
    );
}

const claimArgs = {
    missionId: v.id("agentMissions"),
    expectedGeneration: v.number(),
    writer: v.string(),
};
const leaseValidator = v.object({
    missionId: v.id("agentMissions"),
    sessionId: v.id("piSessions"),
    epoch: v.number(),
    writer: v.string(),
    generation: v.number(),
});
export const claim = internalMutation({
    args: claimArgs,
    returns: leaseValidator,
    handler: async (ctx, args) => {
        const mission = await ctx.db.get(args.missionId);
        if (!mission) throw executionError("mission_unavailable");
        const current = await sessionForMission(ctx, mission);
        if (
            ["completed", "cancelled"].includes(mission.status) &&
            needsNativeSettlement(mission, current)
        )
            await requireDossierAuthority(ctx, mission.runId);
        else
            await requireMissionAuthority(
                ctx,
                args.missionId,
                args.expectedGeneration,
            );
        if (mission.generation !== args.expectedGeneration)
            throw executionError("stale_execution");
        if (!/^[a-zA-Z0-9._:-]{1,120}$/.test(args.writer))
            throw executionError("pi_writer_invalid");
        if (
            current &&
            current.missionId !== mission._id &&
            current.settledSequence !== current.sequence
        )
            throw executionError("pi_previous_unsettled");
        const now = Date.now();
        if (
            current &&
            (current.missionId !== args.missionId ||
                current.generation === args.expectedGeneration) &&
            current.writer !== args.writer &&
            current.leaseUntil > now
        )
            throw executionError("pi_writer_busy");
        const epoch = current
            ? current.epoch +
              (current.writer !== args.writer ||
              current.missionId !== args.missionId ||
              current.generation !== args.expectedGeneration ||
              current.leaseUntil <= now
                  ? 1
                  : 0)
            : 1;
        const fields = {
            missionId: args.missionId,
            ...(getAgentDefinition(
                mission.definitionId,
                mission.definitionVersion,
            ).nativeConversation
                ? { settledSequence: undefined }
                : {}),
            writer: args.writer,
            generation: args.expectedGeneration,
            epoch,
            leaseUntil: now + LEASE_MS,
        };
        const turn =
            getAgentDefinition(mission.definitionId, mission.definitionVersion)
                .nativeConversation && mission.conversationTurnId
                ? await ctx.db.get(mission.conversationTurnId)
                : null;
        const sessionId = current
            ? current._id
            : await ctx.db.insert("piSessions", {
                  ...fields,
                  missionId: args.missionId,
                  sequence: 0,
                  nextId: 2,
                  retainedBytes: 0,
                  ...(turn ? { conversationId: turn.conversationId } : {}),
              });
        if (current) await ctx.db.patch(current._id, fields);
        return {
            missionId: args.missionId,
            sessionId,
            writer: args.writer,
            generation: args.expectedGeneration,
            epoch,
        };
    },
});

async function writer(
    ctx: QueryCtx,
    lease: Infer<typeof leaseValidator>,
    now?: number,
) {
    const session = await ctx.db.get(lease.sessionId);
    const mission = session ? await ctx.db.get(session.missionId) : null;
    if (
        !session ||
        !mission ||
        session.missionId !== lease.missionId ||
        session.writer !== lease.writer ||
        session.epoch !== lease.epoch ||
        session.generation !== lease.generation ||
        mission.generation !== lease.generation ||
        (now !== undefined && session.leaseUntil <= now) ||
        (mission.status === "cancelled" && !session.conversationId)
    )
        throw executionError("pi_writer_fenced");
    if (
        mission.status === "completed" ||
        (mission.status === "cancelled" && session.conversationId)
    )
        await requireDossierAuthority(ctx, mission.runId);
    else
        await requireMissionObservationAuthority(
            ctx,
            session.missionId,
            lease.generation,
        );
    return session;
}

/** Reads only unsynchronized, server-owned exchanges for this fenced native conversation. */
export const pendingControlInputs = internalQuery({
    args: { ...leaseValidator.fields, paginationOpts: paginationOptsValidator },
    returns: v.object({
        cursor: v.union(v.string(), v.null()),
        entries: v.array(
            v.object({
                messageId: v.id("agentMessageDeliveries"),
                confirmationMessageId: v.id("agentMessageDeliveries"),
                command: v.string(),
                text: v.string(),
                createdAt: v.number(),
                confirmedAt: v.number(),
            }),
        ),
    }),
    handler: async (ctx, lease) => {
        const session = await writer(ctx, lease, Date.now());
        if (!session.conversationId)
            throw executionError("native_conversation_required");
        const conversation = await ctx.db.get(session.conversationId);
        if (!conversation) throw executionError("conversation_unavailable");
        if (lease.paginationOpts.numItems > 20)
            throw executionError("native_control_capacity");
        const page = await ctx.db
            .query("agentMessageDeliveries")
            .withIndex("by_run_and_native_control", (q) =>
                q
                    .eq("runId", conversation.runId)
                    .eq("nativeControlStatus", "pending"),
            )
            .paginate(lease.paginationOpts);
        const entries = [];
        for (const message of page.page) {
            const confirmation = message.controlCommand
                ? await ctx.db.get(message.controlCommand.confirmationMessageId)
                : null;
            if (
                message.conversationId !== conversation._id ||
                message.role !== "user" ||
                !message.controlCommand ||
                !confirmation ||
                confirmation.conversationId !== conversation._id ||
                confirmation.role !== "assistant"
            )
                throw executionError("native_control_unavailable");
            const [command, text] = await readConversationMessages(
                ctx,
                conversation.storageRef,
                [message.storageMessageRef, confirmation.storageMessageRef],
            );
            if (command !== message.controlCommand.name || text === undefined)
                throw executionError("native_control_unavailable");
            entries.push({
                messageId: message._id,
                confirmationMessageId: confirmation._id,
                command,
                text,
                createdAt: message.createdAt,
                confirmedAt: confirmation.createdAt,
            });
        }
        return { entries, cursor: page.isDone ? null : page.continueCursor };
    },
});

/** Acknowledgement can be replayed, but only the original live lease may advance it. */
export const recordControlInputs = internalMutation({
    args: {
        ...leaseValidator.fields,
        messageIds: v.array(v.id("agentMessageDeliveries")),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        const session = await writer(ctx, args, Date.now());
        if (args.messageIds.length > 20)
            throw executionError("native_control_capacity");
        for (const id of args.messageIds) {
            const message = await ctx.db.get(id);
            if (
                !message?.controlCommand ||
                message.conversationId !== session.conversationId ||
                !message.nativeControlStatus
            )
                throw executionError("native_control_unavailable");
            await ctx.db.patch(id, { nativeControlStatus: "recorded" });
        }
        return null;
    },
});

export const renew = internalMutation({
    args: leaseValidator.fields,
    returns: v.null(),
    handler: async (ctx, lease) => {
        const session = await writer(ctx, lease, Date.now());
        const mission = await ctx.db.get(session.missionId);
        if (
            !session.conversationId ||
            !mission ||
            !["completed", "cancelled"].includes(mission.status)
        )
            await requireMissionAuthority(
                ctx,
                session.missionId,
                lease.generation,
            );
        await ctx.db.patch(session._id, { leaseUntil: Date.now() + LEASE_MS });
        return null;
    },
});

const appendArgs = {
    ...leaseValidator.fields,
    sequence: v.number(),
    key: v.string(),
    payload: v.string(),
};
export const append = internalMutation({
    args: appendArgs,
    returns: v.number(),
    handler: async (ctx, args) => {
        const session = await writer(ctx, args, Date.now());
        const previous = await ctx.db
            .query("piCommits")
            .withIndex("by_session_and_key", (q) =>
                q.eq("sessionId", session._id).eq("key", args.key),
            )
            .unique();
        if (previous) {
            if (
                previous.sequence !== args.sequence ||
                previous.payload !== args.payload
            )
                throw executionError("pi_commit_conflict");
            return previous.sequence;
        }
        if (
            !Number.isSafeInteger(args.sequence) ||
            args.sequence !== session.sequence + 1
        )
            throw executionError("pi_log_sequence_conflict");
        const bytes = new TextEncoder().encode(args.payload).length;
        if (bytes > PI_COMMIT_MAX_BYTES)
            throw executionError("pi_commit_capacity");
        const retainedBytes = (session.retainedBytes ?? 0) + bytes;
        if (retainedBytes > PI_SESSION_MAX_BYTES)
            throw executionError("pi_storage_capacity");
        const writes: unknown = JSON.parse(args.payload);
        if (!Array.isArray(writes)) throw executionError("pi_commit_invalid");
        let nextId = session.nextId;
        for (const write of writes) {
            if (!write || typeof write !== "object")
                throw executionError("pi_commit_invalid");
            const record =
                "value" in write
                    ? write.value
                    : "record" in write
                      ? write.record
                      : write;
            if (
                !record ||
                typeof record !== "object" ||
                !("id" in record) ||
                typeof record.id !== "number" ||
                !Number.isSafeInteger(record.id) ||
                record.id < 1
            )
                throw executionError("pi_commit_invalid");
            nextId = Math.max(nextId, record.id + 1);
        }
        await ctx.db.insert("piCommits", {
            sessionId: session._id,
            sequence: args.sequence,
            key: args.key,
            payload: args.payload,
        });
        await ctx.db.patch(session._id, {
            sequence: args.sequence,
            nextId,
            retainedBytes,
        });
        return args.sequence;
    },
});

export const mint = internalMutation({
    args: leaseValidator.fields,
    returns: v.number(),
    handler: async (ctx, args) => {
        const session = await writer(ctx, args, Date.now());
        if (!Number.isSafeInteger(session.nextId))
            throw executionError("pi_id_exhausted");
        await ctx.db.patch(session._id, { nextId: session.nextId + 1 });
        return session.nextId;
    },
});

const findArgs = { ...leaseValidator.fields, key: v.string() };
export const find = internalQuery({
    args: findArgs,
    returns: v.union(schema.doc("piCommits"), v.null()),
    handler: async (ctx, args) => {
        await writer(ctx, args);
        return ctx.db
            .query("piCommits")
            .withIndex("by_session_and_key", (q) =>
                q.eq("sessionId", args.sessionId).eq("key", args.key),
            )
            .unique();
    },
});

export const scan = internalQuery({
    args: { ...leaseValidator.fields, paginationOpts: paginationOptsValidator },
    returns: paginationResultValidator(schema.doc("piCommits")),
    handler: async (ctx, args) => {
        await writer(ctx, args);
        return ctx.db
            .query("piCommits")
            .withIndex("by_session_and_sequence", (q) =>
                q.eq("sessionId", args.sessionId),
            )
            .paginate(args.paginationOpts);
    },
});
