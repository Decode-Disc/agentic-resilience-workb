import { expect, test } from "@playwright/test";
import { reviewResearchProgram } from "@/__tests__/helpers/research-program";

for (const width of [1440, 390])
    for (const theme of ["light", "dark"])
        test(`question entry has clear actions ${theme} ${width}`, async ({
            page,
        }) => {
            const errors: string[] = [];
            page.on("pageerror", (e) => errors.push(e.message));
            await page.setViewportSize({
                width,
                height: width === 390 ? 844 : 1000,
            });
            await page.goto(`/?layout=start&screen=framing&theme=${theme}`);
            const contextClose = page.getByRole("button", {
                name: "Close research context",
                exact: true,
            });
            if (await contextClose.isVisible()) await contextClose.click();
            const ordinary = page.getByRole("textbox", {
                name: "Refine the framing in your own words",
                exact: true,
            });
            await ordinary.fill("Keep my ordinary draft.");
            await reviewResearchProgram(page);
            await page
                .getByRole("button", {
                    name: "Add research question",
                    exact: true,
                })
                .click();
            const input = page.getByRole("textbox", {
                name: "Add research question",
                exact: true,
            });
            await expect(input).toBeFocused();
            await expect(input).toHaveAttribute(
                "placeholder",
                "What would you like to investigate?",
            );
            await expect(
                page.getByRole("button", {
                    name: "Start research",
                    exact: true,
                }),
            ).toHaveCount(0);
            await input.fill("Who can change the claims routing rules?");
            const add = page.getByRole("button", {
                name: "Add question",
                exact: true,
            });
            await expect(add).toBeVisible();
            await expect(
                page.getByRole("button", { name: "Cancel", exact: true }),
            ).toBeVisible();
            expect(
                await add.evaluate(
                    (button) => button.scrollWidth <= button.clientWidth,
                ),
            ).toBe(true);
            await page.screenshot({
                path: `/tmp/question-entry-${theme}-${width}.png`,
            });
            await add.click();
            await expect(
                page.getByRole("heading", {
                    name: "Who can change the claims routing rules?",
                    exact: true,
                }),
            ).toBeVisible();
            await expect(ordinary).toHaveValue("Keep my ordinary draft.");
            await reviewResearchProgram(page);
            await page
                .getByRole("button", {
                    name: "Add research question",
                    exact: true,
                })
                .click();
            await input.fill("Discard this question");
            await page
                .getByRole("button", { name: "Cancel", exact: true })
                .click();
            await expect(ordinary).toHaveValue("Keep my ordinary draft.");
            await expect(
                page.getByRole("button", {
                    name: "Add research question",
                    exact: true,
                }),
            ).toBeFocused();
            expect(errors).toEqual([]);
        });
