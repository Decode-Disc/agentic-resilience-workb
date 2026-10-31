import { expect, test } from "@playwright/test";

test("launched context starts closed and retains the analyst's choice during work updates", async ({
    page,
}) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/?layout=start&screen=launched&theme=light");
    const context = page.getByRole("button", {
        name: "Research context",
        exact: true,
    });
    await expect(context).toHaveAttribute("aria-expanded", "false");
    await context.click();
    await page
        .getByRole("button", { name: "Preview tools", exact: true })
        .click();
    await page
        .getByRole("button", { name: "Advance illustrative work", exact: true })
        .click();
    await page
        .getByRole("button", { name: "Preview tools", exact: true })
        .click();
    await expect(context).toHaveAttribute("aria-expanded", "true");
    await expect(
        page.getByRole("region", { name: "Work", exact: true }),
    ).toContainText("Find product and integration documentation");
    await page
        .getByRole("button", { name: "Close research context", exact: true })
        .click();
    await page
        .getByRole("button", { name: "Preview tools", exact: true })
        .click();
    await page
        .getByRole("button", { name: "Finish illustrative work", exact: true })
        .click();
    await page
        .getByRole("button", { name: "Preview tools", exact: true })
        .click();
    await expect(context).toHaveAttribute("aria-expanded", "false");
});

test("conversation and progress resize without replacing the composer or losing its draft", async ({
    page,
}) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/?layout=start&screen=launched&theme=dark");
    const input = page.getByRole("textbox", {
        name: "Ask about the sources",
        exact: true,
    });
    await input.fill("Keep this question while I inspect the material.");
    const conversation = page.getByRole("complementary", {
        name: "Conversation",
        exact: true,
    });
    const before = await conversation.boundingBox();
    const separator = page.getByRole("separator", {
        name: "Resize conversation and progress",
        exact: true,
    });
    await separator.focus();
    await page.keyboard.press("ArrowRight");
    await expect
        .poll(async () => (await conversation.boundingBox())?.width ?? 0)
        .toBeGreaterThan(before?.width ?? 0);
    const handle = await separator.boundingBox();
    if (!handle) throw new Error("Missing resize handle");
    await page.mouse.move(
        handle.x + handle.width / 2,
        handle.y + handle.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(handle.x - 120, handle.y + handle.height / 2, {
        steps: 5,
    });
    await page.mouse.up();
    await expect
        .poll(async () => (await conversation.boundingBox())?.width ?? 0)
        .toBeLessThan(before?.width ?? 0);
    const resized = await conversation.boundingBox();
    await expect(input).toHaveValue(
        "Keep this question while I inspect the material.",
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("tab", { name: "Conversation", exact: true }).click();
    await expect(input).toHaveValue(
        "Keep this question while I inspect the material.",
    );
    await expect(separator).not.toBeVisible();
    await page.getByRole("tab", { name: "Progress", exact: true }).click();
    await expect(page.getByRole("textbox")).not.toBeVisible();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await expect(separator).toBeVisible();
    await expect
        .poll(async () =>
            Math.abs(
                ((await conversation.boundingBox())?.width ?? 0) -
                    (resized?.width ?? 0),
            ),
        )
        .toBeLessThan(2);
    await expect(input).toHaveValue(
        "Keep this question while I inspect the material.",
    );
    expect(errors).toEqual([]);
});

for (const width of [1024, 390]) {
    test(`coverage gaps follow the documents without overlap ${width}`, async ({
        page,
    }) => {
        await page.setViewportSize({
            width,
            height: width === 390 ? 844 : 768,
        });
        await page.goto("/?layout=start&screen=launched&theme=light");
        // The gallery's document grid precedes the coverage section in the same scroll region.
        await expect
            .poll(() =>
                page
                    .locator(".start-preview-limitations")
                    .evaluate((limits) => {
                        const grid = limits.previousElementSibling;
                        if (!grid) return false;
                        return [...grid.children].every(
                            (lane) =>
                                lane.getBoundingClientRect().bottom <=
                                limits.getBoundingClientRect().top,
                        );
                    }),
            )
            .toBe(true);
        const gaps = page.getByRole("region", {
            name: "Coverage gaps",
            exact: true,
        });
        await gaps.scrollIntoViewIfNeeded();
        await expect(gaps.getByRole("listitem")).toHaveCount(2);
        await expect(gaps).toContainText("No results found");
        await expect(gaps).toContainText("Search unavailable");
        await expect(gaps).not.toContainText("never as irrelevance");
    });
}
