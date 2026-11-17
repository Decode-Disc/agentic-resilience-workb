import type { internal } from "@convex/_generated/api";
import { expect } from "@playwright/test";
import type { FunctionReturnType } from "convex/server";
import { browserTestSlot, test } from "../../../e2e/support/browser-workspace";
import { runConvexJson } from "../../../e2e/support/convex-admin";
import { admitAnalyst } from "../../../e2e/support/source-review-fixture";

for (const viewport of [
    { name: "desktop", width: 1440, height: 1000 },
    { name: "mobile", width: 390, height: 844 },
]) {
    test(`model choice and immediate slash controls preserve the native dossier on ${viewport.name}`, async ({
        page,
    }) => {
        test.setTimeout(180000);
        await page.setViewportSize(viewport);
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("console", (message) => {
            if (message.type() === "error") errors.push(message.text());
        });
        await admitAnalyst(page);
        const fixtureKey = `model-controls-${viewport.name}`;
        const runId = await runConvexJson<string>(
            "execution/fixtures:startWorkbench",
            { fixtureKey, slotKey: browserTestSlot() },
        );
        const inspect = () =>
            runConvexJson<
                FunctionReturnType<
                    typeof internal.execution.fixtures.inspectWorkbench
                >
            >("execution/fixtures:inspectWorkbench", { runId, fixtureKey });
        await page.goto(`/workspace/${runId}?section=progress`);
        await expect(
            page.getByText("Simulation: the research program is saved.", {
                exact: false,
            }),
        ).toBeVisible({ timeout: 60000 });
        await page.getByRole("textbox").focus();
        const model = page.getByRole("button", {
            name: "Workbench model and effort",
            exact: true,
        });
        await expect(model).toContainText("GLM-5.3-Flash");
        const original = await inspect();
        await model.focus();
        await model.press("Enter");
        const deepseek = page.getByRole("menuitemradio", {
            name: "DeepSeek V4.1 Flash 1017",
            exact: true,
        });
        await deepseek.focus();
        await deepseek.press("Enter");
        await expect(model).toContainText("DeepSeek V4.1 Flash 1017");
        await model.click();
        const visibleModel = page.getByRole("menuitemradio", {
            name: "DeepSeek V4.1 Flash 1017",
            exact: true,
        });
        expect(
            await visibleModel.evaluate(
                (element) => element.scrollWidth <= element.clientWidth,
            ),
        ).toBe(true);
        await page.screenshot({
            path: `/tmp/workbench-composer-revision/models-${viewport.name}.png`,
            animations: "disabled",
        });
        await page.getByRole("menuitem", { name: /^Effort / }).click();
        await expect(
            page.getByRole("menuitemradio", { name: "Off", exact: true }),
        ).toBeVisible();
        await expect(
            page.getByRole("menuitemradio", { name: "Medium", exact: true }),
        ).toHaveCount(0);
        await page.screenshot({
            path: `/tmp/workbench-composer-revision/effort-${viewport.name}.png`,
            animations: "disabled",
        });
        const high = page.getByRole("menuitemradio", {
            name: "High",
            exact: true,
        });
        await high.focus();
        await high.press("Enter");
        await expect(model).toContainText("High");
        await page.reload();
        const input = page.getByRole("textbox");
        await expect(input).toBeVisible({ timeout: 60000 });
        await input.focus();
        await expect(model).toContainText("DeepSeek V4.1 Flash 1017");
        await expect(model).toContainText("High");
        expect(await inspect()).toMatchObject({
            nativeSessionId: original.nativeSessionId,
            missionCount: original.missionCount,
            invocationCount: original.invocationCount,
        });
        const send = page.getByRole("button", {
            name: "Send refinement",
            exact: true,
        });
        await input.fill("/pause");
        await send.click();
        const confirmation = page.getByText(
            "Research has not started. Review the research program and choose Start research when ready.",
            { exact: true },
        );
        await expect(confirmation).toHaveCount(1);
        await expect(input).toHaveValue("");
        expect(await inspect()).toMatchObject({
            missionCount: original.missionCount,
            invocationCount: original.invocationCount,
            providerCallCount: 0,
            queuedCount: 0,
            phase: "framing",
        });
        await input.fill("/resume");
        await send.click();
        await expect(confirmation).toHaveCount(2);
        await expect(input).toHaveValue("");
        expect(await inspect()).toMatchObject({
            missionCount: original.missionCount,
            invocationCount: original.invocationCount,
            providerCallCount: 0,
            queuedCount: 0,
        });
        await input.fill("Keep the saved program unchanged.");
        await input.press("Enter");
        await expect
            .poll(
                async () => {
                    const current = await inspect();
                    return (
                        current.invocationCount > original.invocationCount &&
                        current.nativeSettled
                    );
                },
                { timeout: 60000 },
            )
            .toBe(true);
        expect(await inspect()).toMatchObject({
            nativeSessionId: original.nativeSessionId,
            providerCallCount: 0,
            allMissionsSimulated: true,
        });
        if (viewport.name === "desktop")
            await expect(
                page.getByRole("button", {
                    name: "Close research context",
                    exact: true,
                }),
            ).toBeVisible();
        await input.pressSequentially("/");
        await expect(
            page.getByRole("listbox", { name: "Commands" }),
        ).toBeVisible();
        await page.screenshot({
            path: `/tmp/workbench-composer-revision/after-composer-commands-${viewport.name}.png`,
            animations: "disabled",
        });
        await input.press("Escape");
        await expect(input).toHaveValue("/");
        if (viewport.name === "desktop")
            await expect(
                page.getByRole("button", {
                    name: "Close research context",
                    exact: true,
                }),
            ).toBeVisible();
        await expect(
            page.getByRole("listbox", { name: "Commands" }),
        ).toHaveCount(0);
        await input.fill("");
        await page.screenshot({
            path: `/tmp/workbench-composer-revision/after-composer-${viewport.name}-light.png`,
            animations: "disabled",
        });
        await page.evaluate(() =>
            document.documentElement.classList.add("dark"),
        );
        await page.screenshot({
            path: `/tmp/workbench-composer-revision/after-composer-${viewport.name}-dark.png`,
            animations: "disabled",
        });
        expect(
            await page.evaluate(() => ({
                wide: document.documentElement.scrollWidth > innerWidth,
                tall: document.documentElement.scrollHeight > innerHeight + 1,
            })),
        ).toEqual({ wide: false, tall: false });
        await page.reload();
        const reloadedInput = page.getByRole("textbox");
        await expect(reloadedInput).toBeVisible({ timeout: 30_000 });
        await reloadedInput.focus();
        await expect(model).toContainText("DeepSeek V4.1 Flash 1017");
        await expect(
            page.getByLabel("Access code", { exact: true }),
        ).toHaveCount(0);
        expect(errors).toEqual([]);
    });
}
