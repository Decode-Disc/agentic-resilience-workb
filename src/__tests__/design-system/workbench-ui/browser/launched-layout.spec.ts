import { expect, test } from "@playwright/test";

for (const width of [320, 390, 768]) {
    test(`mobile launched opens conversation from Ask AI and retains the reader at ${width}px`, async ({
        page,
    }) => {
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.setViewportSize({ width, height: 844 });
        await page.emulateMedia({
            reducedMotion: width === 390 ? "no-preference" : "reduce",
        });
        await page.goto(
            `/?layout=start&screen=launched&theme=${width === 390 ? "dark" : "light"}`,
        );
        const progress = page.getByRole("region", {
            name: "Documentary progress",
            exact: true,
        });
        await expect(progress).toBeVisible();
        await expect(
            page.getByRole("button", { name: "Research context", exact: true }),
        ).toHaveCount(0);
        await expect(
            page.getByRole("tablist", { name: "Research view" }),
        ).toHaveCount(0);
        const trigger = page.getByRole("button", {
            name: "Ask AI",
            exact: true,
        });
        await trigger.focus();
        await page.keyboard.press("Enter");
        const dialog = page.getByRole("dialog", {
            name: "Conversation",
            exact: true,
        });
        await expect(dialog).toBeVisible();
        const input = dialog.getByRole("textbox", {
            name: "Ask about the sources",
        });
        await input.fill(
            Array.from(
                { length: 60 },
                (_, index) =>
                    `Inspect coordination point ${index + 1} and the carrier's control of this workflow.`,
            ).join("\n"),
        );
        await dialog
            .getByRole("button", { name: "Send refinement", exact: true })
            .click();
        await input.fill("Keep this question while I inspect the progress.");
        const back = dialog.getByRole("button", {
            name: "Back to progress",
            exact: true,
        });
        await back.focus();
        const viewport = dialog.getByRole("region", {
            name: "Conversation scroll area",
        });
        await viewport.evaluate((node) => {
            node.scrollTop = 100;
            node.dispatchEvent(new Event("scroll"));
        });
        await back.click();
        await expect(dialog).toBeHidden();
        await expect(trigger).toBeFocused();
        await expect(progress).toBeVisible();
        await trigger.click();
        await expect(input).toHaveValue(
            "Keep this question while I inspect the progress.",
        );
        await expect
            .poll(() =>
                viewport.evaluate(
                    (node) =>
                        node.scrollHeight - node.clientHeight - node.scrollTop,
                ),
            )
            .toBeLessThanOrEqual(2);
        if (width === 390) {
            await viewport.evaluate((node) => {
                node.scrollTop = 100;
                node.dispatchEvent(new Event("scroll"));
            });
            const readingAnchor = page.getByText(
                "I can help frame this research before it starts.",
                { exact: true },
            );
            await readingAnchor.scrollIntoViewIfNeeded();
            await expect(readingAnchor).toBeInViewport();
            await page.setViewportSize({ width: 1440, height: 1000 });
            await expect(readingAnchor).toBeInViewport();
            await expect(
                page.getByRole("textbox", { name: "Ask about the sources" }),
            ).toHaveValue("Keep this question while I inspect the progress.");
            await page.setViewportSize({ width, height: 844 });
            await expect(dialog).toBeVisible();
            await expect(readingAnchor).toBeInViewport();
            await expect(input).toHaveValue(
                "Keep this question while I inspect the progress.",
            );
        }
        const contextTrigger = dialog.getByRole("button", {
            name: "Research context",
            exact: true,
        });
        await expect(contextTrigger).toHaveAttribute("aria-expanded", "false");
        await contextTrigger.click();
        await expect(
            page.getByRole("region", { name: "Scope", exact: true }),
        ).toBeVisible();
        await page
            .getByRole("button", {
                name: "Close research context",
                exact: true,
            })
            .click();
        await page.keyboard.press("Escape");
        await expect(dialog).toBeHidden();
        await expect(trigger).toBeFocused();
        expect(
            await page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth,
            ),
        ).toBe(true);
        expect(errors).toEqual([]);
    });
}

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
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Ask AI", exact: true }).click();
    await expect(context).toHaveAttribute("aria-expanded", "true");
    await page.setViewportSize({ width: 1440, height: 1000 });
    await expect(context).toHaveAttribute("aria-expanded", "true");
    // The 40% desktop split uses a compact anchored popover.
    await expect(context).toHaveAttribute("data-context-layout", "popover");
    await page.setViewportSize({ width: 2800, height: 1000 });
    await expect(context).toHaveAttribute("data-context-layout", "side");
    await expect
        .poll(async () => {
            const reading = await page
                .getByRole("region", { name: "Conversation scroll area" })
                .boundingBox();
            const panel = await page
                .locator(".chat-context-card")
                .boundingBox();
            return (
                !!reading && !!panel && reading.x + reading.width <= panel.x + 1
            );
        })
        .toBe(true);
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

test("conversation stays on the left and retains its draft across resizing", async ({
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
    const progressBounds = await page
        .getByRole("region", { name: "Documentary progress" })
        .boundingBox();
    expect(
        before && progressBounds && before.x + before.width <= progressBounds.x,
    ).toBe(true);
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
    await page.getByRole("button", { name: "Ask AI", exact: true }).click();
    await expect(input).toHaveValue(
        "Keep this question while I inspect the material.",
    );
    await expect(separator).not.toBeVisible();
    await page
        .getByRole("button", { name: "Back to progress", exact: true })
        .click();
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

for (const width of [1440, 1024, 390]) {
    test(`coverage gaps are visible with the summary before documents ${width}`, async ({
        page,
    }) => {
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.setViewportSize({
            width,
            height: width === 390 ? 844 : 900,
        });
        await page.goto("/?layout=start&screen=launched&theme=light");
        const progress = page.getByRole("region", {
            name: "Documentary progress",
            exact: true,
        });
        const gaps = progress.getByRole("region", {
            name: "Coverage gaps",
            exact: true,
        });
        const toggle = gaps.getByRole("button", {
            name: "Coverage gaps · 2",
            exact: true,
        });
        await expect(toggle).toBeInViewport();
        await expect(toggle).toHaveAttribute("aria-expanded", "true");
        await expect(gaps.getByRole("listitem")).toHaveCount(2);
        await expect(
            gaps.getByText("No matching material found in this search.", {
                exact: true,
            }),
        ).toBeInViewport();
        await expect(
            gaps.getByText("Search could not be completed.", { exact: true }),
        ).toBeInViewport();
        const firstDocument = progress.getByText("Repair networks and claims", {
            exact: true,
        });
        await expect
            .poll(async () => {
                const gapBounds = await gaps.boundingBox();
                const documentBounds = await firstDocument.boundingBox();
                return gapBounds && documentBounds
                    ? gapBounds.y + gapBounds.height <= documentBounds.y
                    : false;
            })
            .toBe(true);
        await toggle.focus();
        await page.keyboard.press("Enter");
        await expect(toggle).toHaveAttribute("aria-expanded", "false");
        await expect(gaps.getByRole("listitem")).toHaveCount(0);
        await expect(toggle).toBeFocused();
        await page.keyboard.press("Space");
        await expect(toggle).toHaveAttribute("aria-expanded", "true");
        await expect(gaps.getByRole("listitem")).toHaveCount(2);
        expect(errors).toEqual([]);
    });
}
