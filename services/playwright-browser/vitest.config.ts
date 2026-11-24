import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
    root: fileURLToPath(new URL("../../", import.meta.url)),
    resolve: {
        tsconfigPaths: true,
        alias: [
            {
                find: "playwright",
                replacement: fileURLToPath(
                    new URL(
                        "./node_modules/playwright/index.mjs",
                        import.meta.url,
                    ),
                ),
            },
            {
                find: /^vitest$/,
                replacement: fileURLToPath(
                    new URL(
                        "./node_modules/vitest/dist/index.js",
                        import.meta.url,
                    ),
                ),
            },
        ],
    },
    test: {
        include: [
            "services/playwright-browser/src/__tests__/**/*.test.ts",
            "src/__tests__/services/preview-egress.spec.ts",
        ],
        environment: "node",
        globals: false,
        testTimeout: 40000,
        hookTimeout: 40000,
        exclude: ["dist/**", "node_modules/**"],
    },
});
