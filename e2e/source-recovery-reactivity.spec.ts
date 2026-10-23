import { expect, test } from "@playwright/test";
import {
    admitAnalyst,
    seedSourceReview,
    inspectSourceReview,
} from "./support/source-review-fixture";

for (const viewport of [
    { name: "desktop", width: 1500, height: 960 },
    { name: "mobile", width: 390, height: 844 },
]) {
    test.describe(`${viewport.name} coverage help`, () => {
        test.use({
            hasTouch: viewport.name === "mobile",
            isMobile: viewport.name === "mobile",
            reducedMotion: "reduce",
        });
        test("opens contextual help by keyboard or tap and preserves source inspection", async ({
            page,
        }, info) => {
            await page.setViewportSize(viewport);
            const errors: string[] = [];
            page.on("pageerror", (error) => errors.push(error.message));
            page.on("console", (message) => {
                if (message.type() === "error") errors.push(message.text());
            });
            await admitAnalyst(page);
            const fixtureKey = `coverage-hybrid-${viewport.name}-20261023`;
            const seeded = seedSourceReview(fixtureKey);
            await page.goto(`/workspace/${seeded.runId}?section=sources`);
            const rail = page.getByRole("complementary", {
                name: "Source coverage",
            });
            const help = rail.getByRole("button", {
                name: "What coverage tells you",
                exact: true,
            });
            await expect(
                rail.getByRole("heading", { name: "Coverage", exact: true }),
            ).toBeVisible();
            const explanation = page.getByText(
                "The included sources have not established this topic. Included matches can still need review.",
                { exact: true },
            );
            await expect(explanation).toHaveCount(0);
            if (viewport.name === "mobile") await help.tap();
            else {
                await help.hover();
                await expect(explanation).toHaveCount(0);
                await help.focus();
                await page.keyboard.press("Enter");
            }
            await expect(explanation).toBeVisible();
            const close = page.getByRole("button", {
                name: "Close coverage help",
                exact: true,
            });
            await expect(close).toBeVisible();
            if (viewport.name === "mobile") {
                const sheet = page.locator('[data-slot="drawer-popup"]');
                await expect(sheet).toBeVisible();
                await page.screenshot({
                    path: info.outputPath("coverage-help.png"),
                });
                await close.tap();
            } else {
                await expect(
                    page.locator('[data-slot="popover-content"]'),
                ).toBeVisible();
                await page.screenshot({
                    path: info.outputPath("coverage-help.png"),
                });
                await page.keyboard.press("Escape");
                await expect(help).toBeFocused();
            }
            await expect(explanation).toHaveCount(0);
            if (viewport.name === "mobile")
                await rail
                    .getByRole("button", { name: "Coverage", exact: true })
                    .tap();
            await rail
                .getByRole("button", {
                    name: "Review coverage: First independent counter-evidence source",
                    exact: true,
                })
                .click();
            const included = rail.getByRole("button", {
                name: "View 1 included source",
                exact: true,
            });
            await expect(included).toBeVisible();
            await included.scrollIntoViewIfNeeded();
            await page.screenshot({
                path: info.outputPath("coverage-selected.png"),
            });
            await included.click();
            await expect(page).toHaveURL(
                /view=inspect.*coverage=counter_evidence_primary/,
            );
            await page.reload();
            await expect(
                page.getByRole("heading", {
                    name: "Review matching candidates",
                    exact: true,
                }),
            ).toBeVisible();
            expect(inspectSourceReview(seeded.runId, fixtureKey)).toMatchObject(
                { providerCallCount: 0, revisionStatus: "draft" },
            );
            expect(errors).toEqual([]);
        });
    });

    test(`${viewport.name} long source titles stay compact and coverage actions remain readable`, async ({
        page,
    }, info) => {
        await page.setViewportSize(viewport);
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("console", (message) => {
            if (message.type() === "error") errors.push(message.text());
        });
        await admitAnalyst(page);
        const seeded = seedSourceReview(
            `source-review-layout-${viewport.name}-20261023-v2`,
            false,
            {
                companyName: "ServiceNow — illustrative layout fixture",
                companyCik: "1373715",
                ticker: "NOW",
                websiteUrl: "https://www.servicenow.com",
                researchAngle:
                    "Illustrative layout verification. Not a live assessment.",
                sources: [
                    {
                        canonicalUrl:
                            "https://www.servicenow.com/company/investor-relations/earnings.html",
                        title: "ServiceNow Reports Fourth Quarter and Full-Year 2024 Financial Results; Board of Directors Authorizes Additional $3B for Share Repurchase Program",
                        origin: "analyst_url",
                        category: "earnings",
                    },
                    {
                        canonicalUrl:
                            "https://www.servicenow.com/products/now-platform.html",
                        title: "Business problems solved by NOW Platform - ServiceNow",
                        origin: "analyst_url",
                        category: "official_product",
                    },
                    {
                        canonicalUrl:
                            "https://www.servicenow.com/company/legal/subscription-service-agreement.html",
                        title: "Subscription service agreement",
                        origin: "analyst_url",
                        category: "official_commercial",
                    },
                    {
                        canonicalUrl:
                            "https://www.morningstar.com/stocks/illustrative-servicenow-analysis",
                        title: "ServiceNow — illustrative layout fixture analysis",
                        origin: "exa",
                        category: "counter_evidence",
                    },
                ],
            },
        );
        await page.goto(`/workspace/${seeded.runId}?section=sources`);
        const cards = page
            .getByRole("list", { name: "Sources in this group" })
            .getByRole("button");
        await expect(cards).toHaveCount(4);
        await page.screenshot({
            path: info.outputPath("overview.png"),
            fullPage: true,
        });
        for (const card of await cards.all()) {
            await card.scrollIntoViewIfNeeded();
            const box = await card.boundingBox();
            expect(
                box?.height,
                "A long title must not stretch source cards",
            ).toBeLessThanOrEqual(136);
        }
        await cards.first().scrollIntoViewIfNeeded();
        const coverageTrigger = page.getByRole("button", {
            name: "Review coverage: Second independent counter-evidence source",
            exact: true,
        });
        if (viewport.name === "mobile")
            await page
                .getByRole("button", { name: "Coverage", exact: true })
                .click();
        await coverageTrigger.click();
        const details = page.getByRole("region", {
            name: "Second independent counter-evidence source",
            exact: true,
        });
        await expect(details).toBeVisible();
        await expect
            .poll(
                () =>
                    details.evaluate((region) => {
                        const detail = region.getBoundingClientRect();
                        for (
                            let parent = region.parentElement;
                            parent;
                            parent = parent.parentElement
                        ) {
                            if (
                                ["auto", "scroll"].includes(
                                    getComputedStyle(parent).overflowY,
                                )
                            ) {
                                const viewport = parent.getBoundingClientRect();
                                return (
                                    detail.top >= viewport.top - 1 &&
                                    detail.bottom <= viewport.bottom + 1
                                );
                            }
                        }
                        return false;
                    }),
                {
                    message:
                        "Expanded coverage actions must stay inside the visible rail",
                },
            )
            .toBe(true);
        const actions = details.getByRole("button");
        await expect(actions).toHaveCount(2);
        const bounds = await details.boundingBox();
        let previousBottom = 0;
        for (const action of await actions.all()) {
            const box = await action.boundingBox();
            expect(box).toBeTruthy();
            if (!box || !bounds)
                throw new Error("Visible coverage geometry missing");
            expect(box.y).toBeGreaterThanOrEqual(previousBottom);
            expect(box.height).toBeGreaterThanOrEqual(44);
            expect(box.x + box.width).toBeLessThanOrEqual(
                bounds.x + bounds.width + 1,
            );
            const textFits = await action.evaluate((button) => {
                const range = document.createRange();
                range.selectNodeContents(button);
                const content = range.getBoundingClientRect();
                const outer = button.getBoundingClientRect();
                return (
                    content.top >= outer.top && content.bottom <= outer.bottom
                );
            });
            expect(
                textFits,
                "Coverage action text must fit inside its own button",
            ).toBe(true);
            previousBottom = box.y + box.height;
        }
        await page.screenshot({
            path: info.outputPath("coverage-expanded.png"),
            fullPage: true,
        });
        await page.keyboard.press("Escape");
        await expect(coverageTrigger).toBeFocused();
        await coverageTrigger.press("Enter");
        const inspectIncluded = actions
            .filter({ hasText: /View.*included/ })
            .first();
        await inspectIncluded.focus();
        await page.keyboard.press("Enter");
        await expect(page).toHaveURL(
            /view=inspect.*coverage=counter_evidence_secondary/,
        );
        await page.reload();
        await expect(
            page.getByRole("heading", {
                name: "Review matching candidates",
                exact: true,
            }),
        ).toBeVisible();
        await expect
            .poll(() =>
                page.evaluate(
                    () =>
                        document.documentElement.scrollWidth <=
                        window.innerWidth,
                ),
            )
            .toBe(true);
        expect(errors).toEqual([]);
    });

    test(`${viewport.name} coverage, inspection and source decisions retain their protected context`, async ({
        page,
    }, info) => {
        await page.setViewportSize(viewport);
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.name));
        page.on("console", (message) => {
            if (message.type() === "error") errors.push("console.error");
        });
        await admitAnalyst(page);
        const key = `source-review-design-${viewport.name}-20261022`;
        const seeded = seedSourceReview(key, true);
        await page.goto(`/workspace/${seeded.runId}?section=sources`);
        const overview = page.getByRole("region", {
            name: "Proposed source set",
            exact: true,
        });
        await expect(overview).toBeVisible();
        await expect(
            page.getByRole("button", {
                name: "Prepare source reading",
                exact: true,
            }),
        ).toBeDisabled();
        await expect(
            page.getByRole("tab", { name: "Source details", exact: true }),
        ).toHaveAttribute("aria-selected", "true");
        await page.screenshot({
            path: info.outputPath("source-review-overview.png"),
            fullPage: true,
        });

        const firstCard = page
            .getByRole("list", { name: "Sources in this group" })
            .getByRole("button")
            .first();
        await firstCard.focus();
        await firstCard.press("ArrowRight");
        await expect(
            page
                .getByRole("list", { name: "Sources in this group" })
                .getByRole("button")
                .nth(1),
        ).toBeFocused();
        await expect(
            page
                .getByRole("list", { name: "Sources in this group" })
                .getByRole("button")
                .nth(1),
        ).toHaveAttribute("aria-pressed", "true");
        const coverageTrigger = page.getByRole("button", {
            name: "Review coverage: Second independent counter-evidence source",
            exact: true,
        });
        if (viewport.name === "mobile")
            await page
                .getByRole("button", { name: "Coverage", exact: true })
                .click();
        await coverageTrigger.click();
        const actions = page.getByRole("region", {
            name: "Second independent counter-evidence source",
            exact: true,
        });
        await expect(actions).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(actions).toHaveCount(0);
        await expect(coverageTrigger).toBeFocused();
        await coverageTrigger.press("Enter");
        await actions
            .getByRole("button", {
                name: "Search sources for Second independent counter-evidence source",
                exact: true,
            })
            .click();
        await expect(actions.getByRole("status")).toContainText(
            "Source limit reached",
        );
        await actions
            .getByRole("button", {
                name: "View 1 included source",
                exact: true,
            })
            .click();
        await expect(page).toHaveURL(
            /view=inspect.*coverage=counter_evidence_secondary/,
        );
        await expect(overview).toHaveCount(0);
        await expect(
            page.getByRole("heading", {
                name: "Review matching candidates",
                exact: true,
            }),
        ).toBeVisible();
        await page.goBack();
        await expect(overview).toBeVisible();
        await page.goForward();
        await expect(
            page.getByRole("button", { name: "Back to proposal", exact: true }),
        ).toBeVisible();
        await page.reload();
        await expect(page.getByLabel("Access code")).toHaveCount(0);
        await expect(
            page.getByRole("heading", {
                name: "Review matching candidates",
                exact: true,
            }),
        ).toBeVisible();
        await page
            .getByRole("button", { name: "Back to proposal", exact: true })
            .click();
        await expect(overview).toBeVisible();
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
        await expect(overview).toHaveCount(0);
        await expect(
            page.getByRole("region", {
                name: "Inspect all source candidates",
                exact: true,
            }),
        ).toBeVisible();
        await page
            .getByRole("searchbox", { name: "Search candidates", exact: true })
            .fill("Official product documentation");
        await page
            .getByRole("button", {
                name: "Open Official product documentation for review",
                exact: true,
            })
            .click();
        const reader =
            viewport.name === "mobile"
                ? page.getByRole("dialog", {
                      name: "Source detail",
                      exact: true,
                  })
                : page.getByRole("article").filter({
                      has: page.getByRole("heading", {
                          name: "Official product documentation",
                          exact: true,
                      }),
                  });
        await expect(reader).toBeVisible();
        await reader
            .getByRole("button", {
                name: "Move Official product documentation to alternatives",
                exact: true,
            })
            .click();
        await expect(
            reader.getByText("Alternative", { exact: true }),
        ).toBeVisible();
        await reader
            .getByRole("button", {
                name: "Include Official product documentation in source set",
                exact: true,
            })
            .click();
        await expect(
            reader.getByText("Included", { exact: true }),
        ).toBeVisible();
        if (viewport.name === "mobile") {
            await page.keyboard.press("Escape");
            await expect(reader).toBeHidden();
        }
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
            path: info.outputPath("source-review-inspector.png"),
            fullPage: true,
        });
        expect(inspectSourceReview(seeded.runId, key)).toMatchObject({
            providerCallCount: 0,
            revisionStatus: "draft",
            decisions: expect.arrayContaining([
                {
                    title: "Official product documentation",
                    decision: "accepted",
                },
            ]),
        });
        expect(errors).toEqual([]);
    });
}
