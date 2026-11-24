import {
    buildSourceSelectionProposal,
    type SourceSelectionCandidate,
} from "@convex/domain/sourceSelectionPolicy";
import { expect, test } from "vitest";

test("recommendations do not depend on database insertion identities", () => {
    const legalName = "Adobe";
    const cik = "796343";
    const domain = "adobe.com";
    const ticker = "ADBE";
    const select = (ids: string[]) => {
        const candidates: SourceSelectionCandidate[] = ["alpha", "zeta"].map(
            (path, index) => ({
                sourceId: ids[index] ?? "missing",
                canonicalUrl: `https://${domain}/legal/${path}`,
                title: "Subscription agreement",
                origin: "exa",
                category: "official_commercial",
                createdAt: 1,
                inspection: {
                    status: "qualified",
                    readingCompleteness: "complete",
                    qualification: {
                        companyMatch: "subject",
                        companyPassages: [
                            { passageKey: "p0", quotation: legalName },
                        ],
                        documentKind: "official_commercial_terms",
                        reportingPeriodEnd: null,
                        reportingPeriodPassages: [],
                        findings: [
                            {
                                role: "official_commercial_terms",
                                kind: "asserted_fact",
                                summary: "Subscription terms",
                                passages: [
                                    {
                                        passageKey: "p1",
                                        quotation: "Subscription terms",
                                    },
                                ],
                                period: "unspecified",
                                periodPassages: [],
                                dependsOnFlaggedAssertion: false,
                            },
                        ],
                        limitations: [],
                    },
                },
            }),
        );
        return buildSourceSelectionProposal({
            candidates,
            company: {
                cik,
                legalName,
                ticker,
                websiteUrl: `https://${domain}`,
            },
            ceiling: 1,
            coveragePreset: "balanced",
        })
            .items.filter((item) => item.disposition === "recommended")
            .map(
                (item) =>
                    candidates.find(
                        (candidate) => candidate.sourceId === item.sourceId,
                    )?.canonicalUrl,
            );
    };
    expect(select(["first-id", "second-id"])).toHaveLength(1);
    expect(select(["first-id", "second-id"])).toEqual(
        select(["second-id", "first-id"]),
    );
});
