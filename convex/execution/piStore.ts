import {
    internalMutation,
    internalQuery,
    type QueryCtx,
} from "@convex/_generated/server";
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
import {
    executionError,
    requireDossierAuthority,
    requireMissionAuthority,
    requireMissionObservationAuthority,
} from "./authority";

const LEASE_MS = 90_000;

const claimArgs = {
    missionId: v.id("agentMissions"),
    expectedGeneration: v.number(),
    writer: v.string(),
};
const leaseValidator = v.object({
    sessionId: v.id("piSessions"),
    epoch: v.number(),
    writer: v.string(),
    generation: v.number(),
});
export const claim = internalMutation({
    args: claimArgs,
    returns: leaseValidator,
    handler: async (ctx, args) => {
        await requireMissionAuthority(
            ctx,
            args.missionId,
            args.expectedGeneration,
        );
        if (!/^[a-zA-Z0-9._:-]{1,120}$/.test(args.writer))
            throw executionError("pi_writer_invalid");
        const current = await ctx.db
            .query("piSessions")
            .withIndex("by_mission", (q) => q.eq("missionId", args.missionId))
            .unique();
        const now = Date.now();
        if (
            current &&
            current.generation === args.expectedGeneration &&
            current.writer !== args.writer &&
            current.leaseUntil > now
        )
            throw executionError("pi_writer_busy");
        const epoch = current
            ? current.epoch +
              (current.writer !== args.writer ||
              current.generation !== args.expectedGeneration ||
              current.leaseUntil <= now
                  ? 1
                  : 0)
            : 1;
        const fields = {
            writer: args.writer,
            generation: args.expectedGeneration,
            epoch,
            leaseUntil: now + LEASE_MS,
        };
        const sessionId = current
            ? current._id
            : await ctx.db.insert("piSessions", {
                  ...fields,
                  missionId: args.missionId,
                  sequence: 0,
                  nextId: 2,
                  retainedBytes: 0,
              });
        if (current) await ctx.db.patch(current._id, fields);
        return {
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
        session.writer !== lease.writer ||
        session.epoch !== lease.epoch ||
        session.generation !== lease.generation ||
        mission.generation !== lease.generation ||
        (now !== undefined && session.leaseUntil <= now) ||
        mission.status === "cancelled"
    )
        throw executionError("pi_writer_fenced");
    if (mission.status === "completed")
        await requireDossierAuthority(ctx, mission.runId);
    else
        await requireMissionObservationAuthority(
            ctx,
            session.missionId,
            lease.generation,
        );
    return session;
}

export const renew = internalMutation({
    args: leaseValidator.fields,
    returns: v.null(),
    handler: async (ctx, lease) => {
        const session = await writer(ctx, lease, Date.now());
        await requireMissionAuthority(ctx, session.missionId, lease.generation);
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
