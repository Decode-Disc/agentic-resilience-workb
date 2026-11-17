import type { internal } from "@convex/_generated/api";
import { expect, type Locator, type Page } from "@playwright/test";
import type { FunctionReturnType } from "convex/server";
import { browserTestSlot, test } from "../../../e2e/support/browser-workspace";
import { runConvexJson } from "../../../e2e/support/convex-admin";
import { admitAnalyst } from "../../../e2e/support/source-review-fixture";

const scratch =
    process.env.SOURCES_TIME_LIMIT_SCREENSHOTS ?? "/tmp/sources-time-limit";
const raw =
    /approval_|sources_time_limit|execution_time_limit|stale_execution|_research\b/;

async function fixture(name: string, runId: string, fixtureKey: string) {
    await runConvexJson(`execution/fixtures:${name}`, { runId, fixtureKey });
}

async function expectChoiceTabOrder(
    page: Page,
    card: Locator,
    labels: readonly string[],
) {
    const first = card.getByRole("button", { name: labels[0] });
    await first.focus();
    await expect(first).toBeFocused();
    for (const label of labels.slice(1)) {
        await page.keyboard.press("Tab");
        await expect(card.getByRole("button", { name: label })).toBeFocused();
    }
}

async function expectNoRawBodyCopy(page: Page) {
    expect(await page.locator("body").innerText()).not.toMatch(raw);
}

test("approval cards and dossier grants govern Sources time limits at 1440px", async ({
    page,
}) => {
    test.setTimeout(180000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
    });

    await page.setViewportSize({ width: 1440, height: 844 });
    await admitAnalyst(page);
    const fixtureKey = `sources-time-limit-1440-${Date.now()}`;
    const runId = await runConvexJson<string>(
        "execution/fixtures:startWorkbench",
        {
            fixtureKey,
            slotKey: browserTestSlot(),
        },
    );
    await page.goto(`/workspace/${runId}?section=progress`);
    const conversation = page.getByLabel("Research conversation");
    const progress = page.getByLabel("Documentary progress");

    await expect(
        page
            .getByLabel("Framing conversation")
            .getByText("Simulation: the research program is saved.", {
                exact: false,
            }),
    ).toBeVisible({ timeout: 60000 });

    await fixture("reachSourcesTimeLimit", runId, fixtureKey);

    const cardTitle = "The Sources Agent reached its time limit";
    const timeLimitChoices = [
        "Use what's prepared",
        "Continue once",
        "Always continue",
    ] as const;

    const conversationCard = conversation.getByRole("group", {
        name: cardTitle,
    });
    const openDecision = progress.getByRole("button", {
        name: "Open decision",
    });
    await expect(conversationCard).toBeVisible({ timeout: 30000 });
    for (const label of timeLimitChoices) {
        await expect(
            conversationCard.getByRole("button", { name: label }),
        ).toBeEnabled();
    }
    // The decision is made once, in the conversation; the progress header only points to it.
    await expect(progress.getByRole("group")).toHaveCount(0);
    await expect(
        page.getByRole("button", { name: "Resume research" }),
    ).toHaveCount(0);
    await openDecision.click();
    await expect(
        conversationCard.getByRole("button", { name: timeLimitChoices[0] }),
    ).toBeFocused();
    await expectChoiceTabOrder(page, conversationCard, timeLimitChoices);
    await expectNoRawBodyCopy(page);
    await page.screenshot({
        path: `${scratch}-research-1440.png`,
        fullPage: true,
    });

    await page.goto(`/workspace/${runId}?section=sources`);
    await expect(
        page.getByRole("button", { name: "Open decision" }),
    ).toBeVisible({ timeout: 30000 });
    await expect(page.getByRole("group", { name: cardTitle })).toHaveCount(0);
    await expectNoRawBodyCopy(page);
    await page.screenshot({
        path: `${scratch}-sources-1440.png`,
        fullPage: true,
    });

    await page.getByRole("button", { name: "Open decision" }).click();
    await expect(page).toHaveURL(/section=progress/);
    await expect(conversationCard).toBeVisible({ timeout: 30000 });
    await conversationCard
        .getByRole("button", { name: "Always continue" })
        .click();
    await expect(
        conversationCard.getByText("Applied: Continue preparation."),
    ).toBeVisible({ timeout: 30000 });
    await expect(
        conversationCard.getByRole("button", { name: "Stop allowing" }),
    ).toBeVisible();
    await expect(
        progress.getByRole("button", { name: "Pause research" }),
    ).toBeVisible({ timeout: 30000 });

    // A second limit continues automatically while the dossier grant is active.
    await fixture("reachSourcesTimeLimit", runId, fixtureKey);
    await expect(
        progress.getByRole("button", { name: "Pause research" }),
    ).toBeVisible({ timeout: 30000 });
    await expect(
        page.getByRole("button", { name: "Always continue" }),
    ).toHaveCount(0);

    // Revoke the grant from the Commands picker so the next limit asks again.
    await page.getByRole("button", { name: "Composer tools" }).click();
    await page.getByRole("menuitem", { name: "Commands" }).click();
    const allowedGroup = page.getByRole("group", { name: "Allowed actions" });
    await expect(allowedGroup).toBeVisible({ timeout: 15000 });
    await expect(
        allowedGroup.getByText("Continue preparation automatically"),
    ).toBeVisible();
    await allowedGroup
        .getByRole("button", { name: /Continue preparation automatically/ })
        .click();
    await expect(allowedGroup).toHaveCount(0, { timeout: 15000 });
    await page.keyboard.press("Escape");

    await fixture("reachSourcesTimeLimit", runId, fixtureKey);
    await expect(openDecision).toBeVisible({ timeout: 30000 });
    const pendingCard = conversation
        .getByRole("group", { name: cardTitle })
        .last();
    await expect(
        pendingCard.getByRole("button", { name: "Always continue" }),
    ).toBeEnabled();

    await pendingCard
        .getByRole("button", { name: "Use what's prepared" })
        .click();
    await expect(openDecision).toHaveCount(0, { timeout: 30000 });
    await fixture("settleSourcesFixture", runId, fixtureKey);
    await expect(
        page.getByText("No usable material prepared", {
            exact: false,
        }),
    ).toBeVisible({ timeout: 30000 });
    await expectNoRawBodyCopy(page);
    await page.screenshot({
        path: `${scratch}-after-1440.png`,
        fullPage: true,
    });
    expect(errors).toEqual([]);
});

test("approval cards work at 390px with reduced motion, including Workbench request_approval", async ({
    page,
}) => {
    test.setTimeout(180000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
    });

    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 390, height: 844 });
    await admitAnalyst(page);
    const fixtureKey = `sources-time-limit-390-${Date.now()}`;
    const runId = await runConvexJson<string>(
        "execution/fixtures:startWorkbench",
        {
            fixtureKey,
            slotKey: browserTestSlot(),
        },
    );
    await page.goto(`/workspace/${runId}?section=progress`);

    const progress = page.getByLabel("Documentary progress");
    const askAi = page.getByRole("button", { name: "Ask AI" });
    const conversation = page.getByLabel("Research conversation");
    await expect(
        page
            .getByLabel("Framing conversation")
            .getByText("Simulation: the research program is saved.", {
                exact: false,
            }),
    ).toBeVisible({ timeout: 60000 });
    await fixture("reachSourcesTimeLimit", runId, fixtureKey);

    const cardTitle = "The Sources Agent reached its time limit";
    const timeLimitChoices = [
        "Use what's prepared",
        "Continue once",
        "Always continue",
    ] as const;

    const openDecision = progress.getByRole("button", {
        name: "Open decision",
    });
    await expect(openDecision).toBeVisible({ timeout: 30000 });
    await expect(progress.getByRole("group")).toHaveCount(0);
    await expectNoRawBodyCopy(page);
    await page.screenshot({
        path: `${scratch}-research-390.png`,
        fullPage: true,
    });

    // On a phone the pointer opens the conversation with focus on the decision.
    await openDecision.click();
    const conversationTimeLimitCard = conversation.getByRole("group", {
        name: cardTitle,
    });
    await expect(conversationTimeLimitCard).toBeVisible({ timeout: 30000 });
    await expect(
        conversationTimeLimitCard.getByRole("button", {
            name: timeLimitChoices[0],
        }),
    ).toBeFocused();
    await expectChoiceTabOrder(
        page,
        conversationTimeLimitCard,
        timeLimitChoices,
    );
    await page.getByRole("button", { name: "Back to progress" }).click();

    await page.goto(`/workspace/${runId}?section=sources`);
    await expect(
        page.getByRole("button", { name: "Open decision" }),
    ).toBeVisible({ timeout: 30000 });
    await expect(page.getByRole("group", { name: cardTitle })).toHaveCount(0);
    await expectNoRawBodyCopy(page);
    await page.screenshot({
        path: `${scratch}-sources-390.png`,
        fullPage: true,
    });

    await page.getByRole("button", { name: "Open decision" }).click();
    await expect(page).toHaveURL(/section=progress/);
    await askAi.click();
    await conversationTimeLimitCard
        .getByRole("button", { name: "Continue once" })
        .click();
    await expect(
        conversationTimeLimitCard.getByText("Applied: Continue preparation."),
    ).toBeVisible({ timeout: 30000 });
    await page.getByRole("button", { name: "Back to progress" }).click();
    try {
        await expect(
            progress.getByRole("button", { name: "Pause research" }),
        ).toBeVisible({ timeout: 30000 });
    } finally {
        const state = await runConvexJson<
            FunctionReturnType<
                typeof internal.execution.fixtures.inspectWorkbench
            >
        >("execution/fixtures:inspectWorkbench", { runId, fixtureKey });
        await test.info().attach("continued-mission-state", {
            body: JSON.stringify({
                executionStatus: state.executionStatus,
                providerCallCount: state.providerCallCount,
                missions: state.missions.map(
                    ({
                        definitionId,
                        status,
                        blockCode,
                        deadlineAt,
                        provenance,
                    }) => ({
                        definitionId,
                        status,
                        blockCode,
                        deadlineAt,
                        provenance,
                    }),
                ),
            }),
            contentType: "application/json",
        });
    }

    // Trigger a Workbench request_approval card and deny it.
    await expect
        .poll(
            async () =>
                (
                    await runConvexJson<{ nativeSettled: boolean }>(
                        "execution/fixtures:inspectWorkbench",
                        { runId, fixtureKey },
                    )
                ).nativeSettled,
            { timeout: 30000 },
        )
        .toBe(true);
    await fixture("requestApprovalFixture", runId, fixtureKey);
    await askAi.click();
    await expect(
        conversation.getByText(
            "Simulation: please confirm whether to pause research.",
            { exact: false },
        ),
    ).toBeVisible({ timeout: 30000 });
    const pauseCard = conversation.getByRole("group", {
        name: "Pause research",
    });
    await expect(pauseCard).toBeVisible({ timeout: 30000 });
    const defaultChoices = ["Deny", "Always allow", "Allow once"] as const;
    for (const label of defaultChoices) {
        await expect(
            pauseCard.getByRole("button", { name: label }),
        ).toBeEnabled();
    }
    await expectChoiceTabOrder(page, pauseCard, defaultChoices);
    await pauseCard.getByRole("button", { name: "Deny" }).click();
    await expect(
        pauseCard.getByText("Denied: Pause research was not applied."),
    ).toBeVisible({ timeout: 30000 });
    await page.getByRole("button", { name: "Back to progress" }).click();

    // Denying Pause research leaves research running; pause explicitly to clean up.
    const pauseButton = progress.getByRole("button", {
        name: "Pause research",
    });
    await expect(pauseButton).toBeVisible({ timeout: 30000 });
    await expectNoRawBodyCopy(page);
    await pauseButton.click({ timeout: 30000 });
    await page.screenshot({
        path: `${scratch}-after-390.png`,
        fullPage: true,
    });
    expect(errors).toEqual([]);
});
