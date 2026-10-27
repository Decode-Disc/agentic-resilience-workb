import { internal } from "@convex/_generated/api";
import { internalMutation, internalQuery } from "@convex/_generated/server";
import { readPreparationLimits } from "@convex/domain/sourcePreparationAuthority";
import { localBrowserFixturesEnabled } from "@convex/runWorkspace";
import { workflow } from "@convex/workflow";
import type { WorkflowId } from "@convex-dev/workflow";
import { v } from "convex/values";
import {
    executionError,
    recordMissionEvent,
    requireMissionAuthority,
    requireRunAuthority,
} from "./authority";
import { EXECUTION_WINDOW_MS, HISTORY_PAGE_SIZE } from "./contracts";

export const start = internalMutation({
    args: {
        runId: v.id("researchRuns"),
        corpusRevisionId: v.id("corpusRevisions"),
        definitionId: v.literal("saved_material_inspection_v1"),
        requestKey: v.string(),
        expectedGeneration: v.number(),
    },
    returns: v.id("agentMissions"),
    handler: async (ctx, args) => {
        const { run, visitor } = await requireRunAuthority(
            ctx,
            args.runId,
            args.corpusRevisionId,
            args.expectedGeneration,
        );
        if (!/^[a-zA-Z0-9._:-]{1,120}$/.test(args.requestKey))
            throw executionError("invalid_request_key");
        const previous = await ctx.db
            .query("agentMissions")
            .withIndex("by_run_and_request_key", (q) =>
                q.eq("runId", args.runId).eq("requestKey", args.requestKey),
            )
            .unique();
        if (previous) {
            if (
                previous.corpusRevisionId !== args.corpusRevisionId ||
                previous.generation !== args.expectedGeneration ||
                previous.definitionId !== args.definitionId
            )
                throw executionError("mission_identity_conflict");
            return previous._id;
        }
        const objectiveKey = `saved-material:${args.corpusRevisionId}`;
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
            run.executionHarnessDeadlineAt ??
            Math.min(
                now + EXECUTION_WINDOW_MS,
                preparation?.deadlineAt ?? Infinity,
            );
        if (deadlineAt <= now) throw executionError("execution_deadline");
        await ctx.db.patch(run._id, { executionHarnessDeadlineAt: deadlineAt });
        const id = await ctx.db.insert("agentMissions", {
            runId: run._id,
            corpusRevisionId: args.corpusRevisionId,
            ownerVisitorId: visitor._id,
            definitionId: args.definitionId,
            definitionVersion: 1,
            requestKey: args.requestKey,
            objectiveKey,
            generation: args.expectedGeneration,
            deadlineAt,
            modelLimits: readPreparationLimits(preparation ?? undefined),
            status: "ready",
            noProgressTurns: 0,
            progressKeys: [],
            inspectedCaptureIds: [],
            workingNotes: "",
            obligations: ["inspect_saved_material"],
            completionRefs: [],
            nextEventSequence: 1,
            createdAt: now,
            updatedAt: now,
        });
        const mission = await ctx.db.get(id);
        if (!mission) throw executionError("mission_unavailable");
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
        const { run } = await requireRunAuthority(
            ctx,
            retained.runId,
            retained.corpusRevisionId,
            args.expectedGeneration,
        );
        const recoverable =
            retained.status === "blocked" &&
            retained.blockCode === "execution_interrupted";
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
            for (const status of ["pending", "running"] as const) {
                const pending = await ctx.db
                    .query("agentOperationRequests")
                    .withIndex("by_mission_and_status", (q) =>
                        q.eq("missionId", retained._id).eq("status", status),
                    )
                    .take(5);
                if (pending.length > 4)
                    throw executionError("continuation_capacity");
                for (const request of pending)
                    await ctx.db.patch(request._id, {
                        expectedGeneration: args.expectedGeneration,
                        status: "pending",
                    });
            }
            const last = retained.lastInvocationId
                ? await ctx.db.get(retained.lastInvocationId)
                : null;
            if (last?.status === "started") {
                if (last.providerCallId && !last.receivedOutputJson)
                    throw executionError("attempt_outcome_unknown");
                await ctx.db.patch(last._id, {
                    status: "blocked",
                    blockCode: "stale_execution",
                });
                await ctx.db.patch(retained._id, {
                    lastInvocationId: undefined,
                });
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
        if (mission.workflowId) return mission.workflowId;
        const id = await workflow.start(
            ctx,
            internal.execution.missionWorkflow.run,
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
            const invocation = event.invocationId
                ? await ctx.db.get(event.invocationId)
                : null;
            const request = event.requestId
                ? await ctx.db.get(event.requestId)
                : null;
            const payload = JSON.stringify({ event, invocation, request });
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
