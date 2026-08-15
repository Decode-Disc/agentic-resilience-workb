import { expect, test } from "@playwright/test";

import {
    admitAnalyst,
    inspectSourceReview,
    seedSourceReview,
} from "./support/source-review-fixture";

function fixtureKey(name: string): string {
    return `${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

test("source decisions update the row, count, and detail without reload", async ({
    page,
}) => {
    await admitAnalyst(page);
    const key = fixtureKey("source-decision");
    const seeded = seedSourceReview(key);
    await page.goto(`/workspace/${seeded.runId}?section=sources`);

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
    await expect(page.getByText("Selected source:")).toBeVisible();
    await expect(page.getByText("Pending review", { exact: true }).last()).toBeVisible();

    await page
        .getByRole("button", {
            name: "Accept Annual report as accepted",
        })
        .click();

    await expect(
        page.getByRole("button", {
            name: "Accepted Annual report as accepted",
        }),
    ).toBeDisabled();
    await page
        .getByRole("button", { name: "Filter candidate sources: All decisions" })
        .click();
    await expect(
        page.getByRole("radio", { name: "Accepted (1)" }),
    ).toBeVisible();
    await expect(
        page.getByRole("article").getByText("Accepted", { exact: true }),
    ).toBeVisible();
    await expect
        .poll(() =>
            page.evaluate(
                () => document.documentElement.dataset.e2eDocumentInstance,
            ),
        )
        .toBe("source-review");
    await expect
        .poll(() => inspectSourceReview(key))
        .toMatchObject({
            lifecycleState: "awaiting_source_review",
            revisionStatus: "draft",
            decisions: expect.arrayContaining([
                { title: "Annual report", decision: "accepted" },
            ]),
            providerCallCount: 0,
        });
});

test("corpus approval exits the checkpoint without reload or provider work", async ({
    page,
}) => {
    await admitAnalyst(page);
    const key = fixtureKey("corpus-approval");
    const seeded = seedSourceReview(key);
    await page.goto(`/workspace/${seeded.runId}?section=sources`);

    await expect(
        page.getByRole("button", { name: "Approve source set" }),
    ).toBeEnabled();
    await page.evaluate(() => {
        document.documentElement.dataset.e2eDocumentInstance = "approval";
    });
    await page.getByRole("button", { name: "Approve source set" }).click();

    await expect(page.getByText("Corpus approved", { exact: true })).toBeVisible();
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
        .poll(() => inspectSourceReview(key))
        .toMatchObject({
            lifecycleState: "corpus_approved",
            executionStatus: "idle",
            revisionStatus: "approved",
            decisions: [
                { title: "Annual report", decision: "accepted" },
                {
                    title: "Product architecture overview",
                    decision: "accepted",
                },
            ],
            providerCallCount: 0,
        });
});