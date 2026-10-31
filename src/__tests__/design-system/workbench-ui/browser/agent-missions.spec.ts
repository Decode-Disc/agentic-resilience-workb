import { expect, test } from "@playwright/test";

for (const theme of ["dark", "light"] as const) {
    for (const width of [1440, 390]) {
        test(`independent agent missions preserve the conversation at ${width}px in ${theme}`, async ({
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
            await page.clock.pauseAt(new Date(time.getTime() + 1000));
            await page.goto(`/?layout=start&screen=launched&theme=${theme}`);
            if (width === 390) {
                await page
                    .getByRole("button", { name: "Ask AI", exact: true })
                    .click();
                await page.clock.runFor(500);
            }
            const log = page.getByRole("log");
            const mission = log.getByRole("region", {
                name: "Sources · Documentary preparation",
                exact: true,
            });
            await expect(
                mission.getByRole("status", {
                    name: "Sources mission status",
                    exact: true,
                }),
            ).toBeVisible();
            await expect(
                page.getByRole("button", {
                    name: "Stop generation",
                    exact: true,
                }),
            ).toHaveCount(0);
            await expect(
                page.getByRole("textbox", {
                    name: "Ask about the sources",
                    exact: true,
                }),
            ).toBeEditable();
            const initialDuration = await mission
                .locator(".chat-mission-duration")
                .textContent();
            await page.clock.runFor(1000);
            await expect(
                mission.locator(".chat-mission-duration"),
            ).not.toHaveText(initialDuration ?? "");
            await page.screenshot({
                path: `/tmp/agent-missions-${theme}-${width}-working.png`,
            });
            const tools = page.getByRole("button", {
                name: "Preview tools",
                exact: true,
            });
            if (width === 390) {
                await page
                    .getByRole("button", {
                        name: "Back to progress",
                        exact: true,
                    })
                    .click();
                await page.clock.runFor(300);
            }
            await tools.click();
            await page.clock.runFor(300);
            await page
                .getByRole("button", {
                    name: "Example: ask during preparation",
                    exact: true,
                })
                .click();
            await page.clock.runFor(300);
            await page.keyboard.press("Escape");
            if (width === 390) {
                await page
                    .getByRole("button", { name: "Ask AI", exact: true })
                    .click();
                await page.clock.runFor(300);
            }
            const composer = page.getByRole("textbox", {
                name: "Ask about the sources",
                exact: true,
            });
            await expect(composer).toHaveValue(
                "Does this already establish that CCC controls the workflow?",
            );
            await composer.press("Enter");
            await page.clock.runFor(1000);
            await expect(
                page.getByRole("button", {
                    name: "Stop generation",
                    exact: true,
                }),
            ).toBeVisible();
            await expect(
                mission.getByRole("status", {
                    name: "Sources mission status",
                    exact: true,
                }),
            ).toBeVisible();
            await page.screenshot({
                path: `/tmp/agent-missions-${theme}-${width}-replying.png`,
            });
            if (width === 390) {
                await page
                    .getByRole("button", {
                        name: "Back to progress",
                        exact: true,
                    })
                    .click();
                await page.clock.runFor(300);
            }
            await tools.click();
            await page.clock.runFor(300);
            await page
                .getByRole("button", {
                    name: "Finish illustrative work",
                    exact: true,
                })
                .click();
            await page.clock.runFor(300);
            await page.keyboard.press("Escape");
            await expect(
                page.getByRole("heading", {
                    name: "Documentary material ready",
                    exact: true,
                }),
            ).toBeVisible();
            if (width === 390) {
                await page.screenshot({
                    path: `/tmp/agent-missions-${theme}-${width}-progress-completed.png`,
                });
                await page
                    .getByRole("button", { name: "Ask AI", exact: true })
                    .click();
                await page.clock.runFor(300);
            }
            await expect(
                log.getByText("Material ready for examination", {
                    exact: true,
                }),
            ).toHaveCount(0);
            const inspect = mission.getByRole("button", {
                name: "Inspect Sources mission: Documentary preparation",
                exact: true,
            });
            await expect(inspect).toHaveAttribute("aria-expanded", "false");
            await page.clock.runFor(6000);
            await page.clock.runFor(500);
            await expect(page).toHaveURL(/layout=start&screen=launched/);
            await expect(
                log.getByText("Material ready for examination", {
                    exact: true,
                }),
            ).toBeVisible();
            await expect(
                page.getByRole("button", {
                    name: "Stop generation",
                    exact: true,
                }),
            ).toHaveCount(0);
            const messages = await log.getByRole("article").allTextContents();
            expect(messages.at(-3)).toContain(
                "Does this already establish that CCC controls the workflow?",
            );
            expect(messages.at(-2)).toContain(
                "This illustrative exchange does not establish control or switching costs.",
            );
            expect(messages.at(-1)).toContain("Material ready for examination");
            await page.screenshot({
                path: `/tmp/agent-missions-${theme}-${width}-completed.png`,
            });
            await inspect.focus();
            await page.keyboard.press("Enter");
            await page.clock.runFor(300);
            await expect(
                mission.getByText("Find company reporting", { exact: true }),
            ).toBeVisible();
            await page.keyboard.press("Enter");
            await page.clock.runFor(300);
            await expect(inspect).toBeFocused();
            if (width === 390) {
                await page
                    .getByRole("button", {
                        name: "Back to progress",
                        exact: true,
                    })
                    .click();
                await page.clock.runFor(300);
            }
            await tools.click();
            await page.clock.runFor(300);
            await expect(
                page.getByRole("button", {
                    name: "Example: ask during preparation",
                    exact: true,
                }),
            ).toBeDisabled();
            await page.keyboard.press("Escape");
            expect(
                await page.evaluate(
                    () => document.documentElement.scrollWidth <= innerWidth,
                ),
            ).toBe(true);
            expect(errors).toEqual([]);
        });
    }
}
