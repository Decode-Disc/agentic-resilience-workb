import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import type { ComponentType, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
    claimInvitation,
    confirmAndStart,
    navigate,
    preflight,
    searchCompanies,
    useAction,
    useQuery,
} = vi.hoisted(() => ({
    claimInvitation: vi.fn(),
    confirmAndStart: vi.fn(),
    navigate: vi.fn(),
    preflight: vi.fn(),
    searchCompanies: vi.fn(),
    useAction: vi.fn(),
    useQuery: vi.fn(),
}));

vi.mock("@tanstack/react-router", async (importOriginal) => {
    const router =
        await importOriginal<typeof import("@tanstack/react-router")>();
    return { ...router, useNavigate: () => navigate };
});

vi.mock("convex/react", () => ({ useAction, useQuery }));
vi.mock("@/hooks/use-anonymous-session", () => ({
    useAnonymousSession: () => ({
        isSessionLoading: false,
        isSessionReady: true,
        sessionError: null,
    }),
}));

import { ResearchComposer } from "@/components/workspace/research-composer";
import { InvitationAccessProvider } from "@/components/workspace/invitation-access-context";
import { Route } from "@/routes/workspace/start";

const resolvedCompany = {
    preflightId: "preflight-1",
    company: {
        legalName: "CCC Intelligent Solutions Holdings Inc.",
        ticker: "CCCS",
        exchange: "NASDAQ",
        cik: "1818201",
    },
    expiresAt: Date.now() + 60_000,
};
const companyCandidates = [resolvedCompany.company];

function renderWithInvitationAccess(component: ReactNode) {
    return render(
        <InvitationAccessProvider>{component}</InvitationAccessProvider>,
    );
}

async function searchAndSelectCompany(query = "CCC") {
    fireEvent.change(
        screen.getByRole("textbox", { name: /^Company search$/i }),
        {
            target: { value: query },
        },
    );
    fireEvent.click(screen.getByRole("button", { name: /^Search$/i }));
    const candidate = await screen.findByRole("option", {
        name: /CCC Intelligent Solutions Holdings Inc\..*CCCS.*NASDAQ.*CIK 1818201/i,
    });
    fireEvent.click(candidate);
    fireEvent.click(await screen.findByRole("button", { name: /^Continue$/i }));
    await screen.findByRole("button", { name: /Confirm and start/i });
}

describe("ResearchComposer", () => {
    beforeEach(() => {
        navigate.mockReset();
        preflight.mockReset();
        searchCompanies.mockReset();
        confirmAndStart.mockReset();
        claimInvitation.mockReset();
        useAction.mockReset();
        useQuery.mockReset();
        useQuery.mockReturnValue({ status: "active" });
        useAction.mockImplementation((action) => {
            switch (getFunctionName(action)) {
                case "companyResolution:search":
                    return searchCompanies;
                case "companyResolution:preflight":
                    return preflight;
                case "researchLaunch:confirmAndStart":
                    return confirmAndStart;
                case "invitations:claim":
                    return claimInvitation;
                default:
                    throw new Error(
                        `Unexpected action: ${getFunctionName(action)}`,
                    );
            }
        });
    });

    it("selects the company picker layer only while it is open", () => {
        renderWithInvitationAccess(<ResearchComposer />);

        const picker = screen.getByTestId("smooth-dropdown-container");
        expect(picker.classList.contains("z-10")).toBe(false);

        fireEvent.click(
            screen.getByRole("button", { name: /Company to investigate/i }),
        );
        expect(picker.classList.contains("z-10")).toBe(true);

        fireEvent.mouseDown(document.body);
        expect(picker.classList.contains("z-10")).toBe(false);
    });

    it("keeps the composer open until the user continues after selection", async () => {
        searchCompanies.mockResolvedValue(companyCandidates);
        preflight.mockResolvedValue(resolvedCompany);
        renderWithInvitationAccess(<ResearchComposer />);

        fireEvent.change(
            screen.getByRole("textbox", { name: /^Company search$/i }),
            {
                target: { value: "CCC" },
            },
        );
        fireEvent.submit(screen.getByRole("form", { name: /Company lookup/i }));

        await waitFor(() =>
            expect(searchCompanies).toHaveBeenCalledWith({ query: "CCC" }),
        );
        const candidate = await screen.findByRole("option", {
            name: /CCC Intelligent Solutions Holdings Inc\..*CCCS.*NASDAQ.*CIK 1818201/i,
        });
        expect(preflight).not.toHaveBeenCalled();
        expect(screen.getByLabelText(/Research request/i)).toBeTruthy();

        fireEvent.click(candidate);

        await waitFor(() =>
            expect(preflight).toHaveBeenCalledWith({ cik: "1818201" }),
        );

        expect(screen.getByLabelText(/Research request/i)).toBeTruthy();
        expect(
            screen.getByText("Selected company:").parentElement?.textContent,
        ).toContain("CCC Intelligent Solutions Holdings Inc.");
        expect(
            screen.queryByRole("button", { name: /Confirm and start/i }),
        ).toBeNull();

        fireEvent.change(screen.getByLabelText(/Research angle/i), {
            target: { value: "Investigate orchestration resilience." },
        });
        fireEvent.click(screen.getByRole("button", { name: /^Continue$/i }));

        expect(screen.getByText(/CCCS · NASDAQ/i)).toBeTruthy();
        expect(screen.getByText(/CIK 1818201/i)).toBeTruthy();
        await waitFor(() =>
            expect(screen.queryByLabelText(/Research request/i)).toBeNull(),
        );
        expect(screen.queryByText(/Prepare research|Step 2/i)).toBeNull();
        expect(confirmAndStart).not.toHaveBeenCalled();
    });

    it("pages ranked company results without repeating the search action", async () => {
        const rankedCandidates = Array.from({ length: 17 }, (_, index) => ({
            legalName: `Ranked Company ${index + 1}`,
            ticker: `R${index + 1}`,
            exchange: "NASDAQ",
            cik: String(2_000_000 + index),
        }));
        searchCompanies.mockResolvedValue(rankedCandidates);
        renderWithInvitationAccess(<ResearchComposer />);

        fireEvent.change(
            screen.getByRole("textbox", { name: /^Company search$/i }),
            { target: { value: "ranked" } },
        );
        fireEvent.click(screen.getByRole("button", { name: /^Search$/i }));

        expect(await screen.findAllByRole("option")).toHaveLength(5);
        fireEvent.click(screen.getByRole("button", { name: "Page 2" }));

        expect(
            await screen.findByRole("option", {
                name: /Ranked Company 6.*R6.*NASDAQ/i,
            }),
        ).toBeTruthy();
        expect(screen.getAllByRole("option")).toHaveLength(5);
        expect(searchCompanies).toHaveBeenCalledTimes(1);
    });

    it("returns to the composer with the selected company shown as name and ticker once", async () => {
        searchCompanies.mockResolvedValue(companyCandidates);
        preflight.mockResolvedValue(resolvedCompany);
        renderWithInvitationAccess(<ResearchComposer />);

        await searchAndSelectCompany();
        fireEvent.click(screen.getByRole("button", { name: /^Back$/i }));

        expect(await screen.findByLabelText(/Research request/i)).toBeTruthy();
        const trigger = screen.getByRole("button", {
            name: /CCC Intelligent Solutions Holdings Inc\./i,
        });
        expect(
            trigger.textContent?.match(
                /CCC Intelligent Solutions Holdings Inc\./g,
            ),
        ).toHaveLength(1);
        expect(trigger.textContent?.match(/CCCS/g)).toHaveLength(1);

        const badge = screen.getByText("Selected company:").parentElement;
        expect(badge?.textContent).toContain(
            "CCC Intelligent Solutions Holdings Inc.",
        );
        expect(badge?.textContent?.match(/CCCS/g)).toHaveLength(1);
    });

    it("defaults to Balanced and launches once with the real run id", async () => {
        searchCompanies.mockResolvedValue(companyCandidates);
        preflight.mockResolvedValue(resolvedCompany);
        confirmAndStart.mockResolvedValue({
            runId: "run-42",
            remainingAnalyses: 2,
        });
        renderWithInvitationAccess(<ResearchComposer />);

        await searchAndSelectCompany("CCCS");

        expect(screen.getByRole("radio", { name: /Balanced/i })).toHaveProperty(
            "checked",
            true,
        );
        const confirmButton = screen.getByRole("button", {
            name: /Confirm and start/i,
        });
        fireEvent.click(confirmButton);
        fireEvent.click(confirmButton);

        await waitFor(() => expect(confirmAndStart).toHaveBeenCalledTimes(1));
        expect(confirmAndStart).toHaveBeenCalledWith(
            expect.objectContaining({
                preflightId: "preflight-1",
                coveragePreset: "balanced",
            }),
        );
        expect(navigate).toHaveBeenCalledWith({
            to: "/workspace/$runId",
            params: { runId: "run-42" },
            search: { section: "progress" },
        });
    });

    it("allows a coverage preset and optional research angle", async () => {
        searchCompanies.mockResolvedValue(companyCandidates);
        preflight.mockResolvedValue(resolvedCompany);
        confirmAndStart.mockResolvedValue({
            runId: "run-43",
            remainingAnalyses: 1,
        });
        renderWithInvitationAccess(<ResearchComposer />);

        fireEvent.change(screen.getByLabelText(/Research angle/i), {
            target: { value: "Test workflow control claims." },
        });
        await searchAndSelectCompany();
        fireEvent.click(
            screen.getByRole("radio", { name: /Independent scrutiny/i }),
        );
        fireEvent.click(
            screen.getByRole("button", { name: /Confirm and start/i }),
        );

        await waitFor(() =>
            expect(confirmAndStart).toHaveBeenCalledWith(
                expect.objectContaining({
                    coveragePreset: "independent_scrutiny",
                    researchAngle: "Test workflow control claims.",
                }),
            ),
        );
    });

    it("collects public references from the toolbar and includes them at launch", async () => {
        searchCompanies.mockResolvedValue(companyCandidates);
        preflight.mockResolvedValue(resolvedCompany);
        confirmAndStart.mockResolvedValue({
            runId: "run-with-references",
            remainingAnalyses: 1,
        });
        renderWithInvitationAccess(<ResearchComposer />);

        fireEvent.click(
            screen.getByRole("button", { name: /Attach references/i }),
        );
        expect(
            await screen.findByRole("heading", {
                name: /Add public sources/i,
            }),
        ).toBeTruthy();

        fireEvent.change(screen.getByLabelText(/Public source link/i), {
            target: { value: "http://example.com/private-report" },
        });
        fireEvent.click(screen.getByRole("button", { name: /^Add$/i }));
        expect((await screen.findByRole("alert")).textContent).toMatch(
            /beginning with https:\/\//i,
        );

        fireEvent.change(screen.getByLabelText(/Public source link/i), {
            target: { value: "https://example.com/public-report" },
        });
        fireEvent.click(screen.getByRole("button", { name: /^Add$/i }));
        expect(
            screen.getByText("https://example.com/public-report"),
        ).toBeTruthy();

        fireEvent.change(screen.getByLabelText(/Public source link/i), {
            target: { value: "https://example.com/investor-update" },
        });
        fireEvent.click(screen.getByRole("button", { name: /^Add$/i }));
        expect(
            screen.getByText("https://example.com/investor-update"),
        ).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: /Done/i }));
        expect(
            screen.getByRole("button", {
                name: /Attach references \(2\)/i,
            }),
        ).toBeTruthy();

        await searchAndSelectCompany("CCCS");
        fireEvent.click(
            screen.getByRole("button", { name: /Confirm and start/i }),
        );

        await waitFor(() =>
            expect(confirmAndStart).toHaveBeenCalledWith(
                expect.objectContaining({
                    manualSourceUrls: [
                        "https://example.com/public-report",
                        "https://example.com/investor-update",
                    ],
                }),
            ),
        );
    }, 10_000);

    it("asks for an access code only when an anonymous visitor confirms launch", async () => {
        useQuery.mockReturnValue(null);
        searchCompanies.mockResolvedValue(companyCandidates);
        preflight.mockResolvedValue(resolvedCompany);
        claimInvitation.mockResolvedValue({
            visitorId: "visitor-1",
            role: "analyst",
        });
        confirmAndStart.mockResolvedValue({
            runId: "run-44",
            remainingAnalyses: 2,
        });
        renderWithInvitationAccess(<ResearchComposer />);

        await searchAndSelectCompany("CCCS");
        fireEvent.click(
            screen.getByRole("button", { name: /Confirm and start/i }),
        );

        expect(
            await screen.findByRole("heading", {
                name: /Protected access/i,
            }),
        ).toBeTruthy();
        expect(confirmAndStart).not.toHaveBeenCalled();

        fireEvent.change(screen.getByLabelText(/Access code/i), {
            target: { value: "4207" },
        });
        fireEvent.submit(
            screen.getByRole("form", { name: /Workspace access/i }),
        );

        await waitFor(() =>
            expect(claimInvitation).toHaveBeenCalledWith({
                code: "4207",
            }),
        );
        await waitFor(() => expect(confirmAndStart).toHaveBeenCalledTimes(1));
        expect(navigate).toHaveBeenCalledWith({
            to: "/workspace/$runId",
            params: { runId: "run-44" },
            search: { section: "progress" },
        });
    });

    it("renders lookup errors inline and keeps local upload controls absent", async () => {
        searchCompanies.mockRejectedValue(
            new Error(
                "[CONVEX A(companyResolution:search)] Server Error Uncaught Error: SEC request failed at searchCompaniesWithResolver Called by client",
            ),
        );
        renderWithInvitationAccess(<ResearchComposer />);

        fireEvent.change(
            screen.getByRole("textbox", { name: /^Company search$/i }),
            {
                target: { value: "unknown" },
            },
        );
        fireEvent.click(screen.getByRole("button", { name: /^Search$/i }));

        expect(
            await screen.findByText(
                /We couldn't search for companies\. Try again\./i,
            ),
        ).toBeTruthy();
        expect(screen.queryByText(/\[CONVEX A\(/i)).toBeNull();
        expect(
            screen.getByRole("button", { name: /Attach references/i }),
        ).toBeTruthy();
        expect(screen.queryByText(/drop files/i)).toBeNull();
    });
});

describe("StartAnalysisRoute", () => {
    it("preserves the established dossier composition around live launch", () => {
        const Component = Route.options.component as ComponentType;
        renderWithInvitationAccess(<Component />);

        expect(
            screen.getByRole("heading", { name: /Start a research dossier/i }),
        ).toBeTruthy();
        expect(screen.getByLabelText(/Research request/i)).toBeTruthy();
        expect(screen.getByText("Evidence layers")).toBeTruthy();
        expect(screen.getByText("SEC filings")).toBeTruthy();
        expect(screen.getByText("Investor context")).toBeTruthy();
        expect(screen.getByText("Source discovery")).toBeTruthy();
        expect(screen.getAllByRole("switch")).toHaveLength(5);
    });
});
