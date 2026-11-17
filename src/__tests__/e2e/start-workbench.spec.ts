import type { internal } from "@convex/_generated/api";
import { expect } from "@playwright/test";
import type { FunctionReturnType } from "convex/server";
import { reviewResearchProgram } from "@/__tests__/helpers/research-program";
import { browserTestSlot, test } from "../../../e2e/support/browser-workspace";
import { runConvexJson } from "../../../e2e/support/convex-admin";
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
        let holdNextMessage = false;
        let releaseMessage: (() => void) | undefined;
        await page.routeWebSocket(/\/api\/[^/]+\/sync$/, (socket) => {
            const server = socket.connectToServer();
            socket.onMessage((message) => {
                if (typeof message === "string") {
                    const request = JSON.parse(message);
                    if (
                        holdNextMessage &&
                        request.type === "Mutation" &&
                        request.udfPath === "execution/conversations:submit"
                    ) {
                        holdNextMessage = false;
                        releaseMessage = () => server.send(message);
                        return;
                    }
                }
                server.send(message);
            });
        });
        await admitAnalyst(page);
        const runId = await runConvexJson<string>(
            "execution/fixtures:startWorkbench",
            {
                fixtureKey: `native-start-workbench-${viewport.name}`,
                slotKey: browserTestSlot(),
            },
        );
        await page.goto(`/workspace/${runId}?section=progress`);
        await expect(
            page.getByRole("region", { name: "Research framing", exact: true }),
        ).toBeVisible({ timeout: 60000 });
        await expect(
            page.getByRole("button", { name: "Start research", exact: true }),
        ).toBeVisible({ timeout: 60000 });
        await reviewResearchProgram(page);
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
            ).toBeVisible({ timeout: 60000 });
        } catch (error) {
            await test.info().attach("workbench-state-at-missing-reply", {
                body: JSON.stringify(
                    await runConvexJson("execution/fixtures:inspectWorkbench", {
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
            page
                .getByText("Adjust the research program", { exact: true })
                .first(),
        ).toBeVisible();
        await workDetails.press("Enter");
        await expect(
            page.getByText("Adjust the research program", { exact: true }),
        ).toHaveCount(0);
        const input = page.getByRole("textbox");
        await reviewResearchProgram(page);
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
        const originalNative = await runConvexJson<
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
        holdNextMessage = true;
        await input.fill("Retain this boundary for our discussion.");
        await page
            .getByRole("button", { name: "Send refinement", exact: true })
            .click();
        await expect.poll(() => releaseMessage !== undefined).toBe(true);
        const immediateMessage = page
            .getByRole("article", { name: "You message", exact: true })
            .filter({ hasText: "Retain this boundary for our discussion." });
        await expect(immediateMessage).toHaveCount(1);
        await expect(
            page.getByRole("region", { name: "Queued messages" }),
        ).toHaveCount(0);
        releaseMessage?.();
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
        await page
            .getByRole("button", { name: "Switch theme", exact: true })
            .click();
        await expect(page.locator("html")).toHaveClass(/dark/);
        await page.screenshot({
            path: `/tmp/start-workbench-${viewport.name}-dark.png`,
        });
        await page.reload();
        await expect(
            page.getByRole("button", { name: "Start research", exact: true }),
        ).toBeVisible({ timeout: 60000 });
        await reviewResearchProgram(page);
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
        ).toBeVisible({ timeout: 60000 });
        const fixtureKey = `native-start-workbench-${viewport.name}`;
        expect(
            await runConvexJson("execution/fixtures:inspectWorkbench", {
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
        await runConvexJson("execution/fixtures:revealWorkbenchSources", {
            runId,
            fixtureKey,
        });
        await expect(
            page.getByRole("region", {
                name: "Research preparation",
                exact: true,
            }),
        ).toBeVisible();
        if (viewport.name === "mobile")
            await page
                .getByRole("button", { name: "Ask AI", exact: true })
                .click();
        const context = page.getByRole("button", {
            name: "Research context",
            exact: true,
        });
        if ((await context.getAttribute("aria-expanded")) !== "true")
            await context.click();
        const contextCard = page.locator(".chat-context-card");
        await contextCard
            .getByRole("button", { name: "Sources", exact: true })
            .click();
        const sourceSearch = contextCard.getByRole("searchbox", {
            name: "Find a source",
        });
        await expect(sourceSearch).toBeVisible();
        await sourceSearch.fill("No source has this illustrative title");
        await expect(
            contextCard.getByText("No matching source. Try another title."),
        ).toBeVisible();
        await sourceSearch.fill("");
        await expect(
            contextCard.getByRole("button", {
                name: "Inspect source workspace",
                exact: true,
            }),
        ).toBeVisible();
        await page
            .getByRole("button", {
                name: "Close research context",
                exact: true,
            })
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
