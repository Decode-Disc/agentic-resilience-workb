import { join } from "node:path";
import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

/** Uses the explicitly started local stack and preserves its invitation configuration. */
export default defineConfig({
    ...base,
    use: { ...base.use, channel: "chrome" },
    testMatch: "retrieval-approval.spec.ts",
    globalSetup: undefined,
    globalTeardown: undefined,
    webServer: undefined,
    outputDir: join(base.outputDir ?? ".local-runtime/playwright", "retrieval"),
    reporter: [["list"]],
    retries: 0,
});
