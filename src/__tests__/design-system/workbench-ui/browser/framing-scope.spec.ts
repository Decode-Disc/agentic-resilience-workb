import { expect, test } from "@playwright/test";

for (const width of [1440, 390]) {
    test(`scope clarification stays separate from research questions ${width}`, async ({
        page,
    }) => {
        await page.setViewportSize({
            width,
            height: width === 390 ? 844 : 1000,
        });
        await page.goto("/?layout=start&screen=framing&theme=dark");
        await page
            .getByRole("button", { name: "Add research question", exact: true })
            .waitFor();
        await page.screenshot({
            path: `/tmp/framing-scope-after-${width}.png`,
        });
        const plan = page.getByRole("region", { name: "Research framing" });
        await expect(
            plan.getByRole("group", { name: "Activity", exact: true }),
        ).toHaveCount(0);
        await page
            .getByRole("button", { name: "Change scope", exact: true })
            .click();
        await expect(
            page.getByRole("region", { name: "Clarify research context" }),
        ).toBeVisible();
        if (width === 1440)
            await expect(
                page.getByRole("region", { name: "Plan", exact: true }),
            ).toBeVisible();
        await expect(
            page.getByRole("group", {
                name: "Research questions",
                exact: true,
            }),
        ).toHaveCount(0);
        await page
            .getByRole("radio", { name: /Repair network management/ })
            .click();
        await page
            .getByRole("region", { name: "Clarify research context" })
            .getByRole("button", { name: "Update framing", exact: true })
            .click();
        await expect(
            page.getByRole("region", { name: "Clarify research context" }),
        ).toHaveCount(0);
        await expect(
            page.getByRole("group", {
                name: "Research questions",
                exact: true,
            }),
        ).toBeVisible();
        if (width === 390)
            await page
                .getByRole("button", { name: "Research context", exact: true })
                .click();
        await expect(
            page.getByRole("region", { name: "Plan", exact: true }),
        ).toContainText("Repair network management");
        await expect(
            page.getByRole("button", { name: "Start research", exact: true }),
        ).toBeEnabled();
    });
}

test("changing scope keeps an analyst-added question and the ordinary draft", async ({
    page,
}) => {
    await page.goto("/?layout=start&screen=framing&theme=dark");
    await page.getByRole("textbox").fill("Keep my ordinary draft.");
    await page
        .getByRole("button", { name: "Add research question", exact: true })
        .click();
    await page.getByRole("textbox").fill("Who can redirect the work?");
    await page
        .getByRole("button", { name: "Add question", exact: true })
        .click();
    await page
        .getByRole("button", { name: "Change scope", exact: true })
        .click();
    await page
        .getByRole("radio", { name: "Repair network management", exact: true })
        .click();
    await page
        .getByRole("region", { name: "Clarify research context" })
        .getByRole("button", { name: "Update framing", exact: true })
        .click();
    await expect(
        page.getByRole("heading", {
            name: "Who can redirect the work?",
            exact: true,
        }),
    ).toBeVisible();
    await expect(page.getByRole("textbox")).toHaveValue(
        "Keep my ordinary draft.",
    );
});

test("the open context card stays beside the program while entering a question", async ({
    page,
}) => {
    await page.setViewportSize({ width: 1672, height: 1005 });
    await page.goto("/?layout=start&screen=framing&theme=dark");
    await page
        .getByRole("button", { name: "Edit question", exact: true })
        .click();
    await expect(
        page.getByRole("textbox", {
            name: "Edit research question",
            exact: true,
        }),
    ).toBeFocused();
    await expect(
        page.getByRole("region", { name: "Plan", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page
        .getByRole("button", { name: "Add research question", exact: true })
        .click();
    await expect(
        page.getByRole("textbox", {
            name: "Add research question",
            exact: true,
        }),
    ).toBeFocused();
    await expect(
        page.getByRole("region", { name: "Plan", exact: true }),
    ).toBeVisible();
});
