import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const fixture = `/@fs${resolve(
    process.cwd(),
    "src/__tests__/design-system/workbench-ui/fixtures/smooth-dropdown.html",
)}`;

for (const portal of [false, true]) {
    for (const align of ["start", "center", "end"] as const) {
        test(`${portal ? "portalled" : "inline"} dropdown aligns ${align} and stays reachable on resize`, async ({
            page,
        }) => {
            const errors: string[] = [];
            page.on("pageerror", (error) => errors.push(error.message));
            await page.setViewportSize({ width: 1440, height: 900 });
            await page.goto(`${fixture}?align=${align}&portal=${portal}`);
            await expect(
                page.getByRole("option", { name: "First dossier" }),
            ).toBeVisible();
            const anchor = page.getByTestId("smooth-dropdown-container");
            const menu = page.getByTestId("smooth-dropdown-menu");
            expect(
                await anchor.evaluate(
                    (node, portalled) =>
                        node.contains(
                            document.querySelector(
                                '[data-testid="smooth-dropdown-menu"]',
                            ),
                        ) === !portalled,
                    portal,
                ),
            ).toBe(true);
            for (const width of [1440, 390]) {
                await page.setViewportSize({ width, height: 900 });
                await expect(menu).toBeInViewport({ ratio: 1 });
                await expect
                    .poll(async () => {
                        const [a, m] = await Promise.all([
                            anchor.boundingBox(),
                            menu.boundingBox(),
                        ]);
                        if (!a || !m) return Number.POSITIVE_INFINITY;
                        if (align === "start") return Math.abs(m.x - a.x);
                        if (align === "end")
                            return Math.abs(m.x + m.width - a.x - a.width);
                        return Math.abs(m.x + m.width / 2 - a.x - a.width / 2);
                    })
                    .toBeLessThanOrEqual(1);
                await page
                    .getByRole("option", { name: "First dossier" })
                    .click({ trial: true });
            }
            expect(errors).toEqual([]);
        });
    }
}
