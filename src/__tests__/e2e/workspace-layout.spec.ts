import { expect } from "@playwright/test";
import { browserTestSlot, test } from "../../../e2e/support/browser-workspace";
import { runConvexJson } from "../../../e2e/support/convex-admin";
import { admitAnalyst } from "../../../e2e/support/source-review-fixture";

for (const width of [1440, 390]) {
    test(`workspace layout navigation preserves the conversation draft ${width}`, async ({
        page,
    }) => {
        test.setTimeout(150000);
        await page.setViewportSize({ width, height: 1000 });
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("console", (message) => {
            if (message.type() === "error") errors.push(message.text());
        });
        await admitAnalyst(page);
        const runId = await runConvexJson<string>(
            "execution/fixtures:startWorkbench",
            {
                fixtureKey: `workspace-layout-${width}`,
                slotKey: browserTestSlot(),
            },
        );
        // An old timeline link resolves to the dossier's Progress view; no separate page sits in front of it.
        await page.goto(`/workspace/${runId}?section=overview&detail=timeline`);
        await expect(
            page.getByRole("button", { name: "Back to research", exact: true }),
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
                        document.documentElement.scrollHeight > innerHeight + 1,
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
        await page.reload();
        await expect(draft).toBeInViewport({ timeout: 30000 });
        await expect(
            page.getByLabel("Access code", { exact: true }),
        ).toHaveCount(0);
        expect(errors).toEqual([]);
    });
}
