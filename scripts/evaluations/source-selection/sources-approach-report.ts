import type { SourceSelectionProposalResult } from "@convex/domain/sourceSelectionPolicy";
import type {
    PreparedSourceResult,
    SourcesApproachResult,
    SourcesCallReceipt,
    SourcesObservation,
} from "./sources-approach-study.ts";

type FindingReference = {
    role: string;
    kind: string;
    period: string;
    passageKeys: string[];
};
type LimitationReference = {
    code: string;
    scope?: { kind: string; roles?: string[] | null; passageKeys?: string[] };
    passageKeys: string[];
};
type QualificationSnapshot = {
    availability: "complete" | "partial" | "missing";
    revision?: number;
    findingCount?: number;
    findings: FindingReference[];
    limitations: LimitationReference[];
};
type QualificationSubmission = {
    sequence: number;
    sourceId: string;
    status: "accepted" | "rejected";
    contextId?: string;
    reason?: string;
    snapshot: QualificationSnapshot;
};
type CallSummary = {
    total: number;
    counts: Record<SourcesCallReceipt["status"], number>;
    reportedCostUsd: number | null;
    reportedCostCallCount: number;
    unknownChargeReservedUsd: number;
    unknownChargeReservationCount: number;
    latencyMs: {
        total: number;
        average: number | null;
        minimum: number | null;
        maximum: number | null;
    };
    receipts: Array<{
        reference: string;
        status: SourcesCallReceipt["status"];
        latencyMs: number;
        costUsd?: number;
        unknownChargeReservationUsd?: number;
    }>;
};
type FindingChange = {
    missionId: string;
    sourceId: string;
    kind:
        | "contribution_removed_on_correction"
        | "evidence_changed_on_correction";
    previousContextId?: string;
    currentContextId?: string;
    previous: FindingReference;
    current?: FindingReference;
    reviewStatus: "pending";
};
type ReviewDimension =
    | "retained_or_lost_useful_content"
    | "restrictions_and_period_claims"
    | "comparison_quality"
    | "selection_quality"
    | "equivalent_evidence";

const SAFE_CODE = /^[a-z0-9_.:-]{1,100}$/i;
const KNOWN_OPERATIONS = new Set([
    "baseline_restored",
    "read_passages",
    "read_source",
    "submit_qualification",
    "correct_qualification",
    "submit_comparison",
    "preview_selection",
    "complete",
]);
const REVIEW_DIMENSIONS: ReviewDimension[] = [
    "retained_or_lost_useful_content",
    "restrictions_and_period_claims",
    "comparison_quality",
    "selection_quality",
    "equivalent_evidence",
];

function objectValue(value: unknown): Record<string, unknown> | undefined {
    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
}

function safeCode(value: unknown): string | undefined {
    return typeof value === "string" && SAFE_CODE.test(value)
        ? value
        : undefined;
}

function stringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((item) => {
        const code = safeCode(item);
        return code ? [code] : [];
    });
}

function snapshotFinding(value: unknown): FindingReference | undefined {
    const finding = objectValue(value);
    const role = safeCode(finding?.role);
    const kind = safeCode(finding?.kind);
    const period = safeCode(finding?.period);
    return role && kind && period
        ? { role, kind, period, passageKeys: stringArray(finding?.passageKeys) }
        : undefined;
}

function snapshotScope(value: unknown): LimitationReference["scope"] {
    const scope = objectValue(value);
    const kind = safeCode(scope?.kind);
    if (kind === "document") return { kind };
    if (kind === "roles") return { kind, roles: stringArray(scope?.roles) };
    if (kind === "passages") {
        return {
            kind,
            roles: scope?.roles === null ? null : stringArray(scope?.roles),
            passageKeys: stringArray(scope?.passageKeys),
        };
    }
    return undefined;
}

function snapshotLimitation(value: unknown): LimitationReference | undefined {
    const limitation = objectValue(value);
    const code = safeCode(limitation?.code);
    if (!code) return undefined;
    const scope = snapshotScope(limitation?.scope);
    return {
        code,
        ...(scope ? { scope } : {}),
        passageKeys: stringArray(limitation?.passageKeys),
    };
}

function qualificationSnapshot(details: unknown): QualificationSnapshot {
    const record = objectValue(details);
    if (!record)
        return { availability: "missing", findings: [], limitations: [] };
    const rawFindings = record.findings;
    const rawLimitations = record.limitations;
    const hasFindings = Array.isArray(rawFindings);
    const hasLimitations = Array.isArray(rawLimitations);
    return {
        availability: hasFindings && hasLimitations ? "complete" : "partial",
        ...(Number.isInteger(record.revision)
            ? { revision: record.revision as number }
            : {}),
        ...(Number.isInteger(record.findingCount)
            ? { findingCount: record.findingCount as number }
            : {}),
        findings: hasFindings
            ? rawFindings.flatMap((value: unknown) => {
                  const finding = snapshotFinding(value);
                  return finding ? [finding] : [];
              })
            : [],
        limitations: hasLimitations
            ? rawLimitations.flatMap((value: unknown) => {
                  const limitation = snapshotLimitation(value);
                  return limitation ? [limitation] : [];
              })
            : [],
    };
}

function qualificationSubmissions(
    events: readonly SourcesObservation[],
): QualificationSubmission[] {
    return events.flatMap((event) => {
        if (
            (event.operation !== "submit_qualification" &&
                event.operation !== "correct_qualification") ||
            !event.sourceId ||
            (event.status !== "accepted" && event.status !== "rejected")
        ) {
            return [];
        }
        return [
            {
                sequence: event.sequence,
                sourceId: event.sourceId,
                status: event.status,
                ...(event.contextId ? { contextId: event.contextId } : {}),
                ...(safeCode(event.reason)
                    ? { reason: safeCode(event.reason) }
                    : {}),
                snapshot:
                    event.status === "accepted"
                        ? qualificationSnapshot(event.details)
                        : {
                              availability: "missing",
                              findings: [],
                              limitations: [],
                          },
            },
        ];
    });
}

function summarizeSelection(selection?: SourceSelectionProposalResult) {
    if (!selection) {
        return {
            status: "missing" as const,
            items: [],
            gaps: [],
            coverageGaps: [],
            documentaryCoverageGaps: [],
        };
    }
    return {
        status: "available" as const,
        items: selection.items.map((item) => ({
            sourceId: item.sourceId,
            disposition: item.disposition,
            rank: item.rank,
            declaredCoverageRoles: [...item.declaredCoverageRoles],
            eligibleCoverageRoles: [...item.eligibleCoverageRoles],
            reasonCodes: [...item.reasonCodes],
        })),
        gaps: [...selection.gaps],
        coverageGaps: [...selection.coverageGaps],
        documentaryCoverageGaps: [...selection.documentaryCoverageGaps],
        counts: { ...selection.counts },
    };
}

function summarizeComparison(source: PreparedSourceResult) {
    const output = source.comparison;
    return {
        status: source.comparisonStatus,
        ...(output ? { checkStatus: output.checkStatus } : {}),
        ...(output ? { completeness: output.completeness } : {}),
        omittedFindingIndexes: output?.omittedFindingIndexes ?? [],
        ...(output
            ? { omittedPrimaryCaptureCount: output.omittedPrimaryCaptureCount }
            : {}),
        ...(output
            ? { omittedPrimaryPassageCount: output.omittedPrimaryPassageCount }
            : {}),
        findings:
            output?.findings.map((finding) => ({
                findingIndex: finding.findingIndex,
                disposition: finding.disposition,
                comparableDimensions: [...finding.comparableDimensions],
                targetPassageKeys: finding.targetPassages.map(
                    (passage) => passage.passageKey,
                ),
                primaryPassages: finding.primaryPassages.map((passage) => ({
                    sourceId: passage.sourceId,
                    passageKey: passage.passageKey,
                })),
            })) ?? [],
    };
}

function sourceClassifications(
    source: PreparedSourceResult,
    submissions: QualificationSubmission[],
): string[] {
    const result = new Set<string>();
    if (
        source.qualificationStatus === "invalid" ||
        submissions.some((item) => item.status === "rejected")
    ) {
        result.add("invalid_qualification");
    }
    if (!source.read || source.qualificationStatus === "unread") {
        result.add("unread_source");
        result.add("incomplete");
    }
    if (
        source.comparisonStatus === "pending" ||
        source.comparisonStatus === "unavailable" ||
        source.comparisonStatus === "invalid" ||
        source.comparison?.completeness === "partial"
    ) {
        result.add("incomplete");
    }
    if (
        source.comparisonStatus === "unavailable" ||
        source.comparison?.checkStatus === "provider_unavailable"
    ) {
        result.add("operational_failure");
    }
    if (
        source.comparisonStatus === "invalid" ||
        source.comparison?.checkStatus === "invalid_output"
    ) {
        result.add("invalid_comparison");
    }
    if ((source.qualification?.limitations.length ?? 0) > 0) {
        result.add("documented_insufficiency");
    }
    return [...result];
}

function summarizeSource(
    source: PreparedSourceResult,
    selection: ReturnType<typeof summarizeSelection>,
    submissions: QualificationSubmission[],
) {
    const sourceSubmissions = submissions.filter(
        (item) => item.sourceId === source.sourceId,
    );
    const selected = selection.items.find(
        (item) => item.sourceId === source.sourceId,
    );
    return {
        sourceId: source.sourceId,
        title: source.title,
        read: source.read,
        qualificationStatus: source.qualificationStatus,
        qualificationRevision: source.qualificationRevision,
        acceptedQualifications: sourceSubmissions.filter(
            (item) => item.status === "accepted",
        ).length,
        rejectedQualifications: sourceSubmissions.filter(
            (item) => item.status === "rejected",
        ).length,
        findings:
            source.qualification?.findings.map((finding) => ({
                role: finding.role,
                kind: finding.kind,
                period: finding.period,
                passageKeys: finding.passages.map(
                    (passage) => passage.passageKey,
                ),
            })) ?? [],
        limitations:
            source.qualification?.limitations.map((limitation) => ({
                code: limitation.code,
                ...(limitation.scope ? { scope: limitation.scope } : {}),
                passageKeys: limitation.passages.map(
                    (passage) => passage.passageKey,
                ),
            })) ?? [],
        comparison: summarizeComparison(source),
        classifications: sourceClassifications(source, sourceSubmissions),
        declaredCoverageRoles: selected?.declaredCoverageRoles ?? [],
        eligibleCoverageRoles: selected?.eligibleCoverageRoles ?? [],
    };
}

function round(value: number): number {
    return Math.round(value * 1_000_000) / 1_000_000;
}

function summarizeCalls(calls: readonly SourcesCallReceipt[]): CallSummary {
    const counts: CallSummary["counts"] = {
        succeeded: 0,
        invalid: 0,
        failed: 0,
        unknown: 0,
    };
    let reportedCost = 0;
    let reportedCostCallCount = 0;
    let unknownChargeReservedUsd = 0;
    let unknownChargeReservationCount = 0;
    for (const call of calls) {
        counts[call.status] += 1;
        const cost = call.costUsd;
        const hasCostReceipt =
            typeof cost === "number" && Number.isFinite(cost);
        if (hasCostReceipt) {
            reportedCost += cost;
            reportedCostCallCount += 1;
        }
        if (!hasCostReceipt) {
            unknownChargeReservedUsd += call.reservationUsd;
            unknownChargeReservationCount += 1;
        }
    }
    const latencies = calls.map((call) => call.latencyMs);
    const totalLatency = latencies.reduce((sum, latency) => sum + latency, 0);
    return {
        total: calls.length,
        counts,
        reportedCostUsd: reportedCostCallCount ? round(reportedCost) : null,
        reportedCostCallCount,
        unknownChargeReservedUsd: round(unknownChargeReservedUsd),
        unknownChargeReservationCount,
        latencyMs: {
            total: totalLatency,
            average: calls.length ? round(totalLatency / calls.length) : null,
            minimum: latencies.length ? Math.min(...latencies) : null,
            maximum: latencies.length ? Math.max(...latencies) : null,
        },
        receipts: calls.map((call, index) => ({
            reference: call.id || `call:${index + 1}`,
            status: call.status,
            latencyMs: call.latencyMs,
            ...(typeof call.costUsd === "number" &&
            Number.isFinite(call.costUsd)
                ? { costUsd: call.costUsd }
                : {}),
            ...(typeof call.costUsd !== "number" ||
            !Number.isFinite(call.costUsd)
                ? { unknownChargeReservationUsd: call.reservationUsd }
                : {}),
        })),
    };
}

function summarizeMission(result: SourcesApproachResult) {
    const events = [...result.events].sort(
        (left, right) => left.sequence - right.sequence,
    );
    const submissions = qualificationSubmissions(events);
    const selection = summarizeSelection(result.selection);
    const sources = result.sources.map((source) =>
        summarizeSource(source, selection, submissions),
    );
    const sourceIds = new Set(result.sources.map((source) => source.sourceId));
    const calls = summarizeCalls(result.calls);
    return {
        missionId: result.missionId,
        scenarioId: result.scenarioId,
        repetition: result.repetition,
        execution: result.execution,
        status: result.status,
        ...(safeCode(result.stopReason)
            ? { stopReason: safeCode(result.stopReason) }
            : {}),
        elapsedMs: result.elapsedMs,
        sources,
        missingSourceRecords: selection.items
            .filter((item) => !sourceIds.has(item.sourceId))
            .map((item) => ({
                sourceId: item.sourceId,
                disposition: item.disposition,
            })),
        selection,
        qualificationSubmissions: {
            accepted: submissions.filter((item) => item.status === "accepted")
                .length,
            rejected: submissions.filter((item) => item.status === "rejected")
                .length,
            snapshotless: submissions.filter(
                (item) =>
                    item.status === "accepted" &&
                    item.snapshot.availability !== "complete",
            ).length,
            records: submissions,
        },
        events: events.map((event) => ({
            sequence: event.sequence,
            operation: KNOWN_OPERATIONS.has(event.operation)
                ? event.operation
                : "other",
            status: event.status,
            ...(event.sourceId ? { sourceId: event.sourceId } : {}),
            ...(event.contextId ? { contextId: event.contextId } : {}),
            ...(safeCode(event.reason)
                ? { reason: safeCode(event.reason) }
                : {}),
        })),
        calls,
        classifications: {
            invalidQualifications: sources.filter((source) =>
                source.classifications.includes("invalid_qualification"),
            ).length,
            incompleteSources: sources.filter((source) =>
                source.classifications.includes("incomplete"),
            ).length,
            unreadSources: sources.filter((source) =>
                source.classifications.includes("unread_source"),
            ).length,
            operationalFailureCalls: calls.counts.failed,
            unknownOutcomeCalls: calls.counts.unknown,
            documentedInsufficiencies: sources.filter((source) =>
                source.classifications.includes("documented_insufficiency"),
            ).length,
        },
    };
}

type MissionSummary = ReturnType<typeof summarizeMission>;
type ConditionSummary = {
    approach: SourcesApproachResult["approach"];
    reasoning: SourcesApproachResult["reasoning"];
    missions: MissionSummary[];
};

function findingSignature(finding: FindingReference): string {
    return JSON.stringify([
        finding.role,
        finding.kind,
        finding.period,
        [...finding.passageKeys].sort(),
    ]);
}

function sameContribution(
    left: FindingReference,
    right: FindingReference,
): boolean {
    return (
        left.role === right.role &&
        left.kind === right.kind &&
        left.period === right.period
    );
}

function findFindingChanges(
    missions: readonly MissionSummary[],
): FindingChange[] {
    const changes: FindingChange[] = [];
    for (const mission of missions) {
        const bySource = new Map<string, QualificationSubmission[]>();
        for (const submission of mission.qualificationSubmissions.records) {
            if (
                submission.status !== "accepted" ||
                submission.snapshot.availability !== "complete"
            )
                continue;
            const records = bySource.get(submission.sourceId) ?? [];
            records.push(submission);
            bySource.set(submission.sourceId, records);
        }
        for (const [sourceId, records] of bySource) {
            for (let index = 1; index < records.length; index += 1) {
                const previous = records[index - 1];
                const current = records[index];
                if (!previous || !current) continue;
                for (const finding of previous.snapshot.findings) {
                    if (
                        current.snapshot.findings.some(
                            (item) =>
                                findingSignature(item) ===
                                findingSignature(finding),
                        )
                    )
                        continue;
                    const replacement = current.snapshot.findings.find((item) =>
                        sameContribution(item, finding),
                    );
                    changes.push({
                        missionId: mission.missionId,
                        sourceId,
                        kind: replacement
                            ? "evidence_changed_on_correction"
                            : "contribution_removed_on_correction",
                        ...(previous.contextId
                            ? { previousContextId: previous.contextId }
                            : {}),
                        ...(current.contextId
                            ? { currentContextId: current.contextId }
                            : {}),
                        previous: finding,
                        ...(replacement ? { current: replacement } : {}),
                        reviewStatus: "pending",
                    });
                }
            }
        }
    }
    return changes;
}

function reviewJudgments(missions: readonly MissionSummary[]) {
    return missions.flatMap((mission) => {
        const sourceIds = mission.sources.map((source) => source.sourceId);
        const evidenceReferences = [
            ...mission.qualificationSubmissions.records.flatMap((submission) =>
                submission.snapshot.findings.flatMap((finding) =>
                    finding.passageKeys.map(
                        (key) =>
                            `${submission.contextId ?? `event:${submission.sequence}`}:${key}`,
                    ),
                ),
            ),
            ...mission.sources.flatMap((source) =>
                source.comparison.findings.flatMap((finding) => [
                    ...finding.targetPassageKeys.map(
                        (key) => `${source.sourceId}:${key}`,
                    ),
                    ...finding.primaryPassages.map(
                        (passage) =>
                            `${passage.sourceId}:${passage.passageKey}`,
                    ),
                ]),
            ),
        ];
        return REVIEW_DIMENSIONS.map((dimension) => ({
            missionId: mission.missionId,
            dimension,
            sourceIds,
            evidenceReferences,
            status: "pending" as const,
            notes: "",
        }));
    });
}

function cell(value: unknown): string {
    return String(value ?? "—")
        .replaceAll("|", "\\|")
        .replace(/[\r\n]+/g, " ");
}

function money(value: number | null): string {
    return value === null ? "not reported" : `$${value.toFixed(4)}`;
}

function renderMarkdown(conditions: readonly ConditionSummary[]): string {
    const lines = [
        "# Sources approach evaluation",
        "",
        "Offline results are simulated. Accepted schemas and workflow submissions show protocol acceptance, not analytical correctness. Repetitions remain separate; this report provides no aggregate correctness score.",
    ];
    for (const condition of conditions) {
        lines.push(
            "",
            `## ${condition.approach} approach / reasoning ${condition.reasoning}`,
        );
        for (const mission of condition.missions) {
            lines.push(
                "",
                `### ${mission.missionId}`,
                `Scenario: ${mission.scenarioId}; repetition: ${mission.repetition}; execution: ${mission.execution === "offline" ? "simulated (offline)" : "live"}; mission status: ${mission.status}${mission.stopReason ? ` (${mission.stopReason})` : ""}.`,
                `Elapsed: ${mission.elapsedMs} ms. Calls: ${mission.calls.total} (${mission.calls.counts.succeeded} succeeded, ${mission.calls.counts.invalid} invalid, ${mission.calls.counts.failed} failed); unknown outcomes: ${mission.calls.counts.unknown}. Latency ${mission.calls.latencyMs.total} ms total / ${mission.calls.latencyMs.average ?? "—"} ms average. Reported cost: ${money(mission.calls.reportedCostUsd)}; unknown charge reservation for calls without a cost receipt: ${money(mission.calls.unknownChargeReservedUsd)} (${mission.calls.unknownChargeReservationCount} calls).`,
                `Qualifications: ${mission.qualificationSubmissions.accepted} accepted, ${mission.qualificationSubmissions.rejected} rejected, ${mission.qualificationSubmissions.snapshotless} accepted without complete snapshots.`,
                "",
                "| Source | Read | Qualification | Accepted / rejected | Findings (role · kind · period · passage refs) | Restrictions | Comparison | Declared roles / eligible roles |",
                "| --- | --- | --- | ---: | --- | --- | --- | --- |",
            );
            if (mission.sources.length === 0)
                lines.push(
                    "| No prepared source record | — | — | — | — | — | — | — |",
                );
            for (const source of mission.sources) {
                const findings =
                    source.findings
                        .map(
                            (finding) =>
                                `${finding.role} · ${finding.kind} · ${finding.period} · ${finding.passageKeys.join(", ") || "no refs"}`,
                        )
                        .join("<br>") || "none recorded";
                const limitations =
                    source.limitations
                        .map(
                            (item) =>
                                `${item.code} (${item.scope?.kind ?? "scope unspecified"}; ${item.passageKeys.join(", ") || "no refs"})`,
                        )
                        .join("<br>") || "none recorded";
                const comparisons = source.comparison.findings
                    .map(
                        (finding) =>
                            `${finding.findingIndex}: ${finding.disposition} (${finding.targetPassageKeys.join(", ") || "no target refs"} ↔ ${finding.primaryPassages.map((item) => `${item.sourceId}/${item.passageKey}`).join(", ") || "no primary refs"})`,
                    )
                    .join("<br>");
                const comparison = [
                    source.comparison.status,
                    source.comparison.checkStatus,
                    source.comparison.completeness,
                    comparisons,
                ]
                    .filter(Boolean)
                    .join("; ");
                lines.push(
                    `| ${cell(source.title)} (${cell(source.sourceId)}) | ${source.read ? "read" : "unread"} | ${source.qualificationStatus} · rev ${source.qualificationRevision} | ${source.acceptedQualifications} / ${source.rejectedQualifications} | ${cell(findings)} | ${cell(limitations)} | ${cell(comparison || "not reported")} | ${cell(source.declaredCoverageRoles.join(", ") || "none")} / ${cell(source.eligibleCoverageRoles.join(", ") || "none")} |`,
                );
            }
            lines.push(
                "",
                `Selection: ${mission.selection.status}; source-family gaps: ${mission.selection.gaps.join(", ") || "none reported"}; coverage-role gaps: ${mission.selection.coverageGaps.join(", ") || "none reported"}; documentary gaps: ${mission.selection.documentaryCoverageGaps.join(", ") || "none reported"}. Declared and eligible roles come from the actual selection output and remain distinct.`,
            );
            if (mission.missingSourceRecords.length > 0) {
                lines.push(
                    `Selection entries without prepared-source records: ${mission.missingSourceRecords.map((item) => `${item.sourceId} (${item.disposition})`).join(", ")}.`,
                );
            }
            lines.push(
                "",
                "Event trail:",
                "",
                "| Seq. | Operation | Status | Source | Context | Reason code |",
                "| ---: | --- | --- | --- | --- | --- |",
            );
            if (mission.events.length === 0)
                lines.push("| — | No event snapshots | — | — | — | — |");
            for (const event of mission.events) {
                lines.push(
                    `| ${event.sequence} | ${event.operation} | ${event.status} | ${cell(event.sourceId)} | ${cell(event.contextId)} | ${cell(event.reason)} |`,
                );
            }
        }
    }
    lines.push(
        "",
        "Manual review is pending for retained or lost useful content, restriction and period support, comparison quality, selection quality, and equivalent evidence. Revision changes require review; they are not automatically errors.",
    );
    return `${lines.join("\n")}\n`;
}

/** Builds an annotatable comparison without scoring analytical correctness. */
export function buildSourcesApproachReport(
    results: readonly SourcesApproachResult[],
) {
    if (new Set(results.map((r) => r.schemaVersion)).size > 1)
        throw new Error("Do not pool preparation and inspection protocols");
    const baselines = new Map<string, string>();
    const focuses = new Map<string, string>();
    for (const result of results) {
        if (!result.inspection) continue;
        const previous = baselines.get(result.scenarioId);
        if (previous && previous !== result.inspection.baselineHash)
            throw new Error(
                "Inspection conditions must share the same baseline",
            );
        baselines.set(result.scenarioId, result.inspection.baselineHash);
        const focus = JSON.stringify(
            [
                ...(result.inspection.focusSourceIds ??
                    result.inspection.initialSources.map((s) => s.sourceId)),
            ].sort(),
        );
        const previousFocus = focuses.get(result.scenarioId);
        if (previousFocus && previousFocus !== focus)
            throw new Error(
                "Inspection conditions must share the same focused sources",
            );
        focuses.set(result.scenarioId, focus);
    }
    const groups = [
        ["fixed", "off"],
        ["fixed", "on"],
        ["agent", "off"],
        ["agent", "on"],
    ] as const;
    const conditions: ConditionSummary[] = [];
    for (const [approach, reasoning] of groups) {
        const missions = results
            .filter(
                (result) =>
                    result.approach === approach &&
                    result.reasoning === reasoning,
            )
            .map(summarizeMission)
            .sort(
                (left, right) =>
                    left.scenarioId.localeCompare(right.scenarioId) ||
                    left.repetition - right.repetition ||
                    left.missionId.localeCompare(right.missionId),
            );
        if (missions.length > 0)
            conditions.push({ approach, reasoning, missions });
    }
    const summary = {
        evidenceBoundary:
            "Offline results are simulated. Protocol acceptance does not establish analytical correctness. Repetitions remain separate; no aggregate correctness score is calculated.",
        conditions,
    };
    const allMissions = conditions.flatMap((condition) => condition.missions);
    const reviewTemplate = {
        findingChanges: findFindingChanges(allMissions),
        judgments: reviewJudgments(allMissions),
        inspections: results
            .filter((r) => r.inspection)
            .map((r) => ({
                missionId: r.missionId,
                scenarioId: r.scenarioId,
                baselineHash: r.inspection?.baselineHash,
                focusSourceIds: r.inspection?.focusSourceIds,
                before: r.inspection?.initialSources,
                after: r.sources,
                judgment: "pending",
                autonomousDetection: "pending",
                materialOmissions: [],
                unsupportedFavorableConclusions: [],
                usefulContributionsLost: [],
                evidenceReferences: [],
                judge: null,
                explanation: null,
            })),
    };
    const notice = baselines.size
        ? "\nInspection judgments remain pending. Qualified-source counts include imported baseline work. Review the original and revised contributions, omissions, scope and supporting passages. Completion counts do not establish correctness.\n"
        : "";
    return {
        markdown: renderMarkdown(conditions) + notice,
        summary,
        reviewTemplate,
    };
}
