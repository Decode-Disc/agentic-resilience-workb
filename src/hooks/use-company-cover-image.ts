import { api } from "@convex/_generated/api";
import { useAction } from "convex/react";
import { useEffect, useState } from "react";

import { resolveOgImage } from "@/lib/workspace/og-image";

const FALLBACK_IMAGE = "/images/placeholders/research-dossier-cover.png";

/**
 * Session-scoped cache of rendered screenshots, keyed by the candidate URL.
 * Pending work is shared across effect lifetimes; a resolved `null` retains a failed attempt for the SPA session. The cheaper OG lookup is not cached.
 */
const screenshotCache = new Map<string, Promise<string | null>>();

type CoverImageState = {
    candidateUrl: string | null;
    tier: "og" | "screenshot" | "placeholder";
    src: string | null;
};

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
 * placeholder.
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

    const [image, setImage] = useState<CoverImageState>({
        candidateUrl: null,
        tier: "placeholder",
        src: null,
    });

    useEffect(() => {
        let cancelled = false;
        setImage({ candidateUrl, tier: "og", src: null });
        if (!candidateUrl) return;
        void resolveOgImage(candidateUrl).then((src) => {
            if (!cancelled) {
                setImage({
                    candidateUrl,
                    tier: src ? "og" : "screenshot",
                    src,
                });
            }
        });
        return () => {
            cancelled = true;
        };
    }, [candidateUrl]);

    useEffect(() => {
        if (
            !candidateUrl ||
            image.candidateUrl !== candidateUrl ||
            image.tier !== "screenshot"
        )
            return;
        let cancelled = false;
        let pending = screenshotCache.get(candidateUrl);
        if (!pending) {
            pending = renderPreview({ url: candidateUrl })
                .then((result) =>
                    result.status === "ok" ? result.dataUrl : null,
                )
                .catch(() => null);
            screenshotCache.set(candidateUrl, pending);
        }
        void pending.then((src) => {
            if (!cancelled) {
                setImage({
                    candidateUrl,
                    tier: src ? "screenshot" : "placeholder",
                    src,
                });
            }
        });
        return () => {
            cancelled = true;
        };
    }, [candidateUrl, image.candidateUrl, image.tier, renderPreview]);

    return {
        src:
            image.candidateUrl === candidateUrl
                ? (image.src ?? FALLBACK_IMAGE)
                : FALLBACK_IMAGE,
        onError: () => {
            if (image.candidateUrl !== candidateUrl || !image.src) return;
            setImage((current) =>
                current !== image
                    ? current
                    : {
                          candidateUrl,
                          tier:
                              image.tier === "og"
                                  ? "screenshot"
                                  : "placeholder",
                          src: null,
                      },
            );
        },
    };
}
