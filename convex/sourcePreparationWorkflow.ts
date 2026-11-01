import { awaitResearchControl } from "@convex/execution/researchControl";
import { vResultValidator, vWorkflowId } from "@convex-dev/workflow";
import type { FunctionReturnType } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { SOURCE_COMPARISON_VERSION } from "./domain/sourceComparison";
import { SOURCE_PREPARATION_SOURCE_ACTIONS_VERSION } from "./resourceLimits";
import { workflow } from "./workflow";

export const onComplete = internalMutation({
    args: {
        workflowId: vWorkflowId,
        result: vResultValidator,
        context: v.object({
            preparationId: v.id("sourceSelectionProposalRebuilds"),
        }),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        const preparation = await ctx.db.get(args.context.preparationId);
        if (
            preparation?.kind !== "preparation" ||
            preparation.workflowId !== args.workflowId
        )
            return null;
        await ctx.db.patch(preparation._id, { workflowId: undefined });
        if (args.result.kind === "success" || preparation.status !== "started")
            return null;
        const run = await ctx.db.get(preparation.runId);
        if (
            run?.sourcePreparationId !== preparation._id ||
            run.executionGeneration !== preparation.executionGeneration ||
            run.executionStatus !== "running"
        )
            return null;
        await ctx.db.patch(preparation._id, { stopCode: "preparation_failed" });
        await ctx.runMutation(internal.sourcePreparation.finish, {
            preparationId: preparation._id,
            expectedExecutionGeneration: preparation.executionGeneration,
        });
        return null;
    },
});

export const run = workflow
    .define({
        args: {
            preparationId: v.id("sourceSelectionProposalRebuilds"),
            controlRunId: v.optional(v.id("researchRuns")),
        },
        returns: v.null(),
    })
    .handler(async (step, { controlRunId, ...args }): Promise<null> => {
        let configurationChecked = false;
        // Bootstrap through the original scheduled step so historical journals replay unchanged.
        let inlineControls = false;
        while (true) {
            if (controlRunId)
                await awaitResearchControl(
                    step,
                    controlRunId,
                    args.preparationId,
                );
            const batch: FunctionReturnType<
                typeof internal.sourcePreparation.nextBatch
            > = await step.runMutation(
                internal.sourcePreparation.nextBatch,
                args,
                inlineControls ? { inline: true } : {},
            );
            if (batch.completed) return null;
            const checkpoint = async () => {
                if (controlRunId)
                    batch.executionGeneration = await awaitResearchControl(
                        step,
                        controlRunId,
                        args.preparationId,
                    );
            };
            inlineControls =
                batch.executionPlanVersion === "inline_controls_v2" ||
                batch.executionPlanVersion ===
                    SOURCE_PREPARATION_SOURCE_ACTIONS_VERSION;
            const controlOptions = inlineControls
                ? { inline: true as const }
                : {};
            const concurrency = batch.maxConcurrentSources ?? 2;
            if (
                !configurationChecked &&
                (batch.sourceIds.length > 0 || batch.canSupplement)
            ) {
                const configured = await step.runAction(
                    internal.sourcePreparationActions.checkConfiguration,
                    args,
                    { retry: false },
                );
                if (!configured) {
                    await step.runMutation(internal.sourcePreparation.finish, {
                        ...args,
                        expectedExecutionGeneration: batch.executionGeneration,
                        stopCode: "missing_configuration",
                    });
                    return null;
                }
                configurationChecked = true;
            }
            if (batch.sourceIds.length === 0) {
                const compareSources = async () => {
                    await checkpoint();
                    if (batch.comparisonVersion === SOURCE_COMPARISON_VERSION) {
                        const targets = await step.runQuery(
                            internal.sourcePreparation.comparisonTargets,
                            { ...args, now: Date.now() },
                        );
                        if (batch.progressEnabled && targets.length)
                            await step.runMutation(
                                internal.sourcePreparation.recordProgress,
                                {
                                    ...args,
                                    phase: "comparison",
                                    current: 0,
                                    total: targets.length,
                                },
                                controlOptions,
                            );
                        for (
                            let offset = 0;
                            offset < targets.length;
                            offset += concurrency
                        ) {
                            await checkpoint();
                            const outcomes = await Promise.all(
                                targets
                                    .slice(offset, offset + concurrency)
                                    .map((target) =>
                                        step.runAction(
                                            internal.sourcePreparationActions
                                                .compareSource,
                                            {
                                                preparationId:
                                                    args.preparationId,
                                                sourceCaptureId:
                                                    target.sourceCaptureId,
                                                qualificationTaskId:
                                                    target.qualificationTaskId,
                                            },
                                            { retry: false },
                                        ),
                                    ),
                            );
                            await step.runMutation(
                                internal.sourcePreparation
                                    .recordComparisonResults,
                                {
                                    ...args,
                                    failures: outcomes.flatMap((outcome) =>
                                        outcome.status === "unavailable" &&
                                        outcome.reasonCode
                                            ? [outcome.reasonCode]
                                            : [],
                                    ),
                                },
                                controlOptions,
                            );
                            if (batch.progressEnabled)
                                await step.runMutation(
                                    internal.sourcePreparation.recordProgress,
                                    {
                                        ...args,
                                        phase: "comparison",
                                        current: Math.min(
                                            offset + concurrency,
                                            targets.length,
                                        ),
                                        total: targets.length,
                                    },
                                    controlOptions,
                                );
                        }
                    }
                };
                if (!batch.executionPlanVersion) await compareSources();
                if (batch.progressEnabled && batch.canSupplement)
                    await step.runMutation(
                        internal.sourcePreparation.recordProgress,
                        { ...args, phase: "supplement" },
                        controlOptions,
                    );
                await checkpoint();
                const supplement = batch.canSupplement
                    ? await step.runAction(
                          internal.sourcePreparationActions.searchSupplement,
                          args,
                          { retry: false },
                      )
                    : null;
                if (supplement?.status === "searched") continue;
                if (batch.executionPlanVersion) await compareSources();
                if (batch.progressEnabled)
                    await step.runMutation(
                        internal.sourcePreparation.recordProgress,
                        { ...args, phase: "proposal" },
                        controlOptions,
                    );
                await checkpoint();
                await step.runMutation(internal.sourcePreparation.finish, {
                    ...args,
                    expectedExecutionGeneration: batch.executionGeneration,
                    ...(supplement?.status === "blocked"
                        ? {
                              stopCode: supplement.reasonCode,
                              retryAt: supplement.retryAt,
                          }
                        : {}),
                });
                return null;
            }
            if (batch.progressEnabled)
                await step.runMutation(
                    internal.sourcePreparation.recordProgress,
                    { ...args, phase: "reading" },
                    controlOptions,
                );
            const outcomes = await Promise.all(
                batch.sourceIds.map(async (sourceId) => {
                    if (
                        batch.executionPlanVersion ===
                        SOURCE_PREPARATION_SOURCE_ACTIONS_VERSION
                    ) {
                        return step.runAction(
                            internal.sourcePreparationActions.prepareSource,
                            { ...args, sourceId },
                            { retry: false },
                        );
                    }
                    const inspection = await step.runAction(
                        internal.sourcePreparationActions.inspectSource,
                        { ...args, sourceId },
                        { retry: false },
                    );
                    if (inspection.status === "unavailable")
                        return {
                            sourceId,
                            result: {
                                status: "unavailable" as const,
                                sourceCaptureId: inspection.sourceCaptureId,
                                reasonCode:
                                    inspection.reasonCode ??
                                    "inspection_unavailable",
                            },
                        };
                    if (!inspection.sourceCaptureId)
                        throw new Error("Inspected source has no capture");
                    const qualification = await step.runAction(
                        internal.sourcePreparationActions.qualifySource,
                        {
                            ...args,
                            sourceCaptureId: inspection.sourceCaptureId,
                        },
                        { retry: false },
                    );
                    return {
                        sourceId,
                        result: {
                            ...qualification,
                            sourceCaptureId: inspection.sourceCaptureId,
                        },
                    };
                }),
            );
            for (const [index, outcome] of outcomes.entries()) {
                const recorded = await step.runMutation(
                    internal.sourcePreparation.recordResult,
                    {
                        ...args,
                        outcome,
                    },
                    // A scheduled fourth save yields before another group of task-document reads.
                    inlineControls && index % 4 !== 3 ? { inline: true } : {},
                );
                if (recorded === "deadline_elapsed") break;
            }
        }
    });
