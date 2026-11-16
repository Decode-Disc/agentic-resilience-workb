import {
    browserTestDossierRow,
    closeDossierDetail,
    dossierDetail,
} from "./support/admin";
import type { internal } from "@convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { runConvexJson } from "./support/convex-admin";
import { expect } from "@playwright/test";
import {
    admitAdministrator,
} from "./support/admission";
import {
    browserTestSlot,
    test,
    closeBrowserTestContext,
} from "./support/browser-workspace";
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
        const fixture = await seedSourceReview(
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
        const fixture = await seedSourceReview(`header-layout-${viewport.width}`);
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
        const navigation = await page
            .getByRole("button", { name: "Workbench navigation", exact: true })
            .boundingBox();
        const account = await page
            .getByRole("button", { name: "Workspace menu", exact: true })
            .boundingBox();
        expect(navigation).not.toBeNull();
        expect(account).not.toBeNull();
        if (!navigation || !account)
            throw new Error("Header controls are missing");
        expect(
            Math.abs(
                navigation.y +
                    navigation.height / 2 -
                    account.y -
                    account.height / 2,
            ),
        ).toBeLessThanOrEqual(2);
    });
}

test("protected administration separates and pages technical dossiers", async ({
    page,
    browser,
}) => {
    await admitAdministrator(page);
    const validationContext = await browser.newContext({
        baseURL: test.info().project.use.baseURL,
        reducedMotion: "reduce",
    });
    const validationPage = await validationContext.newPage();
    try {
        await admitAnalyst(validationPage);
        const population = await runConvexJson<
            FunctionReturnType<
                typeof internal.e2eFixtures.seedAdministrationPaginationScenario
            >
        >("e2eFixtures:seedAdministrationPaginationScenario", {
            fixtureKey: "admin-pagination",
            slotKey: browserTestSlot(),
        });
        await page
            .getByRole("tab", { name: "Dossiers", exact: true })
            .click();
        await page.getByRole("tab", { name: "Benchmarks", exact: true }).click();
        // Review decisions share the section, so dossier rows are counted inside their purpose panel.
        const benchmarks = page.getByRole("tabpanel", { name: "Benchmarks" });
        await expect(
            benchmarks.getByRole("button", { name: "Open dossier", exact: true }),
        ).toHaveCount(20);
        await expect(
            page.getByRole("button", { name: "Status: All", exact: true }),
        ).toBeVisible();
        await expect(
            page
                .getByRole("button", { name: "Period: All time", exact: true })
                .first(),
        ).toBeVisible();
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
            benchmarks.getByRole("button", { name: "Open dossier", exact: true }),
        ).toHaveCount(40);
        for (const id of population.evaluationRunIds)
            await expect(page.getByText(id, { exact: true })).toBeVisible();
        await benchmarks
            .getByRole("button", { name: "Open dossier", exact: true })
            .first()
            .click();
        const dialog = dossierDetail(page);
        await expect(
            dialog.getByRole("tab", { name: /^Provider receipts/ }),
        ).toBeVisible();
        await expect(
            dialog.getByRole("button", { name: "Status: All", exact: true }),
        ).toBeVisible();
        await expect(
            dialog.getByRole("button", { name: "Service: All", exact: true }),
        ).toBeVisible();
        await expect(
            dialog.getByRole("button", { name: "Period: All time", exact: true }),
        ).toBeVisible();
        await expect(
            dialog.getByRole("button", { name: /resume|retry|start/i }),
        ).toHaveCount(0);
        await closeDossierDetail(page);
        await page
            .getByRole("tab", { name: "Activity & spend", exact: true })
            .click();
        await expect(
            page.getByRole("heading", {
                name: "Recent provider attempts",
                exact: true,
            }),
        ).toBeVisible();
        const inspectAttempt = page.getByRole("button", {
            name: "Inspect attempt",
            exact: true,
        });
        if ((await inspectAttempt.count()) > 0) {
            await inspectAttempt.first().click();
            const attemptDialog = page.getByRole("dialog", {
                name: "Provider attempt",
            });
            await expect(attemptDialog).toBeVisible();
            await page.keyboard.press("Escape");
            await expect(attemptDialog).toBeHidden();
        }
        await page.setViewportSize({ width: 390, height: 844 });
        await page
            .getByRole("tab", { name: "Dossiers", exact: true })
            .click();
        await page.getByRole("tab", { name: "Browser tests", exact: true }).click();
        await expect(
            page
                .getByRole("tabpanel", { name: "Browser tests" })
                .getByRole("button", { name: "Open dossier", exact: true }),
        ).toHaveCount(20);
        for (const id of population.browserRunIds)
            await expect(await browserTestDossierRow(page, id)).toBeVisible();
        await page.getByRole("tab", { name: /^Reservations/ }).click();
        await expect(
            page.getByRole("button", { name: "Quota: All", exact: true }),
        ).toBeVisible();
        await expect(
            page.getByText("Reserved for validation", { exact: true }).first(),
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
        await closeBrowserTestContext(validationPage);
        await validationContext.close();
    }
});
