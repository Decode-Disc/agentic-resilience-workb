"use node";

import { internal } from "@convex/_generated/api";
import type { ActionCtx } from "@convex/_generated/server";
import { sha256Hex } from "@convex/domain/sourcePassages";
import { SIMULATION_MODEL_ROUTE } from "@convex/integrations/modelRouting";
import { rejectedOutputDiagnostic } from "@convex/integrations/modelTransport";
import { revisionRoute } from "@convex/modelConfiguration";
import { resolveGenerationAuthority } from "@convex/resourcePolicy";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import type { Infer } from "convex/values";
import { validate } from "convex-helpers/validators";
import { getAgentDefinition } from "./agentCatalog";
import {
    type AgentDefinition,
    agentToolSchemas,
    SUBMIT_COMPLETION_TOOL,
} from "./agentDefinition";
import { executionError, executionFailureCode } from "./authority";
import {
    type AgentGenerationBackend,
    type AgentGenerationObservation,
    type AgentGenerationResult,
    type invocationReplyValidator,
    invocationResponseValidator,
    invocationStructureError,
} from "./executionProtocol";

import { retainedTextParts } from "./retainedText";
import { simulationFetch } from "./simulation";

function decodeReceivedReply(
    result: Extract<AgentGenerationResult, { status: "succeeded" }>,
    auxiliary: boolean,
    definition: Pick<AgentDefinition, "textCompletion" | "completionTransport">,
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
    let decoded: unknown;
    if (auxiliary) {
        decoded = { kind: "operations", requests: [] };
    } else if (definition.completionTransport === "native_tool") {
        if (result.requests.length === 0) {
            decoded = { kind: "completion_submission", call: null };
        } else if (
            result.requests.length === 1 &&
            result.requests[0]?.name === SUBMIT_COMPLETION_TOOL
        ) {
            const [call] = result.requests;
            decoded = {
                kind: "completion_submission",
                call: { callId: call.callId, inputJson: call.inputJson },
            };
        } else {
            decoded = { kind: "operations", requests: result.requests };
        }
    } else if (result.requests.length) {
        decoded = { kind: "operations", requests: result.requests };
    } else if (definition.textCompletion) {
        decoded = definition.textCompletion(result.assistantOutput);
    } else {
        try {
            decoded = JSON.parse(result.assistantOutput);
        } catch {
            return invalid("invalid_output", result.assistantOutput);
        }
    }
    if (!validate(invocationResponseValidator, decoded))
        return invalid("invalid_output", result.assistantOutput);
    const structureError = invocationStructureError(decoded, true);
    if (structureError) return invalid(structureError, rawOutputJson);
    return { reply: { response: decoded, rawOutputJson } };
}

export async function invokeControlledGeneration(
    ctx: ActionCtx,
    args: {
        invocationId: import("@convex/_generated/dataModel").Id<"agentInvocations">;
        expectedGeneration: number;
    },
    executionDeadlineAt: number,
    backend: AgentGenerationBackend,
): Promise<Infer<typeof invocationReplyValidator>> {
    const {
        invocation,
        mission,
        authority: grantedAuthority,
    } = await ctx.runQuery(
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
    const execution = resolveGenerationAuthority(
        grantedAuthority,
        Date.now(),
        executionDeadlineAt,
    );
    if (execution.kind === "blocked")
        return retainReply({
            response: { kind: "blocked", code: execution.code },
        });
    const authority = {
        resourcePolicy: grantedAuthority.resourcePolicy,
        deadlineAt: execution.deadlineAt,
    };
    const simulated = invocation.provenance === "simulation";
    const configuredModel = simulated
        ? null
        : await ctx.runQuery(internal.modelConfiguration.forMission, {
              missionId: mission._id,
          });
    const route = simulated
        ? {
              ...SIMULATION_MODEL_ROUTE,
              model: "simulation/controlled-turn",
              authorizedForAgent: true as const,
          }
        : configuredModel
          ? revisionRoute(configuredModel)
          : undefined;
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
        if (!admitted) return retainReply(reply);
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
    let admitted:
        | FunctionReturnType<typeof internal.providerCalls.recordAttempt>
        | undefined;
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
                      invocation.purpose === "compaction",
                      definition,
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
        if (result.status === "failed" && result.backendOutputJson)
            received.reply.rawOutputJson = JSON.stringify({
                ...(received.reply.rawOutputJson
                    ? { diagnostic: JSON.parse(received.reply.rawOutputJson) }
                    : {}),
                backendOutputJson: result.backendOutputJson,
            });
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
                beforeDispatch: async (requestJson, metadata) => {
                    try {
                        if (Date.now() >= executionDeadlineAt)
                            throw executionError("node_action_deadline");
                        const effectiveMaxOutputTokens =
                            metadata?.effectiveMaxOutputTokens;
                        if (
                            !Number.isSafeInteger(effectiveMaxOutputTokens) ||
                            (effectiveMaxOutputTokens ?? 0) < 1
                        )
                            throw executionError("invalid_model_output_limit");
                        const json = simulated
                            ? JSON.stringify({
                                  ...JSON.parse(requestJson),
                                  provenance: "simulation",
                              })
                            : requestJson;
                        let textId:
                            | import("@convex/_generated/dataModel").Id<"retainedTexts">
                            | undefined;
                        if (
                            new TextEncoder().encode(json).length >
                            512 * 1024
                        ) {
                            const { manifest, parts } = retainedTextParts(json);
                            for (const [index, content] of parts.entries())
                                textId = await ctx.runMutation(
                                    internal.execution.invocationLifecycle
                                        .stageRequest,
                                    {
                                        ...args,
                                        fragment: {
                                            ...manifest,
                                            index,
                                            content,
                                        },
                                    },
                                );
                        }
                        const retained = await ctx.runMutation(
                            internal.execution.invocationLifecycle
                                .retainRequest,
                            {
                                ...args,
                                ...(textId
                                    ? { textId }
                                    : { requestJson: json }),
                                ...(effectiveMaxOutputTokens !== undefined
                                    ? { effectiveMaxOutputTokens }
                                    : {}),
                            },
                        );
                        if (retained.kind === "blocked")
                            throw executionError(retained.code);
                        if (!simulated) {
                            admitted = await ctx.runMutation(
                                internal.providerCalls.recordAttempt,
                                { ...attempt, status: "started" },
                            );
                            if (!admitted.shouldExecute)
                                throw executionError(
                                    admitted.errorCode ??
                                        "attempt_already_recorded",
                                );
                        }
                        await ctx.runQuery(
                            internal.execution.invocationLifecycle
                                .authorizeDispatch,
                            args,
                        );
                        if (Date.now() >= executionDeadlineAt)
                            throw executionError("node_action_deadline");
                    } catch (error) {
                        dispatchRefusal = executionFailureCode(error);
                        throw error;
                    }
                },
                observe: async (observation) => {
                    await recordObservation(observation);
                },
                observeProvider: simulated
                    ? undefined
                    : async (observation) => {
                          await ctx.runMutation(
                              internal.providerCalls.observeGeneration,
                              { invocationId: invocation._id, ...observation },
                          );
                      },
                signal: AbortSignal.timeout(
                    Math.max(1, authority.deadlineAt - Date.now()),
                ),
            },
            {
                authority,
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
        if (!simulated)
            await ctx.runMutation(internal.providerCalls.requestBilling, {
                invocationId: invocation._id,
            });
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
