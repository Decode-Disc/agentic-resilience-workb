"use node";

import { isIP } from "node:net";

import {
    ManualSourceIntakeError,
    type ManualSourceIntakeErrorCode,
} from "./manualSourceIntake";

export type PublicSourceUrl = {
    canonicalUrl: string;
    hostname: string;
    addresses: ReadonlyArray<string>;
};

export class PublicSourceUrlError extends ManualSourceIntakeError {
    constructor(code: ManualSourceIntakeErrorCode, message: string) {
        super(code, { field: "url" });
        this.message = message;
        this.name = "PublicSourceUrlError";
    }
}

function parseIpv4(address: string): ReadonlyArray<number> | undefined {
    if (isIP(address) !== 4) {
        return undefined;
    }
    const octets = address.split(".").map(Number);
    return octets.length === 4 ? octets : undefined;
}

function isPublicIpv4(address: string): boolean {
    const octets = parseIpv4(address);
    if (!octets) {
        return false;
    }
    const [first = 0, second = 0, third = 0] = octets;

    if (
        first === 0 ||
        first === 10 ||
        first === 127 ||
        first >= 224 ||
        (first === 100 && second >= 64 && second <= 127) ||
        (first === 169 && second === 254) ||
        (first === 172 && second >= 16 && second <= 31) ||
        (first === 192 && second === 0 && third === 0) ||
        (first === 192 && second === 0 && third === 2) ||
        (first === 192 && second === 168) ||
        (first === 198 && (second === 18 || second === 19)) ||
        (first === 198 && second === 51 && third === 100) ||
        (first === 203 && second === 0 && third === 113)
    ) {
        return false;
    }
    return true;
}

function isPublicIpv6(address: string): boolean {
    const normalized = address.toLowerCase();
    if (isIP(normalized) !== 6) {
        return false;
    }
    if (
        normalized === "::" ||
        normalized === "::1" ||
        normalized.startsWith("fc") ||
        normalized.startsWith("fd") ||
        normalized.startsWith("fe8") ||
        normalized.startsWith("fe9") ||
        normalized.startsWith("fea") ||
        normalized.startsWith("feb") ||
        normalized.startsWith("ff") ||
        normalized.startsWith("2001:db8:")
    ) {
        return false;
    }
    if (normalized.startsWith("::ffff:")) {
        return isPublicIpv4(normalized.slice("::ffff:".length));
    }

    const firstHextet = Number.parseInt(normalized.split(":")[0] ?? "", 16);
    return firstHextet >= 0x2000 && firstHextet <= 0x3fff;
}

function isPublicAddress(address: string): boolean {
    const version = isIP(address);
    if (version === 4) {
        return isPublicIpv4(address);
    }
    if (version === 6) {
        return isPublicIpv6(address);
    }
    return false;
}

/**
 * Canonicalizes an analyst-provided URL and rejects destinations that are not
 * public HTTPS resources. DNS is injected so callers can revalidate every
 * redirect without giving this pure domain boundary network authority.
 */
export async function validatePublicSourceUrl(
    rawUrl: string,
    resolveAddresses: (hostname: string) => Promise<ReadonlyArray<string>>,
): Promise<PublicSourceUrl> {
    let url: URL;
    try {
        url = new URL(rawUrl);
    } catch {
        throw new PublicSourceUrlError("invalid_url", "Invalid source URL");
    }

    if (url.protocol !== "https:") {
        throw new PublicSourceUrlError(
            "https_required",
            "Source URL must use HTTPS",
        );
    }
    if (url.username || url.password) {
        throw new PublicSourceUrlError(
            "credentials_not_allowed",
            "Source URL cannot contain credentials",
        );
    }
    if (url.port && url.port !== "443") {
        throw new PublicSourceUrlError(
            "custom_port_not_allowed",
            "Source URL cannot use a custom port",
        );
    }

    const hostname = url.hostname
        .replace(/^\[/, "")
        .replace(/\]$/, "")
        .toLowerCase();
    if (hostname === "localhost" || hostname.endsWith(".localhost")) {
        throw new PublicSourceUrlError(
            "non_public_destination",
            "Source URL must resolve to a public network",
        );
    }

    let addresses: ReadonlyArray<string>;
    try {
        addresses = isIP(hostname)
            ? [hostname]
            : await resolveAddresses(hostname);
    } catch {
        throw new PublicSourceUrlError(
            "dns_failed",
            "Source URL could not be resolved",
        );
    }
    if (
        addresses.length === 0 ||
        addresses.some((address) => !isPublicAddress(address))
    ) {
        throw new PublicSourceUrlError(
            "non_public_destination",
            "Source URL must resolve to a public network",
        );
    }

    url.hostname = hostname;
    url.port = "";
    url.hash = "";
    return {
        canonicalUrl: url.toString(),
        hostname,
        addresses,
    };
}
