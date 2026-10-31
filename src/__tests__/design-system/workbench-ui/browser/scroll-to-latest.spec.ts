import { expect, test } from "@playwright/test";

for (const screen of ["framing", "launched"] as const) {
    for (const width of [320, 390, 768, 1440]) {
        test.describe(`${screen} jump to latest at ${width}px`, () => {
            test.use({
                viewport: { width, height: width < 640 ? 844 : 1000 },
                hasTouch: width < 1024,
            });

            test("waits until the reader leaves the end and cancels a brief departure", async ({
                page,
            }) => {
                const errors: string[] = [];
                page.on("pageerror", (error) => errors.push(error.message));
                const time = new Date("2026-10-31T12:00:00Z");
                await page.clock.install({ time });
                await page.clock.pauseAt(new Date(time.getTime() + 60_000));
                await page.goto(
                    `/?layout=start&screen=${screen}&theme=${width === 390 || width === 1440 ? "dark" : "light"}`,
                );
                if (screen === "launched" && width < 1024) {
                    await page
                        .getByRole("button", { name: "Ask AI", exact: true })
                        .click();
                    // Let the sheet restore its recorded reading position before simulating a new scroll.
                    await page.clock.runFor(300);
                }
                await page
                    .getByRole("textbox", {
                        name:
                            screen === "framing"
                                ? "Refine the framing in your own words"
                                : "Ask about the sources",
                    })
                    .fill(
                        Array.from(
                            { length: 50 },
                            (_, index) =>
                                `Reading point ${index + 1}: inspect how carrier control shapes claims coordination.`,
                        ).join("\n"),
                    );
                await page
                    .getByRole("button", {
                        name: "Send refinement",
                        exact: true,
                    })
                    .click();
                const viewport = page.getByRole("region", {
                    name: "Conversation scroll area",
                });
                const jump = page.getByRole("button", {
                    name: "Jump to latest",
                });
                const scrollFromEnd = (distance: number) =>
                    viewport.evaluate((node, offset) => {
                        node.scrollTop =
                            node.scrollHeight - node.clientHeight - offset;
                        node.dispatchEvent(new Event("scroll"));
                    }, distance);

                await scrollFromEnd(0);
                await page.clock.runFor(300);
                await expect(jump).toBeHidden();

                await scrollFromEnd(20);
                await page.clock.runFor(300);
                await expect(jump).toBeHidden();

                await scrollFromEnd(120);
                await page.clock.runFor(100);
                await expect(jump).toBeHidden();
                await page.clock.runFor(100);
                await expect(jump).toBeVisible();

                await scrollFromEnd(20);
                await expect(jump).toBeHidden();
                await scrollFromEnd(120);
                await page.clock.runFor(75);
                await scrollFromEnd(20);
                await page.clock.runFor(200);
                await expect(jump).toBeHidden();

                await scrollFromEnd(120);
                await page.clock.runFor(200);
                await jump.focus();
                await page.keyboard.press("Enter");
                await page.clock.runFor(300);
                await expect
                    .poll(() =>
                        viewport.evaluate(
                            (node) =>
                                node.scrollHeight -
                                node.clientHeight -
                                node.scrollTop,
                        ),
                    )
                    .toBeLessThan(2);
                await expect(jump).toBeHidden();
                await scrollFromEnd(120);
                await page.clock.runFor(200);
                await expect(jump).toBeVisible();
                await page.setViewportSize({
                    width,
                    height: width < 640 ? 1244 : 1400,
                });
                await page.clock.runFor(300);
                await expect(jump).toBeHidden();
                expect(errors).toEqual([]);
            });
        });
    }
}
