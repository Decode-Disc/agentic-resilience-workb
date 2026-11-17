import { expect, type Locator, test } from "@playwright/test";

for (const width of [1440, 390]) {
    test(`activity motion follows execution, visibility and reduced motion at ${width}px`, async ({
        page,
    }) => {
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.setViewportSize({ width, height: 600 });
        await page.emulateMedia({ reducedMotion: "no-preference" });
        await page.goto("/?component=AgentActivity&theme=dark");
        const mission = page.getByRole("region", {
            name: "Sources Agent · Documentary preparation",
            exact: true,
        });
        const status = mission.getByRole("status", {
            name: "Sources Agent mission status",
            exact: true,
        });
        await status.scrollIntoViewIfNeeded();
        await expect(status).toHaveText("Working");
        await expect.poll(() => runningLoops(status)).toBeGreaterThan(0);
        await page.screenshot({ path: `/tmp/working-shimmer-${width}.png` });
        await expect.poll(() => runningTextSweeps(status)).toBeGreaterThan(0);

        const selectState = async (name: string) => {
            await page
                .getByRole("combobox", { name: "Illustrative work state" })
                .click();
            await page.getByRole("option", { name, exact: true }).click();
        };
        await selectState("Paused");
        await expect(status).toHaveText("Paused");
        await expect.poll(() => runningLoops(status)).toBe(0);
        await selectState("Working");
        await status.scrollIntoViewIfNeeded();
        await expect.poll(() => runningLoops(status)).toBeGreaterThan(0);
        await mission
            .getByRole("button", {
                name: "Inspect Sources Agent mission: Documentary preparation",
                exact: true,
            })
            .click();
        await mission
            .getByRole("button", {
                name: "Earlier recorded activity · 200 operations",
                exact: true,
            })
            .click();
        await page
            .getByText(
                "Recorded inputs and outcomes remain separate from an analytical conclusion.",
                { exact: true },
            )
            .scrollIntoViewIfNeeded();
        await expect
            .poll(async () => (await status.boundingBox())?.y ?? Infinity)
            .toBeLessThan(0);
        await expect.poll(() => runningLoops(status)).toBe(0);
        await status.scrollIntoViewIfNeeded();
        await expect.poll(() => runningLoops(status)).toBeGreaterThan(0);

        await page.emulateMedia({ reducedMotion: "reduce" });
        await expect(status).toHaveText("Working");
        await expect.poll(() => runningLoops(status)).toBe(0);
        await page.screenshot({ path: `/tmp/activity-motion-${width}.png` });
        expect(errors).toEqual([]);
    });
}

async function runningLoops(region: Locator) {
    return region.evaluate(
        (node) =>
            node
                .getAnimations({ subtree: true })
                .filter(
                    (animation) =>
                        animation.playState === "running" &&
                        animation.effect?.getTiming().iterations === Infinity,
                ).length,
    );
}

async function runningTextSweeps(region: Locator) {
    return region.evaluate(
        (node) =>
            node.getAnimations({ subtree: true }).filter((animation) => {
                const effect = animation.effect;
                return (
                    animation.playState === "running" &&
                    effect instanceof KeyframeEffect &&
                    effect.target?.textContent === "Working" &&
                    effect
                        .getKeyframes()
                        .some((frame) =>
                            Object.keys(frame).some((key) =>
                                key.startsWith("backgroundPosition"),
                            ),
                        )
                );
            }).length,
    );
}
