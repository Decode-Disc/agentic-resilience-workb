import { readResponseFacts, selectedCorrection } from "./responseControlCore";

export { projectWorkbenchCompletionAdmission } from "./domain/workbenchCompletionAdmission";
export {
    activeResponseControl,
    completeResponseControl,
    readResponseFacts,
    recoverCorrectionDraft,
    rejectedDraft,
    responseControlContext,
    selectedCorrection,
} from "./responseControlCore";

import { internal } from "@convex/_generated/api";
import {
    internalMutation,
    internalQuery,
    query,
} from "@convex/_generated/server";
import { requireAdmin } from "@convex/administrationAuthority";
import { sha256Hex, stableStringify } from "@convex/domain/sourcePassages";
import {
    responseControlPolicy,
    responseControlState,
    responseReviewResult,
} from "@convex/domain/workbenchResponseControlContracts";
import { requireMissionAuthority } from "@convex/execution/authority";
import { executionError } from "@convex/execution/errors";
import { generationAuthorityValidator } from "@convex/execution/executionProtocol";
import { invocationResponseManifest } from "@convex/execution/journal";
import { readResponseControlPolicy } from "@convex/execution/modelConfigurationCore";
import { retainedTextFragment } from "@convex/execution/retainedText";
import {
    providerAttemptValidator,
    requireQualifiedBrowserMission,
} from "@convex/providerCalls";
import { v } from "convex/values";

/** Reads correction authority from the active turn and its current instructions. */
export const correctionFragment = internalQuery({
    args: {
        missionId: v.id("agentMissions"),
        expectedGeneration: v.number(),
        contentHash: v.string(),
        index: v.number(),
    },
    returns: v.object({
        content: v.string(),
        contentHash: v.string(),
        sizeBytes: v.number(),
        characters: v.number(),
        fragmentCount: v.number(),
    }),
    handler: async (ctx, args) => {
        const { mission } = await requireMissionAuthority(
            ctx,
            args.missionId,
            args.expectedGeneration,
        );
        const selected = await selectedCorrection(ctx, mission);
        if (!selected.correction)
            throw executionError("mission_context_changed");
        const { original, textId, inline } = selected;
        if (textId) {
            const text = await invocationResponseManifest(
                ctx,
                original,
                textId,
                "response",
            );
            if (
                text.contentHash !== args.contentHash ||
                (inline !== undefined && sha256Hex(inline) !== text.contentHash)
            )
                throw executionError("mission_context_changed");
            return {
                content: await retainedTextFragment(ctx, text, args.index),
                contentHash: text.contentHash,
                sizeBytes: text.sizeBytes,
                characters: text.characters,
                fragmentCount: text.fragmentHashes.length,
            };
        }
        if (
            inline === undefined ||
            args.index !== 0 ||
            sha256Hex(inline) !== args.contentHash
        )
            throw executionError("mission_context_changed");
        return {
            content: inline,
            contentHash: args.contentHash,
            sizeBytes: new TextEncoder().encode(inline).length,
            characters: inline.length,
            fragmentCount: 1,
        };
    },
});

const reviewJob = v.object({
    authority: generationAuthorityValidator,
    requestId: v.id("agentOperationRequests"),
    missionId: v.id("agentMissions"),
    invocationId: v.id("agentInvocations"),
    runId: v.id("researchRuns"),
    generation: v.number(),
    workflowVersion: v.number(),
    corpusRevisionId: v.optional(v.id("corpusRevisions")),
    requestJson: v.string(),
    requestHash: v.string(),
    policy: responseControlPolicy,
});
/** Resolves the persisted host request; callers cannot submit replacement facts, prompts or policy. */
export const forExecution = internalQuery({
    args: {
        requestId: v.id("agentOperationRequests"),
        expectedGeneration: v.number(),
    },
    returns: reviewJob,
    handler: async (ctx, args) => {
        const request = await ctx.db.get(args.requestId);
        if (
            !request?.missionId ||
            request.actor !== "system" ||
            request.input.kind !== "check_response_coherence" ||
            request.status !== "running"
        )
            throw executionError("operation_not_allowed");
        const { mission } = await requireMissionAuthority(
            ctx,
            request.missionId,
            args.expectedGeneration,
        );
        const invocation = await ctx.db.get(request.input.invocationId);
        const turn = mission.conversationTurnId
            ? await ctx.db.get(mission.conversationTurnId)
            : null;
        const invocationId = request.input.invocationId;
        const check = turn?.responseControl?.checks.find(
            (c) =>
                c.requestId === request._id && c.invocationId === invocationId,
        );
        if (
            !invocation ||
            invocation.missionId !== mission._id ||
            invocation.generation !== mission.generation ||
            !check?.requestJson ||
            !check.requestHash ||
            check.requestId !== request._id ||
            sha256Hex(check.requestJson) !== check.requestHash ||
            sha256Hex(check.factsJson) !== check.factsHash
        )
            throw executionError("response_review_unavailable");
        if (
            !(await readResponseControlPolicy(ctx)).enabled ||
            !turn?.responseControl?.policy.enabled
        )
            throw executionError("controller_disabled");
        const run = await ctx.db.get(mission.runId);
        if (!run) throw executionError("run_unavailable");
        const qualification = await requireQualifiedBrowserMission(
            ctx,
            run,
            mission,
        );
        const currentFacts = await readResponseFacts(ctx, mission, run);
        if (
            currentFacts.kind !== "ready" ||
            sha256Hex(currentFacts.factsJson) !== check.factsHash
        )
            throw executionError("response_review_stale");
        return {
            authority: {
                resourcePolicy: mission.resourcePolicy,
                deadlineAt: Math.min(
                    mission.deadlineAt,
                    request.deadlineAt ?? 0,
                    qualification?.deadlineAt ?? Infinity,
                ),
            },
            requestId: request._id,
            missionId: mission._id,
            invocationId: invocation._id,
            runId: mission.runId,
            generation: invocation.generation,
            workflowVersion: mission.definitionVersion,
            corpusRevisionId: invocation.corpusRevisionId,
            requestJson: check.requestJson,
            requestHash: check.requestHash,
            policy: turn.responseControl.policy,
        };
    },
});

/** Response observation and factual billing settle atomically; business adoption remains operation-owned. */
export const settle = internalMutation({
    args: {
        requestId: v.id("agentOperationRequests"),
        attempt: providerAttemptValidator,
        result: responseReviewResult,
    },
    returns: responseReviewResult,
    handler: async (ctx, { requestId, attempt, result }) => {
        const request = await ctx.db.get(requestId);
        const mission = request?.missionId
            ? await ctx.db.get(request.missionId)
            : null;
        const turn = mission?.conversationTurnId
            ? await ctx.db.get(mission.conversationTurnId)
            : null;
        const state = turn?.responseControl;
        const check = state?.checks.find((c) => c.requestId === requestId);
        if (
            !turn ||
            !state ||
            !check ||
            attempt.operationRequestId !== requestId ||
            result.providerCallId === undefined
        )
            throw executionError("response_review_unavailable");
        const settled = await ctx.runMutation(
            internal.providerCalls.recordAttempt,
            attempt,
        );
        if (settled.providerCallId !== result.providerCallId)
            throw executionError("attempt_identity_conflict");
        if (
            check.observation &&
            stableStringify(check.observation) !== stableStringify(result)
        )
            throw executionError("attempt_result_conflict");
        check.observation = result;
        await ctx.db.patch(turn._id, { responseControl: state });
        return result;
    },
});

/** Exact drafts remain in their invocation records; this protected view exposes the bounded linked audit. */
export const audit = query({
    args: { turnId: v.id("agentConversationTurns") },
    returns: v.union(responseControlState, v.null()),
    handler: async (ctx, { turnId }) => {
        await requireAdmin(ctx);
        return (await ctx.db.get(turnId))?.responseControl ?? null;
    },
});
