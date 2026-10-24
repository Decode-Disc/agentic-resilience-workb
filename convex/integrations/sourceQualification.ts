"use node";

import {
    createSourceComparisonResponseSchema,
    materializeSourceComparisonOutput,
    type PreparedSourceComparisonInput,
    type SourceComparisonOutput,
} from "@convex/domain/sourceComparison";
import { providerRetryAfterAt } from "@convex/domain/sourcePreparationAuthority";
import {
    createQualificationResponseSchema,
    materializeQualificationOutput,
    type prepareQualificationInput,
    type SourceQualification,
} from "@convex/domain/sourceQualification";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { APICallError, generateText, NoObjectGeneratedError, Output } from "ai";
import type { ZodType } from "zod";
import type { SourceQualificationRoute } from "./sourceQualificationConfig";
import {
    QUALIFICATION_ATTEMPT_TIMEOUT_MS,
    QUALIFICATION_MAX_INPUT_PRICE_PER_MILLION,
    QUALIFICATION_MAX_OUTPUT_PRICE_PER_MILLION,
    QUALIFICATION_MAX_OUTPUT_TOKENS,
} from "./sourceQualificationConfig";

type AttemptReceipt = {
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
};

type ProviderResponse = {
    status: number;
    body: string;
    requestId?: string;
    generationId?: string;
};

type AttemptDependencies = {
    apiKey: string;
    fetch?: typeof fetch;
    signal?: AbortSignal;
    onResponse?: (response: ProviderResponse) => void;
};

type StructuredAttempt<T> =
    | (AttemptReceipt & { status: "succeeded"; value: T })
    | (AttemptReceipt & {
          status: "failed";
          errorCode: string;
          retryable: boolean;
      });

function readReportedCost(value: unknown): number | undefined {
    if (!value || typeof value !== "object" || !("cost" in value))
        return undefined;
    return typeof value.cost === "number" &&
        Number.isFinite(value.cost) &&
        value.cost >= 0
        ? value.cost
        : undefined;
}

/** Owns the one bounded OpenRouter policy shared by qualification and comparison. */
async function runBoundedStructuredAttempt<T>(args: {
    route: SourceQualificationRoute;
    dependencies: AttemptDependencies;
    instructions: string;
    prompt: string;
    schema: ZodType<T>;
    schemaName: string;
}): Promise<StructuredAttempt<T>> {
    const { route, dependencies } = args;
    const startedAt = Date.now();
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
    let responseTooLarge = false;
    let httpStatus: number | undefined;
    let retryAfterAt: number | undefined;
    try {
        const provider = createOpenRouter({
            apiKey: dependencies.apiKey,
            fetch: async (url, init) => {
                const response = await (dependencies.fetch ?? globalThis.fetch)(
                    url,
                    { ...init, redirect: "error" },
                );
                httpStatus = response.status;
                retryAfterAt = providerRetryAfterAt(
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
                                responseTooLarge = true;
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
                    requestId:
                        response.headers.get("x-request-id") ?? undefined,
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
        const result = await generateText({
            model: provider.chat(route.model, {
                provider: {
                    only: [route.provider],
                    require_parameters: true,
                    allow_fallbacks: false,
                    max_price: {
                        prompt: QUALIFICATION_MAX_INPUT_PRICE_PER_MILLION,
                        completion: QUALIFICATION_MAX_OUTPUT_PRICE_PER_MILLION,
                    },
                },
                reasoning: { enabled: false, effort: "none", exclude: true },
                usage: { include: true },
            }),
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
        const metadata = result.providerMetadata?.openrouter;
        const usage = metadata?.usage;
        const receipt: AttemptReceipt = {
            model: route.model,
            dispatchOutcome: "response_received",
            httpStatus,
            retryAfterAt,
            resolvedModel: result.response.modelId,
            provider:
                typeof metadata?.provider === "string"
                    ? metadata.provider
                    : undefined,
            inputTokens: result.usage.inputTokens,
            outputTokens: result.usage.outputTokens,
            reasoningTokens: result.usage.outputTokenDetails.reasoningTokens,
            cachedInputTokens: result.usage.inputTokenDetails.cacheReadTokens,
            reportedCost: readReportedCost(usage),
            latencyMs: Math.max(0, Date.now() - startedAt),
        };
        if (result.finishReason !== "stop")
            return {
                ...receipt,
                status: "failed",
                errorCode: "invalid_output",
                retryable: true,
            };
        return { ...receipt, status: "succeeded", value: result.output };
    } catch (error) {
        const receipt: AttemptReceipt = {
            model: route.model,
            dispatchOutcome:
                httpStatus === undefined ? "unknown" : "response_received",
            httpStatus,
            retryAfterAt,
            latencyMs: Math.max(0, Date.now() - startedAt),
        };
        if (dependencies.signal?.aborted)
            return {
                ...receipt,
                status: "failed",
                errorCode: "cancelled",
                retryable: false,
            };
        if (responseTooLarge)
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
                resolvedModel: error.response?.modelId,
                inputTokens: error.usage?.inputTokens,
                outputTokens: error.usage?.outputTokens,
                reasoningTokens:
                    error.usage?.outputTokenDetails.reasoningTokens,
                cachedInputTokens:
                    error.usage?.inputTokenDetails.cacheReadTokens,
                reportedCost: readReportedCost(error.usage?.raw),
            };
        if (APICallError.isInstance(error)) {
            const status = error.statusCode;
            const access = status === 401 || status === 402 || status === 403;
            const transient =
                httpStatus !== undefined &&
                [408, 429, 500, 502, 503, 504].includes(status ?? 0);
            return {
                ...receipt,
                status: "failed",
                errorCode:
                    httpStatus === undefined
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
}

export type QualificationAttemptResult = AttemptReceipt &
    (
        | { status: "succeeded"; qualification: SourceQualification }
        | { status: "failed"; errorCode: string; retryable: boolean }
    );

/** Performs one bounded provider attempt; orchestration owns fallback and persistence. */
export async function qualifySourceDocument(
    input: ReturnType<typeof prepareQualificationInput>,
    route: SourceQualificationRoute,
    dependencies: AttemptDependencies,
): Promise<QualificationAttemptResult> {
    const { instructions, ...state } = input.request;
    const attempt = await runBoundedStructuredAttempt({
        route,
        dependencies,
        instructions,
        prompt: JSON.stringify(state),
        schema: createQualificationResponseSchema(
            input.request.document.passages,
        ),
        schemaName: "source_qualification",
    });
    if (attempt.status === "failed") return attempt;
    const validation = materializeQualificationOutput(input, attempt.value);
    if (validation.status !== "valid")
        return {
            ...attempt,
            status: "failed",
            errorCode: "invalid_output",
            retryable: true,
        };
    return {
        ...attempt,
        status: "succeeded",
        qualification: validation.qualification,
    };
}

export type SourceComparisonAttemptResult = AttemptReceipt &
    (
        | { status: "succeeded"; output: SourceComparisonOutput }
        | {
              status: "not_run";
              reason: "no_comparable_primary_evidence";
              output: SourceComparisonOutput;
          }
        | { status: "failed"; errorCode: string; retryable: boolean }
    );

/** Compares one grouped target capture; no provider call is made without primary evidence. */
export async function compareSourceContributions(
    input: PreparedSourceComparisonInput,
    route: SourceQualificationRoute,
    dependencies: AttemptDependencies,
): Promise<SourceComparisonAttemptResult> {
    const hasComparablePrimaryPassage = input.request.findings.some(
        (finding) => finding.primaryPassageKeys.length > 0,
    );
    if (!hasComparablePrimaryPassage) {
        const materialized = materializeSourceComparisonOutput(
            input,
            {
                findings: [],
            },
            "not_run",
        );
        if (materialized.status !== "valid")
            return {
                model: route.model,
                latencyMs: 0,
                status: "failed",
                errorCode: "invalid_local_result",
                retryable: false,
            };
        return {
            model: route.model,
            latencyMs: 0,
            status: "not_run",
            reason: "no_comparable_primary_evidence",
            output: materialized.output,
        };
    }
    const { instructions, ...state } = input.request;
    const attempt = await runBoundedStructuredAttempt({
        route,
        dependencies,
        instructions,
        prompt: JSON.stringify(state),
        schema: createSourceComparisonResponseSchema(input),
        schemaName: "source_comparison",
    });
    if (attempt.status === "failed") return attempt;
    const materialized = materializeSourceComparisonOutput(
        input,
        attempt.value,
    );
    if (materialized.status !== "valid")
        return {
            ...attempt,
            status: "failed",
            errorCode: "invalid_output",
            retryable: true,
        };
    return { ...attempt, status: "succeeded", output: materialized.output };
}
