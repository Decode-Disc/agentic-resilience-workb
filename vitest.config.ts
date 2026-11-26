import viteReact from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
    resolve: { tsconfigPaths: true },
    plugins: [viteReact()],
    test: {
        exclude: [...configDefaults.exclude, "src/__tests__/live/**"],
        isolate: true,
        maxWorkers: 4,
        // Concurrent UI, CLI and workflow integration tests exceed Vitest's 5s default.
        testTimeout: 15_000,
        projects: [
            {
                extends: true,
                test: {
                    name: "node",
                    environment: "node",
                    include: ["src/__tests__/**/*.test.ts"],
                    setupFiles: [],
                },
            },
            {
                extends: true,
                test: {
                    name: "jsdom",
                    environment: "jsdom",
                    // Browser storage belongs to jsdom, not Node's optional disk-backed globals.
                    execArgv: ["--no-experimental-webstorage"],
                    include: ["src/__tests__/**/*.test.tsx"],
                    setupFiles: ["./src/__tests__/setup/cleanup.ts"],
                },
            },
        ],
    },
});
