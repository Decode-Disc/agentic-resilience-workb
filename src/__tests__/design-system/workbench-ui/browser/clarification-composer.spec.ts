import { expect, test } from "@playwright/test";

for (const width of [1440, 390]) {
    test(`one scope action submits a selected proposal and preserves the ordinary draft ${width}`, async ({
        page,
    }) => {
        await page.setViewportSize({
            width,
            height: width === 390 ? 844 : 1000,
        });
        await page.goto("/?layout=start&screen=framing&theme=dark", {
            waitUntil: "domcontentloaded",
        });
        await page.getByRole("textbox").fill("Keep my unsent message.");
        await page
            .getByRole("button", { name: "Change scope", exact: true })
            .click();
        const program = page.getByRole("region", {
            name: "Proposed framing",
            exact: true,
        });
        await expect(program.getByRole("button")).toHaveCount(1);
        const proceed = program.getByRole("button", {
            name: "Continue",
            exact: true,
        });
        await expect(proceed).toBeEnabled();
        await expect(page.getByRole("textbox")).toHaveValue("");
        await page
            .getByRole("radio", {
                name: "Repair network management",
                exact: true,
            })
            .click();
        await page.keyboard.press("Enter");
        await expect(
            page.getByRole("region", { name: "Clarify research context" }),
        ).toHaveCount(0);
        await expect(
            page.getByRole("heading", {
                name: "Who controls access to the repair network?",
                exact: true,
            }),
        ).toBeVisible();
        await expect(page.getByRole("textbox")).toHaveValue(
            "Keep my unsent message.",
        );
        await expect(
            page.getByRole("button", { name: "Start research", exact: true }),
        ).toBeEnabled();
    });
}

test("typing a scope replaces the choice and choosing an option clears the alternative", async ({
    page,
}) => {
    await page.goto("/?layout=start&screen=framing&theme=dark", {
        waitUntil: "domcontentloaded",
    });
    await page
        .getByRole("button", { name: "Change scope", exact: true })
        .click();
    const input = page.getByRole("textbox");
    await input.fill("Claims intake");
    await expect(
        page.getByRole("radio", { name: "Photo-led auto claims", exact: true }),
    ).not.toBeChecked();
    await page
        .getByRole("radio", { name: "Repair network management", exact: true })
        .click();
    await expect(input).toHaveValue("");
    await input.fill("Claims intake");
    await input.press("Enter");
    await expect(
        page.getByRole("region", { name: "Plan", exact: true }),
    ).toContainText("Claims intake");
    await expect(
        page.getByRole("region", { name: "Clarify research context" }),
    ).toHaveCount(0);
});

test("failed scope selection stays retryable without leaking the selection key into the input", async ({
    page,
}) => {
    await page.goto("/?layout=start&screen=framing&theme=dark", {
        waitUntil: "domcontentloaded",
    });
    await page
        .getByRole("button", { name: "Change scope", exact: true })
        .click();
    await page
        .getByRole("radio", { name: "Repair network management", exact: true })
        .click();
    await page
        .getByRole("button", { name: "Preview tools", exact: true })
        .click();
    await page
        .getByRole("button", { name: "Fail next send", exact: true })
        .click();
    await page.keyboard.press("Escape");
    const proceed = page.getByRole("button", { name: "Continue", exact: true });
    await proceed.click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByRole("textbox")).toHaveValue("");
    await expect(
        page.getByRole("radio", {
            name: "Repair network management",
            exact: true,
        }),
    ).toBeChecked();
    await proceed.click();
    await expect(
        page.getByRole("region", { name: "Clarify research context" }),
    ).toHaveCount(0);
    await expect(page.getByRole("log")).toContainText(
        "Activity selected: Repair network management",
    );
});
