import { defineConfig } from "@playwright/test";
import base from "./playwright.retrieval.config";
export default defineConfig({
    ...base,
    testMatch: [
        "approved-source-search.spec.ts",
        "source-recovery-reactivity.spec.ts",
        "source-review-reactivity.spec.ts",
    ],
    outputDir: "/tmp/evidence-preservation-browser",
});
