import { expect, test } from "@playwright/test";

for (const [width, height] of [
    [414, 400],
    [1440, 400],
    [414, 896],
    [1440, 896],
] as const) {
    test(`a collapsed mission cannot intercept the conversation composer at ${width}x${height}`, async ({
        page,
    }) => {
        await page.setViewportSize({ width, height });
        await page.goto("/?layout=start&screen=launched&theme=light");
        await page
            .getByRole("button", { name: "Preview tools", exact: true })
            .click();
        await page
            .getByRole("button", {
                name: "Finish illustrative work",
                exact: true,
            })
            .click();
        await page.keyboard.press("Escape");
        if (width === 414)
            await page
                .getByRole("button", { name: "Ask AI", exact: true })
                .click();
        const composer = page.getByRole("textbox", {
            name: "Ask about the sources",
            exact: true,
        });
        await composer.fill(
            "Do not restart or change the research.\nWhat usable documentary material is available,\nand what remains unfinished?",
        );
        const mission = page.getByRole("button", {
            name: "Inspect Sources Agent mission: Documentary preparation",
            exact: true,
        });
        await expect(mission).toBeVisible();
        const send = page.getByRole("button", {
            name: "Send refinement",
            exact: true,
        });
        const scroll = page.getByRole("region", {
            name: "Conversation scroll area",
            exact: true,
        });
        const scrollBox = await scroll.boundingBox();
        const composerBox = await page
            .getByRole("form", { name: "Message the workbench" })
            .boundingBox();
        await page.screenshot({
            path: `/tmp/chat-scroll-clearance-${width}-${height}.png`,
        });
        if (!scrollBox || !composerBox)
            throw new Error("Conversation and composer must be visible");
        expect(scrollBox.y + scrollBox.height).toBeLessThan(composerBox.y);
        await send.click({ timeout: 3000 });
        await expect(composer).toHaveValue("");
        await expect(
            page.getByText(
                "Request recorded in this preview; freeform interpretation is not connected.",
                { exact: true },
            ),
        ).toBeVisible();
        await mission.focus();
        await page.keyboard.press("Enter");
        await expect(
            page
                .getByRole("region", {
                    name: "Sources Agent · Documentary preparation",
                    exact: true,
                })
                .getByText("Find company reporting", { exact: true }),
        ).toBeVisible();
    });
}
