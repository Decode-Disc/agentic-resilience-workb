import { api } from "@convex/_generated/api";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

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
import { AnalyzedCompanyList } from "@/components/workbench-shell/analyzed-company-list";

beforeEach(() => {
    ensureRunCompanyWebsite.mockReset();
    navigate.mockReset();
    convexReactHarness.reset();
    useResponsive.mockReset();
    convexReactHarness
        .action(api.companyResolution.ensureRunCompanyWebsite)
        .uses(ensureRunCompanyWebsite);
    useResponsive.mockReturnValue({ isMobile: false, isDesktop: true });
});

afterEach(() => {
    vi.restoreAllMocks();
});

test("keeps horizontal company navigation on desktop", () => {
    convexReactHarness.query(api.researchRuns.listMine).returns([
        {
            runId: "run-1",
            company: {
                legalName: "CCC Intelligent Solutions Holdings Inc.",
                ticker: "CCCS",
                exchange: "NASDAQ",
                cik: "1818201",
            },
            lifecycleState: "awaiting_source_review",
            executionStatus: "paused",
            updatedAt: 2,
            providerFailures: [],
        },
        {
            runId: "run-2",
            company: {
                legalName: "ServiceNow Inc.",
                ticker: "NOW",
                exchange: "NYSE",
                cik: "1373715",
            },
            lifecycleState: "discovering_sources",
            executionStatus: "running",
            updatedAt: 1,
            providerFailures: [],
        },
    ] as never);

    render(<AnalyzedCompanyList activeRunId="run-1" />);

    const navigation = screen.getByRole("navigation", {
        name: /Analyzed companies/i,
    });
    expect(navigation).toBeTruthy();
    expect(screen.queryByText(/Mock data/i)).toBeNull();
    const activeCompany = screen.getByRole("link", {
        name: /CCC Intelligent Solutions.*CCCS/i,
    });
    expect(activeCompany).toHaveProperty(
        "href",
        "http://localhost:3000/workspace/run-1",
    );
    expect(activeCompany.getAttribute("aria-current")).toBe("page");
    expect(
        screen.getByRole("link", { name: /ServiceNow.*NOW/i }),
    ).toHaveProperty("href", "http://localhost:3000/workspace/run-2");
    expect(screen.getAllByRole("separator")).toHaveLength(1);
    expect(
        screen.getByRole("button", { name: /Go to dossiers/i }),
    ).toHaveProperty("href", "http://localhost:3000/workspace/dossiers");
});

test("keeps the compact company menu on mobile", async () => {
    useResponsive.mockReturnValue({ isMobile: true, isDesktop: false });
    convexReactHarness.query(api.researchRuns.listMine).returns([
        {
            runId: "run-1",
            company: {
                legalName: "CCC Intelligent Solutions Holdings Inc.",
                ticker: "CCCS",
                exchange: "NASDAQ",
                cik: "1818201",
            },
            lifecycleState: "awaiting_source_review",
            executionStatus: "paused",
            updatedAt: 2,
            providerFailures: [],
        },
        {
            runId: "run-2",
            company: {
                legalName: "ServiceNow Inc.",
                ticker: "NOW",
                exchange: "NYSE",
                cik: "1373715",
            },
            lifecycleState: "discovering_sources",
            executionStatus: "running",
            updatedAt: 1,
            providerFailures: [],
        },
    ] as never);

    render(<AnalyzedCompanyList activeRunId="run-1" />);

    const trigger = screen.getByRole("button", {
        name: /CCC Intelligent Solutions/i,
    });
    expect(
        screen.queryByRole("navigation", { name: /Analyzed companies/i }),
    ).toBeNull();

    fireEvent.click(trigger);
    fireEvent.click(
        await screen.findByRole("button", { name: /ServiceNow.*NOW/i }),
    );

    expect(navigate).toHaveBeenCalledWith({
        to: "/workspace/$runId",
        params: { runId: "run-2" },
        search: { section: "progress" },
    });
    expect(screen.queryByText(/Mock data/i)).toBeNull();
});

test("distinguishes loading from the empty state", () => {
    convexReactHarness.query(api.researchRuns.listMine).returns(undefined);
    const { rerender } = render(<AnalyzedCompanyList />);
    expect(screen.getByLabelText(/Loading research dossiers/i)).toBeTruthy();

    convexReactHarness.query(api.researchRuns.listMine).returns([]);
    rerender(<AnalyzedCompanyList />);
    expect(screen.getByText(/No research dossiers yet/i)).toBeTruthy();
});

test("skips the owner query when no admitted visitor is available", () => {
    convexReactHarness.query(api.researchRuns.listMine).returns(undefined);
    const { container } = render(<AnalyzedCompanyList enabled={false} />);

    expect(convexReactHarness.module.useQuery.mock.calls.at(-1)?.[1]).toBe(
        "skip",
    );
    expect(container.innerHTML).toBe("");
});

test("backfills one legacy company website without re-resolving known URLs", async () => {
    convexReactHarness.query(api.researchRuns.listMine).returns([
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

    render(<AnalyzedCompanyList />);

    await waitFor(() => {
        expect(ensureRunCompanyWebsite).toHaveBeenCalledWith({
            runId: "legacy-run",
        });
    });
    expect(ensureRunCompanyWebsite).toHaveBeenCalledTimes(1);
});

test("keeps a compact error state when company runs fail", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const runsQuery = convexReactHarness.query(api.researchRuns.listMine);
    runsQuery.throws(new Error("Company runs unavailable"));

    render(<AnalyzedCompanyList />);

    expect(screen.getByRole("alert").textContent).toMatch(
        /Research dossiers are temporarily unavailable/i,
    );
    runsQuery.returns([]);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(screen.getByText("No research dossiers yet")).toBeTruthy();
});
