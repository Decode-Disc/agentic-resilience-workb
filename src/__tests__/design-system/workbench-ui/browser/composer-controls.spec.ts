import { expect, test } from "@playwright/test";

for (const theme of ["light", "dark"])
    for (const width of [1440, 390])
        test(`shared composer controls ${theme} ${width}`, async ({ page }) => {
            const errors: string[] = [];
            page.on("pageerror", (e) => errors.push(e.message));
            await page.setViewportSize({
                width,
                height: width === 390 ? 844 : 1000,
            });
            await page.emulateMedia({
                reducedMotion: width === 390 ? "reduce" : "no-preference",
            });
            await page.goto(`/?component=Composer&theme=${theme}`);
            const input = page.getByRole("textbox", {
                name: "Message",
                exact: true,
            });
            await input.fill("/");
            await expect(
                page.getByRole("option", { name: /\/pause/ }),
            ).toBeVisible();
            await expect(
                page.getByRole("option", { name: /\/resume/ }),
            ).toHaveCount(0);
            await input.press("ArrowDown");
            await input.press("Enter");
            await expect(
                page.getByRole("menuitemradio", {
                    name: "Illustrative balanced model",
                    exact: true,
                }),
            ).toBeVisible();
            await expect(input).toHaveValue("");
            await page
                .getByRole("menuitemradio", {
                    name: "Illustrative fast model",
                    exact: true,
                })
                .click();
            await expect(
                page.getByRole("button", {
                    name: "Workbench model and effort",
                }),
            ).toContainText("Illustrative fast model");
            await input.fill("/p");
            await input.press("Enter");
            await expect(page.getByRole("alert")).toContainText(
                "Command not confirmed",
            );
            await expect(input).toHaveValue("/p");
            await input.fill("Keep my draft");
            await page
                .getByRole("button", { name: "Composer tools", exact: true })
                .click();
            await page
                .getByRole("menuitem", { name: "Commands", exact: true })
                .click();
            const search = page.getByRole("combobox", {
                name: "Search commands",
                exact: true,
            });
            await expect(search).toBeFocused();
            await expect(
                page.getByRole("option", { name: /\/pause/ }),
            ).toBeVisible();
            await expect(
                page.getByRole("option", { name: /\/model/ }),
            ).toBeVisible();
            await expect(input).toHaveValue("Keep my draft");
            await search.fill("model");
            await expect(
                page.getByRole("option", { name: /\/pause/ }),
            ).toHaveCount(0);
            await search.press("ArrowDown");
            await search.press("Enter");
            await expect(
                page.getByRole("menuitemradio", {
                    name: "Illustrative fast model",
                    exact: true,
                }),
            ).toBeVisible();
            await expect(input).toHaveValue("Keep my draft");
            await page.keyboard.press("Escape");
            await page
                .getByRole("button", { name: "Composer tools", exact: true })
                .click();
            await page
                .getByRole("menuitem", { name: "Commands", exact: true })
                .click();
            await expect(search).toBeFocused();
            await search.press("Escape");
            await expect(search).toHaveCount(0);
            await expect(input).toHaveValue("Keep my draft");
            await input.fill("/");
            await expect(
                page.getByRole("option", { name: /\/model/ }),
            ).toBeVisible();
            await page.screenshot({
                path: `/tmp/composer-controls-${theme}-${width}.png`,
            });
            expect(
                await page.evaluate(
                    () => document.documentElement.scrollWidth <= innerWidth,
                ),
            ).toBe(true);
            expect(errors).toEqual([]);
        });
