import { expect, test } from "@playwright/test";

test("mobile framing leaves the context closed and preserves the reader's choice on resize", async ({
    page,
}) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/?layout=start&screen=framing&theme=light");
    const context = page.getByRole("button", {
        name: "Research context",
        exact: true,
    });
    await expect(context).toHaveAttribute("aria-expanded", "false");
    await context.click();
    await expect(
        page.getByRole("region", { name: "Plan", exact: true }),
    ).toBeVisible();
    await page
        .getByRole("button", { name: "Close research context", exact: true })
        .click();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await expect(context).toHaveAttribute("aria-expanded", "false");
    await page.reload();
    await expect(context).toHaveAttribute("aria-expanded", "true");
});

for (const viewport of [
    { width: 320, height: 740 },
    { width: 390, height: 650 },
]) {
    test(`framing keeps the program and composer inside the conversation ${viewport.width}x${viewport.height}`, async ({
        page,
    }) => {
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.setViewportSize(viewport);
        await page.goto("/?layout=start&screen=framing&theme=light");
        const close = page.getByRole("button", {
            name: "Close research context",
            exact: true,
        });
        if (await close.isVisible()) await close.click();
        const thread = page.getByRole("region", {
            name: "Framing conversation",
            exact: true,
        });
        const program = page.getByRole("region", {
            name: "Proposed framing",
            exact: true,
        });
        const assertContained = async () => {
            await expect
                .poll(async () => {
                    const bounds = await program.boundingBox();
                    const host = await thread.boundingBox();
                    return bounds && host
                        ? bounds.y >= host.y &&
                              bounds.y + bounds.height <= host.y + host.height
                        : false;
                })
                .toBe(true);
        };
        await expect
            .poll(() =>
                page.evaluate(
                    () => document.documentElement.scrollWidth <= innerWidth,
                ),
            )
            .toBe(true);
        await assertContained();
        const response = thread.getByText(
            "I can help frame this research before it starts.",
            { exact: true },
        );
        await response.click({ trial: true });
        const input = page.getByRole("textbox");
        await expect(input).toBeInViewport();
        await page
            .getByRole("button", { name: "Edit question", exact: true })
            .click();
        await expect(input).toBeFocused();
        await assertContained();
        await expect(
            page.getByRole("button", { name: "Save changes", exact: true }),
        ).toBeInViewport();
        await page.getByRole("button", { name: "Cancel", exact: true }).click();
        await assertContained();
        await page
            .getByRole("button", { name: "Research context", exact: true })
            .click();
        await page
            .getByRole("button", { name: "Change scope", exact: true })
            .click();
        await expect(
            page.getByRole("region", {
                name: "Clarify research context",
                exact: true,
            }),
        ).toBeVisible();
        await assertContained();
        await expect(
            page.getByRole("button", { name: "Continue", exact: true }),
        ).toBeInViewport();
        expect(errors).toEqual([]);
    });
}

test("a short mobile viewport keeps the question editor inside the conversation and its controls reachable", async ({
    page,
}) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/?layout=start&screen=framing&theme=dark");
    await page
        .getByRole("button", { name: "Edit question", exact: true })
        .click();
    await page.setViewportSize({ width: 390, height: 500 });
    const thread = page.getByRole("region", {
        name: "Framing conversation",
        exact: true,
    });
    const dock = thread.locator('[data-slot="conversation-thread-dock"]');
    await expect
        .poll(async () => {
            const bounds = await dock.boundingBox();
            const host = await thread.boundingBox();
            return bounds && host
                ? bounds.y >= host.y &&
                      bounds.y + bounds.height <= host.y + host.height
                : false;
        })
        .toBe(true);
    const input = page.getByRole("textbox", {
        name: "Edit research question",
        exact: true,
    });
    await input.fill("Who can change the claims routing rules?");
    await page
        .getByRole("button", { name: "Save changes", exact: true })
        .click();
    await expect(
        page.getByRole("textbox", {
            name: "Refine the framing in your own words",
            exact: true,
        }),
    ).toBeVisible();
    await page
        .getByRole("region", { name: "Proposed framing", exact: true })
        .locator("summary")
        .click();
    await expect(
        page.getByRole("button", { name: "Start research", exact: true }),
    ).toBeInViewport();
});

test("question pagination keeps the selected topic visible in the mobile strip", async ({
    page,
}) => {
    await page.setViewportSize({ width: 320, height: 740 });
    await page.goto("/?layout=start&screen=framing&theme=light");
    for (let index = 0; index < 3; index++)
        await page
            .getByRole("button", {
                name: "Next research question",
                exact: true,
            })
            .click();
    const topics = page.getByRole("group", {
        name: "Research questions",
        exact: true,
    });
    const selected = topics.getByRole("button", {
        name: "Bypass",
        exact: true,
    });
    await expect(selected).toHaveAttribute("aria-pressed", "true");
    await expect
        .poll(async () => {
            const strip = await topics.boundingBox();
            const button = await selected.boundingBox();
            return strip && button
                ? button.x >= strip.x &&
                      button.x + button.width <= strip.x + strip.width
                : false;
        })
        .toBe(true);
});
