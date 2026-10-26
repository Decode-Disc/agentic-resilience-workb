import { test } from "./support/browser-workspace";
import { readFileSync, writeFileSync } from "node:fs";
import type { internal } from "@convex/_generated/api";
import { expect } from "@playwright/test";
import {
    recordedUtilityScenarios,
    seedRecordedUtilityScenario,
} from "./support/recorded-utility-fixture";
import type { FunctionReturnType } from "convex/server";
import { runConvexJson } from "./support/convex-cli";
import {
    admitAnalyst,
    inspectSourceReview,
} from "./support/source-review-fixture";

type Snapshot = FunctionReturnType<
    typeof internal.e2eFixtures.inspectRecordedSourceReview
>;
const scenarios = recordedUtilityScenarios();
const study = JSON.parse(
    readFileSync(
        "scripts/evaluations/source-selection/fixtures/cross-company-20261020/study.json",
        "utf8",
    ),
) as { documents: Array<{ id: string; url: string }> };
const thumbnail =
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1' height='1'/%3E";

for (const definition of scenarios) {
    const mobile = definition.viewport === "mobile";
    test(`${definition.id} ${mobile ? "mobile" : "desktop"}: inspect, adjust, approve and reconnect`, async ({
        page,
    }, info) => {
        await page.setViewportSize(
            mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
        );
        const errors: string[] = [];
        page.on("pageerror", (e) => errors.push(e.message));
        page.on("console", (m) => {
            if (m.type() === "error") errors.push(m.text());
        });
        // Covers are presentation-only; keep their known external CORS failure outside this zero-provider review test.
        await page.route("https://api.poly.io/og**", (r) =>
            r.fulfill({
                json: { ok: true, imageOk: true, imageUrl: thumbnail },
            }),
        );
        await page.route("https://www.google.com/s2/favicons**", (r) =>
            r.fulfill({
                contentType: "image/svg+xml",
                body: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>',
            }),
        );
        await admitAnalyst(page);
        const scenario = seedRecordedUtilityScenario(definition, info);
        const start = Date.now();
        await page.goto(`/workspace/${scenario.runId}?section=sources`);
        await expect(
            page.getByRole("heading", { name: "Proposed corpus", exact: true }),
        ).toBeVisible();
        await expect(
            page.getByRole("heading", {
                name: scenario.companyName,
                exact: true,
            }),
        ).toBeVisible();
        await page.screenshot({
            path: info.outputPath("proposal.png"),
            fullPage: false,
        });
        const actions = page.getByRole("button", {
            name: "Source actions",
            exact: true,
        });
        if (mobile) await actions.click();
        await page
            .getByRole("button", {
                name: "Inspect all candidates",
                exact: true,
            })
            .click();
        await expect(page).toHaveURL(/[?&]view=inspect(?:&|$)/);
        const inspection = page.getByRole("region", {
            name: "Inspect all source candidates",
            exact: true,
        });
        await expect(inspection).toBeVisible();
        const selectedDocId =
            scenario.suppliedDocumentId ??
            `${scenario.companyId}-${scenario.kind === "uncertain" ? "analysis" : scenario.kind === "targeted" ? "integration" : "quarterly"}`;
        const doc = study.documents.find((d) => d.id === selectedDocId);
        const source = scenario.snapshot.sources.find(
            (s) => s.canonicalUrl === doc?.url,
        );
        const task = scenario.snapshot.tasks.find(
            (t) => t.sourceId === source?._id,
        );
        if (!source || task?.output.kind !== "source_qualification")
            throw new Error("Recorded reading missing");
        await inspection
            .getByRole("region", { name: "Source set 1", exact: true })
            .getByRole("button", {
                name: `Open ${source.title} for review`,
                exact: true,
            })
            .click();
        const sourceReader = mobile
            ? page.getByRole("dialog", { name: "Source detail", exact: true })
            : inspection;
        await expect(
            sourceReader.getByRole("heading", {
                name: source.title,
                exact: true,
            }),
        ).toBeVisible();
        await sourceReader
            .getByRole("tab", { name: "Source details", exact: true })
            .click();
        const reading = sourceReader.getByRole("region", {
            name: "Source reading",
            exact: true,
        });
        await expect(reading).toBeVisible();
        await expect(
            reading.getByText("Illustrative source assessment", {
                exact: true,
            }),
        ).toBeVisible();
        const findingIndex =
            scenario.kind === "uncertain"
                ? task.output.qualification.findings.findIndex(
                      (f) => f.kind === "attributed_argument",
                  )
                : task.output.qualification.documentKind ===
                    "official_commercial_terms"
                  ? task.output.qualification.findings.findIndex(
                        (f) => f.role === "official_commercial_terms",
                    )
                  : 0;
        expect(findingIndex).toBeGreaterThanOrEqual(0);
        const finding = reading.locator("details").nth(findingIndex);
        if ((await finding.getAttribute("open")) === null)
            await finding.locator("summary").click();
        await expect(finding.locator("blockquote").first()).toBeVisible();
        const quotation =
            task.output.qualification.findings[findingIndex]?.passages[0]
                ?.quotation;
        if (!quotation) throw new Error("No recorded passage");
        await expect(reading).toContainText(quotation);
        await expect(
            sourceReader.getByRole("tabpanel", {
                name: "Preview",
                exact: true,
            }),
        ).toHaveCount(0);
        await expect(
            sourceReader.getByRole("tab", {
                name: "Source details",
                exact: true,
            }),
        ).toHaveAttribute("aria-selected", "true");
        await page.screenshot({
            path: info.outputPath("reading.png"),
            fullPage: false,
        });
        if (mobile) await page.keyboard.press("Escape");
        const excludedDocument = study.documents.find(
            (d) => d.id === `${scenario.companyId}-distractor`,
        );
        const excludedSource = scenario.snapshot.sources.find(
            (s) => s.canonicalUrl === excludedDocument?.url,
        );
        if (!excludedSource) throw new Error("Missing excluded-source control");
        await page
            .getByRole("button", { name: "Back to proposal", exact: true })
            .click();
        let current = runConvexJson<Snapshot>(
            "e2eFixtures:inspectRecordedSourceReview",
            { runId: scenario.runId, fixtureKey: scenario.fixtureKey },
        );
        expect(
            current.revisionStatus,
            "Seed a new output directory for a fresh approval journey",
        ).toBe("draft");
        if (mobile) await actions.click();
        await page
            .getByRole("button", { name: "Adjust proposal", exact: true })
            .click();
        const includeExcluded = page.getByRole("button", {
            name: `Include ${excludedSource.title}`,
            exact: true,
        });
        await includeExcluded.click();
        await page
            .getByRole("button", {
                name: `Remove ${excludedSource.title} from proposal`,
                exact: true,
            })
            .click();
        const remove = page.getByRole("button", {
            name: `Remove ${source.title} from proposal`,
            exact: true,
        });
        const include = page.getByRole("button", {
            name: `Include ${source.title}`,
            exact: true,
        });
        if (await remove.count()) await remove.click();
        await expect(include).toBeVisible();
        await include.click();
        await expect(remove).toBeVisible();
        await page
            .getByRole("button", { name: "Back to proposal", exact: true })
            .click();
        const approve = page.getByRole("button", {
            name: "Approve proposed corpus",
            exact: true,
        });
        await expect(approve).toBeEnabled();
        await approve.focus();
        await page.keyboard.press("Enter");
        await expect(
            page.getByText("Corpus approved", { exact: true }),
        ).toBeVisible();
        await page.reload();
        await expect(
            page.getByText("Corpus approved", { exact: true }),
        ).toBeVisible();
        await expect(page.getByLabel("Access code")).toHaveCount(0);
        current = runConvexJson<Snapshot>(
            "e2eFixtures:inspectRecordedSourceReview",
            { runId: scenario.runId, fixtureKey: scenario.fixtureKey },
        );
        expect(current.revisionStatus).toBe("approved");
        expect(current.providerCalls).toBe(0);
        await info.attach("observed-path", {
            body: JSON.stringify({
                scenario: scenario.id,
                mobile,
                elapsedMs: Date.now() - start,
                readingSource: source.canonicalUrl,
                providerCalls: current.providerCalls,
            }),
            contentType: "application/json",
        });
        const decisions = inspectSourceReview(
            scenario.runId,
            scenario.fixtureKey,
        );
        expect(
            decisions.decisions.find((d) => d.title === source.title)?.decision,
        ).toBe("accepted");
        expect(
            decisions.decisions.find((d) => d.title === excludedSource.title)
                ?.decision,
        ).toBe("rejected");
        const coverage = page.getByRole("complementary", {
            name: "Source coverage",
            exact: true,
        });
        await expect(coverage).toBeVisible();
        const geometry = await coverage.evaluateAll((nodes) =>
            nodes.map((node) => ({
                width: node.getBoundingClientRect().width,
                right: node.getBoundingClientRect().right,
                scrollWidth: node.scrollWidth,
                clientWidth: node.clientWidth,
                children: [...node.querySelectorAll("header p, li")].map(
                    (child) => ({
                        text: child.textContent?.slice(0, 100),
                        width: child.getBoundingClientRect().width,
                        right: child.getBoundingClientRect().right,
                        scrollWidth: child.scrollWidth,
                        clientWidth: child.clientWidth,
                    }),
                ),
            })),
        );
        writeFileSync(
            info.outputPath("observed-path.json"),
            JSON.stringify(
                {
                    scenario: scenario.id,
                    mobile,
                    elapsedMs: Date.now() - start,
                    readingSource: source.canonicalUrl,
                    providerCalls: current.providerCalls,
                    geometry,
                    decisions,
                },
                null,
                2,
            ),
        );
        await page.screenshot({
            path: info.outputPath("approved.png"),
            fullPage: false,
        });
        for (const notice of geometry) {
            expect(notice.scrollWidth).toBeLessThanOrEqual(notice.clientWidth);
            for (const child of notice.children)
                expect(child.right).toBeLessThanOrEqual(notice.right);
        }
        expect(errors).toEqual([]);
    });
}

test("approved mobile coverage remains readable after expansion", async ({
    page,
}, info) => {
    const definition = scenarios.find(
        (s) => s.id === "adobe-overview" && s.viewport === "mobile",
    );
    if (!definition) throw new Error("Missing approved mobile scenario");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route("https://api.poly.io/og**", (r) =>
        r.fulfill({ json: { ok: true, imageOk: true, imageUrl: thumbnail } }),
    );
    await page.route("https://www.google.com/s2/favicons**", (r) =>
        r.fulfill({
            contentType: "image/svg+xml",
            body: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>',
        }),
    );
    await admitAnalyst(page);
    const scenario = seedRecordedUtilityScenario(definition, info);
    await page.goto(`/workspace/${scenario.runId}?section=sources`);
    await expect(
        page.getByRole("heading", { name: "Proposed corpus", exact: true }),
    ).toBeVisible();
    await page
        .getByRole("button", { name: "Approve proposed corpus", exact: true })
        .click();
    await expect(
        page.getByText("Corpus approved", { exact: true }),
    ).toBeVisible();
    const coverage = page.getByRole("complementary", {
        name: "Source coverage",
        exact: true,
    });
    await expect(coverage).toBeVisible();
    const toggle = coverage.getByRole("button", {
        name: "Coverage",
        exact: true,
    });
    await toggle.focus();
    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    const requirement = coverage.getByRole("button", {
        name: "Review coverage: Annual regulatory report",
        exact: true,
    });
    await requirement.click();
    await expect(requirement).toHaveAttribute("aria-expanded", "true");
    await page.screenshot({
        path: info.outputPath("coverage.png"),
        fullPage: false,
    });
    const sizes = await coverage.evaluate((node) => ({
        client: node.clientWidth,
        scroll: node.scrollWidth,
        right: node.getBoundingClientRect().right,
        children: [...node.querySelectorAll("p, button")]
            .filter((child) => child.getBoundingClientRect().width > 0)
            .map((child) => ({
                right: child.getBoundingClientRect().right,
                client: child.clientWidth,
                scroll: child.scrollWidth,
            })),
    }));
    expect(sizes.scroll).toBeLessThanOrEqual(sizes.client);
    for (const child of sizes.children) {
        expect(child.right).toBeLessThanOrEqual(sizes.right);
        expect(child.scroll).toBeLessThanOrEqual(child.client);
    }
});

test("approved recorded source reading remains open after selection", async ({
    page,
}, info) => {
    const definition = scenarios.find(
        (s) => s.id === "snowflake-architecture" && s.viewport === "desktop",
    );
    if (!definition) throw new Error("Missing recorded architecture scenario");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.route("https://api.poly.io/og**", (r) =>
        r.fulfill({ json: { ok: true, imageOk: true, imageUrl: thumbnail } }),
    );
    await page.route("https://www.google.com/s2/favicons**", (r) =>
        r.fulfill({
            contentType: "image/svg+xml",
            body: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>',
        }),
    );
    await admitAnalyst(page);
    const scenario = seedRecordedUtilityScenario(definition, info);
    await page.goto(`/workspace/${scenario.runId}?section=sources`);
    await expect(
        page.getByRole("heading", { name: "Proposed corpus", exact: true }),
    ).toBeVisible();
    const doc = study.documents.find((d) => d.id === "snowflake-integration");
    const source = scenario.snapshot.sources.find(
        (s) => s.canonicalUrl === doc?.url,
    );
    if (!source) throw new Error("Missing recorded integration source");
    await page
        .getByRole("button", { name: "Adjust proposal", exact: true })
        .click();
    const include = page.getByRole("button", {
        name: `Include ${source.title}`,
        exact: true,
    });
    if (await include.count()) await include.click();
    await page
        .getByRole("button", { name: "Back to proposal", exact: true })
        .click();
    await page
        .getByRole("button", { name: "Approve proposed corpus", exact: true })
        .click();
    await expect(
        page.getByText("Corpus approved", { exact: true }),
    ).toBeVisible();
    await page
        .getByRole("button", { name: "Inspect all candidates", exact: true })
        .click();
    await page
        .getByRole("region", { name: "Source set 1", exact: true })
        .getByRole("button", {
            name: `Open ${source.title} for review`,
            exact: true,
        })
        .click();
    await expect(
        page.getByRole("heading", { name: source.title, exact: true }),
    ).toBeVisible();
    const tab = page.getByRole("tab", { name: "Source details", exact: true });
    await tab.click();
    await expect(tab).toHaveAttribute("aria-selected", "true");
    await expect(
        page.getByRole("tabpanel", { name: "Preview", exact: true }),
    ).toHaveCount(0);
    const reading = page.getByRole("region", {
        name: "Source reading",
        exact: true,
    });
    const firstFinding = reading.locator("details").first();
    if ((await firstFinding.getAttribute("open")) === null)
        await firstFinding.locator("summary").click();
    await expect(reading.locator("blockquote").first()).toBeVisible();
    await page.screenshot({
        path: info.outputPath("reading-settled.png"),
        fullPage: false,
    });
    await expect(tab).toHaveAttribute("aria-selected", "true");
    await expect(reading.locator("blockquote").first()).toBeVisible();
});
