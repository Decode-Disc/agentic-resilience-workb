import { expect } from "@playwright/test";
import { test } from "./support/browser-workspace";
import {
    seedEvidenceMatrix,
    inspectEvidenceMatrix,
} from "./support/evidence-matrix-fixture";
import {
    admitAnalyst,
    seedSourceReview,
    inspectSourceReview,
} from "./support/source-review-fixture";

test("workspace navigation and inventory preserve context on desktop and mobile", async ({
    page,
}, info) => {
    test.setTimeout(300_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
    });
    await admitAnalyst(page);
    const key = "design-system-layout";
    const seeded = seedEvidenceMatrix(key, "showcase");
    await expect
        .poll(() => inspectEvidenceMatrix(seeded.runId, key).lifecycleState, {
            timeout: 90_000,
        })
        .toBe("evidence_ready");
    const source = seedSourceReview(`${key}-sources`);
    for (const width of [1440, 390]) {
        await page.setViewportSize({
            width,
            height: width === 390 ? 844 : 1000,
        });
        await page.emulateMedia({ reducedMotion: width === 390 ? "reduce" : "no-preference" });
        await page.goto(`/workspace/${seeded.runId}?section=progress`);
        const navigation = page.getByRole("navigation", {
            name: "Research workspace sections",
        });
        await expect(
            navigation.getByRole("link", { name: "Progress", exact: true }),
        ).toHaveAttribute("aria-current", "page");
        for (const name of ["Investigation", "Synthesis"])
            await expect(
                navigation.getByRole("button", { name, exact: true }),
            ).toHaveAttribute("aria-disabled", "true");
        await expect(
            page.getByRole("region", { name: "Research progress" }),
        ).toBeVisible();
        const dock = page.getByRole("button", {
            name: "Open evidence inventory",
        });
        await page.screenshot({
            path: info.outputPath(`progress-${width}.png`),
            fullPage: true,
        });
        await dock.click();
        await expect(page).toHaveURL(/inventory=1/);
        const inventory = page.getByRole("dialog", {
            name: "Evidence inventory",
            exact: true,
        });
        await expect(inventory).toBeVisible();
        await inventory
            .getByRole("button", { name: "Inference", exact: true })
            .click();
        await expect(
            inventory.getByRole("button", { name: "Inference", exact: true }),
        ).toHaveAttribute("aria-pressed", "true");
        await page.goBack();
        await expect(inventory).toBeHidden();
        await page.goForward();
        await expect(inventory).toBeVisible();
        await expect(
            inventory.getByRole("button", { name: "Inference", exact: true }),
        ).toHaveAttribute("aria-pressed", "true");
        await inventory.getByRole("button", { name: "All", exact: true }).click();
        await expect(inventory.getByRole("button", { name: /^Open Fact claim:/ })).toHaveCount(2);
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({
            path: info.outputPath(`inventory-${width}.png`),
            fullPage: true,
        });
        await page.keyboard.press("Escape");
        await expect(inventory).toBeHidden();
        await expect(dock).toBeFocused();
        await page.goto(`/workspace/${seeded.runId}?section=evidence`);
        await expect(inventory).toBeVisible();
        await inventory
            .getByRole("button", { name: "Close", exact: true })
            .click();
        await expect(inventory).toBeHidden();
        await expect(page).toHaveURL(/section=progress/);
        await page.goto(`/workspace/${seeded.runId}?section=assessment`);
        await expect(
            page.getByRole("heading", {
                name: "Investigation is not available yet",
            }),
        ).toBeVisible({ timeout: 60_000 });

        const sourceUrl = `/workspace/${source.runId}?section=sources&view=inspect&coverage=official_commercial_terms`;
        await page.goto(sourceUrl);
        await expect(
            navigation.getByRole("link", { name: "Sources", exact: true }),
        ).toHaveAttribute("aria-current", "page");
        await dock.click();
        await expect(inventory).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(inventory).toBeHidden();
        // Closing the inventory keeps the Sources location; retired inspection links open the matrix.
        await expect(page).toHaveURL(/section=sources/);
        await expect(page).not.toHaveURL(/inventory=1/);
        await expect(
            page.getByRole("heading", {
                name: "Sources view unavailable for this dossier",
            }),
        ).toBeVisible();
        await page.goto(`/workspace/${source.runId}?section=sources`);
        // A dossier prepared by the retired corpus review explains why its sources are not shown.
        await expect(
            page.getByRole("heading", {
                name: "Sources view unavailable for this dossier",
            }),
        ).toBeVisible();
        for (const theme of ["light", "dark"]) {
            await page.evaluate(
                (dark) =>
                    document.documentElement.classList.toggle("dark", dark),
                theme === "dark",
            );
            await page.screenshot({
                path: info.outputPath(`sources-${theme}-${width}.png`),
                fullPage: true,
            });
        }
    }
    expect(inspectEvidenceMatrix(seeded.runId, key).providerCallCount).toBe(0);
    expect(
        inspectSourceReview(source.runId, `${key}-sources`).providerCallCount,
    ).toBe(0);
    expect(errors).toEqual([]);
});
