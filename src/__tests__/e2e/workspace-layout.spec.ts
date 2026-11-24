import type { internal } from "@convex/_generated/api";
import { expect } from "@playwright/test";
import type { FunctionReturnType } from "convex/server";
import { browserTestSlot, test } from "../../../e2e/support/browser-workspace";
import { runConvexJson } from "../../../e2e/support/convex-admin";
import { admitAnalyst } from "../../../e2e/support/source-review-fixture";

for (const width of [1440, 390]) {
    test(`workspace History and Inventory navigation preserve the unsent draft ${width}`, async ({
        page,
    }) => {
        test.setTimeout(150000);
        await page.setViewportSize({ width, height: 1000 });
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("console", (message) => {
            if (message.type() === "error") errors.push(message.text());
        });
        try {
            await admitAnalyst(page);
            const fixtureKey = `workspace-layout-${width}`;
            const runId = await runConvexJson<string>(
                "execution/fixtures:startWorkbench",
                {
                    fixtureKey,
                    slotKey: browserTestSlot(),
                },
            );
            // History belongs to the post-launch stage; an unlaunched dossier still opens framing.
            await page.goto(
                `/workspace/${runId}?section=overview&detail=timeline`,
            );
            await expect(
                page.getByRole("button", {
                    name: "Back to research",
                    exact: true,
                }),
            ).toHaveCount(0);
            const draft = page.getByRole("textbox", {
                name: "Refine the framing in your own words",
                exact: true,
            });
            await expect(draft).toBeVisible({ timeout: 60000 });
            await draft.fill("Keep this draft while inspecting progress.");
            await expect(draft).toBeFocused();
            await expect(draft).toBeInViewport();
            await expect
                .poll(() =>
                    page.evaluate(() => ({
                        wide: document.documentElement.scrollWidth > innerWidth,
                        tall:
                            document.documentElement.scrollHeight >
                            innerHeight + 1,
                    })),
                )
                .toEqual({ wide: false, tall: false });

            await page
                .getByRole("button", { name: "Switch theme", exact: true })
                .click();
            await expect(draft).toHaveValue(
                "Keep this draft while inspecting progress.",
            );
            await expect(draft).toBeInViewport();
            await page.screenshot({
                path: `/tmp/workspace-layout-after-${width}.png`,
            });
            const inspect = () =>
                runConvexJson<
                    FunctionReturnType<
                        typeof internal.execution.fixtures.inspectWorkbench
                    >
                >("execution/fixtures:inspectWorkbench", { runId, fixtureKey });
            await expect.poll(inspect, { timeout: 60_000 }).toMatchObject({
                nativeSettled: true,
                framing: expect.any(Object),
                providerCallCount: 0,
            });
            const beforeNavigation = await inspect();
            // Seed only the layout state here; the START scenario owns the public launch transaction.
            await runConvexJson("execution/fixtures:revealWorkbenchSources", {
                runId,
                fixtureKey,
            });
            const history = page.getByRole("button", { name: /^History/ });
            await expect(history).toHaveAttribute("aria-expanded", "true");
            const historyPanel = page.locator(
                `[id="${await history.getAttribute("aria-controls")}"]`,
            );
            await expect(historyPanel.getByRole("listitem")).not.toHaveCount(0);
            await history.focus();
            await history.press("Enter");
            await expect(historyPanel).toBeHidden();
            await history.press("Enter");
            await expect(historyPanel).toBeVisible();

            const followup = page.getByRole("textbox", {
                name: "Ask about the sources",
                exact: true,
            });
            if (width === 390)
                await page
                    .getByRole("button", { name: "Ask AI", exact: true })
                    .click();
            await expect(followup).toHaveValue(
                "Keep this draft while inspecting progress.",
            );
            if (width === 390)
                await page
                    .getByRole("button", {
                        name: "Back to progress",
                        exact: true,
                    })
                    .click();
            const inventoryTrigger = page.getByRole("button", {
                name: "Open evidence inventory",
            });
            const inventory = page.getByRole("dialog", {
                name: "Evidence inventory",
                exact: true,
            });
            await inventoryTrigger.click();
            await expect(page).toHaveURL(/inventory=1/);
            await expect(inventory).toBeVisible();
            await page.goBack();
            await expect(inventory).toBeHidden();
            await page.goForward();
            await expect(inventory).toBeVisible();
            await page.keyboard.press("Escape");
            await expect(inventory).toBeHidden();
            await expect(inventoryTrigger).toBeFocused();
            if (width === 390)
                await page
                    .getByRole("button", { name: "Ask AI", exact: true })
                    .click();
            await expect(followup).toHaveValue(
                "Keep this draft while inspecting progress.",
            );
            await expect(followup).toBeInViewport();
            await page.screenshot({
                path: test
                    .info()
                    .outputPath(`draft-after-navigation-${width}.png`),
            });
            await page.reload();
            await expect(history).toHaveAttribute("aria-expanded", "true");
            if (width === 390)
                await page
                    .getByRole("button", { name: "Ask AI", exact: true })
                    .click();
            await expect(followup).toBeInViewport({ timeout: 30000 });
            expect(await inspect()).toMatchObject({
                providerCallCount: 0,
                missionCount: beforeNavigation.missionCount,
                invocationCount: beforeNavigation.invocationCount,
            });
            await expect(
                page.getByLabel("Access code", { exact: true }),
            ).toHaveCount(0);
            expect(errors).toEqual([]);
        } finally {
            await test.info().attach("browser-errors", {
                body: JSON.stringify(errors, null, 2),
                contentType: "application/json",
            });
        }
    });
}
