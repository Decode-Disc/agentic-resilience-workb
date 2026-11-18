import { api } from "@convex/_generated/api";
import {
    fireEvent,
    render,
    screen,
    waitFor,
    within,
} from "@testing-library/react";
import { ConvexError } from "convex/values";
import type { ComponentType, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
    claimInvitation,
    confirmCompany,
    navigate,
    preflight,
    searchCompanies,
    submitManualUrl,
    retrySession,
    useAnonymousSession,
} = vi.hoisted(() => ({
    claimInvitation: vi.fn(),
    confirmCompany: vi.fn(),
    navigate: vi.fn(),
    preflight: vi.fn(),
    searchCompanies: vi.fn(),
    submitManualUrl: vi.fn(),
    retrySession: vi.fn(),
    useAnonymousSession: vi.fn(),
}));

vi.mock("@tanstack/react-router", async (importOriginal) => {
    const router =
        await importOriginal<typeof import("@tanstack/react-router")>();
    return { ...router, useNavigate: () => navigate };
});

vi.mock("convex/react", async () => {
    const { convexReactHarness } = await import(
        "@/__tests__/helpers/convex-react-harness"
    );
    return convexReactHarness.module;
});
vi.mock("@/hooks/use-anonymous-session", () => ({ useAnonymousSession }));

import { convexReactHarness } from "@/__tests__/helpers/convex-react-harness";
import { InvitationAccessProvider } from "@/components/workspace/invitation-access-context";
import { StartResearchPage } from "@/components/workspace/start/start-research-page";
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
    fireEvent.click(
        screen.getByRole("button", { name: /Company to investigate/i }),
    );
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
    await screen.findByRole("region", { name: "Confirm company and mandate" });
}

describe("StartResearchPage", () => {
    beforeEach(() => {
        navigate.mockReset();
        preflight.mockReset();
        searchCompanies.mockReset();
        submitManualUrl.mockReset();
        retrySession.mockReset();
        confirmCompany.mockReset();
        claimInvitation.mockReset();
        convexReactHarness.reset();
        convexReactHarness.query(api.workbench.models).returns({
            selectedId: "model-first",
            label: "First model",
            available: true,
            effort: "low",
            effortChoices: ["low", "high"],
            revision: 0,
            choices: [
                {
                    id: "model-first",
                    label: "First model",
                    effort: "low",
                    effortChoices: ["low", "high"],
                },
                {
                    id: "model-second",
                    label: "Second model",
                    effort: "low",
                    effortChoices: ["low", "high"],
                },
            ],
        });
        convexReactHarness
            .query(api.visitors.current)
            .returns({ status: "active" } as never);
        useAnonymousSession.mockReset();
        useAnonymousSession.mockReturnValue({
            isSessionLoading: false,
            isSessionReady: true,
            sessionError: null,
            retrySession,
        });
        convexReactHarness
            .action(api.companyResolution.search)
            .uses(searchCompanies);
        convexReactHarness
            .action(api.companyResolution.preflight)
            .uses(preflight);
        convexReactHarness
            .mutation(api.framing.confirmCompany)
            .uses(confirmCompany);
        convexReactHarness
            .action(api.sourceActions.submitManualUrl)
            .uses(submitManualUrl);
        convexReactHarness.action(api.invitations.claim).uses(claimInvitation);
    });

    it("selects the company picker layer only while it is open", () => {
        renderWithInvitationAccess(<StartResearchPage />);

        const picker = screen.getByTestId("smooth-dropdown-container");
        expect(picker.classList.contains("z-10")).toBe(false);

        fireEvent.click(
            screen.getByRole("button", { name: /Company to investigate/i }),
        );
        expect(picker.classList.contains("z-10")).toBe(true);

        fireEvent.mouseDown(document.body);
        expect(picker.classList.contains("z-10")).toBe(false);
    });

    it("retries anonymous session preparation", () => {
        useAnonymousSession.mockReturnValue({
            isSessionLoading: false,
            isSessionReady: false,
            sessionError: "We couldn't prepare your research workspace.",
            retrySession,
        });

        renderWithInvitationAccess(<StartResearchPage />);

        fireEvent.click(screen.getByRole("button", { name: /Try again/i }));

        expect(retrySession).toHaveBeenCalledOnce();
    });

    it("preserves the draft when the visitor query retries", async () => {
        const consoleError = vi
            .spyOn(console, "error")
            .mockImplementation(() => undefined);
        const visitorQuery = convexReactHarness.query(api.visitors.current);
        visitorQuery.returns({ status: "active" } as never);
        searchCompanies.mockResolvedValue(companyCandidates);
        preflight.mockResolvedValue(resolvedCompany);

        const { rerender } = renderWithInvitationAccess(<StartResearchPage />);

        fireEvent.change(
            screen.getByRole("textbox", { name: /Research request/i }),
            {
                target: { value: "Preserve this analyst draft." },
            },
        );
        await searchAndSelectCompany();

        visitorQuery.throws(new Error("Visitor query failed"));
        rerender(
            <InvitationAccessProvider>
                <StartResearchPage />
            </InvitationAccessProvider>,
        );

        visitorQuery.returns({ status: "active" } as never);
        fireEvent.click(screen.getByRole("button", { name: /Try again/i }));

        expect(
            screen.getByRole("button", {
                name: /Confirm and propose framing/i,
            }),
        ).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: /^Back$/i }));
        expect(
            await screen.findByRole("textbox", { name: /Research request/i }),
        ).toHaveProperty("value", "Preserve this analyst draft.");
        expect(
            screen.getByText("Selected company:").parentElement?.textContent,
        ).toContain("CCC Intelligent Solutions Holdings Inc.");
        consoleError.mockRestore();
    });

    it("keeps the composer open until the user continues after selection", async () => {
        searchCompanies.mockResolvedValue(companyCandidates);
        preflight.mockResolvedValue(resolvedCompany);
        renderWithInvitationAccess(<StartResearchPage />);

        fireEvent.click(
            screen.getByRole("button", { name: /Company to investigate/i }),
        );
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
            screen.queryByRole("button", {
                name: /Confirm and propose framing/i,
            }),
        ).toBeNull();

        fireEvent.change(
            screen.getByRole("textbox", { name: /Research request/i }),
            {
                target: { value: "Investigate orchestration resilience." },
            },
        );
        fireEvent.click(screen.getByRole("button", { name: /^Continue$/i }));

        expect(screen.getByText(/CCCS · NASDAQ/i)).toBeTruthy();
        expect(screen.getByText(/CIK 1818201/i)).toBeTruthy();
        await waitFor(() =>
            expect(screen.queryByLabelText(/Research request/i)).toBeNull(),
        );
        expect(screen.queryByText(/Prepare research|Step 2/i)).toBeNull();
        expect(confirmCompany).not.toHaveBeenCalled();
    });

    it("pages ranked company results without repeating the search action", async () => {
        const rankedCandidates = Array.from({ length: 17 }, (_, index) => ({
            legalName: `Ranked Company ${index + 1}`,
            ticker: `R${index + 1}`,
            exchange: "NASDAQ",
            cik: String(2_000_000 + index),
        }));
        searchCompanies.mockResolvedValue(rankedCandidates);
        renderWithInvitationAccess(<StartResearchPage />);

        fireEvent.click(
            screen.getByRole("button", { name: /Company to investigate/i }),
        );
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
        renderWithInvitationAccess(<StartResearchPage />);

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
        confirmCompany.mockResolvedValue({
            runId: "run-42",
            remainingAnalyses: 2,
        });
        renderWithInvitationAccess(<StartResearchPage />);

        await searchAndSelectCompany("CCCS");

        expect(screen.getByRole("radio", { name: /Balanced/i })).toHaveProperty(
            "checked",
            true,
        );
        const confirmButton = screen.getByRole("button", {
            name: /Confirm and propose framing/i,
        });
        fireEvent.click(confirmButton);
        fireEvent.click(confirmButton);

        await waitFor(() => expect(confirmCompany).toHaveBeenCalledTimes(1));
        expect(confirmCompany).toHaveBeenCalledWith(
            expect.objectContaining({
                preflightId: "preflight-1",
                coveragePreset: "balanced",
            }),
        );
        expect(navigate).toHaveBeenCalledWith({
            to: "/workspace/$runId",
            params: { runId: "run-42" },
            search: { section: "overview" },
        });
    });

    it("allows a coverage preset and optional research angle", async () => {
        searchCompanies.mockResolvedValue(companyCandidates);
        preflight.mockResolvedValue(resolvedCompany);
        confirmCompany.mockResolvedValue({
            runId: "run-43",
            remainingAnalyses: 1,
        });
        renderWithInvitationAccess(<StartResearchPage />);

        fireEvent.change(
            screen.getByRole("textbox", { name: /Research request/i }),
            {
                target: { value: "Test workflow control claims." },
            },
        );
        await searchAndSelectCompany();
        fireEvent.click(
            screen.getByRole("radio", { name: /Independent scrutiny/i }),
        );
        fireEvent.click(
            screen.getByRole("button", {
                name: /Confirm and propose framing/i,
            }),
        );

        await waitFor(() =>
            expect(confirmCompany).toHaveBeenCalledWith(
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
        confirmCompany.mockResolvedValue({
            runId: "run-with-references",
            remainingAnalyses: 1,
        });
        submitManualUrl
            .mockResolvedValueOnce({
                kind: "prepared",
                preparationId: "preparation-1",
                canonicalUrl: "https://example.com/public-report",
                title: "Public report",
                expiresAt: Date.now() + 60_000,
            })
            .mockResolvedValueOnce({
                kind: "prepared",
                preparationId: "preparation-2",
                canonicalUrl: "https://example.com/investor-update",
                title: "Investor update",
                expiresAt: Date.now() + 60_000,
            });
        renderWithInvitationAccess(<StartResearchPage />);

        fireEvent.click(
            screen.getByRole("button", { name: /^Composer tools/ }),
        );
        fireEvent.click(
            screen.getByRole("menuitem", { name: /Attach references/i }),
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
        await waitFor(() =>
            expect(submitManualUrl).toHaveBeenCalledWith(
                expect.objectContaining({
                    url: "https://example.com/public-report",
                    target: expect.objectContaining({
                        kind: "prelaunch",
                    }),
                }),
            ),
        );
        expect(
            screen.getByText("https://example.com/public-report"),
        ).toBeTruthy();

        fireEvent.change(screen.getByLabelText(/Public source link/i), {
            target: { value: "https://example.com/investor-update" },
        });
        fireEvent.click(screen.getByRole("button", { name: /^Add$/i }));
        expect(
            await screen.findByText("https://example.com/investor-update"),
        ).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: /Done/i }));
        expect(
            screen.getByRole("button", {
                name: /Composer tools \(2\)/i,
            }),
        ).toBeTruthy();

        await searchAndSelectCompany("CCCS");
        fireEvent.click(
            screen.getByRole("button", {
                name: /Confirm and propose framing/i,
            }),
        );

        await waitFor(() =>
            expect(confirmCompany).toHaveBeenCalledWith(
                expect.objectContaining({
                    manualSourcePreparationIds: [
                        "preparation-1",
                        "preparation-2",
                    ],
                }),
            ),
        );
    }, 20_000);

    it("keeps one prepared reference when different inputs resolve to the same canonical URL", async () => {
        searchCompanies.mockResolvedValue(companyCandidates);
        preflight.mockResolvedValue(resolvedCompany);
        confirmCompany.mockResolvedValue({
            runId: "run-with-canonical-reference",
            remainingAnalyses: 1,
        });
        submitManualUrl
            .mockResolvedValueOnce({
                kind: "prepared",
                preparationId: "preparation-canonical-1",
                canonicalUrl: "https://example.com/public-report",
                title: "Public report",
                expiresAt: Date.now() + 60_000,
            })
            .mockResolvedValueOnce({
                kind: "prepared",
                preparationId: "preparation-canonical-2",
                canonicalUrl: "https://example.com/public-report",
                title: "Public report",
                expiresAt: Date.now() + 60_000,
            });
        renderWithInvitationAccess(<StartResearchPage />);

        fireEvent.click(
            screen.getByRole("button", { name: /^Composer tools/ }),
        );
        fireEvent.click(
            screen.getByRole("menuitem", { name: /Attach references/i }),
        );
        const references = within(
            await screen.findByRole("dialog", { name: "Add public sources" }),
        );
        for (const url of [
            "https://example.com/public-report#overview",
            "https://example.com/public-report#summary",
        ]) {
            fireEvent.change(references.getByLabelText(/Public source link/i), {
                target: { value: url },
            });
            fireEvent.click(references.getByRole("button", { name: /^Add$/i }));
            await waitFor(() =>
                expect(submitManualUrl).toHaveBeenCalledTimes(
                    url.endsWith("overview") ? 1 : 2,
                ),
            );
        }

        expect(
            screen.getAllByText("https://example.com/public-report"),
        ).toHaveLength(1);
        fireEvent.click(references.getByRole("button", { name: /Done/i }));
        expect(
            screen.getByRole("button", { name: /Composer tools \(1\)/i }),
        ).toBeTruthy();

        await searchAndSelectCompany("CCCS");
        fireEvent.click(
            screen.getByRole("button", {
                name: /Confirm and propose framing/i,
            }),
        );
        await waitFor(() =>
            expect(confirmCompany).toHaveBeenCalledWith(
                expect.objectContaining({
                    manualSourcePreparationIds: ["preparation-canonical-1"],
                }),
            ),
        );
    }, 10_000);

    it("asks the analyst to re-add an expired reference before launch", async () => {
        searchCompanies.mockResolvedValue(companyCandidates);
        preflight.mockResolvedValue(resolvedCompany);
        submitManualUrl.mockResolvedValue({
            kind: "prepared",
            preparationId: "preparation-expired",
            canonicalUrl: "https://example.com/expired-report",
            title: "Expired report",
            expiresAt: Date.now() + 60_000,
        });
        confirmCompany.mockRejectedValue(
            new ConvexError({
                area: "manual_source_intake",
                code: "preparation_expired",
                retryable: false,
                preparationId: "preparation-expired",
            }),
        );
        renderWithInvitationAccess(<StartResearchPage />);

        fireEvent.click(
            screen.getByRole("button", { name: /^Composer tools/ }),
        );
        fireEvent.click(
            screen.getByRole("menuitem", { name: /Attach references/i }),
        );
        fireEvent.change(screen.getByLabelText(/Public source link/i), {
            target: { value: "https://example.com/expired-report" },
        });
        fireEvent.click(screen.getByRole("button", { name: /^Add$/i }));
        await screen.findByText("https://example.com/expired-report");
        fireEvent.click(screen.getByRole("button", { name: /Done/i }));

        await searchAndSelectCompany("CCCS");
        fireEvent.click(
            screen.getByRole("button", {
                name: /Confirm and propose framing/i,
            }),
        );

        expect(
            await screen.findByText(/add this source again before starting/i),
        ).toBeTruthy();
        expect(screen.queryByText(/manual_source_intake|CONVEX/i)).toBeNull();
    });

    it("waits for visitor access before accepting confirmation", async () => {
        const visitor = convexReactHarness.query(api.visitors.current);
        visitor.returns(undefined);
        searchCompanies.mockResolvedValue(companyCandidates);
        preflight.mockResolvedValue(resolvedCompany);
        renderWithInvitationAccess(<StartResearchPage />);
        await searchAndSelectCompany("CCCS");
        const confirm = screen.getByRole("button", {
            name: "Checking access…",
        });
        expect(confirm.hasAttribute("disabled")).toBe(true);
        fireEvent.click(confirm);
        expect(document.getElementById("invitation-code")).toBeNull();
    });

    it("retains the selected research model when confirming the company", async () => {
        searchCompanies.mockResolvedValue(companyCandidates);
        preflight.mockResolvedValue(resolvedCompany);
        confirmCompany.mockResolvedValue({
            runId: "run-selected-model",
            remainingAnalyses: 3,
        });
        renderWithInvitationAccess(<StartResearchPage />);
        fireEvent.click(
            screen.getByRole("button", { name: "Workbench model and effort" }),
        );
        fireEvent.click(
            await screen.findByRole("menuitemradio", { name: "Second model" }),
        );
        await searchAndSelectCompany("CCCS");
        fireEvent.click(
            screen.getByRole("button", {
                name: /Confirm and propose framing/i,
            }),
        );
        await waitFor(() =>
            expect(confirmCompany).toHaveBeenCalledWith(
                expect.objectContaining({
                    modelSelection: { catalogId: "model-second" },
                }),
            ),
        );
    });

    it("asks for an access code only when an anonymous visitor confirms launch", async () => {
        convexReactHarness.query(api.visitors.current).returns(null);
        searchCompanies.mockResolvedValue(companyCandidates);
        preflight.mockResolvedValue(resolvedCompany);
        claimInvitation.mockResolvedValue({
            visitorId: "visitor-1",
            role: "analyst",
        });
        confirmCompany.mockResolvedValue({
            runId: "run-44",
            remainingAnalyses: 2,
        });
        renderWithInvitationAccess(<StartResearchPage />);

        await searchAndSelectCompany("CCCS");
        fireEvent.click(
            screen.getByRole("button", {
                name: /Confirm and propose framing/i,
            }),
        );

        await waitFor(() =>
            expect(document.getElementById("invitation-code")).not.toBeNull(),
        );
        expect(confirmCompany).not.toHaveBeenCalled();

        const accessCodeForm = screen.getByRole("form", {
            name: /Workspace access/i,
        });
        fireEvent.change(within(accessCodeForm).getByRole("textbox"), {
            target: { value: "4207" },
        });
        fireEvent.submit(accessCodeForm);

        await waitFor(() =>
            expect(claimInvitation).toHaveBeenCalledWith({
                code: "4207",
            }),
        );
        await waitFor(() => expect(confirmCompany).toHaveBeenCalledTimes(1));
        expect(navigate).toHaveBeenCalledWith({
            to: "/workspace/$runId",
            params: { runId: "run-44" },
            search: { section: "overview" },
        });
    });

    it("renders lookup errors inline and keeps local upload controls absent", async () => {
        searchCompanies.mockRejectedValue(
            new Error(
                "[CONVEX A(companyResolution:search)] Server Error Uncaught Error: SEC request failed at searchCompaniesWithResolver Called by client",
            ),
        );
        renderWithInvitationAccess(<StartResearchPage />);

        fireEvent.click(
            screen.getByRole("button", { name: /Company to investigate/i }),
        );
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
            screen.getByRole("button", { name: /^Composer tools/ }),
        ).toBeTruthy();
        expect(screen.queryByText(/drop files/i)).toBeNull();
    });

    it("debounces search-as-you-type without clicking Search and ignores 1-character non-numeric queries", async () => {
        searchCompanies.mockResolvedValue(companyCandidates);
        renderWithInvitationAccess(<StartResearchPage />);

        fireEvent.click(
            screen.getByRole("button", { name: /Company to investigate/i }),
        );
        const searchInput = screen.getByRole("textbox", {
            name: /^Company search$/i,
        });

        fireEvent.change(searchInput, { target: { value: "C" } });
        await new Promise((resolve) => setTimeout(resolve, 400));
        expect(searchCompanies).not.toHaveBeenCalled();

        fireEvent.change(searchInput, { target: { value: "CC" } });
        fireEvent.change(searchInput, { target: { value: "CCC" } });
        expect(searchCompanies).not.toHaveBeenCalled();

        await waitFor(
            () =>
                expect(searchCompanies).toHaveBeenCalledWith({
                    query: "CCC",
                }),
            { timeout: 1_500 },
        );
        expect(searchCompanies).toHaveBeenCalledTimes(1);
        expect(
            await screen.findByRole("option", {
                name: /CCC Intelligent Solutions Holdings Inc\..*CCCS.*NASDAQ.*CIK 1818201/i,
            }),
        ).toBeTruthy();
    });

    it("ignores stale search results when the user continues typing", async () => {
        let resolveStaleSearch:
            | ((value: typeof companyCandidates) => void)
            | undefined;
        searchCompanies
            .mockImplementationOnce(
                () =>
                    new Promise((resolve) => {
                        resolveStaleSearch = resolve;
                    }),
            )
            .mockResolvedValueOnce([
                {
                    legalName: "ServiceNow, Inc.",
                    ticker: "NOW",
                    exchange: "NYSE",
                    cik: "1373715",
                },
            ]);
        renderWithInvitationAccess(<StartResearchPage />);

        fireEvent.click(
            screen.getByRole("button", { name: /Company to investigate/i }),
        );
        const searchInput = screen.getByRole("textbox", {
            name: /^Company search$/i,
        });

        fireEvent.change(searchInput, { target: { value: "CC" } });
        fireEvent.click(screen.getByRole("button", { name: /^Search$/i }));
        expect(searchCompanies).toHaveBeenCalledWith({ query: "CC" });

        fireEvent.change(searchInput, { target: { value: "ServiceNow" } });
        await waitFor(
            () =>
                expect(searchCompanies).toHaveBeenCalledWith({
                    query: "ServiceNow",
                }),
            { timeout: 1_500 },
        );

        resolveStaleSearch?.(companyCandidates);
        expect(
            await screen.findByRole("option", {
                name: /ServiceNow, Inc\..*NOW.*NYSE.*CIK 1373715/i,
            }),
        ).toBeTruthy();
        expect(
            screen.queryByRole("option", {
                name: /CCC Intelligent Solutions Holdings Inc\./i,
            }),
        ).toBeNull();
    });
});

describe("StartAnalysisRoute", () => {
    it("renders the approved START entry with live inputs and a labelled illustrative workspace", () => {
        const Component = Route.options.component as ComponentType;
        renderWithInvitationAccess(<Component />);

        expect(
            screen.getByRole("heading", { name: /Start a research dossier/i }),
        ).toBeTruthy();
        expect(screen.getByLabelText(/Research request/i)).toBeTruthy();
        expect(
            screen.getByRole("region", { name: "Suggested research angles" }),
        ).toBeTruthy();
        expect(
            screen.getByRole("button", {
                name: /Open showcase: Who holds the photo-led claim workflow/,
            }),
        ).toBeTruthy();
        expect(
            screen.getByText(/illustrative workspace, not live research/),
        ).toBeTruthy();
        expect(screen.queryByText("Evidence layers")).toBeNull();
    });
});
