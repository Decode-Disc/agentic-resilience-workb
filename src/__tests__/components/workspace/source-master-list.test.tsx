import type { Id } from "@convex/_generated/dataModel";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

vi.mock("@/hooks/use-source-preview", () => ({
    useSourcePreview: () => ({ status: "idle" }),
}));

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
    documentKind: "regulatory_annual" as const,
    authorityTier: "regulator_primary" as const,
};

describe("SourceMasterList", () => {
    test.each([
        "keyboard",
        "pointer",
    ] as const)("returns focus to the opened source after %s inspection", (method) => {
        const secondSource = {
            ...testSource,
            sourceId: "source-2" as Id<"sources">,
            title: "Second report",
        };
        render(
            <SourceMasterList
                heading="Candidate sources"
                items={[testSource, secondSource]}
                total={2}
                reviewStatus="draft"
            />,
        );
        const first = screen.getByRole("button", {
            name: /Open Annual report 10-K for review/i,
        });
        const second = screen.getByRole("button", {
            name: /Open Second report for review/i,
        });
        first.focus();
        if (method === "keyboard") {
            second.focus();
            fireEvent.keyDown(second, { key: "Enter" });
        } else fireEvent.click(second);
        const close = within(screen.getByRole("dialog")).getByRole("button", {
            name: /^Close$/,
        });
        close.focus();
        if (method === "keyboard") fireEvent.keyDown(window, { key: "Escape" });
        else fireEvent.click(close);
        expect(document.activeElement).toBe(second);
    });

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
        const dialog = screen.getByRole("dialog");
        expect(
            within(dialog).getByRole("heading", { name: "Annual report 10-K" }),
        ).toBeTruthy();
        expect(
            within(dialog).getByText("Primary regulator", { exact: true }),
        ).toBeTruthy();
        expect(
            within(dialog).getByText("Annual report", { exact: true }),
        ).toBeTruthy();
        expect(
            within(dialog)
                .getByRole("tab", { name: "Source details" })
                .getAttribute("aria-selected"),
        ).toBe("true");
        expect(screen.queryByText("Independent web source")).toBeNull();
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
