import { expect, type Page, test } from "@playwright/test";

const consoleErrors = (page: Page) => {
    const errors: string[] = [];
    page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));
    return errors;
};

test("preparation leads to the matrix and a selected source in the reader", async ({
    page,
}) => {
    const errors = consoleErrors(page);
    await page.goto("/?layout=sources&screen=preparation&theme=light");
    await expect(
        page.getByRole("heading", {
            name: "Documentary material for four questions",
        }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Inspect sources" }).click();
    await expect(page).toHaveURL(/screen=matrix/);

    const call = page.getByRole("button", { name: "Q2 2025 earnings call" });
    await call.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/screen=reader/);
    const location = page.getByRole("navigation", { name: "Sources location" });
    await expect(location.locator("[aria-current=page]")).toHaveText(
        "Q2 2025 earnings call",
    );
    await expect(
        page.getByText("Our platform recommends where each claim"),
    ).toBeVisible();

    await page
        .getByRole("navigation", { name: "Sources" })
        .getByRole("button", { name: /Form 10-K · FY2025/ })
        .click();
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
    await page.getByRole("button", { name: "Next passage" }).click();
    await expect(page.getByText("p. 9 / 142")).toBeVisible();

    await location.getByRole("button", { name: "Source matrix" }).click();
    await expect(page).toHaveURL(/screen=matrix/);
    await expect(
        page.getByRole("button", { name: "Form 10-K · FY2025" }),
    ).toHaveAttribute("aria-current", "true");
    await page.goBack();
    await expect(page).toHaveURL(/screen=reader/);
    expect(errors).toEqual([]);
});

test("preparation opens on the summary and switches to coverage by question", async ({
    page,
}) => {
    await page.goto("/?layout=sources&screen=preparation&theme=light");
    const views = page.getByRole("group", { name: "Preparation view" });
    await expect(
        views.getByRole("button", { name: "Summary" }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
        page.getByText("29 sources are ready for the investigation."),
    ).toBeVisible();
    await expect(
        page.getByRole("heading", { name: "Collect sources" }),
    ).toHaveCount(0);

    await page
        .getByRole("button", { name: "Details on how sources were read" })
        .click();
    await expect(
        views.getByRole("button", { name: "By question" }),
    ).toHaveAttribute("aria-pressed", "true");
    const q3 = page.getByRole("listitem").filter({
        hasText: "Could core platforms replace it?",
    });
    await expect(q3).toContainText(
        "No public document states switching terms between platforms.",
    );
    await expect(
        page.getByRole("heading", { name: "Collect sources" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Inspect sources" }).click();
    await page.goBack();
    await expect(
        views.getByRole("button", { name: "By question" }),
    ).toHaveAttribute("aria-pressed", "true");
});

test("matrix filter menus, removable filters and the empty state stay coherent", async ({
    page,
}) => {
    await page.goto("/?layout=sources&screen=matrix&theme=light");
    const count = page.getByRole("status").filter({ hasText: "sources" });
    await expect(count).toHaveText("38 of 38 sources");
    await page.getByRole("button", { name: "Reading", exact: true }).click();
    await page.getByRole("menuitemradio", { name: "Partial" }).click();
    await expect(count).toHaveText("5 of 38 sources");
    await expect(
        page.getByRole("button", { name: "Investor day 2025" }),
    ).toBeVisible();

    await page
        .getByRole("button", { name: "Remove filter Reading: Partial" })
        .click();
    await expect(count).toHaveText("38 of 38 sources");

    await page.getByRole("button", { name: "Selection", exact: true }).click();
    await page.getByRole("menuitemradio", { name: "Excluded" }).click();
    await page
        .getByRole("searchbox", { name: "Search sources" })
        .fill("patent");
    await expect(count).toHaveText("0 of 38 sources");
    await expect(page.getByText("No source matches")).toBeVisible();
    await page.getByRole("button", { name: "Show all sources" }).click();
    await expect(count).toHaveText("38 of 38 sources");
    await expect(
        page.getByRole("searchbox", { name: "Search sources" }),
    ).toHaveValue("");
    await expect(
        page.getByRole("button", { name: /Remove filter/ }),
    ).toHaveCount(0);
});

test("matrix explains its columns and contribution classes", async ({
    page,
}) => {
    await page.goto("/?layout=sources&screen=matrix&theme=light");
    const help = page.getByRole("button", { name: "About Availability" });
    await expect(help).toHaveAccessibleDescription(
        /How much of the document was actually read/,
    );
    await help.hover();
    await expect(
        page
            .getByRole("dialog")
            .filter({ hasText: "How much of the document was actually read" }),
    ).toBeVisible();
    await expect(
        page.getByRole("button", {
            name: "18 contributions: 12 facts, 4 inferences, 2 counter-evidence",
        }),
    ).toBeVisible();
});

test("matrix pages through every source and keeps the current source in view", async ({
    page,
}) => {
    await page.goto("/?layout=sources&screen=matrix&theme=light");
    const table = page.getByRole("table", { name: "Source matrix" });
    await expect(table.locator("tbody tr")).toHaveCount(10);
    await expect(page.getByText("1–10 of 38")).toBeVisible();
    const pages = page.getByRole("navigation", { name: "Source matrix pages" });
    await pages.getByRole("button", { name: "Go to next page" }).click();
    await expect(page.getByText("11–20 of 38")).toBeVisible();
    await page.getByRole("button", { name: "Q4 2024 earnings call" }).click();
    await expect(page).toHaveURL(/screen=reader/);
    await page.goBack();
    await expect(page.getByText("11–20 of 38")).toBeVisible();
    await expect(
        page.getByRole("button", { name: "Q4 2024 earnings call" }),
    ).toHaveAttribute("aria-current", "true");
});

test.describe("on a touch screen", () => {
    test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

    test("matrix explanations open with a tap", async ({ page }) => {
        await page.goto("/?layout=sources&screen=matrix&theme=light");
        await page.getByRole("button", { name: "About Availability" }).tap();
        await expect(
            page.getByRole("dialog").filter({
                hasText: "How much of the document was actually read",
            }),
        ).toBeVisible();
        await page.keyboard.press("Escape");
        await page.getByRole("button", { name: /^18 contributions/ }).tap();
        await expect(
            page.getByRole("dialog").filter({ hasText: "12 facts" }),
        ).toBeVisible();
    });

    test("the source drawer closes from its header", async ({ page }) => {
        await page.goto("/?layout=sources&screen=reader&theme=light");
        await page
            .getByRole("navigation", { name: "Sources" })
            .getByRole("button", { name: /Form 10-K · FY2025/ })
            .tap();
        const drawer = page.getByRole("dialog", { name: "Form 10-K · FY2025" });
        const close = drawer.getByRole("button", { name: "Close source" });
        const title = drawer.getByText("Form 10-K · FY2025", { exact: true });
        const [closeBox, titleBox] = await Promise.all([
            close.boundingBox(),
            title.boundingBox(),
        ]);
        if (!closeBox || !titleBox) throw new Error("Drawer header missing");
        const closeCentre = closeBox.y + closeBox.height / 2;
        // The close action shares the title line instead of adding a row.
        expect(closeCentre).toBeGreaterThanOrEqual(titleBox.y - 8);
        expect(closeCentre).toBeLessThanOrEqual(
            titleBox.y + titleBox.height + 8,
        );
        await close.tap();
        await expect(drawer).toHaveCount(0);
    });
});

test("a contribution leads to its passage and filters by question", async ({
    page,
}) => {
    await page.goto("/?layout=sources&screen=reader&theme=light");
    const gives = page.getByRole("region", {
        name: "What this document gives",
    });
    await page.getByRole("button", { name: "Next passage" }).click();
    await expect(page.getByText("p. 9 / 142")).toBeVisible();

    await gives
        .getByRole("button", {
            name: /Insurers set assignment rules inside the platform/,
        })
        .click();
    await expect(page.getByText("p. 8 / 142")).toBeVisible();
    await expect(
        page.locator("[data-passage-active]").filter({
            hasText: "Assignment decisions follow rules",
        }),
    ).toBeVisible();

    const questions = gives.getByRole("group", { name: "Filter by question" });
    await questions.getByRole("button", { name: /^Q2/ }).click();
    await expect(
        gives.getByRole("button", { name: /Expected growth/ }),
    ).toBeVisible();
    await expect(
        gives.getByRole("button", { name: /assignment rules/ }),
    ).toHaveCount(0);
});

test("narrow reader lists sources and opens the document in a drawer", async ({
    page,
}) => {
    const errors = consoleErrors(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/?layout=sources&screen=reader&theme=dark");
    const item = page
        .getByRole("navigation", { name: "Sources" })
        .getByRole("button", { name: /Q2 2025 earnings call/ });
    await item.click();
    const drawer = page.getByRole("dialog", { name: "Q2 2025 earnings call" });
    await expect(drawer).toBeVisible();
    await drawer.getByRole("tab", { name: /What it gives/ }).click();
    await drawer
        .getByRole("button", { name: /CCC-recommended routing/ })
        .click();
    await expect(drawer.getByRole("tab", { name: "Document" })).toHaveAttribute(
        "aria-selected",
        "true",
    );
    await expect(
        drawer.getByText("Our platform recommends where each claim"),
    ).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(drawer).toHaveCount(0);
    await expect(item).toBeFocused();
    expect(
        await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
        ),
    ).toBe(true);
    expect(errors).toEqual([]);
});

test("medium reader keeps the list beside the document without a drawer", async ({
    page,
}) => {
    const errors = consoleErrors(page);
    await page.setViewportSize({ width: 1024, height: 800 });
    await page.goto("/?layout=sources&screen=reader&theme=light");
    const list = page.getByRole("navigation", { name: "Sources", exact: true });
    await list.getByRole("button", { name: /Q2 2025 earnings call/ }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const documentTab = page.getByRole("tab", { name: "Document" });
    await expect(documentTab).toHaveAttribute("aria-selected", "true");
    await expect(
        page.getByText("Our platform recommends where each claim"),
    ).toBeVisible();
    const [listBox, tabBox] = await Promise.all([
        list.boundingBox(),
        documentTab.boundingBox(),
    ]);
    if (!listBox || !tabBox) throw new Error("Reader panes missing");
    // The document opens beside the list rather than below or over it.
    expect(tabBox.x).toBeGreaterThan(listBox.x + listBox.width);

    await page.getByRole("tab", { name: /What it gives/ }).click();
    await expect(
        page.getByRole("region", { name: "What this document gives" }),
    ).toBeVisible();
    expect(
        await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
        ),
    ).toBe(true);
    expect(errors).toEqual([]);
});

test("inventory dock restores focus and unconnected actions say so", async ({
    page,
}) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/?layout=sources&screen=reader&theme=dark");
    const dock = page.getByRole("button", { name: "Open inventory" });
    await dock.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(dock).toBeFocused();

    await page
        .getByRole("navigation", { name: "Sources" })
        .getByRole("button", { name: /Form 10-K/ })
        .click();
    const drawer = page.getByRole("dialog", { name: "Form 10-K · FY2025" });
    await drawer.getByRole("tab", { name: /What it gives/ }).click();
    await drawer
        .getByRole("button", { name: "Request a targeted check" })
        .click();
    await expect(page.locator("output")).toHaveText(
        "Not connected in this preview · no check was requested",
    );
});
