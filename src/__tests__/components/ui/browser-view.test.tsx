import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BrowserView } from "@/components/ui/browser-view";
import { Toaster } from "@/components/ui/sonner";

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
        expect(document.querySelector("img")).toBeNull();
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

    it("offers manual copying when clipboard access is denied", async () => {
        Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value: {
                writeText: vi
                    .fn()
                    .mockRejectedValue(
                        new Error("Internal clipboard diagnostic"),
                    ),
            },
        });
        render(
            <>
                <BrowserView {...destination} />
                <Toaster />
            </>,
        );

        fireEvent.click(screen.getByRole("button", { name: "Copy link" }));

        expect(
            await screen.findByText(
                "The link could not be copied. Select the address to copy it manually.",
            ),
        ).toBeTruthy();
        expect(screen.queryByText("Link copied")).toBeNull();
        expect(screen.queryByText("Internal clipboard diagnostic")).toBeNull();
        expect(screen.getByLabelText("Source address").textContent).toContain(
            destination.url,
        );
    });

    it("shows skeleton placeholder when preview is loading", () => {
        render(<BrowserView {...destination} previewState="loading" />);

        // Should not show the external-link heading or iframe
        expect(document.querySelector("iframe")).toBeNull();
        expect(
            screen.queryByRole("heading", {
                name: /Open .+ in a new tab/,
            }),
        ).toBeNull();

        // Should still show the address bar
        expect(screen.getByLabelText("Source address").textContent).toContain(
            destination.url,
        );
    });

    it("shows screenshot with visual-reference label", () => {
        render(
            <BrowserView
                {...destination}
                previewState="screenshot"
                previewDataUrl="data:image/png;base64,fake"
            />,
        );

        // Should show the preview label
        expect(
            screen.getByText("Preview — for visual reference only"),
        ).toBeTruthy();

        // Should show an image
        const img = document.querySelector("img");
        expect(img).toBeTruthy();
        expect(img?.getAttribute("src")).toBe("data:image/png;base64,fake");
        expect(img?.getAttribute("alt")).toContain("Independent report");

        // Should not show external-link heading
        expect(
            screen.queryByRole("heading", {
                name: /Open .+ in a new tab/,
            }),
        ).toBeNull();
        expect(document.querySelector("iframe")).toBeNull();
    });

    it("falls back to external link when preview is unavailable", () => {
        render(<BrowserView {...destination} previewState="unavailable" />);

        // Should show the external-link heading (fallback)
        expect(
            screen.getByRole("heading", {
                name: "Open Independent report in a new tab",
            }),
        ).toBeTruthy();
        expect(
            screen.getByText(
                "Review the original page in a separate browser tab.",
            ),
        ).toBeTruthy();
        expect(document.querySelector("img")).toBeNull();
    });
});
