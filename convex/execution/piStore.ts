import { internal } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import {
    internalMutation,
    internalQuery,
    type QueryCtx,
} from "@convex/_generated/server";
import {
    nativeInputBody,
    retainedDeliveryBody,
} from "@convex/integrations/agentStorage";
import {
    CONVERSATION_PREVIEW_MAX_BYTES,
    PI_SESSION_LEASE_MS as LEASE_MS,
    PI_COMMIT_MAX_BYTES,
    PI_SESSION_MAX_BYTES,
} from "@convex/resourcePolicy";
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
import { buildMissionContext } from "./context";
import { missionConversationMigrationFrozen } from "./conversations";
import { contextObservationSequence, latestNativeControl } from "./journal";
import {
    completeRetainedText,
    retainedTextFragment,
    stageRetainedText,
    textFragmentValidator,
    textManifestValidator,
} from "./retainedText";
import { nativeInputBodyValidator, nativeInputsValidator } from "./schema";

/** Resolves the pinned storage owner without moving historical mission journals. */
export async function sessionForMission(
    ctx: QueryCtx,
    mission: Doc<"agentMissions">,
) {
    const owned = await ctx.db
        .query("piSessions")
        .withIndex("by_mission", (q) => q.eq("missionId", mission._id))
        .unique();
    if (owned || !mission.conversationTurnId) return owned;
    const turn = await ctx.db.get(mission.conversationTurnId);
    return turn
        ? ctx.db
              .query("piSessions")
              .withIndex("by_conversation", (q) =>
                  q.eq("conversationId", turn.conversationId),
              )
              .unique()
        : null;
}

export function tracksNativeSettlement(
    mission: Doc<"agentMissions">,
    session: Doc<"piSessions"> | null,
) {
    if (!session || session.missionId !== mission._id) return false;
    if (session.conversationId) return true;
    return (
        getAgentDefinition(mission.definitionId, mission.definitionVersion)
            .completionTransport === "native_tool"
    );
}

export function needsNativeSettlement(
    mission: Doc<"agentMissions">,
    session: Doc<"piSessions"> | null,
) {
    if (!session || !tracksNativeSettlement(mission, session)) return false;
    if (session.settledSequence === session.sequence) return false;
    return session.conversationId
        ? ["completed", "cancelled"].includes(mission.status)
        : mission.status === "completed";
}

const claimArgs = {
    missionId: v.id("agentMissions"),
    expectedGeneration: v.number(),
    writer: v.string(),
};
export const piLeaseValidator = v.object({
    missionId: v.id("agentMissions"),
    sessionId: v.id("piSessions"),
    epoch: v.number(),
    writer: v.string(),
    generation: v.number(),
});
const leaseValidator = piLeaseValidator;
export const claim = internalMutation({
    args: claimArgs,
    returns: leaseValidator,
    handler: async (ctx, args) => {
        const mission = await ctx.db.get(args.missionId);
        if (!mission) throw executionError("mission_unavailable");
        const current = await sessionForMission(ctx, mission);
        if (
            await missionConversationMigrationFrozen(
                ctx,
                mission,
                current?.conversationId,
            )
        )
            throw executionError("conversation_migration_frozen");
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
        if ((current?.retainedBytes ?? 0) > PI_SESSION_MAX_BYTES)
            throw executionError("pi_storage_capacity");
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
        const definition = getAgentDefinition(
            mission.definitionId,
            mission.definitionVersion,
        );
        const fields = {
            missionId: args.missionId,
            ...(definition.nativeConversation ||
            definition.completionTransport === "native_tool"
                ? { settledSequence: undefined }
                : {}),
            writer: args.writer,
            generation: args.expectedGeneration,
            epoch,
            leaseUntil: now + LEASE_MS,
        };
        const turn =
            definition.nativeConversation && mission.conversationTurnId
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
                  observationSequence: await contextObservationSequence(
                      ctx,
                      mission.runId,
                  ),
                  ...(turn ? { conversationId: turn.conversationId } : {}),
              });
        if (current) {
            if (
                current.publicPreview &&
                current.publicPreview.turnId !== mission.conversationTurnId
            ) {
                const previousTurn = await ctx.db.get(
                    current.publicPreview.turnId,
                );
                if (
                    previousTurn &&
                    !previousTurn.publishedMessageId &&
                    current.publicPreview.instructionVersion ===
                        previousTurn.instructionVersion
                ) {
                    const { turnId: _turn, ...preview } = current.publicPreview;
                    await ctx.db.patch(previousTurn._id, { preview });
                }
            }
            await ctx.db.patch(current._id, fields);
        }
        return {
            missionId: args.missionId,
            sessionId,
            writer: args.writer,
            generation: args.expectedGeneration,
            epoch,
        };
    },
});

export async function requirePiWriter(
    ctx: QueryCtx,
    lease: Infer<typeof leaseValidator>,
    now?: number,
) {
    return writer(ctx, lease, now);
}

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
        await missionConversationMigrationFrozen(
            ctx,
            mission,
            session.conversationId,
        )
    )
        throw executionError("conversation_migration_frozen");
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

async function controlConfirmation(
    ctx: QueryCtx,
    conversationId: Id<"agentConversations">,
    message: Doc<"agentMessageDeliveries">,
) {
    const confirmationId =
        message.controlCommand?.confirmationMessageId ??
        message.approvalDecision?.confirmationMessageId;
    const confirmation = confirmationId
        ? await ctx.db.get(confirmationId)
        : null;
    if (
        message.conversationId !== conversationId ||
        message.role !== "user" ||
        (message.controlCommand && message.approvalDecision) ||
        !confirmation ||
        confirmation.runId !== message.runId ||
        confirmation.conversationId !== conversationId ||
        confirmation.role !== "assistant"
    )
        throw executionError("native_control_unavailable");
    return confirmation;
}

/** Reads only unsynchronized, server-owned exchanges for this fenced native conversation. */
export const pendingControlInputs = internalQuery({
    args: {
        ...leaseValidator.fields,
        paginationOpts: paginationOptsValidator,
        throughCreationTime: v.optional(v.number()),
    },
    returns: v.object({
        cursor: v.union(v.string(), v.null()),
        entries: v.array(
            v.object({
                messageId: v.id("agentMessageDeliveries"),
                nativeInputSequence: v.number(),
                confirmationMessageId: v.id("agentMessageDeliveries"),
                command: nativeInputBodyValidator,
                confirmation: nativeInputBodyValidator,
                expectedCommand: v.optional(v.string()),
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
            .withIndex("by_run_and_native_control", (q) => {
                const pending = q
                    .eq("runId", conversation.runId)
                    .eq("nativeControlStatus", "pending");
                return lease.throughCreationTime === undefined
                    ? pending
                    : pending.lte("_creationTime", lease.throughCreationTime);
            })
            .paginate(lease.paginationOpts);
        const entries = [];
        for (const message of page.page) {
            const confirmation = await controlConfirmation(
                ctx,
                conversation._id,
                message,
            );
            entries.push({
                messageId: message._id,
                nativeInputSequence: message.nativeInputSequence ?? 0,
                confirmationMessageId: confirmation._id,
                command: await nativeInputBody(ctx, conversation, message),
                confirmation: await nativeInputBody(
                    ctx,
                    conversation,
                    confirmation,
                ),
                expectedCommand: message.controlCommand?.name,
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
                !message ||
                (!message.controlCommand && !message.approvalDecision) ||
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
        if (!mission || !needsNativeSettlement(mission, session))
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

/** A replaceable public view of committed native prose; it never publishes a response or executes tools. */
export const publishPreview = internalMutation({
    args: {
        ...leaseValidator.fields,
        invocationId: v.id("agentInvocations"),
        sequence: v.number(),
        text: v.string(),
    },
    returns: v.boolean(),
    handler: async (ctx, args) => {
        const session = await writer(ctx, args, Date.now());
        const invocation = await ctx.db.get(args.invocationId);
        const mission = await ctx.db.get(args.missionId);
        const turn = mission?.conversationTurnId
            ? await ctx.db.get(mission.conversationTurnId)
            : null;
        if (
            !turn ||
            !invocation ||
            invocation.missionId !== mission?._id ||
            invocation.purpose ||
            turn.status !== "active" ||
            invocation.instructionVersion !== turn.instructionVersion ||
            mission?.lastInvocationId !== invocation._id ||
            args.sequence > session.sequence ||
            (session.publicPreview?.invocationId === invocation._id &&
                session.publicPreview.sequence >= args.sequence)
        )
            return false;
        const previewBytes = new TextEncoder().encode(args.text);
        const previewText = new TextDecoder("utf-8", {
            ignoreBOM: true,
        }).decode(previewBytes.subarray(0, CONVERSATION_PREVIEW_MAX_BYTES), {
            stream: true,
        });
        await ctx.db.patch(session._id, {
            publicPreview: {
                turnId: turn._id,
                invocationId: invocation._id,
                instructionVersion: turn.instructionVersion,
                sequence: args.sequence,
                text: previewText,
            },
        });
        return true;
    },
});
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

/** Staging remains fenced; no logical commit is visible until publication. */
export const stageCommit = internalMutation({
    args: {
        ...leaseValidator.fields,
        key: v.string(),
        fragment: textFragmentValidator,
    },
    returns: v.id("retainedTexts"),
    handler: async (ctx, args) => {
        const session = await writer(ctx, args, Date.now());
        const key = `${session._id}:${args.key}`;
        const previous = await ctx.db
            .query("retainedTexts")
            .withIndex("by_key", (q) => q.eq("key", key))
            .unique();
        const addedBytes =
            args.fragment.index < (previous?.received ?? 0)
                ? 0
                : new TextEncoder().encode(args.fragment.content).length;
        const retainedBytes = (session.retainedBytes ?? 0) + addedBytes;
        if (
            args.fragment.sizeBytes > PI_SESSION_MAX_BYTES ||
            retainedBytes > PI_SESSION_MAX_BYTES
        )
            throw executionError("pi_storage_capacity");
        const textId = await stageRetainedText(ctx, key, args.fragment);
        if (addedBytes) await ctx.db.patch(session._id, { retainedBytes });
        return textId;
    },
});

export const publishCommit = internalMutation({
    args: {
        ...leaseValidator.fields,
        key: v.string(),
        sequence: v.number(),
        textId: v.id("retainedTexts"),
        nextId: v.number(),
    },
    returns: v.number(),
    handler: async (ctx, args) => {
        const session = await writer(ctx, args, Date.now());
        const text = await completeRetainedText(ctx, args.textId);
        if (
            text.key !== `${session._id}:${args.key}` ||
            !Number.isSafeInteger(args.nextId) ||
            args.nextId < 2
        )
            throw executionError("pi_commit_invalid");
        const previous = await ctx.db
            .query("piCommits")
            .withIndex("by_session_and_key", (q) =>
                q.eq("sessionId", session._id).eq("key", args.key),
            )
            .unique();
        if (previous) {
            if (
                previous.sequence !== args.sequence ||
                previous.textId !== args.textId
            )
                throw executionError("pi_commit_conflict");
            return previous.sequence;
        }
        if (
            !Number.isSafeInteger(args.sequence) ||
            args.sequence !== session.sequence + 1
        )
            throw executionError("pi_log_sequence_conflict");
        const retainedBytes = session.retainedBytes ?? 0;
        if (retainedBytes > PI_SESSION_MAX_BYTES)
            throw executionError("pi_storage_capacity");
        await ctx.db.insert("piCommits", {
            sessionId: session._id,
            key: args.key,
            sequence: args.sequence,
            textId: args.textId,
        });
        await ctx.db.patch(session._id, {
            sequence: args.sequence,
            retainedBytes,
            nextId: Math.max(args.nextId, session.nextId),
        });
        return args.sequence;
    },
});

export const readCommitFragment = internalQuery({
    args: {
        ...leaseValidator.fields,
        textId: v.id("retainedTexts"),
        index: v.number(),
    },
    returns: v.object({ content: v.string(), manifest: textManifestValidator }),
    handler: async (ctx, args) => {
        await writer(ctx, args);
        const text = await completeRetainedText(ctx, args.textId);
        if (!text.key.startsWith(`${args.sessionId}:`))
            throw executionError("pi_commit_invalid");
        return {
            content: await retainedTextFragment(ctx, text, args.index),
            manifest: {
                contentHash: text.contentHash,
                sizeBytes: text.sizeBytes,
                characters: text.characters,
                fragmentHashes: text.fragmentHashes,
            },
        };
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

/** Rechecks writer and message ownership for each native input fragment. */
export const nativeInputFragment = internalQuery({
    args: {
        ...leaseValidator.fields,
        messageId: v.id("agentMessageDeliveries"),
        contentHash: v.string(),
        controlMessageId: v.optional(v.id("agentMessageDeliveries")),
        index: v.number(),
    },
    returns: v.object({
        content: v.string(),
        fragmentCount: v.number(),
        characters: v.number(),
        sizeBytes: v.number(),
    }),
    handler: async (ctx, args) => {
        const session = await writer(ctx, args, Date.now());
        const mission = await ctx.db.get(session.missionId);
        const delivery = await ctx.db.get(args.messageId);
        if (
            !mission ||
            !delivery ||
            !session.conversationId ||
            delivery.runId !== mission.runId ||
            delivery.conversationId !== session.conversationId
        )
            throw executionError("native_input_unavailable");
        if (args.controlMessageId) {
            const command =
                args.controlMessageId === delivery._id
                    ? delivery
                    : await ctx.db.get(args.controlMessageId);
            if (
                !command ||
                command.runId !== mission.runId ||
                !command.nativeControlStatus
            )
                throw executionError("native_control_unavailable");
            const confirmation = await controlConfirmation(
                ctx,
                session.conversationId,
                command,
            );
            if (
                delivery._id !== command._id &&
                delivery._id !== confirmation._id
            )
                throw executionError("native_control_unavailable");
        } else if (
            !mission.conversationTurnId ||
            delivery.turnId !== mission.conversationTurnId ||
            delivery.role !== "user"
        )
            throw executionError("native_input_unavailable");
        const body = await retainedDeliveryBody(ctx, delivery);
        if (body.contentHash !== args.contentHash)
            throw executionError("native_input_unavailable");
        return {
            content: await retainedTextFragment(ctx, body, args.index),
            fragmentCount: body.fragmentHashes.length,
            characters: body.characters,
            sizeBytes: body.sizeBytes,
        };
    },
});

/** Pins admitted inputs and both record frontiers in one transaction, including a truthful legacy anchor. */
export const inputSnapshot = internalMutation({
    args: leaseValidator.fields,
    returns: v.object({
        inputs: nativeInputsValidator,
        acknowledged: v.union(v.number(), v.null()),
        throughSequence: v.number(),
        controlsThroughCreationTime: v.number(),
        anchor: v.union(v.string(), v.null()),
    }),
    handler: async (ctx, args) => {
        const session = await writer(ctx, args, Date.now());
        const mission = await ctx.db.get(session.missionId);
        if (!mission) throw executionError("mission_unavailable");
        const inputs: Infer<typeof nativeInputsValidator> =
            session.conversationId
                ? await ctx.runMutation(
                      internal.execution.piControl.admittedInputs,
                      {
                          missionId: mission._id,
                          expectedGeneration: args.generation,
                      },
                  )
                : [];
        const lastControl = session.conversationId
            ? await ctx.db
                  .query("agentMessageDeliveries")
                  .withIndex("by_run_and_native_control", (q) =>
                      q
                          .eq("runId", mission.runId)
                          .eq("nativeControlStatus", "pending"),
                  )
                  .order("desc")
                  .first()
            : null;
        const throughSequence = await contextObservationSequence(
            ctx,
            mission.runId,
        );
        let anchor: string | null = null;
        if (
            session.observationSequence === undefined &&
            !["completed", "cancelled"].includes(mission.status)
        ) {
            const current = await buildMissionContext(
                ctx,
                mission._id,
                args.generation,
                true,
            );
            if (current.kind !== "ready") throw executionError(current.code);
            const input = JSON.parse(current.inputJson);
            anchor = JSON.stringify({
                version: 1,
                topic: "current_state",
                historicalSequenceUnknown: true,
                domain: input.domain,
                activeWork: input.activeWork,
            });
        }
        return {
            inputs,
            acknowledged: session.observationSequence ?? null,
            throughSequence,
            controlsThroughCreationTime: lastControl?._creationTime ?? 0,
            anchor,
        };
    },
});

/** Returns the observation frontier and, when requested, the next retained observation identity. */
export const pendingObservations = internalQuery({
    args: {
        ...leaseValidator.fields,
        after: v.optional(v.number()),
        through: v.optional(v.number()),
    },
    returns: v.object({
        acknowledged: v.union(v.number(), v.null()),
        acknowledgedEntry: v.union(v.number(), v.null()),
        throughSequence: v.number(),
        entries: v.array(
            v.object({
                eventId: v.id("agentExecutionEvents"),
                sequence: v.number(),
                topic: schema.tables.agentExecutionEvents.validator.fields
                    .contextObservation.fields.topic,
                actor: schema.tables.agentExecutionEvents.validator.fields
                    .actor,
                contentHash: v.string(),
                sizeBytes: v.number(),
                characters: v.number(),
                fragmentCount: v.number(),
                occurredAt: v.number(),
            }),
        ),
    }),
    handler: async (ctx, args) => {
        const session = await writer(ctx, args, Date.now());
        const mission = await ctx.db.get(session.missionId);
        if (!mission) throw executionError("mission_unavailable");
        const latest = await contextObservationSequence(ctx, mission.runId);
        const throughSequence = args.through ?? latest;
        if (
            !Number.isSafeInteger(throughSequence) ||
            throughSequence < 0 ||
            throughSequence > latest ||
            (args.after !== undefined &&
                (!Number.isSafeInteger(args.after) || args.after < 0))
        )
            throw executionError("native_observation_invalid");
        const after = args.after;
        const event =
            after === undefined || after >= throughSequence
                ? null
                : await ctx.db
                      .query("agentExecutionEvents")
                      .withIndex("by_run_and_native_input_sequence", (q) =>
                          q
                              .eq("runId", mission.runId)
                              .gt("nativeInputSequence", after)
                              .lte("nativeInputSequence", throughSequence),
                      )
                      .first();
        const entries = [];
        if (event) {
            if (
                !event.contextObservation ||
                event.nativeInputSequence === undefined
            )
                throw executionError("journal_payload_invalid");
            const text = await completeRetainedText(
                ctx,
                event.contextObservation.textId,
            );
            entries.push({
                eventId: event._id,
                sequence: event.nativeInputSequence,
                occurredAt: event.occurredAt,
                topic: event.contextObservation.topic,
                actor: event.actor,
                contentHash: text.contentHash,
                sizeBytes: text.sizeBytes,
                characters: text.characters,
                fragmentCount: text.fragmentHashes.length,
            });
        }
        return {
            acknowledged: session.observationSequence ?? null,
            acknowledgedEntry: session.observationEntry ?? null,
            throughSequence,
            entries,
        };
    },
});

/** Fragment reads recheck the active writer and resolve text through the event's owning run. */
export const readObservationFragment = internalQuery({
    args: {
        ...leaseValidator.fields,
        eventId: v.id("agentExecutionEvents"),
        expectedHash: v.string(),
        index: v.number(),
    },
    returns: v.string(),
    handler: async (ctx, args) => {
        const session = await writer(ctx, args, Date.now());
        const mission = await ctx.db.get(session.missionId);
        const event = await ctx.db.get(args.eventId);
        if (
            !mission ||
            !event?.contextObservation ||
            event.nativeInputSequence === undefined ||
            event.runId !== mission.runId
        )
            throw executionError("native_observation_invalid");
        const text = await completeRetainedText(
            ctx,
            event.contextObservation.textId,
        );
        if (text.contentHash !== args.expectedHash)
            throw executionError("native_observation_invalid");
        return retainedTextFragment(ctx, text, args.index);
    },
});

/** Cursor acknowledgement follows durable Pi placement and cannot jump over an unseen observation. */
export const recordObservationInput = internalMutation({
    args: {
        ...leaseValidator.fields,
        sequence: v.number(),
        entryId: v.number(),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        const session = await writer(ctx, args, Date.now());
        if (
            !Number.isSafeInteger(args.sequence) ||
            args.sequence < 0 ||
            !Number.isSafeInteger(args.entryId) ||
            args.entryId < 1
        )
            throw executionError("native_observation_invalid");
        if (
            session.observationSequence !== undefined &&
            args.sequence <= session.observationSequence
        )
            return null;
        const mission = await ctx.db.get(session.missionId);
        if (!mission) throw executionError("mission_unavailable");
        if (
            args.sequence >
            (await contextObservationSequence(ctx, mission.runId))
        )
            throw executionError("native_observation_invalid");
        if (session.observationSequence !== undefined) {
            const next = await ctx.db
                .query("agentExecutionEvents")
                .withIndex("by_run_and_native_input_sequence", (q) =>
                    q
                        .eq("runId", mission.runId)
                        .gt("nativeInputSequence", session.observationSequence),
                )
                .first();
            if (next?.nativeInputSequence !== args.sequence)
                throw executionError("native_observation_gap");
        }
        await ctx.db.patch(session._id, {
            observationSequence: args.sequence,
            observationEntry: args.entryId,
        });
        return null;
    },
});

/** A command receipt must be placed in the same durable context as the active analyst inputs. */
export const controlFrontier = internalQuery({
    args: leaseValidator.fields,
    returns: v.union(
        v.object({
            messageId: v.id("agentMessageDeliveries"),
            sequence: v.number(),
        }),
        v.null(),
    ),
    handler: async (ctx, args) => {
        const session = await writer(ctx, args, Date.now());
        const mission = await ctx.db.get(session.missionId);
        if (!mission) throw executionError("mission_unavailable");
        const command = await latestNativeControl(ctx, mission.runId);
        return command
            ? {
                  messageId: command._id,
                  sequence: command.nativeInputSequence ?? 0,
              }
            : null;
    },
});
