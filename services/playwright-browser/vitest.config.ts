import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        environment: "node",
        globals: false,
        testTimeout: 40000,
        hookTimeout: 40000,
        exclude: ["dist/**", "node_modules/**"],
    },
});
