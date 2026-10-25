import { expect, test } from "@playwright/test";
import type { internal } from "@convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { runConvexJson } from "./support/convex-cli";
import {
    admitAnalyst,
    inspectSourceReview,
} from "./support/source-review-fixture";

test("a scoped qualification conflict preserves independent coverage through desktop, mobile and reconnection", async ({
    page,
}, info) => {
    const { prepareQualificationInput } = await import(
        "@convex/domain/sourceQualification"
    );
    const { SOURCE_COVERAGE_ROLES } = await import(
        "@convex/domain/sourceSelectionPolicy"
    );
    await admitAnalyst(page);
    const key = "qualification-scoped-conflict-v4-v2";
    const company = {
        cik: "0000000001",
        legalName: "Qualification Fixture Company",
        ticker: "QFC",
    };
    const text =
        "# Documentation\n\nQualification Fixture Company documentation navigation links.\n\n# Integration\n\nThe platform delivers signed webhooks through authenticated APIs.";
    const canonicalUrl = "https://qualification.example/docs/product";
    const title = "Illustrative documentation and integration";
    const asOfTime = Date.UTC(2026, 9, 25);
    const prepared = prepareQualificationInput({
        company,
        canonicalUrl,
        title,
        asOfTime,
        text,
        protocolVersion: "source-qualification-v4",
    });
    const portal = prepared.request.document.passages.find((passage) =>
        passage.text.includes("navigation links"),
    );
    const integration = prepared.request.document.passages.find((passage) =>
        passage.text.includes("signed webhooks"),
    );
    if (!portal || !integration)
        throw new Error("Missing inspected fixture passages");
    const response = {
        companyMatch: "subject",
        companyPassageKeys: [portal.passageKey],
        documentKind: "official_product_documentation",
        reportingPeriodEnd: null,
        reportingPeriodPassageKeys: [],
        contributions: Object.fromEntries(
            SOURCE_COVERAGE_ROLES.map((role) => [
                role,
                role === "official_product_platform" ||
                role === "official_product_integration"
                    ? [
                          {
                              kind: "asserted_fact",
                              passageKeys: [
                                  role === "official_product_platform"
                                      ? portal.passageKey
                                      : integration.passageKey,
                              ],
                              period: "unspecified",
                              periodPassageKeys: [],
                              dependsOnFlaggedAssertion: false,
                          },
                      ]
                    : null,
            ]),
        ),
        limitations: [
            {
                code: "no_substantive_content",
                explanation:
                    "The navigation passage contains no substantive product description.",
                passageKeys: [portal.passageKey],
                scope: {
                    kind: "passages",
                    passageKeys: [portal.passageKey],
                    roles: null,
                },
            },
        ],
    };
    const seeded = runConvexJson<
        FunctionReturnType<typeof internal.e2eFixtures.seedRecordedSourceReview>
    >("e2eFixtures:seedRecordedSourceReview", {
        slotKey: "analyst-1",
        fixtureKey: key,
        company,
        websiteUrl: "https://qualification.example",
        researchAngle: "Illustrative scoped restriction verification",
        sources: [
            {
                canonicalUrl,
                title,
                origin: "exa",
                category: "official_product",
                protocolVersion: "source-qualification-v4",
                text,
                contentHash: prepared.request.document.contentHash,
                originalInputHash: prepared.inputHash,
                asOfTime,
                originalResearchAngle: "",
                responseJson: JSON.stringify(response),
            },
        ],
    });
    const before = inspectSourceReview(seeded.runId, key);
    const errors: string[] = [];
    let connections = 0;
    page.on("websocket", () => {
        connections++;
    });
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
    });
    for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.goto(`/workspace/${seeded.runId}?section=sources`);
        const reader = page.getByRole("region", {
            name: "Selected source reading",
        });
        await expect(
            reader.getByText("Source reading needs review", { exact: true }),
        ).toBeVisible();
        await expect(
            reader.getByText(
                "The reading gives conflicting assessments of this material. This contribution does not count toward coverage.",
            ),
        ).toBeVisible();
        await expect(
            reader.getByText(portal.text, { exact: true }).first(),
        ).toBeVisible();
        const integrationDisclosure = reader
            .locator("summary")
            .filter({ hasText: "APIs & integrations" });
        await integrationDisclosure.focus();
        await page.keyboard.press("Enter");
        await expect(integrationDisclosure).toBeFocused();
        await expect(
            reader.getByText(integration.text, { exact: true }).first(),
        ).toBeVisible();
        await expect(
            reader.getByRole("link", { name: "Open original" }),
        ).toHaveAttribute("href", canonicalUrl);
        await expect(reader).not.toContainText(
            /qualification_conflict|qualification_scope_unknown|source_qualification|invalid_output/,
        );
        await expect
            .poll(() =>
                page.evaluate(
                    () =>
                        document.documentElement.scrollWidth <=
                        window.innerWidth,
                ),
            )
            .toBe(true);
        await page.screenshot({
            path: info.outputPath(`qualification-conflict-${width}.png`),
            fullPage: true,
        });
    }
    const previousConnections = connections;
    await page.reload();
    await expect(
        page.getByText("Source reading needs review", { exact: true }),
    ).toBeVisible();
    expect(connections).toBeGreaterThan(previousConnections);
    const after = inspectSourceReview(seeded.runId, key);
    expect(after.decisions).toEqual(before.decisions);
    expect(after.providerCallCount).toBe(0);
    const stored = runConvexJson<
        FunctionReturnType<
            typeof internal.e2eFixtures.inspectRecordedSourceReview
        >
    >("e2eFixtures:inspectRecordedSourceReview", {
        runId: seeded.runId,
        fixtureKey: key,
    });
    expect(stored.items[0]?.eligibleCoverageRoles).toEqual([
        "official_product_integration",
    ]);
    expect(stored.items[0]?.roleAvailability).toEqual(
        expect.arrayContaining([
            expect.objectContaining({
                role: "official_product_platform",
                state: "not_established",
                usage: "blocked",
                reasonCodes: ["qualification_conflict"],
            }),
        ]),
    );
    expect(errors).toEqual([]);
});
