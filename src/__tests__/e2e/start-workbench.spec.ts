import type { internal } from "@convex/_generated/api";
import { expect } from "@playwright/test";
import type { FunctionReturnType } from "convex/server";
import { test } from "../../../e2e/support/browser-workspace";
import { runConvexCli, runConvexJson } from "../../../e2e/support/convex-cli";
import { admitAnalyst } from "../../../e2e/support/source-review-fixture";

for (const viewport of [
    { name: "desktop", width: 1440, height: 1000 },
    { name: "mobile", width: 390, height: 844 },
]) {
    test(`START saves the research program and conversation through reconnection on ${viewport.name}`, async ({
        page,
    }) => {
        test.setTimeout(150000);
        await page.setViewportSize(viewport);
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("console", (message) => {
            if (message.type() === "error") errors.push(message.text());
        });
        await admitAnalyst(page);
        const runId = runConvexJson<string>(
            "execution/fixtures:startWorkbench",
            { fixtureKey: `native-start-workbench-${viewport.name}` },
        );
        await page.goto(`/workspace/${runId}?section=progress`);
        await expect(
            page.getByRole("region", { name: "Research framing", exact: true }),
        ).toBeVisible({ timeout: 60000 });
        await expect(
            page.getByText("Who controls the workflow and its rules?", {
                exact: true,
            }),
        ).toBeVisible({ timeout: 60000 });
        try {
            await expect(
                page.getByText("Simulation: the research program is saved.", {
                    exact: false,
                }),
            ).toBeVisible();
        } catch (error) {
            await test.info().attach("workbench-state-at-missing-reply", {
                body: JSON.stringify(
                    runConvexJson("execution/fixtures:inspectWorkbench", {
                        runId,
                        fixtureKey: `native-start-workbench-${viewport.name}`,
                    }),
                ),
                contentType: "application/json",
            });
            throw error;
        }
        const workDetails = page
            .getByRole("button", {
                name: "Inspect work for this turn",
                exact: true,
            })
            .first();
        await workDetails.focus();
        await workDetails.press("Enter");
        await expect(
            page.getByText("Adjust the research program", { exact: true }),
        ).toBeVisible();
        await workDetails.press("Enter");
        await expect(
            page.getByText("Adjust the research program", { exact: true }),
        ).not.toBeVisible();
        const input = page.getByRole("textbox");
        await page
            .getByRole("button", { name: "Edit question", exact: true })
            .click();
        await expect(input).toBeFocused();
        await input.fill(
            "Who controls coordination and switching in this workflow?",
        );
        await page
            .getByRole("button", { name: "Save changes", exact: true })
            .click();
        await expect(
            page.getByText(
                "Who controls coordination and switching in this workflow?",
                { exact: true },
            ),
        ).toBeVisible();
        await expect(
            page.getByRole("button", { name: "Start research", exact: true }),
        ).toBeEnabled();
        const originalNative = runConvexJson<
            FunctionReturnType<
                typeof internal.execution.fixtures.inspectWorkbench
            >
        >("execution/fixtures:inspectWorkbench", {
            runId,
            fixtureKey: `native-start-workbench-${viewport.name}`,
        });
        expect(originalNative.missions).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    definitionId: "workbench_v1",
                    definitionVersion: originalNative.definitionVersion,
                }),
            ]),
        );
        expect(originalNative.nativeSessionId).toBeTruthy();
        await input.fill("Retain this boundary for our discussion.");
        await page
            .getByRole("button", { name: "Send refinement", exact: true })
            .click();
        await expect(input).toHaveValue("");
        await expect(
            page.getByText("Simulation: the research program is saved.", {
                exact: false,
            }),
        ).toHaveCount(2, { timeout: 60000 });
        await expect(
            page.getByText("Retain this boundary for our discussion.", {
                exact: true,
            }),
        ).toBeVisible();
        await expect
            .poll(() =>
                page.evaluate(() => ({
                    wide: document.documentElement.scrollWidth > innerWidth,
                    tall:
                        document.documentElement.scrollHeight > innerHeight + 1,
                })),
            )
            .toEqual({ wide: false, tall: false });
        await page.screenshot({
            path: `/tmp/start-workbench-${viewport.name}-light.png`,
        });
        await page.evaluate(() => {
            document.documentElement.classList.add("dark");
        });
        await page.screenshot({
            path: `/tmp/start-workbench-${viewport.name}-dark.png`,
        });
        await page.reload();
        await expect(
            page.getByText(
                "Who controls coordination and switching in this workflow?",
                { exact: true },
            ),
        ).toBeVisible();
        await expect(
            page.getByText("Retain this boundary for our discussion.", {
                exact: true,
            }),
        ).toBeVisible();
        await expect(
            page.getByLabel("Access code", { exact: true }),
        ).toHaveCount(0);
        await expect(page.getByRole("textbox")).toBeInViewport();
        await page.getByRole("textbox").fill("Start research now");
        await page
            .getByRole("button", { name: "Send refinement", exact: true })
            .click();
        await expect(
            page.getByText(
                "Research has not started. Review the research program and choose Start research when ready.",
                { exact: true },
            ),
        ).toBeVisible({ timeout: 60000 });
        await expect(
            page.getByRole("button", { name: "Start research", exact: true }),
        ).toBeEnabled();
        await page.reload();
        await expect(
            page.getByText(
                "Research has not started. Review the research program and choose Start research when ready.",
                { exact: true },
            ),
        ).toBeVisible();
        const fixtureKey = `native-start-workbench-${viewport.name}`;
        expect(
            runConvexJson("execution/fixtures:inspectWorkbench", {
                runId,
                fixtureKey,
            }),
        ).toMatchObject({
            providerCallCount: 0,
            allMissionsSimulated: true,
            queuedCount: 0,
            phase: "framing",
            definitionVersion: originalNative.definitionVersion,
            nativeSessionId: originalNative.nativeSessionId,
            nativeSettled: true,
        });
        runConvexCli([
            "run",
            "execution/fixtures:revealWorkbenchSources",
            JSON.stringify({ runId, fixtureKey }),
            "--deployment",
            "local",
        ]);
        await expect(
            page.getByRole("region", {
                name: "Research preparation",
                exact: true,
            }),
        ).toBeVisible();
        await expect(
            page.getByRole("button", { name: "Review sources", exact: true }),
        ).toBeVisible();
        if (viewport.name === "mobile")
            await page
                .getByRole("button", { name: "Ask AI", exact: true })
                .click();
        const followup = page.getByRole("textbox");
        await expect(followup).toBeVisible();
        await followup.fill("Keep this documentary question in my draft.");
        if (viewport.name === "mobile") {
            await page
                .getByRole("button", { name: "Back to progress", exact: true })
                .click();
            await page
                .getByRole("button", { name: "Ask AI", exact: true })
                .click();
            await expect(followup).toHaveValue(
                "Keep this documentary question in my draft.",
            );
        }
        await expect
            .poll(() =>
                page.evaluate(() => ({
                    wide: document.documentElement.scrollWidth > innerWidth,
                    tall:
                        document.documentElement.scrollHeight > innerHeight + 1,
                })),
            )
            .toEqual({ wide: false, tall: false });
        if (viewport.name === "desktop")
            await expect(page.getByRole("banner")).toBeInViewport();
        await expect(
            page.getByText("ANALYST_URL", { exact: true }),
        ).toHaveCount(0);
        await page.screenshot({
            path: `/tmp/start-sources-${viewport.name}.png`,
        });
        expect(errors).toEqual([]);
    });
}
