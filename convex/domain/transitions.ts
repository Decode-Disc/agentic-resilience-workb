import type { Infer } from "convex/values";

import type {
    executionStatusValidator,
    researchRunLifecycleValidator,
} from "./validators";

export type ResearchRunLifecycle = Infer<typeof researchRunLifecycleValidator>;
export type ExecutionStatus = Infer<typeof executionStatusValidator>;

const allowedTransitions: Record<
    ResearchRunLifecycle,
    ReadonlyArray<ResearchRunLifecycle>
> = {
    draft: ["checking_public_evidence"],
    checking_public_evidence: [
        "awaiting_evidence_sufficiency_review",
        "discovering_sources",
    ],
    awaiting_evidence_sufficiency_review: [
        "checking_public_evidence",
        "discovering_sources",
        "completed",
    ],
    discovering_sources: ["awaiting_source_review"],
    awaiting_source_review: ["corpus_approved"],
    corpus_approved: ["extracting_evidence", "awaiting_source_review"],
    extracting_evidence: ["assessing_dimensions"],
    assessing_dimensions: ["awaiting_assessment_review"],
    awaiting_assessment_review: ["completed", "awaiting_source_review"],
    completed: ["awaiting_source_review"],
};

const requiredExecutionStatus: Record<ResearchRunLifecycle, ExecutionStatus> = {
    draft: "idle",
    checking_public_evidence: "running",
    awaiting_evidence_sufficiency_review: "paused",
    discovering_sources: "running",
    awaiting_source_review: "paused",
    corpus_approved: "idle",
    extracting_evidence: "running",
    assessing_dimensions: "running",
    awaiting_assessment_review: "paused",
    completed: "completed",
};

export function assertLifecycleTransition(
    from: ResearchRunLifecycle,
    to: ResearchRunLifecycle,
    executionStatus: ExecutionStatus,
) {
    if (
        !allowedTransitions[from].includes(to) ||
        requiredExecutionStatus[to] !== executionStatus
    ) {
        throw new Error(`Invalid research run transition: ${from} -> ${to}`);
    }
}
