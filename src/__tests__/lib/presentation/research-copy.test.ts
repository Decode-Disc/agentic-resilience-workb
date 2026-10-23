import { expect, test } from "vitest";
import {
    eventLabel,
    sourceAssessmentExplanationCopy,
    sourceCompanyLinkageLabel,
    sourceUsageCopy,
} from "@/lib/presentation/research-copy";

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
