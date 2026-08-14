"use node";

import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";

import { api, internal } from "./_generated/api";
import { action } from "./_generated/server";

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

        // Rate-limit: max 2 renders per (visitor, run, source) in 30s window.
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
                return {
                    status: "ok",
                    base64: `data:${contentType};base64,${base64}`,
                };
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
