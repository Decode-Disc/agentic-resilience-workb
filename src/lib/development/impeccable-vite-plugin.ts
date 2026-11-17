import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Plugin } from "vite";

/** Connects an explicitly enabled development page to the local design helper. */
export function impeccableLivePlugin(): Plugin {
    return {
        name: "impeccable-live-development",
        apply: "serve",
        configureServer(server) {
            const connectionFile = resolve(
                server.config.root,
                ".impeccable/live/server.json",
            );
            server.middlewares.use(async (request, response, next) => {
                if (request.url !== "/__impeccable/live-connection")
                    return next();
                response.setHeader(
                    "Content-Type",
                    "application/json; charset=utf-8",
                );
                response.setHeader("Cache-Control", "no-store");
                response.setHeader("X-Content-Type-Options", "nosniff");
                if (request.method !== "GET") {
                    response.statusCode = 405;
                    response.end(
                        JSON.stringify({ error: "Method not allowed." }),
                    );
                    return;
                }
                try {
                    const connection: unknown = JSON.parse(
                        await readFile(connectionFile, "utf8"),
                    );
                    if (
                        typeof connection !== "object" ||
                        connection === null ||
                        !("port" in connection) ||
                        !("token" in connection) ||
                        typeof connection.port !== "number" ||
                        !Number.isInteger(connection.port) ||
                        connection.port < 1024 ||
                        connection.port > 65535 ||
                        typeof connection.token !== "string" ||
                        !connection.token ||
                        connection.token.length > 512
                    )
                        throw new Error("Invalid local helper connection");
                    const src = new URL(
                        `http://localhost:${connection.port}/live.js`,
                    );
                    src.searchParams.set("token", connection.token);
                    response.end(JSON.stringify({ src: src.href }));
                } catch {
                    response.statusCode = 503;
                    response.end(
                        JSON.stringify({
                            error: "Design helper is unavailable.",
                        }),
                    );
                }
            });
        },
    };
}
