import { expect, test } from "@playwright/test";

test("the framing panel receives pointer input above overlapping conversation work", async ({
    page,
}) => {
    await page.setViewportSize({ width: 1440, height: 440 });
    await page.goto("/?layout=start&screen=framing&theme=dark");
    await page
        .getByRole("button", { name: "Close research context", exact: true })
        .click();
    await page
        .getByRole("region", { name: "Conversation scroll area" })
        .evaluate((node) => {
            node.scrollTop = 0;
            node.dispatchEvent(new Event("scroll"));
        });
    const activity = await page
        .getByRole("button", {
            name: "Inspect framing preparation",
            exact: true,
        })
        .boundingBox();
    const panel = await page
        .getByRole("region", { name: "Proposed framing", exact: true })
        .boundingBox();
    if (!activity || !panel) throw new Error("Missing framing surface");
    const point = {
        x: Math.max(activity.x, panel.x) + 20,
        y: Math.max(activity.y, panel.y) + 8,
    };
    expect(point.y).toBeLessThan(
        Math.min(activity.y + activity.height, panel.y + panel.height),
    );
    expect(
        await page.evaluate(
            ({ x, y }) =>
                Boolean(
                    document
                        .elementFromPoint(x, y)
                        ?.closest('[aria-label="Proposed framing"]'),
                ),
            point,
        ),
    ).toBe(true);
});

test("context disclosures stay usable while their details scroll under the close action", async ({
    page,
}) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width: 390, height: 600 });
    await page.goto("/?layout=start&screen=framing&theme=light");
    await page
        .getByRole("button", { name: "Research context", exact: true })
        .click();
    const details = page.getByRole("region", {
        name: "Research context details",
        exact: true,
    });
    const close = page.getByRole("button", {
        name: "Close research context",
        exact: true,
    });
    const card = page.getByRole("dialog").filter({ has: close });
    await expect(close).toBeVisible();
    const plan = details.getByRole("button", {
        name: "Inspect research plan",
        exact: true,
    });
    await expect(plan).toHaveAttribute("aria-expanded", "false");
    await plan.focus();
    await page.keyboard.press("Enter");
    await expect(plan).toHaveAttribute("aria-expanded", "true");
    await details
        .getByRole("button", {
            name: "Inspect reference: Investor day 2025 deck",
            exact: true,
        })
        .click();
    await details
        .getByRole("button", { name: "Completed work", exact: true })
        .click();
    await expect
        .poll(() =>
            details.evaluate((node) => node.scrollHeight > node.clientHeight),
        )
        .toBe(true);
    const before = await close.boundingBox();
    const cardBefore = await card.boundingBox();
    await details.evaluate((node) => {
        node.scrollTop = node.scrollHeight;
    });
    await expect(
        details.getByText("Prepare research framing", { exact: true }),
    ).toBeVisible();
    const after = await close.boundingBox();
    const cardAfter = await card.boundingBox();
    expect(
        before &&
            after &&
            cardBefore &&
            cardAfter &&
            Math.abs(before.y - cardBefore.y - (after.y - cardAfter.y)),
    ).toBeLessThan(1);
    await expect(close).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(
        page.getByRole("button", { name: "Research context", exact: true }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(errors).toEqual([]);
});
