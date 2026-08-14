import { createServer, type Server } from "node:http";
import { isIP } from "node:net";
import { type Browser, chromium } from "playwright";

import {
    buildBrowserContextOptions,
    buildLaunchOptions,
    STEALTH_INIT_SCRIPT,
} from "./stealth.js";

// ─── Configuration ────────────────────────────────────────────────────────

const PORT = Number.parseInt(process.env["PORT"] ?? "3000", 10);
const SHARED_SECRET = process.env["PREVIEW_SERVICE_SECRET"];
const MAX_CONCURRENT_RENDERS = Number.parseInt(
    process.env["MAX_CONCURRENT_RENDERS"] ?? "3",
    10,
);
const RENDER_TIMEOUT_MS = Number.parseInt(
    process.env["RENDER_TIMEOUT_MS"] ?? "30000",
    10,
);
const NAVIGATION_TIMEOUT_MS = Number.parseInt(
    process.env["NAVIGATION_TIMEOUT_MS"] ?? "15000",
    10,
);
const MAX_REDIRECTS = 5;
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
const VIEWPORT = { width: 1280, height: 720 };

// ─── Concurrency ──────────────────────────────────────────────────────────

let activeRenders = 0;

// ─── URL validation (SSRF protection) ─────────────────────────────────────

const BLOCKED_IPV4_PREFIXES: (number | null)[][] = [
    [0, null, null, null],
    [10, null, null, null],
    [127, null, null, null],
    [169, 254, null, null],
    [172, 16, null, null],
    [192, 0, 0, null],
    [192, 0, 2, null],
    [192, 168, null, null],
    [198, 18, null, null],
    [198, 19, null, null],
    [198, 51, 100, null],
    [203, 0, 113, null],
    [100, 64, null, null],
];

function isPublicIpv4(address: string): boolean {
    const octets = address.split(".").map(Number);
    if (octets.length !== 4) return false;
    for (const o of octets) {
        if (!Number.isInteger(o) || o < 0 || o > 255) return false;
    }
    const [first = 0, second = 0, third = 0, fourth = 0] = octets;
    if (first >= 224) return false;

    for (const [p1, p2, p3, p4] of BLOCKED_IPV4_PREFIXES) {
        if (first !== p1) continue;
        if (p2 !== null && second !== p2) continue;
        if (p3 !== null && third !== p3) continue;
        if (p4 !== null && fourth !== p4) continue;
        return false;
    }
    return true;
}

function isPublicIpv6(address: string): boolean {
    const normalized = address.toLowerCase();
    if (isIP(normalized) !== 6) return false;
    if (
        normalized === "::" ||
        normalized === "::1" ||
        /^f[c,d]/.test(normalized) ||
        /^fe[8-9a-b]/.test(normalized) ||
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
    if (version === 4) return isPublicIpv4(address);
    if (version === 6) return isPublicIpv6(address);
    return false;
}

async function resolveAddresses(hostname: string): Promise<string[]> {
    const { lookup } = await import("node:dns/promises");
    const results = await lookup(hostname, { all: true, family: 0 });
    return results.map((r) => r.address);
}

async function validateUrl(rawUrl: string): Promise<URL> {
    let url: URL;
    try {
        url = new URL(rawUrl);
    } catch {
        throw new RenderError("invalid_url", "Invalid URL");
    }
    if (url.protocol !== "https:") {
        throw new RenderError("https_required", "Only HTTPS URLs are supported");
    }
    if (url.username || url.password) {
        throw new RenderError(
            "credentials_not_allowed",
            "URL must not contain credentials",
        );
    }
    if (url.port && url.port !== "443") {
        throw new RenderError(
            "custom_port_not_allowed",
            "Custom ports are not supported",
        );
    }
    const hostname = url.hostname
        .replace(/^\[/, "")
        .replace(/\]$/, "")
        .toLowerCase();
    if (hostname === "localhost" || hostname.endsWith(".localhost")) {
        throw new RenderError(
            "non_public_destination",
            "URL must resolve to a public address",
        );
    }
    let addresses: string[];
    try {
        addresses = isIP(hostname) ? [hostname] : await resolveAddresses(hostname);
    } catch {
        throw new RenderError("dns_failed", "DNS resolution failed");
    }
    for (const addr of addresses) {
        if (!isPublicAddress(addr)) {
            throw new RenderError(
                "non_public_destination",
                "Hostname resolves to non-public address",
            );
        }
    }
    return url;
}

// ─── Error types ──────────────────────────────────────────────────────────

class RenderError extends Error {
    code: string;
    constructor(code: string, message: string) {
        super(message);
        this.code = code;
        this.name = "RenderError";
    }
}

type RenderResult =
    | { status: "ok"; contentType: "image/png"; data: Buffer }
    | { status: "error"; code: string; message: string };

// ─── Logging ──────────────────────────────────────────────────────────────

function log(event: string, meta: Record<string, unknown> = {}): void {
    const entry = { ts: new Date().toISOString(), event, ...meta };
    process.stderr.write(`${JSON.stringify(entry)}\n`);
}

// ─── Render ───────────────────────────────────────────────────────────────

async function render(url: string): Promise<RenderResult> {
    if (activeRenders >= MAX_CONCURRENT_RENDERS) {
        return {
            status: "error",
            code: "rate_limited",
            message: "Too many concurrent renders. Try again shortly.",
        };
    }

    const startTime = Date.now();
    activeRenders++;

    let validatedUrl: URL;
    try {
        validatedUrl = await validateUrl(url);
    } catch (err) {
        activeRenders--;
        if (err instanceof RenderError) {
            return { status: "error", code: err.code, message: err.message };
        }
        return {
            status: "error",
            code: "validation_failed",
            message: "URL validation failed",
        };
    }

    const hostname = validatedUrl.hostname;
    log("render_started", { hostname });

    let browser: Browser | null = null;
    try {
        browser = await chromium.launch(buildLaunchOptions());
        const context = await browser.newContext(
            buildBrowserContextOptions(VIEWPORT),
        );
        await context.addInitScript(STEALTH_INIT_SCRIPT);
        const page = await context.newPage();

        // Block unnecessary resource types
        await page.route("**/*", (route) => {
            const type = route.request().resourceType();
            if (type === "media" || type === "websocket" || type === "other") {
                return route.abort();
            }
            return route.continue();
        });

        page.on("download", (download) => {
            void download.delete().catch(() => {});
        });

        const response = await page.goto(validatedUrl.href, {
            waitUntil: "domcontentloaded",
            timeout: NAVIGATION_TIMEOUT_MS,
        });

        if (!response) {
            throw new RenderError("no_response", "Page did not respond");
        }

        const screenshot = await page.screenshot({
            type: "png",
            fullPage: false,
            clip: {
                x: 0,
                y: 0,
                width: VIEWPORT.width,
                height: VIEWPORT.height,
            },
            timeout: RENDER_TIMEOUT_MS,
        });

        await context.close();

        const durationMs = Date.now() - startTime;
        log("render_completed", {
            hostname,
            durationMs,
            sizeBytes: screenshot.length,
        });

        if (screenshot.length > MAX_RESPONSE_BYTES) {
            return {
                status: "error",
                code: "response_too_large",
                message: "Screenshot exceeds maximum size",
            };
        }

        return {
            status: "ok",
            contentType: "image/png",
            data: Buffer.from(screenshot),
        };
    } catch (err) {
        const durationMs = Date.now() - startTime;
        const errorCode =
            err instanceof RenderError ? err.code : "render_failed";
        const errorMessage =
            err instanceof Error ? err.message : "Screenshot render failed";
        log("render_failed", { hostname, durationMs, errorCode });
        return {
            status: "error",
            code: errorCode,
            message: errorMessage,
        };
    } finally {
        activeRenders--;
        if (browser) {
            try {
                await browser.close();
            } catch {
                // already closed
            }
        }
    }
}

// ─── HTTP server ──────────────────────────────────────────────────────────

function json(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

async function readBody(req: import("node:http").IncomingMessage, maxBytes = 10240): Promise<string> {
    return new Promise((resolve, reject) => {
        let data = "";
        req.on("data", (chunk: Buffer) => {
            data += chunk.toString();
            if (data.length > maxBytes) reject(new Error("too large"));
        });
        req.on("end", () => resolve(data));
        req.on("error", reject);
    });
}

async function handleRequest(
    req: import("node:http").IncomingMessage,
    res: import("node:http").ServerResponse,
): Promise<void> {
    // Health
    if (req.method === "GET" && req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
        return;
    }

    // Render
    if (req.method === "POST" && req.url === "/render") {
        const auth = req.headers["authorization"];
        if (!SHARED_SECRET || !auth || auth !== `Bearer ${SHARED_SECRET}`) {
            res.writeHead(401, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Unauthorized" }));
            return;
        }

        let body: string;
        try {
            body = await readBody(req);
        } catch {
            res.writeHead(413, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Request body too large" }));
            return;
        }

        let parsed: { url?: string };
        try {
            parsed = JSON.parse(body);
        } catch {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Invalid JSON body" }));
            return;
        }

        if (!parsed.url || typeof parsed.url !== "string") {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(
                JSON.stringify({
                    error: "url field is required and must be a string",
                }),
            );
            return;
        }

        const result = await render(parsed.url);
        if (result.status === "ok") {
            res.writeHead(200, {
                "Content-Type": result.contentType,
                "Content-Length": result.data.length,
            });
            res.end(result.data);
        } else {
            res.writeHead(422, { "Content-Type": "application/json" });
            res.end(
                JSON.stringify({
                    error: result.code,
                    message: result.message,
                }),
            );
        }
        return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
}

// ─── Startup ──────────────────────────────────────────────────────────────

if (!SHARED_SECRET) {
    console.error("PREVIEW_SERVICE_SECRET is required");
    process.exit(1);
}

const server: Server = createServer(handleRequest);
server.keepAliveTimeout = 35_000;
server.headersTimeout = 36_000;

// Only auto-listen when run directly (not imported by tests).
// Vitest sets VITEST env var by default.
const isTestEnv = typeof process.env["VITEST"] !== "undefined";
if (!isTestEnv) {
    server.listen(PORT, () => {
        log("server_started", {
            port: PORT,
            maxConcurrent: MAX_CONCURRENT_RENDERS,
        });
    });
}

export { server as __server };
