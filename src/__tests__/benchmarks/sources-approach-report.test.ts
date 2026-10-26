// @vitest-environment node
import assert from "node:assert/strict";
import { expect, test } from "vitest";
import type { SourcesApproachResult } from "../../../scripts/evaluations/source-selection/sources-approach-study.ts";

const { buildSourcesApproachReport } = (await import(
    new URL(
        "../../../scripts/evaluations/source-selection/sources-approach-report.ts",
        import.meta.url,
    ).href
)) as typeof import("../../../scripts/evaluations/source-selection/sources-approach-report");

function result(
    overrides: Partial<SourcesApproachResult> = {},
): SourcesApproachResult {
    return {
        schemaVersion: "sources-approach-v2",
        missionId: "mission-fixed-off-1",
        scenarioId: "servicenow-development",
        approach: "fixed",
        reasoning: "off",
        repetition: 1,
        execution: "offline",
        status: "complete",
        elapsedMs: 240,
        sources: [
            {
                sourceId: "source-terms",
                title: "Official service terms",
                read: true,
                qualificationStatus: "qualified",
                qualificationRevision: 2,
                qualification: {
                    companyMatch: "subject",
                    companyPassages: [],
                    documentKind: "official_commercial_terms",
                    reportingPeriodEnd: null,
                    reportingPeriodPassages: [],
                    findings: [
                        {
                            role: "official_commercial_terms",
                            kind: "asserted_fact",
                            summary: "The source states the service terms.",
                            passages: [
                                { passageKey: "p-useful", quotation: "terms" },
                            ],
                            period: "current",
                            periodPassages: [
                                { passageKey: "p-useful", quotation: "terms" },
                            ],
                            dependsOnFlaggedAssertion: false,
                        },
                    ],
                    limitations: [],
                },
                comparisonStatus: "not_required",
                issues: [],
            },
        ],
        selection: {
            items: [
                {
                    sourceId: "source-terms",
                    disposition: "recommended",
                    sourceFamily: "official_commercial",
                    documentKind: "official_commercial_terms",
                    authorityTier: "company_primary",
                    companyLinkageBasis: "inspected_content",
                    coverageContributions: ["commercial terms"],
                    recommendationContributions: [
                        "Inspect primary contract terms",
                    ],
                    declaredCoverageRoles: ["official_commercial_terms"],
                    eligibleCoverageRoles: ["official_commercial_terms"],
                    rank: 1,
                    reasonCodes: ["required_coverage_role"],
                },
            ],
            gaps: [],
            coverageGaps: [],
            documentaryCoverageGaps: [],
            counts: { recommended: 1, needsAttention: 0, alternative: 0 },
        },
        events: [
            {
                sequence: 1,
                operation: "read_source",
                sourceId: "source-terms",
                status: "observed",
                contextId: "read-1",
            },
            {
                sequence: 2,
                operation: "submit_qualification",
                sourceId: "source-terms",
                status: "accepted",
                contextId: "qualification-1",
                details: {
                    revision: 1,
                    findingCount: 2,
                    findings: [
                        {
                            role: "official_commercial_terms",
                            kind: "asserted_fact",
                            period: "current",
                            passageKeys: ["p-useful"],
                        },
                        {
                            role: "official_commercial_terms",
                            kind: "reported_outcome",
                            period: "historical",
                            passageKeys: ["p-lost"],
                        },
                    ],
                    limitations: [],
                },
            },
            {
                sequence: 3,
                operation: "submit_qualification",
                sourceId: "source-terms",
                status: "accepted",
                contextId: "qualification-2",
                details: {
                    revision: 2,
                    findingCount: 1,
                    findings: [
                        {
                            role: "official_commercial_terms",
                            kind: "asserted_fact",
                            period: "current",
                            passageKeys: ["p-useful"],
                        },
                    ],
                    limitations: [],
                },
            },
            {
                sequence: 4,
                operation: "preview_selection",
                status: "observed",
                contextId: "selection-1",
            },
            {
                sequence: 5,
                operation: "complete",
                status: "accepted",
                reason: "completed",
            },
        ],
        calls: [
            {
                id: "call-known",
                status: "succeeded",
                requestHash: "hash-known",
                reservationUsd: 0.04,
                costUsd: 0.02,
                inputTokens: 120,
                outputTokens: 50,
                latencyMs: 100,
            },
            {
                id: "call-unknown",
                status: "unknown",
                requestHash: "hash-unknown",
                reservationUsd: 0.04,
                latencyMs: 140,
                error: "provider credential: do not expose",
            },
        ],
        ...overrides,
    };
}

test("the report keeps approach and reasoning conditions separate and preserves per-mission evidence", () => {
    const report = buildSourcesApproachReport([
        result(),
        result({
            missionId: "mission-agent-on-2",
            scenarioId: "snowflake-validation",
            approach: "agent",
            reasoning: "on",
            repetition: 2,
            status: "partial",
            stopReason: "source_unavailable",
            execution: "live",
            events: [],
        }),
    ]);

    expect(report.summary.conditions).toEqual(
        expect.arrayContaining([
            expect.objectContaining({
                approach: "fixed",
                reasoning: "off",
                missions: [
                    expect.objectContaining({
                        missionId: "mission-fixed-off-1",
                    }),
                ],
            }),
            expect.objectContaining({
                approach: "agent",
                reasoning: "on",
                missions: [
                    expect.objectContaining({
                        missionId: "mission-agent-on-2",
                    }),
                ],
            }),
        ]),
    );
    expect(
        report.summary.conditions.flatMap((condition) => condition.missions),
    ).toHaveLength(2);
    expect(
        report.summary.conditions[0]?.missions[0]?.calls
            .unknownChargeReservedUsd,
    ).toBe(0.04);
    expect(
        report.summary.conditions[0]?.missions[0]?.classifications,
    ).toMatchObject({ operationalFailureCalls: 0, unknownOutcomeCalls: 1 });
    expect(
        report.summary.conditions[0]?.missions[0]?.selection.items[0],
    ).toMatchObject({
        declaredCoverageRoles: ["official_commercial_terms"],
        eligibleCoverageRoles: ["official_commercial_terms"],
    });
    expect(report.reviewTemplate.findingChanges).toEqual([
        expect.objectContaining({
            missionId: "mission-fixed-off-1",
            sourceId: "source-terms",
            kind: "contribution_removed_on_correction",
            previousContextId: "qualification-1",
            currentContextId: "qualification-2",
            reviewStatus: "pending",
        }),
    ]);
    expect(report.markdown).toContain("simulated");
    expect(JSON.stringify(report)).not.toContain("provider credential");
    expect(report.markdown).toContain("not analytical correctness");
    expect(report.markdown).not.toMatch(/\bcorrectness score\s*:/i);
});

test("the report keeps invalid, unread, operational, and documented-insufficiency states distinct", () => {
    const report = buildSourcesApproachReport([
        result({
            status: "failed",
            sources: [
                {
                    sourceId: "invalid",
                    title: "Invalid output",
                    read: true,
                    qualificationStatus: "invalid",
                    qualificationRevision: 0,
                    comparisonStatus: "unavailable",
                    issues: ["schema_invalid"],
                },
                {
                    sourceId: "unread",
                    title: "Unread source",
                    read: false,
                    qualificationStatus: "unread",
                    qualificationRevision: 0,
                    comparisonStatus: "pending",
                    issues: [],
                },
                {
                    sourceId: "limited",
                    title: "Limited source",
                    read: true,
                    qualificationStatus: "qualified",
                    qualificationRevision: 1,
                    comparisonStatus: "not_required",
                    qualification: {
                        companyMatch: "subject",
                        companyPassages: [],
                        documentKind: "official_commercial_terms",
                        reportingPeriodEnd: null,
                        reportingPeriodPassages: [],
                        findings: [],
                        limitations: [
                            {
                                code: "period_unestablished",
                                explanation:
                                    "The period cannot be established.",
                                passages: [],
                                scope: { kind: "document" },
                            },
                        ],
                    },
                    issues: [],
                },
            ],
            calls: [
                {
                    id: "call-failed",
                    status: "failed",
                    requestHash: "hash-failed",
                    reservationUsd: 0.04,
                    latencyMs: 180,
                    error: "private provider error",
                },
            ],
            events: [
                {
                    sequence: 1,
                    operation: "submit_qualification",
                    sourceId: "invalid",
                    status: "rejected",
                    reason: "schema_invalid",
                },
            ],
            selection: undefined,
        }),
    ]);
    const mission = report.summary.conditions[0]?.missions[0];

    expect(mission?.sources.map((source) => source.classifications)).toEqual([
        expect.arrayContaining([
            "invalid_qualification",
            "operational_failure",
        ]),
        expect.arrayContaining(["unread_source", "incomplete"]),
        expect.arrayContaining(["documented_insufficiency"]),
    ]);
    expect(mission?.calls.counts.failed).toBe(1);
    expect(mission?.qualificationSubmissions.snapshotless).toBe(0);
    expect(
        report.reviewTemplate.judgments.every(
            (judgment) => judgment.status === "pending",
        ),
    ).toBe(true);
});

test("missing imported qualification snapshots remain explicit and are not treated as corrections", () => {
    const report = buildSourcesApproachReport([
        result({
            events: [
                {
                    sequence: 1,
                    operation: "submit_qualification",
                    sourceId: "source-terms",
                    status: "accepted",
                    contextId: "qualification-without-snapshot",
                },
            ],
        }),
    ]);
    const mission = report.summary.conditions[0]?.missions[0];

    expect(mission?.qualificationSubmissions.snapshotless).toBe(1);
    expect(
        mission?.qualificationSubmissions.records[0]?.snapshot.availability,
    ).toBe("missing");
    expect(report.reviewTemplate.findingChanges).toEqual([]);
});

test("reserves calls without a cost receipt separately from calls with unknown outcomes", () => {
    const report = buildSourcesApproachReport([
        result({
            calls: [
                {
                    id: "success-no-cost",
                    status: "succeeded",
                    requestHash: "a",
                    reservationUsd: 0.04,
                    latencyMs: 10,
                },
                {
                    id: "failure-no-cost",
                    status: "failed",
                    requestHash: "b",
                    reservationUsd: 0.05,
                    latencyMs: 20,
                },
                {
                    id: "unknown-no-cost",
                    status: "unknown",
                    requestHash: "c",
                    reservationUsd: 0.06,
                    latencyMs: 30,
                },
                {
                    id: "failure-with-cost",
                    status: "failed",
                    requestHash: "d",
                    reservationUsd: 0.07,
                    costUsd: 0.03,
                    latencyMs: 40,
                },
            ],
        }),
    ]);
    const mission = report.summary.conditions[0]?.missions[0];

    expect(mission?.calls.unknownChargeReservedUsd).toBe(0.15);
    expect(mission?.calls.unknownChargeReservationCount).toBe(3);
    expect(mission?.calls.counts.unknown).toBe(1);
    expect(mission?.classifications).toMatchObject({
        operationalFailureCalls: 2,
        unknownOutcomeCalls: 1,
    });
    expect(
        mission?.calls.receipts.map((call) => call.unknownChargeReservationUsd),
    ).toEqual([0.04, 0.05, 0.06, undefined]);
    expect(report.markdown).toContain("unknown charge reservation");
    expect(report.markdown).toContain("unknown outcomes: 1");
});

test("inspection report retains before and after evidence for semantic judgment without assigning correctness", () => {
    const before = result().sources;
    const after = structuredClone(before);
    const qualification = after[0]?.qualification;
    assert(qualification);
    qualification.findings = [];
    const report = buildSourcesApproachReport([
        result({
            schemaVersion: "sources-inspection-v1",
            sources: after,
            inspection: {
                baselineHash: "a".repeat(64),
                initialSources: before,
            },
        }),
    ]);
    expect(report.reviewTemplate.inspections).toEqual([
        expect.objectContaining({
            baselineHash: "a".repeat(64),
            before,
            after,
            judgment: "pending",
            autonomousDetection: "pending",
        }),
    ]);
    expect(report.markdown).toContain("Inspection judgments remain pending");
});

test("inspection conditions with different focused sources cannot be pooled", () => {
    const baseline = {
        baselineHash: "a".repeat(64),
        initialSources: result().sources,
    };
    expect(() =>
        buildSourcesApproachReport([
            result({
                schemaVersion: "sources-inspection-v2",
                inspection: { ...baseline, focusSourceIds: ["terms"] },
            }),
            result({
                missionId: "other",
                approach: "agent",
                schemaVersion: "sources-inspection-v2",
                inspection: { ...baseline, focusSourceIds: ["other-source"] },
            }),
        ]),
    ).toThrow("Inspection conditions must share the same focused sources");
});

test("targeted correction rejections remain visible in the qualification report", () => {
    const report = buildSourcesApproachReport([
        result({
            events: [
                {
                    sequence: 0,
                    operation: "correct_qualification",
                    sourceId: "terms",
                    status: "rejected",
                    reason: "qualification_revision_stale",
                },
            ],
        }),
    ]);
    expect(
        report.summary.conditions[0]?.missions[0]?.qualificationSubmissions
            .rejected,
    ).toBe(1);
});
