import { defineConfig } from "@playwright/test";
import base from "./playwright.retrieval.config";

export default defineConfig({
    ...base,
    testMatch: ["agent-harness.spec.ts", "retrieval-approval.spec.ts"],
    timeout: 150_000,
});
