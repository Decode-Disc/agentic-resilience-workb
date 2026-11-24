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
        // A settled catalogue lists the operator's availability choices; the
        // transient "checking" state only exists while a vendor check runs.
        for (const label of ["GLM-5.3-Flash", "DeepSeek V4.1 Flash 1017"]) {
            await expect(
                page.getByRole("combobox", {
                    name: `Availability of ${label}`,
                }),
            ).toHaveCount(1);
        }
        // The operator's stored availability is the value a reconnection must restore.
        const persisted = new Map<string, string>();
        for (const label of ["GLM-5.3-Flash", "DeepSeek V4.1 Flash 1017"]) {
            persisted.set(
                label,
                (
                    await page
                        .getByRole("combobox", {
                            name: `Availability of ${label}`,
                        })
                        .textContent()
                )?.trim() ?? "",
            );
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
        for (const label of ["GLM-5.3-Flash", "DeepSeek V4.1 Flash 1017"]) {
            const availability = page.getByRole("combobox", {
                name: `Availability of ${label}`,
            });
            await expect(availability).not.toContainText("Off");
            await expect(availability).toHaveText(persisted.get(label) ?? "");
        }
        expect(
            await page.evaluate(
                () => document.documentElement.scrollWidth > innerWidth,
            ),
        ).toBe(false);
        expect(errors).toEqual([]);
    });
}
