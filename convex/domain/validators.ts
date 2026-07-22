import { v } from "convex/values"

export const visitorRoleValidator = v.union(v.literal("admin"), v.literal("analyst"))

export const invitationStatusValidator = v.union(
  v.literal("available"),
  v.literal("claimed"),
  v.literal("revoked"),
)

export const researchRunLifecycleValidator = v.union(
  v.literal("draft"),
  v.literal("discovering_sources"),
  v.literal("awaiting_source_review"),
  v.literal("extracting_evidence"),
  v.literal("assessing_dimensions"),
  v.literal("awaiting_assessment_review"),
  v.literal("completed"),
)

export const executionStatusValidator = v.union(
  v.literal("idle"),
  v.literal("running"),
  v.literal("paused"),
  v.literal("failed"),
  v.literal("cancelled"),
  v.literal("completed"),
)

export const workflowStepStateValidator = v.union(
  v.literal("queued"),
  v.literal("running"),
  v.literal("completed"),
  v.literal("needs_review"),
  v.literal("failed"),
  v.literal("skipped"),
)

export const workflowStepKeyValidator = v.union(
  v.literal("resolve_company"),
  v.literal("build_research_plan"),
  v.literal("discover_sources"),
  v.literal("source_review"),
  v.literal("extract_evidence"),
  v.literal("assess_dimensions"),
  v.literal("assessment_review"),
  v.literal("generate_derived_views"),
)

export const runEventTypeValidator = v.union(
  v.literal("run_created"),
  v.literal("run_transitioned"),
  v.literal("run_failed"),
  v.literal("run_cancelled"),
  v.literal("run_retried"),
)

export const auditActorValidator = v.union(
  v.object({ type: v.literal("system") }),
  v.object({ type: v.literal("visitor"), visitorId: v.string() }),
)

export const auditEventActionValidator = v.union(
  v.literal("invitation_seeded"),
  v.literal("invitation_claimed"),
  v.literal("invitation_revoked"),
  v.literal("invitation_reissued"),
  v.literal("analysis_reserved"),
  v.literal("quota_restored"),
  v.literal("checkpoint_decided"),
)
