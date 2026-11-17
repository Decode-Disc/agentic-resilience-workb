import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import { createConnection, isIP, type Socket } from "node:net";
import type { Duplex } from "node:stream";
import { type Browser, chromium } from "playwright";
import policy from "./resource-policy.generated.json" with { type: "json" };

import {
    buildBrowserContextOptions,
    buildLaunchOptions,
    STEALTH_INIT_SCRIPT,
} from "./stealth.js";

// ─── Configuration ────────────────────────────────────────────────────────

const PORT = Number.parseInt(process.env["PORT"] ?? "3000", 10);
const SHARED_SECRET = process.env["PREVIEW_SERVICE_SECRET"];
const MAX_CONCURRENT_RENDERS = Number.parseInt(
    process.env["MAX_CONCURRENT_RENDERS"] ?? String(policy.maxConcurrentRenders),
    10,
);
const RENDER_TIMEOUT_MS = Number.parseInt(
    process.env["RENDER_TIMEOUT_MS"] ?? String(policy.renderTimeoutMs),
    10,
);
const NAVIGATION_TIMEOUT_MS = Number.parseInt(
    process.env["NAVIGATION_TIMEOUT_MS"] ?? String(policy.navigationTimeoutMs),
    10,
);
const MAX_REDIRECTS = policy.maxRedirects;
const MAX_RESPONSE_BYTES = policy.maxResponseBytes;
const VIEWPORT = { width: 1280, height: 720 };

// ─── Concurrency ──────────────────────────────────────────────────────────

let activeRenders = 0;

// ─── URL validation (SSRF protection) ─────────────────────────────────────

const BLOCKED_IPV4_PREFIXES: (number | null)[][] = [
    [0, null, null, null],
    [10, null, null, null],
    [127, null, null, null],
    [169, 254, null, null],
    [192, 0, 0, null],
    [192, 0, 2, null],
    [192, 168, null, null],
    [198, 18, null, null],
    [198, 19, null, null],
    [198, 51, 100, null],
    [203, 0, 113, null],
];

function isPublicIpv4(address: string): boolean {
    const octets = address.split(".").map(Number);
    if (octets.length !== 4) return false;
    for (const o of octets) {
        if (!Number.isInteger(o) || o < 0 || o > 255) return false;
    }
    const [first = 0, second = 0, third = 0, fourth = 0] = octets;
    if (
        first >= 224 ||
        (first === 172 && second >= 16 && second <= 31) ||
        (first === 100 && second >= 64 && second <= 127)
    )
        return false;

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
        /^f[cd]/.test(normalized) ||
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

async function validateUrl(
    rawUrl: string,
): Promise<{ url: URL; address: string }> {
    let url: URL;
    try {
        url = new URL(rawUrl);
    } catch {
        throw new RenderError("invalid_url", "Invalid URL");
    }
    if (url.protocol !== "https:") {
        throw new RenderError(
            "https_required",
            "Only HTTPS URLs are supported",
        );
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
        addresses = isIP(hostname)
            ? [hostname]
            : await resolveAddresses(hostname);
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
    const address = addresses[0];
    if (!address)
        throw new RenderError(
            "non_public_destination",
            "No public address was resolved",
        );
    return { url, address };
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

/** Every Chromium TCP destination passes this per-render CONNECT proxy, including redirects and subresources.
 * TLS remains end-to-end in Chromium. Only the validated numeric IP reaches connect(), so DNS cannot rebind it.
 */
async function createPublicEgress(timeoutMs: number) {
    const password = randomBytes(24).toString("hex");
    const authorization = `Basic ${Buffer.from(`preview:${password}`).toString("base64")}`;
    const probeUrl = `http://preview-${randomBytes(24).toString("hex")}.invalid/`;
    const sockets = new Set<Duplex>();
    let closed = false;
    let failure: RenderError | undefined;
    let connections = 0;
    let transferredBytes = 0;
    // Chromium must authenticate the local proxy before response interception
    // starts; otherwise the intercepted 407 cannot complete its challenge.
    const proxy = createServer((req, res) => {
        if (req.method !== "GET" || req.url !== probeUrl) {
            res.writeHead(403);
        } else if (req.headers["proxy-authorization"] !== authorization) {
            res.writeHead(407, {
                "Proxy-Authenticate": 'Basic realm="preview"',
            });
        } else {
            res.writeHead(200, { "Content-Type": "text/html" });
        }
        res.end();
    });
    const reject = (socket: Duplex) =>
        socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
    proxy.on("connection", (socket: Socket) => {
        sockets.add(socket);
        socket.on("close", () => sockets.delete(socket));
        socket.on("error", () => socket.destroy());
    });
    proxy.on("connect", (req, client, head) => {
        if (req.headers["proxy-authorization"] !== authorization) {
            client.end(
                'HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="preview"\r\nConnection: close\r\n\r\n',
            );
            return;
        }
        void (async () => {
            if (closed || ++connections > policy.maxConnections)
                throw new RenderError(
                    "resource_limit",
                    "Preview connection limit reached",
                );
            const { address } = await validateUrl(`https://${req.url ?? ""}`);
            if (closed || client.destroyed) return;
            const upstream = createConnection({
                host: address,
                port: 443,
                family: isIP(address),
            });
            sockets.add(upstream);
            upstream.on("close", () => sockets.delete(upstream));
            upstream.on("error", () => client.destroy());
            client.on("close", () => upstream.destroy());
            upstream.setTimeout(timeoutMs, () => upstream.destroy());
            const meter = (chunk: Buffer) => {
                transferredBytes += chunk.length;
                if (transferredBytes > policy.maxTransferredBytes) {
                    failure = new RenderError(
                        "resource_limit",
                        "Preview transfer limit reached",
                    );
                    for (const socket of sockets) socket.destroy();
                }
            };
            upstream.on("data", meter);
            client.on("data", meter);
            upstream.once("connect", () => {
                if (closed || client.destroyed) {
                    upstream.destroy();
                    return;
                }
                client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
                if (head.length) {
                    meter(head);
                    upstream.write(head);
                }
                client.pipe(upstream);
                upstream.pipe(client);
            });
        })().catch((error: unknown) => {
            failure =
                error instanceof RenderError
                    ? error
                    : new RenderError(
                          "egress_failed",
                          "Preview destination could not be reached",
                      );
            reject(client);
        });
    });
    await new Promise<void>((resolve, rejectListen) => {
        proxy.once("error", rejectListen);
        proxy.listen(0, "127.0.0.1", resolve);
    });
    const address = proxy.address();
    if (!address || typeof address === "string")
        throw new Error("Preview proxy failed to bind");
    const close = () => {
        closed = true;
        for (const socket of sockets) socket.destroy();
        proxy.close();
    };
    const deadline = setTimeout(() => {
        failure = new RenderError("render_timeout", "Preview deadline reached");
        close();
    }, timeoutMs);
    return {
        proxy: {
            server: `http://127.0.0.1:${address.port}`,
            username: "preview",
            password,
            bypass: "<-loopback>",
        },
        probeUrl,
        failure: () => failure,
        close: () => {
            clearTimeout(deadline);
            close();
        },
    };
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
        validatedUrl = (await validateUrl(url)).url;
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
    let navigationError: RenderError | undefined;
    let egress: Awaited<ReturnType<typeof createPublicEgress>> | undefined;
    try {
        egress = await createPublicEgress(RENDER_TIMEOUT_MS);
        const launch = buildLaunchOptions();
        browser = await chromium.launch({
            ...launch,
            proxy: egress.proxy,
            timeout: RENDER_TIMEOUT_MS,
            args: [
                ...launch.args,
                "--disable-quic",
                "--dns-prefetch-disable",
                "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
            ],
        });
        const context = await browser.newContext({
            ...buildBrowserContextOptions(VIEWPORT),
            serviceWorkers: "block",
            acceptDownloads: false,
        });
        await context.addInitScript(STEALTH_INIT_SCRIPT);
        const page = await context.newPage();
        try {
            const probe = await page.goto(egress.probeUrl, {
                waitUntil: "commit",
                timeout: NAVIGATION_TIMEOUT_MS,
            });
            if (probe?.status() !== 200) throw new Error("Unexpected status");
        } catch {
            throw new RenderError(
                "egress_failed",
                "Preview proxy authentication failed",
            );
        }

        let requests = 0;
        // Playwright routes run only for the first URL in a redirect chain. Pause redirect responses before Chromium follows them.
        const session = await context.newCDPSession(page);
        const redirectsByRequest = new Map<string, number>();
        session.on("Fetch.requestPaused", async (event) => {
            try {
                const key = event.networkId ?? event.requestId;
                const status = event.responseStatusCode ?? 0;
                const location = event.responseHeaders?.find(
                    (header) => header.name.toLowerCase() === "location",
                )?.value;
                if (status >= 300 && status < 400 && location) {
                    const count = (redirectsByRequest.get(key) ?? 0) + 1;
                    redirectsByRequest.set(key, count);
                    if (count > MAX_REDIRECTS) {
                        navigationError = new RenderError(
                            "redirect_limit",
                            "Too many preview redirects",
                        );
                        await session.send("Fetch.failRequest", {
                            requestId: event.requestId,
                            errorReason: "BlockedByClient",
                        });
                        return;
                    }
                    try {
                        await validateUrl(
                            new URL(location, event.request.url).href,
                        );
                    } catch (error) {
                        navigationError =
                            error instanceof RenderError
                                ? error
                                : new RenderError(
                                      "invalid_url",
                                      "Invalid redirect destination",
                                  );
                        await session.send("Fetch.failRequest", {
                            requestId: event.requestId,
                            errorReason: "BlockedByClient",
                        });
                        return;
                    }
                }
                await session.send("Fetch.continueResponse", {
                    requestId: event.requestId,
                });
            } catch {
                if (!page.isClosed())
                    navigationError = new RenderError(
                        "render_failed",
                        "Preview interception failed",
                    );
            }
        });
        await session.send("Fetch.enable", {
            patterns: [{ urlPattern: "*", requestStage: "Response" }],
        });
        await context.routeWebSocket("**/*", (socket) => socket.close());
        await context.route("**/*", async (route) => {
            const request = route.request();
            const type = request.resourceType();
            if (
                ++requests > policy.maxRequests ||
                type === "media" ||
                type === "other" ||
                request.method() !== "GET"
            )
                return route.abort();
            try {
                let redirects = 0;
                for (
                    let previous = request.redirectedFrom();
                    previous;
                    previous = previous.redirectedFrom()
                )
                    redirects++;
                if (redirects > MAX_REDIRECTS)
                    throw new RenderError(
                        "redirect_limit",
                        "Too many preview redirects",
                    );
                await validateUrl(request.url());
                return route.continue();
            } catch (error) {
                if (
                    request.isNavigationRequest() &&
                    request.frame() === page.mainFrame()
                )
                    navigationError =
                        error instanceof RenderError
                            ? error
                            : new RenderError(
                                  "invalid_url",
                                  "Invalid preview destination",
                              );
                return route.abort();
            }
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

        if (navigationError) throw navigationError;
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
            err instanceof RenderError
                ? err.code
                : (navigationError?.code ??
                  egress?.failure()?.code ??
                  "render_failed");
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
        egress?.close();
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

async function readBody(
    req: import("node:http").IncomingMessage,
    maxBytes = policy.requestBodyBytes,
): Promise<string> {
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
server.keepAliveTimeout = policy.keepAliveTimeoutMs;
server.headersTimeout = policy.headersTimeoutMs;

// Only auto-listen when run directly (not imported by tests).
// Vitest sets VITEST env var by default.
const isTestEnv = typeof process.env["VITEST"] !== "undefined";
export function logServerStarted(listener: Server): void {
    const address = listener.address();
    if (!address || typeof address === "string")
        throw new Error("Preview service has no TCP listener address.");
    log("server_started", {
        origin: `http://127.0.0.1:${address.port}`,
        port: address.port,
        maxConcurrent: MAX_CONCURRENT_RENDERS,
    });
}

if (!isTestEnv) {
    server.listen(
        { port: PORT, host: process.env["PREVIEW_SERVICE_HOST"] },
        () => logServerStarted(server),
    );
}

export { server as __server };
