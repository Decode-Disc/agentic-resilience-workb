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

const CARD_TITLE = "The Sources Agent reached its time limit";
const TIME_LIMIT_CHOICES = [
    "Use what's prepared",
    "Continue once",
    "Always continue",
] as const;

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

/**
 * Opens an unlaunched dossier that has just reached the Sources time limit.
 * The decided outcome stays with each test: a standing grant, a single
 * continuation and using what's prepared are independent analyst decisions.
 */
async function openTimeLimitDossier(page: Page, outcome: string) {
    await admitAnalyst(page);
    const fixtureKey = `sources-time-limit-${outcome}-${Date.now()}`;
    const runId = await runConvexJson<string>(
        "execution/fixtures:startWorkbench",
        { fixtureKey, slotKey: browserTestSlot() },
    );
    await page.goto(`/workspace/${runId}?section=overview`);
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
    const card = conversation.getByRole("group", { name: CARD_TITLE });
    const openDecision = progress.getByRole("button", {
        name: "Open decision",
    });
    await expect(card).toBeVisible({ timeout: 30000 });
    for (const label of TIME_LIMIT_CHOICES) {
        await expect(card.getByRole("button", { name: label })).toBeEnabled();
    }
    // The decision is made once, in the conversation; the progress header only points to it.
    await expect(progress.getByRole("group")).toHaveCount(0);
    await expect(
        page.getByRole("button", { name: "Resume research" }),
    ).toHaveCount(0);
    return { runId, fixtureKey, conversation, progress, card, openDecision };
}

test("a standing grant continues a later limit and can be revoked at 1440px", async ({
    page,
}) => {
    test.setTimeout(180000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
    });

    await page.setViewportSize({ width: 1440, height: 844 });
    const { runId, fixtureKey, conversation, progress, card, openDecision } =
        await openTimeLimitDossier(page, "grant");

    await openDecision.click();
    await expect(
        card.getByRole("button", { name: TIME_LIMIT_CHOICES[0] }),
    ).toBeFocused();
    await page.screenshot({ path: `${scratch}-attention-1440.png` });
    await expectChoiceTabOrder(page, card, TIME_LIMIT_CHOICES);
    await expectNoRawBodyCopy(page);
    await page.screenshot({
        path: `${scratch}-research-1440.png`,
        fullPage: true,
    });

    await page.goto(`/workspace/${runId}?section=sources`);
    await expect(
        page.getByRole("heading", {
            name: "Sources, captures and contributions",
            level: 1,
        }),
    ).toBeVisible({ timeout: 30000 });
    // The pending decision stays with the conversation; Sources never duplicates its choices.
    await expect(
        page.getByText("Decision needed", { exact: false }).first(),
    ).toBeVisible();
    await expect(page.getByRole("group", { name: CARD_TITLE })).toHaveCount(0);
    await expectNoRawBodyCopy(page);
    await page.screenshot({
        path: `${scratch}-sources-1440.png`,
        fullPage: true,
    });

    await page.getByRole("link", { name: "Overview" }).click();
    await expect(page).toHaveURL(/section=overview/);
    await expect(openDecision).toBeVisible({ timeout: 30000 });
    await expect(card).toBeVisible({ timeout: 30000 });
    await card.getByRole("button", { name: "Always continue" }).click();
    await expect(card.getByText("Applied: Continue preparation.")).toBeVisible({
        timeout: 30000,
    });
    await expect(
        card.getByRole("button", { name: "Stop allowing" }),
    ).toBeVisible();
    await expect(
        progress.getByRole("button", { name: "Pause research" }),
    ).toBeVisible({ timeout: 30000 });
    await page.screenshot({ path: `${scratch}-running-1440.png` });

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
        .getByRole("group", { name: CARD_TITLE })
        .last();
    await expect(
        pendingCard.getByRole("button", { name: "Always continue" }),
    ).toBeEnabled();
    await expectNoRawBodyCopy(page);
    expect(errors).toEqual([]);
});

test("continuing once applies one continuation and keeps asking later at 1440px", async ({
    page,
}) => {
    test.setTimeout(180000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
    });

    await page.setViewportSize({ width: 1440, height: 844 });
    const { runId, fixtureKey, progress, card, openDecision } =
        await openTimeLimitDossier(page, "once");

    await openDecision.click();
    await card.getByRole("button", { name: "Continue once" }).click();
    await expect(card.getByText("Applied: Continue preparation.")).toBeVisible({
        timeout: 30000,
    });
    await expect(
        progress.getByRole("button", { name: "Pause research" }),
    ).toBeVisible({ timeout: 30000 });
    // A single continuation never becomes a standing dossier permission.
    await expect(
        card.getByRole("button", { name: "Stop allowing" }),
    ).toHaveCount(0);

    await fixture("reachSourcesTimeLimit", runId, fixtureKey);
    await expect(openDecision).toBeVisible({ timeout: 30000 });
    await expect(
        card.getByRole("button", { name: "Continue once" }).last(),
    ).toBeEnabled();
    await expectNoRawBodyCopy(page);
    expect(errors).toEqual([]);
});

test("using what's prepared settles a limited run without a grant at 1440px", async ({
    page,
}) => {
    test.setTimeout(180000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
    });

    await page.setViewportSize({ width: 1440, height: 844 });
    const { runId, fixtureKey, conversation, card, openDecision } =
        await openTimeLimitDossier(page, "alternative");

    await openDecision.click();
    await expect(card).toBeVisible({ timeout: 30000 });
    await card.getByRole("button", { name: "Use what's prepared" }).click();
    await expect(openDecision).toHaveCount(0, { timeout: 30000 });
    await fixture("settleSourcesFixture", runId, fixtureKey);
    await expect(
        page.getByText(
            "The Sources Agent stopped here because you chose to use what was prepared.",
            { exact: false },
        ),
    ).toBeVisible({ timeout: 30000 });
    await expect(
        conversation.getByRole("button", { name: "Stop allowing" }),
    ).toHaveCount(0);
    await expectNoRawBodyCopy(page);
    await page.screenshot({
        path: `${scratch}-after-1440.png`,
        fullPage: true,
    });
    expect(errors).toEqual([]);
});

test("the Sources time-limit card works at 390px with reduced motion", async ({
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
    await page.goto(`/workspace/${runId}?section=overview`);

    const progress = page.getByLabel("Documentary progress");
    const conversation = page.getByLabel("Research conversation");
    await expect(
        page
            .getByLabel("Framing conversation")
            .getByText("Simulation: the research program is saved.", {
                exact: false,
            }),
    ).toBeVisible({ timeout: 60000 });
    await fixture("reachSourcesTimeLimit", runId, fixtureKey);

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
        name: CARD_TITLE,
    });
    await expect(conversationTimeLimitCard).toBeVisible({ timeout: 30000 });
    await expect(
        conversationTimeLimitCard.getByRole("button", {
            name: TIME_LIMIT_CHOICES[0],
        }),
    ).toBeFocused();
    await expectChoiceTabOrder(
        page,
        conversationTimeLimitCard,
        TIME_LIMIT_CHOICES,
    );
    await page.getByRole("button", { name: "Back to progress" }).click();

    await page.goto(`/workspace/${runId}?section=sources`);
    await expect(
        page.getByRole("heading", {
            name: "Sources, captures and contributions",
            level: 1,
        }),
    ).toBeVisible({ timeout: 30000 });
    // The pending decision stays with the conversation; Sources never duplicates its choices.
    await expect(
        page.getByText("Decision needed", { exact: false }).first(),
    ).toBeVisible();
    await expect(page.getByRole("group", { name: CARD_TITLE })).toHaveCount(0);
    await expectNoRawBodyCopy(page);
    await page.screenshot({
        path: `${scratch}-sources-390.png`,
        fullPage: true,
    });

    await page.getByRole("link", { name: "Overview" }).click();
    await expect(page).toHaveURL(/section=overview/);
    await expect(openDecision).toBeVisible({ timeout: 30000 });
    await openDecision.click();
    await expect(conversationTimeLimitCard).toBeVisible({ timeout: 30000 });
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

    await expectNoRawBodyCopy(page);
    await progress.getByRole("button", { name: "Pause research" }).click();
    expect(errors).toEqual([]);
});

test("the Workbench approval card supports keyboard navigation and denial at 390px", async ({
    page,
}) => {
    test.setTimeout(120000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
    });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 390, height: 844 });
    await admitAnalyst(page);

    const fixtureKey = `workbench-approval-390-${Date.now()}`;
    const runId = await runConvexJson<string>(
        "execution/fixtures:startWorkbench",
        {
            fixtureKey,
            slotKey: browserTestSlot(),
        },
    );
    await page.goto(`/workspace/${runId}?section=overview`);
    await expect(
        page
            .getByLabel("Framing conversation")
            .getByText("Simulation: the research program is saved.", {
                exact: false,
            }),
    ).toBeVisible({ timeout: 60000 });
    const conversation = page.getByLabel("Research conversation");
    const progress = page.getByLabel("Documentary progress");
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
    await page.getByRole("button", { name: "Ask AI" }).click();
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
