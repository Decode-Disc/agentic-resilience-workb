/// <reference types="node" />
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, type Page } from "@playwright/test";
import type { internal } from "@convex/_generated/api";
import type { FunctionArgs, FunctionReturnType } from "convex/server";

import { runConvexJson } from "./convex-cli";

type InvitationMaterial = {
    invitations: Array<{
        slotKey: string;
        role: "admin" | "analyst";
        code: string;
    }>;
};

export type SourceReviewSnapshot = FunctionReturnType<
    typeof internal.e2eFixtures.inspectSourceReviewScenario
>;

type SeededSourceReview = {
    runId: string;
    corpusRevisionId: string;
    proposalId: string;
    proposalVersion: number;
    sourceIds: Array<string>;
};

const invitation = (() => {
    const material = JSON.parse(
        readFileSync(
            resolve(process.cwd(), "invitation-otp-codes.local"),
            "utf8",
        ),
    ) as InvitationMaterial;
    const analystInvitation = material.invitations.find(
        ({ slotKey }) => slotKey === "analyst-1",
    );
    if (!analystInvitation) {
        throw new Error("Local analyst invitation is not configured");
    }
    return analystInvitation;
})();

/** Uses deterministic external image fixtures before real local authentication and admission. */
export async function admitAnalyst(page: Page): Promise<void> {
    // Dossier URL metadata stays inside the test browser instead of reaching the image proxy.
    await page.route("https://api.poly.io/og**", (route) =>
        route.fulfill({
            headers: { "access-control-allow-origin": "*" },
            json: {
                ok: true,
                imageOk: true,
                imageUrl:
                    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E",
            },
        }),
    );
    await page.route("https://www.google.com/s2/favicons**", (route) =>
        route.fulfill({
            contentType: "image/svg+xml",
            body: '<svg xmlns="http://www.w3.org/2000/svg"/>',
        }),
    );
    await page.goto("/workspace/dossiers");
    // Cold-auth bootstrap: the workspace shell can paint before the access-code
    // admission surface is interactive. Wait for the input to be visible before
    // filling so first-run and reused sessions both resolve cleanly.
    const accessCodeInput = page.getByLabel("Access code");
    await expect(accessCodeInput).toBeVisible({ timeout: 30_000 });
    await accessCodeInput.fill(invitation.code);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/workspace\/dossiers$/);
    await expect(
        page.getByRole("dialog", { name: "Protected access" }),
    ).toBeHidden();
    await expect(
        page.getByRole("heading", { name: "Dossiers", exact: true }),
    ).toBeVisible();
}

export function seedSourceReview(
    fixtureKey: string,
    recoveryScenario = false,
    recordedScenario?: FunctionArgs<
        typeof internal.e2eFixtures.seedSourceReviewScenario
    >["recordedScenario"],
): SeededSourceReview {
    return runConvexJson<SeededSourceReview>(
        "e2eFixtures:seedSourceReviewScenario",
        {
            slotKey: invitation.slotKey,
            fixtureKey,
            ...(recoveryScenario ? { recoveryScenario: true } : {}),
            ...(recordedScenario ? { recordedScenario } : {}),
        },
    );
}

export function inspectSourceReview(
    runId: string,
    fixtureKey: string,
): SourceReviewSnapshot {
    return runConvexJson<SourceReviewSnapshot>(
        "e2eFixtures:inspectSourceReviewScenario",
        { runId, fixtureKey },
    );
}
