import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
    resolve: {
        tsconfigPaths: true,
        alias: {
            playwright: fileURLToPath(
                new URL("./node_modules/playwright/index.mjs", import.meta.url),
            ),
        },
    },
    test: {
        environment: "node",
        globals: false,
        testTimeout: 40000,
        hookTimeout: 40000,
        exclude: ["dist/**", "node_modules/**"],
    },
});
