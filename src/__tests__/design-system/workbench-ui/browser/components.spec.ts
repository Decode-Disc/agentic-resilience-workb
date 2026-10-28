import { expect, test } from "@playwright/test";

test("inventory closes with Escape and carries its dark theme through the portal", async ({
    page,
}) => {
    await page.goto("/?component=InventorySheet&theme=dark");
    await page
        .getByRole("button", { name: "Open inventory", exact: true })
        .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(
        dialog.locator("xpath=ancestor::*[@data-theme][1]"),
    ).toHaveAttribute("data-theme", "dark");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(
        page.getByRole("button", { name: "Open inventory" }),
    ).toBeFocused();
});

test("narrow gallery makes overflowing examples scrollable", async ({
    page,
}) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/?component=QuestionCard&theme=light");
    expect(
        await page
            .locator(".gallery-scroll")
            .evaluate((el) => el.scrollWidth > el.clientWidth),
    ).toBe(true);
});

test("inventory keeps keyboard focus contained and restores its trigger after animated dismissal", async ({
    page,
}) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto("/?component=InventorySheet&theme=light");
    const trigger = page.getByRole("button", {
        name: "Open inventory",
        exact: true,
    });
    await page.keyboard.press("Tab");
    await expect(trigger).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(
        page.getByRole("searchbox", { name: "Search assertions" }),
    ).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(
        page.getByRole("button", {
            name: "Q3 Context · integrations to replace",
        }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(trigger).toBeFocused();
});

test("inventory search and filters operate on the supplied illustrative assertions", async ({
    page,
}) => {
    await page.goto("/?component=InventorySheet&theme=light");
    await page
        .getByRole("button", { name: "Open inventory", exact: true })
        .click();
    await page
        .getByRole("searchbox", { name: "Search assertions" })
        .fill("insurer");
    await page.getByRole("button", { name: "Fact 64" }).click();
    await expect(
        page.getByRole("table", { name: "Evidence by question" }),
    ).toBeVisible();
    await expect(
        page.getByText(
            "CCC reports insurer-configurable workflows connecting insurers and repairers.",
            { exact: true },
        ),
    ).toBeVisible();
    await expect(
        page.getByText(
            "Workflow execution alone does not establish authority over insurer decisions.",
            { exact: true },
        ),
    ).toHaveCount(0);
});

test("reader pagination keeps the displayed page position in sync", async ({
    page,
}) => {
    await page.goto("/?component=SourceReader&theme=light");
    await page.getByRole("button", { name: "Previous passage" }).click();
    await expect(page.getByText("p. 7 / 142", { exact: true })).toBeVisible();
    await expect(
        page.getByRole("button", { name: "Previous passage" }),
    ).toBeDisabled();
});

test("the gallery index remains available until an inventory preview is opened", async ({
    page,
}) => {
    await page.goto("/");
    await expect(
        page.getByRole("heading", { name: "Workbench UI", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page
        .getByRole("button", { name: "Open inventory", exact: true })
        .filter({ hasText: "Open inventory" })
        .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(
        page.getByRole("table", { name: "Evidence by question" }),
    ).toBeVisible();
    await expect(
        page
            .getByRole("table", { name: "Evidence by question" })
            .getByRole("row"),
    ).toHaveCount(4);
    await page.keyboard.press("Escape");
    await expect(
        page
            .getByRole("button", { name: "Open inventory", exact: true })
            .filter({ hasText: "Open inventory" }),
    ).toBeFocused();
});
