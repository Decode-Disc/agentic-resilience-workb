import { api } from "@convex/_generated/api";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }));

vi.mock("convex/react", async () => {
    const { convexReactHarness } = await import(
        "@/__tests__/helpers/convex-react-harness"
    );
    return convexReactHarness.module;
});
vi.mock("@tanstack/react-router", () => ({
    useNavigate: () => navigate,
    Link: ({ children, ...props }: React.ComponentProps<"a">) => (
        <a {...props}>{children}</a>
    ),
}));

import { convexReactHarness } from "@/__tests__/helpers/convex-react-harness";
import { RunRouteComponent } from "@/components/workspace/run-route-component";

beforeEach(() => {
    convexReactHarness.reset();
    convexReactHarness.query(api.evidenceMatrix.getSummary).returns(undefined);
    navigate.mockReset();
    convexReactHarness.query(api.researchRuns.listMyEvents).returns([]);
});

test("opens inventory from the current workspace without starting research", () => {
    convexReactHarness.query(api.researchRuns.getMine).returns({
        runId: "run-1",
        company: {
            legalName: "Example Corp",
            ticker: "EXM",
            exchange: "NASDAQ",
            cik: "123",
        },
        lifecycleState: "evidence_ready",
        executionStatus: "idle",
        providerFailures: [],
    });
    convexReactHarness
        .query(api.evidenceMatrix.getSummary)
        .returns({ claimCount: 4 });
    const onInventoryOpenChange = vi.fn();
    render(
        <RunRouteComponent
            runId={"run-1" as never}
            section="overview"
            onInventoryOpenChange={onInventoryOpenChange}
        />,
    );
    const trigger = screen.getByRole("button", {
        name: "Open evidence inventory",
    });
    // Inventory opens from the section bar rather than floating over the content.
    expect(trigger.closest("[data-workspace-bar]")).not.toBeNull();
    expect(trigger.textContent).toContain("4");
    fireEvent.click(trigger);
    expect(onInventoryOpenChange).toHaveBeenCalledWith(true);
    // The workspace route owns no mutation: the harness rejects any unconfigured call.
    expect(navigate).not.toHaveBeenCalled();
});

test("does not turn unavailable investigation into an analytical outcome", () => {
    convexReactHarness.query(api.researchRuns.getMine).returns({
        runId: "run-1",
        company: {
            legalName: "Example Corp",
            ticker: "EXM",
            exchange: "NASDAQ",
            cik: "123",
        },
        lifecycleState: "evidence_ready",
        executionStatus: "idle",
        providerFailures: [],
    });
    render(
        <RunRouteComponent
            runId={"run-1" as never}
            section="investigation"
            subsection="review"
        />,
    );
    expect(
        screen.getByRole("heading", {
            name: "Investigation is not available yet",
        }),
    ).toBeTruthy();
    expect(
        screen.queryByText(
            /justified insufficiency|no retained appraisal|not established/i,
        ),
    ).toBeNull();
});

test("does not advertise manual source intake after corpus approval", () => {
    convexReactHarness.query(api.researchRuns.getMine).returns({
        runId: "run-1",
        company: {
            legalName: "Example Corp",
            ticker: "EXM",
            exchange: "NASDAQ",
            cik: "123",
        },
        lifecycleState: "corpus_approved",
        executionStatus: "idle",
        activeCorpusRevisionId: "revision-1",
        providerFailures: [
            {
                service: "exa",
                operation: "search",
                errorCode: "exa_not_configured",
                occurredAt: 1,
            },
        ],
        updatedAt: 2,
    } as never);

    render(<RunRouteComponent runId={"run-1" as never} section="overview" />);

    expect(
        screen.queryByText(/you can add a public source manually/i),
    ).toBeNull();
    expect(
        screen.getByText(
            /Independent web discovery was unavailable.*filing sources remain available in this approved source set/i,
        ),
    ).toBeTruthy();
});

test.each([
    ["running", undefined, "Evidence is being prepared"],
    [
        "paused",
        "claim_generation_unavailable",
        "Evidence is temporarily unavailable",
    ],
    ["failed", undefined, "Evidence could not be prepared"],
] as const)("explains persisted evidence preparation state %s", (executionStatus, pauseReason, title) => {
    convexReactHarness.query(api.researchRuns.getMine).returns({
        runId: "run-1",
        company: {
            legalName: "Example Corp",
            ticker: "EXM",
            exchange: "NASDAQ",
            cik: "123",
        },
        lifecycleState: "extracting_evidence",
        executionStatus,
        pauseReason,
        activeCorpusRevisionId: "revision-1",
        corpusRevisionStatus: "approved",
        canStartNewCorpusRevision: false,
        executionGeneration: 1,
        sourcesPhase: "collecting",
        providerFailures: [{ service: "exa", errorCode: "http_503" }],
        updatedAt: 2,
    });
    render(<RunRouteComponent runId={"run-1" as never} section="overview" />);
    expect(screen.getByText(title)).toBeTruthy();
    expect(
        screen.getByText(
            "Some research sources were unavailable. Inspect the approved set in Sources and consider any evidence gaps during review.",
        ),
    ).toBeTruthy();
    expect(
        screen.queryByText(/Independent web discovery is unavailable/),
    ).toBeNull();
    expect(
        screen.getByRole("region", { name: "Research progress" }).textContent,
    ).not.toMatch(
        /claim_generation_unavailable|EXA_API_KEY|evidenceExecution|extracting_evidence/,
    );
});

test("a run that failed before Sources prepared material is reported as stopped, not still preparing", () => {
    convexReactHarness.query(api.researchRuns.getMine).returns({
        runId: "run-1",
        startMode: "framed",
        sourcesProtocol: "sources_mission_v1",
        company: {
            legalName: "Example Corp",
            ticker: "EXM",
            exchange: "NASDAQ",
            cik: "123",
        },
        lifecycleState: "discovering_sources",
        executionStatus: "failed",
        sourcesPhase: "failed",
        providerFailures: [],
        updatedAt: 2,
    });
    render(<RunRouteComponent runId={"run-1" as never} section="sources" />);
    expect(
        screen.getByRole("heading", {
            name: "Documentary preparation stopped",
        }),
    ).toBeTruthy();
    expect(screen.queryByText(/Preparing documentary sources/)).toBeNull();
    expect(
        screen.queryByText(/Start a new analysis|nothing to inspect here/),
    ).toBeNull();
    expect(
        screen.queryByText(/discovering_sources|failed|sources_need_capacity/),
    ).toBeNull();
});
