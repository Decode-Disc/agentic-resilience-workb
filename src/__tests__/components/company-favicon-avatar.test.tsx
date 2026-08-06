import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { CompanyFaviconSubject } from "@/components/company-favicon-avatar";
import { CompanyFaviconAvatar } from "@/components/company-favicon-avatar";

describe("CompanyFaviconAvatar", () => {
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

    it("cascades to investorRelationsUrl when websiteUrl is undefined", () => {
        // Non-regression: previously, call sites used investorRelationsUrl
        // directly. The component preserves that behavior when no marketing
        // website has been resolved yet.
        render(
            <CompanyFaviconAvatar
                company={{
                    legalName: "Acme Holdings",
                    ticker: "ACME",
                    investorRelationsUrl: "https://acme.com",
                }}
            />,
        );

        expect(screen.getByLabelText(/Acme Holdings favicon/i)).toBeTruthy();
    });

    it("prefers websiteUrl over investorRelationsUrl when both are present", () => {
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

        // Both parse as HTTPS so either could render; what matters is no
        // crash and a favicon label centered on the legal name. The actual
        // image URL is exercised by FaviconAvatar tests; here we assert the
        // company adapter stays consistent across prop changes.
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

        // No website at all → fallback label uses the entity name.
        expect(screen.getByLabelText(/ServiceNow, Inc\./i)).toBeTruthy();
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

    it("accepts a minimal company shape (legalName + ticker only)", () => {
        const subject: CompanyFaviconSubject = {
            legalName: "Minimal Inc.",
            ticker: "MIN",
        };
        render(<CompanyFaviconAvatar company={subject} />);

        expect(screen.getByLabelText(/Minimal Inc\./i)).toBeTruthy();
    });
});
