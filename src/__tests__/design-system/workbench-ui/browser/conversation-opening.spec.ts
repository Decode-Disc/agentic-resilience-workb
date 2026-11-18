import { expect, test } from "@playwright/test";

for (const width of [390, 1440]) {
    test(`dossier context keeps compact disclosures and usable controls at ${width}px`, async ({
        page,
    }) => {
        await page.setViewportSize({ width, height: 844 });
        await page.goto("/?layout=start&screen=framing&theme=dark");
        const trigger = page.getByRole("button", {
            name: "Research context",
            exact: true,
        });
        if ((await trigger.getAttribute("aria-expanded")) !== "true")
            await trigger.click();
        const context = page.locator(".chat-context-card");
        await expect(context).toBeVisible();
        await expect(
            context.getByRole("region", { name: "Outputs", exact: true }),
        ).toHaveCount(0);
        await expect(
            context.getByRole("region", {
                name: "Proposed research program",
                exact: true,
            }),
        ).toBeVisible();
        const showSources = context.getByRole("button", {
            name: "Show sources",
            exact: true,
        });
        await showSources.click();
        await expect(showSources).toHaveAttribute("aria-expanded", "true");
        await expect(
            context.getByRole("button", { name: /^Inspect reference:/ }),
        ).toBeVisible();
        const box = await context.boundingBox();
        expect(box).not.toBeNull();
        if (box) expect(box.height).toBeLessThan(600);
        await context
            .getByRole("button", { name: "Close research context" })
            .click();
        await expect(trigger).toBeFocused();
        await expect(context).toBeHidden();
    });
}

test("reopening a conversation goes to its latest messages and retains the draft", async ({
    page,
}) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/?layout=start&screen=launched&theme=dark");
    await page.getByRole("button", { name: "Ask AI", exact: true }).click();
    const input = page.getByRole("textbox", { name: "Ask about the sources" });
    await input.fill(
        Array.from(
            { length: 45 },
            (_, i) => `Inspect documentary contribution ${i + 1}.`,
        ).join("\n"),
    );
    await page
        .getByRole("button", { name: "Send refinement", exact: true })
        .click();
    await input.fill("Keep this draft.");
    const viewport = page.getByRole("region", {
        name: "Conversation scroll area",
        exact: true,
    });
    await viewport.evaluate((node) => {
        node.scrollTop = 0;
        node.dispatchEvent(new Event("scroll"));
    });
    await page
        .getByRole("button", { name: "Back to progress", exact: true })
        .click();
    await page.getByRole("button", { name: "Ask AI", exact: true }).click();
    await expect(input).toHaveValue("Keep this draft.");
    await expect
        .poll(() =>
            viewport.evaluate(
                (node) =>
                    node.scrollHeight - node.clientHeight - node.scrollTop,
            ),
        )
        .toBeLessThanOrEqual(2);
});
