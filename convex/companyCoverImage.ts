"use node";

import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";

import { internal } from "./_generated/api";
import { action } from "./_generated/server";
import { validateCoverImageUrl } from "./domain/coverImageUrl";

/**
 * Renders a decorative cover image for a company website using the
 * self-hosted Playwright preview service.
 *
 * Unlike `browserPreview.renderPreview`, this action is not gated on a source
 * ownership or `pending` decision — it only needs a public HTTPS URL. The
 * cover image is decorative (not evidence), so it carries no claim
 * classification, provenance, or passage locator.
 *
 * The service itself revalidates DNS/SSRF on every redirect hop (ADR-019);
 * this action applies a light synchronous URL gate as a first line, then
 * rate-limits the expensive render path.
 */
export const renderCompanyPreview = action({
    args: {
        url: v.string(),
    },
    returns: v.union(
        v.object({ status: v.literal("ok"), dataUrl: v.string() }),
        v.object({ status: v.literal("unavailable"), error: v.string() }),
    ),
    handler: async (
        ctx,
        args,
    ): Promise<
        | { status: "ok"; dataUrl: string }
        | { status: "unavailable"; error: string }
    > => {
        const authUserId = await getAuthUserId(ctx);
        if (!authUserId) {
            return { status: "unavailable", error: "unauthorized" };
        }

        if (!(await ctx.runQuery(internal.runWorkspace.authorizeProvider, {})))
            return { status: "unavailable", error: "test_data" };

        const validatedUrl = validateCoverImageUrl(args.url);
        if (!validatedUrl) {
            return { status: "unavailable", error: "invalid_url" };
        }

        const serviceUrl = process.env.PREVIEW_SERVICE_URL;
        const serviceSecret = process.env.PREVIEW_SERVICE_SECRET;
        if (!serviceUrl || !serviceSecret) {
            return { status: "unavailable", error: "service_unavailable" };
        }

        // Rate-limit only the expensive render path. The key differs from the
        // evidence previews so the two do not contend for the same bucket.
        const rateLimitResult = await ctx.runMutation(
            internal.browserPreviewInternals.checkRateLimit,
            { key: `cover:${authUserId}:${validatedUrl}` },
        );
        if (!rateLimitResult.allowed) {
            return { status: "unavailable", error: "rate_limited" };
        }

        try {
            const response = await fetch(`${serviceUrl}/render`, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${serviceSecret}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ url: validatedUrl }),
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
                return { status: "ok", dataUrl };
            }

            return {
                status: "unavailable",
                error: `service_error_${response.status}`,
            };
        } catch (err) {
            const reason =
                err instanceof Error && err.name === "TimeoutError"
                    ? "timeout"
                    : "fetch_failed";
            return { status: "unavailable", error: reason };
        }
    },
});
