import { api } from "@convex/_generated/api";
import {
    act,
    fireEvent,
    render,
    screen,
    waitFor,
    within,
} from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";

const { setPaidWorkEnabled, restoreQuota, withdrawDossier, reopenDossier } =
    vi.hoisted(() => ({
        setPaidWorkEnabled: vi.fn(),
        restoreQuota: vi.fn(),
        withdrawDossier: vi.fn(),
        reopenDossier: vi.fn(),
    }));

vi.mock("convex/react", async () => {
    const { convexReactHarness } = await import(
        "@/__tests__/helpers/convex-react-harness"
    );
    return convexReactHarness.module;
});

import { convexReactHarness } from "@/__tests__/helpers/convex-react-harness";
import { AdminPage } from "@/components/admin/admin-page";
import { Toaster } from "@/components/ui/sonner";

/** Renders admin as on a wide screen, where the dossier detail sits beside its list. */
function mockWideScreen() {
    return vi.spyOn(window, "matchMedia").mockImplementation(
        (query: string): MediaQueryList =>
            Object.assign(new EventTarget(), {
                matches: query.includes("min-width"),
                media: query,
                onchange: null,
                addListener: () => undefined,
                removeListener: () => undefined,
            }),
    );
}

const adminVisitor = { role: "admin", status: "active" };

const preparedModel = {
    _id: "glm",
    _creationTime: 1,
    currentRevisionId: "glm-revision",
    model: "z-ai/glm-5.3-flash",
    label: "GLM-5.3-Flash",
    revision: 2,
    status: "ready",
    enabled: true,
    workbenchSelectable: true,
    compatible: true,
    reasoning: {
        preference: "recommended",
        recommended: "high",
        effective: "high",
        choices: ["low", "high"],
    },
};

const healthyModels = {
    models: [preparedModel],
    assignments: [{ agent: "workbench", catalogId: "glm", revision: 1 }],
    agents: [{ agent: "workbench", label: "Workbench", implemented: true }],
};

const refreshProfiles = vi.fn();
const dossiers = { section: "dossiers" } as const;

test("administration exposes model setup separately from per-agent assignments", async () => {
    const initialize = vi.fn().mockResolvedValue({ ready: true });
    convexReactHarness.query(api.modelConfiguration.list).returns({
        models: [],
        assignments: [],
        agents: [
            { agent: "workbench", label: "Workbench", implemented: true },
            {
                agent: "investigation",
                label: "Investigation",
                implemented: false,
            },
        ],
    });
    convexReactHarness
        .action(api.modelConfigurationActions.initialize)
        .uses(initialize);
    convexReactHarness
        .action(api.modelConfigurationActions.prepare)
        .uses(vi.fn());
    convexReactHarness
        .action(api.modelConfigurationActions.refreshProfiles)
        .uses(vi.fn());
    convexReactHarness
        .mutation(api.modelConfiguration.updateAvailability)
        .uses(vi.fn());
    convexReactHarness
        .mutation(api.modelConfiguration.setReasoningPreference)
        .uses(vi.fn());
    convexReactHarness
        .mutation(api.modelConfiguration.setResponseControl)
        .uses(vi.fn());
    convexReactHarness.mutation(api.modelConfiguration.assign).uses(vi.fn());
    render(<AdminPage />);
    fireEvent.click(
        await screen.findByRole("tab", { name: "Models & agents" }),
    );
    expect(await screen.findByText("Not connected yet")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: /^Model catalogue/ }));
    expect(await screen.findByText("No models configured")).toBeTruthy();
    fireEvent.click(
        screen.getByRole("button", { name: "Set up default models" }),
    );
    await waitFor(() => expect(initialize).toHaveBeenCalledWith({}));
});

const researchRun = {
    runId: "run-research",
    companyLegalName: "ServiceNow, Inc.",
    lifecycleState: "awaiting_source_review",
    executionStatus: "paused",
    updatedAt: 2,
    createdAt: 1,
    preparation: {
        preparationId: "prep-1",
        status: "blocked",
        stopCode: "provider_unavailable",
        configurationCheck: { available: false, checkedAt: 1 },
    },
};

const evaluationRun = {
    runId: "run-evaluation",
    companyLegalName: "Zeta Labs",
    lifecycleState: "completed",
    executionStatus: "completed",
    updatedAt: 4,
    createdAt: 3,
};

const failedExaCall = {
    _id: "provider-exa",
    runId: "run-research",
    service: "exa",
    operation: "search",
    status: "failed",
    errorCode: "exa_not_configured",
    attempt: 1,
    dispatchOutcome: "response_received",
    httpStatus: 503,
    reportedCost: 0.02,
    createdAt: 1,
};

const succeededSecCall = {
    _id: "provider-sec",
    runId: "run-research",
    service: "sec",
    operation: "fetch_filing",
    status: "succeeded",
    attempt: 2,
    createdAt: 2,
};

const operations = {
    paidWork: { enabled: true },
    checkpoints: [
        {
            runId: "run-research",
            checkpoint: "source_review",
            decision: "approved",
            occurredAt: Date.UTC(2026, 0, 2, 9, 30),
        },
    ],
    providerCalls: [failedExaCall, succeededSecCall],
    reservations: [
        {
            visitorId: "v1",
            role: "analyst",
            remaining: 2,
            slotKey: "analyst-1",
            reservedForTesting: false,
            admittedAt: Date.now() - 60_000,
        },
        {
            visitorId: "v2",
            role: "analyst",
            remaining: 0,
            slotKey: "browser-test",
            reservedForTesting: true,
            admittedAt: 1,
        },
    ],
};

beforeEach(() => {
    convexReactHarness.reset();
    setPaidWorkEnabled.mockReset();
    restoreQuota.mockReset();
    withdrawDossier.mockReset();
    reopenDossier.mockReset();
    refreshProfiles.mockReset();
    refreshProfiles.mockResolvedValue({ isDone: true, continueCursor: null });
    convexReactHarness.query(api.visitors.current).returns(adminVisitor);
    convexReactHarness
        .query(api.modelConfiguration.list)
        .returns(healthyModels as never);
    convexReactHarness
        .action(api.modelConfigurationActions.refreshProfiles)
        .uses(refreshProfiles);
    convexReactHarness.query(api.adminOperations.get).returns(operations);
    convexReactHarness
        .paginatedQuery(api.adminOperations.listRunsPage)
        .returnsFrom(({ args }) => ({
            results:
                args !== "skip" && args.purpose === "evaluation"
                    ? [evaluationRun]
                    : args !== "skip" && args.purpose === "research"
                      ? [researchRun]
                      : [],
            status: "Exhausted",
            loadMore: vi.fn(),
        }));
    convexReactHarness
        .query(api.adminOperations.countRuns)
        .returns({ count: 1, capped: false });
    convexReactHarness
        .query(api.adminOperations.countRunProviderCalls)
        .returns({ count: 2, capped: false });
    convexReactHarness
        .paginatedQuery(api.adminOperations.listRestorableRunsPage)
        .returns({
            results: [
                { runId: "run-unused", ownerVisitorId: "v1", createdAt: 1 },
            ],
            status: "Exhausted",
            loadMore: vi.fn(),
        });
    convexReactHarness
        .paginatedQuery(api.adminOperations.listRunProviderCallsPage)
        .returns({
            results: [failedExaCall, succeededSecCall],
            status: "Exhausted",
            loadMore: vi.fn(),
        });
    convexReactHarness
        .query(api.adminOperations.inspectProviderCall)
        .returnsFrom(({ args }) =>
            args === "skip"
                ? undefined
                : ([failedExaCall, succeededSecCall].find(
                      (call) => call._id === args.providerCallId,
                  ) ?? null),
        );
    convexReactHarness.mutation(api.providerCalls.retryBilling).uses(vi.fn());
    convexReactHarness
        .paginatedQuery(api.adminOperations.listRunJournalEventsPage)
        .returns({ results: [], status: "Exhausted", loadMore: vi.fn() });
    convexReactHarness.query(api.adminOperations.inspectRun).returns({
        run: {
            _id: "run-research",
            purpose: "research",
            lifecycleState: "awaiting_source_review",
            executionStatus: "paused",
            ownerVisitorId: "v1",
            createdAt: 1,
        },
        company: { legalName: "ServiceNow, Inc." },
    });
    convexReactHarness
        .mutation(api.adminOperations.setPaidWorkEnabled)
        .uses(setPaidWorkEnabled);
    convexReactHarness.mutation(api.admin.restoreQuota).uses(restoreQuota);
    convexReactHarness
        .mutation(api.admin.withdrawDossier)
        .uses(withdrawDossier);
    convexReactHarness
        .mutation(api.admin.reopenAtSourcesTimeLimit)
        .uses(reopenDossier);
});

test("presents dossier identity, dates and filters by purpose", async () => {
    render(<AdminPage search={dossiers} />);

    expect(
        screen.getByRole("heading", { name: "Administration" }),
    ).toBeTruthy();
    expect(await screen.findByText("ServiceNow, Inc.")).toBeTruthy();
    expect(screen.getByText("Review needed")).toBeTruthy();
    expect(screen.getAllByText(/^Updated /).length).toBeGreaterThan(0);
    expect(
        within(screen.getByRole("tabpanel", { name: "Research" })).getByText(
            "run-research",
        ),
    ).toBeTruthy();
    expect(screen.queryByText("run-evaluation")).toBeNull();
    expect(screen.getByRole("button", { name: "Status: All" })).toBeTruthy();
    expect(
        screen.getAllByRole("button", { name: "Period: All time" }).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Service: All" })).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Benchmarks" }));

    expect(await screen.findByText("Zeta Labs")).toBeTruthy();
    // The inactive purpose panel leaves the tree once its exit transition ends,
    // so only the evaluation dossier keeps an open control in the list.
    await waitFor(() =>
        expect(
            within(
                screen.getByRole("tabpanel", { name: "Benchmarks" }),
            ).getAllByRole("button", { name: "Open dossier" }),
        ).toHaveLength(1),
    );
});

test("keeps preparation detail behind a disclosure", async () => {
    render(<AdminPage search={dossiers} />);

    expect(
        screen.queryByText(/Assessment configuration unavailable/),
    ).toBeNull();

    fireEvent.click(
        await screen.findByRole("button", { name: "Preparation details" }),
    );

    expect(
        await screen.findByText("Assessment configuration unavailable"),
    ).toBeTruthy();
    expect(
        screen.getByText(/Preparation: blocked · provider_unavailable/),
    ).toBeTruthy();
});

test("opens a read-only dossier inspection with filterable receipts", async () => {
    render(<AdminPage search={dossiers} />);

    fireEvent.click(
        (
            await screen.findAllByRole("button", { name: "Open dossier" })
        )[0] as HTMLElement,
    );

    const dialog = await screen.findByRole("dialog", {
        name: "ServiceNow, Inc.",
    });
    expect(dialog.textContent).toContain("ServiceNow, Inc.");
    expect(dialog.textContent).toContain("Provider receipts");
    expect(screen.getByRole("button", { name: "Status: All" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Service: All" })).toBeTruthy();
    expect(
        screen.getByRole("button", { name: "Period: All time" }),
    ).toBeTruthy();
    expect(
        await within(dialog).findByText("Configuration missing"),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Status: All" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Failed" }));

    expect(await screen.findByText("1 of 2 receipts shown")).toBeTruthy();
    expect(within(dialog).queryByText("SEC public filings")).toBeNull();
});

test("filters receipts by period alongside status and service", async () => {
    render(<AdminPage search={dossiers} />);

    fireEvent.click(
        (
            await screen.findAllByRole("button", { name: "Open dossier" })
        )[0] as HTMLElement,
    );

    fireEvent.click(screen.getByRole("button", { name: "Period: All time" }));
    fireEvent.click(
        screen.getByRole("menuitemradio", { name: "Last 24 hours" }),
    );

    // Both fixture receipts predate the window, so nothing matches.
    expect(await screen.findByText("0 of 2 receipts shown")).toBeTruthy();

    fireEvent.click(
        screen.getByRole("button", { name: "Period: Last 24 hours" }),
    );
    fireEvent.click(screen.getByRole("menuitemradio", { name: "All time" }));

    expect(await screen.findByText("2 of 2 receipts shown")).toBeTruthy();
});

test("opens the provider attempt dialog from a receipt", async () => {
    render(<AdminPage search={dossiers} />);

    fireEvent.click(
        (
            await screen.findAllByRole("button", { name: "Open dossier" })
        )[0] as HTMLElement,
    );
    // Only the failed receipt stays after the filter, so one control matches.
    fireEvent.click(screen.getByRole("button", { name: "Status: All" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Failed" }));
    fireEvent.click(
        await screen.findByRole("button", { name: "Inspect attempt" }),
    );

    const attemptDialog = await screen.findByRole("dialog", {
        name: "Provider attempt",
    });
    expect(attemptDialog.textContent).toContain("Response received");
    expect(attemptDialog.textContent).toContain("503");
    expect(attemptDialog.textContent).toContain("Reported cost");
});

test("inspects a dossier from the provider activity list", async () => {
    render(<AdminPage />);

    fireEvent.click(screen.getByRole("tab", { name: "Activity & spend" }));

    expect(
        await screen.findByText("Independent web discovery · Search"),
    ).toBeTruthy();
    expect(screen.getByText(/Response received · HTTP 503/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Status: All" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Service: All" })).toBeTruthy();
    expect(
        screen.getByRole("button", { name: "Period: All time" }),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Period: All time" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Last 7 days" }));

    expect(
        await screen.findByText(
            "No loaded attempt matches the selected filters.",
        ),
    ).toBeTruthy();
    expect(
        screen.queryByRole("button", { name: "Inspect attempt" }),
    ).toBeNull();

    fireEvent.click(
        screen.getByRole("button", { name: "Period: Last 7 days" }),
    );
    fireEvent.click(screen.getByRole("menuitemradio", { name: "All time" }));

    const inspectButtons = await screen.findAllByRole("button", {
        name: "Inspect attempt",
    });
    fireEvent.click(inspectButtons[0] as HTMLElement);

    const attemptDialog = await screen.findByRole("dialog", {
        name: "Provider attempt",
    });
    expect(attemptDialog.textContent).toContain("Configuration missing");
});

test("filters dossiers by status and period", async () => {
    render(<AdminPage search={dossiers} />);

    expect(await screen.findByText("ServiceNow, Inc.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Status: All" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Complete" }));

    expect(await screen.findByText("0 of 1 dossiers shown")).toBeTruthy();
    expect(
        within(screen.getByRole("tabpanel", { name: "Research" })).queryByText(
            "run-research",
        ),
    ).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Status: Complete" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "All" }));
    fireEvent.click(
        screen.getAllByRole("button", {
            name: "Period: All time",
        })[0] as HTMLElement,
    );
    fireEvent.click(
        screen.getByRole("menuitemradio", { name: "Last 30 days" }),
    );

    expect(await screen.findByText("0 of 1 dossiers shown")).toBeTruthy();
});

test("shows reserved-for-validation slots and restores an unused reservation", async () => {
    render(
        <AdminPage search={{ section: "dossiers", view: "reservations" }} />,
    );

    expect(await screen.findByText("Reserved for validation")).toBeTruthy();
    const reservations = within(
        screen
            .getByText("Remaining reservations")
            .closest('[data-slot="card"]') as HTMLElement,
    );
    expect(screen.getByText("2 analyses remaining")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Quota: All" })).toBeTruthy();
    expect(
        reservations.getByRole("button", { name: "Period: All time" }),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Quota: All" }));
    fireEvent.click(
        screen.getByRole("menuitemradio", { name: "With remaining" }),
    );

    expect(screen.getByText("Access slot analyst-1")).toBeTruthy();
    // Slot names never appear in filter menus, unlike the badge wording.
    await waitFor(() =>
        expect(screen.queryByText("Access slot browser-test")).toBeNull(),
    );
    expect(await screen.findByText("1 of 2 reservations shown")).toBeTruthy();

    fireEvent.click(
        screen.getByRole("button", { name: "Quota: With remaining" }),
    );
    fireEvent.click(screen.getByRole("menuitemradio", { name: "All" }));
    fireEvent.click(
        reservations.getByRole("button", { name: "Period: All time" }),
    );
    fireEvent.click(
        screen.getByRole("menuitemradio", { name: "Last 24 hours" }),
    );

    expect(await screen.findByText("1 of 2 reservations shown")).toBeTruthy();
    await waitFor(() =>
        expect(screen.queryByText("Access slot browser-test")).toBeNull(),
    );

    fireEvent.click(
        reservations.getByRole("button", { name: "Period: Last 24 hours" }),
    );
    fireEvent.click(screen.getByRole("menuitemradio", { name: "All time" }));

    await screen.findByText("Access slot browser-test");

    fireEvent.click(screen.getByRole("button", { name: "Restore quota" }));
    fireEvent.change(screen.getByLabelText(/Reason for restoration/i), {
        target: { value: "Unused reservation approved for restoration." },
    });
    fireEvent.click(
        screen.getByRole("button", { name: "Confirm restoration" }),
    );

    await waitFor(() =>
        expect(restoreQuota).toHaveBeenCalledWith({
            runId: "run-unused",
            reason: "Unused reservation approved for restoration.",
        }),
    );
});

test("names review decisions and opens the dossier inspection", async () => {
    render(<AdminPage search={{ section: "dossiers", view: "reviews" }} />);

    expect(await screen.findByText("Source review")).toBeTruthy();
    expect(screen.getByText("Approved")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/source_review/);

    const decisions = within(
        screen
            .getByText("Recent review decisions")
            .closest('[data-slot="card"]') as HTMLElement,
    );
    fireEvent.click(decisions.getByRole("button", { name: "Open dossier" }));

    const dialog = await screen.findByRole("dialog", {
        name: "ServiceNow, Inc.",
    });
    expect(dialog.textContent).toContain("Provider receipts");
});

test("confirms a paid-work change before applying it", async () => {
    setPaidWorkEnabled.mockResolvedValue({ enabled: false });
    render(
        <>
            <AdminPage />
            <Toaster />
        </>,
    );

    const paidWork = screen.getByRole("switch", { name: "Paid work" });
    expect(paidWork.getAttribute("aria-checked")).toBe("true");

    fireEvent.click(paidWork);
    fireEvent.change(await screen.findByLabelText(/Reason for this change/i), {
        target: { value: "Pause Exa while spend is investigated." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Stop paid work" }));

    await waitFor(() =>
        expect(setPaidWorkEnabled).toHaveBeenCalledWith({
            enabled: false,
            reason: "Pause Exa while spend is investigated.",
        }),
    );
    expect(await screen.findByText(/Paid work disabled/)).toBeTruthy();
});

test("keeps the confirmation open and reports a failed paid-work change", async () => {
    const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
    setPaidWorkEnabled.mockRejectedValue(new Error("Not authorized"));
    render(
        <>
            <AdminPage />
            <Toaster />
        </>,
    );

    fireEvent.click(screen.getByRole("switch", { name: "Paid work" }));
    fireEvent.change(await screen.findByLabelText(/Reason for this change/i), {
        target: { value: "Pause Exa while spend is investigated." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Stop paid work" }));

    expect(
        await screen.findByText(/We couldn’t update paid work/i),
    ).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "Stop paid work" })).toBeTruthy();
    consoleError.mockRestore();
});

test("restricts administration to the invited administrator", () => {
    convexReactHarness
        .query(api.visitors.current)
        .returns({ role: "analyst", status: "active" });

    render(<AdminPage />);

    expect(screen.getByText("Administrator access required")).toBeTruthy();
    expect(screen.queryByRole("switch", { name: "Paid work" })).toBeNull();
});

test("shows a loading state while the administrator is resolved", () => {
    convexReactHarness.query(api.visitors.current).returns(undefined);

    render(<AdminPage />);

    expect(screen.getByLabelText("Loading administration")).toBeTruthy();
});

test("retries administration queries after a load failure", () => {
    const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
    const visitorQuery = convexReactHarness.query(api.visitors.current);
    const operationsQuery = convexReactHarness.query(api.adminOperations.get);
    visitorQuery.throws(new Error("Administration query failed"));
    operationsQuery.throws(new Error("Administration query failed"));

    render(<AdminPage />);

    expect(screen.getByText("Administration unavailable")).toBeTruthy();
    visitorQuery.returns(adminVisitor as never);
    operationsQuery.returns(operations as never);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByText("Administration")).toBeTruthy();
    consoleError.mockRestore();
});

test("the overview reports nothing to do on a healthy deployment", async () => {
    convexReactHarness
        .paginatedQuery(api.adminOperations.listRestorableRunsPage)
        .returns({ results: [], status: "Exhausted", loadMore: vi.fn() });
    render(<AdminPage />);
    expect(await screen.findByText("Nothing needs attention")).toBeTruthy();
    expect(screen.getByText("Recent spend")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/_|compatible/);
});

test("the overview lists a restorable reservation with its next step", async () => {
    render(<AdminPage />);
    expect(
        await screen.findByText("1 unused reservation can be restored"),
    ).toBeTruthy();
    expect(
        screen.getByRole("button", { name: "Review reservations" }),
    ).toBeTruthy();
});

test("the overview refreshes a stale model an agent uses, in place", async () => {
    convexReactHarness.query(api.modelConfiguration.list).returns({
        ...healthyModels,
        models: [{ ...preparedModel, compatible: false }],
    } as never);
    render(<AdminPage />);
    expect(
        await screen.findByText("GLM-5.3-Flash needs an update"),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Update model" }));
    await waitFor(() =>
        expect(refreshProfiles).toHaveBeenCalledWith({
            catalogId: "glm",
            cursor: null,
        }),
    );
});

test.each([
    false,
    true,
])("the overview keeps historical profile progress visible after the model attention item clears (failure: %s)", async (failure) => {
    let finish!: (value: {
        isDone: boolean;
        continueCursor: string | null;
    }) => void;
    let fail!: (error: Error) => void;
    const pending = new Promise<{
        isDone: boolean;
        continueCursor: string | null;
    }>((resolve, reject) => {
        finish = resolve;
        fail = reject;
    });
    refreshProfiles
        .mockResolvedValueOnce({ isDone: false, continueCursor: "historical" })
        .mockImplementationOnce(() => pending);
    convexReactHarness
        .paginatedQuery(api.adminOperations.listRestorableRunsPage)
        .returns({ results: [], status: "Exhausted", loadMore: vi.fn() });
    convexReactHarness.query(api.modelConfiguration.list).returns({
        ...healthyModels,
        models: [{ ...preparedModel, compatible: false }],
    } as never);
    const view = render(<AdminPage />);
    fireEvent.click(
        await screen.findByRole("button", { name: "Update model" }),
    );
    await waitFor(() => expect(refreshProfiles).toHaveBeenCalledTimes(2));
    convexReactHarness
        .query(api.modelConfiguration.list)
        .returns(healthyModels as never);
    view.rerender(<AdminPage />);
    try {
        expect(
            screen.getByRole("status", { name: "Updating model profiles" })
                .textContent,
        ).toContain(preparedModel.label);
    } finally {
        await act(async () =>
            failure
                ? fail(new Error("model_profile_version_conflict"))
                : finish({ isDone: true, continueCursor: null }),
        );
    }
    expect(
        screen.queryByRole("status", { name: "Updating model profiles" }),
    ).toBeNull();
    if (failure) {
        expect(screen.getByRole("alert").textContent).not.toMatch(
            /model_profile_version_conflict|stays unavailable/,
        );
        fireEvent.click(
            screen.getByRole("button", {
                name: `Retry ${preparedModel.label}`,
            }),
        );
        await waitFor(() => expect(refreshProfiles).toHaveBeenCalledTimes(3));
        await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    }
});

test("sections and the open dossier are reported to the route", async () => {
    const onSearchChange = vi.fn();
    const { rerender } = render(
        <AdminPage search={{}} onSearchChange={onSearchChange} />,
    );
    fireEvent.click(await screen.findByRole("tab", { name: "Dossiers" }));
    expect(onSearchChange).toHaveBeenLastCalledWith({ section: "dossiers" });
    rerender(<AdminPage search={dossiers} onSearchChange={onSearchChange} />);
    fireEvent.click(
        within(screen.getByRole("tabpanel", { name: "Research" })).getByRole(
            "button",
            { name: "Open dossier" },
        ),
    );
    expect(onSearchChange).toHaveBeenLastCalledWith({
        section: "dossiers",
        dossier: "run-research",
    });
    rerender(
        <AdminPage
            search={{ ...dossiers, dossier: "run-research" as never }}
            onSearchChange={onSearchChange}
        />,
    );
    expect(
        await screen.findByRole("dialog", { name: "ServiceNow, Inc." }),
    ).toBeTruthy();
});

test("a withdrawable dossier is withdrawn from its panel only with a reason", async () => {
    withdrawDossier.mockResolvedValue(null);
    convexReactHarness.query(api.adminOperations.inspectRun).returns({
        run: {
            _id: "run-research",
            purpose: "research",
            lifecycleState: "discovering_sources",
            executionStatus: "failed",
            ownerVisitorId: "v1",
            reservationStatus: "consumed",
            createdAt: 1,
        },
        company: { legalName: "ServiceNow, Inc." },
    } as never);
    render(
        <AdminPage
            search={{ ...dossiers, dossier: "run-research" as never }}
        />,
    );
    const panel = await screen.findByRole("dialog", {
        name: "ServiceNow, Inc.",
    });
    expect(panel.textContent).toContain("Research ·");
    fireEvent.click(
        within(panel).getByRole("button", { name: "Withdraw dossier" }),
    );
    const confirm = await screen.findByRole("button", {
        name: "Confirm withdrawal",
    });
    fireEvent.change(screen.getByLabelText("Reason for withdrawal"), {
        target: { value: "too short" },
    });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Reason for withdrawal"), {
        target: { value: "  Failed by the time-limit defect.  " },
    });
    fireEvent.click(confirm);
    await waitFor(() =>
        expect(withdrawDossier).toHaveBeenCalledWith({
            runId: "run-research",
            reason: "Failed by the time-limit defect.",
        }),
    );
});

test("a dossier failed at its Sources deadline is reopened from its panel only with a reason", async () => {
    reopenDossier.mockResolvedValue({ reopened: true });
    convexReactHarness.query(api.adminOperations.inspectRun).returns({
        run: {
            _id: "run-research",
            purpose: "research",
            lifecycleState: "discovering_sources",
            executionStatus: "failed",
            ownerVisitorId: "v1",
            reservationStatus: "consumed",
            createdAt: 1,
        },
        company: { legalName: "ServiceNow, Inc." },
        reopenable: true,
    } as never);
    render(
        <>
            <AdminPage
                search={{ ...dossiers, dossier: "run-research" as never }}
            />
            <Toaster />
        </>,
    );
    const panel = await screen.findByRole("dialog", {
        name: "ServiceNow, Inc.",
    });
    fireEvent.click(
        within(panel).getByRole("button", { name: "Reopen at time limit" }),
    );
    const confirm = await screen.findByRole("button", {
        name: "Confirm reopening",
    });
    fireEvent.change(screen.getByLabelText("Reason for reopening"), {
        target: { value: "short" },
    });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Reason for reopening"), {
        target: { value: "  Analyst asked to keep the sources.  " },
    });
    fireEvent.click(confirm);
    await waitFor(() =>
        expect(reopenDossier).toHaveBeenCalledWith({
            runId: "run-research",
            reason: "Analyst asked to keep the sources.",
        }),
    );
    expect(
        await screen.findByText(
            "Dossier reopened. The analyst can now continue preparation or use what's prepared.",
        ),
    ).toBeTruthy();
});

test("a dossier that cannot be reopened offers no reopening", async () => {
    render(
        <AdminPage
            search={{ ...dossiers, dossier: "run-research" as never }}
        />,
    );
    const panel = await screen.findByRole("dialog", {
        name: "ServiceNow, Inc.",
    });
    expect(
        within(panel).queryByRole("button", { name: "Reopen at time limit" }),
    ).toBeNull();
});

test("the overview sends reservations to their own view", async () => {
    const onSearchChange = vi.fn();
    render(<AdminPage search={{}} onSearchChange={onSearchChange} />);
    fireEvent.click(
        await screen.findByRole("button", { name: "Review reservations" }),
    );
    expect(onSearchChange).toHaveBeenLastCalledWith({
        section: "dossiers",
        view: "reservations",
    });
});

test("on a wide screen the selected dossier is read beside its list", async () => {
    const matchMedia = mockWideScreen();
    render(
        <AdminPage
            search={{ ...dossiers, dossier: "run-research" as never }}
        />,
    );
    expect(
        await screen.findByRole("heading", { name: "ServiceNow, Inc." }),
    ).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    const list = screen.getByRole("tabpanel", { name: "Research" });
    expect(
        within(list)
            .getByText("ServiceNow, Inc.")
            .closest('[aria-current="true"]'),
    ).toBeTruthy();
    matchMedia.mockRestore();
});

test("a list that can load more shows its real total beside Load more", async () => {
    convexReactHarness
        .paginatedQuery(api.adminOperations.listRunsPage)
        .returns({
            results: [researchRun],
            status: "CanLoadMore",
            loadMore: vi.fn(),
        } as never);
    convexReactHarness
        .query(api.adminOperations.countRuns)
        .returns({ count: 37, capped: false });
    render(<AdminPage search={dossiers} />);
    const list = await screen.findByRole("tabpanel", { name: "Research" });
    expect(within(list).getByText("1 of 37 dossiers shown")).toBeTruthy();
    expect(
        within(list).getByRole("button", { name: "Load more dossiers" }),
    ).toBeTruthy();
});

test("switching purpose closes a dossier opened from another list", async () => {
    const onSearchChange = vi.fn();
    const matchMedia = mockWideScreen();
    render(
        <AdminPage
            search={{ ...dossiers, dossier: "run-research" as never }}
            onSearchChange={onSearchChange}
        />,
    );
    fireEvent.click(await screen.findByRole("tab", { name: "Benchmarks" }));
    expect(onSearchChange).toHaveBeenLastCalledWith({
        section: "dossiers",
        purpose: "evaluation",
    });
    matchMedia.mockRestore();
});

test("a dossier opened from Benchmarks keeps its purpose in the address", async () => {
    const onSearchChange = vi.fn();
    render(
        <AdminPage
            search={{ ...dossiers, purpose: "evaluation" }}
            onSearchChange={onSearchChange}
        />,
    );
    const list = await screen.findByRole("tabpanel", { name: "Benchmarks" });
    fireEvent.click(within(list).getByRole("button", { name: "Open dossier" }));
    expect(onSearchChange).toHaveBeenLastCalledWith({
        section: "dossiers",
        purpose: "evaluation",
        dossier: "run-evaluation",
    });
});

test("a dossier opened under the wrong list moves the view to its own purpose", async () => {
    const onSearchChange = vi.fn();
    convexReactHarness.query(api.adminOperations.inspectRun).returns({
        run: {
            _id: "run-evaluation",
            purpose: "evaluation",
            lifecycleState: "completed",
            executionStatus: "completed",
            createdAt: 1,
        },
        company: { legalName: "Zeta Labs" },
    } as never);
    render(
        <AdminPage
            search={{ ...dossiers, dossier: "run-evaluation" as never }}
            onSearchChange={onSearchChange}
        />,
    );
    await waitFor(() =>
        expect(onSearchChange).toHaveBeenCalledWith({
            section: "dossiers",
            purpose: "evaluation",
            dossier: "run-evaluation",
        }),
    );
});
