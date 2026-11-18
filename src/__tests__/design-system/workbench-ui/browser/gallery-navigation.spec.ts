import { expect, test } from "@playwright/test";
import { reviewResearchProgram } from "@/__tests__/helpers/research-program";

test("primary navigation opens from one header menu and supports keyboard dismissal", async ({
    page,
}) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    const navigation = page.getByRole("button", {
        name: "Example navigation",
        exact: true,
    });
    await navigation.focus();
    await navigation.press("Enter");
    await expect(
        page.getByRole("menuitem", { name: "START screens", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(navigation).toBeFocused();
    await navigation.click();
    await page
        .getByRole("menuitem", { name: "START screens", exact: true })
        .click();
    await expect(page).toHaveURL(/layout=start/);
    await expect(
        page.getByRole("button", { name: "Example navigation", exact: true }),
    ).toContainText("START screens");
});

test("catalogue filters examples and keeps navigation available in a specimen", async ({
    page,
}) => {
    await page.goto("/");
    await page
        .getByRole("searchbox", { name: "Find an example" })
        .fill("Composer");
    await expect(
        page.getByRole("link", { name: "Composer", exact: true }),
    ).toBeVisible();
    await expect(
        page.getByRole("link", { name: "EvidenceMatrix", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("link", { name: "Composer", exact: true }).click();
    await expect(
        page.getByRole("heading", { name: "Shared composer", exact: true }),
    ).toBeVisible();
    await page
        .getByRole("button", { name: "Example navigation", exact: true })
        .click();
    await page
        .getByRole("menuitem", { name: "All examples", exact: true })
        .click();
    await expect(
        page.getByRole("searchbox", { name: "Find an example" }),
    ).toBeVisible();
    await page.goBack();
    await expect(
        page.getByRole("heading", { name: "Shared composer", exact: true }),
    ).toBeVisible();
});

test("screen examples retain the chosen model and expose commands in the real composer", async ({
    page,
}) => {
    await page.goto("/?layout=start&screen=composer");
    await page
        .getByRole("button", { name: "Workbench model and effort" })
        .click();
    await page
        .getByRole("menuitemradio", {
            name: "Illustrative fast model",
            exact: true,
        })
        .click();
    await page.getByRole("link", { name: "framing", exact: true }).click();
    const input = page.getByRole("textbox", {
        name: "Refine the framing in your own words",
        exact: true,
    });
    await input.fill("Keep this draft");
    await expect(
        page.getByRole("button", { name: "Workbench model and effort" }),
    ).toContainText("Illustrative fast model");
    await page
        .getByRole("button", { name: "Composer tools", exact: true })
        .click();
    await page.getByRole("menuitem", { name: "Commands", exact: true }).click();
    await expect(page.getByRole("option", { name: /\/model/ })).toBeVisible();
    await expect(page.getByRole("option", { name: /\/pause/ })).toHaveCount(0);
    await expect(input).toHaveValue("Keep this draft");
    await page.keyboard.press("Escape");
    await page
        .getByRole("button", { name: "Start research", exact: true })
        .click();
    const ask = page.getByRole("button", { name: "Ask AI", exact: true });
    if (await ask.isVisible()) await ask.click();
    const chat = page.getByRole("textbox", {
        name: "Ask about the sources",
        exact: true,
    });
    await chat.fill("/");
    await expect(page.getByRole("option", { name: /\/pause/ })).toBeVisible();
    await page.getByRole("option", { name: /\/pause/ }).click();
    await expect(
        page.getByRole("heading", {
            name: "Documentary preparation stopped",
            exact: true,
        }),
    ).toBeVisible();
    await chat.fill("/");
    await expect(page.getByRole("option", { name: /\/resume/ })).toBeVisible();
    await expect(page.getByRole("option", { name: /\/pause/ })).toHaveCount(0);
    await page.getByRole("option", { name: /\/resume/ }).click();
    await expect(
        page.getByRole("heading", {
            name: "Collecting the documentary material",
            exact: true,
        }),
    ).toBeVisible();
    await expect(
        page.getByRole("button", { name: "Workbench model and effort" }),
    ).toContainText("Illustrative fast model");
});

test("composer specimen saves and edits the analyst's question instead of inserting a fixture", async ({
    page,
}) => {
    await page.goto("/?component=Composer&program=empty");
    await page
        .getByRole("button", { name: "Add research question", exact: true })
        .click();
    const question = page.getByRole("textbox", {
        name: "Add research question",
        exact: true,
    });
    await expect(question).toBeFocused();
    await question.fill("Who sets the coordination rules?");
    await page
        .getByRole("button", { name: "Add question", exact: true })
        .click();
    await expect(
        page.getByRole("heading", {
            name: "Who sets the coordination rules?",
            exact: true,
        }),
    ).toBeVisible();
    await reviewResearchProgram(page);
    await page
        .getByRole("button", { name: "Edit question", exact: true })
        .click();
    const edit = page.getByRole("textbox", {
        name: "Edit research question",
        exact: true,
    });
    await expect(edit).toHaveValue("Who sets the coordination rules?");
    await edit.fill("Who can change the coordination rules?");
    await page
        .getByRole("button", { name: "Save question", exact: true })
        .click();
    await expect(
        page.getByRole("heading", {
            name: "Who can change the coordination rules?",
            exact: true,
        }),
    ).toBeVisible();
});
