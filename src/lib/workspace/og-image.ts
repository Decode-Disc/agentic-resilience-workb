/**
 * Client-side Open Graph image resolution for company website URLs.
 *
 * Fetches the page's `og:image` / `twitter:image` URL via a third-party
 * unfurl proxy (`api.poly.io/og`). The returned image URL points at a static
 * CDN, which — unlike the company homepage itself — is not protected by a bot
 * manager, so the browser can load it directly.
 *
 * This is the primary tier of the cover-image cascade: OG image → screenshot
 * (self-hosted Playwright service) → placeholder. See
 * `useCompanyCoverImage` for the full cascade.
 *
 * The proxy is CORS-enabled and requires no API key. It fails cleanly (returns
 * `null`) when the site blocks crawlers, which is exactly when we fall back to
 * the screenshot tier.
 */

const OG_PROXY_ENDPOINT = "https://api.poly.io/og";

type OgProxyResponse = {
    ok: boolean;
    imageUrl?: string;
    imageOk?: boolean;
};

/**
 * Resolves the Open Graph image URL for a public HTTPS website.
 *
 * Returns the absolute `og:image` / `twitter:image` URL, or `null` when the
 * URL is invalid, non-HTTPS, the proxy fails, the site blocks the crawler, or
 * the page has no usable OG image.
 *
 * @param canonicalUrl The company website URL (preferred) or IR URL (fallback).
 */
export async function resolveOgImage(
    canonicalUrl: string,
): Promise<string | null> {
    let url: URL;
    try {
        url = new URL(canonicalUrl);
    } catch {
        return null;
    }
    if (url.protocol !== "https:") {
        return null;
    }
    if (!url.hostname) {
        return null;
    }

    const proxyUrl = `${OG_PROXY_ENDPOINT}?${new URLSearchParams({
        url: url.href,
    }).toString()}`;

    try {
        const response = await fetch(proxyUrl, {
            headers: { Accept: "application/json" },
        });
        if (!response.ok) {
            return null;
        }
        const data = (await response.json()) as OgProxyResponse;
        if (!data.ok || !data.imageUrl || data.imageOk === false) {
            return null;
        }
        return data.imageUrl;
    } catch {
        return null;
    }
}
