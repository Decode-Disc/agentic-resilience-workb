import { expect, test } from "@playwright/test";

for (const width of [1440, 390])
    for (const theme of ["light", "dark"])
        test(`attached program and compact composer ${theme} ${width}`, async ({
            page,
        }) => {
            const errors: string[] = [];
            page.on("pageerror", (error) => errors.push(error.message));
            await page.setViewportSize({
                width,
                height: width === 390 ? 844 : 1000,
            });
            await page.emulateMedia({
                reducedMotion: width === 390 ? "reduce" : "no-preference",
            });
            await page.goto(
                `/?component=Composer&program=empty&theme=${theme}`,
            );
            const input = page.getByRole("textbox", {
                name: "Message",
                exact: true,
            });
            const program = page.getByRole("region", {
                name: "Proposed framing",
                exact: true,
            });
            await expect(
                program.getByText("No questions yet", { exact: true }),
            ).toBeVisible();
            await expect(
                program.getByRole("button", {
                    name: "Start research",
                    exact: true,
                }),
            ).toHaveCount(0);
            await expect(
                page.getByRole("button", {
                    name: "Composer tools",
                    exact: true,
                }),
            ).toBeVisible();
            await input.scrollIntoViewIfNeeded();
            await page.screenshot({
                path: `/tmp/composer-program-empty-${theme}-${width}.png`,
            });
            await program
                .getByRole("button", {
                    name: "Add research question",
                    exact: true,
                })
                .click();
            await page
                .getByRole("textbox", {
                    name: "Add research question",
                    exact: true,
                })
                .fill(
                    "Does CCC control coordination, or supply replaceable modules?",
                );
            await page
                .getByRole("button", { name: "Add question", exact: true })
                .click();
            const question = program.getByRole("heading", {
                name: "Does CCC control coordination, or supply replaceable modules?",
                exact: true,
            });
            await expect(question).toBeVisible();
            await expect(
                program.getByRole("button", {
                    name: "Start research",
                    exact: true,
                }),
            ).toBeVisible();
            await input.scrollIntoViewIfNeeded();
            await page.screenshot({
                path: `/tmp/composer-program-ready-${theme}-${width}.png`,
            });
            await input.fill("Focus on who sets the rules of the workflow.");
            await expect(question).toBeVisible();
            await expect(
                page.getByRole("button", {
                    name: "Workbench model and effort",
                    exact: true,
                }),
            ).toBeVisible();
            await page
                .getByRole("button", { name: "Composer tools", exact: true })
                .click();
            await expect(input).toHaveValue(
                "Focus on who sets the rules of the workflow.",
            );
            await page.keyboard.press("Escape");
            await input.focus();
            await page.waitForTimeout(250);
            await page.screenshot({
                path: `/tmp/composer-program-focused-${theme}-${width}.png`,
            });
            expect(
                await page.evaluate(
                    () => document.documentElement.scrollWidth <= innerWidth,
                ),
            ).toBe(true);
            expect(errors).toEqual([]);
        });
