import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SourceBrowserView } from "@/components/workspace/source-browser-view";

const { useAction } = vi.hoisted(() => ({
    useAction: vi.fn(),
}));

vi.mock(import("convex/react"), () => ({ useAction }));

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
        render(<SourceBrowserView source={SAMPLE} />);

        const link = screen.getByRole("link", {
            name: "Open original in a new tab",
        }) as HTMLAnchorElement;
        expect(link.getAttribute("href")).toBe("https://example.com/report");
        expect(link.getAttribute("target")).toBe("_blank");
        expect(link.getAttribute("rel")).toContain("noopener");
        expect(
            screen.getByRole("heading", {
                name: "Open Independent report in a new tab",
            }),
        ).toBeTruthy();
        expect(screen.getByLabelText("Source address").textContent).toContain(
            SAMPLE.canonicalUrl,
        );
        expect(document.querySelector("iframe")).toBeNull();
    });
});
