import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BrowserView } from "@/components/ui/browser-view";

const destination = {
    url: "https://example.com/research/report",
    title: "Independent report",
};

describe("BrowserView", () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it("presents a destination for external review without embedding it", () => {
        render(<BrowserView {...destination} />);

        expect(
            screen.getByRole("heading", {
                name: "Open Independent report in a new tab",
            }),
        ).toBeTruthy();
        expect(screen.getByLabelText("Source address").textContent).toContain(
            destination.url,
        );
        expect(
            screen.getByText(
                "Review the original page in a separate browser tab.",
            ),
        ).toBeTruthy();
        expect(document.querySelector("iframe")).toBeNull();
        expect(
            screen.queryByRole("button", { name: /Refresh preview/i }),
        ).toBeNull();
        expect(
            screen.queryByText(/CSP|X-Frame-Options|frame-ancestors/i),
        ).toBeNull();
    });

    it("opens the original destination safely", () => {
        render(<BrowserView {...destination} actionLabel="Open original" />);

        const link = screen.getByRole("link", {
            name: "Open original",
        });
        expect(link.getAttribute("href")).toBe(destination.url);
        expect(link.getAttribute("target")).toBe("_blank");
        expect(link.getAttribute("rel")).toContain("noopener");
        expect(link.getAttribute("rel")).toContain("noreferrer");
    });

    it("announces when the address is copied", async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value: { writeText },
        });

        render(<BrowserView {...destination} />);

        fireEvent.click(screen.getByRole("button", { name: "Copy link" }));

        expect(writeText).toHaveBeenCalledWith(destination.url);
        expect(await screen.findByText("Link copied")).toBeTruthy();
    });
});
