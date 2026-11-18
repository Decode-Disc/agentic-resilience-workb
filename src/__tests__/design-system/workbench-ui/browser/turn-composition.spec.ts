import { expect, test } from "@playwright/test";
import { reviewResearchProgram } from "@/__tests__/helpers/research-program";

for (const width of [1440, 390])
    for (const theme of ["light", "dark"]) {
        test(`turn composition ${theme} ${width}`, async ({ page }) => {
            const errors: string[] = [];
            page.on("pageerror", (e) => errors.push(e.message));
            await page.setViewportSize({ width, height: 1000 });
            await page.emulateMedia({
                reducedMotion: width === 1440 ? "no-preference" : "reduce",
            });
            // Keep native animation and JavaScript time on the same browser clock.
            await page.goto(`/?layout=start&screen=framing&theme=${theme}`);
            await page
                .getByRole("button", { name: "Preview tools", exact: true })
                .click();
            await page
                .getByRole("button", { name: "Work then reply", exact: true })
                .click();
            await page.keyboard.press("Escape");
            await expect(
                page.getByRole("button", {
                    name: "Inspect Read the retained investor presentation",
                }),
            ).toBeVisible();
            await expect(
                page.getByRole("button", {
                    name: "Inspect work for this turn",
                }),
            ).toHaveAttribute("aria-expanded", "false");
            await expect(
                page.getByRole("heading", {
                    name: "Replacing software is not replacing coordination",
                    exact: true,
                }),
            ).toBeVisible({ timeout: test.info().timeout });
            const group = page.getByRole("button", {
                name: "Inspect work for this turn",
            });
            await expect(group).toHaveAttribute("aria-expanded", "false");
            await expect(
                page.getByRole("columnheader", { name: "What to test" }),
            ).toBeVisible();
            await group.click();
            await expect(
                page.getByText(
                    "I'll compare the retained material on integrations and coordination.",
                    { exact: true },
                ),
            ).toBeVisible();
            await expect(
                page.getByRole("columnheader", { name: "What to test" }),
            ).toBeVisible();
            const note = page.getByRole("note", {
                name: "Workbench Agent progress note",
            });
            await expect(note).toBeVisible();
            await expect(note.getByRole("button")).toHaveCount(0);
            const answer = page.getByRole("heading", {
                name: "Replacing software is not replacing coordination",
                exact: true,
            });
            expect(
                await answer.evaluate(
                    (node) => node.closest(".chat-work-entries") === null,
                ),
            ).toBe(true);
            await expect
                .poll(() =>
                    note.evaluate((element) => {
                        let opacity = 1;
                        for (
                            let node: HTMLElement | null =
                                element as HTMLElement;
                            node;
                            node = node.parentElement
                        )
                            opacity *= Number(getComputedStyle(node).opacity);
                        return opacity;
                    }),
                )
                .toBeGreaterThan(0.99);
            await page.screenshot({
                path: `/tmp/work-log-after-${theme}-${width}.png`,
            });
            const operation = page.getByRole("button", {
                name: "Inspect Read the retained investor presentation",
                exact: true,
            });
            await operation.focus();
            await page.keyboard.press("Enter");
            await expect(
                page.getByText(
                    "Illustrative reading: coordination and network participation.",
                    { exact: true },
                ),
            ).toBeVisible();
            expect(
                await page.evaluate(
                    () => document.documentElement.scrollWidth <= innerWidth,
                ),
            ).toBe(true);
            expect(errors).toEqual([]);
        });
    }
test("question actions share the composer and keep its ordinary draft", async ({
    page,
}) => {
    await page.goto("/?layout=start&screen=framing&theme=dark");
    const input = page.getByRole("textbox");
    await input.fill("Keep my unsent message.");
    await reviewResearchProgram(page);
    await page
        .getByRole("button", { name: "Add research question", exact: true })
        .click();
    await expect(page.getByRole("textbox")).toHaveCount(1);
    await expect(
        page.getByRole("button", { name: "Start research", exact: true }),
    ).toHaveCount(0);
    await input.fill("Can agents alter pricing power?");
    await page
        .getByRole("button", { name: "Add question", exact: true })
        .click();
    await expect(
        page.getByRole("heading", { name: "Can agents alter pricing power?" }),
    ).toBeVisible();
    await expect(input).toHaveValue("Keep my unsent message.");
    await reviewResearchProgram(page);
    await page
        .getByRole("button", { name: "Edit question", exact: true })
        .click();
    await expect(input).toHaveValue("Can agents alter pricing power?");
    await input.fill("Who can change pricing?");
    await page
        .getByRole("button", { name: "Save changes", exact: true })
        .click();
    await expect(
        page.getByRole("heading", { name: "Who can change pricing?" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /^5 / })).toHaveAttribute(
        "aria-expanded",
        "true",
    );
    await reviewResearchProgram(page);
    await page
        .getByRole("button", { name: "Edit question", exact: true })
        .click();
    await input.fill("Discard this edit");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(
        page.getByRole("heading", { name: "Who can change pricing?" }),
    ).toBeVisible();
});

test("stopping a turn retains its partial answer after reload", async ({
    page,
}) => {
    const time = new Date("2026-10-31T12:00:00Z");
    await page.clock.install({ time });
    await page.clock.pauseAt(new Date(time.getTime() + 60_000));
    await page.goto("/?layout=start&screen=framing&theme=dark");
    await page
        .getByRole("button", { name: "Preview tools", exact: true })
        .click();
    await page.clock.runFor(300);
    await page
        .getByRole("button", { name: "Work then reply", exact: true })
        .click();
    await page.keyboard.press("Escape");
    await page.clock.runFor(2500);
    await page
        .getByRole("button", { name: "Stop generation", exact: true })
        .click();
    await expect(
        page.getByRole("button", { name: "Inspect work for this turn" }),
    ).toContainText("Interrupted");
    await expect(
        page
            .getByText(
                "Response interrupted. The partial reply remains available.",
            )
            .first(),
    ).toBeVisible();
    const partial = await page
        .locator("[data-slot=conversation-turn] [data-slot=message-content]")
        .last()
        .textContent();
    await page.reload();
    await expect(
        page.getByRole("button", { name: "Inspect work for this turn" }),
    ).toContainText("Interrupted");
    expect(
        await page
            .locator(
                "[data-slot=conversation-turn] [data-slot=message-content]",
            )
            .last()
            .textContent(),
    ).toBe(partial);
});

test("preview tools advance and finish the same turn explicitly", async ({
    page,
}) => {
    const time = new Date("2026-10-31T12:00:00Z");
    await page.clock.install({ time });
    await page.clock.pauseAt(new Date(time.getTime() + 60_000));
    await page.goto("/?layout=start&screen=framing&theme=dark");
    await page
        .getByRole("button", { name: "Preview tools", exact: true })
        .click();
    await page.clock.runFor(300);
    await page
        .getByRole("button", { name: "Work then reply", exact: true })
        .click();
    await page.keyboard.press("Escape");
    await page
        .getByRole("button", { name: "Preview tools", exact: true })
        .click();
    await page.clock.runFor(300);
    await page
        .getByRole("button", { name: "Advance illustrative turn", exact: true })
        .click();
    await expect(
        page.getByRole("button", {
            name: "Inspect Compare switching dependencies",
        }),
    ).toBeVisible();
    await page
        .getByRole("button", { name: "Finish illustrative turn", exact: true })
        .click();
    await page.keyboard.press("Escape");
    await expect(
        page.getByRole("button", { name: "Inspect work for this turn" }),
    ).toContainText("2 operations");
    await expect(
        page.getByRole("columnheader", { name: "What to test" }),
    ).toBeVisible();
});

test("failed question submission preserves both drafts and retries once", async ({
    page,
}) => {
    await page.goto("/?layout=start&screen=framing&theme=dark");
    const input = page.getByRole("textbox");
    await input.fill("My unsent conversation draft.");
    await reviewResearchProgram(page);
    await page
        .getByRole("button", { name: "Add research question", exact: true })
        .click();
    await input.fill("Who can redirect this workflow?");
    await page
        .getByRole("button", { name: "Preview tools", exact: true })
        .click();
    await page
        .getByRole("button", { name: "Fail next send", exact: true })
        .click();
    await page.keyboard.press("Escape");
    await page
        .getByRole("button", { name: "Add question", exact: true })
        .click();
    const error = page.getByRole("alert");
    await expect(error).toContainText("Your changes could not be saved");
    await expect(input).toHaveValue("Who can redirect this workflow?");
    await expect(
        page.getByRole("button", { name: "Start research", exact: true }),
    ).toHaveCount(0);
    await error.getByRole("button", { name: "Try again", exact: true }).click();
    await expect(
        page.getByRole("heading", {
            name: "Who can redirect this workflow?",
            exact: true,
        }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /^5 / })).toHaveAttribute(
        "aria-expanded",
        "true",
    );
    await expect(input).toHaveValue("My unsent conversation draft.");
    await expect(error).toHaveCount(0);
});

test("question actions open on the first click from a resting composer", async ({
    page,
}) => {
    await page.goto("/?layout=start&screen=framing&theme=dark");
    await reviewResearchProgram(page);
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
        page.getByRole("button", { name: "Add question", exact: true }),
    ).toBeDisabled();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(
        page.getByRole("button", {
            name: "Add research question",
            exact: true,
        }),
    ).toBeFocused();
    await reviewResearchProgram(page);
    await page
        .getByRole("button", { name: "Edit question", exact: true })
        .click();
    await expect(
        page.getByRole("textbox", {
            name: "Edit research question",
            exact: true,
        }),
    ).toBeFocused();
});
