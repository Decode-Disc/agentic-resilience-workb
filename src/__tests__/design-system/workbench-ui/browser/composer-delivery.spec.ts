import { expect, test } from "@playwright/test";

// Two response lifecycles, queue controls and captures run in one scenario.
test.setTimeout(60000);

for (const theme of ["light", "dark"])
    for (const width of [1440, 390])
        test(`composer delivery ${theme} ${width}`, async ({ page }) => {
            const errors: string[] = [];
            page.on("pageerror", (e) => errors.push(e.message));
            await page.setViewportSize({
                width,
                height: width === 390 ? 844 : 1000,
            });
            await page.emulateMedia({
                reducedMotion: width === 390 ? "reduce" : "no-preference",
            });
            const time = new Date("2026-11-01T10:00:00Z");
            await page.clock.install({ time });
            await page.clock.pauseAt(new Date(time.getTime() + 1000));
            await page.goto(`/?layout=start&screen=launched&theme=${theme}`);
            const tools = page.getByRole("button", {
                name: "Preview tools",
                exact: true,
            });
            await tools.click();
            await page.clock.runFor(250);
            await page
                .getByRole("button", {
                    name: "Grow illustrative reply",
                    exact: true,
                })
                .click();
            await page.keyboard.press("Escape");
            if (width === 390) {
                await page
                    .getByRole("button", { name: "Ask AI", exact: true })
                    .click();
                await page.clock.runFor(300);
            }
            const input = page.getByRole("textbox", {
                name: "Ask about the sources",
                exact: true,
            });
            const form = page.getByRole("form", {
                name: "Message the workbench",
            });
            await expect(
                form.getByRole("button", {
                    name: "Stop generation",
                    exact: true,
                }),
            ).toBeVisible();
            await expect(
                page.getByRole("log").getByRole("button", { name: /Stop/ }),
            ).toHaveCount(0);
            await input.press("Enter");
            await expect(
                form.getByRole("button", {
                    name: "Stop generation",
                    exact: true,
                }),
            ).toBeVisible();
            await page.screenshot({
                path: `/tmp/t3-stop-${theme}-${width}.png`,
            });
            await input.fill("Keep the evidence gap visible.");
            await input.press("Enter");
            const queue = page.getByRole("region", {
                name: "Queued messages",
                exact: true,
            });
            await expect(queue).toContainText("Keep the evidence gap visible.");
            await expect(input).toHaveValue("");
            await expect(
                form.getByRole("button", {
                    name: "Stop generation",
                    exact: true,
                }),
            ).toBeVisible();
            await input.fill("My unsent draft");
            await page
                .getByRole("button", {
                    name: "Composer tools",
                    exact: true,
                })
                .click();
            await page.clock.runFor(250);
            await page
                .getByRole("menuitem", { name: "Stop generation", exact: true })
                .click();
            await page.clock.runFor(250);
            await expect(input).toHaveValue("My unsent draft");
            await expect(queue).toBeVisible();
            await expect(
                page
                    .getByRole("log")
                    .getByRole("status", { name: "Sources mission status" }),
            ).toContainText("Working");
            await input.fill("");
            await form
                .getByRole("button", { name: "Resume queue", exact: true })
                .click();
            await page.clock.runFor(3000);
            await page.clock.runFor(300);
            await expect(queue).toHaveCount(0);
            await expect(page.getByRole("log")).toContainText(
                "Illustrative follow-up received: Keep the evidence gap visible.",
            );
            // Another active response receives an explicit steering instruction, preserving its turn.
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
            await page.clock.runFor(250);
            await page
                .getByRole("button", {
                    name: "Grow illustrative reply",
                    exact: true,
                })
                .click();
            await page.keyboard.press("Escape");
            if (width === 390) {
                await page
                    .getByRole("button", { name: "Ask AI", exact: true })
                    .click();
                await page.clock.runFor(300);
            }
            const turn = page
                .getByRole("log")
                .locator(
                    '[data-slot="conversation-turn"][data-state="running"]',
                );
            const id = await turn.getAttribute("data-message-id");
            await input.fill("Separate control from execution.");
            await input.press("Control+Enter");
            await expect(queue).toHaveCount(0);
            await expect(turn).toHaveAttribute("data-message-id", id ?? "");
            await page.clock.runFor(6000);
            await page.clock.runFor(500);
            await expect(page.getByRole("log")).toContainText(
                "Steering instruction received:",
            );
            expect(
                await page.evaluate(
                    () => document.documentElement.scrollWidth <= innerWidth,
                ),
            ).toBe(true);
            expect(errors).toEqual([]);
        });
