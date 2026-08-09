import { getAuthUserId } from "@convex-dev/auth/server";

import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { httpAction } from "./_generated/server";

export const renderPreview = httpAction(async (ctx, request) => {
    const authUserId = await getAuthUserId(ctx);
    if (!authUserId) {
        return json(401, { error: "Unauthorized" });
    }

    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return json(400, { error: "Invalid JSON body" });
    }

    if (
        !body ||
        typeof body !== "object" ||
        !("sourceId" in body) ||
        !("runId" in body) ||
        typeof (body as Record<string, unknown>).sourceId !== "string" ||
        typeof (body as Record<string, unknown>).runId !== "string"
    ) {
        return json(400, { error: "sourceId and runId are required" });
    }

    const { sourceId, runId } = body as { sourceId: string; runId: string };

    // Resolve visitor from the auth identity
    const visitor = await ctx.runQuery(api.visitors.current, {});
    if (!visitor) {
        return json(403, { error: "Visitor not found" });
    }
    const visitorId = visitor._id as Id<"visitors">;

    // Validate source ownership and that it is still pending
    const source = await ctx.runQuery(
        internal.browserPreviewInternals.getSourceForPreview,
        {
            sourceId: sourceId as unknown as Id<"sources">,
            runId: runId as unknown as Id<"researchRuns">,
            visitorId,
        },
    );

    if (!source) {
        return json(404, { error: "Source not found or not accessible" });
    }

    if (source.decision !== "pending") {
        return json(422, {
            error: "preview_not_available",
            message:
                "Previews are only available for undecided candidate sources.",
        });
    }

    // Rate-limit: max 1 render per (visitor, run, source) in 30s window
    const rateLimitKey = `preview:${visitorId}:${runId}:${sourceId}`;
    const rateLimitResult = await ctx.runMutation(
        internal.browserPreviewInternals.checkRateLimit,
        { key: rateLimitKey },
    );

    if (!rateLimitResult.allowed) {
        return json(429, {
            error: "rate_limited",
            message: "Preview requested too frequently. Please wait.",
            retryAfterMs: rateLimitResult.retryAfterMs,
        });
    }

    const serviceUrl = process.env.PREVIEW_SERVICE_URL;
    const serviceSecret = process.env.PREVIEW_SERVICE_SECRET;

    if (!serviceUrl || !serviceSecret) {
        return json(503, {
            error: "service_unavailable",
            message: "Preview service is not configured.",
        });
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
                return json(502, {
                    error: "preview_unavailable",
                    message: "Preview service returned an unexpected response.",
                });
            }
            const buffer = await response.arrayBuffer();
            const base64 = Buffer.from(buffer).toString("base64");
            return json(200, {
                status: "ok",
                contentType: "image/png",
                base64: `data:${contentType};base64,${base64}`,
            });
        }

        const errorBody = await response.json().catch(() => ({}));
        const errorCode =
            (errorBody as Record<string, unknown>).error?.toString() ??
            "render_failed";
        return json(422, {
            error: "preview_unavailable",
            message: "Preview could not be generated for this source.",
            reason: errorCode,
        });
    } catch (err) {
        const reason =
            err instanceof Error && err.name === "TimeoutError"
                ? "timeout"
                : "fetch_failed";
        return json(503, {
            error: "preview_unavailable",
            message: "Preview service is temporarily unavailable.",
            reason,
        });
    }
});

function json(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}
