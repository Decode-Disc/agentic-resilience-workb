import { randomUUID } from "node:crypto";
import { type Page, test as base } from "@playwright/test";
import { runConvexJson } from "./convex-cli";

export const BROWSER_TEST_SLOT = "analyst-4";
const contexts = new WeakMap<Page, string>();

/** Explicitly binds the already-admitted anonymous principal, including after sign-in again. */
export function bindBrowserTestContext(page: Page) {
    const contextKey = contexts.get(page) ?? `browser-${randomUUID()}`;
    runConvexJson("runWorkspace:openBrowserTestContext", {
        slotKey: BROWSER_TEST_SLOT,
        contextKey,
        durationMs: Math.min(2 * 60 * 60 * 1000, base.info().timeout + 60_000),
    });
    contexts.set(page, contextKey);
}

export function closeBrowserTestContext(page: Page) {
    const contextKey = contexts.get(page);
    if (!contextKey) return;
    runConvexJson("runWorkspace:closeBrowserTestContext", {
        slotKey: BROWSER_TEST_SLOT,
        contextKey,
    });
    contexts.delete(page);
}

/** Cleanup runs after test hooks; server expiry remains the fallback for a killed runner. */
export const test = base.extend<{ browserWorkspace: void }>({
    browserWorkspace: [
        async ({ page }, use) => {
            try {
                await use();
            } finally {
                closeBrowserTestContext(page);
            }
        },
        { auto: true },
    ],
});
