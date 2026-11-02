import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import {
    accessCodeField,
    expectAdmissionClosed,
    submitAccessCode,
} from "../../../e2e/support/admission";

for (const viewport of [
    { name: "desktop", width: 1440, height: 1000 },
    { name: "mobile", width: 390, height: 844 },
]) {
    test(`model configuration is protected and persists after administrator reconnection on ${viewport.name}`, async ({
        page,
    }) => {
        test.setTimeout(180000);
        await page.setViewportSize(viewport);
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("console", (message) => {
            if (message.type() === "error") errors.push(message.text());
        });
        const material: unknown = JSON.parse(
            readFileSync("invitation-otp-codes.local", "utf8"),
        );
        if (
            !material ||
            typeof material !== "object" ||
            !("invitations" in material) ||
            !Array.isArray(material.invitations)
        )
            throw new Error("Local invitation material unavailable");
        const invitation = material.invitations.find(
            (entry: unknown) =>
                entry &&
                typeof entry === "object" &&
                "role" in entry &&
                entry.role === "admin",
        );
        if (!invitation || typeof invitation.code !== "string")
            throw new Error("Local administrator admission unavailable");
        await page.goto("/workspace/admin");
        await expect(accessCodeField(page)).toBeVisible({ timeout: 60000 });
        await submitAccessCode(page, invitation.code);
        await expectAdmissionClosed(page);
        await expect(
            page.getByRole("heading", { name: "Administration", exact: true }),
        ).toBeVisible({ timeout: 60000 });
        await page.getByRole("tab", { name: "Models", exact: true }).click();
        const initialize = page.getByRole("button", {
            name: "Set up default models",
            exact: true,
        });
        await expect(
            initialize.or(
                page.getByRole("switch", {
                    name: /^Enable GLM-5.3-Flash/,
                }),
            ),
        ).toBeVisible({ timeout: 30000 });
        if (await initialize.count()) await initialize.click();
        await expect(
            page.getByRole("switch", {
                name: /^Enable GLM-5.3-Flash/,
            }),
        ).toBeChecked({ timeout: 90000 });
        await expect(
            page.getByRole("switch", {
                name: /^Enable DeepSeek V4.1 Flash 1017/,
            }),
        ).toBeChecked();
        await expect(
            page.getByText("Preparing compatibility checks", { exact: true }),
        ).toHaveCount(0);
        if (
            viewport.name === "desktop" &&
            process.env.WORKBENCH_E2E_REFRESH_MODEL_METADATA === "1"
        ) {
            for (const label of ["GLM-5.3-Flash", "DeepSeek V4.1 Flash 1017"]) {
                const entry = page.getByRole("region", {
                    name: label,
                    exact: true,
                });
                const enable = entry.getByRole("switch", {
                    name: new RegExp(`^Enable ${label.replaceAll(".", "\\.")}`),
                });
                const offer = entry.getByRole("switch", {
                    name: new RegExp(
                        `^Offer ${label.replaceAll(".", "\\.")} in composer`,
                    ),
                });
                const enabled = await enable.isChecked(),
                    offered = await offer.isChecked();
                await entry
                    .getByRole("button", {
                        name: "Edit configuration",
                        exact: true,
                    })
                    .click();
                await page
                    .getByRole("button", { name: "Prepare model", exact: true })
                    .click();
                await expect(
                    entry.getByText(
                        "Prepared · answer quality evaluated separately",
                        { exact: true },
                    ),
                ).toBeVisible({ timeout: 90000 });
                await expect(enable).toBeEnabled({ timeout: 90000 });
                if (enabled) {
                    await enable.click();
                    await expect(enable).toBeChecked();
                }
                if (offered) {
                    await offer.click();
                    await expect(offer).toBeChecked();
                }
            }
        }
        await page.screenshot({
            path: `/tmp/workbench-model-controls/after-admin-models-${viewport.name}.png`,
        });
        await page
            .getByRole("tab", { name: "Agent models", exact: true })
            .click();
        await expect(
            page.getByRole("combobox", {
                name: "Workbench model",
                exact: true,
            }),
        ).toContainText("GLM-5.3-Flash");
        await expect(
            page.getByText("Not connected yet", { exact: true }),
        ).toHaveCount(2);
        await page.screenshot({
            path: `/tmp/workbench-model-controls/after-admin-agents-${viewport.name}.png`,
        });
        await page.reload();
        await expectAdmissionClosed(page);
        await page.getByRole("tab", { name: "Models", exact: true }).click();
        await expect(
            page.getByRole("switch", {
                name: /^Enable GLM-5.3-Flash/,
            }),
        ).toBeChecked();
        expect(
            await page.evaluate(
                () => document.documentElement.scrollWidth > innerWidth,
            ),
        ).toBe(false);
        expect(errors).toEqual([]);
    });
}
