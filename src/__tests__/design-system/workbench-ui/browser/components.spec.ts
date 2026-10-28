import { expect, test } from "@playwright/test";

test("an inventory use opens a themed inspection without closing its sheet on Escape", async ({
    page,
}) => {
    await page.goto("/?component=InventorySheet&theme=dark");
    const inventoryTrigger = page.getByRole("button", {
        name: "Open inventory",
        exact: true,
    });
    await inventoryTrigger.click();
    const sheet = page.getByRole("dialog", {
        name: "Which evidence bears on which question",
        exact: true,
    });
    const tile = page.getByRole("button", { name: "A-014 · Q1 · Supports" });
    await tile.focus();
    await page.keyboard.press("Enter");
    const inspection = page.getByRole("dialog", {
        name: "A-014 used for Q1",
        exact: true,
    });
    await expect(inspection).toBeVisible();
    await expect(inspection).toHaveAttribute("data-theme", "dark");
    await expect(
        inspection.getByText(/Shows one workflow spanning insurers/),
    ).toBeVisible();
    await expect(
        inspection.getByRole("button", { name: "Close use details" }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(inspection).toHaveCount(0);
    await expect(sheet).toBeVisible();
    await expect(tile).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    await expect(inventoryTrigger).toBeFocused();
});

test("the base matrix includes source checks alongside question uses", async ({
    page,
}) => {
    await page.goto("/?component=EvidenceMatrix&theme=light");
    const matrix = page.getByRole("table", { name: "Evidence by question" });
    await expect(
        matrix.getByRole("columnheader", { name: "Source", exact: true }),
    ).toBeVisible();
    await expect(
        matrix.getByRole("cell", { name: "Verified", exact: true }),
    ).toHaveCount(2);
    await expect(
        matrix.getByRole("cell", { name: "Sources disagree", exact: true }),
    ).toBeVisible();
});

test("inventory selection follows an assertion use and its question", async ({
    page,
}) => {
    await page.goto("/?component=InventorySheet&theme=light");
    await page
        .getByRole("button", { name: "Open inventory", exact: true })
        .click();
    const initial = page.getByRole("button", { name: "A-014 · Q1 · Supports" });
    await expect(initial).toHaveAttribute("aria-pressed", "true");
    const next = page.getByRole("button", { name: "A-031 · Q3 · Context" });
    await next.click();
    await expect(next).toHaveAttribute("aria-pressed", "true");
    await expect(initial).toHaveAttribute("aria-pressed", "false");
    await expect(
        page.getByText("A-031 · selected", { exact: true }),
    ).toBeVisible();
    await expect(
        page.getByText("A-031 · 2 uses", { exact: true }),
    ).toBeVisible();
});

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
            name: "Q3 Context · Data position",
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
    ).toHaveCount(5);
    await page.keyboard.press("Escape");
    await expect(
        page
            .getByRole("button", { name: "Open inventory", exact: true })
            .filter({ hasText: "Open inventory" }),
    ).toBeFocused();
});
