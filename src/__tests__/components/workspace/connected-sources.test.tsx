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
import { assert, beforeEach, expect, test, vi } from "vitest";
import { convexReactHarness } from "@/__tests__/helpers/convex-react-harness";
import {
    ConnectedSources,
    ProgressSourcesResult,
} from "@/components/workspace/sources/connected-sources";

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
    effectiveUses: {
        documentary: 1,
        attributed_argument_only: 0,
        context_only: 0,
        blocked: 1,
    },
    inspectionOnly: 1,
};
const unavailableAction: Overview["research"]["actions"]["resume"] = {
    actor: "analyst_or_authorized_workbench",
    applicable: false,
    reason: "unavailable",
};
const overview: Overview = {
    research: {
        phase: "discovering_sources",
        status: "running",
        executionGeneration: 4,
        started: true,
        controlAvailable: true,
        pauseReason: null,
        pauseRequested: false,
        approvals: { pending: [], grants: [] },
        actions: {
            start: { ...unavailableAction, actor: "analyst_only" },
            pause: { ...unavailableAction, applicable: true, reason: null },
            resume: unavailableAction,
            continuePreparation: unavailableAction,
            usePrepared: unavailableAction,
        },
        sources: null,
        nextCapability: null,
    },
    researchSummary: "Research is running.",
    currentStop: null,
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
        unknown: 0,
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
        notRetainedCaptured: 0,
        notRetainedWithoutAvailableCapture: 0,
        excluded: 0,
        restricted: 0,
    },
};
const rows: Row[] = [
    {
        preparationId: overview.preparationId,
        capture: null,
        retainedSnapshot: null,
        qualification: { status: "not_recorded" },
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
        preparationId: overview.preparationId,
        capture: null,
        retainedSnapshot: null,
        qualification: { status: "not_recorded" },
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
            needs: { workflow: "blocked" },
            objections: [],
            reportedUse: "attributed_argument_only",
            conclusion: "documentary_conflict",
            diagnostic: "The call defines scope differently.",
            restricted: false,
        },
    ],
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

test("Sources opens on the document matrix without a preparation step", () => {
    renderSources();
    expect(
        screen.getByRole("heading", {
            name: "Sources, captures and contributions",
        }),
    ).toBeTruthy();
    expect(screen.getByText("Form 10-K · FY2025")).toBeTruthy();
    expect(
        screen.queryByRole("button", { name: /Inspect sources/ }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Preparation" })).toBeNull();
    expect(document.body.textContent).not.toMatch(rawValues);
});

test("the Progress Sources result accounts for every candidate and names conflicts and leads for what they are", () => {
    convexReactHarness.query(api.sourcesWorkspace.overview).returns({
        ...overview,
        materialOutcome: "partial",
        coverage: {
            policy: {
                version: "sources_coverage_v1",
                preset: "independent_scrutiny",
            },
            searches: [
                {
                    requestId:
                        "search-coverage" as Id<"agentOperationRequests">,
                    needIds: ["common-context"],
                    query: "workflow terms",
                    focus: "independent",
                    outcome: "unfinished",
                    reasonCode: "operation_outcome_unknown",
                },
            ],
            assessments: [
                {
                    needId: "common-context",
                    statement: "No usable independent material found",
                    author: {
                        type: "agent",
                        missionId: "sources" as Id<"agentMissions">,
                        invocationId:
                            "sources-invocation" as Id<"agentInvocations">,
                    },
                    readings: [
                        {
                            sourceId,
                            captureId: "capture" as Id<"sourceCaptures">,
                            passageOrder: 0,
                        },
                    ],
                },
            ],
        },
        collect: { ...overview.collect, candidates: 9, acquisitions: 5 },
        reading: {
            captured: 5,
            full: 3,
            partial: 2,
            unknown: 0,
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
            notRetainedCaptured: 1,
            notRetainedWithoutAvailableCapture: 4,
            excluded: 0,
            restricted: 0,
        },
    });
    const onOpenSource = vi.fn();
    render(
        <ProgressSourcesResult
            runId={runId}
            run={{ ...run, sourcesPhase: "completed" }}
            onOpenSource={onOpenSource}
        />,
    );
    fireEvent.click(
        screen.getByRole("button", {
            name: /How preparation ran.*9 collected → 5 captured → 4 retained/,
        }),
    );
    expect(screen.getByText("Independent scrutiny")).toBeTruthy();
    expect(
        screen.getByText(
            "Sources assessment: No usable independent material found",
        ),
    ).toBeTruthy();
    expect(document.body.textContent).not.toMatch(
        /sources_coverage_v1|operation_outcome_unknown/,
    );
    expect(
        screen.getByText(
            (_, element) =>
                element?.tagName === "SPAN" &&
                element.textContent === "4 not captured",
        ),
    ).toBeTruthy();
    expect(
        screen.getByText("Controls on 29 retained contributions"),
    ).toBeTruthy();
    expect(screen.getByText("1 captured, not retained")).toBeTruthy();
    expect(
        screen.getByText("4 candidates without an available capture"),
    ).toBeTruthy();
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
    expect(onOpenSource).toHaveBeenCalledWith(sourceId, "workflow");
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

test.each([
    "capturing",
    "unavailable",
] as const)("the reader preserves %s acquisition metadata without a saved capture", (status) => {
    convexReactHarness.query(api.sourcesWorkspace.getSource).returns({
        ...reading,
        source: { ...reading.source, reading: status, capture: null },
        capture: null,
        excerpts: "none",
        sections: [],
        contributions: [],
    });
    renderSources({ search: { sourcesView: "reader", source: sourceId } });
    expect(
        screen.getAllByText(new RegExp(`sec.gov · ${status}`)).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText(/sec.gov · not captured/)).toBeNull();
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

test("the citation note distinguishes a blocked question from an allowed contextual use", () => {
    const [original] = reading.contributions;
    assert(original);
    const objection =
        "This passage does not establish who controls coordination.";
    convexReactHarness.query(api.sourcesWorkspace.getSource).returns({
        ...reading,
        contributions: [
            {
                ...original,
                conclusion: "supported",
                diagnostic: "The report attributes this view to management.",
                needIds: ["context", "workflow"],
                permittedUse: "attributed_argument_only",
                needs: {
                    context: "attributed_argument_only",
                    workflow: "blocked",
                },
                objections: [
                    {
                        needIds: ["workflow"],
                        maximumUse: "blocked",
                        diagnosticPreview: objection,
                        diagnosticComplete: true,
                    },
                ],
            },
        ],
    });
    renderSources({ search: { sourcesView: "reader", source: sourceId } });
    fireEvent.click(
        screen.getAllByRole("button", {
            name: /^Show note for citation 1/,
        })[0] as HTMLElement,
    );
    expect(document.body.textContent).toMatch(/Q1[^·]*inspection only/i);
    expect(document.body.textContent).toContain(objection);
    expect(document.body.textContent).toMatch(/attributed argument only/i);
    expect(document.body.textContent).not.toMatch(rawValues);
});

test.each([
    {
        field: "statement",
        value: "See abcdef0123456789abcdef0123456789.",
    },
    {
        field: "diagnostic",
        value: "documentary_conflict: ECONNRESET during source_qualification.",
    },
    { field: "attribution", value: "SOURCE_QUALIFICATION_ENABLED" },
    {
        field: "attribution",
        value: "request id: 550e8400-e29b-41d4-a716-446655440000",
    },
    { field: "statement", value: "api key: sk.test.redacted" },
    { field: "period", value: "target-42" },
    { field: "statement", value: "   " },
] as const)("the reader withholds unusable model $field wording: $value", ({
    field,
    value,
}) => {
    convexReactHarness.query(api.sourcesWorkspace.getSource).returns({
        ...reading,
        contributions: reading.contributions.map((contribution) => ({
            ...contribution,
            [field]: value,
        })),
    });
    renderSources({ search: { sourcesView: "reader", source: sourceId } });
    fireEvent.click(
        screen.getAllByRole("button", {
            name: /^Show note for citation 1/,
        })[0] as HTMLElement,
    );
    if (value.trim()) expect(document.body.textContent).not.toContain(value);
    expect(
        screen.getAllByText(
            field === "diagnostic"
                ? /Explanation unavailable\. Inspect the cited passage\./
                : /Some contribution wording is unavailable\. Inspect the cited passage\./,
        ).length,
    ).toBeGreaterThan(0);
    expect(
        screen.getAllByText("The platform connects insurers.").length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText(/Inspection only/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Conflict").length).toBeGreaterThan(0);
});

test.each([
    ":g5566066:",
    ":x42:",
    "n/a",
    "null",
    "supported",
    "objection",
    "issuer_product_claim_no_outcome",
    "",
    "   ",
    "S&P describes issuer_product_claim_no_outcome as a reporting label.",
])("shows the recorded finding or an actionable explanation for %j", (diagnostic) => {
    const fallback = "Explanation unavailable. Inspect the cited passage.";
    convexReactHarness.query(api.sourcesWorkspace.getSource).returns({
        ...reading,
        contributions: reading.contributions.map((c) => ({
            ...c,
            diagnostic,
            conclusion: "supported",
            permittedUse: "attributed_argument_only",
        })),
    });
    renderSources({ search: { sourcesView: "reader", source: sourceId } });
    fireEvent.click(
        screen.getAllByRole("button", {
            name: /^Show note for citation 1/,
        })[0] as HTMLElement,
    );
    const note = document.body.textContent ?? "";
    expect(note).toContain(
        diagnostic.startsWith("S&P") ? diagnostic : fallback,
    );
    expect(note).not.toMatch(/:g5566066:|:x42:/);
    expect(note).toMatch(/Attributed argument only/i);
    expect(note).toContain("The platform connects insurers.");
});

test("the reader preserves long ordinary model prose and exact quoted technical text", () => {
    const statement =
        "The 10-K discusses EBITDA, AWS and API key ownership; the economic evidence is inconclusive. "
            .repeat(16)
            .trim();
    const quotation = "The configuration uses SOURCE_QUALIFICATION_ENABLED.";
    convexReactHarness.query(api.sourcesWorkspace.getSource).returns({
        ...reading,
        sections: [
            {
                id: "excerpt-3",
                heading: "Business",
                passages: [{ order: 3, quotation }],
            },
        ],
        contributions: reading.contributions.map((contribution) => ({
            ...contribution,
            statement,
            diagnostic: undefined,
        })),
    });
    renderSources({ search: { sourcesView: "reader", source: sourceId } });
    fireEvent.click(
        screen.getAllByRole("button", {
            name: /^Show note for citation 1/,
        })[0] as HTMLElement,
    );
    expect(screen.getAllByText(statement).length).toBeGreaterThan(0);
    expect(screen.getAllByText(quotation).length).toBeGreaterThan(0);
    expect(
        screen.queryByText(/Some contribution wording is unavailable/),
    ).toBeNull();
});

test("the reader keeps documentary commentary that names HTTP statuses and business identifiers", () => {
    const statement =
        "The documented API returns HTTP 429 when a customer's rate allowance is exhausted. " +
        "Customers map CUSTOMER_ID between the platform and their system of record. " +
        "Filing passage 12 sets the retention period.";
    convexReactHarness.query(api.sourcesWorkspace.getSource).returns({
        ...reading,
        contributions: reading.contributions.map((contribution) => ({
            ...contribution,
            statement,
            diagnostic: undefined,
            attribution: undefined,
            period: undefined,
        })),
    });
    renderSources({ search: { sourcesView: "reader", source: sourceId } });
    fireEvent.click(
        screen.getAllByRole("button", {
            name: /^Show note for citation 1/,
        })[0] as HTMLElement,
    );
    expect(screen.getAllByText(statement).length).toBeGreaterThan(0);
    expect(
        screen.queryByText(/Some contribution wording is unavailable/),
    ).toBeNull();
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

test("captured-only row does not imply qualification", () => {
    const captured = rows[0];
    assert(captured);
    convexReactHarness.query(api.sourcesWorkspace.listSources).returns([
        {
            ...captured,
            membership: "not_retained",
            contributions: null,
            qualification: { status: "not_recorded" },
        },
    ]);
    renderSources({ search: { sourcesView: "matrix" } });
    expect(screen.getByText("Complete capture")).toBeTruthy();
    expect(screen.getByText("Not retained")).toBeTruthy();
    expect(screen.getByText("No qualification recorded")).toBeTruthy();
    expect(screen.queryByText(/nothing usable|0 contributions/)).toBeNull();
});

test("supported attribution-only use stays visible without an additional restriction record", () => {
    const captured = rows[0];
    assert(captured);
    convexReactHarness.query(api.sourcesWorkspace.listSources).returns([
        {
            ...captured,
            contributions: {
                ...tally,
                total: 1,
                supported: 1,
                conflict: 0,
                inspectionOnly: 0,
                restricted: 0,
                effectiveUses: {
                    documentary: 0,
                    attributed_argument_only: 1,
                    context_only: 0,
                    blocked: 0,
                },
            },
        },
    ]);
    renderSources({ search: { sourcesView: "matrix" } });
    expect(screen.getByText("1 attribution only")).toBeTruthy();
});

test("conflict leaves every effective-use restriction and the retained capture distinction visible", () => {
    const captured = rows[0];
    assert(captured);
    convexReactHarness.query(api.sourcesWorkspace.listSources).returns([
        {
            ...captured,
            membership: "retained",
            capture: {
                captureId: "capture-new" as Id<"sourceCaptures">,
                contentHash: "new-hash",
            },
            retainedSnapshot: {
                needsRevision: 1,
                captureId: "capture-retained" as Id<"sourceCaptures">,
                contentHash: "retained-hash",
                qualificationTaskId:
                    "qualification-retained" as Id<"aiTaskResults">,
                qualificationVersion: 1,
            },
            contributions: {
                ...tally,
                total: 3,
                supported: 2,
                kinds: {
                    asserted_fact: 1,
                    attributed_argument: 1,
                    forecast: 0,
                    context: 1,
                },
                effectiveUses: {
                    documentary: 0,
                    attributed_argument_only: 1,
                    context_only: 1,
                    blocked: 1,
                },
            },
        },
    ]);
    renderSources({ search: { sourcesView: "matrix" } });
    expect(screen.getByText("Conflict 1")).toBeTruthy();
    expect(
        screen.getByText(
            /1 for inspection only.*1 attribution only.*1 context only/,
        ),
    ).toBeTruthy();
    expect(screen.getByText("Retained from another capture")).toBeTruthy();
});

test("the Progress Sources result states the current stop once and keeps a different handoff note as recorded history", () => {
    convexReactHarness.query(api.sourcesWorkspace.overview).returns({
        ...overview,
        materialOutcome: "partial",
        research: { ...overview.research, status: "paused" },
        researchSummary:
            "Research is paused. Recorded stop: The Sources Agent stopped because its model response could not be used.",
        currentStop:
            "The Sources Agent stopped because its model response could not be used.",
        needs: overview.needs.map((need) => ({
            ...need,
            outcome: "unfinished",
            unfinished: ["The time window ended."],
        })),
    });
    render(
        <ProgressSourcesResult
            runId={runId}
            run={{ ...run, sourcesPhase: "completed_with_limits" }}
            onOpenSource={vi.fn()}
        />,
    );
    expect(
        screen.getAllByText(/model response could not be used/),
    ).toHaveLength(1);
    expect(
        screen.getAllByText(/Recorded at handoff:.*time window ended/),
    ).toHaveLength(1);
    // The dossier pause is not restated by the Sources stage.
    expect(screen.queryByText(/Dossier status:/)).toBeNull();
    expect(screen.queryByText(/Investigation is not available yet/)).toBeNull();
    expect(screen.queryByText(/Start a new analysis/)).toBeNull();
});

test.each([
    "running",
    "paused",
    "failed",
    "cancelled",
] as const)("later dossier activity keeps Sources completion and global status separate (%s)", (status) => {
    convexReactHarness.query(api.sourcesWorkspace.overview).returns({
        ...overview,
        materialOutcome: "partial",
        research: {
            ...overview.research,
            phase: "extracting_evidence",
            status,
        },
        researchSummary: "The dossier needs attention.",
    });
    render(
        <ProgressSourcesResult
            runId={runId}
            run={{
                ...run,
                sourcesPhase: "completed_with_limits",
                executionStatus: status,
                lifecycleState: "extracting_evidence",
            }}
            onOpenSource={vi.fn()}
        />,
    );
    expect(
        screen.getByRole("table", { name: "Documentary needs" }),
    ).toBeTruthy();
    if (status === "failed" || status === "cancelled")
        expect(
            screen.getByText("Dossier status: The dossier needs attention."),
        ).toBeTruthy();
    else expect(screen.queryByText(/Dossier status:/)).toBeNull();
});
