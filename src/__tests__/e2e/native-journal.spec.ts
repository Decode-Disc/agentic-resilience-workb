import { createHash } from "node:crypto";
import type { internal } from "@convex/_generated/api";
import { expect } from "@playwright/test";
import type { FunctionReturnType } from "convex/server";
import {
    browserTestDossierRow,
    closeDossierDetail,
    dossierDetail,
} from "../../../e2e/support/admin";
import {
    admitAdministrator,
    expectAdmissionClosed,
} from "../../../e2e/support/admission";
import {
    browserTestSlot,
    closeBrowserTestContext,
    test,
} from "../../../e2e/support/browser-workspace";
import { runConvexJson } from "../../../e2e/support/convex-admin";
import { admitAnalyst } from "../../../e2e/support/source-review-fixture";

for (const width of [1440, 390]) {
    test(`administrator reads a complete fragmented native snapshot after reconnection at ${width}px`, async ({
        page,
        browser,
    }) => {
        test.setTimeout(180_000);
        await page.setViewportSize({
            width,
            height: width === 390 ? 844 : 1000,
        });
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("console", (message) => {
            if (message.type() === "error") errors.push(message.text());
        });
        const analyst = await browser.newContext({
            baseURL: test.info().project.use.baseURL,
            reducedMotion: "reduce",
        });
        const analystPage = await analyst.newPage();
        try {
            await admitAnalyst(analystPage);
            const missionId = await runConvexJson<string>(
                "execution/fixtures:startValidation",
                {
                    fixtureKey: `native-large-journal-${width}`,
                    slotKey: browserTestSlot(),
                    generationBackend: { id: "pi-durable", version: 1 },
                    largeJournal: true,
                },
            );
            const inspect = () =>
                runConvexJson<
                    FunctionReturnType<
                        typeof internal.execution.fixtures.inspect
                    >
                >("execution/fixtures:inspect", { missionId });
            const state = await inspect();
            expect(state.status).toBe("blocked");
            expect(state.providerCallCount).toBe(0);
            await admitAdministrator(page);
            const dialog = dossierDetail(page);
            const journal = dialog.getByRole("region", {
                name: "Execution journal",
            });
            const row = page
                .locator('[data-slot="item"]')
                .filter({ has: page.getByText(state.runId, { exact: true }) });
            async function open() {
                await page
                    .getByRole("tab", { name: "Dossiers", exact: true })
                    .click();
                await page
                    .getByRole("tab", { name: "Browser tests", exact: true })
                    .click();
                await (await browserTestDossierRow(page, state.runId))
                    .getByRole("button", {
                        name: "Open dossier",
                        exact: true,
                    })
                    .click();
                await dossierDetail(page)
                    .getByRole("tab", { name: "Execution journal" })
                    .click();
                await journal
                    .getByRole("button", { name: /Request recorded/ })
                    .click();
                await expect(
                    journal.getByText("Simulation · Not live", { exact: true }),
                ).toBeVisible();
                await journal
                    .getByRole("button", {
                        name: "Request snapshot",
                        exact: true,
                    })
                    .click();
                await expect(
                    journal.getByText("More snapshot content available", {
                        exact: true,
                    }),
                ).toBeVisible();
            }
            await open();
            const snapshot = journal.locator("pre");
            const first = await snapshot.textContent();
            expect(first?.length).toBe(60 * 1024);
            const more = journal.getByRole("button", {
                name: "Load more snapshot content",
                exact: true,
            });
            await more.hover();
            await snapshot.focus();
            await page.keyboard.press("Tab");
            await expect(more).toBeFocused();
            while (await more.count()) {
                const before = await snapshot.evaluate(
                    (element) => element.textContent?.length ?? 0,
                );
                await page.keyboard.press("Enter");
                await expect
                    .poll(() =>
                        snapshot.evaluate(
                            (element) => element.textContent?.length ?? 0,
                        ),
                    )
                    .toBeGreaterThan(before);
                if (await more.count()) await expect(more).toBeFocused();
            }
            await expect(snapshot).toBeFocused();
            await expect(
                journal.getByText("Full snapshot loaded", { exact: true }),
            ).toBeVisible();
            const complete = (await snapshot.textContent()) ?? "";
            const parsed = JSON.parse(complete) as {
                messages: Array<{ role: string; content: string }>;
            };
            expect(
                parsed.messages.some(
                    (message) =>
                        message.role === "user" &&
                        message.content ===
                            "Retained local verification text. ".repeat(23000),
                ),
            ).toBe(true);
            const hash = createHash("sha256").update(complete).digest("hex");
            await expect(journal.getByText(new RegExp(hash))).toBeVisible();
            expect(
                await dialog.evaluate(
                    (element) => element.scrollWidth <= element.clientWidth,
                ),
            ).toBe(true);
            await page.screenshot({
                path: test
                    .info()
                    .outputPath(`native-fragmented-journal-${width}.png`),
            });
            // The open dossier is part of the address; close it so reconnection reopens it from the list.
            await closeDossierDetail(page);
            await page.context().setOffline(true);
            await page.context().setOffline(false);
            await page.reload();
            await expect(
                page.getByRole("heading", {
                    name: "Administration",
                    exact: true,
                }),
            ).toBeVisible();
            await expectAdmissionClosed(page);
            await open();
            await expect(journal.getByText(new RegExp(hash))).toBeVisible();
            expect((await snapshot.textContent()) === first).toBe(true);
            await closeDossierDetail(page);
            await expect(
                row.getByRole("button", {
                    name: "Open dossier",
                    exact: true,
                }),
            ).toBeFocused();
            expect(await inspect()).toEqual(state);
            expect(errors).toEqual([]);
        } finally {
            await closeBrowserTestContext(analystPage);
            await analyst.close();
        }
    });
}
