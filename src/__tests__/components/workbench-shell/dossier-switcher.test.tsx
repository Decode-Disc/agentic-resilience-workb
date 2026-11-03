import { api } from "@convex/_generated/api";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
    mockDossierList,
    mockResearchWorkspace,
} from "@/__tests__/setup/workspace-dossiers";

const { ensureRunCompanyWebsite, navigate, useResponsive } = vi.hoisted(() => ({
    ensureRunCompanyWebsite: vi.fn(async () => ({})),
    navigate: vi.fn(),
    useResponsive: vi.fn(),
}));

vi.mock("convex/react", async () => {
    const { convexReactHarness } = await import(
        "@/__tests__/helpers/convex-react-harness"
    );
    return convexReactHarness.module;
});
vi.mock(import("@/hooks/use-responsive"), () => ({ useResponsive }));
vi.mock("@tanstack/react-router", () => ({
    Link: ({
        children,
        to,
        params,
        search: _search,
        ...props
    }: ComponentProps<"a"> & {
        to: string;
        params?: { runId?: string };
        search?: unknown;
    }) => (
        <a
            href={params?.runId ? to.replace("$runId", params.runId) : to}
            {...props}>
            {children}
        </a>
    ),
    useNavigate: () => navigate,
}));

import { convexReactHarness } from "@/__tests__/helpers/convex-react-harness";
import { DossierSwitcher } from "@/components/workbench-shell/dossier-switcher";

beforeEach(() => {
    ensureRunCompanyWebsite.mockReset();
    navigate.mockReset();
    convexReactHarness.reset();
    mockResearchWorkspace();
    useResponsive.mockReset();
    convexReactHarness
        .action(api.companyResolution.ensureRunCompanyWebsite)
        .uses(ensureRunCompanyWebsite);
    useResponsive.mockReturnValue({ isMobile: false, isDesktop: true });
});

afterEach(() => {
    vi.restoreAllMocks();
});

test("distinguishes same-company dossiers by scope and shows state in the selector", async () => {
    const runs = [1, 2].map((i) => ({
        runId: `run-${i}`,
        company: {
            legalName: "ServiceNow",
            ticker: "NOW",
            cik: "1373715",
            exchange: "NYSE",
            websiteUrl: "https://servicenow.com",
        },
        framingScope:
            i === 1 ? "IT service orchestration" : "Customer case routing",
        lifecycleState: "framing",
        executionStatus: "idle",
        updatedAt: i,
        providerFailures: [],
    }));
    mockDossierList().returns(runs);
    convexReactHarness.query(api.researchRuns.getMine).returns(runs[0]);
    render(<DossierSwitcher activeRunId="run-1" />);
    const trigger = screen.getByRole("button", {
        name: "Switch research dossier",
    });
    expect(trigger.textContent).toContain("Framing");
    fireEvent.click(trigger);
    expect(await screen.findByText("Customer case routing")).toBeTruthy();
});

test("distinguishes loading from the empty state", async () => {
    mockDossierList().returns(undefined);
    const { rerender } = render(<DossierSwitcher />);
    const loading = screen.getByRole("status", {
        name: /Loading research dossiers/i,
    });
    expect(loading.getAttribute("aria-busy")).toBe("true");
    expect(loading.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(1);

    mockDossierList().returns([]);
    rerender(<DossierSwitcher />);
    fireEvent.click(
        screen.getByRole("button", { name: "Switch research dossier" }),
    );
    expect(await screen.findByText(/No research dossiers yet/i)).toBeTruthy();
});

test("skips the owner query when no admitted visitor is available", () => {
    mockDossierList().returns(undefined);
    const { container } = render(<DossierSwitcher enabled={false} />);

    expect(convexReactHarness.module.useQuery.mock.calls.at(-1)?.[1]).toBe(
        "skip",
    );
    expect(container.innerHTML).toBe("");
});

test("backfills one legacy company website without re-resolving known URLs", async () => {
    mockDossierList().returns([
        {
            runId: "legacy-run",
            company: {
                legalName: "ServiceNow, Inc.",
                ticker: "NOW",
                exchange: "NYSE",
                cik: "1373715",
            },
            lifecycleState: "awaiting_source_review",
            executionStatus: "paused",
            updatedAt: 2,
            providerFailures: [],
        },
        {
            runId: "resolved-run",
            company: {
                legalName: "Microsoft Corporation",
                ticker: "MSFT",
                exchange: "NASDAQ",
                cik: "789019",
                websiteUrl: "https://microsoft.com/",
            },
            lifecycleState: "awaiting_source_review",
            executionStatus: "paused",
            updatedAt: 1,
            providerFailures: [],
        },
    ] as never);

    render(<DossierSwitcher />);

    await waitFor(() => {
        expect(ensureRunCompanyWebsite).toHaveBeenCalledWith({
            runId: "legacy-run",
        });
    });
    expect(ensureRunCompanyWebsite).toHaveBeenCalledTimes(1);
});

test("keeps a compact error state when company runs fail", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const runsQuery = mockDossierList();
    runsQuery.throws(new Error("Company runs unavailable"));

    render(<DossierSwitcher />);

    expect(screen.getByRole("alert").textContent).toMatch(
        /Research dossiers are temporarily unavailable/i,
    );
    runsQuery.returns([]);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(
        (
            await screen.findByRole("button", {
                name: "Switch research dossier",
            })
        ).textContent,
    ).toContain("Dossiers");
});
