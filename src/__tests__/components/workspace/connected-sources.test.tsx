import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
    fireEvent,
    render,
    screen,
    waitFor,
    within,
} from "@testing-library/react";
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
            sourceIds: [sourceId],
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
            sourceIds: [],
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
    reading: {
        captured: 1,
        full: 1,
        partial: 0,
        unavailable: 0,
        capturing: 1,
        notCaptured: 0,
    },
    contributions: tally,
    retainedContributions: tally,
    organize: {
        retained: 0,
        contextOnly: 0,
        notRetained: 0,
        notRetainedRead: 0,
        notRetainedUnread: 0,
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
    executionGeneration: 4,
    sourcesPhase: "collecting",
    sourcesDecisionRequestId: null,
    sourcesSettlementAvailable: false,
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
    convexReactHarness.mutation(api.execution.approvals.decide).uses(vi.fn());
    convexReactHarness
        .mutation(api.execution.approvals.revokeGrant)
        .uses(vi.fn());
});

test("dossiers on the corpus-approval path keep their existing review", () => {
    convexReactHarness.query(api.sourcesWorkspace.overview).returns(null);
    renderSources();
    expect(screen.getByText("Corpus review")).toBeTruthy();
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
            "The Sources Agent is collecting and reading material for 2 documentary needs. Outcomes settle when it hands off.",
        ),
    ).toBeTruthy();
    expect(screen.getAllByText("In progress").length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(rawValues);
    fireEvent.click(screen.getByRole("button", { name: /Inspect sources/ }));
    expect(onSearchChange).toHaveBeenCalledWith({ sourcesView: "matrix" });
});

test("how preparation ran accounts for every candidate and names conflicts and leads for what they are", () => {
    convexReactHarness.query(api.sourcesWorkspace.overview).returns({
        ...overview,
        materialOutcome: "partial",
        collect: { ...overview.collect, candidates: 9, acquisitions: 5 },
        reading: {
            captured: 5,
            full: 3,
            partial: 2,
            unavailable: 0,
            capturing: 0,
            notCaptured: 4,
        },
        contributions: {
            ...tally,
            total: 38,
            supported: 36,
            conflict: 1,
            notEstablished: 1,
        },
        retainedContributions: {
            ...tally,
            total: 29,
            supported: 28,
            conflict: 1,
            notEstablished: 0,
        },
        organize: {
            retained: 4,
            contextOnly: 0,
            notRetained: 5,
            notRetainedRead: 1,
            notRetainedUnread: 4,
            excluded: 0,
            restricted: 0,
        },
    });
    const { onSearchChange } = renderSources({
        run: { ...run, sourcesPhase: "completed" },
    });
    fireEvent.click(
        screen.getByRole("button", { name: /How preparation ran/ }),
    );
    expect(
        screen.getAllByText(
            (_, element) =>
                element?.textContent ===
                "5 captured · 3 complete, 2 partial, 4 not captured",
        )[0],
    ).toBeTruthy();
    expect(
        screen.getByText("Controls on 29 retained contributions"),
    ).toBeTruthy();
    expect(screen.getByText("1 read, nothing usable")).toBeTruthy();
    expect(screen.getByText("4 candidates never captured")).toBeTruthy();
    expect(
        screen.getByText("1 contribution in documentary conflict"),
    ).toBeTruthy();
    expect(
        screen.getByText("1 targeted search · 5 documents acquired"),
    ).toBeTruthy();
    // Documents open from the outcome; the narrow-layout copy is hidden by CSS jsdom does not apply.
    fireEvent.click(
        screen.getAllByRole("button", {
            name: /^1 document/,
        })[0] as HTMLElement,
    );
    fireEvent.click(
        within(
            screen.getAllByRole("list", {
                name: "Documents for this need",
            })[0] as HTMLElement,
        ).getByRole("button", { name: /Form 10-K · FY2025/ }),
    );
    expect(onSearchChange).toHaveBeenCalledWith({
        sourcesView: "reader",
        source: sourceId,
        need: "workflow",
    });
    expect(screen.queryByText("Opposing")).toBeNull();
    expect(screen.queryByText("Excluded")).toBeNull();
    expect(screen.queryByText(/Planned discovery|full reading/i)).toBeNull();
    expect(document.body.textContent).not.toMatch(rawValues);
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
    expect(row.getByText("Complete capture")).toBeTruthy();
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
    // Below the margin width, a citation's note opens from its note line.
    fireEvent.click(
        screen.getAllByRole("button", {
            name: /^Show note for citation 1/,
        })[0] as HTMLElement,
    );
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
        screen.getAllByRole("button", { name: "Follow up" })[0] as HTMLElement,
    );
    fireEvent.click(
        screen.getByRole("menuitem", { name: "Request a targeted check" }),
    );
    expect(onFollowUp).toHaveBeenCalledWith(
        expect.stringContaining(
            'targeted documentary check on "Form 10-K · FY2025"',
        ),
    );
});

test("going to a conflict in another source starts on it once that document arrives", () => {
    const blog: Reading = {
        ...reading,
        source: rows[1] as Row,
        contributions: [
            {
                ...(reading
                    .contributions[0] as Reading["contributions"][number]),
                conclusion: "supported",
            },
        ],
    };
    let loaded = false;
    convexReactHarness
        .query(api.sourcesWorkspace.getSource)
        .returnsFrom(({ args }) =>
            args !== "skip" && args.sourceId === otherId
                ? blog
                : loaded
                  ? reading
                  : undefined,
        );
    const props = {
        runId,
        run,
        onSearchChange: vi.fn(),
        navigation: <nav aria-label="Research workspace sections" />,
        fallback: <p>Corpus review</p>,
    };
    const { rerender } = render(
        <ConnectedSources
            {...props}
            search={{ sourcesView: "reader", source: otherId }}
        />,
    );
    // The previous document stays on screen while the conflicting one loads.
    rerender(
        <ConnectedSources
            {...props}
            search={{
                sourcesView: "reader",
                source: sourceId,
                focus: "conflict",
            }}
        />,
    );
    loaded = true;
    rerender(
        <ConnectedSources
            {...props}
            search={{
                sourcesView: "reader",
                source: sourceId,
                focus: "conflict",
            }}
        />,
    );
    expect(
        screen
            .getByRole("button", { name: /^Conflicts/ })
            .getAttribute("aria-pressed"),
    ).toBe("true");
});

test("on a phone, a source opened from preparation opens straight in its drawer, and closing it forgets the source", async () => {
    const matchMedia = window.matchMedia;
    window.matchMedia = (query: string) => ({
        ...matchMedia(query),
        matches: query === "(max-width: 767px)",
    });
    try {
        const { onSearchChange } = renderSources({
            search: {
                sourcesView: "reader",
                source: sourceId,
                need: "workflow",
            },
        });
        const drawer = screen.getByRole("dialog", {
            name: "Form 10-K · FY2025",
        });
        fireEvent.click(
            within(drawer).getByRole("button", { name: "Close source" }),
        );
        // Reloading the address afterwards shows the list, not the drawer again.
        await waitFor(() =>
            expect(onSearchChange).toHaveBeenCalledWith(
                { source: undefined, need: undefined, focus: undefined },
                true,
            ),
        );
    } finally {
        window.matchMedia = matchMedia;
    }
});

test("without a Workbench conversation the reader offers no follow-up it cannot deliver", () => {
    renderSources({
        search: { sourcesView: "reader", source: sourceId },
        onFollowUp: undefined,
    });
    expect(screen.queryByRole("button", { name: "Follow up" })).toBeNull();
});

test("the Sources page points to the conversation's time-limit decision", () => {
    const requestId = "approval-sources-1" as Id<"approvalRequests">;
    const onOpenDecision = vi.fn();
    renderSources({
        run: {
            ...run,
            executionStatus: "paused",
            pauseReason: "sources_time_limit",
            executionGeneration: 5,
            sourcesPhase: "time_limit",
            sourcesDecisionRequestId: requestId,
        },
        onOpenDecision,
    });
    expect(
        screen.getByRole("heading", {
            name: "The Sources Agent reached its time limit",
        }),
    ).toBeTruthy();
    expect(screen.getAllByText("Decision needed").length).toBeGreaterThan(0);
    expect(screen.queryByRole("group")).toBeNull();
    expect(screen.queryByRole("button", { name: "Continue once" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open decision" }));
    expect(onOpenDecision).toHaveBeenCalledOnce();
    expect(document.body.textContent).not.toMatch(
        /sources_time_limit|time_limit/,
    );
});

test("the Sources preparation view exposes the same recorded settlement action for a technical stop", async () => {
    const usePrepared = vi.fn().mockResolvedValue(undefined);
    convexReactHarness
        .mutation(api.execution.approvals.usePreparedSources)
        .uses(usePrepared);
    renderSources({
        run: {
            ...run,
            executionStatus: "paused",
            pauseReason: "execution_interrupted",
            sourcesPhase: "interrupted",
            sourcesSettlementAvailable: true,
        },
    });
    fireEvent.click(
        screen.getByRole("button", { name: "Use what's prepared" }),
    );
    await waitFor(() =>
        expect(usePrepared).toHaveBeenCalledWith({
            runId,
            expectedGeneration: 4,
        }),
    );
});
