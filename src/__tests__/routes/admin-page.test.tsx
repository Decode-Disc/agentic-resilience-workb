import { api } from "@convex/_generated/api";
import {
    fireEvent,
    render,
    screen,
    waitFor,
    within,
} from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";

const { setPaidWorkEnabled, restoreQuota, withdrawDossier } = vi.hoisted(
    () => ({
        setPaidWorkEnabled: vi.fn(),
        restoreQuota: vi.fn(),
        withdrawDossier: vi.fn(),
    }),
);

vi.mock("convex/react", async () => {
    const { convexReactHarness } = await import(
        "@/__tests__/helpers/convex-react-harness"
    );
    return convexReactHarness.module;
});

import { convexReactHarness } from "@/__tests__/helpers/convex-react-harness";
import { AdminPage } from "@/components/admin/admin-page";
import { Toaster } from "@/components/ui/sonner";

const adminVisitor = { role: "admin", status: "active" };

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
    convexReactHarness.query(api.visitors.current).returns(adminVisitor);
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
});

test("presents dossier identity, dates and filters by purpose", async () => {
    render(<AdminPage />);

    expect(
        screen.getByRole("heading", { name: "Administration" }),
    ).toBeTruthy();
    expect(await screen.findByText("ServiceNow, Inc.")).toBeTruthy();
    expect(screen.getByText("Waiting for review")).toBeTruthy();
    expect(screen.getByText(/Updated .* · Created /)).toBeTruthy();
    expect(screen.getByText("run-research")).toBeTruthy();
    expect(screen.queryByText("run-evaluation")).toBeNull();
    expect(screen.getByRole("button", { name: "Status: All" })).toBeTruthy();
    expect(
        screen.getByRole("button", { name: "Period: All time" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Service: All" })).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Benchmarks" }));

    expect(await screen.findByText("Zeta Labs")).toBeTruthy();
    // The inactive purpose panel leaves the tree once its exit transition ends,
    // so only the evaluation dossier keeps an actionable inspection control.
    await waitFor(() =>
        expect(
            screen.getAllByRole("button", { name: "Inspect dossier" }),
        ).toHaveLength(1),
    );
});

test("keeps preparation detail behind a disclosure", async () => {
    render(<AdminPage />);

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
    render(<AdminPage />);

    fireEvent.click(
        await screen.findByRole("button", { name: "Inspect dossier" }),
    );

    const dialog = await screen.findByRole("dialog", {
        name: "Dossier inspection",
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

    expect(
        await screen.findByText(
            (_, element) =>
                element?.textContent ===
                "1 of 2 loaded receipts shown. Filters apply to loaded receipts.",
        ),
    ).toBeTruthy();
    expect(within(dialog).queryByText("SEC public filings")).toBeNull();
});

test("filters receipts by period alongside status and service", async () => {
    render(<AdminPage />);

    fireEvent.click(
        await screen.findByRole("button", { name: "Inspect dossier" }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Period: All time" }));
    fireEvent.click(
        screen.getByRole("menuitemradio", { name: "Last 24 hours" }),
    );

    // Both fixture receipts predate the window, so nothing matches.
    expect(
        await screen.findByText(
            (_, element) =>
                element?.textContent ===
                "0 of 2 loaded receipts shown. Filters apply to loaded receipts.",
        ),
    ).toBeTruthy();

    fireEvent.click(
        screen.getByRole("button", { name: "Period: Last 24 hours" }),
    );
    fireEvent.click(screen.getByRole("menuitemradio", { name: "All time" }));

    expect(
        await screen.findByText(
            (_, element) =>
                element?.textContent ===
                "2 of 2 loaded receipts shown. Filters apply to loaded receipts.",
        ),
    ).toBeTruthy();
});

test("opens the provider attempt dialog from a receipt", async () => {
    render(<AdminPage />);

    fireEvent.click(
        await screen.findByRole("button", { name: "Inspect dossier" }),
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

    fireEvent.click(screen.getByRole("tab", { name: "Provider activity" }));

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
    render(<AdminPage />);

    expect(await screen.findByText("ServiceNow, Inc.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Status: All" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Complete" }));

    expect(
        await screen.findByText(
            (_, element) =>
                element?.textContent ===
                "0 of 1 loaded dossiers shown. Filters apply to loaded dossiers.",
        ),
    ).toBeTruthy();
    expect(screen.queryByText("run-research")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Status: Complete" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "All" }));
    fireEvent.click(screen.getByRole("button", { name: "Period: All time" }));
    fireEvent.click(
        screen.getByRole("menuitemradio", { name: "Last 30 days" }),
    );

    expect(
        await screen.findByText(
            (_, element) =>
                element?.textContent ===
                "0 of 1 loaded dossiers shown. Filters apply to loaded dossiers.",
        ),
    ).toBeTruthy();
});

test("shows reserved-for-validation slots and restores an unused reservation", async () => {
    render(<AdminPage />);

    fireEvent.click(screen.getByRole("tab", { name: "Reservations" }));

    expect(await screen.findByText("Reserved for validation")).toBeTruthy();
    expect(screen.getByText("2 analyses remaining")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Quota: All" })).toBeTruthy();
    expect(
        screen.getByRole("button", { name: "Period: All time" }),
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
    expect(
        await screen.findByText(
            (_, element) =>
                element?.textContent ===
                "1 of 2 loaded reservations shown. Filters apply to loaded reservations.",
        ),
    ).toBeTruthy();

    fireEvent.click(
        screen.getByRole("button", { name: "Quota: With remaining" }),
    );
    fireEvent.click(screen.getByRole("menuitemradio", { name: "All" }));
    fireEvent.click(screen.getByRole("button", { name: "Period: All time" }));
    fireEvent.click(
        screen.getByRole("menuitemradio", { name: "Last 24 hours" }),
    );

    expect(
        await screen.findByText(
            (_, element) =>
                element?.textContent ===
                "1 of 2 loaded reservations shown. Filters apply to loaded reservations.",
        ),
    ).toBeTruthy();
    await waitFor(() =>
        expect(screen.queryByText("Access slot browser-test")).toBeNull(),
    );

    fireEvent.click(
        screen.getByRole("button", { name: "Period: Last 24 hours" }),
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
    render(<AdminPage />);

    fireEvent.click(screen.getByRole("tab", { name: "Review decisions" }));

    expect(await screen.findByText("Source review")).toBeTruthy();
    expect(screen.getByText("Approved")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/source_review/);

    fireEvent.click(
        await screen.findByRole("button", { name: "Inspect dossier" }),
    );

    const dialog = await screen.findByRole("dialog", {
        name: "Dossier inspection",
    });
    expect(dialog.textContent).toContain("ServiceNow, Inc.");
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
    fireEvent.click(screen.getByRole("button", { name: "Confirm disable" }));

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
    fireEvent.click(screen.getByRole("button", { name: "Confirm disable" }));

    expect(
        await screen.findByText(/We couldn’t update paid work/i),
    ).toBeTruthy();
    expect(
        screen.getByRole("dialog", { name: "Disable paid work" }),
    ).toBeTruthy();
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
