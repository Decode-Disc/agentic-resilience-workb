import { v } from "convex/values";

export const sourceDecisionValidator = v.union(
    v.literal("accepted"),
    v.literal("rejected"),
    v.literal("pending"),
);

export const visitorRoleValidator = v.union(
    v.literal("admin"),
    v.literal("analyst"),
);

export const invitationStatusValidator = v.union(
    v.literal("available"),
    v.literal("claimed"),
    v.literal("revoked"),
);

export const coveragePresetValidator = v.union(
    v.literal("balanced"),
    v.literal("first_party_depth"),
    v.literal("independent_scrutiny"),
);

export const companySnapshotValidator = v.object({
    cik: v.string(),
    legalName: v.string(),
    ticker: v.string(),
    exchange: v.string(),
    investorRelationsUrl: v.optional(v.string()),
    /**
     * Marketing/customer website URL of the company (e.g. servicenow.com),
     * distinct from the investor-relations URL. Resolved at preflight by
     * classifyIrAsWebsite today (SEC IR accepted only when not an IR-vendor
     * subdomain). The Exa + HEAD-probe cascade is the next slice and will
     * populate this field for the long tail of companies whose SEC IR URL is
     * a vendor subdomain.
     */
    websiteUrl: v.optional(v.string()),
    /**
     * Provenance of the websiteUrl resolution. 'sec_ir' today — Exa and
     * HEAD-probe sources will be added with the cascade slice.
     */
    websiteUrlSource: v.optional(
        v.union(v.literal("sec_ir"), v.literal("exa"), v.literal("probe")),
    ),
});

export const researchRunLifecycleValidator = v.union(
    v.literal("sources_prepared"),
    v.literal("framing"),
    v.literal("draft"),
    v.literal("checking_public_evidence"),
    v.literal("awaiting_evidence_sufficiency_review"),
    v.literal("discovering_sources"),
    v.literal("awaiting_source_review"),
    v.literal("corpus_approved"),
    v.literal("extracting_evidence"),
    v.literal("evidence_ready"),
    v.literal("assessing_dimensions"),
    v.literal("awaiting_assessment_review"),
    v.literal("completed"),
);

export const executionStatusValidator = v.union(
    v.literal("idle"),
    v.literal("running"),
    v.literal("paused"),
    v.literal("failed"),
    v.literal("cancelled"),
    v.literal("completed"),
);

export const workflowStepStateValidator = v.union(
    v.literal("queued"),
    v.literal("running"),
    v.literal("completed"),
    v.literal("needs_review"),
    v.literal("failed"),
    v.literal("skipped"),
);

export const workflowStepKeyValidator = v.union(
    v.literal("prepare_sources"),
    v.literal("sources_prepared"),
    v.literal("resolve_company"),
    v.literal("check_public_evidence"),
    v.literal("evidence_sufficiency_review"),
    v.literal("build_research_plan"),
    v.literal("discover_sources"),
    v.literal("source_review"),
    v.literal("extract_evidence"),
    v.literal("retrieve_approved_sources"),
    v.literal("normalize_sources"),
    v.literal("generate_claims"),
    v.literal("validate_claims"),
    v.literal("evaluate_evidence_policy"),
    v.literal("assess_dimensions"),
    v.literal("assessment_review"),
    v.literal("generate_derived_views"),
);

export const runEventTypeValidator = v.union(
    v.literal("run_created"),
    v.literal("run_transitioned"),
    v.literal("run_failed"),
    v.literal("run_cancelled"),
    v.literal("run_retried"),
    v.literal("company_confirmed"),
    v.literal("evidence_sufficiency_evaluated"),
    v.literal("research_plan_created"),
    v.literal("source_discovery_progress"),
    v.literal("source_recovery_started"),
    v.literal("source_recovery_completed"),
    v.literal("source_preparation_progress"),
    v.literal("source_preparation_completed"),
    v.literal("corpus_revision_approved"),
    v.literal("corpus_revision_started"),
    v.literal("evidence_source_progress"),
    v.literal("claim_generation_paused"),
    v.literal("evidence_ready"),
);

export const auditActorValidator = v.union(
    v.object({ type: v.literal("system") }),
    v.object({ type: v.literal("visitor"), visitorId: v.string() }),
);

export const auditEventActionValidator = v.union(
    v.literal("browser_test_context_opened"),
    v.literal("browser_test_context_closed"),
    v.literal("run_purpose_classified"),
    v.literal("invitation_seeded"),
    v.literal("invitation_claimed"),
    v.literal("invitation_revoked"),
    v.literal("invitation_reissued"),
    v.literal("invitation_code_rotated"),
    v.literal("visitor_session_rebound"),
    v.literal("analysis_reserved"),
    v.literal("quota_restored"),
    v.literal("dossier_withdrawn"),
    v.literal("dossier_purged"),
    v.literal("checkpoint_decided"),
    v.literal("company_confirmed"),
    v.literal("evidence_sufficiency_overridden"),
    v.literal("evidence_sufficiency_completed"),
    v.literal("source_decided"),
    v.literal("manual_source_added"),
    v.literal("corpus_revision_approved"),
    v.literal("new_corpus_revision"),
    v.literal("paid_work_toggled"),
    v.literal("model_configuration_changed"),
    v.literal("run_reopened_at_time_limit"),
);

export const runPauseReasonValidator = v.union(
    v.literal("evidence_sufficiency_review"),
    v.literal("source_review"),
    v.literal("assessment_review"),
    v.literal("claim_generation_unavailable"),
    v.literal("analyst"),
    v.literal("execution_interrupted"),
    v.literal("sources_time_limit"),
);

export const sourcesPhaseValidator = v.union(
    v.literal("collecting"),
    v.literal("waiting"),
    v.literal("paused"),
    v.literal("time_limit"),
    v.literal("completed"),
    v.literal("completed_with_limits"),
    v.literal("ended_without_material"),
    v.literal("interrupted"),
    v.literal("failed"),
    v.literal("insufficient_evidence"),
);

export const preparedMaterialOutcomeValidator = v.union(
    v.literal("complete"),
    v.literal("partial"),
    v.literal("blocked"),
);
