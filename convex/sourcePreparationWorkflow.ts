import { vResultValidator, vWorkflowId } from "@convex-dev/workflow";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { SOURCE_COMPARISON_VERSION } from "./domain/sourceComparison";
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
        args: { preparationId: v.id("sourceSelectionProposalRebuilds") },
        returns: v.null(),
    })
    .handler(async (step, args): Promise<null> => {
        let configurationChecked = false;
        while (true) {
            const batch = await step.runMutation(
                internal.sourcePreparation.nextBatch,
                args,
            );
            if (batch.completed) return null;
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
                        );
                    for (let offset = 0; offset < targets.length; offset += 2) {
                        const outcomes = await Promise.all(
                            targets.slice(offset, offset + 2).map((target) =>
                                step.runAction(
                                    internal.sourcePreparationActions
                                        .compareSource,
                                    {
                                        preparationId: args.preparationId,
                                        sourceCaptureId: target.sourceCaptureId,
                                        qualificationTaskId:
                                            target.qualificationTaskId,
                                    },
                                    { retry: false },
                                ),
                            ),
                        );
                        await step.runMutation(
                            internal.sourcePreparation.recordComparisonResults,
                            {
                                ...args,
                                failures: outcomes.flatMap((outcome) =>
                                    outcome.status === "unavailable" &&
                                    outcome.reasonCode
                                        ? [outcome.reasonCode]
                                        : [],
                                ),
                            },
                        );
                        if (batch.progressEnabled)
                            await step.runMutation(
                                internal.sourcePreparation.recordProgress,
                                {
                                    ...args,
                                    phase: "comparison",
                                    current: Math.min(
                                        offset + 2,
                                        targets.length,
                                    ),
                                    total: targets.length,
                                },
                            );
                    }
                }
                if (batch.progressEnabled && batch.canSupplement)
                    await step.runMutation(
                        internal.sourcePreparation.recordProgress,
                        { ...args, phase: "supplement" },
                    );
                const supplement = batch.canSupplement
                    ? await step.runAction(
                          internal.sourcePreparationActions.searchSupplement,
                          args,
                          { retry: false },
                      )
                    : null;
                if (supplement?.status === "searched") continue;
                if (batch.progressEnabled)
                    await step.runMutation(
                        internal.sourcePreparation.recordProgress,
                        { ...args, phase: "proposal" },
                    );
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
                );
            const outcomes = await Promise.all(
                batch.sourceIds.map(async (sourceId) => {
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
            for (const outcome of outcomes) {
                const recorded = await step.runMutation(
                    internal.sourcePreparation.recordResult,
                    {
                        ...args,
                        outcome,
                    },
                );
                if (recorded === "deadline_elapsed") break;
            }
        }
    });
