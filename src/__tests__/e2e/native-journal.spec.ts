import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { internal } from "@convex/_generated/api";
import { expect } from "@playwright/test";
import type { FunctionReturnType } from "convex/server";
import {
    accessCodeField,
    expectAdmissionClosed,
    submitAccessCode,
} from "../../../e2e/support/admission";
import {
    closeBrowserTestContext,
    test,
} from "../../../e2e/support/browser-workspace";
import { runConvexJson } from "../../../e2e/support/convex-cli";
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
            const missionId = runConvexJson<string>(
                "execution/fixtures:startValidation",
                {
                    fixtureKey: `native-large-journal-${width}`,
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
            const state = inspect();
            expect(state.status).toBe("blocked");
            expect(state.providerCallCount).toBe(0);
            const material = JSON.parse(
                readFileSync("invitation-otp-codes.local", "utf8"),
            ) as { invitations: Array<{ role: string; code: string }> };
            const invitation = material.invitations.find(
                (item) => item.role === "admin",
            );
            if (!invitation)
                throw new Error("Local administrator admission unavailable");
            await page.goto("/workspace/admin");
            await expect(accessCodeField(page)).toBeVisible({
                timeout: 60_000,
            });
            await submitAccessCode(page, invitation.code);
            await expectAdmissionClosed(page);
            await expect(
                page.getByRole("heading", {
                    name: "Administration",
                    exact: true,
                }),
            ).toBeVisible();
            const dialog = page.getByRole("dialog", {
                name: "Dossier inspection",
            });
            const journal = dialog.getByRole("region", {
                name: "Execution journal",
            });
            const row = page
                .locator('[data-slot="item"]')
                .filter({ has: page.getByText(state.runId, { exact: true }) });
            async function open() {
                await page
                    .getByRole("tab", { name: "Browser tests", exact: true })
                    .click();
                await row
                    .getByRole("button", {
                        name: "Inspect dossier",
                        exact: true,
                    })
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
            await page.keyboard.press("Escape");
            await expect(dialog).toBeHidden();
            await expect(
                row.getByRole("button", {
                    name: "Inspect dossier",
                    exact: true,
                }),
            ).toBeFocused();
            expect(inspect()).toEqual(state);
            expect(errors).toEqual([]);
        } finally {
            closeBrowserTestContext(analystPage);
            await analyst.close();
        }
    });
}
