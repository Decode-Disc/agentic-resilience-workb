"use node";

import type { Doc } from "@convex/_generated/dataModel";
import { providerRetryAfterAt } from "@convex/domain/sourcePreparationAuthority";
import type { AgentOperationDefinition } from "@convex/execution/contracts";
import { executionFailureCode } from "@convex/execution/errors";
import { MAX_PREPARATION_DIAGNOSTIC_BYTES } from "@convex/resourceLimits";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { ToolSet } from "ai";
import {
    APICallError,
    asSchema,
    generateText,
    isStepCount,
    JSONParseError,
    jsonSchema,
    NoObjectGeneratedError,
    Output,
    ToolLoopAgent,
    tool,
    wrapLanguageModel,
} from "ai";
import { convexToZod } from "convex-helpers/server/zod4";
import { type ZodType, z } from "zod";
import type { SourceQualificationRoute } from "./sourceQualificationConfig";
import {
    QUALIFICATION_ATTEMPT_TIMEOUT_MS,
    QUALIFICATION_MAX_INPUT_PRICE_PER_MILLION,
    QUALIFICATION_MAX_OUTPUT_PRICE_PER_MILLION,
    QUALIFICATION_MAX_OUTPUT_TOKENS,
} from "./sourceQualificationConfig";

export type AttemptReceipt = {
    observableReplyJson?: string;
    model: string;
    resolvedModel?: string;
    provider?: string;
    inputTokens?: number;
    outputTokens?: number;
    reasoningTokens?: number;
    cachedInputTokens?: number;
    reportedCost?: number;
    latencyMs: number;
    dispatchOutcome?: "not_dispatched" | "response_received" | "unknown";
    httpStatus?: number;
    retryAfterAt?: number;
    outputDiagnostic?: Doc<"providerCalls">["diagnostic"];
};

export type ProviderResponse = {
    status: number;
    body: string;
    requestId?: string;
    generationId?: string;
};

export type AttemptDependencies = {
    apiKey: string;
    fetch?: typeof fetch;
    signal?: AbortSignal;
    onResponse?: (response: ProviderResponse) => void;
    beforeDispatch?: (requestJson: string) => Promise<void>;
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

function readReportedCost(value: unknown): number | undefined {
    if (!value || typeof value !== "object" || !("cost" in value))
        return undefined;
    return typeof value.cost === "number" &&
        Number.isFinite(value.cost) &&
        value.cost >= 0
        ? value.cost
        : undefined;
}

type InvocationRoute = Readonly<{ model: string; provider: string }>;

type AttemptFailure = AttemptReceipt & {
    status: "failed";
    errorCode: string;
    retryable: boolean;
};

type BoundedTransportState = {
    requestBlockCode?: string;
    observableReplyJson?: string;
    responseTooLarge: boolean;
    httpStatus?: number;
    retryAfterAt?: number;
};

export type AuthorizedAgentRoute = InvocationRoute & {
    authorizedForAgent: true;
};

export type DeferredAgentTurnResult =
    | (AttemptReceipt & {
          status: "succeeded";
          finishReason: "stop" | "tool-calls";
          assistantOutput: string;
          requests: { callId: string; name: string; inputJson: string }[];
      })
    | AttemptFailure
    | {
          status: "blocked";
          reason: "missing_authorized_route" | "tool_callbacks_not_allowed";
      };

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readOptionalNumber(value: unknown): number | undefined {
    return typeof value === "number" ? value : undefined;
}

function createBoundedProvider(
    dependencies: AttemptDependencies,
    state: BoundedTransportState,
) {
    return createOpenRouter({
        apiKey: dependencies.apiKey,
        fetch: async (url, init) => {
            const response = await (dependencies.fetch ?? globalThis.fetch)(
                url,
                {
                    ...init,
                    redirect: "error",
                },
            );
            state.httpStatus = response.status;
            state.retryAfterAt = providerRetryAfterAt(
                response.headers.get("retry-after"),
                Date.now(),
            );
            const chunks: Uint8Array[] = [];
            let bytes = 0;
            const reader = response.body?.getReader();
            if (reader) {
                try {
                    while (true) {
                        const part = await reader.read();
                        if (part.done) break;
                        bytes += part.value.byteLength;
                        if (bytes > 1024 * 1024) {
                            state.responseTooLarge = true;
                            await reader.cancel();
                            throw new Error(
                                "Structured provider response exceeds its byte bound",
                            );
                        }
                        chunks.push(part.value);
                    }
                } finally {
                    reader.releaseLock();
                }
            }
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
            return new Response(body, {
                status: response.status,
                statusText: response.statusText,
                headers: response.headers,
            });
        },
    });
}

function createRoutedModel(
    provider: ReturnType<typeof createOpenRouter>,
    route: InvocationRoute,
    dependencies: AttemptDependencies,
    state: BoundedTransportState,
) {
    const settings = {
        provider: {
            only: [route.provider],
            require_parameters: true,
            allow_fallbacks: false,
            max_price: {
                prompt: QUALIFICATION_MAX_INPUT_PRICE_PER_MILLION,
                completion: QUALIFICATION_MAX_OUTPUT_PRICE_PER_MILLION,
            },
        },
        reasoning: { enabled: false, effort: "none" as const, exclude: true },
        usage: { include: true },
    };
    return wrapLanguageModel({
        model: provider.chat(route.model, settings),
        middleware: {
            wrapGenerate: async ({ params, doGenerate }) => {
                const {
                    abortSignal: _signal,
                    headers: _headers,
                    providerOptions: _providerOptions,
                    ...input
                } = params;
                try {
                    await dependencies.beforeDispatch?.(
                        JSON.stringify({ version: 1, route, input, settings }),
                    );
                } catch (error) {
                    state.requestBlockCode =
                        executionFailureCode(error) ??
                        "journal_request_unavailable";
                    throw error;
                }
                const result = await doGenerate();
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
            errorCode: "cancelled",
            dispatchOutcome: "not_dispatched",
            retryable: false,
        };
    return undefined;
}

function failedAttemptFromError(args: {
    error: unknown;
    route: InvocationRoute;
    dependencies: AttemptDependencies;
    state: BoundedTransportState;
    startedAt: number;
}): AttemptFailure {
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
            errorCode: "cancelled",
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
    if (APICallError.isInstance(error)) {
        const status = error.statusCode;
        const access = status === 401 || status === 402 || status === 403;
        const transient =
            state.httpStatus !== undefined &&
            [408, 429, 500, 502, 503, 504].includes(status ?? 0);
        return {
            ...receipt,
            status: "failed",
            errorCode:
                state.httpStatus === undefined
                    ? "transport_outcome_unknown"
                    : access
                      ? "access_unavailable"
                      : transient
                        ? "transport_unavailable"
                        : "request_invalid",
            retryable: transient,
        };
    }
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

function toolHasExecuteCallback(candidate: unknown): boolean {
    return isRecord(candidate) && typeof candidate.execute === "function";
}

/** Performs one bounded structured-output attempt; orchestration owns fallback and persistence. */
export async function invokeOneShot<T>(args: {
    route: SourceQualificationRoute;
    dependencies: AttemptDependencies;
    instructions: string;
    prompt: string;
    schema: ZodType<T>;
    schemaName: string;
}): Promise<StructuredAttempt<T>> {
    const { route, dependencies } = args;
    const preflight = preflightFailure(route, dependencies);
    if (preflight) return preflight;
    const startedAt = Date.now();
    const state: BoundedTransportState = { responseTooLarge: false };
    try {
        const provider = createBoundedProvider(dependencies, state);
        const result = await generateText({
            model: createRoutedModel(provider, route, dependencies, state),
            instructions: args.instructions,
            prompt: args.prompt,
            output: Output.object({
                schema: args.schema,
                name: args.schemaName,
            }),
            maxOutputTokens: QUALIFICATION_MAX_OUTPUT_TOKENS,
            temperature: 0,
            maxRetries: 0,
            timeout: QUALIFICATION_ATTEMPT_TIMEOUT_MS,
            abortSignal: dependencies.signal,
        });
        const receipt = createAttemptReceipt(route, state, startedAt, result);
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
            value: result.output,
            assistantOutput: result.text,
        };
    } catch (error) {
        return failedAttemptFromError({
            error,
            route,
            dependencies,
            state,
            startedAt,
        });
    }
}

function modelInputSchema<Schema extends z.ZodObject>(
    validator: Schema,
    convexIdPaths: readonly string[] = [],
) {
    const strictValidator = validator.strict();
    type Input = z.output<typeof strictValidator>;
    const createJsonSchema = () => {
        const convertedIdPaths = new Set<string>();
        const schema = z.toJSONSchema(strictValidator, {
            target: "draft-7",
            unrepresentable: "any",
            override: ({ zodSchema, jsonSchema, path }) => {
                if (!(zodSchema instanceof z.ZodCustom)) return;
                const idPath = path.join(".");
                const fieldPath = idPath.replace(/^properties\./, "");
                if (!convexIdPaths.includes(fieldPath))
                    throw new Error(
                        `Unsupported custom model input schema at ${idPath}`,
                    );
                convertedIdPaths.add(fieldPath);
                jsonSchema.type = "string";
            },
        });
        if (
            convertedIdPaths.size !== convexIdPaths.length ||
            convexIdPaths.some((path) => !convertedIdPaths.has(path))
        )
            throw new Error("Canonical Convex ID schema was not converted");
        return schema;
    };

    return jsonSchema<Input>(createJsonSchema, {
        validate: (value) => {
            const parsed = strictValidator.safeParse(value);
            return parsed.success
                ? { success: true, value: parsed.data }
                : { success: false, error: parsed.error };
        },
    });
}

function createAgentTools(
    operations: Record<string, AgentOperationDefinition>,
): ToolSet {
    return Object.fromEntries(
        Object.entries(operations).map(([name, operation]) => [
            name,
            tool({
                description: operation.description,
                inputSchema: modelInputSchema(
                    convexToZod(operation.inputValidator),
                    Object.entries(operation.inputValidator.fields)
                        .filter(([, validator]) => validator.kind === "id")
                        .map(([field]) => field),
                ),
            }),
        ]),
    );
}

/** Measures the actual provider envelope after canonical schemas have been adapted. */
export async function agentInputByteLength(args: {
    instructions: string;
    prompt: string;
    operations: Record<string, AgentOperationDefinition>;
}): Promise<number> {
    const tools = await Promise.all(
        Object.entries(createAgentTools(args.operations)).map(
            async ([name, operation]) => ({
                name,
                description: operation.description,
                inputSchema: await asSchema<unknown>(operation.inputSchema)
                    .jsonSchema,
            }),
        ),
    );
    return new TextEncoder().encode(
        JSON.stringify({
            instructions: args.instructions,
            prompt: args.prompt,
            tools,
        }),
    ).length;
}

/** Runs one authorized model turn and returns tool requests for persisted dispatch. */
export async function invokeDeferredAgentTurn(args: {
    route?: AuthorizedAgentRoute;
    dependencies: AttemptDependencies;
    instructions: string;
    prompt: string;
    operations: Record<string, AgentOperationDefinition>;
}): Promise<DeferredAgentTurnResult> {
    if (!args.route)
        return { status: "blocked", reason: "missing_authorized_route" };
    if (Object.values(args.operations).some(toolHasExecuteCallback))
        return { status: "blocked", reason: "tool_callbacks_not_allowed" };
    const { route, dependencies } = args;
    const preflight = preflightFailure(route, dependencies);
    if (preflight) return preflight;
    const startedAt = Date.now();
    const state: BoundedTransportState = { responseTooLarge: false };
    try {
        const provider = createBoundedProvider(dependencies, state);
        const agent = new ToolLoopAgent({
            model: createRoutedModel(provider, route, dependencies, state),
            instructions: args.instructions,
            tools: createAgentTools(args.operations),
            stopWhen: isStepCount(1),
            // The runtime check above forbids executable tools, so no tool context can be consumed.
            maxOutputTokens: QUALIFICATION_MAX_OUTPUT_TOKENS,
            temperature: 0,
            maxRetries: 0,
        });
        const result = await agent.generate({
            prompt: args.prompt,
            timeout: QUALIFICATION_ATTEMPT_TIMEOUT_MS,
            abortSignal: dependencies.signal,
        });
        const receipt = createAttemptReceipt(route, state, startedAt, result);
        if (
            result.finishReason !== "stop" &&
            result.finishReason !== "tool-calls"
        )
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
            finishReason: result.finishReason,
            assistantOutput: result.text,
            requests: result.toolCalls.map((call) => ({
                callId: call.toolCallId,
                name: call.toolName,
                inputJson: JSON.stringify(call.input ?? null),
            })),
        };
    } catch (error) {
        return failedAttemptFromError({
            error,
            route,
            dependencies,
            state,
            startedAt,
        });
    }
}
