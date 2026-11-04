import type { Doc, Id } from "@convex/_generated/dataModel";
import type { MutationCtx, QueryCtx } from "@convex/_generated/server";
import { sha256Hex, stableStringify } from "@convex/domain/sourcePassages";
import { isResumableResearchPause } from "@convex/domain/transitions";
import { runMatchesWorkspace, workspaceForVisitor } from "@convex/runWorkspace";
import { validate } from "convex-helpers/validators";
import { getAgentDefinition } from "./agentCatalog";
import { executionError } from "./errors";
import { retainExecutionEventPayload } from "./journal";
import { missionScope, missionState } from "./missionData";

export { executionError, executionFailureCode } from "./errors";

/** Logical results may serve several callers; each retained cause must still belong to that request. */
export async function readOperationCause(
    ctx: QueryCtx,
    request: Doc<"agentOperationRequests">,
    eventId?: Id<"agentExecutionEvents">,
) {
    if (!eventId) return null;
    const cause = await ctx.db.get(eventId);
    if (
        !cause ||
        cause.requestId !== request._id ||
        cause.missionId !== request.missionId ||
        (request.runId && cause.runId !== request.runId) ||
        ![
            "operation_requested",
            "operation_reused",
            "operation_refused",
        ].includes(cause.kind)
    )
        throw executionError("operation_correlation_invalid");
    return cause;
}

/** Restored authority cannot retroactively authorize an observation received while access was absent. */
export function canAdoptRetainedResponse(
    mission: Doc<"agentMissions">,
    invocation: Doc<"agentInvocations">,
) {
    return (
        invocation.receivedWhileAuthorized === true &&
        invocation.missionId === mission._id &&
        invocation.runId === mission.runId &&
        invocation.definitionVersion === mission.definitionVersion &&
        (invocation.scopeKey === undefined
            ? !("protocolVersion" in mission) &&
              invocation.corpusRevisionId === mission.corpusRevisionId
            : invocation.scopeKey ===
              sha256Hex(stableStringify(missionScope(mission))))
    );
}

/** Internal callers inherit the persisted run's authority, not a supplied principal or model argument. */
export async function requireDossierAuthority(
    ctx: QueryCtx,
    runId: Id<"researchRuns">,
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
    if (run.executionStatus === "cancelled")
        throw executionError("stale_execution");
    return { run, visitor };
}

export async function requireRunAuthority(
    ctx: QueryCtx,
    runId: Id<"researchRuns">,
    expectedGeneration: number,
) {
    const { run, visitor } = await requireDossierAuthority(ctx, runId);
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
    return { run, visitor };
}

async function requireMissionAccess(
    ctx: QueryCtx,
    missionId: Id<"agentMissions">,
    expectedGeneration: number,
    permission: "progression" | "observation",
) {
    const mission = await ctx.db.get(missionId);
    if (!mission) throw executionError("mission_unavailable");
    const definition = getAgentDefinition(
        mission.definitionId,
        mission.definitionVersion,
    );
    const scopeKind = definition.executionScope;
    if (mission.executionScope && mission.executionScope !== scopeKind)
        throw executionError("mission_contract_invalid");
    const { run, visitor } =
        scopeKind === "conversation" || permission === "observation"
            ? await requireDossierAuthority(ctx, mission.runId)
            : await requireRunAuthority(ctx, mission.runId, expectedGeneration);
    if (
        scopeKind !== "conversation" &&
        permission === "observation" &&
        !(
            run.agentExecutionVersion === 3 &&
            isResumableResearchPause(run) &&
            run.executionGeneration === expectedGeneration + 1
        )
    )
        await requireRunAuthority(ctx, mission.runId, expectedGeneration);
    if (scopeKind === "conversation") {
        const turn = mission.conversationTurnId
            ? await ctx.db.get(mission.conversationTurnId)
            : null;
        if (
            !turn ||
            turn.missionId !== mission._id ||
            turn.runId !== run._id ||
            turn.generation !== mission.generation ||
            turn.status !== "active"
        )
            throw executionError("active_turn_required");
    }
    if (
        mission.ownerVisitorId !== visitor._id ||
        mission.generation !== expectedGeneration
    )
        throw executionError("stale_execution");
    const scope = missionScope(mission);
    const state = missionState(mission);
    if (
        scope.kind !== definition.id ||
        state.kind !== definition.id ||
        !validate(definition.scopeValidator, scope, { db: ctx.db }) ||
        !validate(definition.stateValidator, state, { db: ctx.db })
    )
        throw executionError("mission_contract_invalid");
    await definition.requireAuthority(ctx, mission, run);
    if (mission.deadlineAt <= Date.now())
        throw executionError("execution_deadline");
    if (["blocked", "cancelled", "completed"].includes(mission.status))
        throw executionError(mission.blockCode ?? `mission_${mission.status}`);
    return { mission, run };
}

export function requireMissionAuthority(
    ctx: QueryCtx,
    missionId: Id<"agentMissions">,
    expectedGeneration: number,
) {
    return requireMissionAccess(
        ctx,
        missionId,
        expectedGeneration,
        "progression",
    );
}

/** Analyst suspension permits retaining engaged work, without granting progression authority. */
export function requireMissionObservationAuthority(
    ctx: QueryCtx,
    missionId: Id<"agentMissions">,
    expectedGeneration: number,
) {
    return requireMissionAccess(
        ctx,
        missionId,
        expectedGeneration,
        "observation",
    );
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
        admissionOutcome?: Doc<"agentExecutionEvents">["admissionOutcome"];
        messageId?: Id<"agentMessageDeliveries">;
        actor?: Doc<"agentExecutionEvents">["actor"];
        interpretedNeed?: string;
        generation?: number;
        instructionVersion?: number;
        historySource?: "material" | "observation";
        invocationPayloadId?: Id<"agentInvocationPayloads">;
        observation?: unknown;
        protectedDiagnostic?: Doc<"agentExecutionEvents">["protectedDiagnostic"];
    },
) {
    const current = await ctx.db.get(mission._id);
    if (!current) throw executionError("mission_unavailable");
    const { historySource, observation, ...details } = event;
    const source =
        historySource ??
        (["mission_started", "mission_completed"].includes(event.kind)
            ? "material"
            : undefined);
    const eventId = await ctx.db.insert("agentExecutionEvents", {
        ...details,
        historySourceSequence: source ? current.nextEventSequence : undefined,
        actor:
            event.actor ??
            (event.invocationId
                ? { type: "agent", missionId: mission._id }
                : { type: "system" }),
        parentRequestId: mission.parentRequestId,
        missionId: mission._id,
        runId: mission.runId,
        conversationTurnId: mission.conversationTurnId,
        sequence: current.nextEventSequence,
        occurredAt: Date.now(),
    });
    await ctx.db.patch(mission._id, {
        nextEventSequence: current.nextEventSequence + 1,
        ...(source === "material"
            ? { historyMaterialSequence: current.nextEventSequence }
            : {}),
        updatedAt: Date.now(),
    });
    if (observation !== undefined)
        await retainExecutionEventPayload(ctx, eventId, observation);
    return eventId;
}

/** Invocation events share mission ordering when applicable; one-shot calls only need dossier ordering. */
export async function recordInvocationEvent(
    ctx: MutationCtx,
    invocation: Doc<"agentInvocations">,
    event: { kind: string; code?: string },
) {
    const fields = {
        ...event,
        invocationId: invocation._id,
        cause: invocation.taskKey,
    };
    if (invocation.missionId) {
        const mission = await ctx.db.get(invocation.missionId);
        if (!mission || mission.runId !== invocation.runId)
            throw executionError("mission_unavailable");
        await recordMissionEvent(ctx, mission, fields);
    } else {
        await ctx.db.insert("agentExecutionEvents", {
            ...fields,
            runId: invocation.runId,
            occurredAt: Date.now(),
        });
    }
}
