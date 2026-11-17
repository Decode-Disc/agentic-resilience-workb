import { join } from "node:path";
import { defineConfig } from "@playwright/test";
import base from "./playwright.retrieval.config";
export default defineConfig({
    ...base,
    testMatch: "source-utility.spec.ts",
    outputDir: join(base.outputDir ?? ".local-runtime/playwright", "utility"),
});
