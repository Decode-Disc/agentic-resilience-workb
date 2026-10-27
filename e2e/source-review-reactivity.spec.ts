import { test } from "./support/browser-workspace";
import { expect, type WebSocketRoute } from "@playwright/test";
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

test("a sixty-source inspected proposal loads repeatedly without starting provider work", async ({ page }, info) => {
    test.setTimeout(120_000);
    await admitAnalyst(page);
    const key = "preparation-performance-sixty-v1";
    const seeded = runConvexJson<FunctionReturnType<typeof internal.e2eFixtures.seedInspectedSourceReviewScenario>>(
        "e2eFixtures:seedInspectedSourceReviewScenario",
        { slotKey: "analyst-4", fixtureKey: key, comparisonOutcome: "no_conflict_observed" },
    );
    const scaled = runConvexJson<FunctionReturnType<typeof internal.e2eFixtures.scaleSourceReviewFixture>>(
        "e2eFixtures:scaleSourceReviewFixture", {runId: seeded.runId, fixtureKey: key, slotKey: "analyst-4"},
    );
    expect(scaled.sourceCount).toBe(60);
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => {if (message.type() === "error") errors.push(message.text());});
    const durations: number[] = [];
    for (let attempt = 0; attempt < 5; attempt++) {
        const started = Date.now();
        await page.goto(`/workspace/${seeded.runId}?section=sources`);
        await expect(page.getByRole("heading", {name: "Proposed corpus", exact: true})).toBeVisible({timeout: 30_000});
        await expect(page.getByRole("region", {name: "Selected source reading"})).toBeVisible();
        durations.push(Date.now() - started);
    }
    await info.attach("sixty-source-navigation-durations", {body: JSON.stringify({milliseconds: durations, sources: scaled.sourceCount}), contentType: "application/json"});
    expect(inspectSourceReview(seeded.runId, key).providerCallCount).toBe(0);
    expect(errors).toEqual([]);
});


test("selection explanations refresh a legacy draft without changing decisions or calling providers", async ({ page }) => {
    await admitAnalyst(page);
    const key = fixtureKey("selection-explanations");
    const seeded = runConvexJson<FunctionReturnType<typeof internal.e2eFixtures.seedSourceReviewScenario>>(
        "e2eFixtures:seedSourceReviewScenario",
        { slotKey: "analyst-4", fixtureKey: key, legacySelectionReasons: true,
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
    test(`expired preparation resumes with retained readings on ${viewport.name}`, async ({page}, info) => {
        await page.setViewportSize(viewport);
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("console", (message) => {if (message.type() === "error") errors.push(message.text());});
        await admitAnalyst(page);
        const key = fixtureKey(`preparation-expiry-${viewport.name}`);
        const inspected = runConvexJson<FunctionReturnType<typeof internal.e2eFixtures.seedInspectedSourceReviewScenario>>("e2eFixtures:seedInspectedSourceReviewScenario", {slotKey: "analyst-4", fixtureKey: key});
        const seeded = runConvexJson<FunctionReturnType<typeof internal.e2eFixtures.stageSourcePreparationRecoveryFixture>>("e2eFixtures:stageSourcePreparationRecoveryFixture", {runId: inspected.runId, slotKey: "analyst-4", fixtureKey: key});
        await page.goto(`/workspace/${seeded.runId}?section=sources`);
        if (viewport.name === "desktop")
            await page.getByRole("button", {name: "Collapse navigation", exact: true}).click();
        const resume = page.getByRole("button", {name: "Resume preparation", exact: true});
        await expect(resume).toBeEnabled();
        await resume.focus();
        await expect(resume).toBeFocused();
        const before = inspectSourceReview(seeded.runId, key);
        expect(before.preparation?.deadlineAt).toBeLessThan(Date.now());
        await page.screenshot({path: info.outputPath("before-recovery.png"), fullPage: true});
        await resume.press("Enter");
        await expect.poll(() => {
            const current = inspectSourceReview(seeded.runId, key);
            return current.executionStatus === "paused" && current.preparation?.preparationId !== before.preparation?.preparationId;
        }).toBe(true);
        await expect(page.getByText(/start a new dossier/)).toHaveCount(0);
        if (viewport.name === "mobile") await page.getByRole("button", {name: "Source actions", exact: true}).click();
        await expect(page.getByRole("button", {name: "Inspect all candidates", exact: true})).toBeEnabled();
        await page.screenshot({path: info.outputPath("expired-preparation.png"), fullPage: true});
        const after = inspectSourceReview(seeded.runId, key);
        expect(after.providerCallCount).toBe(0);
        expect(after.sourceReading).toEqual(before.sourceReading);
        expect(after.decisions).toEqual(before.decisions);
        expect(after.revisionStatus).toBe("draft");
        expect(after.preparation?.executionGeneration).toBe((before.preparation?.executionGeneration ?? 0) + 1);
        await page.reload();
        await expect(page.getByRole("region", {name: "Selected source reading"})).toBeVisible();
        expect(inspectSourceReview(seeded.runId, key).sourceReading).toEqual(before.sourceReading);
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await expect(page.getByRole("button", {name: "Approve proposed corpus", exact: true})).toBeEnabled();
        expect(errors).toEqual([]);
    });
}

for (const viewport of [
    { name: "desktop", width: 1440, height: 900 },
    { name: "mobile", width: 390, height: 844 },
]) {
    for (const exhaustedBudget of ["work", "incidents"] as const) {
        test(`${exhaustedBudget} preparation budget preserves review on ${viewport.name}`, async ({
            page,
        }, info) => {
            await page.setViewportSize(viewport);
            const errors: string[] = [];
            page.on("pageerror", (error) => errors.push(error.message));
            page.on("console", (message) => {
                if (message.type() === "error") errors.push(message.text());
            });
            await admitAnalyst(page);
            const key = `preparation-budget-${exhaustedBudget}-${viewport.name}`;
            const inspected = runConvexJson<
                FunctionReturnType<
                    typeof internal.e2eFixtures.seedInspectedSourceReviewScenario
                >
            >("e2eFixtures:seedInspectedSourceReviewScenario", {
                slotKey: "analyst-4",
                fixtureKey: key,
            });
            const seeded = runConvexJson<
                FunctionReturnType<
                    typeof internal.e2eFixtures.stageSourcePreparationRecoveryFixture
                >
            >("e2eFixtures:stageSourcePreparationRecoveryFixture", {
                runId: inspected.runId,
                slotKey: "analyst-4",
                fixtureKey: key,
                exhaustedBudget,
            });
            const before = inspectSourceReview(seeded.runId, key);
            await page.goto(`/workspace/${seeded.runId}?section=sources`);
            const copy = page.getByText(
                exhaustedBudget === "work"
                    ? /^The source reading allowance has been used/
                    : /^Preparation stopped after repeated service failures/,
            );
            await expect(copy).toBeVisible();
            await expect(
                page.getByRole("button", {
                    name: "Resume preparation",
                    exact: true,
                }),
            ).toHaveCount(0);
            const approve = page.getByRole("button", {
                name: "Approve proposed corpus",
                exact: true,
            });
            await expect(approve).toBeEnabled();
            await approve.focus();
            await expect(approve).toBeFocused();
            await expect(page.locator("body")).not.toContainText(
                /work_budget_exhausted|incident_budget_exhausted|SOURCE_PREPARATION_/,
            );
            await page.screenshot({
                path: info.outputPath(`${exhaustedBudget}.png`),
                fullPage: true,
            });
            await page.reload();
            await expect(copy).toBeVisible();
            const after = inspectSourceReview(seeded.runId, key);
            expect(after.sourceReading).toEqual(before.sourceReading);
            expect(after.decisions).toEqual(before.decisions);
            expect(after.providerCallCount).toBe(0);
            expect(after.revisionStatus).toBe("draft");
            await expect
                .poll(() =>
                    page.evaluate(
                        () =>
                            document.documentElement.scrollWidth <= innerWidth,
                    ),
                )
                .toBe(true);
            expect(errors).toEqual([]);
        });
    }
}

for (const viewport of [{ name: "desktop", width: 1440, height: 900 }, { name: "mobile", width: 390, height: 844 }]) {
    test(`source preparation phases update coverage and cards without reload on ${viewport.name}`, async ({ page, context }, info) => {
        test.setTimeout(120_000);
        await page.setViewportSize(viewport);
        const errors: string[] = [];
        let intentionallyOffline = false;
        const transport: { current: WebSocketRoute | null } = { current: null };
        const convexOrigin = process.env.LOCAL_RUNTIME_CONVEX_ORIGIN;
        if (!convexOrigin) throw new Error("Missing verified local Convex origin.");
        const convexPort = new URL(convexOrigin).port;
        await page.routeWebSocket((url) => ["127.0.0.1", "localhost"].includes(url.hostname) && url.port === convexPort, (socket) => {
            if (intentionallyOffline) { void socket.close({ code: 1001 }); return; }
            socket.connectToServer();
            transport.current = socket;
        });
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("console", (message) => {
            if (message.type() !== "error") return;
            if (intentionallyOffline && /ERR_INTERNET_DISCONNECTED|WebSocket.*(?:closed|failed)/i.test(message.text())) return;
            errors.push(message.text());
        });
        await admitAnalyst(page);
        const key = fixtureKey(`live-progress-${viewport.name}`);
        const seeded = runConvexJson<FunctionReturnType<typeof internal.e2eFixtures.seedInspectedSourceReviewScenario>>("e2eFixtures:seedInspectedSourceReviewScenario", { slotKey: "analyst-4", fixtureKey: key });
        const advance = (phase: "reading" | "comparison" | "comparison_progress" | "supplement" | "additional_reading" | "proposal" | "complete") => runConvexJson("e2eFixtures:advanceSourcePreparationFixture", { runId: seeded.runId, fixtureKey: key, slotKey: "analyst-4", phase });
        const before = inspectSourceReview(seeded.runId, key);
        try {
            advance("reading");
            await page.goto(`/workspace/${seeded.runId}?section=sources`);
            await expect(page.getByRole("heading", { name: "Proposed corpus", exact: true })).toBeVisible({ timeout: 30_000 });
            await expect(page.getByRole("listitem", { name: "Read candidate sources: Active" })).toBeVisible();
            if (viewport.name === "desktop") await page.getByRole("button", { name: "Collapse navigation", exact: true }).click();
            else await page.getByRole("button", { name: "Coverage", exact: true }).click();
            await page.emulateMedia({ reducedMotion: viewport.name === "mobile" ? "reduce" : "no-preference" });
            const readingProgress = page.getByRole("progressbar", { name: "Source reading progress", exact: true });
            await expect(readingProgress).toHaveAttribute("aria-valuenow", "2");
            await expect(readingProgress).toHaveAttribute("aria-valuemax", "3");
            const card = page.getByRole("button", { name: "Open Illustrative workflow argument for review", exact: true });
            await expect(card.getByText("In preparation", { exact: true })).toBeVisible();
            await card.focus();
            await expect(card).toBeFocused();
            await expect(page.getByRole("button", { name: "Refresh proposal", exact: true })).toHaveCount(0);
            await page.evaluate(() => window.scrollTo(0, 0));
            await page.screenshot({ path: info.outputPath("reading.png"), fullPage: true });
            advance("comparison");
            await expect(page.getByRole("listitem", { name: "Check source contributions: Active" })).toBeVisible();
            await expect(page.getByText("0 of 1 source comparisons checked", { exact: true })).toBeVisible();
            const comparisonProgress = page.getByRole("progressbar", { name: "Source comparison progress", exact: true });
            await expect(comparisonProgress).toHaveAttribute("aria-valuenow", "0");
            await expect(comparisonProgress).toHaveAttribute("aria-valuemax", "1");
            await expect(readingProgress).toHaveCount(0);
            await expect(page.getByText("1 source read and assessed", { exact: true })).toBeVisible();
            await expect(page.getByText("1 of 3 source contents saved", { exact: true })).toHaveCount(0);
            await expect(card.getByText("Assessed · partial reading", { exact: true })).toBeVisible();
            await expect(card).toBeFocused();
            await expect(page.getByRole("complementary", { name: "Source coverage" }).getByText("Limited", { exact: true }).first()).toBeVisible();
            await page.evaluate(() => window.scrollTo(0, 0));
            await page.screenshot({ path: info.outputPath("comparison.png"), fullPage: true });
            await expect(page.getByText("Step 2 of 3", { exact: true })).toBeVisible();
            await expect(page.getByRole("listitem", { name: "Read candidate sources: Complete" })).toBeVisible();
            advance("comparison_progress");
            await expect(comparisonProgress).toHaveAttribute("aria-valuenow", "1");
            advance("supplement");
            await expect(page.getByText("Checking for additional sources", { exact: true })).toBeVisible();
            advance("additional_reading");
            await expect(page.getByText("Reading additional sources using saved results", { exact: true })).toBeVisible();
            await expect(page.getByText("Step 2 of 3", { exact: true })).toBeVisible();
            await page.reload();
            await expect(page.getByRole("listitem", { name: "Read candidate sources: Complete" })).toBeVisible();
            await expect(page.getByText("Step 2 of 3", { exact: true })).toBeVisible();
            advance("proposal");
            await expect(page.getByRole("listitem", { name: "Prepare your proposal: Active" })).toBeVisible();
            await expect(page.getByRole("progressbar", { name: "Proposal preparation progress" })).not.toHaveAttribute("aria-valuenow");
            await expect(page.getByRole("button", { name: "Approve proposed corpus", exact: true })).toBeDisabled();
            const reader = page.getByRole("region", { name: "Selected source reading" });
            const readingTab = reader.getByRole("tab", { name: "Source details", exact: true });
            await reader.evaluate(el => el.scrollIntoView({ block: "start", behavior: "instant" }));
            await readingTab.focus();
            const beforeReading = await reader.evaluate(el => ({ top: el.getBoundingClientRect().top, scroll: el.querySelector('[role="tabpanel"]')?.scrollTop ?? 0 }));
            intentionallyOffline = true;
            await context.setOffline(true);
            if (!transport.current) throw new Error("The local source subscription was not established");
            await transport.current.close({ code: 1001, reason: "Controlled source review reconnection check" });
            await expect(page.getByText("Live updates paused", { exact: true })).toBeVisible({ timeout: 25_000 });
            advance("complete");
            intentionallyOffline = false;
            await context.setOffline(false);
            await expect(page.getByText("Live updates paused", { exact: true })).toHaveCount(0, { timeout: 25_000 });
            await expect(page.getByRole("listitem", { name: "Prepare your proposal: Active" })).toHaveCount(0);
            await expect(page.getByText("Ready for review with limitations", { exact: true })).toBeVisible();
            await expect(page.getByRole("button", { name: "Approve proposed corpus", exact: true })).toBeEnabled();
            await expect(page.getByRole("button", { name: "Refresh proposal", exact: true })).toHaveCount(0);
            await expect(readingTab).toBeFocused();
            const afterReading = await reader.evaluate(el => ({ top: el.getBoundingClientRect().top, scroll: el.querySelector('[role="tabpanel"]')?.scrollTop ?? 0 }));
            expect(Math.abs(afterReading.top - beforeReading.top), JSON.stringify({ beforeReading, afterReading })).toBeLessThan(3);
            expect(afterReading.scroll).toBe(beforeReading.scroll);
            await page.screenshot({ path: info.outputPath("ready-for-review.png"), fullPage: true });
            const details = page.getByRole("button", { name: /^(View|Hide) preparation details$/ });
            await details.focus();
            await page.keyboard.press("Enter");
            await expect(details).toHaveAttribute("aria-expanded", "true");
            await expect(page.getByText("Prepare your proposal", { exact: true })).toBeVisible();
            const limits = page.getByRole("button", { name: "Review 2 unavailable sources", exact: true });
            await limits.click();
            const limitations = page.getByRole("dialog", { name: "Sources that could not be fully prepared" });
            await expect(limitations.getByRole("link", { name: /^Open original:/ })).toHaveCount(2);
            await limitations.screenshot({ path: info.outputPath("source-limitations.png") });
            await page.keyboard.press("Escape");
            await expect(limitations).toBeHidden();
            await expect(limits).toBeFocused();
            const after = inspectSourceReview(seeded.runId, key);
            expect(after.decisions).toEqual(before.decisions);
            expect(after.sourceReading).toEqual(before.sourceReading);
            expect(after.providerCallCount).toBe(0);
            await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
            expect(errors).toEqual([]);
        } finally {
            intentionallyOffline = false;
            await context.setOffline(false);
            if (inspectSourceReview(seeded.runId, key).executionStatus === "running") {
                advance("comparison");
                advance("proposal");
                advance("complete");
            }
        }
    });
}
