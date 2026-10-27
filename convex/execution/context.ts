import type { Id } from "@convex/_generated/dataModel";
import { internalQuery, type QueryCtx } from "@convex/_generated/server";
import { v } from "convex/values";
import { validate } from "convex-helpers/validators";
import { executionError, requireMissionAuthority } from "./authority";
import {
    invocationResponseValidator,
    MAX_BATCH_REQUESTS,
    MAX_CONTEXT_BYTES,
} from "./contracts";
import { getAgentDefinition } from "./definitions";

/** Required context is assembled from retained authority and work, never from an optional memory-saving tool. */
export async function buildMissionContext(
    ctx: QueryCtx,
    missionId: Id<"agentMissions">,
    expectedGeneration: number,
) {
    const { mission, run, revision } = await requireMissionAuthority(
        ctx,
        missionId,
        expectedGeneration,
    );
    const definition = getAgentDefinition(
        mission.definitionId,
        mission.definitionVersion,
    );
    const domainContext = await definition.context(ctx, mission, run, revision);
    if (domainContext.kind === "blocked") return domainContext;
    const previousInvocation = mission.lastInvocationId
        ? await ctx.db.get(mission.lastInvocationId)
        : null;
    const previousResponse: unknown = previousInvocation?.outputJson
        ? JSON.parse(previousInvocation.outputJson)
        : null;
    const previousRequests =
        validate(invocationResponseValidator, previousResponse) &&
        previousResponse.kind === "operations"
            ? previousResponse.requests
            : [];
    const triggeringRequests = [];
    if (previousInvocation?.requestIds) {
        if (previousInvocation.requestIds.length > MAX_BATCH_REQUESTS)
            throw executionError("continuation_capacity");
        for (const [
            index,
            requestId,
        ] of previousInvocation.requestIds.entries()) {
            const request = await ctx.db.get(requestId);
            if (!request || request.missionId !== missionId)
                throw executionError("continuation_request_unavailable");
            triggeringRequests.push({
                request,
                callId: previousRequests[index]?.callId,
            });
        }
    } else {
        const latest = await ctx.db
            .query("agentOperationRequests")
            .withIndex("by_mission", (q) => q.eq("missionId", missionId))
            .order("desc")
            .take(MAX_BATCH_REQUESTS);
        for (const request of latest.reverse())
            triggeringRequests.push({ request, callId: undefined });
    }
    const pending = await ctx.db
        .query("agentOperationRequests")
        .withIndex("by_mission_and_status", (q) =>
            q.eq("missionId", missionId).eq("status", "pending"),
        )
        .take(5);
    const inputJson = JSON.stringify({
        version: mission.definitionVersion,
        definition: {
            id: definition.id,
            version: definition.version,
            instructions: definition.instructions,
            operationNames: Object.keys(definition.operations),
        },
        mission: {
            id: mission._id,
            status: mission.status,
            definition: mission.definitionId,
            objective: mission.objectiveKey,
            runId: run._id,
            corpusRevisionId: revision._id,
        },
        ...domainContext.context,
        constraints: {
            generation: mission.generation,
            deadlineAt: mission.deadlineAt,
            operations: Object.keys(definition.operations),
            authority: definition.authority,
        },
        workingNotes: {
            status: "working_notes_not_established_facts",
            text: mission.workingNotes,
        },
        lastObservableInvocation:
            previousInvocation?.status === "returned"
                ? {
                      invocationId: previousInvocation._id,
                      status: "observable_reply_not_established_facts",
                      outputJson: previousInvocation.outputJson ?? null,
                      rawOutputJson: previousInvocation.rawOutputJson ?? null,
                  }
                : null,
        activeWork: {
            ...domainContext.context.activeWork,
            unfinishedObligations: mission.obligations,
            noProgressTurns: mission.noProgressTurns,
        },
        triggeringRequestsAndResults: triggeringRequests.map(
            ({ request, callId }) => ({
                ...(callId ? { callId } : {}),
                requestId: request._id,
                input: request.input,
                status: request.status,
                outcome: request.outcome ?? null,
            }),
        ),
        pendingRequests: pending.map((request) => ({
            requestId: request._id,
            input: request.input,
        })),
        history: {
            operation: "consult_mission_state",
            cursor: null,
            description:
                "Exact prior observable inputs, outputs, requests and results are retained and can be read in pages.",
        },
    });
    if (new TextEncoder().encode(inputJson).length > MAX_CONTEXT_BYTES)
        return { kind: "blocked" as const, code: "context_capacity" };
    return { kind: "ready" as const, inputJson };
}

export const build = internalQuery({
    args: { missionId: v.id("agentMissions"), expectedGeneration: v.number() },
    returns: v.union(
        v.object({ kind: v.literal("ready"), inputJson: v.string() }),
        v.object({ kind: v.literal("blocked"), code: v.string() }),
    ),
    handler: (ctx, args) =>
        buildMissionContext(ctx, args.missionId, args.expectedGeneration),
});
