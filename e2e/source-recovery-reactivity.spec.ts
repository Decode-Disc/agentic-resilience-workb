import { expect, test } from "@playwright/test";
import { admitAnalyst, seedSourceReview, inspectSourceReview } from "./support/source-review-fixture";
import { startSanitizedTrace, stopSanitizedTraceIfActive } from "./support/sanitized-trace";

test.afterEach(async ({ page }) => { await stopSanitizedTraceIfActive(page); });

for (const viewport of [{ name: "desktop", width: 1440, height: 1000 }, { name: "mobile", width: 390, height: 844 }]) {
    test(`${viewport.name} recovery actions preserve decisions and update coverage without reload`, async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        const errors: string[] = [];
        page.on("pageerror", error => errors.push(error.name));
        page.on("console", message => { if (message.type() === "error") errors.push("console.error"); });
        // Fixture domains have no guaranteed third-party favicon.
        await page.route("https://www.google.com/s2/favicons**", route => route.fulfill({
            status: 200,
            contentType: "image/svg+xml",
            body: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"/>',
        }));
        await admitAnalyst(page);
        const key = `source-recovery-${viewport.name}-${Date.now()}`;
        const seeded = seedSourceReview(key, true);
        await page.goto(`/workspace/${seeded.runId}?section=sources`);
        await expect(page.getByRole("region", { name: "Proposed source set" })).toBeVisible();
        await startSanitizedTrace(page);
        await expect(page.getByText("Some searches failed", { exact: true })).toBeVisible();
        await expect(page.getByText("Source coverage needs review", { exact: true })).toBeVisible();
        const platformGap = page.getByRole("button", { name: "Review coverage: Product or platform documentation", exact: true });
        await expect(platformGap).toHaveCount(0);
        const retry = page.getByRole("button", { name: "Retry searches", exact: true });
        await retry.focus();
        await retry.press("Enter");
        await expect(page.getByRole("status").filter({ hasText: "This dossier has reached its source limit" })).toBeVisible();
        const terms = page.getByRole("button", { name: "Review coverage: Terms or offer details", exact: true });
        await expect(page.getByRole("button", { name: /^Search sources for/ })).toHaveCount(0);
        await terms.focus();
        await terms.press("Enter");
        const gapActions = page.getByRole("dialog", { name: "Terms or offer details", exact: true });
        await expect(gapActions).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(gapActions).toHaveCount(0);
        await expect(terms).toBeFocused();
        await terms.click();
        await gapActions.getByRole("button", { name: "Search sources for Terms or offer details", exact: true }).click();
        await expect(gapActions).toHaveCount(0);
        await expect(terms).toBeFocused();
        await expect(page.getByRole("status").filter({ hasText: "This dossier has reached its source limit" })).toBeVisible();
        await page.getByRole("button", { name: "Move Official product documentation to alternatives", exact: true }).click();
        await expect(platformGap).toBeVisible();
        await page.getByRole("tab", { name: /Alternatives/ }).click();
        await page.getByRole("button", { name: "Include Official product documentation in source set", exact: true }).click();
        await expect(platformGap).toHaveCount(0);
        if (viewport.name === "mobile") await page.getByRole("button", { name: "Source actions", exact: true }).click();
        await page.getByRole("button", { name: "Add source link", exact: true }).click();
        await expect(page.getByRole("dialog")).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(page.getByRole("dialog")).toHaveCount(0);
        await expect(page.getByRole("button", { name: viewport.name === "mobile" ? "Source actions" : "Add source link", exact: true })).toBeFocused();
        await terms.click();
        await gapActions.getByRole("button", { name: "Review candidates for Terms or offer details", exact: true }).click();
        await expect(page.getByText("Reviewing coverage: Terms or offer details", { exact: true })).toBeVisible();
        await page.getByRole("button", { name: "Back to proposal", exact: true }).click();
        await stopSanitizedTraceIfActive(page);
        await page.reload();
        await expect(page.getByText("Some searches failed", { exact: true })).toBeVisible();
        await expect(platformGap).toHaveCount(0);
        await expect.poll(() => inspectSourceReview(seeded.runId, key)).toMatchObject({ providerCallCount: 0, revisionStatus: "draft", decisions: expect.arrayContaining([{ title: "Official product documentation", decision: "accepted" }]) });
        await expect(page.getByRole("region", { name: "Proposed source set" })).not.toContainText(/official_product|sourceSelectionProposalActions|capacity_reached|EXA_API_KEY/);
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        const warning = page.getByRole("alert").filter({ hasText: "Source coverage needs review" });
        const warningBounds = await warning.boundingBox();
        expect(warningBounds?.height).toBeLessThan(viewport.name === "desktop" ? 250 : 700);
        await page.screenshot({ path: `/tmp/source-warning-refinement/fixture-${viewport.name}.png`, fullPage: true });
        expect(errors).toEqual([]);
    });
}
