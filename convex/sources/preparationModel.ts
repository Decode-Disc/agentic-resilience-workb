"use node";

import { internal } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import type { ActionCtx } from "@convex/_generated/server";
import {
    preparationBudgetOutcome,
    preparationFailureCode,
    sourcePreparationError,
} from "@convex/domain/sourcePreparationAuthority";
import { executionFailureCode } from "@convex/execution/errors";
import type { DocumentaryControlAttempt } from "@convex/integrations/documentaryControl";
import type { AttemptDependencies } from "@convex/integrations/modelTransport";
import type {
    QualificationAttemptResult,
    SourceComparisonAttemptResult,
} from "@convex/integrations/sourceQualification";
import type { SourceQualificationRoute } from "@convex/integrations/sourceQualificationConfig";
import { revisionRoute } from "@convex/modelConfiguration";
import { resolveGenerationAuthority } from "@convex/resourcePolicy";

type PreparationModelReceipt = {
    latencyMs: number;
    reportedCost?: number;
    usage: unknown;
};

/** Owns dispatch admission, pinned routing, bounded technical retry and receipts for structured documentary tasks. */
export async function executePreparationModel<
    Result extends
        | QualificationAttemptResult
        | SourceComparisonAttemptResult
        | DocumentaryControlAttempt,
>(
    ctx: ActionCtx,
    input: {
        preparation: Doc<"sourceSelectionProposalRebuilds">;
        executionDeadlineAt: number;
        operationRequestId?: Id<"agentOperationRequests">;
        sourceId: Id<"sources">;
        operation:
            | "source_qualification"
            | "source_comparison"
            | "source_documentary_control";
        inputHash: string;
        invocationInputJson: string;
        validate?: () => Promise<void>;
        execute: (
            route: SourceQualificationRoute,
            dependencies: Pick<
                AttemptDependencies,
                | "authority"
                | "signal"
                | "beforeDispatch"
                | "observeProvider"
                | "onVisibleText"
                | "finishVisibleOutput"
            >,
        ) => Promise<Result>;
    },
): Promise<
    | {
          result: Result;
          providerCallId: Id<"providerCalls">;
          receipt: PreparationModelReceipt;
      }
    | {
          reasonCode: string;
          diagnosticReason?: string;
          providerCallId?: Id<"providerCalls">;
          receipt?: PreparationModelReceipt;
      }
> {
    const { preparation } = input;
    let providerCallId: Id<"providerCalls"> | undefined;
    let receipt: PreparationModelReceipt | undefined;
    let firstAttempt: number | undefined;
    while (true) {
        const execution = resolveGenerationAuthority(
            preparation,
            Date.now(),
            input.executionDeadlineAt,
        );
        if (execution.kind === "blocked")
            return { reasonCode: execution.code, providerCallId, receipt };
        const plan = await ctx.runQuery(
            internal.providerCalls.nextPreparationAttemptForInput,
            {
                preparationId: preparation._id,
                sourceId: input.sourceId,
                operation: input.operation,
                inputHash: input.inputHash,
                now: Date.now(),
            },
        );
        if (!plan.attempt)
            return {
                reasonCode: plan.errorCode ?? "preparation_unavailable",
                diagnosticReason: plan.diagnosticReason,
                providerCallId,
                receipt,
            };
        firstAttempt ??= plan.attempt;
        await input.validate?.();
        let configured: Doc<"modelRevisions">;
        try {
            configured = await ctx.runMutation(
                internal.modelConfiguration.forPreparation,
                {
                    preparationId: preparation._id,
                    expectedGeneration: preparation.executionGeneration,
                },
            );
        } catch (error) {
            const code =
                preparationFailureCode(error) ?? executionFailureCode(error);
            if (code === "stale_execution")
                return { reasonCode: code, providerCallId, receipt };
            if (code === "model_unavailable" || code === "model_not_compatible")
                return {
                    reasonCode: "missing_configuration",
                    providerCallId,
                    receipt,
                };
            throw error;
        }
        const route: SourceQualificationRoute = {
            ...revisionRoute(configured),
            executionPlanVersion: preparation.executionPlanVersion,
        };
        const attempt = {
            ...(input.operationRequestId
                ? { operationRequestId: input.operationRequestId }
                : {}),
            inputHash: input.inputHash,
            runId: preparation.runId,
            corpusRevisionId: preparation.corpusRevisionId,
            sourceId: input.sourceId,
            preparationId: preparation._id,
            executionGeneration: preparation.executionGeneration,
            workflowVersion: preparation.workflowVersion,
            stepKey: "source_preparation",
            service: "model" as const,
            operation: input.operation,
            operationKey: `${preparation.operationKey}:step:${input.operation === "source_comparison" ? "source_comparison" : "source_preparation"}:input:${input.inputHash}:attempt:${plan.attempt}`,
            attempt: plan.attempt,
        };
        const claimed = await ctx.runMutation(
            internal.providerCalls.recordAttempt,
            { ...attempt, status: "started" },
        );
        providerCallId = claimed.providerCallId;
        if (!claimed.shouldExecute)
            return {
                reasonCode: claimed.errorCode ?? "attempt_already_recorded",
                providerCallId,
                receipt,
            };
        const invocationId = await ctx.runMutation(
            internal.execution.invocationLifecycle.beginOneShot,
            {
                providerCallId,
                inputJson: input.invocationInputJson,
            },
        );
        let result: Result | undefined;
        let providerIdentityObserved = false;
        try {
            const deadlineAt = Math.min(
                claimed.deadlineAt ?? 0,
                input.executionDeadlineAt,
            );
            result = await input.execute(route, {
                authority: {
                    resourcePolicy: preparation.resourcePolicy,
                    deadlineAt,
                },
                signal: AbortSignal.timeout(
                    Math.max(1, deadlineAt - Date.now()),
                ),
                onVisibleText: async (text, sequence) => {
                    await ctx.runMutation(
                        internal.execution.invocationLifecycle
                            .appendVisibleOutput,
                        { invocationId, sequence, text },
                    );
                },
                finishVisibleOutput: async (complete, terminalReason) => {
                    await ctx.runMutation(
                        internal.execution.invocationLifecycle
                            .sealVisibleOutput,
                        { invocationId, complete, terminalReason },
                    );
                },
                beforeDispatch: async (requestJson, metadata) => {
                    const retained = await ctx.runMutation(
                        internal.execution.invocationLifecycle.retainRequest,
                        {
                            invocationId,
                            expectedGeneration: preparation.executionGeneration,
                            requestJson,
                            effectiveMaxOutputTokens:
                                metadata?.effectiveMaxOutputTokens,
                        },
                    );
                    if (retained.kind === "blocked")
                        throw sourcePreparationError(retained.code);
                    await ctx.runQuery(
                        internal.execution.invocationLifecycle
                            .authorizeDispatch,
                        {
                            invocationId,
                            expectedGeneration: preparation.executionGeneration,
                        },
                    );
                },
                observeProvider: async (observation) => {
                    await ctx.runMutation(
                        internal.providerCalls.observeGeneration,
                        { invocationId, ...observation },
                    );
                    providerIdentityObserved ||=
                        observation.generationId !== undefined;
                },
            });
        } finally {
            if (providerIdentityObserved && result === undefined)
                await ctx.runMutation(internal.providerCalls.requestBilling, {
                    invocationId,
                });
        }
        receipt = {
            latencyMs: result.latencyMs,
            reportedCost: result.reportedCost,
            usage: {
                model: result.model,
                resolvedModel: result.resolvedModel,
                provider: result.provider,
                inputTokens: result.inputTokens,
                outputTokens: result.outputTokens,
                reasoningTokens: result.reasoningTokens,
                cachedInputTokens: result.cachedInputTokens,
                inputHash: input.inputHash,
            },
        };
        if (result.status === "not_run") {
            await ctx.runMutation(
                internal.execution.invocationLifecycle.finishOneShot,
                {
                    invocationId,
                    attempt: {
                        ...attempt,
                        ...receipt,
                        status: "failed",
                        errorCode: result.reason,
                        dispatchOutcome: "not_dispatched",
                        retryable: false,
                    },
                    outputJson: JSON.stringify({
                        status: result.status,
                        reason: result.reason,
                        output: result.output,
                    }),
                },
            );
            return { result, providerCallId, receipt };
        }
        await ctx.runMutation(
            internal.execution.invocationLifecycle.finishOneShot,
            {
                invocationId,
                ...(result.observableReplyJson
                    ? { observableReplyJson: result.observableReplyJson }
                    : {}),
                attempt: {
                    ...attempt,
                    ...receipt,
                    status: result.status,
                    dispatchOutcome: result.dispatchOutcome,
                    httpStatus: result.httpStatus,
                    retryAfterAt: result.retryAfterAt,
                    ...(result.status === "failed"
                        ? {
                              errorCode: result.errorCode,
                              retryable: result.retryable,
                              diagnostic: result.outputDiagnostic,
                          }
                        : {}),
                },
                outputJson: JSON.stringify(
                    result.status === "succeeded"
                        ? {
                              status: result.status,
                              result:
                                  "qualification" in result
                                      ? result.qualification
                                      : result.output,
                          }
                        : {
                              status: result.status,
                              errorCode: result.errorCode,
                              diagnostic: result.outputDiagnostic ?? null,
                          },
                ),
            },
        );
        if (result.status === "succeeded")
            return { result, providerCallId, receipt };
        if (
            firstAttempt !== 1 ||
            plan.attempt !== 1 ||
            !result.retryable ||
            preparationBudgetOutcome(result) === "reserved"
        )
            return {
                reasonCode: result.errorCode,
                diagnosticReason: result.outputDiagnostic?.reason,
                providerCallId,
                receipt,
            };
    }
}
