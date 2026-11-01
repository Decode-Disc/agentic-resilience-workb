"use node";

import { internal } from "@convex/_generated/api";
import { type ActionCtx, internalAction } from "@convex/_generated/server";
import { sha256Hex } from "@convex/domain/sourcePassages";
import { resolveAgentGenerationBackend } from "@convex/integrations/agentBackends";
import {
    configuredMissionRoute,
    missionRoutes,
    SIMULATION_MODEL_ROUTE,
} from "@convex/integrations/modelRouting";
import {
    agentInputByteLength,
    rejectedOutputDiagnostic,
} from "@convex/integrations/modelTransport";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { type Infer, v } from "convex/values";
import { validate } from "convex-helpers/validators";
import { getAgentDefinition } from "./agentCatalog";
import { type AgentDefinition, agentToolSchemas } from "./agentDefinition";
import { executionError, executionFailureCode } from "./authority";
import {
    type AgentGenerationBackend,
    type AgentGenerationObservation,
    type AgentGenerationResult,
    invocationReplyValidator,
    invocationResponseValidator,
    invocationStructureError,
    LEGACY_AGENT_BACKEND,
    MAX_CONTEXT_BYTES,
    MAX_OPERATION_RESULT_BYTES,
} from "./executionProtocol";

import { simulationFetch } from "./simulation";

function decodeReceivedReply(
    result: Extract<AgentGenerationResult, { status: "succeeded" }>,
    pi = false,
    auxiliary = false,
    textCompletion?: AgentDefinition["textCompletion"],
): {
    reply: Infer<typeof invocationReplyValidator>;
    errorCode?: string;
    diagnostic?: ReturnType<typeof rejectedOutputDiagnostic>;
} {
    const rawOutputJson = JSON.stringify({
        assistantOutput: result.assistantOutput,
        requests: result.requests,
        ...(result.backendOutputJson
            ? { backendOutputJson: result.backendOutputJson }
            : {}),
    });
    const invalid = (code: string, output: string) => {
        const diagnostic = rejectedOutputDiagnostic(code, output);
        return {
            reply: {
                response: { kind: "blocked" as const, code },
                rawOutputJson: JSON.stringify(diagnostic),
            },
            errorCode: code,
            diagnostic,
        };
    };
    if (
        new TextEncoder().encode(rawOutputJson).length >
        MAX_OPERATION_RESULT_BYTES
    )
        return invalid("response_capacity", rawOutputJson);
    let decoded: unknown;
    if (auxiliary) {
        decoded = { kind: "operations", requests: [] };
    } else if (result.requests.length) {
        decoded = { kind: "operations", requests: result.requests };
    } else if (textCompletion) {
        decoded = textCompletion(result.assistantOutput);
    } else {
        try {
            decoded = JSON.parse(result.assistantOutput);
        } catch {
            return invalid("invalid_output", result.assistantOutput);
        }
    }
    if (!validate(invocationResponseValidator, decoded))
        return invalid("invalid_output", result.assistantOutput);
    const structureError = invocationStructureError(decoded, pi);
    if (structureError) return invalid(structureError, rawOutputJson);
    return { reply: { response: decoded, rawOutputJson } };
}

export async function invokeControlledGeneration(
    ctx: ActionCtx,
    args: {
        invocationId: import("@convex/_generated/dataModel").Id<"agentInvocations">;
        expectedGeneration: number;
    },
    nativeBackend?: AgentGenerationBackend,
): Promise<Infer<typeof invocationReplyValidator>> {
    const { invocation, mission } = await ctx.runQuery(
        internal.execution.invocationLifecycle.forExecution,
        args,
    );
    const retainReply = async (
        reply: Infer<typeof invocationReplyValidator>,
    ) => {
        await ctx.runMutation(
            internal.execution.invocationLifecycle.retainOutput,
            {
                ...args,
                responseJson: JSON.stringify(reply.response),
                ...(reply.rawOutputJson
                    ? { rawOutputJson: reply.rawOutputJson }
                    : {}),
            },
        );
        return reply;
    };
    if (
        invocation.provenance === "simulation" &&
        !invocation.generationBackend
    ) {
        const recorded = await ctx.runMutation(
            internal.execution.invocationLifecycle.retainRequest,
            {
                ...args,
                requestJson: JSON.stringify({
                    version: 1,
                    provenance: "simulation",
                    input: JSON.parse(invocation.inputJson),
                }),
            },
        );
        if (recorded.kind === "blocked") throw executionError(recorded.code);
        return retainReply({
            response: await ctx.runQuery(
                internal.execution.simulation.invoke,
                args,
            ),
        });
    }
    const simulated = invocation.provenance === "simulation";
    const backend =
        nativeBackend ??
        resolveAgentGenerationBackend(
            invocation.generationBackend ?? LEGACY_AGENT_BACKEND,
        );
    if (!backend)
        return retainReply({
            response: {
                kind: "blocked",
                code: "generation_backend_unknown",
            },
        });
    const route = simulated
        ? {
              model: "simulation/controlled-turn",
              provider: "simulation",
              authorizedForAgent: true as const,
          }
        : configuredMissionRoute(mission.definitionId, missionRoutes);
    if (!route)
        return retainReply({
            response: { kind: "blocked", code: "missing_authorized_route" },
        });
    if (!simulated && !process.env.OPENROUTER_API_KEY?.trim())
        return retainReply({
            response: { kind: "blocked", code: "missing_configuration" },
        });
    const definition = getAgentDefinition(
        mission.definitionId,
        mission.definitionVersion,
    );
    const tools = agentToolSchemas(
        definition,
        JSON.parse(invocation.inputJson),
    );
    if (
        (await agentInputByteLength({
            instructions: definition.instructions,
            prompt: invocation.inputJson,
            operations: tools,
            nativeConversation: definition.nativeConversation,
            definitionVersion: definition.version,
            nativeRoute:
                mission.executionRuntime === "pi-durable"
                    ? simulated
                        ? SIMULATION_MODEL_ROUTE
                        : route
                    : undefined,
        })) > MAX_CONTEXT_BYTES
    )
        return retainReply({
            response: { kind: "blocked", code: "context_capacity" },
        });
    const attempt = {
        missionId: mission._id,
        invocationId: invocation._id,
        runId: mission.runId,
        ...(invocation.corpusRevisionId
            ? { corpusRevisionId: invocation.corpusRevisionId }
            : {}),
        executionGeneration: mission.generation,
        workflowVersion: mission.definitionVersion,
        stepKey:
            invocation.purpose === "compaction"
                ? "agent_compaction"
                : "agent_reasoning",
        service: "model" as const,
        operation:
            invocation.purpose === "compaction"
                ? "agent_compaction"
                : "agent_reasoning",
        operationKey: `mission:${mission._id}:invocation:${invocation._id}:attempt:1`,
        attempt: 1,
        inputHash: sha256Hex(invocation.inputJson),
    };
    const recordReply = async (
        reply: Infer<typeof invocationReplyValidator>,
        receipt: Omit<
            FunctionArgs<typeof internal.providerCalls.recordAttempt>,
            keyof typeof attempt
        >,
        observableReplyJson?: string,
    ) => {
        if (simulated) {
            await ctx.runMutation(
                internal.execution.invocationLifecycle.retainOutput,
                {
                    ...args,
                    responseJson: JSON.stringify(reply.response),
                    ...(reply.rawOutputJson
                        ? { rawOutputJson: reply.rawOutputJson }
                        : {}),
                    ...(observableReplyJson
                        ? {
                              observableReplyJson: JSON.stringify({
                                  ...JSON.parse(observableReplyJson),
                                  provenance: "simulation",
                              }),
                          }
                        : {}),
                },
            );
            return reply;
        }
        await ctx.runMutation(
            internal.execution.invocationLifecycle.recordModelReply,
            {
                attempt: { ...attempt, ...receipt },
                reply,
                ...(observableReplyJson ? { observableReplyJson } : {}),
            },
        );
        return reply;
    };
    let admitted: FunctionReturnType<
        typeof internal.providerCalls.recordAttempt
    >;
    if (!simulated) {
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
    }
    // Admission and call are separate transactions; recheck the generation immediately before I/O.
    try {
        await ctx.runQuery(
            internal.execution.invocationLifecycle.forExecution,
            args,
        );
    } catch (error) {
        const code =
            executionFailureCode(error) ?? "execution_validation_failed";
        const reply = await recordReply(
            { response: { kind: "blocked", code } },
            {
                status: "failed",
                errorCode: code,
                dispatchOutcome: "not_dispatched",
                retryable: false,
            },
        );
        if (!executionFailureCode(error)) throw error;
        return reply;
    }
    let observedReply: Infer<typeof invocationReplyValidator> | undefined;
    const recordObservation = async (result: AgentGenerationObservation) => {
        const received =
            result.status === "succeeded"
                ? decodeReceivedReply(
                      result,
                      backend.id === "pi-durable",
                      invocation.purpose === "compaction",
                      definition.textCompletion,
                  )
                : {
                      reply: {
                          response: {
                              kind: "blocked" as const,
                              code: result.errorCode,
                          },
                          ...(result.outputDiagnostic
                              ? {
                                    rawOutputJson: JSON.stringify(
                                        result.outputDiagnostic,
                                    ),
                                }
                              : result.backendOutputJson
                                ? {
                                      rawOutputJson: JSON.stringify({
                                          backendOutputJson:
                                              result.backendOutputJson,
                                      }),
                                  }
                                : {}),
                      },
                      errorCode: result.errorCode,
                      diagnostic: result.outputDiagnostic,
                  };
        observedReply = await recordReply(
            received.reply,
            {
                status: received.errorCode ? "failed" : "succeeded",
                dispatchOutcome: result.dispatchOutcome,
                latencyMs: result.latencyMs,
                reportedCost: result.reportedCost,
                httpStatus: result.httpStatus,
                retryAfterAt: result.retryAfterAt,
                usage: {
                    model: result.model,
                    resolvedModel: result.resolvedModel,
                    provider: result.provider,
                    inputTokens: result.inputTokens,
                    outputTokens: result.outputTokens,
                    reasoningTokens: result.reasoningTokens,
                    cachedInputTokens: result.cachedInputTokens,
                },
                ...(received.errorCode
                    ? {
                          errorCode: received.errorCode,
                          retryable:
                              result.status === "failed"
                                  ? result.retryable
                                  : true,
                          diagnostic: received.diagnostic,
                      }
                    : {}),
            },
            result.observableReplyJson,
        );
        return observedReply;
    };
    const simulatedResponse = simulated
        ? await ctx.runQuery(internal.execution.simulation.invoke, args)
        : undefined;
    let result: AgentGenerationResult;
    let dispatchRefusal: string | undefined;
    try {
        result = await backend.generate(
            {
                route,
                instructions: definition.instructions,
                prompt: invocation.inputJson,
                operations: tools,
            },
            {
                beforeDispatch: async (requestJson) => {
                    try {
                        const retained = await ctx.runMutation(
                            internal.execution.invocationLifecycle
                                .retainRequest,
                            {
                                ...args,
                                requestJson: simulated
                                    ? JSON.stringify({
                                          ...JSON.parse(requestJson),
                                          provenance: "simulation",
                                      })
                                    : requestJson,
                            },
                        );
                        if (retained.kind === "blocked")
                            throw executionError(retained.code);
                        await ctx.runQuery(
                            internal.execution.invocationLifecycle
                                .authorizeDispatch,
                            args,
                        );
                    } catch (error) {
                        dispatchRefusal = executionFailureCode(error);
                        throw error;
                    }
                },
                observe: async (observation) => {
                    await recordObservation(observation);
                },
                signal: AbortSignal.timeout(
                    Math.max(1, mission.deadlineAt - Date.now()),
                ),
            },
            {
                ctx,
                invocationId: invocation._id,
                expectedGeneration: args.expectedGeneration,
                transport: simulatedResponse
                    ? {
                          apiKey: "local-fixture",
                          fetch: simulationFetch(simulatedResponse),
                      }
                    : { apiKey: process.env.OPENROUTER_API_KEY ?? "" },
            },
        );
    } catch {
        if (dispatchRefusal)
            return recordReply(
                { response: { kind: "blocked", code: dispatchRefusal } },
                {
                    status: "failed",
                    errorCode: dispatchRefusal,
                    dispatchOutcome: "not_dispatched",
                    retryable: false,
                },
            );
        await ctx.runMutation(
            internal.execution.invocationLifecycle.noteBackendInterruption,
            args,
        );
        throw executionError("generation_backend_interrupted");
    }
    if (result.status === "blocked") {
        return recordReply(
            { response: { kind: "blocked", code: result.reason } },
            {
                status: "failed",
                errorCode: result.reason,
                dispatchOutcome: "not_dispatched",
                retryable: false,
            },
        );
    }
    return observedReply ?? recordObservation(result);
}

export const invoke = internalAction({
    args: {
        invocationId: v.id("agentInvocations"),
        expectedGeneration: v.number(),
    },
    returns: invocationReplyValidator,
    handler: (ctx, args) => invokeControlledGeneration(ctx, args),
});
