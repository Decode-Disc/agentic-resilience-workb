"use node";

import type { Doc } from "@convex/_generated/dataModel";
import { providerRetryAfterAt } from "@convex/domain/sourcePreparationAuthority";
import {
    executionError,
    executionFailureCode,
    protectedDiagnostic,
} from "@convex/execution/errors";
import type {
    AgentGenerationLifecycle,
    AgentGenerationObservation,
    ModelAttemptReceipt,
} from "@convex/execution/executionProtocol";
import {
    MAX_PREPARATION_DIAGNOSTIC_BYTES,
    MODEL_NON_STREAMING_RESPONSE_MAX_BYTES,
    MODEL_SETTLEMENT_GRACE_MS,
    resolveGenerationAuthority,
    TEXT_FRAGMENT_CHARACTERS,
} from "@convex/resourcePolicy";
import { estimateTextTokens } from "@earendil-works/pi-ai/utils/estimate";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { TextStreamPart, ToolSet } from "ai";
import {
    APICallError,
    JSONParseError,
    NoObjectGeneratedError,
    Output,
    streamText,
    wrapLanguageModel,
} from "ai";
import type { ZodType } from "zod";
import { readOpenRouterApiKey } from "./openRouterConfiguration";
import type { SourceQualificationRoute } from "./sourceQualificationConfig";

export { agentInputByteLength, agentOperationInputSchema } from "./modelInput";

import type { ModelRoute } from "./modelRouting";
import { modelCallSettings, preparationModelOutputLimit } from "./modelRouting";

export type AttemptReceipt = ModelAttemptReceipt;

export type ProviderResponse = {
    status: number;
    body: string;
    requestId?: string;
    generationId?: string;
};

export type AttemptDependencies = {
    onVisibleText?: (text: string, sequence: number) => Promise<void>;
    finishVisibleOutput?: (
        complete: boolean,
        terminalReason?: string,
    ) => Promise<void>;
    authority?: Pick<Doc<"agentMissions">, "resourcePolicy" | "deadlineAt">;
    apiKey: string;
    fetch?: typeof fetch;
    signal?: AbortSignal;
    onResponse?: (response: ProviderResponse) => void;
    onHeaders?: (
        response: Omit<ProviderResponse, "body">,
    ) => Promise<void> | void;
    beforeDispatch?: AgentGenerationLifecycle["beforeDispatch"];
    onObservation?: (observation: AgentGenerationObservation) => Promise<void>;
    observeProvider?: AgentGenerationLifecycle["observeProvider"];
};

export type OneShotDependencies = Omit<AttemptDependencies, "apiKey"> & {
    apiKey?: string;
};

export type StructuredAttempt<T> =
    | (AttemptReceipt & {
          status: "succeeded";
          value: T;
          assistantOutput: string;
      })
    | (AttemptReceipt & {
          status: "failed";
          errorCode: string;
          retryable: boolean;
      });

/** Retains assistant output only; provider envelopes and hidden reasoning are never persisted. */
export function rejectedOutputDiagnostic(
    reason: string,
    text?: string,
    finishReason?: string,
): NonNullable<Doc<"providerCalls">["diagnostic"]> {
    const bytes = new TextEncoder().encode(text ?? "");
    let end = Math.min(bytes.length, MAX_PREPARATION_DIAGNOSTIC_BYTES);
    while (end < bytes.length && end > 0 && ((bytes[end] ?? 0) & 0xc0) === 0x80)
        end--;
    return {
        reason,
        ...(finishReason ? { finishReason } : {}),
        ...(text !== undefined
            ? { output: new TextDecoder().decode(bytes.subarray(0, end)) }
            : {}),
        originalBytes: bytes.length,
        truncated: end < bytes.length,
    };
}

/** Applies the same terminal-response acceptance policy after each SDK has normalized its reply. */
export function generationObservation(
    receipt: AttemptReceipt,
    reply: Pick<
        Extract<AgentGenerationObservation, { status: "succeeded" }>,
        "assistantOutput" | "requests"
    > & { finishReason: string; argumentsError?: string },
): AgentGenerationObservation {
    if (receipt.httpStatus !== undefined && receipt.httpStatus >= 400)
        return httpResponseFailure(receipt, receipt.httpStatus);
    if (reply.argumentsError)
        return {
            ...receipt,
            status: "failed",
            errorCode: "invalid_output",
            retryable: true,
            outputDiagnostic: rejectedOutputDiagnostic(
                "tool_arguments_invalid",
                reply.argumentsError,
                reply.finishReason,
            ),
        };
    if (reply.finishReason === "stop" || reply.finishReason === "tool-calls")
        return {
            ...receipt,
            ...reply,
            finishReason: reply.finishReason,
            status: "succeeded",
        };
    return {
        ...receipt,
        status: "failed",
        errorCode: "invalid_output",
        retryable: true,
        outputDiagnostic: rejectedOutputDiagnostic(
            "finish_reason_invalid",
            reply.assistantOutput,
            reply.finishReason,
        ),
    };
}

export function readReportedCost(value: unknown): number | undefined {
    if (!value || typeof value !== "object" || !("cost" in value))
        return undefined;
    return typeof value.cost === "number" &&
        Number.isFinite(value.cost) &&
        value.cost >= 0
        ? value.cost
        : undefined;
}

type InvocationRoute = ModelRoute;

type AttemptFailure = AttemptReceipt & {
    status: "failed";
    errorCode: string;
    retryable: boolean;
};

type BoundedTransportState = {
    streamError?: unknown;
    visibleWriter?: ReturnType<typeof visibleOutputWriter>;
    structuredCapacity?: { contextWindow: number; maxTokens: number };
    requestBlockCode?: string;
    observableReplyJson?: string;
    responseTooLarge: boolean;
    httpStatus?: number;
    retryAfterAt?: number;
    dispatched?: boolean;
    effectiveMaxOutputTokens?: number;
    turn?: {
        startedAt: number;
        result?: AgentGenerationObservation;
        observationError?: unknown;
        generationError?: unknown;
    };
};

/** The stream and diagnostic RPCs share dispatch authority; cleanup shares its existing settlement grace. */
function captureUntil<T>(
    work: () => PromiseLike<T>,
    signal: AbortSignal,
): Promise<T> {
    return new Promise((resolve, reject) => {
        const abort = () => reject(signal.reason);
        if (signal.aborted) {
            abort();
            return;
        }
        signal.addEventListener("abort", abort, { once: true });
        Promise.resolve()
            .then(() => {
                signal.throwIfAborted();
                return work();
            })
            .then(resolve, reject)
            .finally(() => signal.removeEventListener("abort", abort));
    });
}

function visibleOutputWriter(
    append: NonNullable<AttemptDependencies["onVisibleText"]>,
    abort: (error: unknown) => void,
    signal: AbortSignal,
) {
    let pending = "";
    let sequence = 0;
    let flight: Promise<void> | undefined;
    let failure: unknown;
    const start = () => {
        flight ??= (async () => {
            while (pending) {
                let end = Math.min(pending.length, TEXT_FRAGMENT_CHARACTERS);
                const last = pending.charCodeAt(end - 1);
                // A provider delta can end before the low surrogate arrives.
                if (last >= 0xd800 && last <= 0xdbff) end--;
                if (!end) break;
                const text = pending.slice(0, end);
                if (/[\uD800-\uDFFF]/u.test(text))
                    throw executionError("visible_output_invalid_unicode");
                pending = pending.slice(end);
                await captureUntil(() => append(text, sequence++), signal);
            }
        })()
            .catch((error: unknown) => {
                failure = error;
                abort(error);
            })
            .finally(() => {
                flight = undefined;
            });
    };
    return {
        async write(text: string) {
            for (let offset = 0; offset < text.length; ) {
                if (failure) throw failure;
                const part = text.slice(
                    offset,
                    offset + TEXT_FRAGMENT_CHARACTERS,
                );
                offset += part.length;
                pending += part;
                start();
                if (pending.length >= TEXT_FRAGMENT_CHARACTERS) await flight;
            }
        },
        async flush() {
            if (failure) throw failure;
            await flight;
            if (failure) throw failure;
            if (pending) {
                start();
                await flight;
            }
            if (failure) throw failure;
            if (pending) throw executionError("visible_output_invalid_unicode");
        },
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readOptionalNumber(value: unknown): number | undefined {
    return typeof value === "number" ? value : undefined;
}

/** Shared HTTP bound for both generation engines; redirects cannot issue an unadmitted request. */
export function createBoundedModelFetch(
    dependencies: Pick<
        AttemptDependencies,
        "fetch" | "onResponse" | "onHeaders"
    >,
    state: Pick<
        BoundedTransportState,
        "httpStatus" | "retryAfterAt" | "responseTooLarge"
    >,
): typeof fetch {
    return async (url, init) => {
        const response = await (dependencies.fetch ?? globalThis.fetch)(url, {
            ...init,
            redirect: "error",
        });
        state.httpStatus = response.status;
        try {
            await dependencies.onHeaders?.({
                status: response.status,
                requestId: response.headers.get("x-request-id") ?? undefined,
                generationId:
                    response.headers.get("x-generation-id") ?? undefined,
            });
        } catch (error) {
            try {
                await response.body?.cancel(error);
            } catch (cancellationError) {
                const failure = new AggregateError(
                    [error, cancellationError],
                    "Provider header observation and response cancellation failed",
                );
                Object.defineProperty(failure, "cause", { value: error });
                throw failure;
            }
            throw error;
        }
        state.retryAfterAt = providerRetryAfterAt(
            response.headers.get("retry-after"),
            Date.now(),
        );
        const chunks: Uint8Array[] = [];
        let bytes = 0;
        const reader = response.body?.getReader();
        const streaming =
            response.headers
                .get("content-type")
                ?.split(";")[0]
                ?.trim()
                .toLowerCase() === "text/event-stream";
        const observe = () => {
            const body = new Uint8Array(bytes);
            let offset = 0;
            for (const chunk of chunks) {
                body.set(chunk, offset);
                offset += chunk.byteLength;
            }
            dependencies.onResponse?.({
                status: response.status,
                body: new TextDecoder().decode(body),
                requestId: response.headers.get("x-request-id") ?? undefined,
                generationId:
                    response.headers.get("x-generation-id") ?? undefined,
            });
            return body;
        };
        const retain = async (chunk: Uint8Array) => {
            bytes += chunk.byteLength;
            if (!streaming && bytes > MODEL_NON_STREAMING_RESPONSE_MAX_BYTES) {
                state.responseTooLarge = true;
                await reader?.cancel();
                throw new Error(
                    "Structured provider response exceeds its byte bound",
                );
            }
            if (!streaming || dependencies.onResponse) chunks.push(chunk);
        };
        if (reader && streaming) {
            let cancelled = false;
            const body = new ReadableStream<Uint8Array>(
                {
                    async pull(controller) {
                        try {
                            const part = await reader.read();
                            if (cancelled) return;
                            if (part.done) {
                                if (dependencies.onResponse) observe();
                                reader.releaseLock();
                                controller.close();
                            } else {
                                await retain(part.value);
                                if (cancelled) return;
                                controller.enqueue(part.value);
                            }
                        } catch (error) {
                            if (cancelled) return;
                            reader.releaseLock();
                            controller.error(error);
                        }
                    },
                    async cancel(reason) {
                        cancelled = true;
                        try {
                            await reader.cancel(reason);
                        } finally {
                            reader.releaseLock();
                        }
                    },
                },
                { highWaterMark: 0 },
            );
            return new Response(body, {
                status: response.status,
                statusText: response.statusText,
                headers: response.headers,
            });
        }
        if (reader) {
            try {
                while (true) {
                    const part = await reader.read();
                    if (part.done) break;
                    await retain(part.value);
                }
            } finally {
                reader.releaseLock();
            }
        }
        const body = observe();
        return new Response(body, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
        });
    };
}

function createBoundedProvider(
    dependencies: AttemptDependencies,
    state: BoundedTransportState,
    route: InvocationRoute,
) {
    return createOpenRouter({
        apiKey: dependencies.apiKey,
        fetch: createBoundedModelFetch(
            {
                ...dependencies,
                fetch: async (url, init) => {
                    try {
                        await dependencies.beforeDispatch?.(
                            JSON.stringify({
                                version: 2,
                                route,
                                input: JSON.parse(String(init?.body)),
                                settings: modelCallSettings(route).request,
                            }),
                            {
                                effectiveMaxOutputTokens:
                                    state.effectiveMaxOutputTokens,
                            },
                        );
                    } catch (error) {
                        state.requestBlockCode =
                            executionFailureCode(error) ??
                            "journal_request_unavailable";
                        if (state.turn)
                            throw new Error("model_dispatch_refused");
                        throw error;
                    }
                    state.dispatched = true;
                    return (dependencies.fetch ?? globalThis.fetch)(url, init);
                },
                onHeaders: async ({ status, generationId, requestId }) => {
                    await dependencies.observeProvider?.({
                        httpStatus: status,
                        generationId,
                        requestId,
                    });
                    await dependencies.onHeaders?.({
                        status,
                        generationId,
                        requestId,
                    });
                },
            },
            state,
        ),
    });
}

function createRoutedModel(
    provider: ReturnType<typeof createOpenRouter>,
    route: InvocationRoute,
    dependencies: AttemptDependencies,
    state: BoundedTransportState,
) {
    const settings = modelCallSettings(route).request;
    return wrapLanguageModel({
        model: provider.chat(route.model, {
            provider: settings.provider,
            usage: settings.usage,
            extraBody: { reasoning: settings.reasoning },
        }),
        middleware: {
            wrapStream: async ({ params, doStream }) => {
                state.effectiveMaxOutputTokens = params.maxOutputTokens;
                const result = await doStream();
                // HTTP abort owns transport cancellation. Avoid the installed provider's unawaited reader.cancel rejection.
                return {
                    ...result,
                    stream: result.stream.pipeThrough(
                        new TransformStream({
                            async transform(part, controller) {
                                if (part.type === "error")
                                    state.streamError ??= part.error;
                                if (part.type === "text-delta")
                                    await state.visibleWriter?.write(
                                        part.delta,
                                    );
                                controller.enqueue(part);
                            },
                        }),
                        { preventCancel: true },
                    ),
                };
            },
            transformParams: async ({ params }) => {
                if (!state.structuredCapacity) return params;
                const estimatedInput = estimateTextTokens(
                    JSON.stringify({
                        prompt: params.prompt,
                        responseFormat: params.responseFormat,
                    }),
                );
                const limit = Math.min(
                    state.structuredCapacity.maxTokens,
                    state.structuredCapacity.contextWindow - estimatedInput,
                );
                if (limit < 1) {
                    state.requestBlockCode = "context_capacity";
                    throw new Error("Structured input exceeds model capacity");
                }
                return { ...params, maxOutputTokens: limit };
            },
            wrapGenerate: async ({ params, doGenerate }) => {
                if (state.turn && state.dispatched)
                    throw new Error("A controlled turn cannot generate twice");
                state.effectiveMaxOutputTokens = params.maxOutputTokens;
                let result: Awaited<ReturnType<typeof doGenerate>>;
                try {
                    result = await doGenerate();
                } catch (error) {
                    if (state.turn) {
                        state.turn.generationError = error;
                        throw new Error("model_generation_failed");
                    }
                    throw error;
                }
                const content: Array<Record<string, string>> = [];
                for (const part of result.content) {
                    if (part.type === "text")
                        content.push({ type: "text", text: part.text });
                    else if (part.type === "tool-call")
                        content.push({
                            type: "tool-call",
                            toolCallId: part.toolCallId,
                            toolName: part.toolName,
                            input: part.input,
                        });
                }
                state.observableReplyJson = JSON.stringify({
                    version: 1,
                    content,
                    finishReason: result.finishReason,
                });
                if (state.turn) {
                    const text = content
                        .filter((part) => part.type === "text")
                        .map((part) => part.text)
                        .join("");
                    const receipt = createAttemptReceipt(
                        route,
                        state,
                        state.turn.startedAt,
                        {
                            ...result,
                            usage: {
                                inputTokens: result.usage.inputTokens.total,
                                outputTokens: result.usage.outputTokens.total,
                                inputTokenDetails: {
                                    cacheReadTokens:
                                        result.usage.inputTokens.cacheRead,
                                },
                                outputTokenDetails: {
                                    reasoningTokens:
                                        result.usage.outputTokens.reasoning,
                                },
                            },
                        },
                    );
                    const observation = generationObservation(receipt, {
                        finishReason: result.finishReason.unified,
                        assistantOutput: text,
                        requests: content
                            .filter((part) => part.type === "tool-call")
                            .map((part) => ({
                                callId: part.toolCallId ?? "",
                                name: part.toolName ?? "",
                                inputJson: part.input ?? "null",
                            })),
                    });
                    state.turn.result = observation;
                    try {
                        await dependencies.onObservation?.(observation);
                    } catch (error) {
                        state.turn.observationError = error;
                        throw new Error("model_observation_unconfirmed");
                    }
                    // Framework persistence only receives observable parts and whitelisted metadata.
                    return {
                        ...result,
                        content: result.content
                            .filter(
                                (part) =>
                                    part.type === "text" ||
                                    part.type === "tool-call",
                            )
                            .map((part) =>
                                part.type === "text"
                                    ? { type: "text" as const, text: part.text }
                                    : {
                                          type: "tool-call" as const,
                                          toolCallId: part.toolCallId,
                                          toolName: part.toolName,
                                          input: part.input,
                                      },
                            ),
                        providerMetadata: undefined,
                        request: undefined,
                        response: result.response
                            ? {
                                  modelId: result.response.modelId,
                                  id: result.response.id,
                                  timestamp: result.response.timestamp,
                              }
                            : undefined,
                        usage: { ...result.usage, raw: undefined },
                    };
                }
                return result;
            },
        },
    });
}

function createAttemptReceipt(
    route: InvocationRoute,
    state: BoundedTransportState,
    startedAt: number,
    result: unknown,
): AttemptReceipt {
    const resultRecord = isRecord(result) ? result : {};
    const response = isRecord(resultRecord.response)
        ? resultRecord.response
        : {};
    const usage = isRecord(resultRecord.usage) ? resultRecord.usage : {};
    const inputTokenDetails = isRecord(usage.inputTokenDetails)
        ? usage.inputTokenDetails
        : {};
    const outputTokenDetails = isRecord(usage.outputTokenDetails)
        ? usage.outputTokenDetails
        : {};
    const providerMetadata = isRecord(resultRecord.providerMetadata)
        ? resultRecord.providerMetadata
        : {};
    const openrouterMetadata = isRecord(providerMetadata.openrouter)
        ? providerMetadata.openrouter
        : {};
    return {
        ...(state.observableReplyJson
            ? { observableReplyJson: state.observableReplyJson }
            : {}),
        model: route.model,
        dispatchOutcome: "response_received",
        httpStatus: state.httpStatus,
        retryAfterAt: state.retryAfterAt,
        resolvedModel:
            typeof response.modelId === "string" ? response.modelId : undefined,
        provider:
            typeof openrouterMetadata.provider === "string"
                ? openrouterMetadata.provider
                : undefined,
        inputTokens: readOptionalNumber(usage.inputTokens),
        outputTokens: readOptionalNumber(usage.outputTokens),
        reasoningTokens: readOptionalNumber(outputTokenDetails.reasoningTokens),
        cachedInputTokens: readOptionalNumber(
            inputTokenDetails.cacheReadTokens,
        ),
        reportedCost: readReportedCost(openrouterMetadata.usage),
        latencyMs: Math.max(0, Date.now() - startedAt),
    };
}

function httpResponseFailure(
    receipt: AttemptReceipt,
    status: number | undefined,
): AttemptFailure {
    const access = status === 401 || status === 402 || status === 403;
    const transient =
        receipt.httpStatus !== undefined &&
        [408, 429, 500, 502, 503, 504].includes(status ?? 0);
    return {
        ...receipt,
        status: "failed",
        errorCode:
            receipt.httpStatus === undefined
                ? "transport_outcome_unknown"
                : access
                  ? "access_unavailable"
                  : transient
                    ? "transport_unavailable"
                    : "request_invalid",
        retryable: transient,
    };
}

function abortedSignalCode(signal: AbortSignal) {
    const reason: unknown = signal.reason;
    return typeof reason === "object" &&
        reason !== null &&
        "name" in reason &&
        reason.name === "TimeoutError"
        ? "request_timeout"
        : "cancelled";
}

function preflightFailure(
    route: InvocationRoute,
    dependencies: AttemptDependencies,
): AttemptFailure | undefined {
    if (!dependencies.apiKey.trim())
        return {
            model: route.model,
            latencyMs: 0,
            status: "failed",
            errorCode: "missing_configuration",
            dispatchOutcome: "not_dispatched",
            retryable: false,
        };
    if (dependencies.signal?.aborted)
        return {
            model: route.model,
            latencyMs: 0,
            status: "failed",
            errorCode: abortedSignalCode(dependencies.signal),
            dispatchOutcome: "not_dispatched",
            retryable: false,
        };
    const authority = resolveGenerationAuthority(
        dependencies.authority,
        Date.now(),
    );
    if (authority.kind === "blocked")
        return {
            model: route.model,
            latencyMs: 0,
            status: "failed",
            errorCode: authority.code,
            dispatchOutcome: "not_dispatched",
            retryable: false,
        };
    try {
        preparationModelOutputLimit(route);
    } catch (error) {
        if (executionFailureCode(error) !== "invalid_model_output_limit")
            throw error;
        return {
            model: route.model,
            latencyMs: 0,
            status: "failed",
            errorCode: "invalid_model_output_limit",
            dispatchOutcome: "not_dispatched",
            retryable: false,
        };
    }
    return undefined;
}

async function failedAttemptFromError(args: {
    error: unknown;
    route: InvocationRoute;
    dependencies: AttemptDependencies;
    state: BoundedTransportState;
    startedAt: number;
}): Promise<AttemptFailure> {
    const { error, route, dependencies, state, startedAt } = args;
    if (state.requestBlockCode)
        return {
            model: route.model,
            latencyMs: Math.max(0, Date.now() - startedAt),
            status: "failed",
            errorCode: state.requestBlockCode,
            dispatchOutcome: "not_dispatched",
            retryable: false,
        };
    if (state.dispatched)
        await dependencies.observeProvider?.({
            diagnostic: protectedDiagnostic(
                dependencies.signal?.aborted &&
                    dependencies.signal.reason !== undefined
                    ? dependencies.signal.reason
                    : error,
                "provider_transport",
            ),
        });
    const receipt: AttemptReceipt = {
        ...(state.observableReplyJson
            ? { observableReplyJson: state.observableReplyJson }
            : {}),
        model: route.model,
        dispatchOutcome:
            state.httpStatus === undefined ? "unknown" : "response_received",
        httpStatus: state.httpStatus,
        retryAfterAt: state.retryAfterAt,
        latencyMs: Math.max(0, Date.now() - startedAt),
    };
    if (dependencies.signal?.aborted)
        return {
            ...receipt,
            status: "failed",
            errorCode: abortedSignalCode(dependencies.signal),
            retryable: false,
        };
    if (state.responseTooLarge)
        return {
            ...receipt,
            status: "failed",
            errorCode: "response_too_large",
            retryable: false,
        };
    if (NoObjectGeneratedError.isInstance(error))
        return {
            ...receipt,
            status: "failed",
            errorCode: "invalid_output",
            retryable: true,
            outputDiagnostic: rejectedOutputDiagnostic(
                error.finishReason && error.finishReason !== "stop"
                    ? "finish_reason_invalid"
                    : JSONParseError.isInstance(error.cause)
                      ? "json_invalid"
                      : "schema_invalid",
                error.text,
                error.finishReason,
            ),
            resolvedModel: error.response?.modelId,
            inputTokens: error.usage?.inputTokens,
            outputTokens: error.usage?.outputTokens,
            reasoningTokens: error.usage?.outputTokenDetails.reasoningTokens,
            cachedInputTokens: error.usage?.inputTokenDetails.cacheReadTokens,
            reportedCost: readReportedCost(error.usage?.raw),
        };
    if (APICallError.isInstance(error))
        return httpResponseFailure(receipt, error.statusCode);
    const errorName =
        typeof error === "object" && error !== null && "name" in error
            ? error.name
            : undefined;
    if (errorName === "AbortError" || errorName === "TimeoutError")
        return {
            ...receipt,
            status: "failed",
            errorCode: "request_timeout",
            retryable: false,
        };
    throw error;
}

/** Performs one bounded structured-output attempt; orchestration owns fallback and persistence. */
export async function invokeOneShot<T>(args: {
    route: SourceQualificationRoute;
    dependencies: OneShotDependencies;
    instructions: string;
    prompt: string;
    schema: ZodType<T>;
    schemaName: string;
}): Promise<StructuredAttempt<T>> {
    const { route } = args;
    const dependencies: AttemptDependencies = {
        ...args.dependencies,
        apiKey: args.dependencies.apiKey ?? readOpenRouterApiKey() ?? "",
    };
    const preflight = preflightFailure(route, dependencies);
    if (preflight) return preflight;
    const startedAt = Date.now();
    const captureAbort = new AbortController();
    const generationSignal = AbortSignal.any([
        captureAbort.signal,
        ...(dependencies.signal ? [dependencies.signal] : []),
        AbortSignal.timeout(
            Math.max(
                1,
                (dependencies.authority?.deadlineAt ?? startedAt) - Date.now(),
            ),
        ),
    ]);
    const settlementAbort = new AbortController();
    let graceTimer: ReturnType<typeof setTimeout> | undefined;
    const allowSettlement = () => {
        graceTimer ??= setTimeout(
            () =>
                settlementAbort.abort(
                    executionError("response_retention_failed"),
                ),
            MODEL_SETTLEMENT_GRACE_MS,
        );
    };
    generationSignal.addEventListener("abort", allowSettlement, { once: true });
    let terminalReceipt: AttemptReceipt | undefined;
    let captureSealed = false;
    const state: BoundedTransportState = {
        responseTooLarge: false,
        visibleWriter: dependencies.onVisibleText
            ? visibleOutputWriter(
                  dependencies.onVisibleText,
                  (error) => {
                      if (!generationSignal.aborted) captureAbort.abort(error);
                  },
                  generationSignal,
              )
            : undefined,
    };
    try {
        const authority = resolveGenerationAuthority(
            dependencies.authority,
            Date.now(),
        );
        if (authority.kind === "blocked") throw executionError(authority.code);
        const maxOutputTokens = preparationModelOutputLimit(route);
        if (route.descriptor)
            state.structuredCapacity = {
                contextWindow: route.descriptor.contextWindow,
                maxTokens: maxOutputTokens,
            };
        const provider = createBoundedProvider(dependencies, state, route);
        const stream = streamText({
            onError: ({ error }) => {
                state.streamError ??= error;
            },
            model: createRoutedModel(provider, route, dependencies, state),
            instructions: args.instructions,
            prompt: args.prompt,
            output: Output.object({
                schema: args.schema,
                name: args.schemaName,
            }),
            ...modelCallSettings(route, authority.deadlineAt).generation,
            maxOutputTokens,
            experimental_transform: () => {
                let text = "";
                let head:
                    | Extract<TextStreamPart<ToolSet>, { type: "text-delta" }>
                    | undefined;
                const flush = (
                    controller: TransformStreamDefaultController<
                        TextStreamPart<ToolSet>
                    >,
                ) => {
                    if (head) controller.enqueue({ ...head, text });
                    text = "";
                    head = undefined;
                };
                return new TransformStream<
                    TextStreamPart<ToolSet>,
                    TextStreamPart<ToolSet>
                >({
                    transform(part, controller) {
                        if (part.type !== "text-delta") {
                            flush(controller);
                            controller.enqueue(part);
                            return;
                        }
                        if (head && head.id !== part.id) flush(controller);
                        head = part;
                        text += part.text;
                        if (text.length >= TEXT_FRAGMENT_CHARACTERS)
                            flush(controller);
                    },
                    flush,
                });
            },
            abortSignal: generationSignal,
        });
        const output = Promise.resolve(stream.output);
        void output.catch(() => undefined);
        const completion = Promise.all([
            stream.text,
            stream.finishReason,
            stream.usage,
            stream.response,
            stream.providerMetadata,
        ]);
        void completion.catch(() => undefined);
        let streamError: unknown;
        await captureUntil(
            () =>
                stream.consumeStream({
                    onError: (error) => {
                        streamError ??= error;
                    },
                }),
            generationSignal,
        );
        if (streamError || state.streamError)
            throw streamError ?? state.streamError;
        const [text, finishReason, usage, response, providerMetadata] =
            await completion;
        const result = {
            text,
            finishReason,
            usage,
            response,
            providerMetadata,
        };
        state.observableReplyJson = JSON.stringify({
            version: 1,
            content: [{ type: "text", text: result.text }],
            finishReason: { unified: result.finishReason },
        });
        terminalReceipt = createAttemptReceipt(route, state, startedAt, result);
        allowSettlement();
        await captureUntil(
            () => state.visibleWriter?.flush() ?? Promise.resolve(),
            settlementAbort.signal,
        );
        try {
            await captureUntil(
                () =>
                    dependencies.finishVisibleOutput?.(
                        true,
                        result.finishReason,
                    ) ?? Promise.resolve(),
                settlementAbort.signal,
            );
        } catch (error) {
            captureAbort.abort(error);
            throw error;
        }
        captureSealed = true;
        const receipt = createAttemptReceipt(route, state, startedAt, result);
        const value = await output;
        if (result.finishReason !== "stop")
            return {
                ...receipt,
                status: "failed",
                errorCode: "invalid_output",
                retryable: true,
                outputDiagnostic: rejectedOutputDiagnostic(
                    "finish_reason_invalid",
                    result.text,
                    result.finishReason,
                ),
            };
        return {
            ...receipt,
            status: "succeeded",
            value,
            assistantOutput: result.text,
        };
    } catch (error) {
        allowSettlement();
        let failure = error;
        try {
            await captureUntil(
                () => state.visibleWriter?.flush() ?? Promise.resolve(),
                settlementAbort.signal,
            );
        } catch (captureError) {
            failure = captureError;
            if (settlementAbort.signal.aborted || !generationSignal.aborted)
                captureAbort.abort(captureError);
        }
        try {
            await captureUntil(
                () =>
                    (captureSealed
                        ? Promise.resolve()
                        : dependencies.finishVisibleOutput?.(
                              false,
                              executionFailureCode(failure) ??
                                  (failure instanceof Error
                                      ? failure.name
                                      : "stream_interrupted"),
                          )) ?? Promise.resolve(),
                settlementAbort.signal,
            );
        } catch (captureError) {
            failure = captureError;
            if (settlementAbort.signal.aborted || !generationSignal.aborted)
                captureAbort.abort(captureError);
        }
        if (captureAbort.signal.aborted) {
            if (state.dispatched)
                await dependencies.observeProvider?.({
                    diagnostic: protectedDiagnostic(
                        failure,
                        "provider_transport",
                    ),
                });
            return {
                ...(terminalReceipt ?? {
                    model: route.model,
                    latencyMs: Math.max(0, Date.now() - startedAt),
                    httpStatus: state.httpStatus,
                    dispatchOutcome: state.dispatched
                        ? state.httpStatus === undefined
                            ? "unknown"
                            : "response_received"
                        : "not_dispatched",
                }),
                status: "failed",
                errorCode:
                    executionFailureCode(failure) ??
                    "response_retention_failed",
                retryable: false,
            };
        }
        if (!state.dispatched)
            state.requestBlockCode ??= executionFailureCode(error);
        const failed = await failedAttemptFromError({
            error: failure,
            route,
            dependencies,
            state,
            startedAt,
        });
        return { ...failed, ...terminalReceipt };
    } finally {
        generationSignal.removeEventListener("abort", allowSettlement);
        if (graceTimer !== undefined) clearTimeout(graceTimer);
    }
}
