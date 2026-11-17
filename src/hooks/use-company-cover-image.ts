import { api } from "@convex/_generated/api";
import { useAction } from "convex/react";
import { useEffect, useRef, useState } from "react";

import { resolveOgImage } from "@/lib/workspace/og-image";

const FALLBACK_IMAGE = "/images/placeholders/research-dossier-cover.png";

/**
 * Session-scoped cache of rendered screenshots, keyed by the candidate URL.
 * A value of `null` means the render previously failed, so we don't hammer the
 * preview service again within the same SPA session. The cheaper OG-image
 * resolution is not cached — it is a light client-side fetch.
 */
const screenshotCache = new Map<string, string | null>();

/**
 * Resolves a cover image for a company website using a three-tier cascade:
 *
 *   1. **OG image** — the page's `og:image` / `twitter:image`, fetched via a
 *      third-party unfurl proxy. The image lives on a static CDN that is not
 *      bot-protected, so it loads even when the homepage itself blocks bots.
 *   2. **Screenshot** — a self-hosted Playwright render via the preview
 *      service, for sites whose homepage blocks the unfurl crawler.
 *   3. **Placeholder** — when neither tier produces a usable image.
 *
 * The cascade mirrors {@link CompanyFaviconAvatar}: `websiteUrl` →
 * `investorRelationsUrl` → placeholder.
 *
 * `onError` advances the cascade one tier: an OG image that fails to load
 * triggers the screenshot tier; a screenshot data URL that fails triggers the
 * placeholder (effectively a no-op, since data URLs rarely fail).
 *
 * @returns An object with `src` (ready for `<img src>`) and `onError` (attach
 *          to the `<img>` to advance the cascade on load failure).
 */
export function useCompanyCoverImage(
    websiteUrl?: string,
    investorRelationsUrl?: string,
): {
    src: string;
    onError: () => void;
} {
    const renderPreview = useAction(api.companyCoverImage.renderCompanyPreview);
    const candidateUrl = websiteUrl ?? investorRelationsUrl ?? null;

    const [ogUrl, setOgUrl] = useState<string | null>(null);
    const [useScreenshot, setUseScreenshot] = useState(false);
    const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
    const [screenshotFailed, setScreenshotFailed] = useState(false);
    const requestedRef = useRef(false);

    // Tier 1: resolve the OG image URL (cheap client-side fetch).
    useEffect(() => {
        if (!candidateUrl) {
            setOgUrl(null);
            setUseScreenshot(false);
            return;
        }
        let cancelled = false;
        setOgUrl(null);
        setUseScreenshot(false);
        void resolveOgImage(candidateUrl).then((url) => {
            if (cancelled) {
                return;
            }
            setOgUrl(url);
            if (!url) {
                setUseScreenshot(true);
            }
        });
        return () => {
            cancelled = true;
        };
    }, [candidateUrl]);

    // Tier 2: fall back to a screenshot when there is no OG image.
    useEffect(() => {
        if (!candidateUrl || !useScreenshot) {
            return;
        }

        if (screenshotCache.has(candidateUrl)) {
            const cached = screenshotCache.get(candidateUrl) ?? null;
            setScreenshotUrl(cached);
            setScreenshotFailed(cached === null);
            return;
        }

        // Dedupe the expensive render within a single mount (StrictMode-safe).
        if (requestedRef.current) {
            return;
        }
        requestedRef.current = true;

        void renderPreview({ url: candidateUrl })
            .then((result) => {
                if (result.status === "ok") {
                    screenshotCache.set(candidateUrl, result.dataUrl);
                    setScreenshotUrl(result.dataUrl);
                } else {
                    screenshotCache.set(candidateUrl, null);
                    setScreenshotFailed(true);
                }
            })
            .catch(() => {
                screenshotCache.set(candidateUrl, null);
                setScreenshotFailed(true);
            });
    }, [candidateUrl, useScreenshot, renderPreview]);

    let src = FALLBACK_IMAGE;
    let onError: () => void = () => {};

    if (candidateUrl) {
        if (!useScreenshot && ogUrl) {
            src = ogUrl;
            onError = () => setUseScreenshot(true);
        } else if (useScreenshot && !screenshotFailed && screenshotUrl) {
            src = screenshotUrl;
            onError = () => setScreenshotFailed(true);
        }
    }

    return { src, onError };
}
