import {
    MAX_SOURCE_EMBEDDING_BATCH_TEXTS,
    MAX_SOURCE_EMBEDDING_TEXT_BYTES,
    SOURCE_EMBEDDING_DIMENSIONS,
    SOURCE_EMBEDDING_PRICE_CEILING_PER_MILLION_TOKENS,
    SOURCE_EMBEDDING_PROFILE_VERSION,
} from "@convex/resourceLimits";
/** Provider details live at this boundary; derived records carry only the opaque profile version. */
export const SOURCE_EMBEDDING_PROFILE = {
    id: SOURCE_EMBEDDING_PROFILE_VERSION,
    model: "@cf/baai/bge-m3",
    dimensions: SOURCE_EMBEDDING_DIMENSIONS,
    maximumTextBytes: MAX_SOURCE_EMBEDDING_TEXT_BYTES,
    maximumBatchSize: MAX_SOURCE_EMBEDDING_BATCH_TEXTS,
    priceCeilingPerMillionTokens:
        SOURCE_EMBEDDING_PRICE_CEILING_PER_MILLION_TOKENS,
} as const;
export type EmbeddingResult =
    | { status: "embedded"; vectors: number[][]; submittedBytes: number }
    | {
          status: "unavailable";
          reason:
              | "missing_configuration"
              | "request_invalid"
              | "transport_unavailable"
              | "response_invalid";
      };

/** Rejects partial, truncated and malformed batches before they can enter a search index. */
export function validateEmbeddingVectors(
    value: unknown,
    expectedCount: number,
): number[][] | undefined {
    if (
        typeof value !== "object" ||
        value === null ||
        !("shape" in value) ||
        !("data" in value)
    )
        return;
    const { shape, data } = value;
    if (
        !Array.isArray(shape) ||
        shape.length !== 2 ||
        shape[0] !== expectedCount ||
        shape[1] !== SOURCE_EMBEDDING_PROFILE.dimensions ||
        !Array.isArray(data) ||
        data.length !== expectedCount ||
        data.some(
            (vector) =>
                !Array.isArray(vector) ||
                vector.length !== SOURCE_EMBEDDING_PROFILE.dimensions ||
                vector.some(
                    (n) => typeof n !== "number" || !Number.isFinite(n),
                ) ||
                !vector.some((n) => n !== 0),
        )
    )
        return;
    return data;
}

/** One bounded REST attempt. Unknown outcomes are intentionally not retried here. */
export async function embedSourceTexts(args: {
    accountId?: string;
    apiToken?: string;
    texts: string[];
    signal?: AbortSignal;
}): Promise<EmbeddingResult> {
    if (!args.accountId || !args.apiToken)
        return { status: "unavailable", reason: "missing_configuration" };
    const lengths = args.texts.map(
        (text) => new TextEncoder().encode(text).length,
    );
    if (
        !/^[a-f0-9]{32}$/.test(args.accountId) ||
        args.texts.length < 1 ||
        args.texts.length > SOURCE_EMBEDDING_PROFILE.maximumBatchSize ||
        lengths.some(
            (n) => n < 1 || n > SOURCE_EMBEDDING_PROFILE.maximumTextBytes,
        )
    )
        return { status: "unavailable", reason: "request_invalid" };
    const timeout = AbortSignal.timeout(30_000);
    const signal = args.signal
        ? AbortSignal.any([timeout, args.signal])
        : timeout;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
        const response = await fetch(
            `https://api.cloudflare.com/client/v4/accounts/${args.accountId}/ai/run/${SOURCE_EMBEDDING_PROFILE.model}`,
            {
                method: "POST",
                redirect: "error",
                signal,
                headers: {
                    Authorization: `Bearer ${args.apiToken}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    text: args.texts,
                    truncate_inputs: false,
                }),
            },
        );
        if (!response.ok || !response.body) {
            await response.body?.cancel();
            return { status: "unavailable", reason: "transport_unavailable" };
        }
        reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let bytes = 0;
        while (true) {
            const next = await reader.read();
            signal.throwIfAborted();
            if (next.done) break;
            bytes += next.value.byteLength;
            if (bytes > 1024 * 1024) {
                await reader.cancel();
                return { status: "unavailable", reason: "response_invalid" };
            }
            chunks.push(next.value);
        }
        const buffer = new Uint8Array(bytes);
        let offset = 0;
        for (const chunk of chunks) {
            buffer.set(chunk, offset);
            offset += chunk.byteLength;
        }
        const body: unknown = JSON.parse(
            new TextDecoder("utf-8", { fatal: true }).decode(buffer),
        );
        const vectors =
            typeof body === "object" &&
            body !== null &&
            "success" in body &&
            body.success === true &&
            "result" in body
                ? validateEmbeddingVectors(body.result, args.texts.length)
                : undefined;
        return vectors
            ? {
                  status: "embedded",
                  vectors,
                  submittedBytes: lengths.reduce((a, b) => a + b, 0),
              }
            : { status: "unavailable", reason: "response_invalid" };
    } catch {
        return { status: "unavailable", reason: "transport_unavailable" };
    } finally {
        reader?.releaseLock();
    }
}
