import { defineConfig } from "@playwright/test";
import base from "./playwright.retrieval.config";
export default defineConfig({
    ...base,
    testMatch: "source-utility.spec.ts",
    outputDir: "/tmp/source-utility-20261021/browser-baseline",
});
