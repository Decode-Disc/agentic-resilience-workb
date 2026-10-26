"use node";

import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";

import { api, internal } from "./_generated/api";
import { action } from "./_generated/server";
import { PREVIEW_CACHE_MAX_BYTES, previewCacheTtlMs } from "./resourceLimits";

export const renderPreview = action({
    args: {
        sourceId: v.id("sources"),
        runId: v.id("researchRuns"),
    },
    returns: v.union(
        v.object({ status: v.literal("ok"), base64: v.string() }),
        v.object({ status: v.literal("unavailable"), error: v.string() }),
    ),
    handler: async (
        ctx,
        args,
    ): Promise<
        | { status: "ok"; base64: string }
        | { status: "unavailable"; error: string }
    > => {
        const authUserId = await getAuthUserId(ctx);
        if (!authUserId) {
            return { status: "unavailable", error: "unauthorized" };
        }

        // Resolve the visitor from the auth identity.
        const visitor = await ctx.runQuery(api.visitors.current, {});
        if (!visitor) {
            return { status: "unavailable", error: "visitor_not_found" };
        }
        const visitorId = visitor._id;

        // Validate source ownership and that it is still pending.
        const source = await ctx.runQuery(
            internal.browserPreviewInternals.getSourceForPreview,
            { sourceId: args.sourceId, runId: args.runId, visitorId },
        );

        if (!source) {
            return { status: "unavailable", error: "source_not_found" };
        }

        if (source.decision !== "pending") {
            return { status: "unavailable", error: "not_pending" };
        }

        // Serve a fresh cached screenshot without touching the render service.
        const cached = await ctx.runQuery(
            api.browserPreviewInternals.getPreview,
            { sourceId: args.sourceId },
        );
        if (cached) {
            return { status: "ok", base64: cached.dataUrl };
        }

        if (
            !(await ctx.runQuery(internal.runWorkspace.authorizeProvider, {
                runId: args.runId,
            }))
        )
            return { status: "unavailable", error: "test_data" };

        // Rate-limit only the expensive render path: max 2 renders per
        // (visitor, run, source) in a 30s window.
        const rateLimitKey = `preview:${visitorId}:${args.runId}:${args.sourceId}`;
        const rateLimitResult = await ctx.runMutation(
            internal.browserPreviewInternals.checkRateLimit,
            { key: rateLimitKey },
        );

        if (!rateLimitResult.allowed) {
            return { status: "unavailable", error: "rate_limited" };
        }

        const serviceUrl = process.env.PREVIEW_SERVICE_URL;
        const serviceSecret = process.env.PREVIEW_SERVICE_SECRET;

        if (!serviceUrl || !serviceSecret) {
            return { status: "unavailable", error: "service_unavailable" };
        }

        if (
            (
                await ctx.runQuery(
                    internal.browserPreviewInternals.getSourceForPreview,
                    {
                        sourceId: args.sourceId,
                        runId: args.runId,
                        visitorId,
                    },
                )
            )?.decision !== "pending"
        )
            return { status: "unavailable", error: "unauthorized" };

        try {
            const response = await fetch(`${serviceUrl}/render`, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${serviceSecret}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ url: source.canonicalUrl }),
                signal: AbortSignal.timeout(35_000),
            });

            if (response.ok) {
                const contentType = response.headers.get("content-type") ?? "";
                if (!contentType.includes("image/png")) {
                    return {
                        status: "unavailable",
                        error: "unexpected_content_type",
                    };
                }
                const buffer = await response.arrayBuffer();
                const base64 = Buffer.from(buffer).toString("base64");
                const dataUrl = `data:${contentType};base64,${base64}`;

                if (
                    (
                        await ctx.runQuery(
                            internal.browserPreviewInternals
                                .getSourceForPreview,
                            {
                                sourceId: args.sourceId,
                                runId: args.runId,
                                visitorId,
                            },
                        )
                    )?.decision !== "pending"
                )
                    return { status: "unavailable", error: "unauthorized" };

                // Cache the rendered screenshot when it fits within the size
                // cap; otherwise return it without persisting.
                if (buffer.byteLength <= PREVIEW_CACHE_MAX_BYTES) {
                    const stored = await ctx.runMutation(
                        internal.browserPreviewInternals.storePreview,
                        {
                            sourceId: args.sourceId,
                            visitorId,
                            dataUrl,
                            sizeBytes: buffer.byteLength,
                            expiresAt: Date.now() + previewCacheTtlMs(),
                        },
                    );
                    if (!stored)
                        return { status: "unavailable", error: "unauthorized" };
                }

                return { status: "ok", base64: dataUrl };
            }

            const errorBody = await response.json().catch(() => ({}));
            const errorCode =
                (errorBody as Record<string, unknown>).error?.toString() ??
                "render_failed";
            return { status: "unavailable", error: errorCode };
        } catch (err) {
            const reason =
                err instanceof Error && err.name === "TimeoutError"
                    ? "timeout"
                    : "fetch_failed";
            return { status: "unavailable", error: reason };
        }
    },
});
