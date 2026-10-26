import { expect, test } from "vitest";
import {
    checkpointDecisionLabel,
    checkpointLabel,
    eventLabel,
    sourceAssessmentExplanationCopy,
    sourceCompanyLinkageLabel,
    sourceSelectionExplanation,
    sourceUsageCopy,
} from "@/lib/presentation/research-copy";

test("keeps attributed-use restrictions explicit in the selection explanation", () => {
    const copy = sourceSelectionExplanation({
        disposition: "recommended",
        documentKind: "independent_analysis",
        reasonCodes: ["additional_coverage"],
        selectionRationale: {
            version: 1,
            trigger: "distinct_contribution",
            contributions: [
                {
                    key: "content:counter_evidence_primary:limited:publisher.test",
                    kind: "documentary_role",
                    basis: "inspected_content",
                    role: "counter_evidence_primary",
                },
            ],
        },
        inspectionStatus: "complete",
        roleAvailability: [
            {
                role: "counter_evidence_primary",
                state: "limited",
                usage: "attributed_argument_only",
                reasonCodes: ["publisher_unverified"],
            },
        ],
    });
    expect(copy.limitations).toContain(
        "Use only as an attributed argument, not as an established fact.",
    );
    expect(JSON.stringify(copy)).not.toMatch(
        /content:|publisher.test|attributed_argument_only|additional_coverage/,
    );
});

test.each([
    {
        inspectionStatus: undefined,
        assessment: "Its documentary contribution has not yet been assessed.",
    },
    {
        inspectionStatus: "unavailable" as const,
        assessment: "Its documentary contribution could not be assessed.",
    },
    {
        inspectionStatus: "complete" as const,
        assessment:
            "No documentary contribution has been established from the reviewed material.",
    },
])("separates supplementary selection from $inspectionStatus assessment", ({
    inspectionStatus,
    assessment,
}) => {
    const copy = sourceSelectionExplanation({
        disposition: "recommended",
        documentKind: "regulatory_material",
        reasonCodes: ["ranked_fill"],
        inspectionStatus,
        roleAvailability: [],
        selectionRationale: {
            version: 1,
            trigger: "distinct_contribution",
            contributions: [
                {
                    key: "regulatory_event:example",
                    basis: "discovery_metadata",
                    kind: "filing_candidate",
                    role: "regulatory_material_event",
                },
            ],
        },
    });
    expect(copy.reason).toBe(
        "Selected as an additional material-event filing candidate. Selection is based on discovery details.",
    );
    expect(copy.assessment).toBe(assessment);
    expect(copy.missingRationale).toBe(false);
});

test("explains a distinct inspected reporting period without converting publication metadata into coverage", () => {
    const copy = sourceSelectionExplanation({
        disposition: "recommended",
        documentKind: "earnings_release",
        reasonCodes: ["additional_coverage"],
        inspectionStatus: "complete",
        roleAvailability: [],
        selectionRationale: {
            version: 1,
            trigger: "distinct_contribution",
            contributions: [
                {
                    key: "earnings_release:2026-q1",
                    kind: "report_candidate",
                    basis: "inspected_content",
                    reportingPeriodEnd: "2026-03-31",
                },
            ],
        },
    });
    expect(copy.reason).toBe(
        "Selected for a reporting period not represented when this source was selected.",
    );
    expect(copy.assessment).toBe(
        "No documentary contribution has been established from the reviewed material.",
    );
});

test.each([
    ["source_preparation_progress", "Sources checked"],
    ["source_preparation_completed", "Source checks finished"],
] as const)("translates %s without exposing workflow or provider details", (event, expected) => {
    const label = eventLabel(event);
    expect(label).toBe(expected);
    expect(label).not.toMatch(
        /source_preparation|sourcePreparation|OPENROUTER|generation|model/i,
    );
});

test("keeps search linkage separate from a completed or partial document reading", () => {
    expect(sourceCompanyLinkageLabel("discovery_metadata", "partial")).toBe(
        "Linked from search details; source content was read separately",
    );
    expect(sourceCompanyLinkageLabel("discovery_metadata")).toBe(
        "Linked from discovery metadata; source content has not been read",
    );
});

test("explains comparison scope and uncertainty without presenting a model concern as a proven error", () => {
    expect(
        sourceUsageCopy(
            "verification_required",
            "possible_conflict",
            "attributed_argument",
        ),
    ).toBe(
        "A cited primary passage raises a possible conflict. Review the evidence before relying on this contribution. This concern is not a verified error.",
    );
    expect(
        sourceUsageCopy("verification_required", "inconclusive", "forecast"),
    ).toBe(
        "The available captured primary passages did not resolve this contribution. Verify its key premise before relying on it.",
    );
    expect(
        sourceUsageCopy(
            "attributed_argument_only",
            "no_conflict_observed",
            "attributed_argument",
        ),
    ).toBe(
        "Use only as an attributed hypothesis. No conflict was observed within the cited captured primary passages, but that does not verify the argument as fact.",
    );
    expect(
        sourceUsageCopy("verification_required", undefined, "forecast"),
    ).toBe(
        "No completed comparison with applicable captured primary passages is available. Verify this contribution before using it even as an attributed hypothesis.",
    );
});

test("names human review checkpoints and their decisions without raw keys", () => {
    expect(checkpointLabel("source_review")).toBe("Source review");
    expect(checkpointLabel("evidence_sufficiency_review")).toBe(
        "Evidence coverage review",
    );
    expect(checkpointLabel("assessment_review")).toBe("Assessment review");
    expect(checkpointDecisionLabel("approved")).toBe("Approved");
    expect(checkpointDecisionLabel("recheck")).toBe("Recheck requested");
    expect(checkpointDecisionLabel("force_continue")).toBe(
        "Continued despite missing evidence",
    );
    expect(checkpointDecisionLabel("complete_insufficient")).toBe(
        "Closed as insufficient",
    );
    for (const decision of [
        "approved",
        "recheck",
        "force_continue",
        "complete_insufficient",
    ] as const) {
        expect(checkpointDecisionLabel(decision)).not.toMatch(/_/);
    }
});

test("keeps internal comparison references out of analyst-facing explanations", () => {
    expect(
        sourceAssessmentExplanationCopy(
            "possible_conflict target-p0 cites primary-0 from aiTaskResults:comparison-task-123",
        ),
    ).toBe(
        "The assessment refers to the cited passages and is limited to the available context.",
    );
    expect(
        sourceAssessmentExplanationCopy(
            "The cited passage discusses subscription bundling in the reported period.",
        ),
    ).toBe(
        "The cited passage discusses subscription bundling in the reported period.",
    );
    expect(
        sourceAssessmentExplanationCopy(
            "The annual report describes workflow competition in the same period.",
        ),
    ).toBe(
        "The annual report describes workflow competition in the same period.",
    );
});
