import { internal } from "@convex/_generated/api";
import type { Doc } from "@convex/_generated/dataModel";
import {
    internalAction,
    internalMutation,
    type MutationCtx,
} from "@convex/_generated/server";
import { sha256Hex, stableStringify } from "@convex/domain/sourcePassages";
import { type Infer, v } from "convex/values";
import {
    executionError,
    executionFailureCode,
    recordMissionEvent,
    requireMissionAuthority,
} from "./authority";
import {
    agentDefinitionIdValidator,
    agentDefinitionVersionValidator,
    MAX_OPERATION_RESULT_BYTES,
    operationInputValidator,
    operationOutcomeValidator,
    type requestInputValidator,
} from "./contracts";
import { getAgentDefinition } from "./definitions";

/** A logical operation survives temporary invocations; identical requests reuse their retained outcome. */
export async function persistOperationRequest(
    ctx: MutationCtx,
    mission: Doc<"agentMissions">,
    args: {
        invocationId?: Doc<"agentInvocations">["_id"];
        actor: "system" | "agent";
        cause: string;
        input: Infer<typeof requestInputValidator>;
    },
) {
    if (!args.cause || args.cause.length > 160)
        throw executionError("invalid_operation_cause");
    let pin: {
        expectedCaptureId?: Doc<"sourceCaptures">["_id"];
        expectedContentHash?: string;
    } = {};
    let refusal: Infer<typeof operationOutcomeValidator> | undefined;
    const definition = getAgentDefinition(
        mission.definitionId,
        mission.definitionVersion,
    );
    try {
        const scope = await definition.pinOperation(ctx, mission, args.input);
        if (scope.kind === "available") pin = scope.pin;
        else refusal = { kind: "unavailable", code: scope.code };
    } catch (error) {
        const code = executionFailureCode(error);
        if (!code) throw error;
        refusal = { kind: "refused", code };
    }
    const logicalKey = sha256Hex(
        stableStringify({
            objective: mission.objectiveKey,
            version: 1,
            corpusRevisionId: mission.corpusRevisionId,
            input: args.input,
            pin,
            ...definition.reuseScope(mission, args.input),
        }),
    );
    const previous = await ctx.db
        .query("agentOperationRequests")
        .withIndex("by_mission_and_logical_key", (q) =>
            q.eq("missionId", mission._id).eq("logicalKey", logicalKey),
        )
        .unique();
    if (previous) {
        await recordMissionEvent(ctx, mission, {
            kind: "operation_reused",
            cause: args.cause,
            invocationId: args.invocationId,
            requestId: previous._id,
        });
        return previous._id;
    }
    const invalid = args.input.kind === "invalid";
    const outcome = invalid
        ? { kind: "refused" as const, code: "invalid_operation_input" }
        : refusal;
    const requestId = await ctx.db.insert("agentOperationRequests", {
        ...args,
        missionId: mission._id,
        logicalKey,
        operationVersion: 1,
        ...pin,
        expectedGeneration: mission.generation,
        status: outcome ? "completed" : "pending",
        ...(outcome ? { outcome, completedAt: Date.now() } : {}),
        createdAt: Date.now(),
    });
    await recordMissionEvent(ctx, mission, {
        kind: outcome ? "operation_refused" : "operation_requested",
        cause: args.cause,
        invocationId: args.invocationId,
        requestId,
        ...(outcome && outcome.kind !== "success"
            ? { code: outcome.code }
            : {}),
    });
    return requestId;
}

export const enqueue = internalMutation({
    args: {
        missionId: v.id("agentMissions"),
        expectedGeneration: v.number(),
        cause: v.string(),
        input: operationInputValidator,
    },
    returns: v.id("agentOperationRequests"),
    handler: async (ctx, args) => {
        const { mission } = await requireMissionAuthority(
            ctx,
            args.missionId,
            args.expectedGeneration,
        );
        return persistOperationRequest(ctx, mission, {
            actor: "system",
            cause: args.cause,
            input: args.input,
        });
    },
});

const claimValidator = v.union(
    v.object({
        kind: v.literal("execute"),
        missionId: v.id("agentMissions"),
        definitionId: agentDefinitionIdValidator,
        definitionVersion: agentDefinitionVersionValidator,
        input: operationInputValidator,
    }),
    v.object({
        kind: v.literal("outcome"),
        outcome: operationOutcomeValidator,
    }),
);

async function validateRequest(
    ctx: MutationCtx,
    request: Doc<"agentOperationRequests">,
    expectedGeneration: number,
) {
    const state = await requireMissionAuthority(
        ctx,
        request.missionId,
        expectedGeneration,
    );
    if (
        (request.expectedGeneration !== expectedGeneration &&
            request.status !== "completed") ||
        request.operationVersion !== 1
    )
        throw executionError("stale_execution");
    const scope = await getAgentDefinition(
        state.mission.definitionId,
        state.mission.definitionVersion,
    ).pinOperation(ctx, state.mission, request.input);
    if (scope.kind !== "available") throw executionError(scope.code);
    if (
        scope.pin.expectedCaptureId !== request.expectedCaptureId ||
        scope.pin.expectedContentHash !== request.expectedContentHash
    )
        throw executionError("version_conflict");
    return state;
}

export const claim = internalMutation({
    args: {
        requestId: v.id("agentOperationRequests"),
        expectedGeneration: v.number(),
    },
    returns: claimValidator,
    handler: async (ctx, args): Promise<Infer<typeof claimValidator>> => {
        const request = await ctx.db.get(args.requestId);
        if (!request) throw executionError("request_unavailable");
        const mission = await ctx.db.get(request.missionId);
        if (!mission) throw executionError("mission_unavailable");
        if (mission.generation !== args.expectedGeneration)
            return {
                kind: "outcome",
                outcome: { kind: "refused", code: "stale_execution" },
            };
        try {
            await validateRequest(ctx, request, args.expectedGeneration);
        } catch (error) {
            const code = executionFailureCode(error);
            if (!code) throw error;
            const outcome = { kind: "refused" as const, code };
            await recordMissionEvent(ctx, mission, {
                kind: "dispatch_refused",
                cause: request.cause,
                requestId: request._id,
                code,
            });
            if (request.status !== "completed")
                await ctx.db.patch(request._id, {
                    status: "completed",
                    outcome,
                    completedAt: Date.now(),
                });
            return { kind: "outcome", outcome };
        }
        if (request.outcome)
            return { kind: "outcome", outcome: request.outcome };
        if (request.input.kind === "invalid")
            throw executionError("invalid_operation_input");
        const active = await ctx.db
            .query("agentOperationRequests")
            .withIndex("by_mission_and_status", (q) =>
                q.eq("missionId", mission._id).eq("status", "running"),
            )
            .first();
        if (active && active._id !== request._id)
            return {
                kind: "outcome",
                outcome: { kind: "unavailable", code: "operation_in_progress" },
            };
        await ctx.db.patch(request._id, { status: "running" });
        await recordMissionEvent(ctx, mission, {
            kind: "operation_dispatched",
            cause: request.cause,
            requestId: request._id,
            invocationId: request.invocationId,
        });
        return {
            kind: "execute",
            missionId: mission._id,
            definitionId: mission.definitionId,
            definitionVersion: mission.definitionVersion,
            input: request.input,
        };
    },
});

export const recordResult = internalMutation({
    args: {
        requestId: v.id("agentOperationRequests"),
        expectedGeneration: v.number(),
        outcome: operationOutcomeValidator,
    },
    returns: operationOutcomeValidator,
    handler: async (
        ctx,
        args,
    ): Promise<Infer<typeof operationOutcomeValidator>> => {
        const request = await ctx.db.get(args.requestId);
        if (!request) throw executionError("request_unavailable");
        let state: Awaited<ReturnType<typeof validateRequest>>;
        try {
            state = await validateRequest(
                ctx,
                request,
                args.expectedGeneration,
            );
        } catch (error) {
            const code = executionFailureCode(error);
            if (!code) throw error;
            const mission = await ctx.db.get(request.missionId);
            if (mission)
                await recordMissionEvent(ctx, mission, {
                    kind: "late_operation_result_refused",
                    cause: request.cause,
                    requestId: request._id,
                    code,
                });
            return { kind: "refused", code };
        }
        if (request.outcome) return request.outcome;
        let outcome = args.outcome;
        if (
            outcome.kind === "success" &&
            new TextEncoder().encode(outcome.valueJson).length >
                MAX_OPERATION_RESULT_BYTES
        )
            outcome = {
                kind: "unavailable",
                code: "operation_result_capacity",
            };
        if (
            outcome.kind === "success" &&
            outcome.captureId &&
            outcome.captureId !== request.expectedCaptureId
        )
            outcome = { kind: "refused", code: "capture_identity_conflict" };
        await ctx.db.patch(request._id, {
            status: "completed",
            outcome,
            completedAt: Date.now(),
        });
        const { mission } = state;
        const progress = getAgentDefinition(
            mission.definitionId,
            mission.definitionVersion,
        ).progress(mission, outcome);
        if (Object.keys(progress).length)
            await ctx.db.patch(mission._id, progress);
        await recordMissionEvent(ctx, mission, {
            kind: "operation_completed",
            cause: request.cause,
            invocationId: request.invocationId,
            requestId: request._id,
            ...(outcome.kind !== "success" ? { code: outcome.code } : {}),
        });
        return outcome;
    },
});

export const dispatch = internalAction({
    args: {
        requestId: v.id("agentOperationRequests"),
        expectedGeneration: v.number(),
    },
    returns: operationOutcomeValidator,
    handler: async (
        ctx,
        args,
    ): Promise<Infer<typeof operationOutcomeValidator>> => {
        const claimed = await ctx.runMutation(
            internal.execution.operations.claim,
            args,
        );
        if (claimed.kind === "outcome") return claimed.outcome;
        const outcome = await getAgentDefinition(
            claimed.definitionId,
            claimed.definitionVersion,
        ).executeOperation(ctx, {
            missionId: claimed.missionId,
            expectedGeneration: args.expectedGeneration,
            input: claimed.input,
        });
        return ctx.runMutation(internal.execution.operations.recordResult, {
            ...args,
            outcome,
        });
    },
});
