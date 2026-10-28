import { defineConfig } from "@playwright/test";
export default defineConfig({
    testDir: "./src/__tests__/design-system/workbench-ui/browser",
    outputDir: "test-results/workbench-ui",
    fullyParallel: false,
    workers: 1,
    retries: 0,
    timeout: 30000,
    use: {
        baseURL: "http://127.0.0.1:3002",
        deviceScaleFactor: 1,
        contextOptions: { reducedMotion: "reduce" },
        launchOptions: process.env.WORKBENCH_UI_BROWSER_PATH
            ? { executablePath: process.env.WORKBENCH_UI_BROWSER_PATH }
            : {},
    },
    webServer: {
        command:
            "node node_modules/vite/bin/vite.js --config workbench-ui.vite.config.ts",
        url: "http://127.0.0.1:3002",
        reuseExistingServer: !process.env.CI,
        timeout: 30000,
    },
});
