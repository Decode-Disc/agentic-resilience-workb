import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { FunctionReturnType } from "convex/server";
import type { ComponentProps } from "react";
import { beforeEach, expect, test, vi } from "vitest";
import { convexReactHarness } from "@/__tests__/helpers/convex-react-harness";
import { ConnectedSources } from "@/components/workspace/sources/connected-sources";

vi.mock(
    "convex/react",
    async () =>
        (await import("@/__tests__/helpers/convex-react-harness"))
            .convexReactHarness.module,
);

const runId = "run-sources" as Id<"researchRuns">;
const sourceId = "source-annual" as Id<"sources">;
const otherId = "source-blog" as Id<"sources">;
type Overview = NonNullable<
    FunctionReturnType<typeof api.sourcesWorkspace.overview>
>;
type Row = NonNullable<
    FunctionReturnType<typeof api.sourcesWorkspace.listSources>
>[number];
type Reading = NonNullable<
    FunctionReturnType<typeof api.sourcesWorkspace.getSource>
>;

const tally = {
    total: 2,
    kinds: {
        asserted_fact: 1,
        attributed_argument: 1,
        forecast: 0,
        context: 0,
    },
    supported: 1,
    conflict: 1,
    notEstablished: 0,
    unchecked: 0,
    restricted: 0,
    inspectionOnly: 1,
};
const overview: Overview = {
    preparationId: "prep-1" as Overview["preparationId"],
    preparationStatus: "started",
    missionStatus: "running",
    materialOutcome: null,
    questions: [
        { id: "q1", text: "Who controls coordination?", shortLabel: "Control" },
    ],
    needs: [
        {
            id: "workflow",
            information: "Where the platform sits in the claims workflow",
            questionIds: ["q1"],
            outcome: "in_progress",
            unfinished: [],
            documents: 1,
            contributions: 2,
            conflicts: 1,
        },
        {
            id: "context",
            information: "Company context: segments and periods",
            questionIds: [],
            outcome: "in_progress",
            unfinished: [],
            documents: 0,
            contributions: 0,
            conflicts: 0,
        },
    ],
    collect: {
        candidates: 2,
        failedFamilies: ["independent_analysis"],
        searches: 1,
        acquisitions: 0,
    },
    reading: { captured: 1, full: 1, partial: 0, unavailable: 0, capturing: 1 },
    contributions: tally,
    organize: {
        retained: 0,
        contextOnly: 0,
        notRetained: 0,
        excluded: 0,
        restricted: 0,
    },
};
const rows: Row[] = [
    {
        sourceId,
        title: "Form 10-K · FY2025",
        url: "https://www.sec.gov/annual",
        host: "sec.gov",
        origin: "sec",
        secForm: "10-K",
        family: "regulatory",
        documentKind: "regulatory_annual",
        authorityTier: "regulator_primary",
        reading: "full",
        membership: "pending",
        contextOnly: false,
        contributions: tally,
        limitations: [],
    },
    {
        sourceId: otherId,
        title: "Industry blog post",
        url: "https://blog.example.com/post",
        host: "blog.example.com",
        origin: "exa",
        family: "unrecognized",
        documentKind: "community_content",
        authorityTier: "unverified",
        reading: "capturing",
        membership: "pending",
        contextOnly: false,
        contributions: null,
        limitations: [],
    },
];
const reading: Reading = {
    source: rows[0] as Row,
    capture: { captureId: "capture-1" as Id<"sourceCaptures"> },
    excerpts: "cited",
    sections: [
        {
            id: "excerpt-3",
            heading: "Business",
            passages: [
                { order: 3, quotation: "The platform connects insurers." },
            ],
        },
    ],
    contributions: [
        {
            id: "c1",
            version: 1,
            kind: "attributed_argument",
            statement: "Management argues the platform coordinates claims.",
            period: "FY2025",
            attribution: "Management",
            needIds: ["workflow"],
            passageOrders: [3],
            permittedUse: "blocked",
            reportedUse: "attributed_argument_only",
            conclusion: "documentary_conflict",
            diagnostic: "The call defines scope differently.",
            restricted: false,
        },
    ],
    coherence: false,
    observedLinks: [
        {
            index: 0,
            url: "https://investors.example.com/deck.pdf",
            originText: "Investor day deck",
            captured: false,
        },
    ],
};

const run: ComponentProps<typeof ConnectedSources>["run"] = {
    runId,
    startMode: "framed",
    sourcesProtocol: "sources_mission_v1",
    company: null,
    lifecycleState: "discovering_sources",
    executionStatus: "running",
    pauseReason: undefined,
    coveragePreset: "balanced",
    framingScope: null,
    researchAngle: undefined,
    activeCorpusRevisionId: undefined,
    completionOutcome: undefined,
    updatedAt: 1,
    providerFailures: [],
    corpusRevisionStatus: undefined,
    canStartNewCorpusRevision: false,
};

function renderSources(
    props: Partial<ComponentProps<typeof ConnectedSources>> = {},
) {
    const onSearchChange = vi.fn();
    const onFollowUp = vi.fn();
    render(
        <ConnectedSources
            runId={runId}
            run={run}
            search={{}}
            onSearchChange={onSearchChange}
            navigation={<nav aria-label="Research workspace sections" />}
            fallback={<p>Corpus review</p>}
            dock={<p>Inventory dock</p>}
            onFollowUp={onFollowUp}
            {...props}
        />,
    );
    return { onSearchChange, onFollowUp };
}

const rawValues =
    /in_progress|asserted_fact|attributed_argument|context_only|documentary_conflict|not_retained|regulator_primary|discovering_sources/;

beforeEach(() => {
    convexReactHarness.reset();
    convexReactHarness.query(api.sourcesWorkspace.overview).returns(overview);
    convexReactHarness.query(api.sourcesWorkspace.listSources).returns(rows);
    convexReactHarness.query(api.sourcesWorkspace.getSource).returns(reading);
});

test("dossiers on the corpus-approval path keep their existing review", () => {
    convexReactHarness.query(api.sourcesWorkspace.overview).returns(null);
    renderSources();
    expect(screen.getByText("Corpus review")).toBeTruthy();
    expect(screen.queryByText("Inventory dock")).toBeNull();
});

test("preparation under way shows unsettled needs without backend vocabulary", () => {
    const { onSearchChange } = renderSources();
    expect(
        screen.getByRole("heading", {
            name: "Collecting the documentary material",
        }),
    ).toBeTruthy();
    expect(
        screen.getByText(
            "Sources is collecting and reading material for 2 documentary needs. Outcomes settle when it hands off.",
        ),
    ).toBeTruthy();
    expect(screen.getAllByText("In progress").length).toBeGreaterThan(0);
    expect(screen.getByText("Inventory dock")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(rawValues);
    fireEvent.click(screen.getByRole("button", { name: /Inspect sources/ }));
    expect(onSearchChange).toHaveBeenCalledWith({ sourcesView: "matrix" });
});

test("the matrix keeps reading, documentary contributions and selection separate", () => {
    const { onSearchChange } = renderSources({
        search: { sourcesView: "matrix" },
    });
    const table = screen.getByRole("table", { name: "Source matrix" });
    const annual = within(table)
        .getByRole("button", { name: "Form 10-K · FY2025" })
        .closest("tr");
    expect(annual).not.toBeNull();
    const row = within(annual as HTMLElement);
    expect(row.getByText("Full reading")).toBeTruthy();
    expect(
        row.getByRole("button", {
            name: "2 contributions: 1 asserted fact, 1 attributed argument",
        }),
    ).toBeTruthy();
    expect(row.getByText("1 for inspection only")).toBeTruthy();
    expect(row.getByText("Pending")).toBeTruthy();
    expect(screen.getByText("Capturing")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(rawValues);
    fireEvent.change(
        screen.getByRole("searchbox", { name: "Search sources" }),
        {
            target: { value: "blog" },
        },
    );
    expect(onSearchChange).toHaveBeenCalledWith({ q: "blog" }, true);
    fireEvent.click(row.getByRole("button", { name: "Form 10-K · FY2025" }));
    expect(onSearchChange).toHaveBeenCalledWith({
        sourcesView: "reader",
        source: sourceId,
    });
});

test("the reader shows effective use apart from the reported one and hands a follow-up to Workbench", () => {
    const { onFollowUp } = renderSources({
        search: { sourcesView: "reader", source: sourceId },
    });
    expect(
        screen.getAllByText("The platform connects insurers.").length,
    ).toBeGreaterThan(0);
    expect(
        screen.getAllByText(
            /Inspection only · The call defines scope differently\. · Control reported attributed argument only; effective use is inspection only\./,
        ).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText("Attributed argument").length).toBeGreaterThan(
        0,
    );
    expect(document.body.textContent).not.toMatch(rawValues);
    fireEvent.click(
        screen.getAllByRole("button", {
            name: "Request a targeted check",
        })[0] as HTMLElement,
    );
    expect(onFollowUp).toHaveBeenCalledWith(
        expect.stringContaining(
            'targeted documentary check on "Form 10-K · FY2025"',
        ),
    );
});

test("without a Workbench conversation the reader offers no follow-up it cannot deliver", () => {
    renderSources({
        search: { sourcesView: "reader", source: sourceId },
        onFollowUp: undefined,
    });
    expect(
        screen.queryByRole("button", { name: "Request a targeted check" }),
    ).toBeNull();
    expect(
        screen.queryByRole("button", { name: "Challenge this selection" }),
    ).toBeNull();
});
