"use node";

import { internal } from "@convex/_generated/api";
import type { Doc } from "@convex/_generated/dataModel";
import { internalAction } from "@convex/_generated/server";
import { v } from "convex/values";

/** Reads bounded provider accounting independently of model output and mission authority. */
export const reconcile = internalAction({
    args: { providerCallId: v.id("providerCalls"), attempt: v.number() },
    returns: v.null(),
    handler: async (ctx, args) => {
        const claim = await ctx.runMutation(
            internal.providerCalls.claimBilling,
            args,
        );
        if (!claim) return null;
        const startedAt = Date.now();
        let httpStatus: number | undefined;
        let cost: number | undefined;
        let cancelled: true | undefined;
        let reason: NonNullable<Doc<"providerCalls">["billing"]>["reason"];
        const key = process.env.OPENROUTER_API_KEY?.trim();
        if (!key) reason = "missing_configuration";
        else {
            const signal = AbortSignal.timeout(15_000);
            let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
            try {
                const url = new URL("https://openrouter.ai/api/v1/generation");
                url.searchParams.set("id", claim.generationId);
                const response = await fetch(url, {
                    method: "GET",
                    headers: { Authorization: `Bearer ${key}` },
                    redirect: "error",
                    signal,
                });
                httpStatus = response.status;
                reader = response.body?.getReader();
                if (!response.ok)
                    reason =
                        response.status === 404 ? "not_found" : "http_error";
                else {
                    const chunks: Uint8Array[] = [];
                    let bytes = 0;
                    if (reader)
                        while (true) {
                            const part = await reader.read();
                            if (part.done) break;
                            bytes += part.value.byteLength;
                            if (bytes > 64 * 1024) {
                                reason = "response_too_large";
                                break;
                            }
                            chunks.push(part.value);
                        }
                    if (!reason) {
                        const body = new Uint8Array(bytes);
                        let offset = 0;
                        for (const chunk of chunks) {
                            body.set(chunk, offset);
                            offset += chunk.byteLength;
                        }
                        let value: unknown;
                        try {
                            value = JSON.parse(new TextDecoder().decode(body));
                        } catch {
                            reason = "invalid_response";
                        }
                        const data =
                            value &&
                            typeof value === "object" &&
                            "data" in value
                                ? value.data
                                : undefined;
                        if (
                            data &&
                            typeof data === "object" &&
                            "id" in data &&
                            data.id === claim.generationId &&
                            "total_cost" in data &&
                            typeof data.total_cost === "number" &&
                            Number.isFinite(data.total_cost) &&
                            data.total_cost >= 0
                        ) {
                            cost = data.total_cost;
                            if ("cancelled" in data && data.cancelled === true)
                                cancelled = true;
                        } else reason = "invalid_response";
                    }
                }
            } catch {
                reason = signal.aborted ? "timeout" : "transport_error";
            } finally {
                if (reader) {
                    try {
                        await reader.cancel();
                    } catch {
                        reason ??= "transport_error";
                    } finally {
                        reader.releaseLock();
                    }
                }
            }
        }
        await ctx.runMutation(internal.providerCalls.settleBilling, {
            ...args,
            generationId: claim.generationId,
            httpStatus,
            latencyMs: Date.now() - startedAt,
            ...(cost !== undefined ? { cost, cancelled } : { reason }),
        });
        return null;
    },
});
