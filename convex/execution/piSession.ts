import type { Doc } from "@convex/_generated/dataModel";
import type { QueryCtx } from "@convex/_generated/server";
import { type Infer, v } from "convex/values";
import { getAgentAuthority } from "./agentAuthorityCatalog";
import {
    executionError,
    requireDossierAuthority,
    requireMissionObservationAuthority,
} from "./authority";

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
        getAgentAuthority(mission.definitionId, mission.definitionVersion)
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

/** Minimal writer identity for mutations whose mission and generation are already bound. */
export const piDispatchLeaseValidator = v.object({
    sessionId: v.id("piSessions"),
    writer: v.string(),
    epoch: v.number(),
});
export type PiDispatchLease = Infer<typeof piDispatchLeaseValidator>;

export async function requirePiDispatchLease(
    ctx: QueryCtx,
    mission: Doc<"agentMissions">,
    expectedGeneration: number,
    lease: PiDispatchLease | undefined,
) {
    if (mission.executionRuntime !== "pi-durable") return;
    const session = lease ? await ctx.db.get(lease.sessionId) : null;
    if (
        !lease ||
        !session ||
        session.missionId !== mission._id ||
        session.generation !== expectedGeneration ||
        session.writer !== lease.writer ||
        session.epoch !== lease.epoch ||
        session.leaseUntil <= Date.now()
    )
        throw executionError("pi_writer_fenced");
}

export const piLeaseValidator = v.object({
    missionId: v.id("agentMissions"),
    ...piDispatchLeaseValidator.fields,
    generation: v.number(),
});

export async function requirePiWriter(
    ctx: QueryCtx,
    lease: Infer<typeof piLeaseValidator>,
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
