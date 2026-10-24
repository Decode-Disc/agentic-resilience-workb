import { MAX_APPROVED_SOURCE_BYTES } from "@convex/resourceLimits";

export type ExaSearchResult = {
    id: string;
    url: string;
    title: string | null;
    publishedDate?: string;
    text?: string;
};

export type ExaContentsClient = {
    getContents(
        urls: string[],
        options?: {
            text?: { maxCharacters?: number } | true;
        },
        requestOptions?: { signal: AbortSignal },
    ): Promise<{
        results: ReadonlyArray<{
            id: string;
            url: string;
            title?: string | null;
            text?: string;
        }>;
        searchTime?: number;
        costDollars?: { total: number };
    }>;
};

export type ExaContentsAdapterDependencies = {
    recordAttempt?: (attempt: {
        operation: string;
        operationKey: string;
        status: "started" | "succeeded" | "failed";
        attempt: number;
        latencyMs?: number;
        errorCode?: string;
        dispatchOutcome?: "response_received" | "unknown";
        httpStatus?: number;
        retryAfterAt?: number;
        usage?: Record<string, unknown>;
        reportedCost?: number;
    }) => Promise<{ shouldExecute: boolean }>;
    operationScope?: string;
    firstAttempt?: 1 | 2 | 3;
    maxAttempts?: 1 | 2 | 3;
    retryPolicy?: "confirmed_response";
    timeoutMs?: number;
    now?: () => number;
};

export class ExaLogicalTimeoutError extends Error {
    constructor() {
        super("Exa request exceeded its application timeout");
        this.name = "ExaLogicalTimeoutError";
    }
}

export class ExaContentsError extends Error {
    readonly errorCode: string;
    constructor(
        message: string,
        errorCode = "ExaContentsError",
        readonly retryAfterAt?: number,
    ) {
        super(message);
        this.name = "ExaContentsError";
        this.errorCode = errorCode;
    }
}

export function canonicalizeUrl(rawUrl: string): string {
    const url = new URL(rawUrl);
    url.hostname = url.hostname.toLowerCase();
    url.hash = "";
    if (url.port === "80" && url.protocol === "http:") url.port = "";
    if (url.port === "443" && url.protocol === "https:") url.port = "";
    if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
        url.pathname = url.pathname.slice(0, -1);
    }
    return url.toString();
}

function isRetryableExaError(error: unknown): boolean {
    if (error instanceof ExaLogicalTimeoutError) {
        return true;
    }
    if (error && typeof error === "object") {
        const errorObj = error as Record<string, unknown>;
        const causeObj =
            errorObj.cause && typeof errorObj.cause === "object"
                ? (errorObj.cause as Record<string, unknown>)
                : undefined;
        const status =
            typeof errorObj.status === "number"
                ? errorObj.status
                : typeof errorObj.statusCode === "number"
                  ? errorObj.statusCode
                  : typeof causeObj?.status === "number"
                    ? causeObj.status
                    : typeof causeObj?.statusCode === "number"
                      ? causeObj.statusCode
                      : undefined;
        if (typeof status === "number") {
            return (
                status === 408 ||
                status === 429 ||
                (status >= 500 && status <= 599)
            );
        }
        const code =
            typeof errorObj.code === "string"
                ? errorObj.code
                : typeof causeObj?.code === "string"
                  ? causeObj.code
                  : undefined;
        if (
            code &&
            [
                "ECONNRESET",
                "ETIMEDOUT",
                "ECONNREFUSED",
                "EAI_AGAIN",
                "ENOTFOUND",
                "UND_ERR_CONNECT_TIMEOUT",
                "UND_ERR_SOCKET",
            ].includes(code)
        ) {
            return true;
        }
    }
    if (error instanceof Error) {
        if (error.name === "AbortError" || error.name === "TimeoutError") {
            return true;
        }
        if (error instanceof ExaContentsError) {
            if (
                error.errorCode === "http_408" ||
                error.errorCode === "http_429" ||
                /^http_5\d{2}$/.test(error.errorCode) ||
                error.errorCode === "timeout" ||
                error.errorCode === "network_error"
            ) {
                return true;
            }
        }
    }
    return false;
}

async function withAbortableTimeout<T>(
    work: (signal: AbortSignal) => Promise<T>,
    timeoutMs: number,
): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(
        () => controller.abort(new ExaLogicalTimeoutError()),
        timeoutMs,
    );
    try {
        const result = await work(controller.signal);
        controller.signal.throwIfAborted();
        return result;
    } finally {
        clearTimeout(timeout);
    }
}

export const MAX_EXA_CONTENTS_ATTEMPTS = 2;
const MAX_EXA_TEXT_CHARACTERS = 1_000_000;
export const DEFAULT_EXA_CONTENTS_TIMEOUT_MS = 120_000;

export function createExaContentsAdapter(
    client: ExaContentsClient,
    dependencies: ExaContentsAdapterDependencies = {},
): {
    retrieveText(
        canonicalUrl: string,
        options?: { maxCharacters?: number },
    ): Promise<{
        text: string;
        providerReference?: string;
        title?: string;
        searchTime?: number;
        costDollars?: number;
        textLimitReached?: true;
    }>;
} {
    const timeoutMs = dependencies.timeoutMs ?? DEFAULT_EXA_CONTENTS_TIMEOUT_MS;
    const now = dependencies.now ?? Date.now;

    return {
        async retrieveText(canonicalUrl, options = {}) {
            const operation = "get_contents";
            const operationKey = `${dependencies.operationScope ?? "exa"}:${operation}:${canonicalUrl}`;

            for (
                let attempt = dependencies.firstAttempt ?? 1;
                attempt <=
                (dependencies.maxAttempts ?? MAX_EXA_CONTENTS_ATTEMPTS);
                attempt += 1
            ) {
                const startedAt = now();
                if (dependencies.recordAttempt) {
                    const lease = await dependencies.recordAttempt({
                        operation,
                        operationKey,
                        status: "started",
                        attempt,
                    });
                    if (!lease.shouldExecute) {
                        throw new ExaContentsError(
                            "Exa provider attempt was already recorded",
                            "ExaAttemptReplayError",
                        );
                    }
                }

                try {
                    const defaultMaxCharacters = Math.min(
                        MAX_EXA_TEXT_CHARACTERS,
                        Math.floor(MAX_APPROVED_SOURCE_BYTES / 4),
                    );
                    const maxCharacters =
                        typeof options.maxCharacters === "number"
                            ? Math.min(
                                  options.maxCharacters,
                                  defaultMaxCharacters,
                              )
                            : defaultMaxCharacters;
                    const response = await withAbortableTimeout(
                        (signal) =>
                            client.getContents(
                                [canonicalUrl],
                                {
                                    text: { maxCharacters },
                                },
                                { signal },
                            ),
                        timeoutMs,
                    );

                    if (response.results.length === 0) {
                        throw new ExaContentsError(
                            "No contents returned for URL",
                            "no_contents_returned",
                        );
                    }
                    if (response.results.length > 1) {
                        throw new ExaContentsError(
                            `Exa returned multiple results (${response.results.length}) for a single URL request`,
                            "unexpected_result_count",
                        );
                    }

                    const firstResult = response.results[0];
                    if (!firstResult) {
                        throw new ExaContentsError(
                            "No contents returned for URL",
                            "no_contents_returned",
                        );
                    }

                    if (
                        canonicalizeUrl(firstResult.url) !==
                        canonicalizeUrl(canonicalUrl)
                    ) {
                        throw new ExaContentsError(
                            `Exa result URL mismatch: expected ${canonicalUrl}, got ${firstResult.url}`,
                            "url_mismatch",
                        );
                    }

                    const rawResultText = firstResult.text;
                    if (typeof rawResultText !== "string") {
                        throw new ExaContentsError(
                            "No text returned for URL",
                            "no_text_returned",
                        );
                    }

                    const rawBytes = new TextEncoder().encode(
                        rawResultText,
                    ).byteLength;
                    if (rawBytes > MAX_APPROVED_SOURCE_BYTES) {
                        throw new ExaContentsError(
                            `Raw Exa text byte length ${rawBytes} exceeds limit of ${MAX_APPROVED_SOURCE_BYTES} bytes`,
                            "response_too_large",
                        );
                    }

                    const rawText = rawResultText.trim();
                    if (!rawText) {
                        throw new ExaContentsError(
                            "No text returned for URL",
                            "no_text_returned",
                        );
                    }

                    if (dependencies.recordAttempt) {
                        await dependencies.recordAttempt({
                            operation,
                            operationKey,
                            status: "succeeded",
                            attempt,
                            latencyMs: Math.max(0, now() - startedAt),
                            reportedCost: response.costDollars?.total,
                            usage: {
                                searchTime: response.searchTime,
                                providerReference: firstResult.id,
                            },
                        });
                    }

                    return {
                        text: rawText,
                        providerReference: firstResult.id,
                        title: firstResult.title ?? undefined,
                        searchTime: response.searchTime,
                        costDollars: response.costDollars?.total,
                        ...(rawResultText.length >= maxCharacters
                            ? { textLimitReached: true as const }
                            : {}),
                    };
                } catch (error) {
                    const latencyMs = Math.max(0, now() - startedAt);
                    const errorCode =
                        error instanceof ExaContentsError
                            ? error.errorCode
                            : error instanceof Error
                              ? error.name
                              : "UnknownProviderError";

                    if (dependencies.recordAttempt) {
                        await dependencies.recordAttempt({
                            operation,
                            operationKey,
                            status: "failed",
                            attempt,
                            latencyMs,
                            errorCode,
                            dispatchOutcome: /^http_\d{3}$/.test(errorCode)
                                ? "response_received"
                                : "unknown",
                            httpStatus: /^http_\d{3}$/.test(errorCode)
                                ? Number(errorCode.slice(5))
                                : undefined,
                            retryAfterAt:
                                error instanceof ExaContentsError
                                    ? error.retryAfterAt
                                    : undefined,
                        });
                    }

                    const retryable = isRetryableExaError(error);
                    if (
                        !retryable ||
                        (dependencies.retryPolicy === "confirmed_response" &&
                            !(
                                error instanceof ExaContentsError &&
                                /^http_(408|429|500|502|503|504)$/.test(
                                    error.errorCode,
                                )
                            )) ||
                        attempt ===
                            (dependencies.maxAttempts ??
                                MAX_EXA_CONTENTS_ATTEMPTS)
                    ) {
                        throw error;
                    }
                }
            }

            throw new ExaContentsError(
                "Exa contents retrieval exhausted its retry budget",
                "ExaRetryExhaustedError",
            );
        },
    };
}

export type ExaSearchClient = {
    search(
        query: string,
        options: {
            type: "auto";
            numResults: number;
            contents: false;
            includeDomains?: Array<string>;
        },
    ): Promise<{
        results: ReadonlyArray<ExaSearchResult>;
        searchTime?: number;
        costDollars?: { total: number };
    }>;
};

export type DiscoveredSourceCandidate = {
    canonicalUrl: string;
    title: string;
    publishedAt?: number;
    providerReference: string;
    providerResultPosition: number;
};

export type ExaCandidateBatch<Candidate> = {
    candidates: ReadonlyArray<Candidate>;
    rejected: number;
    searchTime?: number;
    costDollars?: number;
};

/**
 * Exa client contract for semantic company search. The `category: 'company'`
 * parameter returns structured entities (homepage URL + company name), which
 * the website resolver uses to find a marketing website when SEC
 * `investorWebsite` is empty or a vendor subdomain.
 */
export type ExaCompanySearchClient = {
    search(
        query: string,
        options: {
            type: "auto";
            category: "company";
            numResults: number;
            contents: false;
        },
    ): Promise<{
        results: ReadonlyArray<{
            id: string;
            url: string;
            title: string | null;
            entities?: ReadonlyArray<{
                type: string;
                properties?: { name?: string | null };
            }>;
        }>;
        searchTime?: number;
        costDollars?: { total: number };
    }>;
};

/**
 * Builds the company-search adapter from an Exa client. Shares the same
 * public-HTTPS contract as the source-discovery adapter so neither leaks
 * non-public URLs. Drops provider-specific fields (entity `id`, image, etc.)
 * so the website resolver stays provider-agnostic.
 */
export function createExaWebsiteAdapter(client: ExaCompanySearchClient): {
    search(query: string): Promise<
        ExaCandidateBatch<{
            url: string;
            entityName: string;
        }>
    >;
} {
    return {
        async search(query) {
            const response = await client.search(query, {
                type: "auto",
                category: "company",
                numResults: 5,
                contents: false,
            });
            const candidates: Array<{ url: string; entityName: string }> = [];
            let rejected = 0;
            for (const result of response.results) {
                try {
                    const url = new URL(result.url);
                    if (
                        url.protocol !== "https:" ||
                        url.username ||
                        url.password ||
                        (url.port && url.port !== "443")
                    ) {
                        throw new Error("Invalid public HTTPS result");
                    }
                    url.port = "";
                    url.hash = "";
                    const entityName =
                        result.entities?.find((e) => e.type === "company")
                            ?.properties?.name ??
                        result.title?.trim() ??
                        url.hostname;
                    candidates.push({
                        url: url.toString(),
                        entityName: entityName ?? url.hostname,
                    });
                } catch {
                    rejected += 1;
                }
            }
            return {
                candidates,
                rejected,
                searchTime: response.searchTime,
                costDollars: response.costDollars?.total,
            };
        },
    };
}

export function createExaDiscoveryAdapter(client: ExaSearchClient): {
    search(
        query: string,
        limit: number,
        includeDomains?: ReadonlyArray<string>,
    ): Promise<ExaCandidateBatch<DiscoveredSourceCandidate>>;
} {
    return {
        async search(query, limit, includeDomains) {
            const response = await client.search(query, {
                type: "auto",
                numResults: Math.max(1, Math.min(10, Math.floor(limit))),
                contents: false,
                ...(includeDomains && includeDomains.length > 0
                    ? { includeDomains: [...includeDomains] }
                    : {}),
            });
            const candidates: Array<DiscoveredSourceCandidate> = [];
            let rejected = 0;
            for (const [
                providerResultPosition,
                result,
            ] of response.results.entries()) {
                try {
                    const url = new URL(result.url);
                    if (
                        url.protocol !== "https:" ||
                        url.username ||
                        url.password ||
                        (url.port && url.port !== "443")
                    ) {
                        throw new Error("Invalid public HTTPS result");
                    }
                    url.port = "";
                    url.hash = "";
                    const publishedAt = result.publishedDate
                        ? Date.parse(result.publishedDate)
                        : Number.NaN;
                    candidates.push({
                        canonicalUrl: url.toString(),
                        title: result.title?.trim() || url.hostname,
                        publishedAt: Number.isFinite(publishedAt)
                            ? publishedAt
                            : undefined,
                        providerReference: result.id,
                        providerResultPosition,
                    });
                } catch {
                    rejected += 1;
                }
            }
            return {
                candidates,
                rejected,
                searchTime: response.searchTime,
                costDollars: response.costDollars?.total,
            };
        },
    };
}

/** Reads a bounded Exa JSON response and preserves caller cancellation. */
export async function readExaResponseJson(
    response: Response,
    signal: AbortSignal,
): Promise<unknown> {
    const declaredBytes = Number(response.headers.get("content-length"));
    if (declaredBytes > MAX_APPROVED_SOURCE_BYTES) {
        await response.body?.cancel();
        throw new ExaContentsError(
            "Exa response exceeds the byte limit",
            "response_too_large",
        );
    }
    const reader = response.body?.getReader();
    if (!reader)
        throw new ExaContentsError("Empty Exa response", "invalid_response");
    const decoder = new TextDecoder();
    let bytes = 0;
    let text = "";
    try {
        while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            bytes += chunk.value.byteLength;
            if (bytes > MAX_APPROVED_SOURCE_BYTES) {
                await reader.cancel();
                throw new ExaContentsError(
                    "Exa response exceeds the byte limit",
                    "response_too_large",
                );
            }
            text += decoder.decode(chunk.value, { stream: true });
        }
    } finally {
        reader.releaseLock();
    }
    signal.throwIfAborted();
    let parsed: unknown;
    try {
        parsed = JSON.parse(text + decoder.decode());
    } catch {
        throw new ExaContentsError(
            "Exa returned invalid JSON",
            "invalid_response",
        );
    }
    return parsed;
}
