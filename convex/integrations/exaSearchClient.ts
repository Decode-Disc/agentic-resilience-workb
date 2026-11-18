import { DiscoveryRequestError } from "@convex/domain/sourceDiscoveryRecovery";
import { SOURCE_SELECTION_PROPOSAL_TIMEOUT_MS as PROVIDER_TIMEOUT_MS } from "@convex/resourcePolicy";
import { createExaDiscoveryAdapter, readExaResponseJson } from "./exa";
import { readExaApiKey } from "./exaConfiguration";

export async function fetchExaSearch(
    apiKey: string,
    query: string,
    options: {
        type: "auto";
        numResults: number;
        contents: false;
        includeDomains?: Array<string>;
    },
    requestSignal?: AbortSignal,
) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
    try {
        const signal = requestSignal
            ? AbortSignal.any([controller.signal, requestSignal])
            : controller.signal;
        signal.throwIfAborted();
        const response = await fetch("https://api.exa.ai/search", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-api-key": apiKey,
            },
            // `false` opts out in the SDK; the HTTP API expects this field omitted.
            body: JSON.stringify({ query, ...options, contents: undefined }),
            signal,
            redirect: "error",
        });
        if (!response.ok) {
            await response.body?.cancel();
            throw new DiscoveryRequestError(
                `http_${response.status}`,
                response.status === 408 ||
                    response.status === 429 ||
                    response.status >= 500,
            );
        }
        const payload: unknown = await readExaResponseJson(response, signal);
        if (!payload || typeof payload !== "object") {
            throw new DiscoveryRequestError("invalid_response", false);
        }
        const record = payload as Record<string, unknown>;
        if (!Array.isArray(record.results)) {
            throw new DiscoveryRequestError("invalid_response", false);
        }
        const results = record.results.flatMap((value) => {
            if (!value || typeof value !== "object") return [];
            const result = value as Record<string, unknown>;
            if (
                typeof result.id !== "string" ||
                typeof result.url !== "string"
            ) {
                return [];
            }
            return [
                {
                    id: result.id,
                    url: result.url,
                    title:
                        typeof result.title === "string" ? result.title : null,
                    publishedDate:
                        typeof result.publishedDate === "string"
                            ? result.publishedDate
                            : undefined,
                },
            ];
        });
        const costDollars =
            record.costDollars && typeof record.costDollars === "object"
                ? (record.costDollars as Record<string, unknown>)
                : undefined;
        return {
            results,
            rejectedResults: record.results.length - results.length,
            searchTime:
                typeof record.searchTime === "number"
                    ? record.searchTime
                    : undefined,
            costDollars:
                typeof costDollars?.total === "number"
                    ? { total: costDollars.total }
                    : undefined,
        };
    } finally {
        clearTimeout(timeout);
    }
}

/** Configures metadata-only HTTP discovery without dispatching a search. */
export function configuredExaHttpDiscovery() {
    const apiKey = readExaApiKey();
    if (!apiKey) return undefined;
    return (
        query: string,
        limit: number,
        includeDomains?: ReadonlyArray<string>,
        signal?: AbortSignal,
    ) =>
        createExaDiscoveryAdapter({
            search: (text, options) =>
                fetchExaSearch(apiKey, text, options, signal),
        }).search(query, limit, includeDomains);
}
