import { expect, test } from "@playwright/test";
import {
    inspectResearchProgram,
    reviewResearchProgram,
} from "@/__tests__/helpers/research-program";

for (const width of [1440, 390]) {
    test(`the same conversation continues through research launch and reload at ${width}px`, async ({
        page,
    }) => {
        await page.setViewportSize({
            width,
            height: width === 390 ? 844 : 1000,
        });
        await page.goto("/?layout=start&screen=framing&theme=light");
        const initial = "I can help frame this research before it starts.";
        const refinement = "Keep the carrier's decision rights in view.";
        const log = page.getByRole("log");
        await expect(log.getByText(initial, { exact: true })).toBeVisible();
        await page
            .getByRole("textbox", {
                name: "Refine the framing in your own words",
            })
            .fill(refinement);
        await page
            .getByRole("button", { name: "Send refinement", exact: true })
            .click();
        await expect(log.getByText(refinement, { exact: true })).toBeVisible();
        const before = await log.getByRole("article").evaluateAll((messages) =>
            messages.map((message) => ({
                author: message.getAttribute("aria-label"),
                text: message.querySelector('[data-slot="message-content"]')
                    ?.textContent,
                date: message.querySelector("time")?.getAttribute("datetime"),
            })),
        );
        await page
            .getByRole("button", { name: "Start research", exact: true })
            .click();
        if (width === 390)
            await page
                .getByRole("button", { name: "Ask AI", exact: true })
                .click();
        await expect(log.getByText(initial, { exact: true })).toBeVisible();
        await expect(log.getByText(refinement, { exact: true })).toBeVisible();
        await expect(log.getByText(/Earlier conversation/)).toHaveCount(0);
        const assertRetained = async () => {
            const after = await log
                .getByRole("article")
                .evaluateAll((messages) =>
                    messages.map((message) => ({
                        author: message.getAttribute("aria-label"),
                        text: message.querySelector(
                            '[data-slot="message-content"]',
                        )?.textContent,
                        date: message
                            .querySelector("time")
                            ?.getAttribute("datetime"),
                    })),
                );
            expect(after.slice(0, before.length)).toEqual(before);
            for (const message of before)
                expect(
                    after.filter((entry) => entry.text === message.text),
                ).toHaveLength(1);
        };
        await assertRetained();
        await page.reload();
        if (width === 390)
            await page
                .getByRole("button", { name: "Ask AI", exact: true })
                .click();
        await expect(log.getByText(initial, { exact: true })).toBeVisible();
        await expect(log.getByText(refinement, { exact: true })).toBeVisible();
        await assertRetained();
    });
}

test("source preparation belongs to the same history and survives completion and reload", async ({
    page,
}) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/?layout=start&screen=framing&theme=light");
    await page
        .getByRole("button", { name: "Start research", exact: true })
        .click();
    const log = page.getByRole("log");
    await expect(
        log.getByRole("button", {
            name: "Inspect Find company reporting",
            exact: true,
        }),
    ).toBeVisible();
    const turn = log.locator('[data-slot="conversation-mission"]').last();
    await expect(turn).toHaveAttribute("data-state", "running");
    await page
        .getByRole("button", { name: "Preview tools", exact: true })
        .click();
    await page
        .getByRole("button", { name: "Advance illustrative work", exact: true })
        .click();
    await page.keyboard.press("Escape");
    await expect(
        log.getByRole("button", {
            name: "Inspect Find product and integration documentation",
            exact: true,
        }),
    ).toBeVisible();
    await page
        .getByRole("button", { name: "Preview tools", exact: true })
        .click();
    await page
        .getByRole("button", { name: "Finish illustrative work", exact: true })
        .click();
    await page.keyboard.press("Escape");
    await expect(turn).toHaveAttribute("data-state", "completed");
    const group = turn.getByRole("button", {
        name: "Inspect Sources Agent mission: Documentary preparation",
    });
    await expect(group).toHaveAttribute("aria-expanded", "false");
    await expect(log).toContainText("Material ready for examination");
    await page.reload();
    await expect(turn).toHaveAttribute("data-state", "completed");
    await expect(
        log.getByText("I can help frame this research before it starts.", {
            exact: true,
        }),
    ).toBeVisible();
    await expect(log.getByText(/Material ready for examination/)).toHaveCount(
        1,
    );
});

test("the accepted program remains inspectable from Plan without inserting another transcript", async ({
    page,
}) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/?layout=start&screen=framing&theme=dark");
    await page
        .getByRole("button", { name: "Start research", exact: true })
        .click();
    await expect(
        page.getByRole("log").getByText("Framing fixed", { exact: true }),
    ).toHaveCount(0);
    await inspectResearchProgram(page);
    await page
        .getByRole("region", { name: "Scope", exact: true })
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
    await expect(
        page
            .getByRole("log")
            .getByText("I can help frame this research before it starts.", {
                exact: true,
            }),
    ).toBeVisible();
});

test("an unreadable saved preview is explained before an explicit reset", async ({
    page,
}) => {
    await page.addInitScript(() =>
        sessionStorage.setItem("start-conversation-preview-v5", "invalid-json"),
    );
    await page.goto("/?layout=start&screen=framing&theme=light");
    await expect(
        page.getByText(
            "Saved preview could not be restored. Its saved data was preserved. Reset the preview to start again.",
            { exact: true },
        ),
    ).toBeVisible();
    expect(
        await page.evaluate(() =>
            sessionStorage.getItem("start-conversation-preview-v5"),
        ),
    ).toBe("invalid-json");
    await page
        .getByRole("button", { name: "Preview tools", exact: true })
        .click();
    await page
        .getByRole("button", { name: "Reset preview", exact: true })
        .click();
    await page.keyboard.press("Escape");
    await expect(
        page
            .getByRole("log")
            .getByText("I can help frame this research before it starts.", {
                exact: true,
            }),
    ).toBeVisible();
    expect(
        JSON.parse(
            (await page.evaluate(() =>
                sessionStorage.getItem("start-conversation-preview-v5"),
            )) ?? "null",
        ).version,
    ).toBe(5);
});

test("Back and Forward retain the same conversation and preparation mission", async ({
    page,
}) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/?layout=start&screen=framing&theme=light");
    await page
        .getByRole("button", { name: "Start research", exact: true })
        .click();
    await page
        .getByRole("textbox", { name: "Ask about the sources" })
        .fill("Keep this draft across navigation.");
    const turn = page
        .getByRole("log")
        .locator('[data-slot="conversation-mission"]');
    const id = await turn.getAttribute("data-mission-id");
    await page.goBack();
    await expect(page).toHaveURL(/screen=framing/);
    await expect(
        page.getByRole("region", {
            name: "Accepted research program",
            exact: true,
        }),
    ).toBeVisible();
    await expect(
        page.getByRole("textbox", { name: "Ask about the sources" }),
    ).toHaveValue("Keep this draft across navigation.");
    await page.goForward();
    await expect(page).toHaveURL(/screen=launched/);
    await expect(turn).toHaveCount(1);
    await expect(turn).toHaveAttribute("data-mission-id", id ?? "");
    await expect(turn).toHaveAttribute("data-state", "running");
    await expect(
        page.getByRole("textbox", { name: "Ask about the sources" }),
    ).toHaveValue("Keep this draft across navigation.");
});

for (const width of [1440, 390]) {
    test(`returning from launched preserves the framing panel and its attached composer at ${width}px`, async ({
        page,
    }) => {
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.setViewportSize({
            width,
            height: width === 390 ? 844 : 1000,
        });
        await page.goto("/?layout=start&screen=framing&theme=dark");
        await page
            .getByRole("button", { name: "Start research", exact: true })
            .click();
        if (width === 390)
            await page
                .getByRole("button", { name: "Ask AI", exact: true })
                .click();
        await page
            .getByRole("textbox", {
                name: "Ask about the sources",
                exact: true,
            })
            .fill("Keep this follow-up draft.");
        const saved = await page.evaluate(() =>
            sessionStorage.getItem("start-conversation-preview-v5"),
        );
        if (width === 390) {
            await page
                .getByRole("button", { name: "Research context", exact: true })
                .click();
            await page
                .getByRole("button", { name: "View framing", exact: true })
                .click();
        } else {
            await page
                .getByRole("navigation", { name: "Start screen previews" })
                .getByRole("link", { name: "framing", exact: true })
                .click();
        }
        const program = page.getByRole("region", {
            name: "Accepted research program",
            exact: true,
        });
        const header = program
            .locator("summary")
            .filter({ hasText: "Accepted research program" });
        await expect(header).toBeVisible();
        const composer = program.getByRole("textbox", {
            name: "Ask about the sources",
            exact: true,
        });
        await expect(composer).toBeInViewport();
        await expect(composer).toHaveValue("Keep this follow-up draft.");
        await expect(
            program.getByRole("region", {
                name: "Proposed research scope",
                exact: true,
            }),
        ).toHaveCount(0);
        await expect(
            page.getByRole("button", {
                name: /^(Start research|Edit question|Add research question)$/,
            }),
        ).toHaveCount(0);
        const question = program.getByRole("heading", {
            name: "Does CCC control coordination, or supply replaceable modules?",
            exact: true,
        });
        await expect(question).not.toBeVisible();
        await reviewResearchProgram(page);
        await expect(question).toBeVisible();
        await header.focus();
        await page.keyboard.press("Enter");
        await expect(question).not.toBeVisible();
        await expect(composer).toBeVisible();
        await expect(composer).toHaveValue("Keep this follow-up draft.");
        await page.keyboard.press("Enter");
        await expect(question).toBeVisible();
        expect(
            await page.evaluate(() =>
                sessionStorage.getItem("start-conversation-preview-v5"),
            ),
        ).toBe(saved);
        expect(
            await page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth,
            ),
        ).toBe(true);
        expect(errors).toEqual([]);
    });
}

for (const width of [1440, 390]) {
    test(`restored interrupted preparation explains what remains and offers recovery at ${width}px`, async ({
        page,
    }) => {
        await page.setViewportSize({
            width,
            height: width === 390 ? 844 : 1000,
        });
        await page.goto(
            `/?layout=start&screen=launched&theme=${width === 390 ? "dark" : "light"}`,
        );
        await page.reload();
        const progress = page.getByRole("region", {
            name: "Documentary progress",
            exact: true,
        });
        await expect(
            progress.getByRole("heading", {
                name: "Documentary preparation stopped",
                exact: true,
            }),
        ).toBeVisible();
        const notice = progress.getByRole("status", {
            name: "Source preparation interrupted",
            exact: true,
        });
        await expect(notice).toBeVisible();
        await expect(notice).toContainText(
            "Listed documents and your conversation are preserved.",
        );
        await expect(
            progress.getByText("Capturing", { exact: true }),
        ).toHaveCount(0);
        await expect(
            progress.getByText("capturing", { exact: true }),
        ).toHaveCount(0);
        await expect(
            progress.getByText("Waiting", { exact: true }),
        ).toBeVisible();
        const oldTurnId = await page.evaluate(
            () =>
                JSON.parse(
                    sessionStorage.getItem("start-conversation-preview-v5") ??
                        "null",
                ).sourcePreparationMissionId,
        );
        const restart = notice.getByRole("button", {
            name: "Restart illustrative work",
            exact: true,
        });
        await restart.focus();
        await page.keyboard.press("Enter");
        await expect(notice).toHaveCount(0);
        await expect(
            progress.getByRole("heading", {
                name: "Collecting the documentary material",
                exact: true,
            }),
        ).toBeVisible();
        await expect(
            progress.getByText("Capturing", { exact: true }),
        ).toBeVisible();
        const saved = await page.evaluate(() =>
            JSON.parse(
                sessionStorage.getItem("start-conversation-preview-v5") ??
                    "null",
            ),
        );
        expect(
            saved.missions.find((turn: { id: string }) => turn.id === oldTurnId)
                .state,
        ).toBe("interrupted");
        expect(saved.sourcePreparationMissionId).not.toBe(oldTurnId);
        if (width === 390)
            await page
                .getByRole("button", { name: "Ask AI", exact: true })
                .click();
        await expect(
            page
                .getByRole("log")
                .getByText("I can help frame this research before it starts.", {
                    exact: true,
                }),
        ).toBeVisible();
    });
}
