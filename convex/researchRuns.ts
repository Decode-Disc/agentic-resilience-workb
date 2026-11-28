import { readSourcesDecisionRequestId } from "@convex/execution/approvalCore";
import {
    applyRequestedResearchPause,
    recordResearchObservation,
} from "@convex/execution/researchControlCore";
import { sourcesSettlementBlock } from "@convex/sourcesMission";
import type { IndexRangeBuilder } from "convex/server";
import {
    paginationOptsValidator,
    paginationResultValidator,
} from "convex/server";
import { type Infer, v } from "convex/values";
import { stream } from "convex-helpers/server/stream";
import type { DataModel, Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { mergeRunCompanyMetadata } from "./domain/companyMetadata";
import { applyEvidenceExtractionFailed } from "./domain/evidenceFailure";
import {
    readSourcesMission,
    settledSourcesPhase,
    sourcesPreparationPhase,
} from "./domain/sources";
import {
    assertLifecycleTransition,
    canStartNewCorpusRevision,
} from "./domain/transitions";
import {
    companySnapshotValidator,
    executionStatusValidator,
    researchRunLifecycleValidator,
    sourcesPhaseValidator,
    workflowStepKeyValidator,
} from "./domain/validators";
import { readWorkspace, requireWorkspaceRun } from "./runWorkspace";
import schema from "./schema";

export const createDraft = internalMutation({
    args: {},
    returns: v.id("researchRuns"),
    handler: async (ctx) => {
        const now = Date.now();
        const runId = await ctx.db.insert("researchRuns", {
            purpose: "research",
            executionGeneration: 0,
            lifecycleState: "draft",
            executionStatus: "idle",
            nextEventSequence: 1,
            createdAt: now,
            updatedAt: now,
        });
        await ctx.db.insert("runEvents", {
            runId,
            sequence: 1,
            type: "run_created",
            lifecycleState: "draft",
            executionStatus: "idle",
            occurredAt: now,
        });
        return runId;
    },
});

export const pauseForClaimGenerationUnavailable = internalMutation({
    args: {
        runId: v.id("researchRuns"),
        expectedExecutionGeneration: v.number(),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        const run = await ctx.db.get(args.runId);
        if (!run) {
            throw new Error("Research run not found");
        }
        if (run.executionGeneration !== args.expectedExecutionGeneration) {
            throw new Error("Stale research execution generation");
        }
        if (
            run.lifecycleState === "extracting_evidence" &&
            run.executionStatus === "paused" &&
            run.pauseReason === "claim_generation_unavailable"
        ) {
            return null;
        }
        if (
            run.lifecycleState !== "extracting_evidence" ||
            run.executionStatus !== "running"
        ) {
            throw new Error("Research run is not extracting evidence");
        }
        const now = Date.now();
        await ctx.db.patch(run._id, {
            executionStatus: "paused",
            pauseReason: "claim_generation_unavailable",
            nextEventSequence: run.nextEventSequence + 1,
            updatedAt: now,
        });

        const existingStep = await ctx.db
            .query("workflowSteps")
            .withIndex("by_run_and_key", (query) =>
                query.eq("runId", run._id).eq("key", "generate_claims"),
            )
            .order("desc")
            .first();
        if (existingStep) {
            await ctx.db.patch(existingStep._id, {
                state: "needs_review",
                completedAt: undefined,
                updatedAt: now,
            });
        } else {
            await ctx.db.insert("workflowSteps", {
                runId: run._id,
                key: "generate_claims",
                state: "needs_review",
                attempt: 1,
                startedAt: now,
                updatedAt: now,
            });
        }

        await ctx.db.insert("runEvents", {
            runId: run._id,
            sequence: run.nextEventSequence + 1,
            type: "claim_generation_paused",
            lifecycleState: run.lifecycleState,
            executionStatus: "paused",
            stepKey: "generate_claims",
            occurredAt: now,
        });
        return null;
    },
});

export const failEvidenceExtraction = internalMutation({
    args: {
        runId: v.id("researchRuns"),
        expectedExecutionGeneration: v.number(),
        failureCode: v.string(),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        await applyEvidenceExtractionFailed(ctx, args);
        return null;
    },
});

const transitionArgs = {
    runId: v.id("researchRuns"),
    expectedExecutionGeneration: v.number(),
    lifecycleState: researchRunLifecycleValidator,
    executionStatus: executionStatusValidator,
    stepKey: workflowStepKeyValidator,
};

export async function transitionResearchRun(
    ctx: MutationCtx,
    args: {
        runId: Id<"researchRuns">;
        expectedExecutionGeneration: number;
        lifecycleState: Infer<typeof researchRunLifecycleValidator>;
        executionStatus: Infer<typeof executionStatusValidator>;
        stepKey: Infer<typeof workflowStepKeyValidator>;
    },
): Promise<null> {
    const run = await ctx.db.get(args.runId);
    if (!run) {
        throw new Error("Research run not found");
    }
    if (run.executionGeneration !== args.expectedExecutionGeneration) {
        throw new Error("Stale research execution generation");
    }
    if (
        run.executionStatus === "cancelled" ||
        run.executionStatus === "failed"
    ) {
        throw new Error("Research run execution is terminal");
    }
    assertLifecycleTransition(
        run.lifecycleState,
        args.lifecycleState,
        args.executionStatus,
    );

    const sourceReview =
        args.lifecycleState === "awaiting_source_review" &&
        args.executionStatus === "paused";
    const settledRun = sourceReview
        ? await applyRequestedResearchPause(ctx, run)
        : run;

    const now = Date.now();
    const pauseReason =
        args.lifecycleState === "awaiting_evidence_sufficiency_review"
            ? ("evidence_sufficiency_review" as const)
            : args.lifecycleState === "awaiting_source_review"
              ? ("source_review" as const)
              : args.lifecycleState === "awaiting_assessment_review"
                ? ("assessment_review" as const)
                : undefined;
    await ctx.db.patch(args.runId, {
        lifecycleState: args.lifecycleState,
        executionStatus: args.executionStatus,
        pauseReason:
            sourceReview && settledRun.pauseReason === "analyst"
                ? "analyst"
                : pauseReason,
        nextEventSequence: run.nextEventSequence + 1,
        updatedAt: now,
    });
    const previousSteps = await ctx.db
        .query("workflowSteps")
        .withIndex("by_run_and_key", (query) => query.eq("runId", args.runId))
        .collect();
    for (const step of previousSteps) {
        if (step.state === "running") {
            await ctx.db.patch(step._id, {
                state: "completed",
                completedAt: now,
                updatedAt: now,
            });
        }
    }
    await ctx.db.insert("workflowSteps", {
        runId: args.runId,
        key: args.stepKey,
        state:
            args.executionStatus === "paused"
                ? "needs_review"
                : args.executionStatus === "completed" ||
                    args.executionStatus === "idle"
                  ? "completed"
                  : "running",
        attempt: 1,
        startedAt: now,
        completedAt:
            args.executionStatus === "completed" ||
            args.executionStatus === "idle"
                ? now
                : undefined,
        updatedAt: now,
    });
    await ctx.db.insert("runEvents", {
        runId: args.runId,
        sequence: run.nextEventSequence + 1,
        type: "run_transitioned",
        lifecycleState: args.lifecycleState,
        executionStatus: args.executionStatus,
        stepKey: args.stepKey,
        occurredAt: now,
    });
    if (
        run.lifecycleState !== args.lifecycleState ||
        run.executionStatus !== args.executionStatus
    )
        await recordResearchObservation(ctx, run._id, "phase_changed");
    return null;
}

export const transition = internalMutation({
    args: transitionArgs,
    returns: v.null(),
    handler: (ctx, args) => transitionResearchRun(ctx, args),
});

export const get = internalQuery({
    args: { runId: v.id("researchRuns") },
    handler: async (ctx, args) => ctx.db.get(args.runId),
});

export const listEvents = internalQuery({
    args: { runId: v.id("researchRuns") },
    handler: async (ctx, args) =>
        ctx.db
            .query("runEvents")
            .withIndex("by_run_and_sequence", (query) =>
                query.eq("runId", args.runId),
            )
            .collect(),
});

export const listSteps = internalQuery({
    args: { runId: v.id("researchRuns") },
    handler: async (ctx, args) =>
        ctx.db
            .query("workflowSteps")
            .withIndex("by_run_and_key", (builder) =>
                builder.eq("runId", args.runId),
            )
            .collect(),
});

export const listMyEvents = query({
    args: { runId: v.id("researchRuns") },
    handler: async (ctx, args) => {
        const { run } = await requireWorkspaceRun(ctx, args.runId);
        return ctx.db
            .query("runEvents")
            .withIndex("by_run_and_sequence", (builder) =>
                builder.eq("runId", run._id),
            )
            .collect();
    },
});

async function framingScope(ctx: QueryCtx, run: Doc<"researchRuns">) {
    const id = run.fixedFramingRevisionId ?? run.currentFramingRevisionId;
    if (!id) return null;
    const revision = await ctx.db.get(id);
    if (!revision || revision.runId !== run._id)
        throw new Error("Invalid dossier framing reference");
    return revision.content.scope.trim() || null;
}

async function projectRun(ctx: QueryCtx, run: Doc<"researchRuns">) {
    const company = run.companyId ? await ctx.db.get(run.companyId) : null;
    const companySnapshot = mergeRunCompanyMetadata(
        run.companySnapshot,
        company,
    );
    const latestFailures = await ctx.db
        .query("providerCalls")
        .withIndex("by_run_and_status_and_created_at", (q) =>
            q.eq("runId", run._id).eq("status", "failed"),
        )
        .order("desc")
        .take(5);
    const cutoff = latestFailures.at(-1)?.createdAt;
    const newerFailures = latestFailures
        .filter((call) => cutoff !== undefined && call.createdAt > cutoff)
        .sort(
            (left, right) =>
                right.createdAt - left.createdAt ||
                left._creationTime - right._creationTime,
        );
    // The old stable sort kept insertion order for ties, including ties across the fifth result.
    const cutoffFailures =
        cutoff === undefined
            ? []
            : await ctx.db
                  .query("providerCalls")
                  .withIndex("by_run_and_status_and_created_at", (q) =>
                      q
                          .eq("runId", run._id)
                          .eq("status", "failed")
                          .eq("createdAt", cutoff),
                  )
                  .order("asc")
                  .take(5 - newerFailures.length);
    const providerFailures = [...newerFailures, ...cutoffFailures].map(
        (call) => ({
            service: call.service,
            operation: call.operation,
            errorCode: call.errorCode,
            occurredAt: call.completedAt ?? call.createdAt,
        }),
    );
    return {
        runId: run._id,
        company: companySnapshot
            ? {
                  legalName: companySnapshot.legalName,
                  ticker: companySnapshot.ticker,
                  exchange: companySnapshot.exchange,
                  cik: companySnapshot.cik,
                  investorRelationsUrl: companySnapshot.investorRelationsUrl,
                  websiteUrl: companySnapshot.websiteUrl,
                  websiteUrlSource: companySnapshot.websiteUrlSource,
              }
            : null,
        lifecycleState: run.lifecycleState,
        executionStatus: run.executionStatus,
        startMode: run.startMode,
        sourcesProtocol: run.sourcesProtocol,
        pauseReason: run.pauseReason,
        coveragePreset: run.coveragePreset,
        researchAngle: run.researchAngle,
        framingScope: await framingScope(ctx, run),
        activeCorpusRevisionId: run.activeCorpusRevisionId,
        completionOutcome: run.completionOutcome,
        updatedAt: run.updatedAt,
        providerFailures,
    };
}

export const getMine = query({
    args: { runId: v.id("researchRuns") },
    handler: async (ctx, args) => {
        const { run } = await requireWorkspaceRun(ctx, args.runId);
        const projection = await projectRun(ctx, run);
        const revision = run.activeCorpusRevisionId
            ? await ctx.db.get(run.activeCorpusRevisionId)
            : null;
        const [preparation, mission] = await Promise.all([
            run.sourcePreparationId
                ? ctx.db.get(run.sourcePreparationId)
                : null,
            readSourcesMission(ctx, run),
        ]);
        const sourcesPhase = sourcesPreparationPhase(run, preparation, mission);
        return {
            ...projection,
            executionGeneration: run.executionGeneration,
            sourcesSettlementAvailable:
                (await sourcesSettlementBlock(ctx, run)) === null,
            sourcesPhase,
            sourcesDecisionRequestId: await readSourcesDecisionRequestId(
                ctx,
                run,
            ),
            corpusRevisionStatus: revision?.status,
            canStartNewCorpusRevision: canStartNewCorpusRevision(
                run,
                revision?.status,
            ),
        };
    },
});

const runProjectionValidator = v.object({
    startMode: v.optional(v.literal("framed")),
    sourcesProtocol:
        schema.tables.researchRuns.validator.fields.sourcesProtocol,
    runId: v.id("researchRuns"),
    company: v.union(companySnapshotValidator, v.null()),
    lifecycleState: researchRunLifecycleValidator,
    executionStatus: executionStatusValidator,
    pauseReason: schema.tables.researchRuns.validator.fields.pauseReason,
    coveragePreset: schema.tables.researchRuns.validator.fields.coveragePreset,
    researchAngle: v.optional(v.string()),
    framingScope: v.union(v.string(), v.null()),
    activeCorpusRevisionId: v.optional(v.id("corpusRevisions")),
    sourcesPhase: v.optional(sourcesPhaseValidator),
    completionOutcome:
        schema.tables.researchRuns.validator.fields.completionOutcome,
    updatedAt: v.number(),
    providerFailures: v.array(
        v.object({
            service: schema.tables.providerCalls.validator.fields.service,
            operation: v.string(),
            errorCode: schema.tables.providerCalls.validator.fields.errorCode,
            occurredAt: v.number(),
        }),
    ),
});

export const listMine = query({
    args: {
        workspaceKey: v.string(),
        search: v.optional(v.string()),
        paginationOpts: paginationOptsValidator,
    },
    returns: paginationResultValidator(runProjectionValidator),
    handler: async (ctx, args) => {
        const { visitor, workspace } = await readWorkspace(ctx);
        if (
            args.workspaceKey !== workspace.key ||
            (workspace.isTestData && !workspace.contextId)
        ) {
            return { page: [], isDone: true, continueCursor: "" };
        }
        if ((args.search?.length ?? 0) > 200)
            throw new Error("Dossier search is too long");
        const ownerRange = (
            q: IndexRangeBuilder<
                Doc<"researchRuns">,
                DataModel["researchRuns"]["indexes"]["by_owner_purpose_context_withdrawn_updated_at"]
            >,
        ) =>
            q
                .eq("ownerVisitorId", visitor._id)
                .eq("purpose", workspace.purpose)
                .eq("browserTestContextId", workspace.contextId ?? undefined)
                .eq("withdrawnAt", undefined);
        const query = stream(ctx.db, schema)
            .query("researchRuns")
            .withIndex(
                "by_owner_purpose_context_withdrawn_updated_at",
                ownerRange,
            )
            .order("desc");
        const words =
            args.search
                ?.trim()
                .toLocaleLowerCase("en")
                .split(/\s+/)
                .filter(Boolean) ?? [];
        const result = words.length
            ? await query
                  .filterWith(async (run) => {
                      const company = run.companyId
                          ? await ctx.db.get(run.companyId)
                          : null;
                      const metadata = mergeRunCompanyMetadata(
                          run.companySnapshot,
                          company,
                      );
                      const text = [
                          metadata?.legalName,
                          metadata?.ticker,
                          run.researchAngle,
                          await framingScope(ctx, run),
                      ]
                          .filter(Boolean)
                          .join(" ")
                          .toLocaleLowerCase("en");
                      return words.every((word) => text.includes(word));
                  })
                  .paginate({ ...args.paginationOpts, maximumRowsRead: 100 })
            : await ctx.db
                  .query("researchRuns")
                  .withIndex(
                      "by_owner_purpose_context_withdrawn_updated_at",
                      ownerRange,
                  )
                  .order("desc")
                  .paginate(args.paginationOpts);
        return {
            ...result,
            page: await Promise.all(
                result.page.map(async (run) => {
                    const projection = await projectRun(ctx, run);
                    if (
                        run.lifecycleState !== "sources_prepared" ||
                        !run.sourcePreparationId ||
                        !run.sourcesProtocol
                    )
                        return projection;
                    const preparation = await ctx.db.get(
                        run.sourcePreparationId,
                    );
                    return {
                        ...projection,
                        sourcesPhase: settledSourcesPhase(
                            preparation?.runId === run._id ? preparation : null,
                        ),
                    };
                }),
            ),
        };
    },
});

export const listAnalyzedCompanies = listMine;
