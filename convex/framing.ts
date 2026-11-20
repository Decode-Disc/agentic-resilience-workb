import { internal } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import {
    internalMutation,
    type MutationCtx,
    mutation,
    query,
} from "@convex/_generated/server";
import { framingContentValidator } from "@convex/domain/framingContracts";
import {
    requireFramingEditAuthority,
    researchQuestionCapacity,
    researchStartBlock,
} from "@convex/domain/framingEditAuthority";
import {
    companyProvisionalProgram,
    framingBasisAfterEdit,
    prepareProvisionalFraming,
    validateFramingPublicBasis,
} from "@convex/domain/framingProvenance";
import { MAX_RESEARCH_PLAN_QUESTIONS } from "@convex/domain/researchPlan";
import { sha256Hex, stableStringify } from "@convex/domain/sourcePassages";
import { readPreparationConcurrency } from "@convex/domain/sourcePreparationAuthority";
import { activatedSourcesEnvelope } from "@convex/domain/sources";
import { SOURCES_COVERAGE_VERSION } from "@convex/domain/sourcesContracts";
import { coveragePresetValidator } from "@convex/domain/validators";
import {
    INITIAL_FRAMING_MESSAGE_KEY,
    supportsDirectedFraming,
    supportsFramingContractCorrections,
} from "@convex/domain/workbenchContracts";
import {
    requireDossierAuthority,
    requireMissionAuthority,
} from "@convex/execution/authority";
import {
    conversationInstructions,
    requireInstructionVersion,
    submitAuthorizedMessage,
} from "@convex/execution/conversations";
import { executionError } from "@convex/execution/errors";
import { recordContextObservation } from "@convex/execution/journal";
import { retainOperationEffect } from "@convex/execution/operations";
import { recordResearchObservation } from "@convex/execution/researchControl";
import { initialModelSelection } from "@convex/modelConfigurationSchema";
import { sourcePreparationEnabled } from "@convex/resourceLimits";
import { requireWorkspaceRun } from "@convex/runWorkspace";
import schema from "@convex/schema";
import { sourcesQualificationEnvelope } from "@convex/sourcesSimulation";
import { configuredPublicContextAllowance } from "@convex/workbenchPublicContext";
import { workflow } from "@convex/workflow";
import { type Infer, v } from "convex/values";

export const confirmCompany = mutation({
    args: {
        preflightId: v.id("companyPreflights"),
        modelSelection: v.optional(initialModelSelection),
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
        const { modelSelection, ...launchArgs } = args;
        const result = await ctx.runMutation(
            internal.researchLaunch.confirmAndStartReserved,
            { ...launchArgs, framingOnly: true },
        );
        await initializeFraming(ctx, result.runId, modelSelection);
        return result;
    },
});

/** Initializes the shared framing and analyst thread for an already-authorized dossier. */
export async function initializeFraming(
    ctx: MutationCtx,
    runId: Id<"researchRuns">,
    modelSelection?: Infer<typeof initialModelSelection>,
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
            ...(run.purpose !== "browser_test"
                ? { publicContextAllowance: configuredPublicContextAllowance() }
                : {}),
        });
    }
    await submitAuthorizedMessage(ctx, {
        runId: run._id,
        requestKey: INITIAL_FRAMING_MESSAGE_KEY,
        ...(modelSelection ? { initialModel: modelSelection } : {}),
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
        const startBlock = await researchStartBlock(ctx, run, framing, visitor);
        if (startBlock) throw executionError(startBlock);
        const qualifiedEnvelope = await sourcesQualificationEnvelope(ctx, run);
        const sourcesMissionEnvelope =
            qualifiedEnvelope ?? activatedSourcesEnvelope();
        if (!sourcesMissionEnvelope)
            throw executionError("sources_configuration_unavailable");
        const prepareSources = sourcePreparationEnabled();
        if (prepareSources) readPreparationConcurrency();
        const workflowId = await workflow.start(
            ctx,
            internal.researchWorkflow.run,
            {
                runId: run._id,
                executionGeneration: run.executionGeneration,
                prepareSources,
                sourcesEnvelope: sourcesMissionEnvelope,
                controlled: true,
            },
            {
                onComplete: internal.researchWorkflow.onComplete,
                context: { runId: run._id },
            },
        );
        await ctx.db.patch(run._id, {
            fixedFramingRevisionId: framing._id,
            sourcesProtocol: "sources_mission_v1",
            sourcesCoveragePolicyVersion: SOURCES_COVERAGE_VERSION,
            sourcesEnvelope: sourcesMissionEnvelope,
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
        if (!qualifiedEnvelope)
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
        await recordResearchObservation(ctx, run._id, "started", {
            type: "visitor",
            visitorId: visitor._id,
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
        eventBasis?: Doc<"framingRevisions">["eventBasis"];
    },
    origin: "analyst" | "workbench",
    actor?: Doc<"agentExecutionEvents">["actor"],
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
    const previous = await ctx.db
        .query("framingRevisions")
        .withIndex("by_run_and_key", (q) =>
            q.eq("runId", run._id).eq("requestKey", args.requestKey),
        )
        .unique();
    const current = run.currentFramingRevisionId
        ? await ctx.db.get(run.currentFramingRevisionId)
        : null;
    const baseline = previous ?? current;
    const eventBasis =
        args.eventBasis ??
        (baseline ? framingBasisAfterEdit(baseline, content) : undefined);
    const hash = sha256Hex(
        stableStringify(eventBasis ? { content, eventBasis } : content),
    );
    if (previous) {
        if (previous.contentHash !== hash)
            throw executionError("framing_identity_conflict");
        return previous.revision;
    }
    if (!current || current.revision !== args.expectedRevision)
        throw executionError("framing_version_conflict");
    // Only growth is refused, so a draft left over capacity by a configuration change can still be reworded or reduced.
    if (content.questions.length > current.content.questions.length) {
        const capacity = await researchQuestionCapacity(ctx, run);
        if (capacity !== null && content.questions.length > capacity)
            throw executionError("framing_question_capacity", [
                {
                    path: "content.questions",
                    expected: `At most ${capacity} research question${capacity === 1 ? "" : "s"}; documentary preparation cannot take on more in this workspace.`,
                },
            ]);
    }
    const revision = current.revision + 1;
    const id = await ctx.db.insert("framingRevisions", {
        runId: run._id,
        revision,
        content,
        ...(eventBasis ? { eventBasis } : {}),
        contentHash: hash,
        requestKey: args.requestKey,
        origin,
        createdAt: Date.now(),
    });
    await ctx.db.patch(run._id, {
        currentFramingRevisionId: id,
        updatedAt: Date.now(),
    });
    await recordContextObservation(ctx, run._id, {
        key: `framing:${id}`,
        topic: "framing",
        actor:
            actor ??
            (origin === "analyst" && run.ownerVisitorId
                ? { type: "visitor", visitorId: run.ownerVisitorId }
                : { type: "system" }),
        value: {
            revision,
            previousRevision: current.revision,
            origin,
            content,
            ...(eventBasis ? { eventBasis } : {}),
            fixed: false,
        },
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
        const { mission, run } = await requireMissionAuthority(
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
        const currentRevision = run.currentFramingRevisionId
            ? await ctx.db.get(run.currentFramingRevisionId)
            : null;
        if (
            !currentRevision ||
            currentRevision.revision !== request.input.expectedRevision
        )
            throw executionError("framing_version_conflict");
        const { messageId: causingMessageId } = request.input;
        let { content, eventBasis: proposedBasis } = request.input;
        if (
            !proposedBasis &&
            currentRevision.eventBasis?.kind === "open" &&
            currentRevision.content.scope === content.scope
        )
            proposedBasis = currentRevision.eventBasis;
        if (
            supportsDirectedFraming(mission.definitionVersion) &&
            proposedBasis?.kind === "open" &&
            proposedBasis.activityExcerpt === undefined &&
            proposedBasis.conditions === undefined &&
            currentRevision.content.scope.trim()
        ) {
            if (
                currentRevision.eventBasis?.kind !== "open" ||
                stableStringify(currentRevision.content) !==
                    stableStringify(content)
            )
                throw executionError("framing_open_preserve_program");
            proposedBasis = currentRevision.eventBasis;
        }
        if (
            proposedBasis?.kind === "open" &&
            !supportsDirectedFraming(mission.definitionVersion) &&
            (proposedBasis.activityExcerpt !== undefined ||
                proposedBasis.conditions !== undefined)
        )
            throw executionError("framing_event_basis_invalid");
        if (
            proposedBasis?.kind === "open" &&
            supportsDirectedFraming(mission.definitionVersion) &&
            (supportsFramingContractCorrections(mission.definitionVersion) ||
                proposedBasis.activityExcerpt !== undefined ||
                proposedBasis.conditions !== undefined ||
                currentRevision.content.scope.trim())
        ) {
            const prepared = await prepareProvisionalFraming(ctx, {
                basis: proposedBasis,
                content,
                current: currentRevision,
                mission,
                request,
                messageId: causingMessageId,
            });
            content = prepared.content;
            proposedBasis = prepared.basis;
        } else if (proposedBasis?.kind === "open") {
            if (
                currentRevision.origin !== "initial" &&
                (currentRevision.origin !== "workbench" ||
                    currentRevision.eventBasis?.kind !== "open")
            )
                throw executionError("framing_open_preserve_program");
            // The proposed wording may already assume an answer to the clarification.
            const company =
                run.companySnapshot?.legalName ?? "the selected company";
            content = companyProvisionalProgram(company);
        }
        if (request.operationVersion === 2)
            await requireFramingEditAuthority(ctx, mission, {
                messageId: causingMessageId,
                proposed: content,
            });
        if (
            !proposedBasis &&
            request.input.eventBasisRequired &&
            currentRevision.content.scope !== content.scope
        )
            throw executionError("framing_event_basis_required");
        let eventBasis: Doc<"framingRevisions">["eventBasis"];
        if (proposedBasis?.kind === "analyst") {
            const instructions = await conversationInstructions(ctx, mission);
            const message = instructions?.messages.find(
                ({ messageId }) => messageId === causingMessageId,
            );
            if (
                !message ||
                !proposedBasis.excerpt.trim() ||
                !message.text.includes(proposedBasis.excerpt)
            )
                throw executionError("framing_event_basis_invalid", [
                    {
                        path: "eventBasis.excerpt",
                        expected:
                            "Copy a nonblank exact excerpt identifying the event from the active analyst message; otherwise keep the event open or use adopted public readings.",
                    },
                ]);
            eventBasis = { ...proposedBasis, messageId: message.messageId };
        } else if (proposedBasis?.kind === "public") {
            eventBasis = await validateFramingPublicBasis(ctx, {
                basis: proposedBasis,
                current: currentRevision,
                scope: content.scope,
                mission,
                request,
                messageId: causingMessageId,
            });
        } else {
            eventBasis = proposedBasis;
        }
        const revision = await saveFraming(
            ctx,
            {
                runId: mission.runId,
                expectedRevision: request.input.expectedRevision,
                requestKey: `operation:${request._id}`,
                content,
                eventBasis,
            },
            "workbench",
            { type: "agent", missionId: mission._id },
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
            { revision },
        );
        return revision;
    },
});
