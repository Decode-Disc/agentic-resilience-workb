import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { expect, test, vi } from "vitest";
import { SourcePreparationStatus } from "@/components/workspace/source-preparation-status";
import { sourcePreparationActionCopy } from "@/lib/presentation/research-copy";

test.each([
    ["work_budget_exhausted", "The source reading allowance has been used."],
    [
        "incident_budget_exhausted",
        "Preparation stopped after repeated service failures.",
    ],
] as const)("explains %s without internal details or promising an unavailable retry", (reason, expected) => {
    const copy = sourcePreparationActionCopy({
        kind: "resume",
        available: false,
        reason,
    });
    expect(copy).toContain(expected);
    expect(copy).toContain("Review the saved readings and original sources");
    expect(copy).not.toMatch(
        /budget_exhausted|provider|SOURCE_|Resume preparation|add a public source/i,
    );
});

const preparation: ComponentProps<
    typeof SourcePreparationStatus
>["preparation"] = {
    preparationId: undefined,
    initialReadingsCompletedAt: undefined,
    proposalPublished: false,
    lastActivityAt: 1000,
    stopCode: undefined,
    pendingComparisons: 0,
    status: "started",
    checked: 50,
    total: 50,
    captured: 41,
    assessed: 41,
    failed: 9,
    remaining: 0,
    excluded: 1,
    canResume: false,
    progress: { phase: "comparison", current: 0, total: 41, updatedAt: 1000 },
};

test("unavailable preparation configuration keeps saved readings actionable without internal diagnostics", () => {
    const copy = sourcePreparationActionCopy({
        kind: "resume",
        available: false,
        reason: "configuration_unavailable",
    });
    expect(copy).toContain("Preparation is currently unavailable.");
    expect(copy).toContain(
        "review the available sources and your source decisions",
    );
    expect(copy).not.toMatch(
        /configuration|SOURCE_|preparation_configuration_invalid|Resume preparation/,
    );
});

test("updates comparison progress instead of leaving the finished reading bar full", () => {
    const view = render(
        <SourcePreparationStatus
            preparation={preparation}
            revisionStatus="draft"
            sources={[]}
        />,
    );
    const progress = screen.getByRole("progressbar", {
        name: "Source comparison progress",
    });
    expect(progress.getAttribute("aria-valuenow")).toBe("0");
    expect(progress.getAttribute("aria-valuemax")).toBe("41");
    view.rerender(
        <SourcePreparationStatus
            preparation={{
                ...preparation,
                progress: {
                    phase: "comparison",
                    current: 6,
                    total: 41,
                    updatedAt: 2000,
                },
            }}
            revisionStatus="draft"
            sources={[]}
        />,
    );
    expect(progress.getAttribute("aria-valuenow")).toBe("6");
    expect(progress.getAttribute("aria-valuetext")).toBe(
        "6 of 41 source comparisons checked",
    );
    expect(
        screen.queryByRole("progressbar", { name: "Source reading progress" }),
    ).toBeNull();
});

test("summarizes available readings and unavailable sources without duplicate assessment counters", () => {
    render(
        <SourcePreparationStatus
            preparation={preparation}
            revisionStatus="draft"
            sources={[]}
        />,
    );
    expect(screen.getByText("41 sources read and assessed")).toBeTruthy();
    expect(screen.getByText("9 unavailable")).toBeTruthy();
    expect(screen.getByText("1 source excluded")).toBeTruthy();
    expect(screen.queryByText("41 of 50 source contents saved")).toBeNull();
    expect(screen.queryByText("41 assessed")).toBeNull();
});

test("retains the distinction between saved content and missing assessment when preparation stops", () => {
    render(
        <SourcePreparationStatus
            preparation={{
                ...preparation,
                status: "blocked",
                checked: 2,
                total: 48,
                captured: 2,
                assessed: 0,
                failed: 2,
                remaining: 46,
                progress: undefined,
            }}
            revisionStatus="draft"
            sources={[]}
        />,
    );
    expect(screen.getByText("No sources assessed yet")).toBeTruthy();
    expect(screen.getByText("2 saved without assessment")).toBeTruthy();
    expect(screen.getByText("2 unavailable")).toBeTruthy();
});

test.each([
    "supplement",
    "proposal",
] as const)("does not show completed reading progress during %s without a measured total", (phase) => {
    render(
        <SourcePreparationStatus
            preparation={{
                ...preparation,
                progress: { phase, updatedAt: 2000 },
            }}
            revisionStatus="draft"
            sources={[]}
        />,
    );
    expect(
        screen.queryByRole("progressbar", { name: "Source reading progress" }),
    ).toBeNull();
    expect(
        screen.getByRole("progressbar").getAttribute("aria-valuenow"),
    ).toBeNull();
});

test("keeps completed and following stages visible when comparisons start at zero", () => {
    render(
        <SourcePreparationStatus
            preparation={preparation}
            revisionStatus="draft"
            sources={[]}
        />,
    );
    expect(screen.getByText("Step 2 of 3")).toBeTruthy();
    expect(
        screen.getByLabelText("Read candidate sources: Complete"),
    ).toBeTruthy();
    expect(screen.getByText("Prepare your proposal")).toBeTruthy();
    expect(
        screen.getByRole("list", { name: "Preparation stages" }),
    ).toBeTruthy();
});

test("keeps the first stage complete while additional sources are read", () => {
    render(
        <SourcePreparationStatus
            preparation={{
                ...preparation,
                initialReadingsCompletedAt: 1000,
                progress: { phase: "reading", updatedAt: 2000 },
            }}
            revisionStatus="draft"
            sources={[]}
        />,
    );
    expect(screen.getByText("Step 2 of 3")).toBeTruthy();
    expect(
        screen.getByLabelText("Read candidate sources: Complete"),
    ).toBeTruthy();
    expect(
        screen.getByText("Reading additional sources using saved results"),
    ).toBeTruthy();
});

test("finishes with a compact review summary and keyboard-accessible preparation details", async () => {
    render(
        <SourcePreparationStatus
            preparation={{
                ...preparation,
                status: "partial",
                proposalPublished: true,
                initialReadingsCompletedAt: 1000,
            }}
            revisionStatus="draft"
            sources={[]}
        />,
    );
    expect(screen.getByText("Ready for review with limitations")).toBeTruthy();
    const details = screen.getByRole("button", {
        name: "View preparation details",
    });
    expect(details.getAttribute("aria-expanded")).toBe("false");
    details.focus();
    fireEvent.click(details);
    expect(details.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Prepare your proposal")).toBeTruthy();
    expect(screen.queryByText(/41 of 50 source contents saved/)).toBeNull();
});

test("collapses after completion without moving the reader or stealing focus", () => {
    const anchor = document.createElement("section");
    const readingAnchorRef = { current: anchor };
    let transientOffset = 0;
    const measure = vi
        .spyOn(anchor, "getBoundingClientRect")
        .mockImplementation(() => {
            const trigger = screen.queryByRole("button", {
                name: /preparation details/,
            });
            const top = !trigger
                ? 100
                : trigger.getAttribute("aria-expanded") === "true"
                  ? 150
                  : -50;
            return {
                top: top + transientOffset,
                bottom: top + transientOffset + 600,
            } as DOMRect;
        });
    const scrolling = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const originalScrollY = Object.getOwnPropertyDescriptor(window, "scrollY");
    Object.defineProperty(window, "scrollY", {
        configurable: true,
        value: 400,
    });
    const readerLink = document.createElement("a");
    readerLink.href = "#reading";
    document.body.append(readerLink);
    readerLink.focus();
    const view = render(
        <SourcePreparationStatus
            preparation={preparation}
            revisionStatus="draft"
            sources={[]}
            readingAnchorRef={readingAnchorRef}
        />,
    );
    transientOffset = 108;
    view.rerender(
        <SourcePreparationStatus
            preparation={preparation}
            revisionStatus="draft"
            sources={[]}
            readingAnchorRef={readingAnchorRef}
        />,
    );
    transientOffset = 0;
    view.rerender(
        <SourcePreparationStatus
            preparation={{
                ...preparation,
                status: "partial",
                proposalPublished: true,
            }}
            revisionStatus="draft"
            sources={[]}
            readingAnchorRef={readingAnchorRef}
        />,
    );
    expect(
        screen
            .getByRole("button", { name: "View preparation details" })
            .getAttribute("aria-expanded"),
    ).toBe("false");
    expect(document.activeElement).toBe(readerLink);
    expect(scrolling).toHaveBeenCalledWith(0, 250);
    readerLink.remove();
    measure.mockRestore();
    scrolling.mockRestore();
    if (originalScrollY)
        Object.defineProperty(window, "scrollY", originalScrollY);
});

test("does not announce review readiness for an interrupted operation that has not published its proposal", () => {
    render(
        <SourcePreparationStatus
            preparation={{
                ...preparation,
                status: "partial",
                proposalPublished: false,
            }}
            revisionStatus="draft"
            sources={[]}
        />,
    );
    expect(screen.getByText("Source preparation interrupted")).toBeTruthy();
    expect(
        screen.getByText(/stopped before the proposal was updated/),
    ).toBeTruthy();
    expect(screen.queryByText("Ready for review with limitations")).toBeNull();
    expect(
        screen.queryByRole("button", { name: "View preparation details" }),
    ).toBeNull();
});

test("keeps a blocked preparation expanded even if a metadata proposal was published", () => {
    render(
        <SourcePreparationStatus
            preparation={{
                ...preparation,
                status: "blocked",
                proposalPublished: true,
                checked: 0,
                assessed: 0,
                captured: 0,
                failed: 0,
                remaining: 50,
                progress: undefined,
            }}
            revisionStatus="draft"
            sources={[]}
        />,
    );
    expect(
        screen.getByRole("alert", { name: "Source preparation interrupted" }),
    ).toBeTruthy();
    expect(screen.queryByText("Ready for your review")).toBeNull();
    expect(
        screen.queryByRole("button", { name: "View preparation details" }),
    ).toBeNull();
});

test("describes unfinished comparisons as stopped work when reviewing a published proposal", () => {
    render(
        <SourcePreparationStatus
            preparation={{
                ...preparation,
                status: "partial",
                proposalPublished: true,
                pendingComparisons: 1,
                progress: { phase: "reading", updatedAt: 2000 },
            }}
            revisionStatus="draft"
            sources={[]}
        />,
    );
    fireEvent.click(
        screen.getByRole("button", { name: "View preparation details" }),
    );
    expect(
        screen.getByText("1 source comparison remains unfinished"),
    ).toBeTruthy();
    expect(
        screen.queryByText("Reading additional sources using saved results"),
    ).toBeNull();
});
