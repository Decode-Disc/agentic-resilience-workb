import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
    resolve: { tsconfigPaths: true },
    plugins: [viteReact()],
    test: {
        environment: "jsdom",
        // Browser storage belongs to jsdom, not Node's optional disk-backed globals.
        execArgv: ["--no-experimental-webstorage"],
        include: ["src/__tests__/**/*.test.{ts,tsx}"],
        isolate: true,
        maxWorkers: 4,
        // Concurrent UI, CLI and workflow integration tests exceed Vitest's 5s default.
        testTimeout: 15_000,
        setupFiles: ["./src/__tests__/setup/cleanup.ts"],
    },
});
