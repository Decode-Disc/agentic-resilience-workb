"use node";

import Exa from "exa-js";
import { z } from "zod";
import { MAX_APPROVED_SOURCE_BYTES } from "@convex/resourceLimits";
import { ExaContentsError, type ExaContentsClient } from "./exa";

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
            );
        }
        const declaredBytes = Number(response.headers.get("content-length"));
        if (declaredBytes > MAX_APPROVED_SOURCE_BYTES) {
            await response.body?.cancel();
            throw new ExaContentsError(
                "Exa Contents response exceeds the byte limit",
                "response_too_large",
            );
        }
        const reader = response.body?.getReader();
        if (!reader)
            throw new ExaContentsError(
                "Empty Exa Contents response",
                "invalid_response",
            );
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
                        "Exa Contents response exceeds the byte limit",
                        "response_too_large",
                    );
                }
                text += decoder.decode(chunk.value, { stream: true });
            }
        } finally {
            reader.releaseLock();
        }
        this.requestSignal.throwIfAborted();
        let parsed: unknown;
        try {
            parsed = JSON.parse(text + decoder.decode());
        } catch {
            throw new ExaContentsError(
                "Exa Contents returned invalid JSON",
                "invalid_response",
            );
        }
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
