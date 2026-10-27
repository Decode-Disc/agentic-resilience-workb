import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { CompanyResolutionCard } from "@/components/workspace/company-resolution-card";

test("company confirmation retains the website favicon rather than a ticker tile", () => {
    render(
        <CompanyResolutionCard
            company={{
                legalName: "Example Holdings",
                ticker: "EXM",
                exchange: "NASDAQ",
                cik: "123",
                websiteUrl: "https://example.com",
            }}
        />,
    );
    expect(screen.getByLabelText("Example Holdings favicon")).toBeTruthy();
});
