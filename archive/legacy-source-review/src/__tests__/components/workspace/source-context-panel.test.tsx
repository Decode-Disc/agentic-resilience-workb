import { api } from "@convex/_generated/api";
import {
    fireEvent,
    render,
    screen,
    waitFor,
    within,
} from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { convexReactHarness } from "@/__tests__/helpers/convex-react-harness";

vi.mock(
    "convex/react",
    async () =>
        (await import("@/__tests__/helpers/convex-react-harness"))
            .convexReactHarness.module,
);
beforeEach(() => convexReactHarness.reset());

vi.mock("@/hooks/use-source-preview", () => ({
    useSourcePreview: () => ({ status: "idle" }),
}));

import { SourceContextPanel } from "@/components/workspace/source-context-panel";

const source: Parameters<typeof SourceContextPanel>[0]["source"] = {
    sourceId: "source-reading" as never,
    canonicalUrl: "https://example.com/workflow-analysis",
    title: "Workflow analysis",
    origin: "exa",
    category: "independent_analysis",
    decision: "pending",
    reason: undefined,
    publishedAt: undefined,
    documentKind: "independent_analysis",
    authorityTier: "unverified",
    inspectionStatus: "partial",
    qualificationStatus: "available",
    qualificationExecutionMode: "showcase",
    roleAvailability: [
        {
            role: "counter_evidence_primary",
            state: "limited",
            usage: "attributed_argument_only",
            reasonCodes: ["publisher_unverified"],
        },
    ],
    qualification: {
        companyMatch: "subject",
        companyPassages: [],
        documentKind: "independent_analysis",
        reportingPeriodEnd: null,
        reportingPeriodPassages: [],
        findings: [
            {
                findingKey: "assessment-argument-0",
                reasonCodes: [],
                usage: "attributed_argument_only",
                role: "counter_evidence_primary",
                kind: "attributed_argument",
                summary: "OPENROUTER_API_KEY source_qualification",
                passages: [
                    {
                        passageKey: "p0",
                        quotation:
                            "The author argues that agents could change the economics of workflow software.",
                    },
                ],
                period: "unspecified",
                periodPassages: [],
                dependsOnFlaggedAssertion: false,
            },
        ],
        limitations: [
            {
                code: "factual_conflict",
                explanation: "request_timeout source_qualification",
                passages: [],
            },
        ],
    },
};

test("keeps SEC hosting provenance in source details without claiming a filing or verified authorship", () => {
    render(
        <SourceContextPanel
            source={{
                ...source,
                authorityTier: "regulator_primary",
                canonicalUrl: "https://www.sec.gov/news/example",
            }}
        />,
    );
    const header = document.querySelector('[data-slot="source-record-header"]');
    if (!(header instanceof HTMLElement))
        throw new Error("Missing source header");
    expect(within(header).queryByText("Primary regulator")).toBeNull();
    expect(within(header).queryByText("SEC-hosted source")).toBeNull();
    const provenance = screen.getByRole("region", {
        name: "Source provenance",
    });
    expect(within(provenance).getByText("SEC-hosted source")).toBeTruthy();
    fireEvent.click(within(provenance).getByRole("button"));
    expect(
        within(provenance).getByText(/Hosting alone does not establish/),
    ).toBeTruthy();
    expect(within(provenance).queryByText(/Filed with SEC/)).toBeNull();
});

test("distinguishes publication from the financial reporting period in UTC", () => {
    if (!source.qualification) throw new Error("Missing qualification fixture");
    render(
        <SourceContextPanel
            source={{
                ...source,
                publishedAt: Date.parse("2026-02-27T23:30:00.000Z"),
                qualification: {
                    ...source.qualification,
                    reportingPeriodEnd: "2025-12-31",
                },
            }}
        />,
    );
    expect(screen.getByText("Published")).toBeTruthy();
    expect(screen.getByText("Feb 27, 2026").getAttribute("datetime")).toBe(
        "2026-02-27T23:30:00.000Z",
    );
    expect(screen.getByText("Reporting period ending")).toBeTruthy();
    expect(screen.getByText("Dec 31, 2025").getAttribute("datetime")).toBe(
        "2025-12-31",
    );
});

test("does not infer missing publication or reporting dates from a source title", () => {
    render(
        <SourceContextPanel
            source={{
                ...source,
                title: "Annual report on Form 10-K for FY 2025",
            }}
        />,
    );
    expect(screen.queryByText(/^Published\b/)).toBeNull();
    expect(screen.queryByText(/^Reporting period ending\b/)).toBeNull();
});

test("describes corpus membership separately from a source's proposal group", () => {
    const { rerender } = render(
        <SourceContextPanel source={source} included={false} />,
    );
    expect(screen.getByText("Not included")).toBeTruthy();
    rerender(<SourceContextPanel source={source} included />);
    expect(screen.getByText("Included")).toBeTruthy();
    expect(screen.queryByText("Not included")).toBeNull();
});

test("preserves automatic arrow-key activation in the source reader tabs", async () => {
    render(<SourceContextPanel source={source} />);
    const details = screen.getByRole("tab", { name: "Source details" });
    details.focus();
    fireEvent.keyDown(details, { key: "ArrowRight" });
    await waitFor(() =>
        expect(
            screen
                .getByRole("tab", { name: "Preview" })
                .getAttribute("aria-selected"),
        ).toBe("true"),
    );
});

test("opens source provenance on request and closes it for another source", () => {
    const { rerender } = render(<SourceContextPanel source={source} />);
    expect(screen.getByText("example.com")).toBeTruthy();
    expect(screen.queryByText(source.canonicalUrl)).toBeNull();
    fireEvent.click(
        screen.getByRole("button", { name: "View source address" }),
    );
    const address = screen.getByRole("dialog", { name: "Source address" });
    expect(within(address).getByText(source.canonicalUrl)).toBeTruthy();
    expect(
        within(address).getByRole("button", { name: "Copy link" }),
    ).toBeTruthy();
    const nextSource = {
        ...source,
        sourceId: "source-next" as typeof source.sourceId,
        canonicalUrl: "https://example.com/another-document",
    };
    rerender(<SourceContextPanel source={nextSource} />);
    expect(screen.queryByRole("dialog", { name: "Source address" })).toBeNull();
    expect(
        screen
            .getByRole("link", { name: "Open original" })
            .getAttribute("href"),
    ).toBe(nextSource.canonicalUrl);
});

test("opens useful reading by default before corpus approval", () => {
    render(<SourceContextPanel source={source} />);
    expect(
        screen
            .getByRole("tab", { name: "Source details" })
            .getAttribute("aria-selected"),
    ).toBe("true");
    expect(screen.getByRole("region", { name: "Source reading" })).toBeTruthy();
    expect(
        screen.getByText(
            "The author argues that agents could change the economics of workflow software.",
        ),
    ).toBeTruthy();
});

test("explains the prepared contribution beside its exact passage", () => {
    if (!source.qualification?.findings[0])
        throw new Error("Missing reading fixture");
    render(
        <SourceContextPanel
            source={{
                ...source,
                qualification: {
                    ...source.qualification,
                    findings: [
                        {
                            ...source.qualification.findings[0],
                            summary:
                                "Describes how the platform coordinates workflow execution.",
                        },
                    ],
                },
            }}
        />,
    );
    expect(
        screen.getByText(
            "Describes how the platform coordinates workflow execution.",
        ),
    ).toBeTruthy();
    expect(
        screen.getByText(
            "The author argues that agents could change the economics of workflow software.",
        ),
    ).toBeTruthy();
});

test("does not offer a visual preview for an accepted source", () => {
    render(<SourceContextPanel source={{ ...source, decision: "accepted" }} />);
    expect(screen.queryByRole("tab", { name: "Preview" })).toBeNull();
    expect(screen.getByRole("link", { name: "Open original" })).toBeTruthy();
});

test("an approved legacy source explains unavailable saved-source search without starting indexing", () => {
    convexReactHarness
        .action(api.sourceRetrievalActions.ensureApprovedSourceIndex)
        .uses(vi.fn().mockResolvedValue({ status: "unavailable" }));
    render(
        <SourceContextPanel
            source={{
                ...source,
                decision: "accepted",
                qualificationStatus: undefined,
                qualification: undefined,
                inspectionStatus: undefined,
            }}
            runId={"run-legacy" as never}
            approvedCorpusRevisionId={"revision-legacy" as never}
        />,
    );
    expect(
        screen.getByText(
            "This source has no saved reading to search. Review the original source.",
        ),
    ).toBeTruthy();
    expect(screen.queryByLabelText("Search this source")).toBeNull();
});

test("explains an unprepared source without promising that approval will read it", () => {
    const { container } = render(
        <SourceContextPanel
            source={{
                ...source,
                inspectionStatus: undefined,
                qualificationStatus: undefined,
                qualification: undefined,
                roleAvailability: undefined,
            }}
        />,
    );
    fireEvent.click(screen.getByRole("tab", { name: "Source details" }));
    expect(screen.getByText("Reading not prepared")).toBeTruthy();
    expect(
        screen
            .getByRole("link", { name: "Open original" })
            .getAttribute("href"),
    ).toBe(source.canonicalUrl);
    expect(container.textContent).not.toContain("after you approve");
});

test("searches an approved source in its existing details tab and shows captured context", async () => {
    convexReactHarness
        .action(api.sourceRetrievalActions.ensureApprovedSourceIndex)
        .uses(vi.fn().mockResolvedValue({ status: "ready" }));
    convexReactHarness
        .query(api.sourceRetrieval.searchApprovedSource)
        .returnsFrom(({ args }) =>
            args !== "skip" && args.query
                ? {
                      status: "ready",
                      passages: [
                          {
                              order: 600,
                              startOffset: 9000,
                              endOffset: 9050,
                              quotation:
                                  "Storage and compute can be provisioned independently.",
                              headingPath: ["Architecture"],
                          },
                      ],
                      limitReached: false,
                  }
                : { status: "ready", passages: [], limitReached: false },
        );
    render(
        <SourceContextPanel
            source={{ ...source, decision: "accepted" }}
            runId={"run" as never}
            approvedCorpusRevisionId={"revision" as never}
        />,
    );
    fireEvent.click(screen.getByRole("tab", { name: "Source details" }));
    fireEvent.change(screen.getByLabelText("Search this source"), {
        target: { value: "storage" },
    });
    expect(
        await screen.findByText(
            "Storage and compute can be provisioned independently.",
        ),
    ).toBeTruthy();
    expect(screen.getByText("Architecture")).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "Preview" })).toBeNull();
});

test("unavailable approved search preserves the query and hides raw failure details", async () => {
    const ensure = vi
        .fn()
        .mockRejectedValue(
            new Error(
                "capture_corrupt internal.sourceRetrieval OPENROUTER_API_KEY",
            ),
        );
    convexReactHarness
        .action(api.sourceRetrievalActions.ensureApprovedSourceIndex)
        .uses(ensure);
    const { container } = render(
        <SourceContextPanel
            source={{ ...source, decision: "accepted" }}
            runId={"run" as never}
            approvedCorpusRevisionId={"revision" as never}
        />,
    );
    fireEvent.click(screen.getByRole("tab", { name: "Source details" }));
    fireEvent.change(screen.getByLabelText("Search this source"), {
        target: { value: "storage" },
    });
    expect(
        await screen.findByText("Source search is unavailable"),
    ).toBeTruthy();
    expect(
        (screen.getByLabelText("Search this source") as HTMLInputElement).value,
    ).toBe("storage");
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(container.textContent).not.toMatch(
        /capture_corrupt|internal\.sourceRetrieval|OPENROUTER_API_KEY/,
    );
});

test("shows attributed passages and unverified concerns inside the existing source details tab", async () => {
    const { container } = render(<SourceContextPanel source={source} />);
    fireEvent.click(screen.getByRole("tab", { name: "Source details" }));
    const reading = await screen.findByRole("region", {
        name: "Source reading",
    });
    expect(within(reading).getByText("Useful with limitations")).toBeTruthy();
    expect(within(reading).getByText("Partially reviewed")).toBeTruthy();
    expect(
        within(reading).getByText("Illustrative source assessment"),
    ).toBeTruthy();
    expect(within(reading).getByText("Attributed argument")).toBeTruthy();
    expect(
        within(reading).getByText(
            "Use only as an attributed hypothesis. This passage does not establish a verified fact.",
        ),
    ).toBeTruthy();
    expect(
        within(reading).getByText(/A contradiction has not been established/),
    ).toBeTruthy();
    expect(
        within(reading).getByText(
            "The author argues that agents could change the economics of workflow software.",
        ),
    ).toBeTruthy();
    expect(container.textContent).not.toMatch(
        /OPENROUTER_API_KEY|source_qualification|request_timeout/,
    );
    expect(screen.getByRole("tab", { name: "Preview" })).toBeTruthy();
});

test("shows a possible comparison concern inside the existing finding disclosure", async () => {
    const finding = source.qualification?.findings[0];
    if (!finding || !source.qualification)
        throw new Error("Missing reading fixture");
    const { container } = render(
        <SourceContextPanel
            source={{
                ...source,
                qualification: {
                    ...source.qualification,
                    findings: [
                        {
                            ...finding,
                            usage: "verification_required",
                            comparisonOutcome: "possible_conflict",
                            comparisonDetails: {
                                explanation:
                                    "possible_conflict target-p0 cites primary-0 from aiTaskResults:comparison-task-123",
                                primaryPassages: [
                                    {
                                        title: "Annual report context",
                                        canonicalUrl:
                                            "https://www.sec.gov/Archives/edgar/data/1373715/000137371526000005/annual-report.htm",
                                        quotation:
                                            "The annual report says the company competes with enterprise software providers that bundle workflow applications into broader subscriptions.",
                                    },
                                ],
                            },
                        },
                    ],
                },
            }}
        />,
    );
    fireEvent.click(screen.getByRole("tab", { name: "Source details" }));
    const details = screen.getByText("Attributed argument").closest("details");
    if (!details) throw new Error("Missing finding disclosure");
    expect(
        within(details).getByText(
            "A cited primary passage raises a possible conflict. Review the evidence before relying on this contribution. This concern is not a verified error.",
        ),
    ).toBeTruthy();
    expect(
        within(details).getByText(
            "The assessment refers to the cited passages and is limited to the available context.",
        ),
    ).toBeTruthy();
    const primaryLink = within(details).getByRole("link", {
        name: "Annual report context",
    });
    expect(primaryLink.getAttribute("href")).toBe(
        "https://www.sec.gov/Archives/edgar/data/1373715/000137371526000005/annual-report.htm",
    );
    expect(
        within(details).getByText(
            "The annual report says the company competes with enterprise software providers that bundle workflow applications into broader subscriptions.",
        ),
    ).toBeTruthy();
    expect(container.textContent).not.toMatch(
        /possible_conflict|source_comparison|provider_unavailable|target-p0|primary-0|aiTaskResults|comparison-task-123/i,
    );
});

test("explains an unavailable assessment without pretending the source was unreadable", async () => {
    render(
        <SourceContextPanel
            source={{
                ...source,
                inspectionStatus: "complete",
                qualificationStatus: "unavailable",
                qualification: undefined,
                roleAvailability: undefined,
            }}
        />,
    );
    fireEvent.click(screen.getByRole("tab", { name: "Source details" }));
    expect(
        await screen.findByText("Content saved; assessment unavailable"),
    ).toBeTruthy();
    expect(
        screen.getByText(
            "The source content was saved, but its contribution could not be assessed. Review the original before relying on it. This does not make the source irrelevant.",
        ),
    ).toBeTruthy();
    expect(screen.queryByText("Source could not be read")).toBeNull();
    expect(
        screen
            .getByRole("link", { name: "Open original" })
            .getAttribute("href"),
    ).toBe(source.canonicalUrl);
});

test("a failed reading never claims that unavailable pinned content was saved", () => {
    render(
        <SourceContextPanel
            source={{
                ...source,
                readingStatus: "reading_failed",
                inspectionStatus: "unavailable",
                qualificationStatus: "unavailable",
                qualification: undefined,
                roleAvailability: undefined,
            }}
        />,
    );
    expect(
        screen.getByRole("alert", { name: "Source could not be read" }),
    ).toBeTruthy();
    expect(
        screen.queryByText("Content saved; assessment unavailable"),
    ).toBeNull();
});

test("shows the forecast's own restriction beside results in the same documentary role", async () => {
    const finding = source.qualification?.findings[0];
    if (!finding || !source.qualification)
        throw new Error("Missing reading fixture");
    render(
        <SourceContextPanel
            source={{
                ...source,
                inspectionStatus: "complete",
                roleAvailability: [
                    {
                        role: "investor_presentation",
                        state: "available",
                        usage: "documentary",
                        reasonCodes: [],
                    },
                ],
                qualification: {
                    ...source.qualification,
                    limitations: [],
                    findings: [
                        {
                            ...finding,
                            findingKey: "assessment-results-0",
                            role: "investor_presentation",
                            kind: "reported_outcome",
                            usage: "documentary",
                            passages: [
                                {
                                    passageKey: "p0",
                                    quotation: "Q1 revenue grew 20%.",
                                },
                            ],
                        },
                        {
                            ...finding,
                            findingKey: "assessment-results-1",
                            role: "investor_presentation",
                            kind: "forecast",
                            usage: "attributed_argument_only",
                            passages: [
                                {
                                    passageKey: "p1",
                                    quotation:
                                        "Q2 revenue growth is forecast at 18%.",
                                },
                            ],
                        },
                    ],
                },
            }}
        />,
    );
    fireEvent.click(screen.getByRole("tab", { name: "Source details" }));
    const reading = await screen.findByRole("region", {
        name: "Source reading",
    });
    expect(within(reading).getByText("Useful with limitations")).toBeTruthy();
    const forecast = within(reading).getByText("Forecast").closest("details");
    if (!forecast) throw new Error("Missing forecast disclosure");
    expect(
        within(forecast).getByText(
            "Use only as an attributed hypothesis. This passage does not establish a verified fact.",
        ),
    ).toBeTruthy();
    expect(
        within(forecast).queryByText(/May contribute documentary material/),
    ).toBeNull();
});

test("explains mixed content without presenting it as a reported result", async () => {
    if (!source.qualification) throw new Error("Missing reading fixture");
    render(
        <SourceContextPanel
            source={{
                ...source,
                qualification: {
                    ...source.qualification,
                    findings: source.qualification.findings.map((finding) => ({
                        ...finding,
                        kind: "mixed_or_uncertain",
                        usage: "verification_required",
                    })),
                },
            }}
        />,
    );
    fireEvent.click(screen.getByRole("tab", { name: "Source details" }));
    expect(await screen.findByText("Mixed or unclear")).toBeTruthy();
    expect(
        screen.getByText("Verify the relevant assertions before factual use."),
    ).toBeTruthy();
});

test("shows a source-reading skeleton while the selected detail is loading", async () => {
    render(<SourceContextPanel source={source} isReadingLoading />);
    fireEvent.click(screen.getByRole("tab", { name: "Source details" }));
    const loading = await screen.findByRole("status", {
        name: "Loading source reading",
    });
    expect(loading.getAttribute("aria-busy")).toBe("true");
    expect(screen.queryByText("Useful with limitations")).toBeNull();
});

test("preserves provenance without inventing reading when no preparation exists", async () => {
    render(
        <SourceContextPanel
            source={{
                ...source,
                inspectionStatus: undefined,
                qualificationStatus: undefined,
                qualification: undefined,
                roleAvailability: undefined,
                qualificationExecutionMode: undefined,
            }}
        />,
    );
    fireEvent.click(screen.getByRole("tab", { name: "Source details" }));
    expect(await screen.findByText("Reading not prepared")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Source reading" })).toBeNull();
});

test("explains a suspended contribution without letting a clean comparison grant coverage", () => {
    const finding = source.qualification?.findings[0];
    if (!finding || !source.qualification) throw new Error("Missing fixture");
    const { container } = render(
        <SourceContextPanel
            source={{
                ...source,
                qualification: {
                    ...source.qualification,
                    findings: [
                        {
                            ...finding,
                            usage: "blocked",
                            reasonCodes: ["qualification_conflict"],
                            comparisonOutcome: "no_conflict_observed",
                        },
                    ],
                },
            }}
        />,
    );
    expect(screen.getByText("Source reading needs review")).toBeTruthy();
    expect(
        screen.getByText(
            "The reading gives conflicting assessments of this material. This contribution does not count toward coverage.",
        ),
    ).toBeTruthy();
    expect(container.textContent).not.toMatch(
        /qualification_conflict|invalid_output|source_qualification/,
    );
    expect(container.textContent).toContain(
        finding.passages[0]?.quotation ?? "missing quotation",
    );
});
