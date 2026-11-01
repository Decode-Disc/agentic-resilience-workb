import { defineConfig } from "vitest/config";

export default defineConfig({
    resolve: { tsconfigPaths: true },
    test: {
        environment: "node",
        include: [
            "src/__tests__/convex/execution/harness-performance.bench.ts",
        ],
        maxWorkers: 1,
        testTimeout: 120000,
    },
});
