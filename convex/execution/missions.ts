import { internal } from "@convex/_generated/api";
import { internalMutation, internalQuery } from "@convex/_generated/server";
import { stableStringify } from "@convex/domain/sourcePassages";
import { readPreparationLimits } from "@convex/domain/sourcePreparationAuthority";
import { pinMissionModel } from "@convex/modelConfiguration";
import { localBrowserFixturesEnabled } from "@convex/runWorkspace";
import { workflow } from "@convex/workflow";
import type { WorkflowId } from "@convex-dev/workflow";
import { v } from "convex/values";
import { validate } from "convex-helpers/validators";
import { getAgentDefinition } from "./agentCatalog";
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
    EXECUTION_WINDOW_MS,
    HISTORY_PAGE_SIZE,
} from "./executionProtocol";
import { projectMissionHistoryEvent } from "./journal";
import { isRecoverableInterruption, missionScope } from "./missionData";
import { cancelPiWake, schedulePiMission } from "./piControl";

export const start = internalMutation({
    args: {
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
        const conversationTurn = args.conversationTurnId
            ? await ctx.db.get(args.conversationTurnId)
            : null;
        const conversation = conversationTurn
            ? await ctx.db.get(conversationTurn.conversationId)
            : null;
        const definition = getAgentDefinition(
            args.definitionId,
            conversation?.definitionId === args.definitionId
                ? (conversation.definitionVersion ?? 1)
                : 1,
        );
        const executionScope = definition.executionScope;
        const { run, visitor } =
            executionScope === "conversation"
                ? await requireDossierAuthority(ctx, args.runId)
                : await requireRunAuthority(
                      ctx,
                      args.runId,
                      args.expectedGeneration,
                  );
        const turn = args.conversationTurnId
            ? await ctx.db.get(args.conversationTurnId)
            : null;
        if (
            executionScope === "conversation" &&
            (!turn ||
                turn.runId !== run._id ||
                turn.status !== "active" ||
                turn.generation !== args.expectedGeneration)
        )
            throw executionError("active_turn_required");
        if (executionScope === "research" && args.conversationTurnId)
            throw executionError("invalid_delivery_target");
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
            scope.kind !== definition.id ||
            !validate(definition.scopeValidator, scope, { db: ctx.db }) ||
            (args.scope && args.corpusRevisionId)
        )
            throw executionError("mission_scope_invalid");
        const previous = await ctx.db
            .query("agentMissions")
            .withIndex("by_run_and_request_key", (q) =>
                q.eq("runId", args.runId).eq("requestKey", args.requestKey),
            )
            .unique();
        if (previous) {
            if (
                stableStringify(missionScope(previous)) !==
                    stableStringify(scope) ||
                previous.generation !== args.expectedGeneration ||
                previous.definitionId !== args.definitionId ||
                previous.conversationTurnId !== args.conversationTurnId ||
                (args.generationBackend !== undefined &&
                    stableStringify(previous.generationBackend) !==
                        stableStringify(args.generationBackend))
            )
                throw executionError("mission_identity_conflict");
            return previous._id;
        }
        const initialState = definition.initialState(scope);
        const objectiveKey = turn
            ? `${initialState.objectiveKey}:${turn._id}`
            : initialState.objectiveKey;
        const objective = await ctx.db
            .query("agentMissions")
            .withIndex("by_run_and_objective_key", (q) =>
                q.eq("runId", args.runId).eq("objectiveKey", objectiveKey),
            )
            .unique();
        if (objective) {
            if (objective.status === "blocked")
                throw executionError(objective.blockCode ?? "mission_blocked");
            if (objective.generation !== args.expectedGeneration)
                throw executionError("stale_execution");
            return objective._id;
        }
        const preparation = run.sourcePreparationId
            ? await ctx.db.get(run.sourcePreparationId)
            : null;
        const now = Date.now();
        const deadlineAt =
            (executionScope === "research"
                ? run.executionHarnessDeadlineAt
                : undefined) ??
            Math.min(
                now + EXECUTION_WINDOW_MS,
                executionScope === "research"
                    ? (preparation?.deadlineAt ?? Infinity)
                    : Infinity,
            );
        if (deadlineAt <= now) throw executionError("execution_deadline");
        if (executionScope === "research")
            await ctx.db.patch(run._id, {
                executionHarnessDeadlineAt: deadlineAt,
            });
        const backend = args.generationBackend ?? DEFAULT_AGENT_BACKEND;
        if (backend.id === "pi-durable" && backend.version !== 1)
            throw executionError("generation_backend_unknown");
        const id = await ctx.db.insert("agentMissions", {
            executionRuntime:
                backend.id === "pi-durable" ? "pi-durable" : undefined,
            generationBackend: backend,
            runId: run._id,
            protocolVersion: 3,
            executionScope,
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
        const recoverable = isRecoverableInterruption(retained);
        const observed = retained.lastInvocationId
            ? await ctx.db.get(retained.lastInvocationId)
            : null;
        if (
            observed?.status === "started" &&
            observed.receivedOutputJson &&
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
                    !last.receivedOutputJson &&
                    receipt?.dispatchOutcome !== "not_dispatched"
                )
                    throw executionError("attempt_outcome_unknown");
                if (!last.receivedOutputJson) {
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
            if (retained.executionRuntime === "pi-durable") {
                if (retained.piWakeId)
                    await cancelPiWake(ctx, retained.piWakeId);
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
            } else {
                for (const status of [
                    "pending",
                    "running",
                    "observed",
                    "waiting",
                ] as const) {
                    const pending = await ctx.db
                        .query("agentOperationRequests")
                        .withIndex("by_mission_and_status", (q) =>
                            q
                                .eq("missionId", retained._id)
                                .eq("status", status),
                        )
                        .take(5);
                    if (pending.length > 4)
                        throw executionError("continuation_capacity");
                    for (const request of pending)
                        await ctx.db.patch(request._id, {
                            ...(request.status === "pending"
                                ? {
                                      expectedGeneration:
                                          args.expectedGeneration,
                                  }
                                : {
                                      adoptionGeneration:
                                          args.expectedGeneration,
                                  }),
                        });
                }
            }
            const last = retained.lastInvocationId
                ? await ctx.db.get(retained.lastInvocationId)
                : null;
            if (
                last?.status === "started" ||
                (retained.executionRuntime === "pi-durable" &&
                    last?.status === "returned" &&
                    last.receivedOutputJson)
            ) {
                if (last.providerCallId && !last.receivedOutputJson)
                    throw executionError("attempt_outcome_unknown");
                if (last.receivedOutputJson) {
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
        if (mission.executionRuntime === "pi-durable") {
            if (
                mission.generationBackend?.id !== "pi-durable" ||
                mission.generationBackend.version !== 1
            )
                throw executionError("generation_backend_unknown");
            await ctx.db.patch(mission._id, { provenance });
            await schedulePiMission(ctx, mission._id, args.expectedGeneration);
            return `pi:${mission._id}`;
        }
        if (mission.workflowId) return mission.workflowId;
        const id = await workflow.start(
            ctx,
            "protocolVersion" in mission && mission.protocolVersion === 3
                ? internal.execution.missionWorkflow.runV3
                : internal.execution.missionWorkflow.run,
            {
                missionId: mission._id,
                expectedGeneration: args.expectedGeneration,
                simulation: args.simulation ?? false,
            },
            {
                onComplete: internal.execution.missionWorkflow.onComplete,
                context: { missionId: mission._id },
            },
        );
        await ctx.db.patch(mission._id, { workflowId: id, provenance });
        for (const status of ["running", "waiting"] as const) {
            const requests = await ctx.db
                .query("agentOperationRequests")
                .withIndex("by_mission_and_status", (q) =>
                    q.eq("missionId", mission._id).eq("status", status),
                )
                .take(5);
            if (requests.length > 4)
                throw executionError("continuation_capacity");
            for (const request of requests) {
                const eventId = await workflow.createEvent(ctx, {
                    name: `operation:${request._id}`,
                    workflowId: id,
                });
                await ctx.db.patch(request._id, {
                    waitEventId: eventId,
                    waitNotified: false,
                });
            }
        }
        await recordMissionEvent(ctx, mission, {
            kind: "mission_resumed",
            cause: "authorized_continuation",
        });
        return id;
    },
});

/** Exact observable records are chunked with a cursor; a reading limit never silently deletes their remainder. */
export const history = internalQuery({
    args: {
        missionId: v.id("agentMissions"),
        expectedGeneration: v.number(),
        cursor: v.optional(v.string()),
    },
    returns: v.object({
        entries: v.array(
            v.object({
                sequence: v.number(),
                offset: v.number(),
                totalCharacters: v.number(),
                content: v.string(),
            }),
        ),
        continueCursor: v.union(v.string(), v.null()),
    }),
    handler: async (ctx, args) => {
        await requireMissionAuthority(
            ctx,
            args.missionId,
            args.expectedGeneration,
        );
        const match = /^(\d+):(\d+)$/.exec(args.cursor ?? "1:0");
        if (!match) throw executionError("history_cursor_invalid");
        const sequence = Number(match[1]);
        let offset = Number(match[2]);
        if (
            !Number.isSafeInteger(sequence) ||
            sequence < 1 ||
            !Number.isSafeInteger(offset) ||
            offset < 0
        )
            throw executionError("history_cursor_invalid");
        const events = await ctx.db
            .query("agentExecutionEvents")
            .withIndex("by_mission_and_sequence", (q) =>
                q.eq("missionId", args.missionId).gte("sequence", sequence),
            )
            .take(HISTORY_PAGE_SIZE);
        const entries: {
            sequence: number;
            offset: number;
            totalCharacters: number;
            content: string;
        }[] = [];
        let bytes = 0;
        for (const event of events) {
            if (event.sequence === undefined)
                throw executionError("mission_history_invalid");
            const { json: payload } = await projectMissionHistoryEvent(
                ctx,
                event,
            );
            if (offset >= payload.length && offset !== 0)
                throw executionError("history_cursor_invalid");
            let end = Math.min(payload.length, offset + 4000);
            if (
                end < payload.length &&
                /[\uD800-\uDBFF]/.test(payload[end - 1] ?? "")
            )
                end--;
            const content = payload.slice(offset, end);
            const size = new TextEncoder().encode(content).length;
            if (bytes + size > 48 * 1024)
                return {
                    entries,
                    continueCursor: `${event.sequence}:${offset}`,
                };
            entries.push({
                sequence: event.sequence,
                offset,
                totalCharacters: payload.length,
                content,
            });
            bytes += size;
            if (end < payload.length)
                return { entries, continueCursor: `${event.sequence}:${end}` };
            offset = 0;
        }
        return {
            entries,
            continueCursor:
                events.length === HISTORY_PAGE_SIZE
                    ? `${(events.at(-1)?.sequence ?? sequence) + 1}:0`
                    : null,
        };
    },
});
