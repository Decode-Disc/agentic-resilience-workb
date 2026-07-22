import type { Infer } from "convex/values"

import type { executionStatusValidator, researchRunLifecycleValidator } from "./validators"

export type ResearchRunLifecycle = Infer<typeof researchRunLifecycleValidator>
export type ExecutionStatus = Infer<typeof executionStatusValidator>

const nextLifecycle: Partial<Record<ResearchRunLifecycle, ResearchRunLifecycle>> = {
  draft: "discovering_sources",
  discovering_sources: "awaiting_source_review",
  awaiting_source_review: "extracting_evidence",
  extracting_evidence: "assessing_dimensions",
  assessing_dimensions: "awaiting_assessment_review",
  awaiting_assessment_review: "completed",
}

const requiredExecutionStatus: Record<ResearchRunLifecycle, ExecutionStatus> = {
  draft: "idle",
  discovering_sources: "running",
  awaiting_source_review: "paused",
  extracting_evidence: "running",
  assessing_dimensions: "running",
  awaiting_assessment_review: "paused",
  completed: "completed",
}

export function assertLifecycleTransition(
  from: ResearchRunLifecycle,
  to: ResearchRunLifecycle,
  executionStatus: ExecutionStatus,
) {
  if (nextLifecycle[from] !== to || requiredExecutionStatus[to] !== executionStatus) {
    throw new Error(`Invalid research run transition: ${from} -> ${to}`)
  }
}
