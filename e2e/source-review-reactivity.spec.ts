import { expect, test } from "@playwright/test";
import type { internal } from "@convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { runConvexJson } from "./support/convex-cli";

import {
    startSanitizedTrace,
    stopSanitizedTraceIfActive,
} from "./support/sanitized-trace";
import {
    admitAnalyst,
    inspectSourceReview,
    seedSourceReview,
} from "./support/source-review-fixture";

function fixtureKey(name: string): string {
    return `${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

test.afterEach(async ({ page }) => {
    // Stop any credential-safe trace so a still-active trace cannot capture
    // admission code from a later failure within the same worker.
    await stopSanitizedTraceIfActive(page);
});

test("selection explanations refresh a legacy draft without changing decisions or calling providers", async ({ page }) => {
    await admitAnalyst(page);
    const key = fixtureKey("selection-explanations");
    const seeded = runConvexJson<FunctionReturnType<typeof internal.e2eFixtures.seedSourceReviewScenario>>(
        "e2eFixtures:seedSourceReviewScenario",
        { slotKey: "analyst-1", fixtureKey: key, legacySelectionReasons: true,
          recordedScenario: { companyName: "ServiceNow, Inc.", companyCik: "1373715", ticker: "NOW", websiteUrl: "https://www.servicenow.com/", researchAngle: "Source explanation verification",
            sources: [{ canonicalUrl: "https://www.sec.gov/Archives/edgar/data/1373715/000137371526000001/now-20251231.htm", title: "Annual report for explanation verification", origin: "sec", category: "regulatory", secForm: "10-K" },
                { canonicalUrl: "https://www.servicenow.com/products/pricing.html", title: "Product pricing", origin: "exa", category: "official_commercial" },
                { canonicalUrl: "https://www.morningstar.com/stocks/servicenow-risk-review", title: "ServiceNow independent analysis", origin: "exa", category: "independent_analysis" }],
          },
        },
    );
    const before = inspectSourceReview(seeded.runId, key);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`/workspace/${seeded.runId}?section=sources`);
    const reader = page.getByRole("region", { name: "Selected source reading" });
    await expect(reader.getByRole("heading", { name: "Annual report for explanation verification" })).toBeVisible();
    await reader.getByRole("button", { name: "Why this source appears" }).click();
    await expect(reader.getByText("A detailed selection reason was not saved for this proposal.")).toBeVisible();
    await page.getByRole("button", { name: "Refresh proposal", exact: true }).click();
    await expect(reader.getByText("A detailed selection reason was not saved for this proposal.")).toHaveCount(0);
    const disclosure = reader.getByRole("button", { name: "Why this source appears" });
    if (await disclosure.getAttribute("aria-expanded") !== "true") await disclosure.click();
    await expect(reader.getByText("Selected for annual regulatory report.")).toBeVisible();
    await expect(reader.getByText("Its documentary contribution has not yet been assessed.")).toBeVisible();
    for (const width of [1440, 390, 320]) {
        await page.setViewportSize({ width, height: 1000 });
        const header = reader.locator('[data-slot="source-record-header"]');
        await expect(header.getByText("SEC-hosted source", { exact: true })).toHaveCount(0);
        await expect(reader.getByRole("region", { name: "Source provenance" }).getByText("SEC-hosted source", { exact: true })).toBeVisible();
        await expect(reader.getByText("Regulatory", { exact: true })).toBeVisible();
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await page.reload();
    await reader.getByRole("button", { name: "Why this source appears" }).focus();
    await page.keyboard.press("Enter");
    await expect(reader.getByText("Selected for annual regulatory report.")).toBeVisible();
    const after = inspectSourceReview(seeded.runId, key);
    expect(after.decisions).toEqual(before.decisions);
    expect(after.providerCallCount).toBe(0);
    expect(errors).toEqual([]);
});

test("source decisions update the row, count, and detail without reload", async ({
    page,
}) => {
    await admitAnalyst(page);
    const key = fixtureKey("source-decision");
    const seeded = seedSourceReview(key);
    await page.goto(`/workspace/${seeded.runId}?section=sources`);
    // Credential-bearing admission is complete and the seeded run document is
    // fully loaded; only now may sanitized diagnostics run.
    await startSanitizedTrace(page);

    await expect(
        page.getByRole("heading", { name: "Reactive Systems Test Company" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Inspect all candidates" }).click();
    await expect(
        page.getByRole("heading", { name: "Inspect all candidates" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Collapse navigation" }).click();

    await page.evaluate(() => {
        document.documentElement.dataset.e2eDocumentInstance = "source-review";
    });
    await page
        .getByRole("button", {
            name: "Open Annual report for review",
            exact: true,
        })
        .click();
    await page
        .getByRole("button", {
            name: "Move Annual report to alternatives",
            exact: true,
        })
        .click();
    await expect(
        page.getByRole("article").getByText("Not included", { exact: true }),
    ).toBeVisible();
    await page
        .getByRole("button", {
            name: "Include Annual report in source set",
            exact: true,
        })
        .click();
    await expect(
        page.getByRole("article").getByText("Included", { exact: true }),
    ).toBeVisible();
    await page
        .getByRole("button", {
            name: "Filter candidate sources: All decisions",
        })
        .click();
    await expect(
        page.getByRole("radio", { name: "Accepted (1)" }),
    ).toBeVisible();
    await expect(
        page.getByRole("article").getByText("Included", { exact: true }),
    ).toBeVisible();
    await expect
        .poll(() =>
            page.evaluate(
                () => document.documentElement.dataset.e2eDocumentInstance,
            ),
        )
        .toBe("source-review");
    await expect
        .poll(() => inspectSourceReview(seeded.runId, key))
        .toMatchObject({
            lifecycleState: "awaiting_source_review",
            revisionStatus: "draft",
            decisions: expect.arrayContaining([
                { title: "Annual report", decision: "accepted" },
            ]),
            providerCallCount: 0,
        });
});

test("corpus approval starts evidence preparation without reload or provider work", async ({
    page,
}) => {
    await admitAnalyst(page);
    const key = fixtureKey("corpus-approval");
    const seeded = seedSourceReview(key);
    await page
        .getByRole("navigation", { name: "Analyzed companies" })
        .locator(`a[href*="${seeded.runId}"]`)
        .click();
    await page.getByRole("link", { name: "Sources", exact: true }).click();
    // Credential-bearing admission is complete and the seeded run document is
    // fully loaded; only now may sanitized diagnostics run.
    await startSanitizedTrace(page);

    await expect(
        page.getByRole("button", { name: "Approve proposed corpus" }),
    ).toBeEnabled();
    await page.evaluate(() => {
        document.documentElement.dataset.e2eDocumentInstance = "approval";
    });
    await page.getByRole("button", { name: "Approve proposed corpus" }).click();

    await expect(
        page.getByText("Corpus approved", { exact: true }),
    ).toBeVisible();
    await expect(
        page.getByRole("heading", {
            name: "Source set is approved and read-only",
        }),
    ).toBeVisible();
    await expect
        .poll(() =>
            page.evaluate(
                () => document.documentElement.dataset.e2eDocumentInstance,
            ),
        )
        .toBe("approval");
    await expect
        .poll(() => inspectSourceReview(seeded.runId, key))
        .toMatchObject({
            lifecycleState: "extracting_evidence",
            executionStatus: "failed",
            revisionStatus: "approved",
            decisions: [
                { title: "Annual report", decision: "accepted" },
                {
                    title: "Product architecture overview",
                    decision: "accepted",
                },
                {
                    title: "Reactive Systems Test Company analysis",
                    decision: "accepted",
                },
            ],
            providerCallCount: 0,
        });
    await expect(
        page.getByRole("button", { name: "Start new revision" }),
    ).toBeDisabled();
    await page.getByRole("link", { name: "Progress", exact: true }).click();
    await expect(
        page.getByText("Evidence could not be prepared", { exact: true }),
    ).toBeVisible();
    await expect(
        page.getByRole("region", { name: "Research progress" }),
    ).not.toContainText(
        /e2e_fixture|no_committed_passages|extracting_evidence|evidenceExecution/,
    );
});

test("metadata-linked sources stay explicit through protected approval", async ({
    page,
}) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await admitAnalyst(page);
    const key = fixtureKey("metadata-linkage");
    const seeded = seedSourceReview(key);
    await page.goto(`/workspace/${seeded.runId}?section=sources`);
    // Credential-bearing admission is complete and the seeded run document is
    // fully loaded; only now may sanitized diagnostics run.
    await startSanitizedTrace(page);

    await page
        .getByRole("list", { name: "Sources in this group" })
        .getByRole("button", {
            name: "Open Reactive Systems Test Company analysis for review",
            exact: true,
        })
        .click();
    await page.getByText("Why this source appears", { exact: true }).click();
    await expect(
        page.getByText(
            "Linked from discovery metadata; source content has not been read",
            { exact: true },
        ),
    ).toBeVisible();
    await page.getByRole("button", { name: "Coverage", exact: true }).click();
    await expect(
        page.getByText("First independent counter-evidence source", {
            exact: true,
        }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Approve proposed corpus" }).click();

    await expect(
        page.getByText("Corpus approved", { exact: true }),
    ).toBeVisible();
    await expect
        .poll(() => inspectSourceReview(seeded.runId, key))
        .toMatchObject({
            lifecycleState: "extracting_evidence",
            executionStatus: "failed",
            revisionStatus: "approved",
            decisions: expect.arrayContaining([
                {
                    title: "Reactive Systems Test Company analysis",
                    decision: "accepted",
                },
            ]),
            providerCallCount: 0,
        });
});


for (const viewport of [
    {name: "desktop", width: 1440, height: 900},
    {name: "mobile", width: 390, height: 844},
]) {
    test(`preparation expires while its protected review stays open on ${viewport.name}`, async ({page}, info) => {
        await page.setViewportSize(viewport);
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("console", (message) => {if (message.type() === "error") errors.push(message.text());});
        await admitAnalyst(page);
        const key = fixtureKey(`preparation-expiry-${viewport.name}`);
        const seeded = runConvexJson<FunctionReturnType<typeof internal.e2eFixtures.seedInspectedSourceReviewScenario>>("e2eFixtures:seedInspectedSourceReviewScenario", {slotKey: "analyst-1", fixtureKey: key});
        await page.clock.install();
        await page.goto(`/workspace/${seeded.runId}?section=sources`);
        if (viewport.name === "desktop")
            await page.getByRole("button", {name: "Collapse navigation", exact: true}).click();
        const resume = page.getByRole("button", {name: "Continue source preparation", exact: true});
        await expect(resume).toBeEnabled();
        await resume.focus();
        await expect(resume).toBeFocused();
        const before = inspectSourceReview(seeded.runId, key);
        await page.clock.fastForward(16 * 60 * 1000);
        await expect(resume).toHaveCount(0);
        await expect(page.getByText(/The preparation window has ended/)).toBeVisible();
        if (viewport.name === "mobile") await page.getByRole("button", {name: "Source actions", exact: true}).click();
        await expect(page.getByRole("button", {name: "Inspect all candidates", exact: true})).toBeEnabled();
        await page.screenshot({path: info.outputPath("expired-preparation.png"), fullPage: true});
        const after = inspectSourceReview(seeded.runId, key);
        expect(after.providerCallCount).toBe(0);
        expect(after.sourceReading).toEqual(before.sourceReading);
        expect(after.decisions).toEqual(before.decisions);
        expect(errors).toEqual([]);
    });
}
