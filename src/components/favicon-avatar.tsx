import { LinkSquare01Icon } from "@hugeicons/core-free-icons";
import { useState } from "react";

import Icon from "@/components/icon";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { AvatarSize, PlatformIcon } from "@/types/ui";

const FAVICON_ENDPOINT = "https://www.google.com/s2/favicons";
const FAVICON_SIZE = "64";

type ParsedUrl = {
    hostname: string;
    faviconUrl: string;
    isHttps: boolean;
};

const FALLBACK_DELAY_MS = 400;

/**
 * Extracts the hostname and constructs a favicon request for any canonical
 * URL. Only public HTTPS URLs are eligible for a favicon request; everything
 * else delegates to the Avatar fallback. The hostname is passed to the favicon
 * endpoint via URLSearchParams so the source path never leaks into the request
 * URL.
 *
 * Endpoint note: the legacy `?domain=&sz=` form is retained intentionally. The
 * newer `faviconV2` `?url=` form returns an HTML 404 for uncrawled sites; the
 * legacy form at least returns a placeholder PNG. A successfully-decoded
 * placeholder is indistinguishable from a real favicon to `<img>`, so callers
 * relying on `onError` alone cannot catch that case — `onError` only handles
 * real load failures (network errors, non-image responses). Uncrawled sites
 * fall back to the icon fallback visually; there is no client-side signal to
 * distinguish a blank placeholder from a real favicon.
 */
export function parseFaviconUrl(canonicalUrl: string): ParsedUrl | null {
    let url: URL;
    try {
        url = new URL(canonicalUrl);
    } catch {
        return null;
    }
    if (!url.hostname) {
        return null;
    }
    const hostname = url.hostname.toLowerCase();
    const faviconUrl = `${FAVICON_ENDPOINT}?${new URLSearchParams({
        domain: hostname,
        sz: FAVICON_SIZE,
    }).toString()}`;
    return { hostname, faviconUrl, isHttps: url.protocol === "https:" };
}

function a11yLabel(primary: string | undefined, hostname: string): string {
    return primary ? `${primary} favicon` : `Favicon for ${hostname}`;
}

/**
 * Generic identity chip: shows a domain favicon when the URL is a public HTTPS
 * URL, otherwise falls back to an icon (default link icon, or a custom icon
 * such as a building when representing a company website). Built on the shared
 * Avatar primitives so it inherits the project's elevation, border and size
 * rules.
 *
 * Pass `entityName` to get a more descriptive accessible label centered on the
 * entity (company legal name, source publisher, etc.) instead of the raw
 * hostname. The hostname remains a secondary fallback.
 */
export function FaviconAvatar({
    canonicalUrl,
    size = "default",
    entityName,
    fallbackIcon = LinkSquare01Icon,
}: {
    canonicalUrl: string;
    size?: AvatarSize;
    entityName?: string;
    fallbackIcon?: PlatformIcon;
}) {
    const parsed = parseFaviconUrl(canonicalUrl);
    const [failed, setFailed] = useState(false);

    // Effect-free reset: the favicon URL is fully derived from canonicalUrl,
    // so when the identity changes we un-fail. Deriving the reset key from the
    // input rather than via useEffect avoids a flash of the fallback on every
    // parent re-render and keeps the component pure wrt its inputs.
    const faviconKey = parsed?.faviconUrl ?? "";
    const showFallback = !parsed?.isHttps || failed || faviconKey === "";

    if (showFallback) {
        const label = parsed
            ? entityName
                ? `${entityName} link`
                : `Link icon for ${parsed.hostname}`
            : entityName
              ? entityName
              : "Source link";
        return (
            <Avatar size={size} aria-label={label}>
                <AvatarFallback>
                    <Icon iconNode={fallbackIcon} />
                    <span className="sr-only">{label}</span>
                </AvatarFallback>
            </Avatar>
        );
    }

    const label = a11yLabel(entityName, parsed.hostname);
    const fallbackLabel = entityName
        ? `${entityName} link`
        : `Link icon for ${parsed.hostname}`;

    // An unkeyed async host name is used to reset the failed flag when the
    // underlying identity changes. See `key` prop on the inner span below.
    return (
        <Avatar size={size} aria-label={label}>
            <span key={faviconKey} className="contents">
                <AvatarImage
                    src={parsed.faviconUrl}
                    alt={`Favicon for ${parsed.hostname}`}
                    loading="lazy"
                    onError={() => setFailed(true)}
                />
                <AvatarFallback delay={FALLBACK_DELAY_MS}>
                    <Icon iconNode={fallbackIcon} />
                    <span className="sr-only">{fallbackLabel}</span>
                </AvatarFallback>
            </span>
        </Avatar>
    );
}
