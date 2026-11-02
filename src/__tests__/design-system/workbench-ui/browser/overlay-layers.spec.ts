import { expect, test } from "@playwright/test";

for (const width of [390, 1440]) {
    for (const kind of ["drawer", "sheet", "dialog"]) {
        test(`${kind} isolates background context and keeps its own popup usable at ${width}`, async ({
            page,
        }) => {
            const errors: string[] = [];
            page.on("pageerror", (e) => errors.push(e.message));
            await page.setViewportSize({ width, height: 1000 });
            await page.goto("/?component=OverlayLayers&theme=light");
            await page
                .getByRole("combobox", { name: "Modal type" })
                .selectOption(kind);
            await page
                .getByRole("button", { name: "Open modal", exact: true })
                .click();
            const modal = page.getByRole("dialog", {
                name: "Access verification",
                exact: true,
            });
            await expect(modal).toBeVisible();
            const backdrop = page.locator(
                `[data-slot="${kind === "dialog" ? "dialog-overlay" : kind === "sheet" ? "sheet-overlay" : "drawer-overlay"}"]`,
            );
            const context = page.getByRole("heading", {
                name: "Background research context",
                includeHidden: true,
            });
            const backgroundZ = await context.evaluate((node) => {
                let highest = 0;
                for (
                    let current: Element | null = node;
                    current;
                    current = current.parentElement
                ) {
                    const z = Number(getComputedStyle(current).zIndex);
                    if (Number.isFinite(z)) highest = Math.max(highest, z);
                }
                return highest;
            });
            const backdropZ = await backdrop.evaluate((node) =>
                Number(getComputedStyle(node).zIndex),
            );
            expect(backgroundZ).toBeLessThan(backdropZ);
            await modal
                .getByRole("button", { name: "Modal options", exact: true })
                .click();
            const option = page.getByRole("button", {
                name: "Choose option",
                exact: true,
            });
            await expect(option).toBeVisible();
            await expect
                .poll(() =>
                    option.evaluate((node) => {
                        const r = node.getBoundingClientRect();
                        return node.contains(
                            document.elementFromPoint(
                                r.x + r.width / 2,
                                r.y + r.height / 2,
                            ),
                        );
                    }),
                )
                .toBe(true);
            await option.click();
            await page.keyboard.press("Escape");
            await expect(
                page.getByRole("button", {
                    name: "Modal options",
                    exact: true,
                }),
            ).toBeFocused();
            await page.keyboard.press("Escape");
            await expect(modal).toBeHidden();
            expect(errors).toEqual([]);
        });
    }
}

test("nested modals keep their own popup above the entire parent modal", async ({
    page,
}) => {
    await page.goto("/?component=OverlayLayers&theme=dark");
    await page.getByRole("button", { name: "Open modal", exact: true }).click();
    await page
        .getByRole("button", { name: "Open nested modal", exact: true })
        .click();
    const nested = page.getByRole("dialog", {
        name: "Nested verification",
        exact: true,
    });
    await expect(nested).toBeVisible();
    await nested
        .getByRole("button", { name: "Nested options", exact: true })
        .click();
    const option = page.getByRole("button", {
        name: "Choose nested option",
        exact: true,
    });
    await expect
        .poll(() =>
            option.evaluate((node) => {
                const r = node.getBoundingClientRect();
                return node.contains(
                    document.elementFromPoint(
                        r.x + r.width / 2,
                        r.y + r.height / 2,
                    ),
                );
            }),
        )
        .toBe(true);
    await option.click();
    await page.keyboard.press("Escape");
    await expect(
        nested.getByRole("button", { name: "Nested options", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(nested).toBeHidden();
    await expect(
        page.getByRole("dialog", { name: "Access verification", exact: true }),
    ).toBeVisible();
});
