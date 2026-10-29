import { internal } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { internalMutation } from "@convex/_generated/server";
import { v } from "convex/values";
import { getAgentDefinition } from "./agentCatalog";
import { recordMissionEvent, requireMissionAuthority } from "./authority";
import { requireInstructionVersion } from "./conversations";
import { executionError, executionFailureCode } from "./errors";
import { operationOutcomeValidator } from "./executionProtocol";
import { isRecoverableInterruption } from "./missionData";

/** Only an admitted business operation can grant a child mission; models never select a runtime. */
export const startChild = internalMutation({
    args: {
        requestId: v.id("agentOperationRequests"),
        expectedGeneration: v.number(),
    },
    returns: operationOutcomeValidator,
    handler: async (
        ctx,
        args,
    ): Promise<
        import("convex/values").Infer<typeof operationOutcomeValidator>
    > => {
        const request = await ctx.db.get(args.requestId);
        if (
            !request?.missionId ||
            request.status !== "running" ||
            request.expectedGeneration !== args.expectedGeneration ||
            request.input.kind === "invalid"
        )
            throw executionError("operation_not_dispatched");
        let state: Awaited<ReturnType<typeof requireMissionAuthority>>;
        try {
            state = await requireMissionAuthority(
                ctx,
                request.missionId,
                args.expectedGeneration,
            );
            await requireInstructionVersion(
                ctx,
                state.mission,
                request.instructionVersion,
            );
        } catch (error) {
            const code = executionFailureCode(error);
            if (!code) throw error;
            return { kind: "refused", code };
        }
        const { mission, run } = state;
        const operation = getAgentDefinition(
            mission.definitionId,
            mission.definitionVersion,
        ).operations[request.input.kind];
        const grant = operation?.childMission?.(request);
        if (
            !grant ||
            !Number.isSafeInteger(grant.maxRequests) ||
            grant.maxRequests < 1
        )
            return { kind: "refused", code: "mission_handoff_not_allowed" };
        if (request.childMissionId)
            return { kind: "waiting", reference: request.childMissionId };
        const root = mission.rootMissionId
            ? await ctx.db.get(mission.rootMissionId)
            : mission;
        if (!root || root.runId !== run._id)
            return { kind: "refused", code: "mission_handoff_not_allowed" };
        if ((root.childMissionRequests ?? 0) >= grant.maxRequests)
            return { kind: "refused", code: "mission_return_limit" };
        let childId: Id<"agentMissions">;
        try {
            // A failed child admission rolls back its subtransaction before any external work is scheduled.
            childId = await ctx.runMutation(internal.execution.missions.start, {
                runId: run._id,
                definitionId: grant.definitionId,
                scope: grant.scope,
                expectedGeneration: run.executionGeneration,
                requestKey: `handoff:${request._id}`,
            });
        } catch (error) {
            const code = executionFailureCode(error);
            if (!code) throw error;
            return { kind: "refused", code };
        }
        const child = await ctx.db.get(childId);
        if (!child) throw executionError("mission_unavailable");
        if (
            child.status !== "completed" &&
            child.requestKey !== `handoff:${request._id}`
        )
            return { kind: "refused", code: "mission_already_assigned" };
        if (child.status !== "completed" && child.deadlineAt <= Date.now())
            return { kind: "refused", code: "execution_deadline" };
        await ctx.db.patch(request._id, { childMissionId: childId });
        await ctx.db.patch(root._id, {
            childMissionRequests: (root.childMissionRequests ?? 0) + 1,
        });
        if (!child.parentRequestId)
            await ctx.db.patch(childId, {
                parentRequestId: request._id,
                rootMissionId: root._id,
            });
        await recordMissionEvent(ctx, mission, {
            kind: "mission_handoff",
            cause: request.logicalKey,
            requestId: request._id,
        });
        if (child.status === "completed") {
            const outcome = {
                kind: "success" as const,
                valueJson: JSON.stringify({
                    missionId: childId,
                    result: "retained_mission_result",
                }),
            };
            await ctx.runMutation(internal.execution.operations.recordResult, {
                ...args,
                outcome,
            });
            return outcome;
        }
        await ctx.runMutation(internal.execution.missions.resume, {
            missionId: childId,
            expectedGeneration: child.generation,
            simulation:
                mission.provenance === "simulation" ||
                run.purpose === "browser_test",
        });
        return { kind: "waiting", reference: childId };
    },
});

/** Terminal child state is a result reference, never a copied business artifact. */
export const finishChild = internalMutation({
    args: { missionId: v.id("agentMissions") },
    returns: v.null(),
    handler: async (ctx, args): Promise<null> => {
        const child = await ctx.db.get(args.missionId);
        if (!child?.parentRequestId) return null;
        if (
            !["completed", "cancelled", "blocked"].includes(child.status) ||
            isRecoverableInterruption(child)
        )
            return null;
        const request = await ctx.db.get(child.parentRequestId);
        if (!request || request.childMissionId !== child._id)
            throw executionError("handoff_correlation_invalid");
        await ctx.runMutation(internal.execution.operations.recordResult, {
            requestId: request._id,
            expectedGeneration: request.expectedGeneration,
            outcome:
                child.status === "completed"
                    ? {
                          kind: "success",
                          valueJson: JSON.stringify({
                              missionId: child._id,
                              result: "retained_mission_result",
                          }),
                      }
                    : { kind: "unavailable", code: "child_mission_incomplete" },
        });
        return null;
    },
});
