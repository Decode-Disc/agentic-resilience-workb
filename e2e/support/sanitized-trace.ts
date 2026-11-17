import { test, type Page } from "@playwright/test";

/**
 * Credential-safe manual tracing for the protected Playwright gates.
 *
 * Playwright's automatic trace/video/screenshot capture is disabled in
 * playwright.config.ts because admission flows render the reusable analyst
 * access code on screen. This helper starts a manual trace only after an
 * admission drawer has closed and restricts every stop path to
 * `test.info().outputPath`. Labels are credential-free and sanitized to
 * `[a-zA-Z0-9._-]`, so access codes can never reach trace names, paths,
 * attachments, or logs.
 */
const activeTraceByPage = new WeakMap<Page, string>();

function sanitizeLabel(label: string): string {
    const sanitized = label
        .replace(/[^a-zA-Z0-9._-]+/g, "-")
        .replace(/^-+|-+$/g, "");
    return sanitized || "admission-safe";
}

export async function startSanitizedTrace(page: Page): Promise<void> {
    if (activeTraceByPage.has(page)) {
        throw new Error(
            "Sanitized trace is already active on this page; stop it before starting another",
        );
    }
    const label = sanitizeLabel(test.info().title);
    await page.context().tracing.start({
        name: label,
        title: label,
        screenshots: true,
        snapshots: true,
    });
    activeTraceByPage.set(page, label);
}

export async function stopSanitizedTrace(page: Page): Promise<void> {
    const label = activeTraceByPage.get(page);
    if (label === undefined) {
        return;
    }
    await page.context().tracing.stop({
        path: test.info().outputPath(`trace-${label}.zip`),
    });
    activeTraceByPage.delete(page);
}

/** Stops the page trace when one is active; safe to call from afterEach. */
export async function stopSanitizedTraceIfActive(page: Page): Promise<void> {
    await stopSanitizedTrace(page);
}