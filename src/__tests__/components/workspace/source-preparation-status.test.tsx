import { render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { expect, test } from "vitest";
import { SourcePreparationStatus } from "@/components/workspace/source-preparation-status";

const preparation: ComponentProps<
    typeof SourcePreparationStatus
>["preparation"] = {
    preparationId: undefined,
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
    expect(screen.queryByRole("progressbar")).toBeNull();
});
