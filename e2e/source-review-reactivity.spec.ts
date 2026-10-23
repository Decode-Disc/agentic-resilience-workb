import { expect, test } from "@playwright/test";

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
        page.getByRole("article").getByText("Alternative", { exact: true }),
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
