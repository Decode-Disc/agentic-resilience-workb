import { readFileSync } from "node:fs";
import { expect } from "@playwright/test";
import type { internal } from "@convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import {
    accessCodeField,
    expectAdmissionClosed,
    submitAccessCode,
} from "./support/admission";
import { closeBrowserTestContext, test } from "./support/browser-workspace";
import { runConvexJson } from "./support/convex-cli";
import { admitAnalyst } from "./support/source-review-fixture";

type Snapshot = FunctionReturnType<typeof internal.execution.fixtures.inspect>;
for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
]) {
    test(`administrator inspects the simulated journal after reconnection at ${viewport.width}px`, async ({
        page,
        browser,
    }) => {
        test.setTimeout(150_000);
        await page.setViewportSize(viewport);
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("console", (message) => {
            if (message.type() === "error") errors.push(message.text());
        });
        const analystContext = await browser.newContext({
            baseURL: test.info().project.use.baseURL,
            reducedMotion: "reduce",
        });
        const analystPage = await analystContext.newPage();
        try {
            await admitAnalyst(analystPage);
            const missionId = runConvexJson<string>(
                "execution/fixtures:start",
                { fixtureKey: `journal-${viewport.width}` },
            );
            const inspect = () =>
                runConvexJson<Snapshot>("execution/fixtures:inspect", {
                    missionId,
                });
            await expect
                .poll(inspect, { timeout: 90_000 })
                .toMatchObject({ status: "completed", providerCallCount: 0 });
            const snapshot = inspect();
            await page.goto("/workspace/admin");
            const material = JSON.parse(
                readFileSync("invitation-otp-codes.local", "utf8"),
            ) as { invitations: Array<{ role: string; code: string }> };
            const invitation = material.invitations.find(
                (item) => item.role === "admin",
            );
            if (!invitation)
                throw new Error("Local administrator invitation is missing");
            await expect(accessCodeField(page)).toBeVisible({
                timeout: 30_000,
            });
            await submitAccessCode(page, invitation.code);
            await expectAdmissionClosed(page);
            await page
                .getByRole("tab", { name: "Browser tests", exact: true })
                .click();
            const row = page
                .locator('[data-slot="item"]')
                .filter({
                    has: page.getByText(snapshot.runId, { exact: true }),
                });
            await row
                .getByRole("button", { name: "Inspect dossier", exact: true })
                .click();
            const dialog = page.getByRole("dialog", {
                name: "Dossier inspection",
            });
            const journal = dialog.getByRole("region", {
                name: "Execution journal",
            });
            await expect(
                dialog.getByText("Provider receipts", { exact: true }),
            ).toBeVisible();
            await expect(
                journal.getByRole("heading", { name: "Execution journal" }),
            ).toBeVisible();
            const event = journal
                .getByRole("button", { name: /Request recorded/ })
                .first();
            await event.focus();
            await expect(event).toBeFocused();
            await page.keyboard.press("Enter");
            await expect(
                journal.getByText("Simulation · Not live", { exact: true }),
            ).toBeVisible();
            const request = journal.getByRole("button", {
                name: "Request snapshot",
                exact: true,
            });
            await request.focus();
            await page.keyboard.press("Enter");
            const payload = journal.locator("pre");
            await expect(payload).toContainText('"provenance":"simulation"');
            await expect(payload).toContainText("availableMaterials");
            await payload.focus();
            await expect(payload).toBeFocused();
            expect((await payload.textContent())?.length).toBeGreaterThan(1000);
            await page.screenshot({
                path: test.info().outputPath(`journal-${viewport.width}.png`),
            });
            expect(
                await dialog.evaluate(
                    (element) => element.scrollWidth <= element.clientWidth,
                ),
            ).toBe(true);
            await journal
                .getByRole("button", { name: "Reply snapshot", exact: true })
                .click();
            await expect(payload).toContainText('"response"');
            await expect(payload).not.toContainText("availableMaterials");
            const more = journal.getByRole("button", {
                name: "Load more events",
                exact: true,
            });
            await more.click();
            await expect(
                journal.getByRole("button", { name: /mission completed/ }),
            ).toBeVisible();
            await journal
                .getByRole("button", { name: /Operation completed/ })
                .first()
                .click();
            await journal
                .getByRole("button", {
                    name: "Operation request and result",
                    exact: true,
                })
                .click();
            await expect(journal.locator("pre")).toContainText(
                '"kind": "consult_mission_state"',
            );
            await expect(journal.locator("pre")).toContainText(
                '"kind": "success"',
            );
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
            await page
                .getByRole("tab", { name: "Browser tests", exact: true })
                .click();
            await row
                .getByRole("button", { name: "Inspect dossier", exact: true })
                .click();
            await expect(
                journal.getByRole("heading", { name: "Execution journal" }),
            ).toBeVisible();
            await expect(journal.locator("pre")).toHaveCount(0);
            await page.keyboard.press("Escape");
            await expect(dialog).toBeHidden();
            await expect(
                row.getByRole("button", {
                    name: "Inspect dossier",
                    exact: true,
                }),
            ).toBeFocused();
            expect(inspect()).toEqual(snapshot);
            expect(errors).toEqual([]);
        } finally {
            closeBrowserTestContext(analystPage);
            await analystContext.close();
        }
    });
}
