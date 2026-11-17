import type { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { FunctionArgs } from "convex/server";
import { type ComponentProps, useMemo, useState } from "react";

import { SourceProposalReview } from "@/components/workspace/source-proposal-review";

type ProposalProps = ComponentProps<typeof SourceProposalReview>;
type ProposalSource = ProposalProps["adjustmentSets"]["included"][number];
type Decision = FunctionArgs<typeof api.sources.decide>["decision"];

const FIXTURE_SOURCES: Array<ProposalSource> = [
    {
        sourceId: "src-1" as Id<"sources">,
        canonicalUrl:
            "https://www.sec.gov/Archives/edgar/data/1373715/000162828024032498/snow-20240131.htm",
        title: "Annual report on Form 10-K",
        origin: "sec",
        category: "regulatory",
        decision: "pending",
        disposition: "recommended",
        sourceFamily: "regulatory",
        documentKind: "regulatory_annual",
        authorityTier: "regulator_primary",
        companyLinkageBasis: "structural",
        coverageContributions: ["regulatory_annual"],
        recommendationContributions: [],
        declaredCoverageRoles: ["regulatory_annual"],
        eligibleCoverageRoles: ["regulatory_annual"],
        duplicateOfSourceId: undefined,
        rank: 0,
        reasonCodes: ["required_family_coverage"],
        included: true,
        publishedAt: 1706745600000,
        decisionReason: undefined,
    },
    {
        sourceId: "src-2" as Id<"sources">,
        canonicalUrl:
            "https://investors.servicenow.com/news-releases/news-details/default.aspx",
        title: "Q4 earnings release and investor commentary",
        origin: "exa",
        category: "investor_relations",
        decision: "pending",
        disposition: "recommended",
        sourceFamily: "investor_relations",
        documentKind: "earnings_release",
        authorityTier: "company_primary",
        companyLinkageBasis: "structural",
        coverageContributions: ["investor_results"],
        recommendationContributions: [],
        declaredCoverageRoles: ["investor_results"],
        eligibleCoverageRoles: ["investor_results"],
        duplicateOfSourceId: undefined,
        rank: 1,
        reasonCodes: ["required_family_coverage"],
        included: true,
        publishedAt: 1706745600000,
        decisionReason: undefined,
    },
    {
        sourceId: "src-3" as Id<"sources">,
        canonicalUrl:
            "https://seekingalpha.com/article/4651234-servicenow-platform-resilience",
        title: "Platform resilience and AI distribution thesis",
        origin: "exa",
        category: "independent_analysis",
        decision: "pending",
        disposition: "recommended",
        sourceFamily: "independent_analysis",
        documentKind: "independent_analysis",
        authorityTier: "unverified",
        companyLinkageBasis: "unverified",
        coverageContributions: [],
        recommendationContributions: [],
        declaredCoverageRoles: [],
        eligibleCoverageRoles: [],
        duplicateOfSourceId: undefined,
        rank: 2,
        reasonCodes: ["ranked_fill"],
        included: true,
        publishedAt: 1709164800000,
        decisionReason: undefined,
    },
    {
        sourceId: "src-4" as Id<"sources">,
        canonicalUrl:
            "https://www.zdnet.com/article/servicenow-meets-the-agentic-era",
        title: "ServiceNow meets the agentic era",
        origin: "exa",
        category: "press_coverage",
        decision: "pending",
        disposition: "needs_attention",
        sourceFamily: "unrecognized",
        documentKind: "news_reporting",
        authorityTier: "unverified",
        companyLinkageBasis: "unverified",
        coverageContributions: [],
        recommendationContributions: [],
        declaredCoverageRoles: [],
        eligibleCoverageRoles: [],
        duplicateOfSourceId: undefined,
        rank: 3,
        reasonCodes: ["unrecognized_source_family"],
        included: false,
        publishedAt: 1709164800000,
        decisionReason: undefined,
    },
    {
        sourceId: "src-5" as Id<"sources">,
        canonicalUrl:
            "https://substack.example.com/discontinuity/p/weakening-now",
        title: "Is the workflow moat weakening?",
        origin: "exa",
        category: "counter_evidence",
        decision: "pending",
        disposition: "alternative",
        sourceFamily: "counter_evidence",
        documentKind: "unknown",
        authorityTier: "unverified",
        companyLinkageBasis: "unverified",
        coverageContributions: [],
        recommendationContributions: [],
        declaredCoverageRoles: [],
        eligibleCoverageRoles: [],
        duplicateOfSourceId: undefined,
        rank: 4,
        reasonCodes: ["not_selected"],
        included: false,
        publishedAt: 1709164800000,
        decisionReason: undefined,
    },
];

/** Prototype companion component for /prototype/source-review. */
export function ProtoSourceReview() {
    const [sources, setSources] = useState(FIXTURE_SOURCES);
    const [disposition, setDisposition] =
        useState<ProposalProps["disposition"]>("recommended");
    const [approved, setApproved] = useState(false);
    const inspectionSources = useMemo(
        () =>
            sources.map((source) => ({
                sourceId: source.sourceId,
                canonicalUrl: source.canonicalUrl,
                title: source.title,
                origin: source.origin,
                category: source.category,
                publishedAt: source.publishedAt,
                decision: source.decision,
                reason: source.decisionReason,
                documentKind: source.documentKind,
                authorityTier: source.authorityTier,
            })),
        [sources],
    );
    const included = sources.filter((source) => source.included);
    const available = sources.filter((source) => !source.included);
    const onDecide: ProposalProps["onDecide"] = (
        sourceId,
        decision: Decision,
    ) => {
        setSources((current) =>
            current.map((source) =>
                source.sourceId === sourceId
                    ? {
                          ...source,
                          decision,
                          included:
                              decision === "accepted"
                                  ? true
                                  : decision === "rejected"
                                    ? false
                                    : source.disposition === "recommended",
                          decisionReason:
                              decision === "pending"
                                  ? undefined
                                  : "Prototype analyst override",
                      }
                    : source,
            ),
        );
    };

    return (
        <div className="py-6">
            <header className="mb-5">
                <p className="text-micro text-brand-purple">NOW · NYSE</p>
                <h1 className="mt-2 text-2xl font-medium">ServiceNow, Inc.</h1>
            </header>
            <p className="mb-4 rounded-lg border border-review/30 bg-review/10 p-3 text-xs text-muted-foreground sm:max-w-xl">
                Prototype fixture. This proposal uses source details collected
                during discovery; source content has not been read.
            </p>
            <SourceProposalReview
                corpusRevisionId={"proto-rev" as Id<"corpusRevisions">}
                summary={{
                    proposalId:
                        "proto-proposal" as Id<"sourceSelectionProposals">,
                    version: 1,
                    status: "ready",
                    effectiveStatus: "ready",
                    selectionExplanationRefreshAvailable: false,
                    recommendedTarget: 12,
                    recommendationCeiling: 12,
                    rebuildOutcome: undefined,
                    failedDiscoveryFamilies: [],
                    coverageRequirements: [],
                    recovery: null,
                    coverageGaps: [
                        "official_product_platform",
                        "official_commercial_pricing",
                    ],
                    counts: {
                        recommended: sources.filter(
                            ({ disposition: value }) => value === "recommended",
                        ).length,
                        needsAttention: sources.filter(
                            ({ disposition: value }) =>
                                value === "needs_attention",
                        ).length,
                        alternative: sources.filter(
                            ({ disposition: value }) => value === "alternative",
                        ).length,
                    },
                    gaps: ["official_product", "official_commercial"],
                    effectiveIncludedCount: included.length,
                    revisionStatus: approved ? "approved" : "draft",
                }}
                disposition={disposition}
                onDispositionChange={setDisposition}
                adjustmentSets={{ included, available }}
                inspectionReview={{
                    revision: 1,
                    status: approved ? "approved" : "draft",
                    counts: {
                        accepted: inspectionSources.filter(
                            ({ decision }) => decision === "accepted",
                        ).length,
                        rejected: inspectionSources.filter(
                            ({ decision }) => decision === "rejected",
                        ).length,
                        pending: inspectionSources.filter(
                            ({ decision }) => decision === "pending",
                        ).length,
                    },
                    total: inspectionSources.length,
                    candidateLimit: 48,
                    sources: inspectionSources,
                }}
                onDecide={onDecide}
                onApprove={() => setApproved(true)}
                onRecompute={() => undefined}
                onAddManualUrl={() => undefined}
            />
        </div>
    );
}
