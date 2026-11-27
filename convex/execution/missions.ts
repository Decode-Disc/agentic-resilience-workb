import { internal } from "@convex/_generated/api";
import { internalMutation } from "@convex/_generated/server";
import { stableStringify } from "@convex/domain/sourcePassages";
import { readPreparationLimits } from "@convex/domain/sourcePreparationAuthority";
import { pinMissionModel } from "@convex/modelConfiguration";
import { taskMethodDefinitionVersion } from "@convex/qualificationAgentMethods";
import {
    EXECUTION_WINDOW_MS,
    RESOURCE_POLICY_VERSION,
} from "@convex/resourcePolicy";
import {
    localBrowserFixturesEnabled,
    readCampaignResearchDeadline,
} from "@convex/runWorkspace";
import { workflow } from "@convex/workflow";
import type { WorkflowId } from "@convex-dev/workflow";
import { vEventId } from "@convex-dev/workflow";
import { v } from "convex/values";
import { validate } from "convex-helpers/validators";
import { resolveAgentDefinition } from "./agentCatalog";
import { agentScopeValidator } from "./agentSchemas";
import {
    canAdoptRetainedResponse,
    executionError,
    recordMissionEvent,
    requireDossierAuthority,
    requireMissionAuthority,
    requireRunAuthority,
} from "./authority";
import {
    agentBackendValidator,
    agentDefinitionIdValidator,
    DEFAULT_AGENT_BACKEND,
    requireSupportedMissionBackend,
} from "./executionProtocol";
import { hasReceivedResponse } from "./journal";
import {
    isRecoverableInterruption,
    missionObjectiveKey,
    missionScope,
} from "./missionData";
import { cancelPiWake, schedulePiMission } from "./piControl";

export const start = internalMutation({
    args: {
        completionEventId: v.optional(vEventId()),
        runId: v.id("researchRuns"),
        corpusRevisionId: v.optional(v.id("corpusRevisions")),
        scope: v.optional(agentScopeValidator),
        conversationTurnId: v.optional(v.id("agentConversationTurns")),
        definitionId: agentDefinitionIdValidator,
        generationBackend: v.optional(agentBackendValidator),
        requestKey: v.string(),
        expectedGeneration: v.number(),
    },
    returns: v.id("agentMissions"),
    handler: async (ctx, args) => {
        if (!/^[a-zA-Z0-9._:-]{1,120}$/.test(args.requestKey))
            throw executionError("invalid_request_key");
        const scope =
            args.scope ??
            (args.corpusRevisionId &&
            args.definitionId === "saved_material_inspection_v1"
                ? {
                      kind: "saved_material_inspection_v1" as const,
                      corpusRevisionId: args.corpusRevisionId,
                  }
                : undefined);
        if (
            !scope ||
            scope.kind !== args.definitionId ||
            (args.scope && args.corpusRevisionId)
        )
            throw executionError("mission_scope_invalid");
        const { run, visitor } = await requireDossierAuthority(ctx, args.runId);
        const turn = args.conversationTurnId
            ? await ctx.db.get(args.conversationTurnId)
            : null;
        const conversation = turn
            ? await ctx.db.get(turn.conversationId)
            : null;
        const objectiveKey = missionObjectiveKey(
            scope,
            args.conversationTurnId,
        );
        const previous = await ctx.db
            .query("agentMissions")
            .withIndex("by_run_and_request_key", (q) =>
                q.eq("runId", args.runId).eq("requestKey", args.requestKey),
            )
            .unique();
        const retained =
            previous ??
            (await ctx.db
                .query("agentMissions")
                .withIndex("by_run_and_objective_key", (q) =>
                    q.eq("runId", args.runId).eq("objectiveKey", objectiveKey),
                )
                .unique());
        if (retained) {
            if (
                stableStringify(missionScope(retained)) !==
                    stableStringify(scope) ||
                retained.definitionId !== args.definitionId ||
                retained.conversationTurnId !== args.conversationTurnId ||
                ((previous ||
                    retained.status !== "completed" ||
                    args.completionEventId !== undefined) &&
                    retained.completionEventId !== args.completionEventId) ||
                (args.generationBackend !== undefined &&
                    stableStringify(retained.generationBackend) !==
                        stableStringify(args.generationBackend)) ||
                (previous && retained.generation !== args.expectedGeneration)
            )
                throw executionError("mission_identity_conflict");
            if (
                retained.ownerVisitorId !== visitor._id ||
                retained.generation !== args.expectedGeneration
            )
                throw executionError("stale_execution");
            requireSupportedMissionBackend(retained);
        }
        const comparisonVersion = await taskMethodDefinitionVersion(
            ctx,
            run,
            args.definitionId,
        );
        const definition = resolveAgentDefinition(
            retained
                ? { kind: "mission", mission: retained }
                : conversation
                  ? {
                        kind: "conversation",
                        conversation,
                        definitionId: args.definitionId,
                        comparisonVersion,
                    }
                  : {
                        kind: "new",
                        definitionId: args.definitionId,
                        comparisonVersion,
                    },
        );
        if (!validate(definition.scopeValidator, scope, { db: ctx.db }))
            throw executionError("mission_scope_invalid");
        const executionScope = definition.executionScope;
        if (executionScope === "conversation") {
            if (
                !turn ||
                !conversation ||
                conversation.runId !== run._id ||
                turn.runId !== run._id ||
                turn.status !== "active" ||
                turn.generation !== args.expectedGeneration
            )
                throw executionError("active_turn_required");
        } else {
            if (args.conversationTurnId)
                throw executionError("invalid_delivery_target");
            await requireRunAuthority(ctx, run._id, args.expectedGeneration);
        }
        if (retained) {
            await definition.requireAuthority(ctx, retained, run);
            if (!previous && retained.status === "blocked")
                throw executionError(retained.blockCode ?? "mission_blocked");
            return retained._id;
        }
        const backend = args.generationBackend ?? DEFAULT_AGENT_BACKEND;
        const executionRuntime = "pi-durable";
        requireSupportedMissionBackend({
            generationBackend: backend,
            executionRuntime,
        });
        const initialState = definition.initialState(scope);
        const preparation = run.sourcePreparationId
            ? await ctx.db.get(run.sourcePreparationId)
            : null;
        const now = Date.now();
        const browserContext =
            run.purpose === "browser_test" && run.browserTestContextId
                ? await ctx.db.get(run.browserTestContextId)
                : null;
        const scopeDeadlineAt =
            executionScope === "research"
                ? (run.executionHarnessDeadlineAt ?? preparation?.deadlineAt)
                : undefined;
        const deadlineAt = Math.min(
            run.purpose === "browser_test"
                ? (browserContext?.expiresAt ?? now)
                : Infinity,
            scopeDeadlineAt ??
                (await readCampaignResearchDeadline(ctx, run)) ??
                now + EXECUTION_WINDOW_MS,
        );
        if (deadlineAt <= now) throw executionError("execution_deadline");
        if (executionScope === "research")
            await ctx.db.patch(run._id, {
                executionHarnessDeadlineAt: deadlineAt,
            });

        const id = await ctx.db.insert("agentMissions", {
            executionRuntime,
            generationBackend: backend,
            runId: run._id,
            protocolVersion: 3,
            resourcePolicy: RESOURCE_POLICY_VERSION,
            executionScope,
            completionEventId: args.completionEventId,
            conversationTurnId: args.conversationTurnId,
            scope,
            ownerVisitorId: visitor._id,
            definitionId: args.definitionId,
            definitionVersion: definition.version,
            requestKey: args.requestKey,
            objectiveKey,
            state: initialState.state,
            obligations: initialState.obligations,
            generation: args.expectedGeneration,
            deadlineAt,
            modelLimits: readPreparationLimits(preparation ?? undefined),
            status: "ready",
            noProgressTurns: 0,
            progressKeys: [],
            workingNotes: "",
            nextEventSequence: 1,
            historyProjection: {
                version: 1,
                throughSequence: 0,
                cursor: null,
                ready: true,
            },
            createdAt: now,
            updatedAt: now,
        });
        const mission = await ctx.db.get(id);
        if (!mission) throw executionError("mission_unavailable");
        if (turn) {
            if (turn.missionId && turn.missionId !== id)
                throw executionError("turn_already_claimed");
            await ctx.db.patch(turn._id, { missionId: id });
        }
        await requireMissionAuthority(ctx, id, args.expectedGeneration);
        await recordMissionEvent(ctx, mission, {
            kind: "mission_started",
            cause: args.requestKey,
        });
        return id;
    },
});

export const resume = internalMutation({
    args: {
        missionId: v.id("agentMissions"),
        expectedGeneration: v.number(),
        simulation: v.optional(v.boolean()),
    },
    returns: v.string(),
    handler: async (ctx, args): Promise<string> => {
        const retained = await ctx.db.get(args.missionId);
        if (!retained) throw executionError("mission_unavailable");
        const { run } =
            retained.executionScope === "conversation"
                ? await requireDossierAuthority(ctx, retained.runId)
                : await requireRunAuthority(
                      ctx,
                      retained.runId,
                      args.expectedGeneration,
                  );
        requireSupportedMissionBackend(retained);
        if (
            retained.blockCode === "execution_time_limit" &&
            run.executionHarnessDeadlineAt !== undefined &&
            retained.deadlineAt < run.executionHarnessDeadlineAt
        )
            await ctx.db.patch(retained._id, {
                deadlineAt: run.executionHarnessDeadlineAt,
            });
        const recoverable = isRecoverableInterruption(retained, run);
        const observed = retained.lastInvocationId
            ? await ctx.db.get(retained.lastInvocationId)
            : null;
        if (
            observed?.status === "started" &&
            hasReceivedResponse(observed) &&
            !canAdoptRetainedResponse(retained, observed)
        )
            throw executionError("retained_response_not_reusable");
        if (recoverable) {
            const last = retained.lastInvocationId
                ? await ctx.db.get(retained.lastInvocationId)
                : null;
            if (last?.status === "started" && last.providerCallId) {
                const receipt = await ctx.db.get(last.providerCallId);
                if (
                    !hasReceivedResponse(last) &&
                    receipt?.dispatchOutcome !== "not_dispatched"
                )
                    throw executionError("attempt_outcome_unknown");
                if (!hasReceivedResponse(last)) {
                    await ctx.db.patch(last._id, {
                        status: "blocked",
                        blockCode: "not_dispatched",
                    });
                    await ctx.db.patch(retained._id, {
                        lastInvocationId: undefined,
                    });
                }
            }
            await ctx.db.patch(retained._id, {
                status: "ready",
                blockCode: undefined,
            });
        }
        // The business owner has already claimed the dossier's running slot; this method never crosses a human checkpoint.
        if (
            retained.generation !== args.expectedGeneration &&
            (recoverable ||
                !["blocked", "cancelled", "completed"].includes(
                    retained.status,
                ))
        ) {
            await ctx.db.patch(retained._id, {
                generation: args.expectedGeneration,
                workflowId: undefined,
            });
            if (retained.workflowId)
                await workflow.cancel(ctx, retained.workflowId as WorkflowId);
            if (retained.piWakeId) await cancelPiWake(ctx, retained.piWakeId);
            await ctx.db.patch(retained._id, {
                piRebinding: true,
                piWakeId: undefined,
                piWakeAt: undefined,
                piWakeToken: undefined,
                piActiveWriter: undefined,
            });
            await ctx.scheduler.runAfter(
                0,
                internal.execution.piControl.rebind,
                {
                    missionId: retained._id,
                    expectedGeneration: args.expectedGeneration,
                    stage: 0,
                    cursor: null,
                },
            );
            const last = retained.lastInvocationId
                ? await ctx.db.get(retained.lastInvocationId)
                : null;
            if (
                last?.status === "started" ||
                (last?.status === "returned" && hasReceivedResponse(last))
            ) {
                if (last.providerCallId && !hasReceivedResponse(last))
                    throw executionError("attempt_outcome_unknown");
                if (hasReceivedResponse(last)) {
                    if (!canAdoptRetainedResponse(retained, last))
                        throw executionError("retained_response_not_reusable");
                    await ctx.db.patch(last._id, {
                        adoptionGeneration: args.expectedGeneration,
                    });
                    await recordMissionEvent(ctx, retained, {
                        kind: "invocation_recovery_authorized",
                        cause: "confirmed_response_reuse",
                        invocationId: last._id,
                    });
                } else {
                    await ctx.db.patch(last._id, {
                        status: "blocked",
                        blockCode: "stale_execution",
                    });
                    await ctx.db.patch(retained._id, {
                        lastInvocationId: undefined,
                    });
                }
            }
        }
        const { mission } = await requireMissionAuthority(
            ctx,
            args.missionId,
            args.expectedGeneration,
        );
        const provenance = args.simulation ? "simulation" : "live";
        if (mission.provenance && mission.provenance !== provenance)
            throw executionError("invocation_identity_conflict");
        if (
            args.simulation &&
            (!localBrowserFixturesEnabled() || run.purpose !== "browser_test")
        )
            throw executionError("simulation_not_authorized");
        if (!args.simulation) await pinMissionModel(ctx, mission);
        await ctx.db.patch(mission._id, { provenance });
        await schedulePiMission(ctx, mission._id, args.expectedGeneration);
        return `pi:${mission._id}`;
    },
});

export const rebindCompletionEvent = internalMutation({
    args: {
        missionId: v.id("agentMissions"),
        eventId: vEventId(),
        expectedGeneration: v.number(),
    },
    returns: v.null(),
    handler: async (ctx, args): Promise<null> => {
        const mission = await ctx.db.get(args.missionId);
        if (!mission) throw executionError("mission_unavailable");
        const { run } = await requireDossierAuthority(ctx, mission.runId);
        if (run.executionGeneration !== args.expectedGeneration)
            throw executionError("stale_execution");
        await ctx.db.patch(mission._id, {
            completionEventId: args.eventId,
            completionNotified: false,
        });
        if (["completed", "cancelled", "blocked"].includes(mission.status)) {
            await ctx.runMutation(internal.execution.handoffs.finishChild, {
                missionId: mission._id,
            });
        }
        return null;
    },
});
