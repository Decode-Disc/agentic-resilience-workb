"use node";

import { providerRetryAfterAt } from "@convex/domain/sourcePreparationAuthority";
import Exa from "exa-js";
import { z } from "zod";
import {
    type ExaContentsClient,
    ExaContentsError,
    readExaResponseJson,
} from "./exa";

const contentsResponseSchema = z.looseObject({
    results: z.array(
        z.looseObject({
            id: z.string(),
            url: z.string(),
            title: z.string().nullable().optional(),
            text: z.string().optional(),
        }),
    ),
    searchTime: z.number().optional(),
    costDollars: z.looseObject({ total: z.number() }).optional(),
});

// exa-js 2.16 does not expose a per-request signal. Keep its getContents
// validation and payload construction, replacing only this instance's transport.
class AbortableContentsExa extends Exa {
    constructor(
        private readonly contentsApiKey: string,
        private readonly requestSignal: AbortSignal,
    ) {
        super(contentsApiKey);
    }

    override async request<T = unknown>(
        endpoint: string,
        method: string,
        body?: unknown,
        params?: Record<string, unknown>,
        headers?: Record<string, string>,
    ): Promise<T> {
        if (
            endpoint !== "/contents" ||
            method !== "POST" ||
            (params && Object.keys(params).length > 0)
        ) {
            throw new ExaContentsError(
                "Unsupported SDK Contents request",
                "unsupported_request",
            );
        }
        this.requestSignal.throwIfAborted();
        const response = await globalThis.fetch(
            `https://api.exa.ai${endpoint}`,
            {
                method,
                headers: {
                    ...headers,
                    "x-api-key": this.contentsApiKey,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(body),
                signal: this.requestSignal,
                redirect: "error",
            },
        );
        if (!response.ok) {
            await response.body?.cancel();
            throw new ExaContentsError(
                `Exa Contents request failed with status ${response.status}`,
                `http_${response.status}`,
                providerRetryAfterAt(
                    response.headers.get("retry-after"),
                    Date.now(),
                ),
            );
        }
        const parsed = await readExaResponseJson(response, this.requestSignal);
        const result = contentsResponseSchema.safeParse(parsed);
        if (!result.success)
            throw new ExaContentsError(
                "Exa Contents returned an invalid response",
                "invalid_response",
            );
        return result.data as T;
    }
}

export function createExaContentsClient(apiKey: string): ExaContentsClient {
    return {
        async getContents(urls, options, requestOptions) {
            if (!requestOptions?.signal)
                throw new ExaContentsError(
                    "Contents retrieval requires a cancellation signal",
                    "missing_signal",
                );
            const client = new AbortableContentsExa(
                apiKey,
                requestOptions.signal,
            );
            return client.getContents(urls, options);
        },
    };
}
