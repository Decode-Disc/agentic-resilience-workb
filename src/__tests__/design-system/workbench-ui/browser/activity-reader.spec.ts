import { expect, type Locator, test } from "@playwright/test";

for (const width of [1440, 1024, 768, 390, 320]) {
    test(`agent activity stays compact and preserves continuous reading at ${width}px`, async ({
        page,
    }) => {
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.setViewportSize({
            width,
            height: width === 390 ? 844 : 1000,
        });
        await page.addInitScript(() => {
            const failures: string[] = [];
            Object.defineProperty(window, "activityReaderErrors", {
                value: failures,
            });
            window.addEventListener("error", (event) =>
                failures.push(event.message),
            );
        });
        await page.goto("/?component=AgentActivity&theme=dark");
        const sources = page.getByRole("region", {
            name: "Sources Agent · Documentary preparation",
            exact: true,
        });
        const trigger = sources.getByRole("button", {
            name: "Inspect Sources Agent mission: Documentary preparation",
        });
        await expect(trigger).toHaveAttribute("aria-expanded", "false");
        await expect(
            sources.getByRole("region", { name: "Agent activities" }),
        ).toBeHidden();
        const heading = await trigger.boundingBox();
        const latest = await sources
            .getByRole("button", {
                name: "Inspect Inspect documentary material 200",
                exact: true,
            })
            .boundingBox();
        if (!heading || !latest)
            throw new Error("The compact mission is not visible");
        expect(latest.y).toBeGreaterThanOrEqual(heading.y + heading.height);
        await trigger.click();
        const reader = sources.getByRole("region", {
            name: "Agent activities",
        });
        await expect(reader).toBeVisible();
        const endDistance = () =>
            reader.evaluate(
                (node) =>
                    node.scrollHeight - node.clientHeight - node.scrollTop,
            );
        await expect.poll(endDistance).toBeLessThan(2);
        await expect(
            sources.getByText("Inspect documentary material 200", {
                exact: true,
            }),
        ).toBeVisible();
        expect(
            await reader.locator('[data-slot="conversation-activity"]').count(),
        ).toBeLessThan(25);
        await page
            .getByRole("button", { name: "Record next activity", exact: true })
            .click();
        await expect(
            sources.getByText("Inspect documentary material 201", {
                exact: true,
            }),
        ).toBeVisible();
        await expect.poll(endDistance).toBeLessThan(2);
        await reader.evaluate((node) => {
            node.scrollTop = 0;
        });
        await expect(
            sources.getByText("Inspect documentary material 1", {
                exact: true,
            }),
        ).toBeVisible();
        await page
            .getByRole("button", { name: "Record next activity", exact: true })
            .click();
        await expect
            .poll(() => reader.evaluate((node) => node.scrollTop))
            .toBeLessThan(2);
        await expect(
            sources.getByText("Inspect documentary material 1", {
                exact: true,
            }),
        ).toBeVisible();
        // Preserve a real measured row and its viewport offset when the bounded recent window advances.
        await reader.evaluate((node) => {
            node.scrollTop = 300;
        });
        const inspectedRow = await visibleActivity(reader);
        const anchor = reader.getByRole("button", {
            name: inspectedRow.label,
            exact: true,
        });
        await page
            .getByRole("button", { name: "Advance recent window", exact: true })
            .click();
        await expect
            .poll(() => relativeTop(anchor, reader))
            .toBeCloseTo(inspectedRow.offset, 0);
        await anchor.click();
        await expect(
            reader.getByText(
                `Illustrative retained passage for material ${inspectedRow.label.split(" ").at(-1)}.`,
                { exact: false },
            ),
        ).toBeVisible();
        await anchor.focus();
        await reader.evaluate((node) => {
            node.scrollTop = node.scrollHeight;
        });
        await expect(anchor).toBeFocused();
        await page
            .getByRole("button", { name: "Revise latest result", exact: true })
            .click();
        await expect(
            sources.getByText(
                "Updated retained result. Documentary limitations remain explicit.",
            ),
        ).toBeVisible();
        await reader.focus();
        await page.keyboard.press("Home");
        await expect
            .poll(() => reader.evaluate((node) => node.scrollTop))
            .toBeLessThan(2);
        await page.keyboard.press("End");
        await expect.poll(endDistance).toBeLessThan(2);
        await page.screenshot({
            path: `/tmp/activity-reader-after-${width}.png`,
        });
        const bounds = await reader.boundingBox();
        if (!bounds)
            throw new Error("The activity reader has no visible bounds");
        expect(bounds.height).toBeLessThanOrEqual(300);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
        await reader.evaluate((node) => {
            node.scrollTop = 450;
        });
        await reader.getByRole("button").first().waitFor();
        const retained = await visibleActivity(reader);
        await trigger.click();
        await page
            .getByRole("button", { name: "Record next activity", exact: true })
            .click();
        await trigger.click();
        await expect
            .poll(() =>
                relativeTop(
                    reader.getByRole("button", {
                        name: retained.label,
                        exact: true,
                    }),
                    reader,
                ),
            )
            .toBeCloseTo(retained.offset, 0);
        const workbench = page.getByRole("region", {
            name: "Workbench Agent · Inspect dossier",
            exact: true,
        });
        await expect(
            workbench.getByRole("button", {
                name: "Inspect Workbench Agent mission: Inspect dossier",
            }),
        ).toHaveAttribute("aria-expanded", "false");
        await page
            .getByRole("button", {
                name: "Finish illustrative work",
                exact: true,
            })
            .click();
        await expect(trigger).toHaveAttribute("aria-expanded", "false");
        expect(errors).toEqual([]);
        expect(
            await page.evaluate(() =>
                Reflect.get(window, "activityReaderErrors"),
            ),
        ).toEqual([]);
    });
}

async function visibleActivity(reader: Locator) {
    const inspect = () =>
        reader.getByRole("button").evaluateAll((buttons) => {
            const viewport = buttons[0]
                ?.closest('[aria-label="Agent activities"]')
                ?.getBoundingClientRect();
            if (!viewport) return null;
            const button = buttons.find((button) => {
                const rect = button.getBoundingClientRect();
                return rect.top >= viewport.top && rect.top < viewport.bottom;
            });
            const label = button?.getAttribute("aria-label");
            return button && label
                ? {
                      label,
                      offset: button.getBoundingClientRect().top - viewport.top,
                  }
                : null;
        });
    await expect.poll(inspect).not.toBeNull();
    const anchor = await inspect();
    if (!anchor) throw new Error("No activity is visible in the reader");
    return anchor;
}
async function relativeTop(activity: Locator, reader: Locator) {
    const item = await activity.boundingBox();
    const viewport = await reader.boundingBox();
    return item && viewport ? item.y - viewport.y : Infinity;
}
