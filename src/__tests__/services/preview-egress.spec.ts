// Runs explicitly with the preview service Vitest config: Chromium and OpenSSL are required.
import { execFileSync } from "node:child_process";
import type {
    LookupAddress,
    LookupAllOptions,
    LookupOneOptions,
    LookupOptions,
} from "node:dns";
import * as dns from "node:dns/promises";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import { createServer } from "node:https";
import * as net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowserType } from "@playwright/test";
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";

vi.mock("node:dns/promises", { spy: true });
vi.mock("node:net", { spy: true });

let server: Server;
let origin: ReturnType<typeof createServer>;
let base: string;
let fixtureDir: string;
const hits: string[] = [];
const connections: string[] = [];
const secret = "preview-test-only";

function fixtureLookup(
    addressFor: (hostname: string) => string,
): typeof dns.lookup {
    function lookup(hostname: string, family: number): Promise<LookupAddress>;
    function lookup(
        hostname: string,
        options: LookupOneOptions,
    ): Promise<LookupAddress>;
    function lookup(
        hostname: string,
        options: LookupAllOptions,
    ): Promise<LookupAddress[]>;
    function lookup(
        hostname: string,
        options: LookupOptions,
    ): Promise<LookupAddress | LookupAddress[]>;
    function lookup(hostname: string): Promise<LookupAddress>;
    async function lookup(
        hostname: string,
        options?: number | LookupOptions,
    ): Promise<LookupAddress | LookupAddress[]> {
        const family = typeof options === "number" ? options : options?.family;
        if (family === 6 || family === "IPv6") {
            throw new Error(
                "The preview DNS fixture only provides IPv4 addresses",
            );
        }
        const address = { address: addressFor(hostname), family: 4 };
        return typeof options === "object" && options.all ? [address] : address;
    }
    return lookup;
}

beforeAll(async () => {
    vi.stubEnv("PREVIEW_SERVICE_SECRET", secret);
    fixtureDir = mkdtempSync(join(tmpdir(), "preview-egress-"));
    execFileSync(
        "openssl",
        [
            "req",
            "-x509",
            "-newkey",
            "rsa:2048",
            "-nodes",
            "-keyout",
            join(fixtureDir, "key.pem"),
            "-out",
            join(fixtureDir, "cert.pem"),
            "-days",
            "1",
            "-subj",
            "/CN=public.test",
        ],
        { stdio: "ignore" },
    );
    origin = createServer(
        {
            key: readFileSync(join(fixtureDir, "key.pem")),
            cert: readFileSync(join(fixtureDir, "cert.pem")),
        },
        (req, res) => {
            hits.push(`${req.headers.host}${req.url}`);
            if (req.url?.startsWith("/loop/")) {
                const hop = Number(req.url.split("/").at(-1));
                res.writeHead(302, {
                    location: `https://public.test/loop/${hop + 1}`,
                });
                res.end();
            } else if (req.url === "/credentials") {
                res.writeHead(302, {
                    location: "https://user:password@public.test/private",
                });
                res.end();
            } else if (req.url === "/redirect") {
                res.writeHead(302, {
                    location: "https://internal.test/private",
                });
                res.end();
            } else {
                res.writeHead(200, { "content-type": "text/html" });
                res.end(
                    req.url === "/resources"
                        ? '<h1>Public page</h1><img src="https://internal.test/private"><iframe src="https://127.0.0.1/private"></iframe>'
                        : "<h1>Local deterministic screenshot fixture</h1>",
                );
            }
        },
    );
    await new Promise<void>((resolve) =>
        origin.listen(0, "127.0.0.1", resolve),
    );
    const port = (origin.address() as net.AddressInfo).port;
    const { createConnection: connect } =
        await vi.importActual<typeof net>("node:net");
    vi.spyOn(net, "createConnection").mockImplementation(((
        options: net.NetConnectOpts,
        listener?: () => void,
    ) => {
        const host = "host" in options ? options.host : undefined;
        if (
            host === "127.0.0.1" &&
            "port" in options &&
            Number(options.port) ===
                (server?.address() as net.AddressInfo | null)?.port
        )
            return connect(options, listener);
        connections.push(host ?? "missing");
        if (host !== "93.184.216.34")
            throw new Error(
                `Unexpected outbound connection ${JSON.stringify(options)} expected port ${(server?.address() as net.AddressInfo | null)?.port}`,
            );
        return connect({ host: "127.0.0.1", port }, listener);
    }) as typeof net.createConnection);
    const { chromium } = await vi.importActual<{ chromium: BrowserType }>(
        "playwright",
    );
    const launch = chromium.launch.bind(chromium);
    vi.spyOn(chromium, "launch").mockImplementation((options) =>
        launch({
            ...options,
            executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
            args: [
                ...(options?.args ?? []),
                "--ignore-certificate-errors",
                `--host-resolver-rules=MAP public.test 127.0.0.1:${port}, MAP internal.test 127.0.0.1:${port}`,
            ],
        }),
    );
    server = (await import("@preview/server")).__server;
    await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
    );
    base = `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`;
});

beforeEach(() => {
    hits.length = 0;
    connections.length = 0;
    vi.mocked(dns.lookup).mockClear();
    vi.mocked(dns.lookup).mockImplementation(
        fixtureLookup((host) =>
            host === "internal.test" ? "10.0.0.7" : "93.184.216.34",
        ),
    );
});
afterAll(async () => {
    if (server)
        await new Promise<void>((resolve) => server.close(() => resolve()));
    if (origin)
        await new Promise<void>((resolve) => origin.close(() => resolve()));
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    if (fixtureDir) rmSync(fixtureDir, { recursive: true, force: true });
});

function render(path: string) {
    return fetch(`${base}/render`, {
        method: "POST",
        headers: {
            authorization: `Bearer ${secret}`,
            "content-type": "application/json",
        },
        body: JSON.stringify({ url: `https://public.test${path}` }),
    });
}

test("the local proxy rejects unauthenticated tunnels and arbitrary HTTP requests", async () => {
    const { chromium } = await vi.importActual<{ chromium: BrowserType }>(
        "playwright",
    );
    const originalLaunch = chromium.launch.bind(chromium);
    vi.mocked(chromium.launch).mockImplementationOnce(async (options) => {
        const proxy = new URL(options?.proxy?.server ?? "");
        const { createConnection } =
            await vi.importActual<typeof net>("node:net");
        const requestProxy = (method: "GET" | "CONNECT", path: string) =>
            new Promise<number>((resolve, reject) => {
                const probe = createConnection({
                    host: proxy.hostname,
                    port: Number(proxy.port),
                });
                probe.on("connect", () => {
                    probe.write(
                        `${method} ${path} HTTP/1.1\r\nHost: public.test\r\nConnection: close\r\n\r\n`,
                    );
                });
                probe.on("data", (chunk) => {
                    const status = /^HTTP\/1\.1 (\d{3})/.exec(chunk.toString());
                    probe.destroy();
                    resolve(Number(status?.[1] ?? 0));
                });
                probe.on("error", reject);
            });
        expect(await requestProxy("CONNECT", "public.test:443")).toBe(407);
        expect(await requestProxy("GET", "http://public.test/private")).toBe(
            403,
        );
        expect(connections).toEqual([]);
        expect(hits).toEqual([]);
        return originalLaunch(options);
    });
    const response = await render("/");
    expect(
        response.status,
        response.status === 200 ? undefined : await response.text(),
    ).toBe(200);
});

test("a proxy authentication failure returns a safe error", async () => {
    const { chromium } = await vi.importActual<{ chromium: BrowserType }>(
        "playwright",
    );
    const originalLaunch = chromium.launch.bind(chromium);
    vi.mocked(chromium.launch).mockImplementationOnce(async (options) => {
        const browser = await originalLaunch(options);
        const originalNewContext = browser.newContext.bind(browser);
        vi.spyOn(browser, "newContext").mockImplementationOnce(
            async (contextOptions) => {
                const context = await originalNewContext(contextOptions);
                const originalNewPage = context.newPage.bind(context);
                vi.spyOn(context, "newPage").mockImplementationOnce(
                    async () => {
                        const page = await originalNewPage();
                        vi.spyOn(page, "goto").mockRejectedValueOnce(
                            new Error("internal proxy details"),
                        );
                        return page;
                    },
                );
                return context;
            },
        );
        return browser;
    });
    const response = await render("/");
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
        error: "egress_failed",
        message: "Preview proxy authentication failed",
    });
    expect(connections).toEqual([]);
    expect(hits).toEqual([]);
});

test("renders a public HTTPS page but refuses a private-network redirect", async () => {
    const good = await render("/");
    expect(
        good.status,
        good.status === 200 ? undefined : await good.text(),
    ).toBe(200);
    expect(good.headers.get("content-type")).toBe("image/png");
    expect((await good.arrayBuffer()).byteLength).toBeGreaterThan(100);
    const redirected = await render("/redirect");
    expect(redirected.status).toBe(422);
    expect(hits).not.toContain("internal.test/private");
});

test("public content still renders while private subresources are blocked", async () => {
    const response = await render("/resources");
    expect(response.status).toBe(200);
    expect(hits).toContain("public.test/resources");
    expect(hits.some((hit) => hit.includes("/private"))).toBe(false);
    expect(connections.length).toBeGreaterThan(0);
    expect(connections.every((address) => address === "93.184.216.34")).toBe(
        true,
    );
});

test("a DNS change between validation and connection cannot reach a private address", async () => {
    let lookups = 0;
    vi.mocked(dns.lookup).mockImplementation(
        fixtureLookup(() => (++lookups <= 2 ? "93.184.216.34" : "10.0.0.7")),
    );
    const response = await render("/");
    expect(response.status).toBe(422);
    expect(lookups).toBeGreaterThan(2);
    expect(connections).toEqual([]);
    expect(hits).toEqual([]);
});

test("redirect loops stop within the five-hop allowance", async () => {
    const response = await render("/loop/0");
    expect(response.status).toBe(422);
    expect(
        hits.filter((hit) => hit.includes("/loop/")).length,
    ).toBeLessThanOrEqual(6);
});

test("redirects must satisfy the same credential-free URL policy as the initial URL", async () => {
    const response = await render("/credentials");
    expect(response.status).toBe(422);
    expect(hits).not.toContain("public.test/private");
});

test.each([
    "127.0.0.1",
    "172.31.2.3",
    "100.127.4.3",
    "[::1]",
    "[::ffff:127.0.0.1]",
])("rejects non-public literal %s before a connection", async (address) => {
    const response = await fetch(`${base}/render`, {
        method: "POST",
        headers: {
            authorization: `Bearer ${secret}`,
            "content-type": "application/json",
        },
        body: JSON.stringify({ url: `https://${address}/private` }),
    });
    expect(response.status).toBe(422);
    expect(connections).toEqual([]);
    expect(hits).toEqual([]);
    expect(dns.lookup).not.toHaveBeenCalled();
});
