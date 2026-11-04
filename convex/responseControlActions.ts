"use node";
import { internal } from "@convex/_generated/api";
import { internalAction } from "@convex/_generated/server";
import {
    RESPONSE_CONTROL_LIMITS,
    responseReviewOperationKey,
    responseReviewResult,
} from "@convex/domain/workbenchResponseControlContracts";
import { executionFailureCode } from "@convex/execution/errors";
import { MODEL_MAX_INPUT_PRICE_PER_MILLION } from "@convex/integrations/modelRouting";
import { createBoundedModelFetch } from "@convex/integrations/modelTransport";
import { checkResponseCoherence } from "@convex/integrations/responseCoherence";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { type Infer, v } from "convex/values";

/** No retry loop: shared operation identity and provider receipts retain every admitted attempt. */
export const execute = internalAction({
    args: {
        requestId: v.id("agentOperationRequests"),
        expectedGeneration: v.number(),
    },
    returns: responseReviewResult,
    handler: async (ctx, args): Promise<Infer<typeof responseReviewResult>> => {
        let job: FunctionReturnType<
            typeof internal.responseControl.forExecution
        >;
        try {
            job = await ctx.runQuery(
                internal.responseControl.forExecution,
                args,
            );
        } catch (error) {
            const code = executionFailureCode(error);
            if (!code) throw error;
            return { status: "unavailable", reason: code };
        }
        const apiKey = process.env.OPENROUTER_API_KEY;
        if (!apiKey)
            return { status: "unavailable", reason: "missing_configuration" };
        // Catalogue validation is non-inference I/O and precedes paid admission.
        try {
            const fetchCatalogue = createBoundedModelFetch(
                {},
                { responseTooLarge: false },
            );
            const response = await fetchCatalogue(
                "https://openrouter.ai/api/v1/models?output_modalities=decisions",
                {
                    signal: AbortSignal.timeout(
                        RESPONSE_CONTROL_LIMITS.timeoutMs,
                    ),
                },
            );
            if (!response.ok)
                return {
                    status: "unavailable",
                    reason: "configuration_unavailable",
                };
            const catalogue: unknown = await response.json();
            const entries =
                catalogue &&
                typeof catalogue === "object" &&
                "data" in catalogue &&
                Array.isArray(catalogue.data)
                    ? catalogue.data
                    : [];
            const model: unknown = entries.find(
                (m: unknown) =>
                    m &&
                    typeof m === "object" &&
                    "id" in m &&
                    m.id === job.policy.model,
            );
            const pricing =
                model && typeof model === "object" && "pricing" in model
                    ? model.pricing
                    : undefined;
            if (
                !pricing ||
                typeof pricing !== "object" ||
                !("prompt" in pricing) ||
                !("completion" in pricing) ||
                !Number.isFinite(Number(pricing.prompt)) ||
                Number(pricing.prompt) < 0 ||
                Number(pricing.prompt) * 1e6 >
                    MODEL_MAX_INPUT_PRICE_PER_MILLION ||
                Number(pricing.completion) !== 0
            )
                return {
                    status: "unavailable",
                    reason: "configuration_unavailable",
                };
        } catch {
            return {
                status: "unavailable",
                reason: "configuration_unavailable",
            };
        }
        const identity = {
            operationRequestId: job.requestId,
            missionId: job.missionId,
            invocationId: job.invocationId,
            runId: job.runId,
            corpusRevisionId: job.corpusRevisionId,
            executionGeneration: job.generation,
            workflowVersion: job.workflowVersion,
            inputHash: job.requestHash,
            operation: "response_coherence",
            stepKey: "response_coherence",
            service: "model" as const,
            operationKey: responseReviewOperationKey(job.requestId),
            attempt: 1,
        };
        let admitted: FunctionReturnType<
            typeof internal.providerCalls.recordAttempt
        >;
        try {
            admitted = await ctx.runMutation(
                internal.providerCalls.recordAttempt,
                { ...identity, status: "started" },
            );
        } catch (error) {
            const code = executionFailureCode(error);
            if (!code) throw error;
            return { status: "unavailable", reason: code };
        }
        if (!admitted.shouldExecute)
            return {
                status: "unavailable",
                reason: admitted.errorCode ?? "attempt_outcome_unknown",
                providerCallId: admitted.providerCallId,
            };
        let settlement:
            | FunctionArgs<typeof internal.providerCalls.recordAttempt>
            | undefined;
        let dispatched = false;
        try {
            await ctx.runQuery(internal.responseControl.forExecution, args);
            dispatched = true;
            const response = await checkResponseCoherence({
                requestJson: job.requestJson,
                apiKey,
            });
            settlement = {
                ...identity,
                status: response.status === "checked" ? "succeeded" : "failed",
                dispatchOutcome: "response_received",
                reportedCost: response.reportedCost,
                usage: response.usage,
                latencyMs: response.latencyMs,
                httpStatus: response.httpStatus,
                errorCode:
                    response.status === "unavailable"
                        ? response.reason
                        : undefined,
            };
            const observation = {
                rawResponseJson: response.rawResponseJson,
                model: response.model,
                providerCallId: admitted.providerCallId,
            };
            const result =
                response.status === "checked"
                    ? {
                          ...observation,
                          status: "checked" as const,
                          scores: response.scores,
                      }
                    : {
                          ...observation,
                          status: "unavailable" as const,
                          reason: response.reason,
                      };
            return await ctx.runMutation(internal.responseControl.settle, {
                requestId: job.requestId,
                attempt: settlement,
                result,
            });
        } catch (error) {
            // A lost settlement acknowledgement must never overwrite known response facts.
            if (settlement)
                return {
                    status: "unavailable",
                    reason: "settlement_unconfirmed",
                    providerCallId: admitted.providerCallId,
                };
            const reason = dispatched
                ? "attempt_outcome_unknown"
                : (executionFailureCode(error) ?? "not_dispatched");
            await ctx.runMutation(internal.providerCalls.recordAttempt, {
                ...identity,
                status: "failed",
                errorCode: reason,
                retryable: false,
                ...(!dispatched
                    ? { dispatchOutcome: "not_dispatched" as const }
                    : {}),
            });
            return {
                status: "unavailable",
                reason,
                providerCallId: admitted.providerCallId,
            };
        }
    },
});
