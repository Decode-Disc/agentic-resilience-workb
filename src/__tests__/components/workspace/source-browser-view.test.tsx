import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SourceBrowserView } from "@/components/workspace/source-browser-view";

const { useAction, useQuery } = vi.hoisted(() => ({
    useAction: vi.fn(),
    useQuery: vi.fn(),
}));

vi.mock(import("convex/react"), () => ({ useAction, useQuery }));

const SAMPLE = {
    sourceId: "source-1" as never,
    canonicalUrl: "https://example.com/report",
    title: "Independent report",
    origin: "exa" as const,
    category: "independent_analysis",
    decision: "pending" as const,
    publishedAt: undefined,
    reason: undefined,
};

describe("SourceBrowserView", () => {
    it("maps source context to the external browser destination", () => {
        useAction.mockReturnValue(vi.fn());
        useQuery.mockReturnValue({ dataUrl: "data:image/png;base64,aW1hZ2U=" });
        render(<SourceBrowserView source={SAMPLE} />);

        const link = screen.getByRole("link", {
            name: "Open original",
        }) as HTMLAnchorElement;
        expect(link.getAttribute("href")).toBe("https://example.com/report");
        expect(link.getAttribute("target")).toBe("_blank");
        expect(link.getAttribute("rel")).toContain("noopener");
        expect(
            screen.getByRole("img", { name: "Preview of Independent report" }),
        ).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: "Expand preview" }));
        const previewDialog = screen.getByRole("dialog", {
            name: "Independent report",
        });
        expect(
            within(previewDialog).getByRole("img", {
                name: "Preview of Independent report",
            }),
        ).toBeTruthy();
        expect(
            within(previewDialog).getByText(
                "Preview — for visual reference only",
            ),
        ).toBeTruthy();
        expect(screen.getByLabelText("Source address").textContent).toContain(
            SAMPLE.canonicalUrl,
        );
        expect(document.querySelector("iframe")).toBeNull();
    });
});
