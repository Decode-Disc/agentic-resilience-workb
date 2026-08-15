import { defineConfig, devices } from "@playwright/test";

const appUrl = "http://127.0.0.1:3000";
const convexUrl = "http://127.0.0.1:3210";

export default defineConfig({
    testDir: "./e2e",
    fullyParallel: false,
    forbidOnly: Boolean(process.env.CI),
    retries: process.env.CI ? 1 : 0,
    workers: 1,
    reporter: [["html", { open: "never" }], ["list"]],
    timeout: 60_000,
    expect: { timeout: 10_000 },
    use: {
        baseURL: process.env.PLAYWRIGHT_BASE_URL ?? appUrl,
        actionTimeout: 10_000,
        navigationTimeout: 20_000,
        trace: "on-first-retry",
        screenshot: "only-on-failure",
        video: "retain-on-failure",
        locale: "en-US",
        reducedMotion: "reduce",
    },
    projects: [
        {
            name: "chromium",
            use: { ...devices["Desktop Chrome"] },
        },
    ],
    globalSetup: "./e2e/global-setup.ts",
    globalTeardown: "./e2e/global-teardown.ts",
    webServer: [
        {
            command: "pnpm convex:dev",
            url: convexUrl,
            reuseExistingServer: false,
            timeout: 120_000,
            stdout: "pipe",
            stderr: "pipe",
        },
        {
            command: "pnpm dev:web",
            url: appUrl,
            reuseExistingServer: false,
            timeout: 120_000,
            stdout: "pipe",
            stderr: "pipe",
        },
    ],
});
