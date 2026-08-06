import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
    resolve: { tsconfigPaths: true },
    plugins: [viteReact()],
    test: {
        environment: "jsdom",
        include: ["src/__tests__/**/*.test.{ts,tsx}"],
        isolate: true,
        maxWorkers: 4,
        setupFiles: ["./src/__tests__/setup/cleanup.ts"],
    },
});
