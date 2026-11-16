import type { Doc } from "@convex/_generated/dataModel";
import type { Infer } from "convex/values";

import type {
    executionStatusValidator,
    researchRunLifecycleValidator,
} from "./validators";

export type ResearchRunLifecycle = Infer<typeof researchRunLifecycleValidator>;
export type ExecutionStatus = Infer<typeof executionStatusValidator>;

/** Analyst suspension, a recoverable research interruption and a Sources time limit with remaining capacity use explicit Resume. */
export function isResumableResearchPause(
    run: Pick<Doc<"researchRuns">, "executionStatus" | "pauseReason">,
) {
    return (
        run.executionStatus === "paused" &&
        (run.pauseReason === "analyst" ||
            run.pauseReason === "execution_interrupted" ||
            run.pauseReason === "sources_time_limit")
    );
}

/** Includes documentary discovery, preparation and their human checkpoints. */
export function isDocumentaryResearchPhase(
    phase: ResearchRunLifecycle,
): boolean {
    return [
        "draft",
        "checking_public_evidence",
        "discovering_sources",
        "awaiting_evidence_sufficiency_review",
        "awaiting_source_review",
    ].includes(phase);
}

/** Reports implemented continuation support; commands still enforce ownership, state and generation. */
export function supportsResearchControl(
    run: Pick<
        Doc<"researchRuns">,
        "agentExecutionVersion" | "startMode" | "lifecycleState"
    >,
): boolean {
    return (
        run.agentExecutionVersion === 3 &&
        (run.startMode !== "framed" ||
            isDocumentaryResearchPhase(run.lifecycleState))
    );
}

export function canStartNewCorpusRevision(
    run: Pick<Doc<"researchRuns">, "lifecycleState" | "executionStatus">,
    revisionStatus: Doc<"corpusRevisions">["status"] | undefined,
): boolean {
    return (
        revisionStatus === "approved" &&
        run.lifecycleState === "corpus_approved" &&
        run.executionStatus === "idle"
    );
}

const allowedTransitions: Record<
    ResearchRunLifecycle,
    ReadonlyArray<ResearchRunLifecycle>
> = {
    framing: ["draft"],
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
    discovering_sources: ["awaiting_source_review", "sources_prepared"],
    sources_prepared: [],
    awaiting_source_review: ["corpus_approved"],
    corpus_approved: ["extracting_evidence", "awaiting_source_review"],
    extracting_evidence: ["evidence_ready"],
    evidence_ready: ["assessing_dimensions"],
    assessing_dimensions: ["awaiting_assessment_review"],
    awaiting_assessment_review: ["completed", "awaiting_source_review"],
    completed: ["awaiting_source_review"],
};

const requiredExecutionStatus: Record<ResearchRunLifecycle, ExecutionStatus> = {
    sources_prepared: "idle",
    framing: "idle",
    draft: "idle",
    checking_public_evidence: "running",
    awaiting_evidence_sufficiency_review: "paused",
    discovering_sources: "running",
    awaiting_source_review: "paused",
    corpus_approved: "idle",
    extracting_evidence: "running",
    evidence_ready: "idle",
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
