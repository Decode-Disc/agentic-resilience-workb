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
    outputDir: "/tmp/evidence-retrieval-implementation-20261021/browser",
    reporter: [["list"]],
    retries: 0,
});
