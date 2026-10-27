"use node";

import { internal } from "@convex/_generated/api";
import { internalAction } from "@convex/_generated/server";
import { sha256Hex } from "@convex/domain/sourcePassages";
import {
    invokeDeferredAgentTurn,
    rejectedOutputDiagnostic,
} from "@convex/integrations/modelInvocation";
import { missionRoutes } from "@convex/integrations/sourceQualificationConfig";
import { asSchema } from "ai";
import type { FunctionReturnType } from "convex/server";
import { type Infer, v } from "convex/values";
import { validate } from "convex-helpers/validators";
import { executionFailureCode } from "./authority";
import {
    invocationResponseValidator,
    MAX_CONTEXT_BYTES,
    MAX_OPERATION_RESULT_BYTES,
} from "./contracts";
import { savedMaterialInspectionDefinition } from "./definitions";

const replyValidator = v.object({
    response: invocationResponseValidator,
    rawOutputJson: v.optional(v.string()),
});

export const invoke = internalAction({
    args: {
        invocationId: v.id("agentInvocations"),
        expectedGeneration: v.number(),
    },
    returns: replyValidator,
    handler: async (ctx, args): Promise<Infer<typeof replyValidator>> => {
        const { invocation, mission } = await ctx.runQuery(
            internal.execution.invocations.forExecution,
            args,
        );
        const retainReply = async (reply: Infer<typeof replyValidator>) => {
            await ctx.runMutation(internal.execution.invocations.retainOutput, {
                ...args,
                responseJson: JSON.stringify(reply.response),
                ...(reply.rawOutputJson
                    ? { rawOutputJson: reply.rawOutputJson }
                    : {}),
            });
            return reply;
        };
        if (invocation.provenance === "simulation")
            return retainReply({
                response: await ctx.runQuery(
                    internal.execution.simulation.invoke,
                    args,
                ),
            });
        const route = missionRoutes[mission.definitionId];
        if (!route)
            return retainReply({
                response: { kind: "blocked", code: "missing_authorized_route" },
            });
        if (!process.env.OPENROUTER_API_KEY?.trim())
            return retainReply({
                response: { kind: "blocked", code: "missing_configuration" },
            });
        const definition = savedMaterialInspectionDefinition;
        const schemas = await Promise.all(
            Object.entries(definition.tools).map(async ([name, tool]) => ({
                name,
                description: tool.description,
                inputSchema: await asSchema<unknown>(tool.inputSchema)
                    .jsonSchema,
            })),
        );
        const envelope = JSON.stringify({
            instructions: definition.instructions,
            prompt: invocation.inputJson,
            tools: schemas,
        });
        if (new TextEncoder().encode(envelope).length > MAX_CONTEXT_BYTES)
            return retainReply({
                response: { kind: "blocked", code: "context_capacity" },
            });
        const attempt = {
            missionId: mission._id,
            invocationId: invocation._id,
            runId: mission.runId,
            corpusRevisionId: mission.corpusRevisionId,
            executionGeneration: mission.generation,
            workflowVersion: mission.definitionVersion,
            stepKey: "agent_reasoning",
            service: "model" as const,
            operation: "agent_reasoning",
            operationKey: `mission:${mission._id}:invocation:${invocation._id}:attempt:1`,
            attempt: 1,
            inputHash: sha256Hex(invocation.inputJson),
        };
        let admitted: FunctionReturnType<
            typeof internal.providerCalls.recordAttempt
        >;
        try {
            admitted = await ctx.runMutation(
                internal.providerCalls.recordAttempt,
                { ...attempt, status: "started" },
            );
        } catch (error) {
            const code = executionFailureCode(error);
            if (!code) throw error;
            return retainReply({ response: { kind: "blocked", code } });
        }
        if (!admitted.shouldExecute)
            return retainReply({
                response: {
                    kind: "blocked",
                    code: admitted.errorCode ?? "attempt_already_recorded",
                },
            });
        // Admission and call are separate transactions; recheck the generation immediately before I/O.
        try {
            await ctx.runQuery(
                internal.execution.invocations.forExecution,
                args,
            );
        } catch (error) {
            const code =
                executionFailureCode(error) ?? "execution_validation_failed";
            await ctx.runMutation(internal.providerCalls.recordAttempt, {
                ...attempt,
                status: "failed",
                errorCode: code,
                dispatchOutcome: "not_dispatched",
                retryable: false,
            });
            if (!executionFailureCode(error)) throw error;
            return retainReply({ response: { kind: "blocked", code } });
        }
        const result = await invokeDeferredAgentTurn({
            route,
            dependencies: {
                apiKey: process.env.OPENROUTER_API_KEY ?? "",
                signal: AbortSignal.timeout(
                    Math.max(1, mission.deadlineAt - Date.now()),
                ),
            },
            instructions: definition.instructions,
            prompt: invocation.inputJson,
            tools: definition.tools,
        });
        if (result.status === "blocked") {
            await ctx.runMutation(internal.providerCalls.recordAttempt, {
                ...attempt,
                status: "failed",
                errorCode: result.reason,
                dispatchOutcome: "not_dispatched",
                retryable: false,
            });
            return retainReply({
                response: { kind: "blocked", code: result.reason },
            });
        }
        await ctx.runMutation(internal.providerCalls.recordAttempt, {
            ...attempt,
            status: result.status,
            dispatchOutcome: result.dispatchOutcome,
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
            },
            ...(result.status === "failed"
                ? {
                      errorCode: result.errorCode,
                      retryable: result.retryable,
                      diagnostic: result.outputDiagnostic,
                  }
                : {}),
        });
        if (result.status === "failed")
            return retainReply({
                response: { kind: "blocked", code: result.errorCode },
                ...(result.outputDiagnostic
                    ? { rawOutputJson: JSON.stringify(result.outputDiagnostic) }
                    : {}),
            });
        const requests = result.toolRequests.map((call) => ({
            callId: call.toolCallId,
            name: call.toolName,
            inputJson: JSON.stringify(call.input ?? null),
        }));
        const rawOutputJson = JSON.stringify({
            assistantOutput: result.assistantOutput,
            requests,
        });
        if (
            new TextEncoder().encode(rawOutputJson).length >
            MAX_OPERATION_RESULT_BYTES
        )
            return retainReply({
                response: { kind: "blocked", code: "response_capacity" },
                rawOutputJson: JSON.stringify(
                    rejectedOutputDiagnostic(
                        "response_capacity",
                        rawOutputJson,
                    ),
                ),
            });
        if (requests.length)
            return retainReply({
                response: { kind: "operations", requests },
                rawOutputJson,
            });
        let decoded: unknown;
        try {
            decoded = JSON.parse(result.assistantOutput);
        } catch {
            decoded = null;
        }
        if (
            validate(invocationResponseValidator, decoded) &&
            (decoded.kind !== "complete" ||
                decoded.captureIds.every((id) =>
                    mission.inspectedCaptureIds.includes(id),
                ))
        )
            return retainReply({ response: decoded, rawOutputJson });
        return retainReply({
            response: { kind: "operations", requests: [] },
            rawOutputJson,
        });
    },
});
