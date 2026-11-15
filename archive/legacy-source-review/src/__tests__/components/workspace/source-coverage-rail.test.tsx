import type { Id } from "@convex/_generated/dataModel";
import {
    fireEvent,
    render,
    screen,
    waitFor,
    within,
} from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { SourceCoverageRail } from "@/components/workspace/source-coverage-rail";

test("applies the dossier-wide search cooldown to another coverage role", () => {
    render(
        <SourceCoverageRail
            requirements={[
                {
                    role: "official_commercial_terms",
                    covered: false,
                    availability: "not_established",
                    reasonCodes: [],
                    relatedCandidateIds: [],
                    candidateIds: [],
                    includedSourceIds: [],
                },
            ]}
            onReview={vi.fn()}
            onSearch={vi.fn()}
            recovery={{
                target: {
                    kind: "coverage",
                    role: "official_product_integration",
                },
                feedback: null,
                retryAfterSeconds: 30,
            }}
        />,
    );
    fireEvent.click(
        screen.getByRole("button", {
            name: "Review coverage: Subscription & service terms",
        }),
    );
    const search = screen.getByRole("button", {
        name: /^(Search sources|Retry in).*Subscription & service terms/,
    }) as HTMLButtonElement;
    expect(search.disabled).toBe(true);
    expect(search.textContent).toContain("Retry in 30s");
});

test("keeps coverage limitations visible when mobile coverage is collapsed", () => {
    const nativeMatchMedia = window.matchMedia;
    const viewport = vi
        .spyOn(window, "matchMedia")
        .mockImplementation((query) => ({
            ...nativeMatchMedia(query),
            matches: query === "(width < 80rem)",
        }));
    try {
        const requirements: Parameters<
            typeof SourceCoverageRail
        >[0]["requirements"] = [
            {
                role: "regulatory_annual",
                covered: true,
                availability: "available",
                reasonCodes: [],
                includedSourceIds: [],
                relatedCandidateIds: [],
                candidateIds: [],
            },
            {
                role: "official_commercial_terms",
                covered: false,
                availability: "limited",
                reasonCodes: [],
                includedSourceIds: [],
                relatedCandidateIds: [],
                candidateIds: [],
            },
            {
                role: "counter_evidence_primary",
                covered: false,
                availability: "not_established",
                reasonCodes: [],
                includedSourceIds: [],
                relatedCandidateIds: [],
                candidateIds: [],
            },
        ];
        const onReview = vi.fn();
        const { rerender } = render(
            <SourceCoverageRail
                requirements={requirements}
                onReview={onReview}
            />,
        );
        expect(
            screen
                .getByRole("button", { name: "Coverage" })
                .getAttribute("aria-expanded"),
        ).toBe("false");
        expect(screen.getByText("1 limited · 1 not established")).toBeTruthy();
        expect(
            screen.queryByRole("button", { name: /Review coverage:/ }),
        ).toBeNull();
        rerender(
            <SourceCoverageRail
                requirements={requirements.slice(0, 1)}
                onReview={onReview}
            />,
        );
        expect(
            screen.getByText("All topics have sources available"),
        ).toBeTruthy();
        rerender(<SourceCoverageRail requirements={[]} onReview={onReview} />);
        expect(screen.getByText("Coverage not assessed")).toBeTruthy();
    } finally {
        viewport.mockRestore();
    }
});

test("keeps coverage help separate from the open topic and restores focus when it closes", async () => {
    render(
        <SourceCoverageRail
            requirements={[
                {
                    role: "official_commercial_terms",
                    covered: false,
                    availability: "limited",
                    reasonCodes: ["partial_reading"],
                    relatedCandidateIds: [],
                    candidateIds: [],
                    includedSourceIds: [],
                },
            ]}
            onReview={vi.fn()}
        />,
    );
    fireEvent.click(
        screen.getByRole("button", {
            name: "Review coverage: Subscription & service terms",
        }),
    );
    const topic = screen.getByRole("region", {
        name: "Subscription & service terms",
    });
    expect(
        within(topic).getByText("Only part of the document was reviewed."),
    ).toBeTruthy();
    const help = screen.getByRole("button", {
        name: "What coverage tells you",
    });
    expect(help.textContent).toBe("");
    const definition =
        "The included sources have not established this topic. Included matches can still need review.";
    expect(screen.queryByText(definition)).toBeNull();
    fireEvent.click(help);
    expect(await screen.findByText(definition)).toBeTruthy();
    expect(topic.textContent).not.toContain(definition);
    expect(screen.getByRole("dialog").textContent).not.toMatch(
        /not_established|official_commercial_terms|sourceSelection|generation/,
    );
    fireEvent.click(
        screen.getByRole("button", { name: "Close coverage help" }),
    );
    await waitFor(() => expect(screen.queryByText(definition)).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(help));
    expect(
        within(topic).getByText("Only part of the document was reviewed."),
    ).toBeTruthy();
});

test("explains why included matches do not establish coverage and offers distinct review actions", () => {
    const included = "source-included" as Id<"sources">;
    const candidates = [included, "source-other" as Id<"sources">];
    const onReview = vi.fn();
    render(
        <SourceCoverageRail
            requirements={[
                {
                    role: "official_commercial_terms",
                    covered: false,
                    availability: "not_established",
                    reasonCodes: ["no_suitable_document"],
                    includedSourceIds: [included],
                    relatedCandidateIds: [],
                    candidateIds: candidates,
                },
            ]}
            onReview={onReview}
            onSearch={vi.fn()}
        />,
    );
    fireEvent.click(
        screen.getByRole("button", {
            name: "Review coverage: Subscription & service terms",
        }),
    );
    const details = screen.getByRole("region", {
        name: "Subscription & service terms",
    });
    expect(
        within(details).getByText(
            "No suitable document has been confirmed among the included matches.",
        ),
    ).toBeTruthy();
    expect(details.textContent).not.toMatch(
        /documentary need|no_suitable_document|official_commercial_terms/,
    );
    expect(within(details).getByText("Review 1 other candidate")).toBeTruthy();
    fireEvent.click(
        within(details).getByRole("button", { name: "View 1 included source" }),
    );
    expect(onReview).toHaveBeenLastCalledWith(
        "official_commercial_terms",
        true,
    );
    fireEvent.click(
        within(details).getByRole("button", {
            name: "Review candidates for Subscription & service terms",
        }),
    );
    expect(onReview).toHaveBeenLastCalledWith("official_commercial_terms");
});

test("keeps only one coverage detail expanded and preserves its review actions", () => {
    render(
        <SourceCoverageRail
            requirements={[
                {
                    role: "official_product_platform",
                    covered: true,
                    availability: "available",
                    reasonCodes: [],
                    relatedCandidateIds: [],
                    candidateIds: [],
                    includedSourceIds: [],
                },
                {
                    role: "official_product_integration",
                    covered: false,
                    availability: "limited",
                    reasonCodes: [],
                    relatedCandidateIds: [],
                    candidateIds: [],
                    includedSourceIds: [],
                },
                {
                    role: "official_commercial_terms",
                    covered: false,
                    availability: "not_established",
                    reasonCodes: [],
                    relatedCandidateIds: [],
                    candidateIds: [],
                    includedSourceIds: [],
                },
            ]}
            onReview={vi.fn()}
        />,
    );
    const limited = screen.getByRole("button", {
        name: "Review coverage: APIs & integrations",
    });
    const missing = screen.getByRole("button", {
        name: "Review coverage: Subscription & service terms",
    });
    fireEvent.click(limited);
    expect(
        screen.getByRole("region", { name: "APIs & integrations" }),
    ).toBeTruthy();
    fireEvent.click(missing);
    expect(
        screen.queryByRole("region", { name: "APIs & integrations" }),
    ).toBeNull();
    expect(
        within(
            screen.getByRole("region", {
                name: "Subscription & service terms",
            }),
        ).getByText("No suitable source is included yet."),
    ).toBeTruthy();
    expect(
        screen.queryByRole("button", {
            name: /Review candidates for Subscription/,
        }),
    ).toBeNull();
    fireEvent.keyDown(missing, { key: "Escape" });
    expect(
        screen.queryByRole("region", { name: "Subscription & service terms" }),
    ).toBeNull();
    expect(document.activeElement).toBe(missing);
});

test.each([
    {
        status: "success" as const,
        title: "2 candidates to review",
        description: "Review the newly found sources.",
    },
    {
        status: "default" as const,
        title: "No new sources found",
        description: "Review existing candidates.",
    },
    {
        status: "danger" as const,
        title: "Search could not be completed",
        description: "Your source decisions are unchanged.",
    },
])("retains $title separately from the exhausted search allowance", (feedback) => {
    render(
        <SourceCoverageRail
            requirements={[
                {
                    role: "official_commercial_terms",
                    covered: false,
                    availability: "not_established",
                    reasonCodes: [],
                    relatedCandidateIds: [],
                    candidateIds: [],
                    includedSourceIds: [],
                },
            ]}
            onReview={vi.fn()}
            onSearch={vi.fn()}
            searchDisabled
            recovery={{
                target: { kind: "coverage", role: "official_commercial_terms" },
                feedback,
                retryAfterSeconds: 0,
            }}
            allowanceFeedback={{
                status: "warning",
                title: "Search limit reached",
                description: "Review existing candidates or add a source link.",
            }}
        />,
    );
    fireEvent.click(
        screen.getByRole("button", {
            name: "Review coverage: Subscription & service terms",
        }),
    );
    expect(screen.getByText(feedback.title)).toBeTruthy();
    expect(screen.getByText("Search limit reached")).toBeTruthy();
    expect(
        screen.getByRole("button", {
            name: "Search sources for Subscription & service terms",
        }),
    ).toHaveProperty("disabled", true);
});
