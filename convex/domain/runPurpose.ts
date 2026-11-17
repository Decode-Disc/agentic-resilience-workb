import type { Doc } from "@convex/_generated/dataModel";
import { type Infer, v } from "convex/values";

export const runPurposeValidator = v.union(
    v.literal("research"),
    v.literal("evaluation"),
    v.literal("browser_test"),
);
export type RunPurpose = Infer<typeof runPurposeValidator>;

/** Legacy evidence is used only until the audited purpose migration is complete. */
export function classifyRunPurpose(run: Doc<"researchRuns">): {
    purpose: RunPurpose;
    reason: string;
    requiresReview?: boolean;
} {
    if (run.purpose) return { purpose: run.purpose, reason: "server_assigned" };
    if (run.companyPreflightId)
        return { purpose: "research", reason: "public_company_reservation" };
    const key = run.reservationKey ?? "";
    if (key.startsWith("retrieval-evaluation:") && !run.reservationStatus)
        return {
            purpose: "evaluation",
            reason: "internal_evaluation_reservation",
        };
    if (
        key.startsWith("e2e:") &&
        (run.workflowId ||
            run.activeCorpusRevisionId ||
            run.companySnapshot?.cik.startsWith("e2e-"))
    )
        return {
            purpose: "browser_test",
            reason: "internal_fixture_with_provenance",
        };
    if (key.startsWith("e2e:"))
        return {
            purpose: "research",
            reason: "unverified_fixture_marker",
            requiresReview: true,
        };
    return { purpose: "research", reason: "legacy_research" };
}
