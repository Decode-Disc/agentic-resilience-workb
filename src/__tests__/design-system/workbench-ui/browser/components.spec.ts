import { expect, test } from "@playwright/test";

test("START Stay here dismisses the handoff and cancels its automatic navigation", async ({
    page,
}) => {
    await page.clock.install();
    await page.goto("/?layout=start&screen=handoff&theme=light");
    await page.getByRole("button", { name: "Stay here", exact: true }).click();
    await expect(
        page.getByRole("button", { name: "Stay here", exact: true }),
    ).toHaveCount(0);
    await expect(
        page.getByRole("heading", { name: "Documentary material ready" }),
    ).toBeVisible();
    await page.clock.runFor(5000);
    await expect(page).toHaveURL(/layout=start&screen=handoff/);
    const progress = page.getByRole("button", {
        name: "Open Progress",
        exact: true,
    });
    await expect(progress).toBeVisible();
    await progress.click();
    await expect(page).toHaveURL(/component=ProgressTimeline/);
});

test("START company picker closes with Escape and restores keyboard focus", async ({
    page,
}) => {
    await page.goto("/?layout=start&screen=composer&theme=light");
    const trigger = page.getByRole("button", {
        name: "Company to investigate",
        exact: true,
    });
    await trigger.click();
    const search = page.getByRole("textbox", {
        name: "Company search",
        exact: true,
    });
    await search.fill("CCCS");
    await page.keyboard.press("Escape");
    await expect(search).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
        page.getByRole("button", {
            name: "Add a public reference",
            exact: true,
        }),
    ).toBeFocused();
});

test("START Other activity reveals a field for the analyst's own scope", async ({
    page,
}) => {
    await page.goto("/?layout=start&screen=framing&theme=light");
    await page.getByRole("radio", { name: "Other…", exact: true }).check();
    const scope = page.getByRole("textbox", {
        name: "Other activity",
        exact: true,
    });
    await scope.fill("Claims intake");
    await expect(scope).toHaveValue("Claims intake");
});

test("START removing a company hides its confirmation and preserves the request", async ({
    page,
}) => {
    await page.goto("/?layout=start&screen=confirm&theme=light");
    const request = page.getByRole("textbox", {
        name: "Research request — optional research angle",
    });
    await request.fill("Keep this research angle");
    await page
        .getByRole("button", { name: "Remove selected company", exact: true })
        .click();
    await expect(
        page.getByRole("region", { name: "Confirm company and mandate" }),
    ).toHaveCount(0);
    await expect(request).toHaveValue("Keep this research angle");
    await expect(
        page.getByRole("button", {
            name: "Company to investigate",
            exact: true,
        }),
    ).toBeVisible();
});

test("START public reference controls stage and remove links locally", async ({
    page,
}) => {
    await page.goto("/?layout=start&screen=composer&theme=light");
    await page
        .getByRole("button", { name: "Add a public reference", exact: true })
        .click();
    const dialog = page.getByRole("dialog", {
        name: "Add public sources",
        exact: true,
    });
    await expect(dialog).toBeVisible();
    await dialog
        .getByRole("textbox", { name: "Public source link", exact: true })
        .fill("https://example.org/report");
    await dialog.getByRole("button", { name: "Add", exact: true }).click();
    await expect(
        dialog.getByRole("list", { name: "Added public references" }),
    ).toContainText("https://example.org/report");
    await dialog.getByRole("button", { name: "Done", exact: true }).click();
    await expect(
        page.getByRole("button", {
            name: "Add a public reference (1)",
            exact: true,
        }),
    ).toBeVisible();
    await page
        .getByRole("button", {
            name: "Add a public reference (1)",
            exact: true,
        })
        .click();
    await dialog
        .getByRole("button", {
            name: "Remove https://example.org/report",
            exact: true,
        })
        .click();
    await dialog.getByRole("button", { name: "Done", exact: true }).click();
    await expect(
        page.getByRole("button", {
            name: "Add a public reference",
            exact: true,
        }),
    ).toBeVisible();
});

test("START Change company opens its picker and search filters the illustrative company", async ({
    page,
}) => {
    await page.goto("/?layout=start&screen=confirm&theme=light");
    await page
        .getByRole("button", { name: "Change company", exact: true })
        .click();
    const search = page.getByRole("textbox", {
        name: "Company search",
        exact: true,
    });
    await expect(search).toBeVisible();
    await search.fill("No matching fixture");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(
        page.getByText("No matching companies.", { exact: true }),
    ).toBeVisible();
    await search.fill("CCCS");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(
        page
            .getByText("CCC Intelligent Solutions Holdings Inc.", {
                exact: true,
            })
            .last(),
    ).toBeVisible();
});

test("START View framing navigates from source collection to its framing screen", async ({
    page,
}) => {
    await page.goto("/?layout=start&screen=launched&theme=dark");
    await page
        .getByRole("button", { name: "View framing", exact: true })
        .click();
    await expect(page).toHaveURL(/layout=start&screen=framing&theme=dark/);
    await expect(
        page.getByRole("region", { name: "Proposed framing" }),
    ).toBeVisible();
    await page.goBack();
    await expect(
        page.getByRole("heading", {
            name: "Collecting the documentary material",
        }),
    ).toBeVisible();
    await page
        .getByRole("button", { name: "Open Progress", exact: true })
        .click();
    await expect(page).toHaveURL(/component=ProgressTimeline/);
});

test("START Add a question creates an editable question and focuses it", async ({
    page,
}) => {
    await page.goto("/?layout=start&screen=framing&theme=light");
    await page.getByRole("button", { name: /Add a question ·/ }).click();
    const question = page.getByRole("textbox", {
        name: "Q5 research question",
        exact: true,
    });
    await expect(question).toBeFocused();
    await question.fill("Who can change the routing rules?");
    await expect(question).toHaveValue("Who can change the routing rules?");
});

test("START angle suggestions populate and focus the request composer", async ({
    page,
}) => {
    await page.goto("/?layout=start&screen=composer&theme=light");
    await page
        .getByRole("button", {
            name: "Which integrations would an agent have to replace?",
            exact: true,
        })
        .click();
    const request = page.getByRole("textbox", {
        name: "Research request — optional research angle",
    });
    await expect(request).toHaveValue(
        "Which integrations would an agent have to replace?",
    );
    await expect(request).toBeFocused();
});

test("START framing replies populate and focus the refinement composer", async ({
    page,
}) => {
    await page.goto("/?layout=start&screen=framing&theme=dark");
    await page
        .getByRole("button", { name: "Substitution by agents", exact: true })
        .click();
    const refinement = page.getByRole("textbox", {
        name: "Refine the framing in your own words",
    });
    await expect(refinement).toHaveValue("Substitution by agents");
    await expect(refinement).toBeFocused();
});

test("START previews keep screen navigation and theme within the START layout", async ({
    page,
}) => {
    await page.goto("/?theme=dark");
    await page
        .getByRole("link", { name: "START screens", exact: true })
        .click();
    await expect(page).toHaveURL(/layout=start&screen=composer&theme=dark/);
    await page.getByRole("link", { name: "confirm", exact: true }).click();
    await expect(
        page.getByRole("region", { name: "Confirm company and mandate" }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Switch theme", exact: true }).click();
    await expect(page).toHaveURL(/layout=start&screen=confirm&theme=light/);
});

test("START framing controls remain an isolated presentation", async ({
    page,
}) => {
    await page.goto("/?layout=start&screen=framing&theme=light");
    await expect(
        page.getByRole("region", { name: "Proposed framing" }),
    ).toBeVisible();
    await page
        .getByRole("radio", { name: "Repair network management" })
        .check();
    await expect(
        page.getByRole("radio", { name: "Repair network management" }),
    ).toBeChecked();
    await page
        .getByRole("textbox", { name: "Q1 research question" })
        .fill("Who controls routing?");
    await expect(
        page.getByRole("textbox", { name: "Q1 research question" }),
    ).toHaveValue("Who controls routing?");
    await page
        .getByRole("button", { name: "Start research", exact: true })
        .click();
    await expect(page.getByRole("status")).toContainText(
        "Illustrative callback: Start research",
    );
    await expect(page).toHaveURL(/layout=start&screen=framing/);
});

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
