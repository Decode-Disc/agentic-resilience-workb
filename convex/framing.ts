import { internal } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
    internalMutation,
    type MutationCtx,
    mutation,
    query,
} from "@convex/_generated/server";
import { framingContentValidator } from "@convex/domain/framingContracts";
import { requireFramingEditAuthority } from "@convex/domain/framingEditAuthority";
import { MAX_RESEARCH_PLAN_QUESTIONS } from "@convex/domain/researchPlan";
import { sha256Hex, stableStringify } from "@convex/domain/sourcePassages";
import { readPreparationConcurrency } from "@convex/domain/sourcePreparationAuthority";
import { coveragePresetValidator } from "@convex/domain/validators";
import { getAgentDefinition } from "@convex/execution/agentCatalog";
import {
    requireDossierAuthority,
    requireMissionAuthority,
} from "@convex/execution/authority";
import {
    requireInstructionVersion,
    submitAuthorizedMessage,
} from "@convex/execution/conversations";
import { executionError } from "@convex/execution/errors";
import { retainOperationEffect } from "@convex/execution/operations";
import {
    MAX_ANALYSES_PER_VISITOR,
    sourcePreparationEnabled,
} from "@convex/resourceLimits";
import { requireWorkspaceRun } from "@convex/runWorkspace";
import schema from "@convex/schema";
import { workflow } from "@convex/workflow";
import { type Infer, v } from "convex/values";

export const confirmCompany = mutation({
    args: {
        preflightId: v.id("companyPreflights"),
        idempotencyKey: v.string(),
        coveragePreset: coveragePresetValidator,
        researchAngle: v.optional(v.string()),
        manualSourcePreparationIds: v.optional(
            v.array(v.id("manualSourcePreparations")),
        ),
    },
    returns: v.object({
        runId: v.id("researchRuns"),
        remainingAnalyses: v.number(),
    }),
    handler: async (
        ctx,
        args,
    ): Promise<{ runId: Id<"researchRuns">; remainingAnalyses: number }> => {
        const result = await ctx.runMutation(
            internal.researchLaunch.confirmAndStartReserved,
            { ...args, framingOnly: true },
        );
        await initializeFraming(ctx, result.runId);
        return result;
    },
});

/** Initializes the shared framing and analyst thread for an already-authorized dossier. */
export async function initializeFraming(
    ctx: MutationCtx,
    runId: Id<"researchRuns">,
) {
    const { run } = await requireDossierAuthority(ctx, runId);
    if (!run.currentFramingRevisionId) {
        const content = { scope: "", questions: [] };
        const revisionId = await ctx.db.insert("framingRevisions", {
            runId: run._id,
            revision: 1,
            content,
            requestKey: "initial",
            contentHash: sha256Hex(stableStringify(content)),
            origin: "initial",
            createdAt: Date.now(),
        });
        await ctx.db.patch(run._id, {
            currentFramingRevisionId: revisionId,
        });
    }
    await submitAuthorizedMessage(ctx, {
        runId: run._id,
        requestKey: "framing-intention",
        text:
            run.researchAngle ??
            `Study ${run.companySnapshot?.legalName ?? "the selected company"}.`,
        delivery: "queue",
    });
    await ctx.scheduler.runAfter(
        0,
        internal.execution.conversations.pumpWorkbench,
        { runId: run._id },
    );
}

export const save = mutation({
    args: {
        runId: v.id("researchRuns"),
        expectedRevision: v.number(),
        requestKey: v.string(),
        content: framingContentValidator,
    },
    returns: v.number(),
    handler: async (ctx, args): Promise<number> => {
        await requireWorkspaceRun(ctx, args.runId);
        return saveFraming(ctx, args, "analyst");
    },
});
export const startResearch = mutation({
    args: {
        runId: v.id("researchRuns"),
        expectedRevision: v.number(),
        requestKey: v.string(),
    },
    returns: v.id("researchRuns"),
    handler: async (ctx, args): Promise<Id<"researchRuns">> => {
        const { run, visitor } = await requireWorkspaceRun(ctx, args.runId);
        await requireDossierAuthority(ctx, run._id);
        validateKey(args.requestKey);
        const framing = run.currentFramingRevisionId
            ? await ctx.db.get(run.currentFramingRevisionId)
            : null;
        if (
            !framing ||
            framing.runId !== run._id ||
            framing.revision !== args.expectedRevision
        )
            throw executionError("framing_version_conflict");
        if (run.researchStartRequestKey) {
            if (run.researchStartRequestKey !== args.requestKey)
                throw executionError("framing_fixed");
            return run._id;
        }
        if (
            run.startMode !== "framed" ||
            run.lifecycleState !== "framing" ||
            run.executionStatus !== "idle"
        )
            throw executionError("framing_fixed");
        if (!framing.content.scope.trim() || !framing.content.questions.length)
            throw executionError("framing_invalid");
        if (visitor.analysesReserved >= MAX_ANALYSES_PER_VISITOR)
            throw executionError("analysis_limit_reached");
        const running = await ctx.db
            .query("researchRuns")
            .withIndex("by_owner_and_execution_status", (q) =>
                q
                    .eq("ownerVisitorId", visitor._id)
                    .eq("executionStatus", "running"),
            )
            .first();
        if (running) throw executionError("execution_slot_unavailable");
        const prepareSources = sourcePreparationEnabled();
        if (prepareSources) readPreparationConcurrency();
        const workflowId = await workflow.start(
            ctx,
            internal.researchWorkflow.run,
            {
                runId: run._id,
                executionGeneration: run.executionGeneration,
                prepareSources,
                controlled: true,
            },
            {
                onComplete: internal.researchWorkflow.onComplete,
                context: { runId: run._id },
            },
        );
        await ctx.db.patch(run._id, {
            fixedFramingRevisionId: framing._id,
            agentExecutionVersion: 3,
            researchStartedAt: Date.now(),
            researchStartRequestKey: args.requestKey,
            reservationStatus: "consumed",
            lifecycleState: "draft",
            executionStatus: "running",
            workflowId,
            nextEventSequence: run.nextEventSequence + 1,
            updatedAt: Date.now(),
        });
        await ctx.db.patch(visitor._id, {
            analysesReserved: visitor.analysesReserved + 1,
        });
        await ctx.db.insert("runEvents", {
            runId: run._id,
            sequence: run.nextEventSequence + 1,
            type: "run_transitioned",
            lifecycleState: "draft",
            executionStatus: "running",
            occurredAt: Date.now(),
        });
        await ctx.db.insert("auditEvents", {
            actor: { type: "visitor", visitorId: visitor._id },
            action: "analysis_reserved",
            targetType: "research_run",
            targetId: run._id,
            occurredAt: Date.now(),
        });
        return run._id;
    },
});

export const get = query({
    args: { runId: v.id("researchRuns") },
    returns: v.union(schema.doc("framingRevisions"), v.null()),
    handler: async (ctx, { runId }) => {
        const { run } = await requireWorkspaceRun(ctx, runId);
        return run.currentFramingRevisionId
            ? ctx.db.get(run.currentFramingRevisionId)
            : null;
    },
});

function validateKey(key: string) {
    if (!/^[a-zA-Z0-9._:-]{1,120}$/.test(key))
        throw executionError("invalid_request_key");
}

/** Persists a single versioned draft for both direct edits and Workbench operations. */
async function saveFraming(
    ctx: MutationCtx,
    args: {
        runId: Id<"researchRuns">;
        expectedRevision: number;
        requestKey: string;
        content: Infer<typeof framingContentValidator>;
    },
    origin: "analyst" | "workbench",
): Promise<number> {
    const { run } = await requireDossierAuthority(ctx, args.runId);
    if (run.startMode !== "framed" || run.lifecycleState !== "framing")
        throw executionError("framing_fixed");
    validateKey(args.requestKey);
    const content = args.content;
    if (
        content.questions.length > MAX_RESEARCH_PLAN_QUESTIONS ||
        new TextEncoder().encode(stableStringify(content)).length > 65536 ||
        content.questions.some(
            (q) =>
                !q.id.trim() ||
                !q.text.trim() ||
                !q.rationale.trim() ||
                !q.shortLabel.trim(),
        ) ||
        new Set(content.questions.map((q) => q.id)).size !==
            content.questions.length
    )
        throw executionError("framing_invalid");
    const hash = sha256Hex(stableStringify(content));
    const previous = await ctx.db
        .query("framingRevisions")
        .withIndex("by_run_and_key", (q) =>
            q.eq("runId", run._id).eq("requestKey", args.requestKey),
        )
        .unique();
    if (previous) {
        if (previous.contentHash !== hash)
            throw executionError("framing_identity_conflict");
        return previous.revision;
    }
    const current = run.currentFramingRevisionId
        ? await ctx.db.get(run.currentFramingRevisionId)
        : null;
    if (!current || current.revision !== args.expectedRevision)
        throw executionError("framing_version_conflict");
    const revision = current.revision + 1;
    const id = await ctx.db.insert("framingRevisions", {
        runId: run._id,
        revision,
        content,
        contentHash: hash,
        requestKey: args.requestKey,
        origin,
        createdAt: Date.now(),
    });
    await ctx.db.patch(run._id, {
        currentFramingRevisionId: id,
        updatedAt: Date.now(),
    });
    if (origin === "analyst") {
        const conversation = await ctx.db
            .query("agentConversations")
            .withIndex("by_run", (q) => q.eq("runId", run._id))
            .unique();
        const turn = conversation?.activeTurnId
            ? await ctx.db.get(conversation.activeTurnId)
            : null;
        if (turn?.status === "active")
            await ctx.db.patch(turn._id, {
                instructionVersion: turn.instructionVersion + 1,
            });
    }
    return revision;
}
export const applyFromWorkbench = internalMutation({
    args: {
        requestId: v.id("agentOperationRequests"),
        expectedGeneration: v.number(),
    },
    returns: v.number(),
    handler: async (ctx, args): Promise<number> => {
        const request = await ctx.db.get(args.requestId);
        if (!request?.missionId || request.input.kind !== "adjust_framing")
            throw executionError("operation_not_allowed");
        const { mission } = await requireMissionAuthority(
            ctx,
            request.missionId,
            args.expectedGeneration,
        );
        if (mission.definitionId !== "workbench_v1")
            throw executionError("operation_not_allowed");
        await requireInstructionVersion(
            ctx,
            mission,
            request.instructionVersion,
        );
        if (request.effect?.outcome.kind === "success") {
            const value: unknown = JSON.parse(request.effect.outcome.valueJson);
            if (
                !value ||
                typeof value !== "object" ||
                !("revision" in value) ||
                typeof value.revision !== "number"
            )
                throw executionError("operation_result_conflict");
            return value.revision;
        }
        if (
            getAgentDefinition(mission.definitionId, mission.definitionVersion)
                .nativeConversation
        )
            await requireFramingEditAuthority(ctx, mission, {
                messageId: request.input.messageId,
                proposed: request.input.content,
            });
        const revision = await saveFraming(
            ctx,
            {
                runId: mission.runId,
                expectedRevision: request.input.expectedRevision,
                requestKey: `operation:${request._id}`,
                content: request.input.content,
            },
            "workbench",
        );
        const current = await ctx.db.get(mission.runId);
        if (!current?.currentFramingRevisionId)
            throw executionError("framing_version_conflict");
        await retainOperationEffect(
            ctx,
            request,
            {
                kind: "framing_revision",
                revisionId: current.currentFramingRevisionId,
            },
            JSON.stringify({ revision }),
        );
        return revision;
    },
});
