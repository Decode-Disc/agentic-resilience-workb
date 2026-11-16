import { expect, test } from "@playwright/test";
import {
    accessCodeField,
    expectAdmissionClosed,
    localAccessCode,
    submitAccessCode,
} from "../../../e2e/support/admission";

test.describe.configure({ mode: "serial" });

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
        await page.goto("/workspace/admin");
        await expect(accessCodeField(page)).toBeVisible({ timeout: 60000 });
        await submitAccessCode(page, localAccessCode({ role: "admin" }));
        await expectAdmissionClosed(page);
        await expect(
            page.getByRole("heading", { name: "Administration", exact: true }),
        ).toBeVisible({ timeout: 60000 });
        await page
            .getByRole("tab", { name: "Models & agents", exact: true })
            .click();
        await page.getByRole("tab", { name: /^Model catalogue/ }).click();
        const initialize = page.getByRole("button", {
            name: "Set up default models",
            exact: true,
        });
        await expect(
            initialize.or(
                page.getByRole("combobox", {
                    name: "Availability of GLM-5.3-Flash",
                }),
            ),
        ).toBeVisible({ timeout: 30000 });
        if (await initialize.count()) await initialize.click();
        await expect(
            page.getByRole("combobox", {
                name: "Availability of GLM-5.3-Flash",
            }),
        ).not.toContainText("Off", { timeout: 90000 });
        await expect(
            page.getByRole("combobox", {
                name: "Availability of DeepSeek V4.1 Flash 1017",
            }),
        ).not.toContainText("Off");
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
                const availability = entry.getByRole("combobox", {
                    name: `Availability of ${label}`,
                });
                const before = (await availability.textContent())?.trim() ?? "";
                await entry
                    .getByRole("button", {
                        name: "Edit configuration",
                        exact: true,
                    })
                    .click();
                await page
                    .getByRole("button", { name: "Save", exact: true })
                    .click();
                await expect(
                    entry.getByText("Ready", { exact: true }),
                ).toBeVisible({ timeout: 90000 });
                await expect(availability).toBeEnabled({ timeout: 90000 });
                if ((await availability.textContent())?.trim() !== before) {
                    await availability.click();
                    await page.getByRole("option", { name: before }).click();
                    await page
                        .getByRole("button", {
                            name: "Save changes",
                            exact: true,
                        })
                        .click();
                }
            }
        }
        await page.screenshot({
            path: `/tmp/workbench-model-controls/after-admin-models-${viewport.name}.png`,
        });
        await page.getByRole("tab", { name: /^Agent models/ }).click();
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
        await page
            .getByRole("tab", { name: "Models & agents", exact: true })
            .click();
        await page.getByRole("tab", { name: /^Model catalogue/ }).click();
        await expect(
            page.getByRole("combobox", {
                name: "Availability of GLM-5.3-Flash",
            }),
        ).not.toContainText("Off");
        expect(
            await page.evaluate(
                () => document.documentElement.scrollWidth > innerWidth,
            ),
        ).toBe(false);
        expect(errors).toEqual([]);
    });
}
