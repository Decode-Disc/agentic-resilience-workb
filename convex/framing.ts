import { internal } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
    internalMutation,
    type MutationCtx,
    mutation,
    query,
} from "@convex/_generated/server";
import { framingContentValidator } from "@convex/domain/framingContracts";
import {
    applyFromWorkbenchInTx,
    saveFraming,
    validateFramingRequestKey,
} from "@convex/domain/framingCore";
import { researchStartBlock } from "@convex/domain/framingEditAuthority";
import { sha256Hex, stableStringify } from "@convex/domain/sourcePassages";
import { readPreparationConcurrency } from "@convex/domain/sourcePreparationAuthority";
import { activatedSourcesEnvelope } from "@convex/domain/sources";
import { SOURCES_COVERAGE_VERSION } from "@convex/domain/sourcesContracts";
import { coveragePresetValidator } from "@convex/domain/validators";
import { INITIAL_FRAMING_MESSAGE_KEY } from "@convex/domain/workbenchContracts";
import { requireDossierAuthority } from "@convex/execution/authority";
import { submitAuthorizedMessage } from "@convex/execution/conversations";
import { executionError } from "@convex/execution/errors";
import { recordResearchObservation } from "@convex/execution/researchControlCore";
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
            internal.researchLaunch.createFramingDossier,
            launchArgs,
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
        validateFramingRequestKey(args.requestKey);
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

/** Older workers expect a number. V3 dispatch preserves the retained receipt bytes. */
export const applyFromWorkbench = internalMutation({
    args: {
        requestId: v.id("agentOperationRequests"),
        expectedGeneration: v.number(),
    },
    returns: v.union(v.number(), v.string()),
    handler: applyFromWorkbenchInTx,
});
