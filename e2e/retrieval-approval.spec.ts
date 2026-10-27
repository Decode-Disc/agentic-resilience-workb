import { test } from "./support/browser-workspace";
import { expect } from "@playwright/test";
import type { FunctionReturnType } from "convex/server";
import type { internal } from "@convex/_generated/api";
import { runConvexJson } from "./support/convex-cli";
import { admitAnalyst } from "./support/source-review-fixture";
import { expectAdmissionClosed } from "./support/admission";

type Inspection = FunctionReturnType<
    typeof internal.retrievalEvaluation.inspectReview
>;
for (const viewport of [
    { name: "desktop", width: 1440, height: 900 },
    { name: "mobile", width: 390, height: 844 },
]) {
    test(`approved late preparation evidence survives materialization and reconnection on ${viewport.name}`, async ({
        page,
    }, testInfo) => {
        await page.setViewportSize(viewport);
        const pageErrors: string[] = [];
        page.on("pageerror", (error) => pageErrors.push(error.message));
        const consoleErrors: string[] = [];
        const aborted = new WeakSet<object>();
        let initiatedAborts = 0;
        let matchedAborts = 0;
        let abortConsoleErrors = 0;
        // Existing protected browser gates abort the Google favicon dependency and correlate every failure.
        await page.route(
            "https://www.google.com/s2/favicons**",
            async (route) => {
                aborted.add(route.request());
                initiatedAborts++;
                await route.abort();
            },
        );
        page.on("requestfailed", (request) => {
            if (aborted.has(request)) {
                matchedAborts++;
                return;
            }
            const url = new URL(request.url());
            consoleErrors.push(`requestfailed: ${url.origin}${url.pathname}`);
        });
        page.on("console", (message) => {
            if (message.type() !== "error") return;
            if (message.text() === "Failed to load resource: net::ERR_FAILED") {
                abortConsoleErrors++;
                return;
            }
            consoleErrors.push(message.text());
        });
        await admitAnalyst(page);
        const key = `retrieval-review-${viewport.name}-${Date.now()}`;
        const runId = runConvexJson<string>("retrievalEvaluation:seedReview", {
            slotKey: "analyst-4",
            fixtureKey: key,
        });
        const pending = new Map<object, string>();
        page.on("request", (request) => {
            const url = new URL(request.url());
            pending.set(request, `${url.origin}${url.pathname}`);
        });
        page.on("requestfinished", (request) => pending.delete(request));
        page.on("requestfailed", (request) => pending.delete(request));
        try {
            await page.goto(`/workspace/${runId}?section=sources`);
        } catch (error) {
            console.error(
                JSON.stringify({
                    pending: [...pending.values()],
                    readyState: await page.evaluate(() => document.readyState),
                    approveButtons: await page
                        .getByRole("button", {
                            name: "Approve source set",
                            exact: true,
                        })
                        .count(),
                }),
            );
            throw error;
        }
        const approve = page.getByRole("button", {
            name: "Approve source set",
            exact: true,
        });
        await expect(approve).toBeEnabled();
        await expect(
            page.getByRole("heading", {
                name: "Reactive Systems Test Company",
            }),
        ).toBeVisible();
        await expect(page.locator("body")).not.toContainText(
            /CLOUDFLARE_|SOURCE_RETRIEVAL_|sourceRetrievalActions|embedding_index_incomplete/,
        );
        await page.screenshot({
            path: testInfo.outputPath("review.png"),
        });
        await approve.focus();
        await expect(approve).toBeFocused();
        await page.keyboard.press("Enter");
        await expect(
            page.getByText("Corpus approved", { exact: true }),
        ).toBeVisible();
        await expect
            .poll(() =>
                runConvexJson<Inspection>("retrievalEvaluation:inspectReview", {
                    runId,
                }),
            )
            .toMatchObject({
                revisionStatus: "approved",
                lateEvidence: true,
                versionCount: 1,
            });
        const inspection = runConvexJson<Inspection>(
            "retrievalEvaluation:inspectReview",
            { runId },
        );
        expect(inspection.passageCount).toBeLessThanOrEqual(512);
        await page.reload();
        await expect(
            page.getByText("Corpus approved", { exact: true }),
        ).toBeVisible();
        await expectAdmissionClosed(page);
        await page.screenshot({
            path: testInfo.outputPath("approved.png"),
        });
        expect(pageErrors).toEqual([]);
        expect(consoleErrors).toEqual([]);
        expect(matchedAborts).toBe(initiatedAborts);
        expect(abortConsoleErrors).toBeLessThanOrEqual(matchedAborts);
    });
}
