import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import {
    getLocalRuntimeIdentity,
    getLocalRuntimePorts,
    publishRuntimeOrigin,
} from "./scripts/local-runtime.ts";
import { impeccableLivePlugin } from "./src/lib/development/impeccable-vite-plugin";

const root = process.env.LOCAL_RUNTIME_ROOT ?? process.cwd();
const ports = getLocalRuntimePorts(root);

function localRuntimeAddressPlugin(): Plugin {
    const runId = process.env.LOCAL_RUNTIME_RUN_ID;
    const worktreeId = runId
        ? getLocalRuntimeIdentity(root).worktreeId
        : undefined;

    const publish = (listener: import("vite").HttpServer | null) => {
        listener?.once("listening", () => {
            const address = listener.address();
            if (!address || typeof address === "string" || !runId) return;
            const origin = `http://127.0.0.1:${address.port}`;
            void publishRuntimeOrigin(
                root,
                "web",
                origin,
                process.pid,
                runId,
            ).catch(() => {
                console.error(
                    "Could not publish the local runtime listener address.",
                );
            });
        });
    };

    return {
        name: "local-runtime-address",
        configureServer(server) {
            if (runId && worktreeId) {
                server.middlewares.use(
                    "/__local_runtime",
                    (_request, response) => {
                        response.setHeader("Content-Type", "application/json");
                        response.setHeader("Cache-Control", "no-store");
                        response.end(JSON.stringify({ worktreeId, runId }));
                    },
                );
            }
            publish(server.httpServer);
        },
    };
}

export default defineConfig({
    resolve: {
        tsconfigPaths: true,
    },
    plugins: [
        tailwindcss(),
        tanstackStart(),
        viteReact(),
        impeccableLivePlugin(),
        localRuntimeAddressPlugin(),
    ],
    server: {
        host: "127.0.0.1",
        port: ports.web,
        strictPort: true,
        watch: {
            ignored: [
                "**/.agents/**",
                "**/.ai/**",
                "**/.codex/**",
                "**/.pi/**",
                "**/.github/**",
                "**/context/**",
                "**/docs/**",
                "**/src/__tests__/**",
                "**/.missions/**",
                "**/artifacts/**",
                "**/.impeccable/**",
                "**/.fallow/**",
                "**/.superpowers/**",
                "**/plans/**",
                "**/pi-plans/**",
            ],
        },
    },
    preview: {
        host: "127.0.0.1",
        port: ports.appPreview,
        strictPort: true,
    },
    build: {
        rolldownOptions: {
            output: {
                codeSplitting: {
                    groups: [
                        {
                            name: "react-vendor",
                            test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/,
                            priority: 20,
                        },
                        {
                            name: "base-ui",
                            test: /node_modules[\\/]@base-ui[\\/]/,
                            priority: 15,
                        },
                    ],
                },
            },
        },
    },
});
