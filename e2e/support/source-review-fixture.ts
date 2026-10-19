/// <reference types="node" />
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, type Page } from "@playwright/test";

import { runConvexJson } from "./convex-cli";

type InvitationMaterial = {
    invitations: Array<{
        slotKey: string;
        role: "admin" | "analyst";
        code: string;
    }>;
};

export type SourceReviewSnapshot = {
    lifecycleState: string;
    executionStatus: string;
    revisionStatus: string;
    decisions: Array<{
        title: string;
        decision: "accepted" | "pending" | "rejected";
    }>;
    providerCallCount: number;
};

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

export async function admitAnalyst(page: Page): Promise<void> {
    await page.goto("/workspace/dossiers");
    // Cold-auth bootstrap: the workspace shell can paint before the access-code
    // admission surface is interactive. Wait for the input to be visible before
    // filling so first-run and reused sessions both resolve cleanly.
    const accessCodeInput = page.getByLabel("Access code");
    await expect(accessCodeInput).toBeVisible({ timeout: 30_000 });
    await accessCodeInput.fill(invitation.code);
    await page.getByRole("button", { name: "Continue" }).click();
    // Admission lands on the workspace start page: the analyst destination for
    // a fresh session is the research launch surface, not the dossiers list.
    await expect(
        page.getByRole("heading", { name: "Start a research dossier" }),
    ).toBeVisible();
}

export function seedSourceReview(fixtureKey: string): SeededSourceReview {
    return runConvexJson<SeededSourceReview>(
        "e2eFixtures:seedSourceReviewScenario",
        { slotKey: invitation.slotKey, fixtureKey },
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