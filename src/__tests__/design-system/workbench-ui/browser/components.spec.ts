import { expect, test } from "@playwright/test";
import {
    changeResearchScope,
    inspectResearchProgram,
    reviewResearchProgram,
} from "@/__tests__/helpers/research-program";

test("START completed material stays readable until explicit navigation", async ({
    page,
}) => {
    await page.clock.install();
    await page.goto("/?layout=start&screen=handoff&theme=light");
    await expect(
        page.getByRole("button", { name: "Stay here", exact: true }),
    ).toHaveCount(0);
    await expect(
        page.getByRole("heading", { name: "Documentary material ready" }),
    ).toBeVisible();
    await page.clock.runFor(5000);
    await expect(page).toHaveURL(/layout=start&screen=handoff/);
    const progress = page.getByRole("button", {
        name: "View progress",
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
            name: "Composer tools",
            exact: true,
        }),
    ).toBeFocused();
});

test("START missing context can use the proposed scope without answering", async ({
    page,
}) => {
    await page.goto("/?layout=start&screen=framing&theme=light");
    await page
        .getByRole("button", { name: "Company only", exact: true })
        .click();
    await expect(
        page.getByRole("region", { name: "Clarify research context" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(
        page.getByRole("region", { name: "Clarify research context" }),
    ).toHaveCount(0);
    await expect(
        page.getByRole("region", { name: "Plan", exact: true }),
    ).toContainText("Photo-led auto claims");
    await expect(
        page.getByRole("region", { name: "Your clarification" }),
    ).toHaveCount(0);
    await expect(page).toHaveURL(/screen=framing/);
    await expect(
        page.getByRole("button", { name: "Start research", exact: true }),
    ).toBeEnabled();
});

test("START confirmation preserves the approved company card and opens framing without a composer", async ({
    page,
}) => {
    await page.goto("/?layout=start&screen=confirm&theme=light");
    await expect(
        page.getByRole("region", { name: "Confirm company and mandate" }),
    ).toBeVisible();
    await expect(
        page.getByRole("textbox", {
            name: "Research request — optional research angle",
        }),
    ).toHaveCount(0);
    await page.getByRole("radio", { name: /Independent scrutiny/ }).check();
    await expect(
        page.getByRole("radio", { name: /Independent scrutiny/ }),
    ).toBeChecked();
    await page
        .getByRole("button", {
            name: "Confirm and propose framing",
            exact: true,
        })
        .click();
    await expect(page).toHaveURL(/layout=start&screen=framing/);
});

test("START public reference controls stage and remove links locally", async ({
    page,
}) => {
    await page.goto("/?layout=start&screen=composer&theme=light");
    await page
        .getByRole("button", { name: "Composer tools", exact: true })
        .click();
    await page
        .getByRole("menuitem", { name: "Attach references", exact: true })
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
            name: "Composer tools (1)",
            exact: true,
        }),
    ).toBeVisible();
    await page
        .getByRole("button", {
            name: "Composer tools (1)",
            exact: true,
        })
        .click();
    await page
        .getByRole("menuitem", { name: "Attach references", exact: true })
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
            name: "Composer tools",
            exact: true,
        }),
    ).toBeVisible();
});

test("START Back returns to the company picker and search filters the illustrative company", async ({
    page,
}) => {
    await page.goto("/?layout=start&screen=confirm&theme=light");
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expect(page).toHaveURL(/screen=composer/);
    await page
        .getByRole("button", { name: "Company to investigate", exact: true })
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
        .getByRole("button", { name: "Research context", exact: true })
        .click();
    await inspectResearchProgram(page);
    await page
        .getByRole("button", { name: "View framing", exact: true })
        .click();
    await expect(
        page.getByRole("region", {
            name: "Accepted research program",
            exact: true,
        }),
    ).toBeVisible();
    await expect(
        page.getByRole("button", { name: "Start research", exact: true }),
    ).toHaveCount(0);
    await page.goBack();
    await page
        .getByRole("button", { name: "View progress", exact: true })
        .click();
    await expect(page).toHaveURL(/component=ProgressTimeline/);
});

test("START optional corrections update the proposed research program", async ({
    page,
}) => {
    await page.goto("/?layout=start&screen=framing&theme=light");
    await reviewResearchProgram(page);
    await page
        .getByRole("button", { name: "Edit question", exact: true })
        .click();
    await page
        .getByRole("textbox", { name: "Edit research question", exact: true })
        .fill("Who can change the routing rules?");
    await page
        .getByRole("button", { name: "Save changes", exact: true })
        .click();
    await expect(
        page.getByRole("heading", {
            name: "Who can change the routing rules?",
            exact: true,
        }),
    ).toBeVisible();
    await page
        .getByRole("button", { name: "Add research question", exact: true })
        .click();
    await page
        .getByRole("textbox", { name: "Add research question", exact: true })
        .fill("Who owns the repairer relationship?");
    await page
        .getByRole("button", { name: "Add question", exact: true })
        .click();
    await expect(
        page.getByRole("heading", {
            name: "Who owns the repairer relationship?",
            exact: true,
        }),
    ).toBeVisible();
    const selector = page.getByRole("combobox", {
        name: "Research question",
        exact: true,
    });
    await expect(selector).toContainText("5 of 5");
    await selector.click();
    await page.getByRole("option", { name: /^1\./ }).click();
    await expect(
        page.getByRole("heading", {
            name: "Who can change the routing rules?",
            exact: true,
        }),
    ).toBeVisible();
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

test("START freeform context is reflected in the scope and retained when reopened", async ({
    page,
}) => {
    await page.goto("/?layout=start&screen=framing&theme=dark");
    await page
        .getByRole("button", { name: "Company only", exact: true })
        .click();
    const context = page.getByRole("textbox", {
        name: "Or describe a different scope…",
        exact: true,
    });
    await context.fill("Claims intake");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page.getByRole("log")).toContainText("Claims intake");
    await expect(
        page.getByRole("region", { name: "Plan", exact: true }),
    ).toContainText("Claims intake");
    await changeResearchScope(page);
    await expect(context).toHaveValue("Claims intake");
});

test("START previews keep screen navigation and theme within the START layout", async ({
    page,
}) => {
    await page.goto("/?theme=dark");
    await page.getByRole("link", { name: /^START screens/ }).click();
    await expect(page).toHaveURL(/layout=start&screen=composer&theme=dark/);
    await page.getByRole("link", { name: "confirm", exact: true }).click();
    await expect(
        page.getByRole("region", { name: "Confirm company and mandate" }),
    ).toBeVisible();
    await page
        .getByRole("button", { name: "Switch theme", exact: true })
        .click();
    await expect(page).toHaveURL(/layout=start&screen=confirm&theme=light/);
    await page.goBack();
    await expect(page).toHaveURL(/layout=start&screen=composer&theme=dark/);
    await expect(page.locator(".start-screen-preview")).toHaveAttribute(
        "data-theme",
        "dark",
    );
});

test("START a specific request receives a framing directly and needs an explicit research start", async ({
    page,
}) => {
    await page.goto("/?layout=start&screen=framing&theme=light");
    await expect(
        page.getByRole("region", { name: "Clarify research context" }),
    ).toHaveCount(0);
    await expect(page.getByRole("radio")).toHaveCount(0);
    await expect(
        page.getByRole("region", { name: "Proposed framing", exact: true }),
    ).toContainText("4 questions");
    await expect(page.getByRole("log")).toContainText(
        "Does CCC control the photo-led claim workflow",
    );
    await expect(
        page.getByRole("log").getByRole("article", {
            name: "Workbench Agent message",
            exact: true,
        }),
    ).toBeVisible();
    await page
        .getByRole("button", { name: "Start research", exact: true })
        .click();
    await expect(page).toHaveURL(/layout=start&screen=launched/);
});

test("START useful context changes the scope and research program with mobile keyboard access", async ({
    page,
}) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/?layout=start&screen=framing&theme=light");
    await page
        .getByRole("button", { name: "Company only", exact: true })
        .click();
    const activity = page.getByRole("radio", {
        name: "Repair network management",
        exact: true,
    });
    await activity.focus();
    await page.keyboard.press("Space");
    await expect(activity).toBeChecked();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("log")).toContainText(
        "Repair network management",
    );
    await expect(page.getByRole("log")).toContainText(
        "Repair network management",
    );
    await reviewResearchProgram(page);
    const summary = page.getByRole("region", {
        name: "Proposed framing",
        exact: true,
    });
    await expect(page.getByRole("textbox")).toBeInViewport();
    await expect(summary).toContainText(
        "Who controls access to the repair network?",
    );
    await expect(
        summary.getByRole("combobox", {
            name: "Research question",
            exact: true,
        }),
    ).toContainText("of 3");
    await expect(summary).not.toContainText(
        "Could agent-led claim intake bypass it?",
    );
    await expect(page.locator("output")).not.toContainText(
        "Illustrative callback: Start research",
    );
    expect(
        await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
    ).toBe(true);
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
    await trigger.focus();
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
        page.getByRole("heading", {
            name: "Explore the interface",
            exact: true,
        }),
    ).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page
        .getByRole("link", { name: "InventorySheet", exact: true })
        .click();
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

test("START conversation keeps a guided correction through launch and reload", async ({
    page,
}) => {
    await page.goto("/?layout=start&screen=framing&theme=light");
    await page
        .getByRole("button", { name: "Preview tools", exact: true })
        .click();
    await page
        .getByRole("button", { name: "Example: switching costs" })
        .click();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Send refinement" }).click();
    await reviewResearchProgram(page);
    const questionSelector = page.getByRole("combobox", {
        name: "Research question",
        exact: true,
    });
    await questionSelector.click();
    await page.getByRole("option", { name: /^5\./ }).click();
    await expect(
        page.getByRole("region", { name: "Proposed framing", exact: true }),
    ).toContainText(
        "What would insurers and repairers need to change to switch away from CCC?",
    );
    await page
        .getByRole("button", { name: "Start research", exact: true })
        .click();
    await expect(page).toHaveURL(/screen=launched/);
    await page.reload();
    await page
        .getByRole("button", { name: "Research context", exact: true })
        .click();
    await inspectResearchProgram(page);
    await page
        .getByRole("button", { name: "View framing", exact: true })
        .click();
    await reviewResearchProgram(page);
    await questionSelector.click();
    await page.getByRole("option", { name: /^5\./ }).click();
    await expect(
        page.getByRole("region", {
            name: "Accepted research program",
            exact: true,
        }),
    ).toContainText(
        "What would insurers and repairers need to change to switch away from CCC?",
    );
    await expect(
        page.getByRole("button", { name: "Start research", exact: true }),
    ).toHaveCount(0);
    await expect(
        page.getByRole("log").getByText(/Earlier conversation/),
    ).toHaveCount(0);
    await expect(page.getByRole("log")).toContainText(
        "Added to the research program: What would insurers and repairers need to change to switch away from CCC?",
    );
});

for (const theme of ["light", "dark"] as const) {
    test(`START ${theme} conversation keeps the composer visible and preserves the mobile draft`, async ({
        page,
    }) => {
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.emulateMedia({ reducedMotion: "no-preference" });
        await page.goto(`/?layout=start&screen=framing&theme=${theme}`);
        await reviewResearchProgram(page);
        const input = page.getByRole("textbox", {
            name: "Refine the framing in your own words",
        });
        await page
            .getByRole("button", { name: "Preview tools", exact: true })
            .click();
        await page.getByRole("button", { name: "Example: reword Q1" }).click();
        await page.keyboard.press("Escape");
        await expect(input).toBeFocused();
        await page.getByRole("button", { name: "Send refinement" }).click();
        await expect(
            page.getByRole("region", { name: "Proposed framing", exact: true }),
        ).toContainText(
            "Does CCC decide coordination rules, or execute workflows defined by insurers?",
        );
        const before = await input.boundingBox();
        expect(
            before &&
                before.y + before.height <= (page.viewportSize()?.height ?? 0),
        ).toBeTruthy();
        await page
            .getByRole("button", { name: "Start research", exact: true })
            .click();
        await page.setViewportSize({ width: 390, height: 844 });
        await page.getByRole("button", { name: "Ask AI", exact: true }).click();
        const followUp = page.getByRole("textbox", {
            name: "Ask about the sources",
        });
        await followUp.fill("Keep this draft\nwith a second line");
        await page
            .getByRole("button", { name: "Back to progress", exact: true })
            .click();
        await page.getByRole("button", { name: "Ask AI", exact: true }).click();
        await expect(followUp).toHaveValue(
            "Keep this draft\nwith a second line",
        );
        const box = await followUp.boundingBox();
        expect(box && box.y + box.height <= 844).toBeTruthy();
        await page.getByRole("button", { name: "Send refinement" }).click();
        await expect(page.getByRole("log")).toContainText("Keep this draft");
        expect(
            await page.evaluate(
                () => document.documentElement.scrollWidth <= window.innerWidth,
            ),
        ).toBe(true);
        expect(errors).toEqual([]);
    });
}

test("START the accepted program stays inspectable from the mobile chat context", async ({
    page,
}) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/?layout=start&screen=launched&theme=light");
    await page.getByRole("button", { name: "Ask AI", exact: true }).click();
    await page
        .getByRole("button", { name: "Research context", exact: true })
        .click();
    await inspectResearchProgram(page);
    await page
        .getByRole("button", { name: "View framing", exact: true })
        .click();
    await expect(
        page.getByRole("region", {
            name: "Accepted research program",
            exact: true,
        }),
    ).toBeInViewport();
});

test("START a freeform request stays visible without silently changing framing or moving the reader", async ({
    page,
}) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/?layout=start&screen=framing&theme=light");
    await reviewResearchProgram(page);
    const summary = page.getByRole("region", {
        name: "Framing summary",
        exact: true,
    });
    const before = await summary.textContent();
    const log = page.getByRole("log");
    const viewport = page.getByRole("region", {
        name: "Conversation scroll area",
        exact: true,
    });
    await viewport.evaluate((node) => {
        node.scrollTop = 0;
        node.dispatchEvent(new Event("scroll"));
    });
    const input = page.getByRole("textbox", {
        name: "Refine the framing in your own words",
    });
    await input.fill("Please investigate the network instead.");
    await page.getByRole("button", { name: "Send refinement" }).click();
    await expect(summary).toHaveText(before ?? "");
    await expect(log).toContainText("Please investigate the network instead.");
    await expect(page.locator("output")).toContainText(
        "freeform interpretation is not connected",
    );
    await expect
        .poll(() => viewport.evaluate((node) => node.scrollTop))
        .toBe(0);
});

test("START reference reading controls fill the floating composer without changing the research program", async ({
    page,
}) => {
    await page.goto("/?layout=start&screen=framing&theme=light");
    await reviewResearchProgram(page);
    const summary = page.getByRole("region", {
        name: "Framing summary",
        exact: true,
    });
    const initial = await summary.textContent();
    await page.getByText("Suggestions", { exact: true }).click();
    await page
        .getByRole("button", { name: "Control of coordination", exact: true })
        .click();
    const composer = page.getByRole("textbox", {
        name: "Refine the framing in your own words",
    });
    await expect(composer).toBeFocused();
    await expect(composer).toHaveValue(
        "Test control of coordination most closely.",
    );
    await expect(summary).toHaveText(initial ?? "");
});

test("START reference activity controls update the supplied scope and question program", async ({
    page,
}) => {
    await page.goto("/?layout=start&screen=framing&theme=light");
    await changeResearchScope(page);
    const activity = page.getByRole("radio", {
        name: "Repair network management",
        exact: true,
    });
    await activity.check();
    await expect(activity).toBeChecked();
    await page
        .getByRole("region", { name: "Proposed framing", exact: true })
        .getByRole("button", { name: "Continue", exact: true })
        .click();
    await reviewResearchProgram(page);
    const summary = page.getByRole("region", {
        name: "Proposed framing",
        exact: true,
    });
    await expect(summary).toContainText(
        "Who controls access to the repair network?",
    );
    await expect(
        summary.getByRole("combobox", {
            name: "Research question",
            exact: true,
        }),
    ).toContainText("of 3");
    await expect(
        page.getByRole("button", { name: "Start research", exact: true }),
    ).toBeEnabled();
    await expect(page).toHaveURL(/screen=framing/);
});

test("START pending actions stay above the composer and company-only clarification precedes framing", async ({
    page,
}) => {
    await page.goto("/?layout=start&screen=framing&theme=light");
    await page
        .getByRole("button", { name: "Company only", exact: true })
        .click();
    const log = page.getByRole("log");
    await expect(
        log.getByRole("region", { name: "Clarify research context" }),
    ).toHaveCount(0);
    await expect(
        page.getByRole("region", { name: "Clarify research context" }),
    ).toBeVisible();
    await expect(
        page.getByRole("region", { name: "Framing summary", exact: true }),
    ).toHaveCount(0);
    await page
        .getByRole("radio", { name: "Repair network management", exact: true })
        .click();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(log).toContainText("Repair network management");
    await expect(
        log.getByRole("region", { name: "Framing summary", exact: true }),
    ).toHaveCount(0);
    await expect(
        page.getByRole("region", { name: "Framing summary", exact: true }),
    ).toContainText("Who controls access to the repair network?");
});

test("START conversation scroll uses the pane width and offers a return to latest without moving its composer", async ({
    page,
}) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/?layout=start&screen=framing&theme=light");
    const log = page.getByRole("region", {
        name: "Conversation scroll area",
        exact: true,
    });
    const bounds = await log.boundingBox();
    const thread = await page
        .locator('[data-slot="conversation-scroll"]')
        .boundingBox();
    expect(
        bounds && thread && Math.abs(bounds.width - thread.width) < 2,
    ).toBeTruthy();
    const input = page.getByRole("textbox", {
        name: "Refine the framing in your own words",
    });
    for (let index = 0; index < 4; index++) {
        await input.fill(
            `Follow-up ${index}: ${"Examine the coordination dependencies. ".repeat(30)}`,
        );
        await page.getByRole("button", { name: "Send refinement" }).click();
    }
    const before = await input.boundingBox();
    await log.evaluate((node) => {
        node.scrollTop = 0;
        node.dispatchEvent(new Event("scroll"));
    });
    await expect(
        page.getByRole("button", { name: "Scroll to end", exact: true }),
    ).toBeVisible();
    const after = await input.boundingBox();
    expect(Math.abs((before?.y ?? 0) - (after?.y ?? 0))).toBeLessThan(1);
    await page
        .getByRole("button", { name: "Scroll to end", exact: true })
        .click();
    await expect
        .poll(() =>
            log.evaluate(
                (node) =>
                    node.scrollHeight - node.scrollTop - node.clientHeight,
            ),
        )
        .toBeLessThan(32);
});

test("START mobile pending framing keeps its launch action visible above the composer", async ({
    page,
}) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/?layout=start&screen=framing&theme=light");
    const start = page.getByRole("button", {
        name: "Start research",
        exact: true,
    });
    await expect(start).toBeInViewport();
    await expect(
        page.getByRole("textbox", {
            name: "Refine the framing in your own words",
        }),
    ).toBeInViewport();
});

test("START pending artifact stays anchored above the composer while the conversation scrolls", async ({
    page,
}) => {
    await page.setViewportSize({ width: 1440, height: 820 });
    await page.goto("/?layout=start&screen=framing&theme=light");
    const viewport = page.getByRole("region", {
        name: "Conversation scroll area",
        exact: true,
    });
    const artifact = page.locator('[data-slot="conversation-pending-details"]');
    await expect(
        viewport.getByRole("region", { name: "Pending action", exact: true }),
    ).toHaveCount(0);
    const composer = page.getByRole("textbox", {
        name: "Refine the framing in your own words",
    });
    for (let index = 0; index < 3; index++) {
        await composer.fill(
            `Follow-up ${index}: ${"Inspect the coordination rules. ".repeat(25)}`,
        );
        await page.getByRole("button", { name: "Send refinement" }).click();
    }
    const before = await artifact.boundingBox();
    const inputBefore = await composer.boundingBox();
    await viewport.evaluate((node) => {
        node.scrollTop = 0;
        node.dispatchEvent(new Event("scroll"));
    });
    const after = await artifact.boundingBox();
    const inputAfter = await composer.boundingBox();
    expect(Math.abs((before?.y ?? 0) - (after?.y ?? 0))).toBeLessThan(1);
    expect(Math.abs((inputBefore?.y ?? 0) - (inputAfter?.y ?? 0))).toBeLessThan(
        1,
    );
    expect((after?.y ?? 0) + (after?.height ?? 0)).toBeLessThan(
        inputAfter?.y ?? 0,
    );
    await expect(
        page.getByRole("button", { name: "Start research", exact: true }),
    ).toBeInViewport();
});

test("START preview tools stay secondary and close with Escape while navigation remains links", async ({
    page,
}) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/?layout=start&screen=framing&theme=dark");
    await expect(
        page
            .getByRole("navigation", { name: "Start screen previews" })
            .getByRole("link", { name: "framing", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await expect(
        page.getByRole("button", { name: "Fail next send" }),
    ).toHaveCount(0);
    const tools = page.getByRole("button", {
        name: "Preview tools",
        exact: true,
    });
    await tools.focus();
    await page.keyboard.press("Enter");
    await expect(
        page.getByRole("button", { name: "Fail next send" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(tools).toBeFocused();
    await expect(
        page.getByRole("button", { name: "Fail next send" }),
    ).not.toBeVisible();
    await expect(
        page.getByRole("button", { name: "Start research", exact: true }),
    ).toBeInViewport();
});
