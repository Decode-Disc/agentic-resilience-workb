import type { Id } from "@convex/_generated/dataModel";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { SourceMasterList } from "@/components/workspace/source-master-list";

const testSource = {
    sourceId: "source-1" as Id<"sources">,
    canonicalUrl: "https://sec.gov/report",
    title: "Annual report 10-K",
    origin: "sec" as const,
    category: "regulatory",
    publishedAt: undefined,
    decision: "pending" as const,
    reason: undefined,
};

describe("SourceMasterList", () => {
    test("opens dialog preview on click by default (enableDialogPreview = true)", () => {
        const onSelect = vi.fn();
        render(
            <SourceMasterList
                heading="Candidate sources"
                items={[testSource]}
                total={1}
                reviewStatus="draft"
                onSelect={onSelect}
            />,
        );

        const row = screen.getByRole("button", {
            name: /Open Annual report 10-K for review/i,
        });
        fireEvent.click(row);

        expect(onSelect).toHaveBeenCalledWith("source-1");
        expect(screen.getByRole("dialog")).toBeTruthy();
        expect(screen.getByText("Selected source:")).toBeTruthy();
    });

    test("does not open dialog preview when enableDialogPreview = false", () => {
        const onSelect = vi.fn();
        render(
            <SourceMasterList
                heading="Candidate sources"
                items={[testSource]}
                total={1}
                reviewStatus="draft"
                onSelect={onSelect}
                enableDialogPreview={false}
            />,
        );

        const row = screen.getByRole("button", {
            name: /Open Annual report 10-K for review/i,
        });
        fireEvent.click(row);

        expect(onSelect).toHaveBeenCalledWith("source-1");
        expect(screen.queryByRole("dialog")).toBeNull();
    });
});
