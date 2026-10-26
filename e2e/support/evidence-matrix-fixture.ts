// Local-only E2E fixture helpers for the evidence matrix deterministic gate.
//
// These mirror the source-review fixture pattern: ownership derives exclusively
// from the claimed analyst invitation slot plus a bounded fixture key. No
// visitor/auth ids, invitation codes, or secrets are ever accepted as fixture
// arguments or echoed into artifacts. The analyst admission helper and slot
// convention are reused from the source-review fixture so the local invitation
// stays a single shared bootstrap.
/// <reference types="node" />
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { BROWSER_TEST_SLOT } from "./browser-workspace";
import { runConvexJson } from "./convex-cli";

export type EvidenceMatrixScenarioKind = "showcase" | "unavailable";

export type EvidenceMatrixSnapshot = {
    runId: string;
    fixtureKey: string;
    lifecycleState: string;
    executionStatus: string;
    pauseReason?: string;
    showcase: boolean;
    providerCallCount: number;
    workflowIdPresent: boolean;
    sourceCount: number;
    passageCount: number;
    claimCount: number;
    claimIds: Array<string>;
    claimStatements: Array<string>;
    policyEvaluationCount: number;
};

export type SeededEvidenceMatrix = {
    runId: string;
    corpusRevisionId: string;
    sourceIds: Array<string>;
    scenarioKind: EvidenceMatrixScenarioKind;
    executionGeneration: number;
};

type InvitationMaterial = {
    invitations: Array<{
        slotKey: string;
        role: "admin" | "analyst";
        code: string;
    }>;
};

/** The analyst-4 invitation used by the existing admission helper. */
const analystSlot = (() => {
    const material = JSON.parse(
        readFileSync(
            resolve(process.cwd(), "invitation-otp-codes.local"),
            "utf8",
        ),
    ) as InvitationMaterial;
    const analystInvitation = material.invitations.find(
        ({ slotKey }) => slotKey === BROWSER_TEST_SLOT,
    );
    if (!analystInvitation) {
        throw new Error("Local analyst invitation is not configured");
    }
    return analystInvitation;
})();

/**
 * Seeds the guarded evidence-matrix scenario for one bounded fixture key. The
 * real Phase 5 workflow then advances asynchronously: showcase registers the
 * deterministic CCC manifest and reaches evidence_ready; unavailable registers
 * no manifest and pauses at claim_generation_unavailable. Both dispatch zero
 * provider calls.
 */
export function seedEvidenceMatrix(
    fixtureKey: string,
    scenarioKind: EvidenceMatrixScenarioKind,
): SeededEvidenceMatrix {
    return runConvexJson<SeededEvidenceMatrix>(
        "e2eFixtures:seedEvidenceMatrixScenario",
        { slotKey: analystSlot.slotKey, fixtureKey, scenarioKind },
    );
}

/** Bounded server-side inspector for the evidence-matrix lifecycle and counts. */
export function inspectEvidenceMatrix(
    runId: string,
    fixtureKey: string,
): EvidenceMatrixSnapshot {
    return runConvexJson<EvidenceMatrixSnapshot>(
        "e2eFixtures:inspectEvidenceMatrixScenario",
        { runId, fixtureKey },
    );
}

/**
 * Reads the reusable analyst-4 access code from the shared local material.
 * Admission through the real UI drawer is the only use; tests never print it.
 */
export function analystAccessCode(): string {
    if (!/^\d{4}$/.test(analystSlot.code)) {
        throw new Error("Local analyst access code is not configured");
    }
    return analystSlot.code;
}