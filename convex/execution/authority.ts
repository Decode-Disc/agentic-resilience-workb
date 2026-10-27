import type { Doc, Id } from "@convex/_generated/dataModel";
import type { MutationCtx, QueryCtx } from "@convex/_generated/server";
import { runMatchesWorkspace, workspaceForVisitor } from "@convex/runWorkspace";
import { ConvexError } from "convex/values";
import { EXECUTION_VERSION } from "./contracts";

export function executionError(code: string) {
    return new ConvexError({ code });
}

export function executionFailureCode(error: unknown): string | undefined {
    if (
        !(error instanceof ConvexError) ||
        typeof error.data !== "object" ||
        !error.data ||
        !("code" in error.data)
    )
        return undefined;
    return typeof error.data.code === "string" ? error.data.code : undefined;
}

/** Internal callers inherit the persisted run's authority, not a supplied principal or model argument. */
export async function requireRunAuthority(
    ctx: QueryCtx,
    runId: Id<"researchRuns">,
    corpusRevisionId: Id<"corpusRevisions">,
    expectedGeneration: number,
) {
    const run = await ctx.db.get(runId);
    const visitor = run?.ownerVisitorId
        ? await ctx.db.get(run.ownerVisitorId)
        : null;
    const invitation = visitor ? await ctx.db.get(visitor.invitationId) : null;
    if (
        !run ||
        visitor?.status !== "active" ||
        invitation?.status !== "claimed" ||
        invitation.claimedByVisitorId !== visitor._id ||
        run.withdrawnAt !== undefined
    )
        throw executionError("not_authorized");
    if (!runMatchesWorkspace(run, await workspaceForVisitor(ctx, visitor)))
        throw executionError("not_authorized");
    if (
        run.executionGeneration !== expectedGeneration ||
        run.executionStatus !== "running"
    )
        throw executionError("stale_execution");
    const active = await ctx.db
        .query("researchRuns")
        .withIndex("by_owner_and_execution_status", (q) =>
            q
                .eq("ownerVisitorId", visitor._id)
                .eq("executionStatus", "running"),
        )
        .take(2);
    if (active.length !== 1 || active[0]?._id !== runId)
        throw executionError("execution_slot_unavailable");
    const revision = await ctx.db.get(corpusRevisionId);
    if (
        revision?.runId !== runId ||
        revision.status !== "approved" ||
        run.activeCorpusRevisionId !== corpusRevisionId
    )
        throw executionError("corpus_not_approved");
    return { run, revision, visitor };
}

export async function requireMissionAuthority(
    ctx: QueryCtx,
    missionId: Id<"agentMissions">,
    expectedGeneration: number,
) {
    const mission = await ctx.db.get(missionId);
    if (!mission) throw executionError("mission_unavailable");
    const { run, revision, visitor } = await requireRunAuthority(
        ctx,
        mission.runId,
        mission.corpusRevisionId,
        expectedGeneration,
    );
    if (
        mission.ownerVisitorId !== visitor._id ||
        mission.generation !== expectedGeneration
    )
        throw executionError("stale_execution");
    if (mission.definitionVersion !== EXECUTION_VERSION)
        throw executionError("definition_version_conflict");
    if (mission.deadlineAt <= Date.now())
        throw executionError("execution_deadline");
    if (["blocked", "cancelled", "completed"].includes(mission.status))
        throw executionError(mission.blockCode ?? `mission_${mission.status}`);
    return { mission, run, revision };
}

/** The event sequence and its transition commit together, without a second event-sourced state owner. */
export async function recordMissionEvent(
    ctx: MutationCtx,
    mission: Doc<"agentMissions">,
    event: {
        kind: string;
        cause: string;
        invocationId?: Id<"agentInvocations">;
        requestId?: Id<"agentOperationRequests">;
        code?: string;
    },
) {
    const current = await ctx.db.get(mission._id);
    if (!current) throw executionError("mission_unavailable");
    await ctx.db.insert("agentExecutionEvents", {
        ...event,
        missionId: mission._id,
        runId: mission.runId,
        sequence: current.nextEventSequence,
        occurredAt: Date.now(),
    });
    await ctx.db.patch(mission._id, {
        nextEventSequence: current.nextEventSequence + 1,
        updatedAt: Date.now(),
    });
}
