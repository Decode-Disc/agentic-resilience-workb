import { Building02Icon } from "@hugeicons/core-free-icons";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockDecodedImages } from "@/__tests__/setup/images";

import { FaviconAvatar, parseFaviconUrl } from "@/components/favicon-avatar";

describe("parseFaviconUrl", () => {
    it("builds a 64px google favicon request from the host", () => {
        const parsed = parseFaviconUrl("https://example.com/report.pdf");

        expect(parsed).not.toBeNull();
        expect(parsed?.hostname).toBe("example.com");
        expect(parsed?.isHttps).toBe(true);
        expect(parsed?.faviconUrl).toContain(
            "https://www.google.com/s2/favicons",
        );
        expect(parsed?.faviconUrl).toContain("domain=example.com");
        expect(parsed?.faviconUrl).toContain("sz=64");
    });

    it("centers on the host and never leaks the path", () => {
        const parsed = parseFaviconUrl(
            "https://reports.example.org/path/to/document.pdf",
        );

        expect(parsed?.hostname).toBe("reports.example.org");
        expect(parsed?.faviconUrl).not.toContain("/path/to/document.pdf");
    });

    it("flags non-https urls as ineligible for a favicon request", () => {
        expect(parseFaviconUrl("ftp://example.com/file")?.isHttps).toBe(false);
    });

    it("returns null when the url cannot be parsed", () => {
        expect(parseFaviconUrl("not a real url")).toBeNull();
    });
});

describe("FaviconAvatar", () => {
    beforeEach(mockDecodedImages);
    afterEach(() => vi.unstubAllGlobals());

    it("exposes a clear accessible name on the host favicon avatar", () => {
        render(<FaviconAvatar canonicalUrl="https://example.com/report" />);

        expect(screen.getByLabelText(/Favicon for example\.com/i)).toBeTruthy();
    });

    it("falls back to a link icon when the url is not https", () => {
        render(<FaviconAvatar canonicalUrl="ftp://example.com/file" />);

        expect(
            screen.getByLabelText(/Link icon for example\.com/i),
        ).toBeTruthy();
    });

    it("fails over to a generic source label when the url cannot be parsed", () => {
        render(<FaviconAvatar canonicalUrl="not a real url" />);

        expect(screen.getByLabelText(/Source link/i)).toBeTruthy();
    });

    it("centers the accessible label on the entity name when provided", () => {
        render(
            <FaviconAvatar
                canonicalUrl="https://example.com/report"
                entityName="Example Holdings Ltd"
            />,
        );

        expect(
            screen.getByLabelText(/Example Holdings Ltd favicon/i),
        ).toBeTruthy();
    });

    it("renders a custom fallback icon and label when the url is unparseable", () => {
        render(
            <FaviconAvatar
                canonicalUrl=""
                entityName="Example Holdings Ltd"
                fallbackIcon={Building02Icon}
            />,
        );

        // Custom entity label wins for unparseable urls.
        expect(screen.getByLabelText(/Example Holdings Ltd/i)).toBeTruthy();
    });

    it("tries the new identity after the previous favicon fails", async () => {
        const { rerender } = render(
            <FaviconAvatar canonicalUrl="https://first.example/report" />,
        );
        fireEvent.error(
            await screen.findByRole("img", {
                name: "Favicon for first.example",
            }),
        );
        expect(
            screen.getByLabelText("Link icon for first.example"),
        ).toBeTruthy();
        expect(screen.queryByRole("img")).toBeNull();

        rerender(
            <FaviconAvatar canonicalUrl="https://second.example/report" />,
        );
        const image = await screen.findByRole("img", {
            name: "Favicon for second.example",
        });
        expect(
            new URL(image.getAttribute("src") ?? "").searchParams.get("domain"),
        ).toBe("second.example");
        expect(
            screen.queryByLabelText("Link icon for first.example"),
        ).toBeNull();

        rerender(<FaviconAvatar canonicalUrl="https://first.example/report" />);
        expect(
            await screen.findByRole("img", {
                name: "Favicon for first.example",
            }),
        ).toBeTruthy();
    });
});
