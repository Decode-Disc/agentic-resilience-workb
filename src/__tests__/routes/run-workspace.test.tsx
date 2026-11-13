import type { ErrorComponentProps } from "@tanstack/react-router";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { invalidate, responsive } = vi.hoisted(() => ({
    invalidate: vi.fn(),
    responsive: {
        isMobile: false,
        isTabletOrBelow: false,
        isDesktop: true,
    },
}));

vi.mock("@/hooks/use-responsive", () => ({
    useResponsive: () => responsive,
    useMediaQuery: () => responsive.isMobile,
}));

vi.mock("@/hooks/use-source-preview", () => ({
    useSourcePreview: () => ({ status: "idle" }),
}));

vi.mock("@tanstack/react-router", async (importOriginal) => {
    const router =
        await importOriginal<typeof import("@tanstack/react-router")>();
    return {
        ...router,
        useRouter: () => ({ invalidate }),
        Link: ({
            children,
            to,
            params,
            search: _search,
            ...props
        }: React.ComponentProps<"a"> & {
            to: string;
            search?: unknown;
            params?: { runId?: string };
        }) => {
            const href = params?.runId
                ? to.replace("$runId", params.runId)
                : to;
            return (
                <a
                    href={href}
                    {...props}
                    onClick={(event) => {
                        props.onClick?.(event);
                        event.preventDefault();
                    }}>
                    {children}
                </a>
            );
        },
    };
});

import { SourceReview } from "@/components/workspace/source-review";
import { WorkspaceNavigation } from "@/components/workspace/workspace-navigation";
import { Route as RunRoute } from "@/routes/workspace/_protected/$runId";

afterEach(() => {
    window.localStorage.clear();
    responsive.isMobile = false;
    responsive.isTabletOrBelow = false;
    responsive.isDesktop = true;
    vi.restoreAllMocks();
});

describe("production run workspace", () => {
    it("keeps four named sections and explains unavailable capabilities", () => {
        render(
            <WorkspaceNavigation runId={"run-1" as never} section="sources" />,
        );
        expect(
            screen
                .getByRole("link", { name: "Sources" })
                .getAttribute("aria-current"),
        ).toBe("page");
        expect(screen.getByRole("link", { name: "Progress" })).toBeTruthy();
        for (const label of ["Investigation", "Synthesis"]) {
            const tab = screen.getByRole("button", { name: label });
            expect(tab.getAttribute("aria-disabled")).toBe("true");
            expect(tab.getAttribute("aria-describedby")).toBeTruthy();
        }
        expect(screen.queryByText("Evidence")).toBeNull();
        expect(
            screen.queryByRole("button", { name: /Collapse navigation/ }),
        ).toBeNull();
    });

    it("keeps corpus approval visible beside secondary source actions", () => {
        const onApprove = vi.fn();
        render(
            <SourceReview
                runId={"run-1" as never}
                corpusRevisionId={"revision-1" as never}
                review={{
                    revision: 1,
                    status: "draft",
                    counts: { accepted: 1, rejected: 1, pending: 1 },
                    sources: [
                        {
                            sourceId: "source-2" as never,
                            canonicalUrl: "https://example.com/accepted",
                            title: "Accepted report",
                            origin: "sec",
                            category: "regulatory_filing",
                            decision: "accepted",
                            publishedAt: undefined,
                            reason: undefined,
                        },
                        {
                            sourceId: "source-1" as never,
                            canonicalUrl: "https://example.com/report",
                            title: "Independent report",
                            origin: "exa",
                            category: "independent_analysis",
                            decision: "pending",
                            publishedAt: undefined,
                            reason: undefined,
                            documentKind: "independent_analysis",
                            authorityTier: "institutional_independent",
                        },
                        {
                            sourceId: "source-3" as never,
                            canonicalUrl: "https://example.com/rejected",
                            title: "Rejected report",
                            origin: "exa",
                            category: "counter_evidence",
                            decision: "rejected",
                            publishedAt: undefined,
                            reason: undefined,
                        },
                    ],
                }}
                onDecide={vi.fn()}
                onApprove={onApprove}
                onAddManualUrl={vi.fn()}
            />,
        );

        const decisionFilter = screen.getByRole("button", {
            name: /Filter candidate sources: All decisions/i,
        });
        expect(decisionFilter.getAttribute("aria-expanded")).toBe("false");
        expect(
            screen.queryByRole("tablist", {
                name: "Filter candidate sources by decision",
            }),
        ).toBeNull();
        expect(
            screen.queryByRole("button", { name: "Corpus approval" }),
        ).toBeNull();
        const approveButton = screen.getByRole("button", {
            name: "Approve source set",
        });
        expect(approveButton).toBeTruthy();
        expect(
            screen.getByText(/1 pending source will be excluded/i),
        ).toBeTruthy();
        expect(screen.getByRole("button", { name: "Add source" })).toBeTruthy();

        const groupLabels = within(
            screen.getByRole("region", {
                name: "Candidate source collection",
            }),
        )
            .getAllByText(/^(Pending review|Accepted|Rejected)$/i, {
                selector: "p",
            })
            .map((label) => label.textContent);
        expect(groupLabels).toEqual(["Pending review", "Accepted", "Rejected"]);

        fireEvent.click(decisionFilter);
        fireEvent.click(screen.getByRole("radio", { name: /Accepted.*1/i }));
        expect(
            screen.getByRole("button", {
                name: /Open Accepted report for review/i,
            }),
        ).toBeTruthy();
        expect(
            screen.queryByRole("button", {
                name: /Open Independent report for review/i,
            }),
        ).toBeNull();

        fireEvent.click(approveButton);
        expect(onApprove).toHaveBeenCalledOnce();
    });

    it("reports loaded source progress and offers manual continuation", () => {
        const onLoadMore = vi.fn();
        render(
            <SourceReview
                runId={"run-1" as never}
                corpusRevisionId={"revision-1" as never}
                review={{
                    revision: 1,
                    status: "draft",
                    counts: { accepted: 0, rejected: 0, pending: 13 },
                    total: 13,
                    candidateLimit: 48,
                    sources: [
                        {
                            sourceId: "source-1" as never,
                            canonicalUrl: "https://example.com/report",
                            title: "Independent report",
                            origin: "exa",
                            category: "independent_analysis",
                            decision: "pending",
                            publishedAt: undefined,
                            reason: undefined,
                        },
                    ],
                }}
                hasMore
                isLoadingMore={false}
                onLoadMore={onLoadMore}
                onDecide={vi.fn()}
                onApprove={vi.fn()}
            />,
        );

        expect(screen.getByText(/1 of 13 loaded/i)).toBeTruthy();
        onLoadMore.mockClear();
        fireEvent.click(
            screen.getByRole("button", { name: /Load more sources/i }),
        );
        expect(onLoadMore).toHaveBeenCalledOnce();
    });

    it("separates desktop source review with resizable panels", () => {
        const { container } = render(
            <SourceReview
                runId={"run-1" as never}
                corpusRevisionId={"revision-1" as never}
                review={{
                    revision: 1,
                    status: "draft",
                    counts: { accepted: 0, rejected: 0, pending: 1 },
                    sources: [
                        {
                            sourceId: "source-1" as never,
                            canonicalUrl: "https://example.com/report",
                            title: "Independent report",
                            origin: "exa",
                            category: "independent_analysis",
                            decision: "pending",
                            publishedAt: undefined,
                            reason: undefined,
                            documentKind: "independent_analysis",
                            authorityTier: "institutional_independent",
                        },
                    ],
                }}
                onDecide={vi.fn()}
                onApprove={vi.fn()}
            />,
        );

        const activeRow = container.querySelector(
            '[data-slot="source-row"][data-active="true"]',
        );
        expect(activeRow).not.toBeNull();
        expect(
            container.querySelector('[data-slot="resizable-panel-group"]'),
        ).not.toBeNull();
        expect(
            container.querySelector('[data-testid="source-master-list"]'),
        ).not.toBeNull();
        expect(
            container.querySelector('[data-testid="source-context"]'),
        ).not.toBeNull();
        expect(screen.getByRole("separator")).toBeTruthy();

        const selectedDecision = screen.getByRole("button", {
            name: /Pending review Independent report as pending/i,
        });
        expect(selectedDecision.getAttribute("data-status")).toBe("warning");

        // Identification and decision stay in the header; provenance belongs to source details.
        const band = container.querySelector(
            '[data-slot="source-record-header"]',
        );
        expect(band).not.toBeNull();
        expect(band?.textContent).toContain("Independent report");
        const metadata = screen.getByRole("tabpanel", {
            name: "Source details",
        });
        expect(
            within(metadata).getByRole("button", {
                name: "Institutional publisher",
            }),
        ).toBeTruthy();
        expect(within(metadata).getByText("Independent analysis")).toBeTruthy();
        expect(band?.textContent).toContain("Pending");

        const previewTrigger = screen
            .getByText("Preview")
            .closest('[data-slot="tabs-trigger"]');
        const detailsTrigger = screen
            .getByText("Source details")
            .closest('[data-slot="tabs-trigger"]');
        expect(previewTrigger).not.toBeNull();
        expect(detailsTrigger).not.toBeNull();
        expect(previewTrigger?.getAttribute("aria-selected")).toBe("false");
        expect(detailsTrigger?.getAttribute("aria-selected")).toBe("true");
    });

    it("renders the source favicon and per-source decision actions", () => {
        const { container } = render(
            <SourceReview
                runId={"run-1" as never}
                corpusRevisionId={"revision-1" as never}
                review={{
                    revision: 1,
                    status: "draft",
                    counts: { accepted: 0, rejected: 0, pending: 1 },
                    sources: [
                        {
                            sourceId: "source-1" as never,
                            canonicalUrl: "https://example.com/report",
                            title: "Independent report",
                            origin: "exa",
                            category: "independent_analysis",
                            decision: "pending",
                            publishedAt: undefined,
                            reason: undefined,
                        },
                    ],
                }}
                onDecide={vi.fn()}
                onApprove={vi.fn()}
            />,
        );

        const masterList = container.querySelector(
            '[data-slot="source-master-list"]',
        );
        expect(masterList).not.toBeNull();
        expect(
            within(masterList as HTMLElement).getByLabelText(
                /Favicon for example\.com/i,
            ),
        ).toBeTruthy();
        expect(
            within(masterList as HTMLElement).getByRole("button", {
                name: /Accept Independent report as accepted/i,
            }),
        ).toBeTruthy();
        expect(
            within(masterList as HTMLElement).getByRole("button", {
                name: /Reject Independent report as rejected/i,
            }),
        ).toBeTruthy();
        expect(
            within(masterList as HTMLElement).getByRole("button", {
                name: /Pending review Independent report as pending/i,
            }),
        ).toBeTruthy();
    });

    it("keeps the first source selected as the active detail", () => {
        render(
            <SourceReview
                runId={"run-1" as never}
                corpusRevisionId={"revision-1" as never}
                review={{
                    revision: 1,
                    status: "draft",
                    counts: { accepted: 1, rejected: 0, pending: 0 },
                    sources: [
                        {
                            sourceId: "source-1" as never,
                            canonicalUrl: "https://example.com/first",
                            title: "First report",
                            origin: "exa",
                            category: "independent_analysis",
                            decision: "accepted",
                            publishedAt: undefined,
                            reason: undefined,
                        },
                        {
                            sourceId: "source-2" as never,
                            canonicalUrl: "https://example.com/second",
                            title: "Second report",
                            origin: "exa",
                            category: "independent_analysis",
                            decision: "accepted",
                            publishedAt: undefined,
                            reason: undefined,
                        },
                    ],
                }}
                onDecide={vi.fn()}
                onApprove={vi.fn()}
            />,
        );

        // First source is the default context shown in the detail until the
        // analyst chooses another row.
        expect(
            screen.getAllByText("https://example.com/first").length,
        ).toBeGreaterThan(0);
        expect(
            screen
                .getByRole("button", {
                    name: /Open First report for review/i,
                })
                .getAttribute("aria-pressed"),
        ).toBe("true");
        expect(
            screen
                .getByRole("button", {
                    name: /Open Second report for review/i,
                })
                .getAttribute("aria-pressed"),
        ).toBe("false");
    });

    it("opens source details by default and lets the analyst inspect a pending preview", () => {
        render(
            <SourceReview
                runId={"run-1" as never}
                corpusRevisionId={"revision-1" as never}
                review={{
                    revision: 1,
                    status: "draft",
                    counts: { accepted: 0, rejected: 0, pending: 1 },
                    sources: [
                        {
                            sourceId: "source-1" as never,
                            canonicalUrl: "https://example.com/report",
                            title: "Independent report",
                            origin: "exa",
                            category: "independent_analysis",
                            decision: "pending",
                            publishedAt: undefined,
                            reason: undefined,
                        },
                    ],
                }}
                onDecide={vi.fn()}
                onApprove={vi.fn()}
            />,
        );

        expect(
            screen
                .getByRole("tab", { name: "Source details" })
                .getAttribute("aria-selected"),
        ).toBe("true");
        fireEvent.click(screen.getByRole("tab", { name: "Preview" }));
        expect(
            screen.getByRole("heading", {
                name: "Open Independent report in a new tab",
            }),
        ).toBeTruthy();
        expect(
            screen.getByRole("link", {
                name: "Open original in a new tab",
            }),
        ).toBeTruthy();
        expect(document.querySelector("iframe")).toBeNull();
        // Source details remain available without losing the calibrated copy.
        fireEvent.click(screen.getByRole("tab", { name: /Source details/i }));
        expect(
            screen.getByText(/This source has not been read yet\./i),
        ).toBeTruthy();
    });

    it("opens selected source detail in a drawer on tablet and mobile", () => {
        responsive.isTabletOrBelow = true;
        responsive.isDesktop = false;

        render(
            <SourceReview
                runId={"run-1" as never}
                corpusRevisionId={"revision-1" as never}
                review={{
                    revision: 1,
                    status: "draft",
                    counts: { accepted: 0, rejected: 0, pending: 1 },
                    sources: [
                        {
                            sourceId: "source-tablet" as never,
                            canonicalUrl: "https://example.com/tablet",
                            title: "Tablet source",
                            origin: "analyst_url",
                            category: "manual",
                            decision: "pending",
                            publishedAt: undefined,
                            reason: undefined,
                        },
                    ],
                }}
                onDecide={vi.fn()}
                onApprove={vi.fn()}
            />,
        );

        fireEvent.click(
            screen.getByRole("button", {
                name: /Open Tablet source for review/i,
            }),
        );
        expect(screen.getByRole("dialog")).toBeTruthy();
        expect(screen.getByText("Source detail")).toBeTruthy();

        responsive.isTabletOrBelow = false;
        responsive.isDesktop = true;
    });

    it("selects the first source arriving through a reactive update", () => {
        const { rerender } = render(
            <SourceReview
                runId={"run-1" as never}
                corpusRevisionId={"revision-1" as never}
                review={{
                    revision: 1,
                    status: "draft",
                    counts: { accepted: 0, rejected: 0, pending: 0 },
                    sources: [],
                }}
                onDecide={vi.fn()}
                onApprove={vi.fn()}
            />,
        );

        rerender(
            <SourceReview
                runId={"run-1" as never}
                corpusRevisionId={"revision-1" as never}
                review={{
                    revision: 1,
                    status: "draft",
                    counts: { accepted: 0, rejected: 0, pending: 1 },
                    sources: [
                        {
                            sourceId: "source-arrived" as never,
                            canonicalUrl: "https://example.com/arrived",
                            title: "Arriving source",
                            origin: "exa",
                            category: "independent_analysis",
                            decision: "pending",
                            publishedAt: undefined,
                            reason: undefined,
                        },
                    ],
                }}
                onDecide={vi.fn()}
                onApprove={vi.fn()}
            />,
        );

        expect(
            screen.getAllByText("https://example.com/arrived").length,
        ).toBeGreaterThan(0);
    });

    it("offers an actionable route recovery when a run query fails", () => {
        const ErrorComponent = RunRoute.options
            .errorComponent as ComponentType<ErrorComponentProps>;
        const reset = vi.fn();

        render(
            <ErrorComponent
                error={new Error("Run query failed")}
                reset={reset}
                info={{ componentStack: "" }}
            />,
        );

        expect(screen.getByRole("alert").textContent).toContain(
            "We couldn’t load this research dossier.",
        );
        expect(screen.queryByText(/Run query failed/i)).toBeNull();
        fireEvent.click(screen.getByRole("button", { name: /Try again/i }));
        expect(invalidate).toHaveBeenCalledOnce();
        expect(reset).not.toHaveBeenCalled();
    });
});
