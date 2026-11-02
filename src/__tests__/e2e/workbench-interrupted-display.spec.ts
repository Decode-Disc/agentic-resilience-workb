import { expect } from "@playwright/test";
import { test } from "../../../e2e/support/browser-workspace";
import { runConvexCli, runConvexJson } from "../../../e2e/support/convex-cli";
import { admitAnalyst } from "../../../e2e/support/source-review-fixture";

for (const width of [1440, 390, 320]) {
    test(`an interrupted response stays readable above the framing dock at ${width}px`, async ({
        page,
    }) => {
        test.setTimeout(150000);
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("console", (message) => {
            if (message.type() === "error") errors.push(message.text());
        });
        await page.setViewportSize({ width, height: 844 });
        await admitAnalyst(page);
        const fixtureKey = `interrupted-display-${width}`;
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
        runConvexCli([
            "run",
            "execution/fixtures:interruptWorkbench",
            JSON.stringify({ runId, fixtureKey }),
            "--deployment",
            "local",
        ]);
        const alert = page
            .getByRole("alert")
            .filter({ hasText: "Response unavailable" });
        await expect(alert).toContainText("Send another message to continue.");
        const input = page.getByRole("textbox", {
            name: "Refine the framing in your own words",
        });
        const viewport = page.getByRole("region", {
            name: "Conversation scroll area",
        });
        await viewport.evaluate((node) => {
            node.scrollTop = node.scrollHeight;
        });
        await input.focus();
        await input.fill("Keep the saved program unchanged.");
        const dock = page.locator('[data-slot="conversation-thread-dock"]');
        const visible = async () => {
            const a = await alert.boundingBox(),
                d = await dock.boundingBox(),
                v = await viewport.boundingBox();
            return !!a && !!d && !!v && a.y + a.height <= d.y && a.y >= v.y;
        };
        await expect.poll(visible).toBe(true);
        await expect(input).toBeFocused();
        if (width <= 390) {
            await page.setViewportSize({ width, height: 520 });
            await expect.poll(visible).toBe(true);
            await expect(input).toBeFocused();
            await expect(input).toBeInViewport();
            await page
                .getByRole("button", { name: "Start research", exact: true })
                .click({ trial: true });
            await expect(input).toBeFocused();
            await page.screenshot({
                path: `/tmp/workbench-interrupted-${width}-short.png`,
            });
            await page.setViewportSize({ width, height: 844 });
            await expect.poll(visible).toBe(true);
        }
        await page.screenshot({
            path: `/tmp/workbench-interrupted-${width}.png`,
        });
        await page.reload();
        await expect(
            page.getByRole("region", { name: "Research framing", exact: true }),
        ).toBeVisible({ timeout: 60000 });
        await expect(alert).toBeVisible();
        await viewport.evaluate((node) => {
            node.scrollTop = node.scrollHeight;
        });
        await expect.poll(visible).toBe(true);
        await expect(page.locator("#invitation-code")).toHaveCount(0);
        await expect(
            page.getByText("Who controls the workflow and its rules?", {
                exact: true,
            }),
        ).toBeVisible();
        const snapshot = runConvexJson<{ providerCallCount: number }>(
            "execution/fixtures:inspectWorkbench",
            { runId, fixtureKey },
        );
        expect(snapshot.providerCallCount).toBe(0);
        expect(
            await page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth,
            ),
        ).toBe(true);
        expect(errors).toEqual([]);
    });
}
