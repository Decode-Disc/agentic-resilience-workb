import { expect, test } from "@playwright/test";
import { reviewResearchProgram } from "@/__tests__/helpers/research-program";

test("the framing dock receives pointer input beside conversation work in a short viewport", async ({
    page,
}) => {
    await page.setViewportSize({ width: 1440, height: 440 });
    await page.goto("/?layout=start&screen=framing&theme=dark");
    await page
        .getByRole("button", { name: "Close research context", exact: true })
        .click();
    await reviewResearchProgram(page);
    const edit = page.getByRole("button", {
        name: "Edit question",
        exact: true,
    });
    await edit.scrollIntoViewIfNeeded();
    const bounds = await edit.boundingBox();
    if (!bounds) throw new Error("Missing framing edit control");
    expect(
        await page.evaluate(
            ({ x, y }) =>
                document
                    .elementFromPoint(x, y)
                    ?.closest("button")
                    ?.getAttribute("aria-label"),
            {
                x: bounds.x + bounds.width / 2,
                y: bounds.y + bounds.height / 2,
            },
        ),
    ).toBe("Edit question");
    await edit.click();
    await expect(
        page.getByRole("textbox", {
            name: "Edit research question",
            exact: true,
        }),
    ).toBeFocused();
});

test("context navigation stays usable while details scroll under the close action", async ({
    page,
}) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width: 390, height: 360 });
    await page.goto("/?layout=start&screen=framing&theme=light");
    const trigger = page.getByRole("button", {
        name: "Research context",
        exact: true,
    });
    await trigger.click();
    const details = page.getByRole("region", {
        name: "Research context details",
        exact: true,
    });
    const close = page.getByRole("button", {
        name: "Close research context",
        exact: true,
    });
    const card = page.getByRole("dialog").filter({ has: close });
    const plan = details.getByRole("button", {
        name: "Research program",
        exact: true,
    });
    await plan.focus();
    await page.keyboard.press("Enter");
    await expect(
        details.getByRole("region", { name: "Plan", exact: true }),
    ).toBeVisible();
    await page
        .getByRole("button", { name: "Back to research context", exact: true })
        .click();
    await expect(plan).toBeFocused();
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
    const after = await close.boundingBox();
    const cardAfter = await card.boundingBox();
    if (!before || !after || !cardBefore || !cardAfter)
        throw new Error("Missing context geometry");
    expect(
        Math.abs(before.y - cardBefore.y - (after.y - cardAfter.y)),
    ).toBeLessThan(1);
    await expect(close).toBeInViewport();
    await page.keyboard.press("Escape");
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(errors).toEqual([]);
});
