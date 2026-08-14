"use node";

import { isIP } from "node:net";

/**
 * Validates a company cover-image URL before it is handed to the preview
 * service. This is a lightweight, synchronous gate: it only rejects clearly
 * non-public or malformed destinations. Deep SSRF/DNS revalidation happens in
 * the self-hosted preview service (see ADR-019), which re-checks every
 * redirect hop against its own rules.
 *
 * Returns the canonical HTTPS URL string, or `null` when the URL is invalid,
 * non-HTTPS, carries credentials, uses a non-standard port, or points at a
 * private/loopback/link-local host (including raw IP literals).
 */
export function validateCoverImageUrl(rawUrl: string): string | null {
    let url: URL;
    try {
        url = new URL(rawUrl);
    } catch {
        return null;
    }

    if (url.protocol !== "https:") {
        return null;
    }
    if (url.username || url.password) {
        return null;
    }
    if (url.port && url.port !== "443") {
        return null;
    }

    const hostname = url.hostname
        .replace(/^\[/, "")
        .replace(/\]$/, "")
        .toLowerCase();
    if (!hostname) {
        return null;
    }

    // Reject raw IP literals outright — company cover images always use a
    // domain name, so an IP literal is either a misconfiguration or an SSRF
    // attempt. Loopback/private/link-local names are rejected below.
    if (isIP(hostname)) {
        return null;
    }
    if (
        hostname === "localhost" ||
        hostname.endsWith(".localhost") ||
        hostname.endsWith(".local")
    ) {
        return null;
    }

    url.hostname = hostname;
    url.port = "";
    url.hash = "";
    return url.toString();
}
