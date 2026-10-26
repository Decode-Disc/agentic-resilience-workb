import { readFileSync } from "node:fs";
import type { internal } from "@convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { runConvexJson } from "./support/convex-cli";
import { expect } from "@playwright/test";
import { test, closeBrowserTestContext } from "./support/browser-workspace";
import {
    admitAnalyst,
    seedSourceReview,
} from "./support/source-review-fixture";

for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
]) {
    test(`test workspace stays isolated after reload at ${viewport.width}px`, async ({
        page,
    }) => {
        await page.setViewportSize(viewport);
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await admitAnalyst(page);
        const fixture = seedSourceReview(
            `workspace-separation-${viewport.width}-${Date.now()}`,
        );
        await page.reload();
        await expect(
            page.getByText("Test data — not live", { exact: true }),
        ).toBeVisible();
        await expect(page.locator('[data-slot="cutout-card"]')).toHaveCount(1);
        await page.screenshot({
            path: test.info().outputPath(`dossiers-${viewport.width}.png`),
        });
        await expect(
            page.getByRole("button", {
                name: "Start a company dossier",
                exact: true,
            }),
        ).toHaveCount(0);
        const link = page
            .getByRole("link", { name: /Open .* dossier/ })
            .first();
        await link.focus();
        await expect(link).toBeFocused();
        await page.keyboard.press("Enter");
        await expect(page).toHaveURL(new RegExp(fixture.runId));
        await page.reload();
        await expect(
            page.getByRole("heading", {
                name: "Reactive Systems Test Company",
                exact: true,
            }),
        ).toBeVisible();
        await closeBrowserTestContext(page);
        await page.reload();
        await expect(page.getByRole("alert").first()).toBeVisible();
        expect(errors).toEqual([]);
    });
    test(`header keeps its navigation on one row at ${viewport.width}px`, async ({
        page,
    }) => {
        await page.setViewportSize(viewport);
        await admitAnalyst(page);
        const fixture = seedSourceReview(`header-layout-${viewport.width}`);
        await page.goto(`/workspace/${fixture.runId}`);
        await expect(
            page.getByRole("heading", {
                name: "Reactive Systems Test Company",
                exact: true,
            }),
        ).toBeVisible();
        await page.screenshot({
            path: test.info().outputPath(`header-${viewport.width}.png`),
        });
        const home = await page
            .getByRole("button", { name: "Go to Home", exact: true })
            .boundingBox();
        const account = await page
            .getByRole("button", { name: "Workspace menu", exact: true })
            .boundingBox();
        expect(home).not.toBeNull();
        expect(account).not.toBeNull();
        if (!home || !account) throw new Error("Header controls are missing");
        expect(
            Math.abs(home.y + home.height / 2 - account.y - account.height / 2),
        ).toBeLessThanOrEqual(2);
    });
}

test("protected administration separates and pages technical dossiers", async ({
    page,
    browser,
}) => {
    const material = JSON.parse(
        readFileSync("invitation-otp-codes.local", "utf8"),
    ) as { invitations: Array<{ role: string; code: string }> };
    await page.goto("/workspace/admin");
    const invitation = material.invitations.find(
        (item) => item.role === "admin",
    );
    if (!invitation)
        throw new Error("Local administrator invitation is missing");
    await expect(page.getByLabel("Access code")).toBeVisible({
        timeout: 30_000,
    });
    await page.getByLabel("Access code").fill(invitation.code);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(
        page.getByRole("dialog", { name: "Protected access" }),
    ).toBeHidden();
    await expect(
        page.getByRole("heading", { name: "Administration" }),
    ).toBeVisible();
    const validationContext = await browser.newContext({
        baseURL: test.info().project.use.baseURL,
        reducedMotion: "reduce",
    });
    const validationPage = await validationContext.newPage();
    try {
        await admitAnalyst(validationPage);
        const population = runConvexJson<
            FunctionReturnType<
                typeof internal.e2eFixtures.seedAdministrationPaginationScenario
            >
        >("e2eFixtures:seedAdministrationPaginationScenario", {
            fixtureKey: "admin-pagination",
        });
        await page.getByRole("tab", { name: "Benchmarks", exact: true }).click();
        await expect(
            page.getByRole("button", { name: "Inspect dossier", exact: true }),
        ).toHaveCount(20);
        const firstPageMembership = await Promise.all(
            population.evaluationRunIds.map((id) =>
                page.getByText(id, { exact: true }).isVisible(),
            ),
        );
        expect(firstPageMembership.filter(Boolean)).toHaveLength(20);
        await page.screenshot({
            path: test.info().outputPath("admin-desktop.png"),
        });
        await page
            .getByRole("button", { name: "Load more dossiers", exact: true })
            .click();
        await expect(
            page.getByRole("button", { name: "Inspect dossier", exact: true }),
        ).toHaveCount(40);
        for (const id of population.evaluationRunIds)
            await expect(page.getByText(id, { exact: true })).toBeVisible();
        await page
            .getByRole("button", { name: "Inspect dossier", exact: true })
            .first()
            .click();
        const dialog = page.getByRole("dialog", { name: "Dossier inspection" });
        await expect(
            dialog.getByText("Provider receipts", { exact: true }),
        ).toBeVisible();
        await expect(
            dialog.getByRole("button", { name: /resume|retry|start/i }),
        ).toHaveCount(0);
        await page.keyboard.press("Escape");
        await expect(dialog).toBeHidden();
        await page.setViewportSize({ width: 390, height: 844 });
        await page.getByRole("tab", { name: "Browser tests", exact: true }).click();
        await expect(
            page.getByRole("button", { name: "Inspect dossier", exact: true }),
        ).toHaveCount(20);
        for (const id of population.browserRunIds)
            await expect(page.getByText(id, { exact: true })).toBeVisible();
        await page.getByRole("tab", { name: "Reservations", exact: true }).click();
        await expect(
            page.getByText("Reserved for validation", { exact: true }),
        ).toBeVisible();
        await page.screenshot({
            path: test.info().outputPath("admin-mobile.png"),
        });
        expect(
            await page.evaluate(
                () => document.documentElement.scrollWidth <= window.innerWidth,
            ),
        ).toBe(true);
    } finally {
        closeBrowserTestContext(validationPage);
        await validationContext.close();
    }
});
