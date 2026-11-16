import { expect } from "@playwright/test";
import { test } from "../../../e2e/support/browser-workspace";
import { runConvexCli, runConvexJson } from "../../../e2e/support/convex-cli";
import { admitAnalyst } from "../../../e2e/support/source-review-fixture";

const scratch =
    process.env.SOURCES_TIME_LIMIT_SCREENSHOTS ?? "/tmp/sources-time-limit";
const raw =
    /sources_time_limit|time_limit|execution_time_limit|stale_execution/;

function fixture(name: string, runId: string, fixtureKey: string) {
    runConvexCli([
        "run",
        `execution/fixtures:${name}`,
        JSON.stringify({ runId, fixtureKey }),
        "--deployment",
        "local",
    ]);
}

for (const [width, choice] of [
    [1440, "settle"],
    [390, "continue"],
] as const) {
    test(`a Sources time limit leaves the analyst a real choice at ${width}px (${choice})`, async ({
        page,
    }) => {
        test.setTimeout(180000);
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("console", (message) => {
            if (message.type() === "error") errors.push(message.text());
        });
        await page.setViewportSize({ width, height: 844 });
        await admitAnalyst(page);
        const fixtureKey = `sources-time-limit-${width}-${Date.now()}`;
        const runId = runConvexJson<string>(
            "execution/fixtures:startWorkbench",
            { fixtureKey },
        );
        await page.goto(`/workspace/${runId}?section=progress`);
        await expect(
            page.getByText("Simulation: the research program is saved.", {
                exact: false,
            }),
        ).toBeVisible({ timeout: 60000 });
        fixture("reachSourcesTimeLimit", runId, fixtureKey);

        await expect(
            page.getByText("Preparation reached its time limit").first(),
        ).toBeVisible({ timeout: 30000 });
        const proceed = page.getByRole("button", {
            name: "Continue preparation",
        });
        const settle = page.getByRole("button", {
            name: "Use what's prepared",
        });
        await expect(proceed).toBeEnabled();
        await expect(settle).toBeEnabled();
        await expect(
            page.getByRole("button", { name: "Resume research" }),
        ).toHaveCount(0);
        await proceed.focus();
        await page.keyboard.press("Tab");
        await expect(settle).toBeFocused();
        expect(await page.locator("body").innerText()).not.toMatch(raw);
        await page.screenshot({
            path: `${scratch}-research-${width}.png`,
            fullPage: true,
        });

        await page.goto(`/workspace/${runId}?section=sources`);
        await expect(
            page.getByRole("heading", {
                name: "Preparation reached its time limit",
            }),
        ).toBeVisible({ timeout: 30000 });
        await expect(proceed).toBeVisible();
        expect(await page.locator("body").innerText()).not.toMatch(raw);
        await page.screenshot({
            path: `${scratch}-sources-${width}.png`,
            fullPage: true,
        });

        if (choice === "settle") {
            await settle.click();
            await expect(proceed).toBeDisabled();
            // The research workflow's own checkpoint and handoff, performed by the fixture.
            fixture("settleSourcesFixture", runId, fixtureKey);
            await expect(
                page.getByRole("heading", {
                    name: "Documentary preparation completed with limits",
                }),
            ).toBeVisible({ timeout: 30000 });
            await expect(settle).toHaveCount(0);
        } else {
            await page.keyboard.press("Tab");
            await proceed.focus();
            await page.keyboard.press("Enter");
            await expect(settle).toHaveCount(0, { timeout: 30000 });
            await expect(
                page.getByRole("heading", {
                    name: "Preparation reached its time limit",
                }),
            ).toHaveCount(0);
            await page.goto(`/workspace/${runId}?section=progress`);
            // Leave no running research behind for later fixtures.
            await page
                .getByRole("button", { name: "Pause research" })
                .click({ timeout: 30000 });
        }
        expect(await page.locator("body").innerText()).not.toMatch(raw);
        await page.screenshot({
            path: `${scratch}-after-${width}.png`,
            fullPage: true,
        });
        expect(errors).toEqual([]);
    });
}
