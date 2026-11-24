import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockDecodedImages } from "@/__tests__/setup/images";
import { CompanyFaviconAvatar } from "@/components/company-favicon-avatar";

describe("CompanyFaviconAvatar", () => {
    beforeEach(mockDecodedImages);
    afterEach(() => vi.unstubAllGlobals());

    it("delegates to FaviconAvatar with the website url when present", () => {
        render(
            <CompanyFaviconAvatar
                company={{
                    legalName: "Acme Holdings",
                    ticker: "ACME",
                    websiteUrl: "https://acme.com",
                }}
            />,
        );

        expect(screen.getByLabelText(/Acme Holdings favicon/i)).toBeTruthy();
    });

    it("cascades to investorRelationsUrl when websiteUrl is undefined", async () => {
        render(
            <CompanyFaviconAvatar
                company={{
                    legalName: "Acme Holdings",
                    ticker: "ACME",
                    investorRelationsUrl: "https://investors.acme.example/",
                }}
            />,
        );

        expect(screen.getByLabelText(/Acme Holdings favicon/i)).toBeTruthy();
        const image = await screen.findByRole("img", {
            name: "Favicon for investors.acme.example",
        });
        expect(
            new URL(image.getAttribute("src") ?? "").searchParams.get("domain"),
        ).toBe("investors.acme.example");
    });

    it("prefers websiteUrl over investorRelationsUrl when both are present", async () => {
        const { rerender } = render(
            <CompanyFaviconAvatar
                company={{
                    legalName: "ServiceNow, Inc.",
                    ticker: "NOW",
                    websiteUrl: "https://www.servicenow.com",
                    investorRelationsUrl: "https://investor.servicenow.com",
                }}
            />,
        );

        const image = await screen.findByRole("img", {
            name: "Favicon for www.servicenow.com",
        });
        expect(
            new URL(image.getAttribute("src") ?? "").searchParams.get("domain"),
        ).toBe("www.servicenow.com");
        expect(
            screen.getByLabelText(/ServiceNow, Inc\. favicon/i),
        ).toBeTruthy();

        rerender(
            <CompanyFaviconAvatar
                company={{
                    legalName: "ServiceNow, Inc.",
                    ticker: "NOW",
                }}
            />,
        );

        expect(screen.getByLabelText(/ServiceNow, Inc\./i)).toBeTruthy();
        expect(screen.queryByRole("img")).toBeNull();
    });

    it("falls back to the building icon when no URL of any kind is set", () => {
        render(
            <CompanyFaviconAvatar
                company={{
                    legalName: "Stealth Co.",
                    ticker: "STH",
                }}
            />,
        );

        expect(screen.getByLabelText(/Stealth Co\./i)).toBeTruthy();
    });

    it("renders with size xs when requested", () => {
        render(
            <CompanyFaviconAvatar
                company={{
                    legalName: "Tiny Corp",
                    ticker: "TINY",
                    websiteUrl: "https://tiny.example",
                }}
                size="xs"
            />,
        );

        const avatar = screen.getByLabelText(/Tiny Corp favicon/i);
        expect(avatar).toBeTruthy();
        expect(avatar.getAttribute("data-size")).toBe("xs");
    });
});
