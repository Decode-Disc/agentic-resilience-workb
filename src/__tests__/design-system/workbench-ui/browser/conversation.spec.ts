import { expect, test } from "@playwright/test";

for (const theme of ["light", "dark"] as const) {
    for (const width of [1440, 390]) {
        test(`START ${theme} ${width} growing reply respects the reader and stationary dock`, async ({
            page,
        }) => {
            const errors: string[] = [];
            page.on("pageerror", (error) => errors.push(error.message));
            await page.setViewportSize({
                width,
                height: width === 390 ? 844 : 1000,
            });
            await page.emulateMedia({
                reducedMotion: width === 1440 ? "no-preference" : "reduce",
            });
            const time = new Date("2026-10-31T12:00:00Z");
            await page.clock.install({ time });
            await page.clock.pauseAt(new Date(time.getTime() + 60_000));
            await page.goto(`/?layout=start&screen=framing&theme=${theme}`, {
                waitUntil: "domcontentloaded",
            });
            const viewport = page.getByRole("region", {
                name: "Conversation scroll area",
            });
            const dock = page.getByRole("region", { name: "Pending action" });
            const before = await dock.boundingBox();
            await page
                .getByRole("button", { name: "Preview tools", exact: true })
                .click();
            await page.clock.runFor(300);
            await page
                .getByRole("button", { name: "Grow illustrative reply" })
                .click();
            await page.keyboard.press("Escape");
            let lastLength =
                (await page.getByRole("log").textContent())?.length ?? 0;
            for (let reading = 1; reading <= 8; reading++) {
                await page.clock.runFor(250);
                await expect
                    .poll(
                        async () =>
                            (await page.getByRole("log").textContent())
                                ?.length ?? 0,
                    )
                    .toBeGreaterThan(lastLength);
                lastLength =
                    (await page.getByRole("log").textContent())?.length ?? 0;
                await expect(page.getByRole("log")).toContainText(
                    "Illustrative reading",
                );
            }
            await expect
                .poll(() => viewport.evaluate((node) => node.scrollTop))
                .toBeGreaterThan(0);
            await viewport.evaluate((node) => {
                node.scrollTop = 0;
                node.dispatchEvent(new Event("scroll"));
            });
            await expect
                .poll(async () => {
                    await page.clock.runFor(50);
                    return page
                        .getByRole("button", { name: "Scroll to end" })
                        .isVisible();
                })
                .toBe(true);
            const lengthWhenReaderLeft = lastLength;
            for (let reading = 9; reading <= 24; reading++) {
                await page.clock.runFor(250);
                await expect
                    .poll(
                        async () =>
                            (await page.getByRole("log").textContent())
                                ?.length ?? 0,
                    )
                    .toBeGreaterThanOrEqual(lastLength);
                lastLength =
                    (await page.getByRole("log").textContent())?.length ?? 0;
                await expect(page.getByRole("log")).toContainText(
                    "Illustrative reading",
                );
            }
            expect(lastLength).toBeGreaterThan(lengthWhenReaderLeft);
            await expect(
                page.getByRole("log").getByRole("article").last(),
            ).not.toHaveAttribute("aria-busy", "true");
            await expect(
                page.getByText("Workbench response", { exact: true }),
            ).toHaveCount(0);
            expect(
                await viewport.evaluate((node) => node.scrollTop),
            ).toBeLessThan(2);
            const after = await dock.boundingBox();
            expect(
                before && after && Math.abs(before.y - after.y),
            ).toBeLessThan(2);
            expect(
                before && after && Math.abs(before.height - after.height),
            ).toBeLessThan(2);
            await page.getByRole("button", { name: "Scroll to end" }).click();
            await page.clock.runFor(500);
            await expect
                .poll(() =>
                    viewport.evaluate(
                        (node) =>
                            node.scrollHeight -
                            node.scrollTop -
                            node.clientHeight,
                    ),
                )
                .toBeLessThan(32);
            expect(
                await page.evaluate(
                    () =>
                        document.documentElement.scrollWidth <=
                        window.innerWidth,
                ),
            ).toBe(true);
            expect(errors).toEqual([]);
        });
    }
}

test("START compact activities reveal useful material and keep their keyboard disclosure", async ({
    page,
}) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/?layout=start&screen=launched&theme=dark");
    await page.getByRole("button", { name: "Ask AI", exact: true }).click();
    await expect(
        page.getByRole("button", {
            name: "Inspect source preparation",
            exact: true,
        }),
    ).toHaveCount(0);
    const trigger = page.getByRole("button", {
        name: "Inspect Find company reporting",
        exact: true,
    });
    await expect(trigger).toContainText(
        "Looking for filings and earnings material about claims coordination.",
    );
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await trigger.focus();
    await page.keyboard.press("Enter");
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await expect(
        page.getByText(
            "Illustrative activity — these documents have not been retrieved by this preview.",
        ),
    ).toBeVisible();
    await expect(
        page.getByRole("textbox", { name: "Ask about the sources" }),
    ).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await expect(trigger).toBeFocused();
});

test("START copying initial and retained messages preserves text and creation time after reload", async ({
    page,
}) => {
    await page
        .context()
        .grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/?layout=start&screen=framing&theme=light");
    const initial = page
        .getByRole("log")
        .getByRole("article", { name: "You message" })
        .first();
    await initial.hover();
    await initial.getByRole("button", { name: "Copy message" }).click();
    await expect
        .poll(() => page.evaluate(() => navigator.clipboard.readText()))
        .toBe(
            "Does CCC control the photo-led claim workflow, or supply modules an agent could replace?",
        );
    await page
        .getByRole("textbox", { name: "Refine the framing in your own words" })
        .fill("Inspect **carrier control**.\nKeep the scope.");
    await page.getByRole("button", { name: "Send refinement" }).click();
    const message = page
        .getByRole("log")
        .getByRole("article", { name: "You message" })
        .last();
    await expect(message).toContainText("Inspect carrier control.");
    await message.getByRole("button", { name: "Copy message" }).click();
    await expect
        .poll(() => page.evaluate(() => navigator.clipboard.readText()))
        .toBe("Inspect **carrier control**.\nKeep the scope.");
    const createdAt = await message.locator("time").getAttribute("datetime");
    expect(createdAt).toBeTruthy();
    await page.reload();
    await expect(
        page
            .getByRole("log")
            .getByRole("article", { name: "You message" })
            .last()
            .locator("time"),
    ).toHaveAttribute("datetime", createdAt ?? "");
    await page.evaluate(() => {
        const key = "start-conversation-preview-v3";
        const saved = JSON.parse(
            sessionStorage.getItem("start-conversation-preview-v5") ?? "{}",
        );
        sessionStorage.removeItem("start-conversation-preview-v5");
        delete saved.version;
        delete saved.startedAt;
        saved.messages = saved.history
            .filter((entry: { kind: string }) => entry.kind === "message")
            .map((entry: { message: { createdAt?: string } }) => entry.message);
        delete saved.history;
        for (const message of saved.messages) delete message.createdAt;
        sessionStorage.setItem(key, JSON.stringify(saved));
    });
    await page.reload();
    const legacyMessage = page
        .getByRole("log")
        .getByRole("article", { name: "You message" })
        .last();
    await expect(legacyMessage.locator("time")).toHaveCount(0);
    await expect(
        legacyMessage.getByText("Time not recorded", { exact: true }),
    ).toBeVisible();
});

for (const theme of ["light", "dark"]) {
    for (const width of [390, 1440]) {
        test(`START ${theme} ${width} composer rests comfortably without losing its draft when focus leaves`, async ({
            page,
        }) => {
            await page.setViewportSize({ width, height: 1000 });
            await page.goto(`/?layout=start&screen=framing&theme=${theme}`);
            const input = page.getByRole("textbox", {
                name: "Refine the framing in your own words",
            });
            const composer = page.getByRole("form", {
                name: "Message the workbench",
            });
            const draft =
                "Examine decision rights.\nRetain competing interpretations.\nCheck substitution costs.";
            const resting = await composer.boundingBox();
            if (!resting) throw new Error("Missing resting composer");
            await input.fill(draft);
            await expect
                .poll(async () => (await composer.boundingBox())?.height ?? 0)
                .toBeGreaterThan(resting.height);
            const expanded = await composer.boundingBox();
            if (!expanded) throw new Error("Missing expanded composer");
            await page
                .getByRole("button", { name: "Send refinement", exact: true })
                .focus();
            await expect
                .poll(async () => (await composer.boundingBox())?.height)
                .toBe(expanded.height);
            await page
                .getByRole("navigation", { name: "Start screen previews" })
                .getByRole("link", { name: "framing", exact: true })
                .focus();
            await expect
                .poll(
                    async () =>
                        (await composer.boundingBox())?.height ?? Infinity,
                )
                .toBeLessThan(expanded.height);
            await input.focus();
            await expect(input).toHaveValue(draft);
            await expect
                .poll(async () => (await composer.boundingBox())?.height)
                .toBe(expanded.height);
        });
    }
}

for (const width of [390, 1440]) {
    test(`START ${width} research context opens from the header and preserves the draft`, async ({
        page,
    }) => {
        await page.setViewportSize({ width, height: 1000 });
        await page.goto("/?layout=start&screen=framing&theme=dark");
        if (width === 390)
            await page
                .getByRole("button", { name: "Research context", exact: true })
                .click();
        const log = page.getByRole("log");
        await expect(
            log.getByRole("button", { name: /Inspect reference/ }),
        ).toHaveCount(0);
        await expect(
            page.getByRole("heading", { name: "Plan", exact: true }),
        ).toBeVisible();
        await page
            .getByRole("button", {
                name: "Close research context",
                exact: true,
            })
            .click();
        const input = page.getByRole("textbox", {
            name: "Refine the framing in your own words",
        });
        await input.fill("Preserve this draft.");
        const context = page.getByRole("button", {
            name: "Research context",
            exact: true,
        });
        await context.focus();
        await page.keyboard.press("Enter");
        for (const name of ["Plan", "Outputs", "Sources"])
            await expect(
                page.getByRole("heading", { name, exact: true }),
            ).toBeVisible();
        const source = page.getByRole("button", {
            name: "Inspect reference: Investor day 2025 deck",
            exact: true,
        });
        await source.click();
        await expect(
            page.getByText("Not retrieved", { exact: true }),
        ).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(context).toBeFocused();
        await expect(input).toHaveValue("Preserve this draft.");
    });
}

test("START grouped work precedes the assistant answer and keeps details optional", async ({
    page,
}) => {
    await page.goto("/?layout=start&screen=framing&theme=light");
    await page
        .getByRole("button", { name: "Preview tools", exact: true })
        .click();
    await page
        .getByRole("button", { name: "Work then reply", exact: true })
        .click();
    await page
        .getByRole("button", { name: "Finish illustrative turn", exact: true })
        .click();
    await page.keyboard.press("Escape");
    const group = page.getByRole("button", {
        name: "Inspect work for this turn",
        exact: true,
    });
    await expect(group).toHaveAttribute("aria-expanded", "false");
    const operation = page.getByRole("button", {
        name: "Inspect Read the retained investor presentation",
        exact: true,
    });
    await expect(operation).not.toBeVisible();
    const before = await group.boundingBox();
    const answer = await page
        .getByRole("heading", {
            name: "Replacing software is not replacing coordination",
            exact: true,
        })
        .boundingBox();
    expect(before && answer && before.y < answer.y).toBe(true);
    await group.focus();
    await page.keyboard.press("Enter");
    await expect(operation).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(group).toBeFocused();
});

for (const width of [390, 1440])
    test(`START ${width} mission work stays continuous until completion and then folds`, async ({
        page,
    }) => {
        await page.setViewportSize({
            width,
            height: width === 390 ? 844 : 1000,
        });
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.goto("/?layout=start&screen=framing&theme=dark");
        await page
            .getByRole("textbox", {
                name: "Refine the framing in your own words",
            })
            .fill("Keep this trial draft.");
        await page
            .getByRole("button", { name: "Preview tools", exact: true })
            .click();
        await page
            .getByRole("button", { name: "Try activity grouping", exact: true })
            .click();
        await expect(page).toHaveURL(/screen=launched/);
        if (width === 390)
            await page
                .getByRole("button", { name: "Ask AI", exact: true })
                .click();
        const context = page.getByRole("button", {
            name: "Research context",
            exact: true,
        });
        const log = page.getByRole("log");
        const group = log
            .locator('[data-slot="conversation-mission"]')
            .last()
            .getByRole("button", {
                name: "Inspect Sources mission: Documentary preparation",
                exact: true,
            });
        await expect(group).toHaveCount(0);
        await expect(
            log.getByText("Check supplied reference", { exact: true }),
        ).toBeVisible();
        await expect(
            log.getByText("Find company reporting", { exact: true }),
        ).toBeVisible();
        const composer = page.getByRole("form", {
            name: "Message the workbench",
        });
        const before = await composer.boundingBox();
        const runWorkControl = async (name: string) => {
            if (width === 390)
                await page
                    .getByRole("button", {
                        name: "Back to progress",
                        exact: true,
                    })
                    .click();
            await page
                .getByRole("button", { name: "Preview tools", exact: true })
                .click();
            await page.getByRole("button", { name, exact: true }).click();
            await page.keyboard.press("Escape");
            if (width === 390)
                await page
                    .getByRole("button", { name: "Ask AI", exact: true })
                    .click();
        };
        await runWorkControl("Advance illustrative work");
        await expect(
            log.getByText(
                "Filing and earnings candidates listed; contents remain unverified.",
                { exact: true },
            ),
        ).toBeVisible();
        await expect(
            log.getByText("Find product and integration documentation", {
                exact: true,
            }),
        ).toBeVisible();
        await expect(group).toHaveCount(0);
        await context.click();
        await expect(
            page.getByText("1 working", { exact: true }),
        ).toBeVisible();
        await page
            .getByRole("button", {
                name: "Close research context",
                exact: true,
            })
            .click();
        await runWorkControl("Finish illustrative work");
        await expect(group).toHaveAttribute("aria-expanded", "false");
        await expect(
            log.getByText("Find company reporting", { exact: true }),
        ).not.toBeVisible();
        await expect(
            log.getByRole("heading", {
                name: "Material ready for examination",
                exact: true,
            }),
        ).toBeVisible();
        const after = await composer.boundingBox();
        expect(before && after && Math.abs(before.y - after.y)).toBeLessThan(2);
        await group.focus();
        await page.keyboard.press("Enter");
        await expect(
            log.getByText("Find company reporting", { exact: true }),
        ).toBeVisible();
        await context.click();
        await expect(
            page.getByText("No active work", { exact: true }),
        ).toBeVisible();
        await expect(
            page.getByText("Workbench response", { exact: true }),
        ).toHaveCount(0);
        await page
            .getByRole("button", {
                name: "Close research context",
                exact: true,
            })
            .click();
        if (width === 390)
            await page
                .getByRole("button", { name: "Back to progress", exact: true })
                .click();
        await page
            .getByRole("button", { name: "Preview tools", exact: true })
            .click();
        await expect(
            page.getByRole("button", {
                name: "Finish illustrative work",
                exact: true,
            }),
        ).toBeDisabled();
        await page
            .getByRole("button", {
                name: "Restart illustrative work",
                exact: true,
            })
            .click();
        await page.keyboard.press("Escape");
        if (width === 390)
            await page
                .getByRole("button", { name: "Ask AI", exact: true })
                .click();
        await expect(
            log.locator(
                '[data-slot="conversation-mission"][data-state="completed"]',
            ),
        ).toHaveCount(1);
        await expect(group).toHaveCount(0);
        await expect(
            log.getByText(
                "Looking for filings and earnings material about claims coordination.",
                { exact: true },
            ),
        ).toBeVisible();
        await expect(
            page.getByRole("textbox", { name: "Ask about the sources" }),
        ).toHaveValue("Keep this trial draft.");
        await runWorkControl("Finish illustrative work");
        await expect(group).toHaveAttribute("aria-expanded", "false");
        expect(errors).toEqual([]);
    });
