import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Connect, rolldownVersion, rollupVersion, version } from "vite";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { impeccableLivePlugin } from "@/lib/development/impeccable-vite-plugin";

let root: string;
beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "impeccable-connection-"));
});
afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

function middleware() {
    const use = vi.fn();
    const plugin = impeccableLivePlugin();
    expect(plugin.apply).toBe("serve");
    if (typeof plugin.configureServer !== "function")
        throw new Error("Missing development hook");
    plugin.configureServer.call(
        {
            error: vi.fn(() => {
                throw new Error("Unexpected plugin error");
            }),
            info: vi.fn(),
            warn: vi.fn(),
            debug: vi.fn(),
            meta: {
                viteVersion: version,
                rolldownVersion,
                rollupVersion,
                watchMode: true,
            },
        },
        { config: { root }, middlewares: { use } } as never,
    );
    const handler = use.mock.calls[0]?.[0];
    expect(handler).toBeTypeOf("function");
    return handler as Connect.NextHandleFunction;
}

test("supplies the current authenticated loopback script without caching its credential", async () => {
    await mkdir(join(root, ".impeccable/live"), { recursive: true });
    await writeFile(
        join(root, ".impeccable/live/server.json"),
        JSON.stringify({ port: 8400, token: "local-test-credential" }),
    );
    const handler = middleware();
    const response = { statusCode: 200, setHeader: vi.fn(), end: vi.fn() };
    await handler(
        { url: "/__impeccable/live-connection", method: "GET" } as never,
        response as never,
        vi.fn(),
    );
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.end.mock.calls[0]?.[0])).toEqual({
        src: "http://localhost:8400/live.js?token=local-test-credential",
    });
    expect(response.setHeader).toHaveBeenCalledWith(
        "Cache-Control",
        "no-store",
    );
});

test("returns an explicit unavailable result when the helper has not been started", async () => {
    const handler = middleware();
    const response = { statusCode: 200, setHeader: vi.fn(), end: vi.fn() };
    await handler(
        { url: "/__impeccable/live-connection", method: "GET" } as never,
        response as never,
        vi.fn(),
    );
    expect(response.statusCode).toBe(503);
    expect(JSON.parse(response.end.mock.calls[0]?.[0])).toEqual({
        error: "Design helper is unavailable.",
    });
});

test("leaves application routes untouched", async () => {
    const handler = middleware();
    const next = vi.fn();
    const response = { end: vi.fn() };
    await handler(
        { url: "/workspace", method: "GET" } as never,
        response as never,
        next,
    );
    expect(next).toHaveBeenCalledOnce();
    expect(response.end).not.toHaveBeenCalled();
});
