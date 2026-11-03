import { expect, test } from "@playwright/test";
for (const width of [1440, 390])
    for (const theme of ["light", "dark"])
        test(`dossier selection ${width} ${theme}`, async ({ page }) => {
            await page.setViewportSize({ width, height: 900 });
            const errors: string[] = [];
            page.on("pageerror", (e) => errors.push(e.message));
            await page.goto(`/?component=DossierSwitcher&theme=${theme}`);
            const trigger = page.getByRole("button", {
                name: "Switch research dossier",
                exact: true,
            });
            await expect(trigger).toContainText("In progress");
            await trigger.click();
            const search = page.getByRole("textbox", {
                name: "Find a dossier",
                exact: true,
            });
            await search.fill("service");
            await expect(page.getByRole("option")).toHaveCount(2);
            await page
                .getByRole("option", { name: /IT service request/ })
                .click();
            await expect(trigger).toContainText("IT service request");
            await expect(trigger).toContainText("Framing");
            await trigger.click();
            await page.keyboard.press("Escape");
            await expect(trigger).toBeFocused();
            await page.screenshot({
                path: `/tmp/dossier-switcher-${width}-${theme}.png`,
            });
            expect(
                await page.evaluate(
                    () => document.documentElement.scrollWidth <= innerWidth,
                ),
            ).toBe(true);
            expect(errors).toEqual([]);
        });
