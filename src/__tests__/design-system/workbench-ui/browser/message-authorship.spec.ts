import { expect, test } from "@playwright/test";

for (const screen of ["framing", "launched"] as const) {
    for (const width of [1440, 390]) {
        test(`${screen} messages retain accessible authors without repeating visible names ${width}`, async ({
            page,
        }) => {
            await page.setViewportSize({
                width,
                height: width === 390 ? 844 : 1000,
            });
            await page.goto(`/?layout=start&screen=${screen}&theme=light`);
            if (screen === "launched" && width === 390) {
                await page
                    .getByRole("button", { name: "Ask AI", exact: true })
                    .click();
            }
            const log = page.getByRole("log");
            await expect(
                log.getByRole("article", {
                    name: "Workbench Agent message",
                    exact: true,
                }),
            ).toHaveCount(1);
            await expect(
                log.getByText("Workbench", { exact: true }),
            ).toHaveCount(0);
            await expect(
                log.getByText("Workbench Agent", { exact: true }),
            ).toHaveCount(0);
            if (screen === "framing") {
                if (width === 390)
                    await page
                        .getByRole("button", {
                            name: "Research context",
                            exact: true,
                        })
                        .click();
                await page
                    .getByRole("button", { name: "Change scope", exact: true })
                    .click();
                await page
                    .getByRole("button", { name: "Continue", exact: true })
                    .click();
                await expect(
                    log.getByRole("article", {
                        name: "Workbench Agent message",
                        exact: true,
                    }),
                ).toHaveCount(2);
                await expect(
                    log.getByText("Workbench Agent", { exact: true }),
                ).toHaveCount(0);
            }
        });
    }
}
