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
    await page.getByRole("button", { name: "Next citation" }).click();
    await expect(
        page.getByRole("status", { name: "Citation position" }),
    ).toHaveText("Citation 2 of 3");

    await location.getByRole("button", { name: "Source matrix" }).click();
    await expect(page).toHaveURL(/screen=matrix/);
    await expect(
        page.getByRole("button", { name: "Form 10-K · FY2025" }),
    ).toHaveAttribute("aria-current", "true");
    await page.goBack();
    await expect(page).toHaveURL(/screen=reader/);
    expect(errors).toEqual([]);
});

test("preparation maps documentary needs to the questions they serve", async ({
    page,
}) => {
    const errors = consoleErrors(page);
    await page.goto("/?layout=sources&screen=preparation&theme=light");
    const needs = page.getByRole("table", { name: "Documentary needs" });
    await expect(
        needs.getByRole("rowheader", {
            name: /Switching terms between platforms/,
        }),
    ).toBeVisible();
    // Sources prepares material; it does not judge whether a question is answered.
    await expect(page.getByText("Covered", { exact: true })).toHaveCount(0);
    await expect(
        page.getByRole("group", { name: "Preparation view" }),
    ).toHaveCount(0);

    const q3 = needs.getByRole("button", { name: /^Q3/ });
    await q3.click();
    await expect(q3).toHaveAttribute("aria-pressed", "true");
    const lens = page.getByRole("status").filter({ hasText: "Q3" });
    await expect(lens).toContainText("Could core platforms replace it?");
    await expect(lens).toContainText("3 documentary needs");
    // The needs Q3 relies on come first.
    const firstRows = needs.locator("tbody tr").locator("th");
    await expect(firstRows.nth(0)).toContainText(
        /Switching terms|investor-day|Third-party access/,
    );
    await expect(firstRows.nth(2)).toContainText(
        /Switching terms|investor-day|Third-party access/,
    );
    await q3.click();
    await expect(q3).toHaveAttribute("aria-pressed", "false");
    await expect(firstRows.nth(0)).toContainText("Where the platform sits");
    await q3.focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(q3).toBeFocused();
    await expect(q3).toHaveAttribute("aria-pressed", "false");
    await expect(lens).toContainText("Could core platforms replace it?");

    await page.getByRole("button", { name: /How preparation ran/ }).click();
    await expect(
        page.getByRole("heading", { name: "Collect sources" }),
    ).toBeVisible();
    expect(errors).toEqual([]);
});

test("the outcome jumps straight to how preparation ran", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/?layout=sources&screen=preparation&theme=light");
    await page.getByRole("button", { name: "How it ran" }).click();
    const disclosure = page.getByRole("button", {
        name: /How preparation ran/,
    });
    await expect(disclosure).toHaveAttribute("aria-expanded", "true");
    await expect(disclosure).toBeFocused();
    await expect(disclosure).toBeInViewport();
    await expect(
        page.getByRole("heading", { name: "Collect sources" }),
    ).toBeVisible();
});

test("preparation needs stay readable on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/?layout=sources&screen=preparation&theme=dark");
    const needs = page.getByRole("table", { name: "Documentary needs" });
    const question = needs.getByRole("button", { name: /^Q4/ });
    await question.click();
    await expect(question).toHaveAttribute("aria-pressed", "true");
    await expect(
        page
            .getByRole("status")
            .filter({ hasText: "Could an agent bypass it?" }),
    ).toBeVisible();
    expect(
        await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
        ),
    ).toBe(true);
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
    await page
        .getByRole("button", { name: "Trade press · repair networks" })
        .click();
    await expect(page).toHaveURL(/screen=reader/);
    await page.goBack();
    await expect(page.getByText("11–20 of 38")).toBeVisible();
    await expect(
        page.getByRole("button", { name: "Trade press · repair networks" }),
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

    test("needs map marks explain themselves with a tap", async ({ page }) => {
        await page.goto("/?layout=sources&screen=preparation&theme=light");
        await page
            .getByRole("button", {
                name: "Serves Q3: Searched, nothing usable",
            })
            .tap();
        const tip = page.getByRole("dialog").filter({
            hasText: "Could core platforms replace it?",
        });
        await expect(tip).toContainText("Searched, nothing usable");
        // The row already names the need; the tip adds only what the mark means.
        await expect(tip).not.toContainText(
            "Switching terms between platforms",
        );
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

test("a conflict in the source list opens straight on that conflict", async ({
    page,
}) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/?layout=sources&screen=reader&theme=light");
    const list = page.getByRole("navigation", { name: "Sources", exact: true });
    await list.getByRole("button", { name: /Calls and investor/ }).click();
    await list
        .getByRole("button", {
            name: /^Go to the conflict in Q2 2025 earnings call/,
        })
        .click();
    const reader = page.getByRole("region", { name: "Q2 2025 earnings call" });
    await expect(
        reader.getByRole("status", { name: "Citation position" }),
    ).toHaveText("Conflicts · Citation 1 of 1");
});

test("the notebook steps through citations, opens their notes and narrows by question", async ({
    page,
}) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/?layout=sources&screen=reader&theme=light");
    const reader = page.getByRole("region", { name: "Form 10-K · FY2025" });
    const position = reader.getByRole("status", { name: "Citation position" });
    await expect(position).toHaveText("Citation 1 of 3");
    // Wide screens show notes in the margin by default.
    await expect(
        reader.getByText("Insurers configure workflows connecting them"),
    ).toBeVisible();
    await reader.getByRole("button", { name: "Show all notes" }).click();
    await expect(
        reader.getByText("Insurers configure workflows connecting them"),
    ).toHaveCount(0);

    await reader.getByRole("button", { name: "Next citation" }).click();
    await expect(position).toHaveText("Citation 2 of 3");
    // The focused citation's note opens even while the others are hidden.
    await expect(
        reader.getByText("Insurers set assignment rules inside the platform."),
    ).toBeVisible();
    await expect(
        reader.getByRole("button", { name: /^Citation 2/ }),
    ).toBeFocused();
    await page.keyboard.press("j");
    await expect(position).toHaveText("Citation 3 of 3");

    await reader
        .getByRole("group", { name: "Filter by question" })
        .getByRole("button", { name: /^Q1/ })
        .click();
    await expect(position).toHaveText("Q1 · Citation 1 of 2");
    await expect(reader).toContainText("Does CCC control coordination?");
});

test("narrow reader lists sources and opens the document in a drawer", async ({
    page,
}) => {
    const errors = consoleErrors(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/?layout=sources&screen=reader&theme=dark");
    const item = page
        .getByRole("navigation", { name: "Sources", exact: true })
        .getByRole("button", { name: /Form 10-K · FY2025/ });
    await item.click();
    const drawer = page.getByRole("dialog", { name: "Form 10-K · FY2025" });
    await expect(drawer).toBeVisible();
    // Notes open on demand below the margin width.
    await expect(
        drawer.getByText("Insurers configure workflows connecting them"),
    ).toHaveCount(0);
    await drawer
        .getByRole("button", { name: /^Show note for citation 1/ })
        .click();
    await expect(
        drawer.getByText("Insurers configure workflows connecting them"),
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

test("medium reader keeps the list beside the document without a drawer, inside one viewport", async ({
    page,
}) => {
    const errors = consoleErrors(page);
    await page.setViewportSize({ width: 1024, height: 800 });
    await page.goto("/?layout=sources&screen=reader&theme=light");
    const list = page.getByRole("navigation", { name: "Sources", exact: true });
    await list.getByRole("button", { name: /Calls and investor/ }).click();
    await list.getByRole("button", { name: /Q2 2025 earnings call/ }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const reader = page.getByRole("region", { name: "Q2 2025 earnings call" });
    await expect(reader).toBeVisible();
    const [listBox, readerBox] = await Promise.all([
        list.boundingBox(),
        reader.boundingBox(),
    ]);
    if (!listBox || !readerBox) throw new Error("Reader panes missing");
    expect(readerBox.x).toBeGreaterThan(listBox.x + listBox.width);
    // The page does not grow with the document: both panes fit the viewport.
    expect(readerBox.y + readerBox.height).toBeLessThanOrEqual(800);
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
    await drawer
        .getByRole("button", { name: "Request a targeted check" })
        .click();
    await expect(page.locator("output")).toHaveText(
        "Not connected in this preview · no check was requested",
    );
});
