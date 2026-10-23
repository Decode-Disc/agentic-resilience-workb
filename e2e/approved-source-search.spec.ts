import { expect, test } from "@playwright/test";
import { runConvexJson } from "./support/convex-cli";
import {
    admitAnalyst,
    inspectSourceReview,
} from "./support/source-review-fixture";

for (const viewport of [
    { name: "desktop", width: 1440, height: 900 },
    { name: "mobile", width: 390, height: 844 },
]) {
    test(`searches previously unselected approved evidence and reconnects on ${viewport.name}`, async ({
        page,
    }, info) => {
        const started = Date.now();
        await page.setViewportSize(viewport);
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("console", (message) => {
            if (message.type() === "error") errors.push(message.text());
        });
        await admitAnalyst(page);
        const fixtureKey = `retrieval-review-approved-search-${viewport.name}-${Date.now()}`;
        const runId = runConvexJson<string>("retrievalEvaluation:seedReview", {
            slotKey: "analyst-1",
            fixtureKey,
        });
        console.log(
            JSON.stringify({
                fixtureKey,
                runId,
                phase: "seeded",
                elapsed: Date.now() - started,
            }),
        );
        await page.goto(`/workspace/${runId}?section=sources`);
        const approve = page.getByRole("button", {
            name: "Approve proposed corpus",
            exact: true,
        });
        const readingBeforeApproval = inspectSourceReview(
            runId,
            fixtureKey,
        ).sourceReading;
        expect(readingBeforeApproval).toBeDefined();
        await expect(approve).toBeEnabled();
        await expect(page.getByLabel("Search this source")).toHaveCount(0);
        await approve.focus();
        await page.keyboard.press("Enter");
        await expect(
            page.getByText("Corpus approved", { exact: true }),
        ).toBeVisible();
        expect(
            inspectSourceReview(runId, fixtureKey).sourceReading,
        ).toMatchObject({
            sourceCaptureId: readingBeforeApproval?.sourceCaptureId,
            qualificationTaskId: readingBeforeApproval?.qualificationTaskId,
        });
        const inspect = async () => {
            const row = page.getByRole("button", {
                name: "Open Illustrative workflow argument for review",
                exact: true,
            });
            await expect(row).toBeVisible();
            await row.focus();
            await page.keyboard.press("Enter");
            await page
                .getByRole("tab", { name: "Source details", exact: true })
                .click();
            const input = page.getByLabel("Search this source");
            await expect(input).toBeVisible();
            await input.fill("550");
            // A first read indexes the entire saved capture before serving text queries.
            await expect(
                page.getByRole("status", {
                    name: "Preparing source search",
                    exact: true,
                }),
            ).toBeHidden({ timeout: 30_000 });
            await expect(
                page.locator("blockquote").filter({
                    hasText: "Illustrative background paragraph 550.",
                }),
            ).toBeVisible();
        };
        console.log(
            JSON.stringify({
                phase: "approved",
                elapsed: Date.now() - started,
            }),
        );
        if (viewport.name === "mobile")
            await page
                .getByRole("button", { name: "Source actions", exact: true })
                .click();
        await page
            .getByRole("button", {
                name: "Inspect all candidates",
                exact: true,
            })
            .click();
        await expect(page).toHaveURL(/view=inspect/);
        await inspect();
        await page
            .locator("blockquote")
            .filter({ hasText: "Illustrative background paragraph 550." })
            .scrollIntoViewIfNeeded();
        await page.screenshot({
            path: info.outputPath("approved-source-search.png"),
        });
        await page.reload();
        await expect(page.getByLabel("Access code")).toHaveCount(0);
        await inspect();
        await expect
            .poll(() =>
                runConvexJson<{
                    lateEvidence: boolean;
                    unselectedPassageMaterialized: boolean;
                }>("retrievalEvaluation:inspectReview", { runId }),
            )
            .toMatchObject({
                lateEvidence: true,
                unselectedPassageMaterialized: false,
            });
        expect(inspectSourceReview(runId, fixtureKey).providerCallCount).toBe(
            0,
        );
        expect(errors).toEqual([]);
    });
}
