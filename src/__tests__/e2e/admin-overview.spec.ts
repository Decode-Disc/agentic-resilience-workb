import { expect, type Page, test } from "@playwright/test";
import { closeDossierDetail, dossierDetail } from "../../../e2e/support/admin";
import {
    admitAdministrator,
    expectAdmissionClosed,
} from "../../../e2e/support/admission";

const screenshots = process.env.ADMIN_SHOT_DIR;

async function expectReadable(page: Page) {
    expect(
        await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
        ),
    ).toBe(false);
    await expect(page.locator("main")).not.toContainText(
        /missing_authorized_route|model_not_compatible|stale_execution/,
    );
}

for (const viewport of [
    { name: "1440", width: 1440, height: 1000 },
    { name: "390", width: 390, height: 844 },
]) {
    test(`administration opens on what needs attention and keeps its place at ${viewport.name}px`, async ({
        browser,
    }) => {
        test.setTimeout(180_000);
        const context = await browser.newContext({
            baseURL: test.info().project.use.baseURL,
            viewport,
            reducedMotion: "reduce",
        });
        const page = await context.newPage();
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("console", (message) => {
            if (message.type() === "error") errors.push(message.text());
        });
        try {
            await admitAdministrator(page);

            await expect(
                page.getByRole("tab", { name: "Overview", selected: true }),
            ).toBeVisible({ timeout: 60_000 });
            const attention = page.getByRole("heading", {
                name: "Needs attention",
            });
            await expect(attention).toBeVisible();
            await expect(
                page.getByText("Nothing needs attention", { exact: true }).or(
                    page
                        .getByRole("button", {
                            name: /Refresh input profiles|Open dossier|Turn paid work on|Review reservations|Review models/,
                        })
                        .first(),
                ),
            ).toBeVisible({ timeout: 30_000 });
            await expect(
                page.getByRole("switch", { name: "Paid work" }),
            ).toBeVisible();
            await expectReadable(page);
            if (screenshots)
                await page.screenshot({
                    path: `${screenshots}/gate-${viewport.name}-overview.png`,
                    fullPage: true,
                });

            // Keyboard moves between sections, and the URL keeps the section across a reload.
            await page.getByRole("tab", { name: "Overview" }).focus();
            await page.keyboard.press("ArrowRight");
            await page.keyboard.press("Enter");
            await expect(
                page.getByRole("tab", {
                    name: "Dossiers",
                    exact: true,
                    selected: true,
                }),
            ).toBeVisible();
            await expect(page).toHaveURL(/section=dossiers/);
            await page.reload();
            await expectAdmissionClosed(page);
            await expect(
                page.getByRole("tab", {
                    name: "Dossiers",
                    exact: true,
                    selected: true,
                }),
            ).toBeVisible({ timeout: 60_000 });

            const research = page.getByRole("tabpanel", { name: "Research" });
            const open = research
                .getByRole("button", { name: "Open dossier", exact: true })
                .first();
            await expect(open).toBeVisible({ timeout: 30_000 });
            await open.click();
            const panel = dossierDetail(page);
            await expect(panel).toBeVisible();
            await expect(page).toHaveURL(/dossier=/);
            if (screenshots)
                await page.screenshot({
                    path: `${screenshots}/gate-${viewport.name}-dossier.png`,
                });

            // The open dossier is part of the address.
            await page.reload();
            await expectAdmissionClosed(page);
            await expect(panel).toBeVisible({ timeout: 60_000 });

            const withdraw = panel.getByRole("button", {
                name: "Withdraw dossier",
            });
            if (await withdraw.count()) {
                await withdraw.click();
                const confirm = page.getByRole("button", {
                    name: "Confirm withdrawal",
                });
                await expect(confirm).toBeDisabled();
                await page
                    .getByLabel("Reason for withdrawal")
                    .fill("Too short");
                await expect(confirm).toBeDisabled();
                await page.getByRole("button", { name: "Cancel" }).click();
                await expect(confirm).toBeHidden();
            }

            await closeDossierDetail(page);
            await expect(page).not.toHaveURL(/dossier=/);

            await page.getByRole("tab", { name: "Models & agents" }).click();
            await page.getByRole("tab", { name: /^Model catalogue/ }).click();
            await expect(
                page.getByRole("heading", { name: "Model catalogue" }),
            ).toBeVisible();
            await page.getByRole("button", { name: "Add a model" }).click();
            const editor = page.getByRole("dialog", { name: "Add a model" });
            await expect(editor).toBeVisible();
            await page.keyboard.press("Escape");
            await expect(editor).toBeHidden();
            await expect(
                page.getByRole("button", { name: "Add a model" }),
            ).toBeFocused();
            await expectReadable(page);
            if (screenshots)
                await page.screenshot({
                    path: `${screenshots}/gate-${viewport.name}-models.png`,
                    fullPage: true,
                });

            await page.getByRole("tab", { name: "Activity & spend" }).click();
            await expect(
                page.getByRole("heading", { name: "Recent provider attempts" }),
            ).toBeVisible();
            await expectReadable(page);
            if (screenshots)
                await page.screenshot({
                    path: `${screenshots}/gate-${viewport.name}-activity.png`,
                    fullPage: true,
                });
            expect(errors).toEqual([]);
        } finally {
            await context.close();
        }
    });
}
