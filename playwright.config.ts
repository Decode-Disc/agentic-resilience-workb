import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { resolveLocalRuntime } from "./scripts/local-runtime.ts";

const runtime = await resolveLocalRuntime(process.cwd(), {
    requiredOrigins: ["convex", "web"],
});
const outputRoot = join(
    runtime.identity.root,
    ".local-runtime",
    "playwright",
    runtime.identity.worktreeId,
);
process.env.LOCAL_RUNTIME_CONVEX_ORIGIN = runtime.origins.convex;
process.env.LOCAL_RUNTIME_WORKTREE_ID = runtime.identity.worktreeId;

function resolvePlaywrightWorkers(): number {
    const raw =
        process.env.WORKBENCH_E2E_WORKERS?.trim() ??
        process.env.PLAYWRIGHT_WORKERS?.trim();
    if (!raw) return 2;
    if (/^(false|off|serial|disabled)$/i.test(raw)) return 1;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < 1) return 1;
    return Math.min(parsed, 4);
}

const configuredWorkers = resolvePlaywrightWorkers();

export default defineConfig({
    testDir: ".",
    testMatch: ["e2e/**/*.spec.ts", "src/__tests__/e2e/**/*.spec.ts"],
    // Retired specs are kept verbatim outside the build.
    testIgnore: ["archive/**"],
    outputDir: join(outputRoot, "results"),
    fullyParallel: true,
    forbidOnly: Boolean(process.env.CI),
    retries: process.env.CI ? 1 : 0,
    workers: configuredWorkers,
    reporter: [
        ["html", { open: "never", outputFolder: join(outputRoot, "report") }],
        ["list"],
    ],
    timeout: 60_000,
    expect: { timeout: 10_000 },
    use: {
        baseURL: runtime.origins.web,
        launchOptions: process.env.WORKBENCH_UI_BROWSER_PATH
            ? { executablePath: process.env.WORKBENCH_UI_BROWSER_PATH }
            : {},
        actionTimeout: 10_000,
        navigationTimeout: 20_000,
        // Automatic diagnostics are disabled because they can capture the
        // reusable analyst access code rendered by the admission drawer.
        trace: "off",
        screenshot: "off",
        video: "off",
        locale: "en-US",
        contextOptions: {
            reducedMotion: "reduce",
        },
    },
    projects: [
        {
            name: "chromium",
            use: { ...devices["Desktop Chrome"] },
        },
    ],
    globalSetup: "./e2e/global-setup.ts",
    globalTeardown: "./e2e/global-teardown.ts",
});
