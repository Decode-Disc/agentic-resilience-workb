import { api } from "@convex/_generated/api";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";

const { setPaidWorkEnabled, restoreQuota } = vi.hoisted(() => ({
    setPaidWorkEnabled: vi.fn(),
    restoreQuota: vi.fn(),
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

const adminVisitor = { role: "admin", status: "active" };

const researchRun = {
    runId: "run-research",
    lifecycleState: "awaiting_source_review",
    executionStatus: "paused",
    updatedAt: 1,
    preparation: {
        preparationId: "prep-1",
        status: "blocked",
        configurationCheck: { available: false, checkedAt: 1 },
    },
};

const evaluationRun = {
    runId: "run-evaluation",
    lifecycleState: "completed",
    executionStatus: "completed",
    updatedAt: 2,
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
    providerCalls: [
        {
            runId: "run-research",
            service: "exa",
            operation: "search",
            status: "failed",
            errorCode: "exa_not_configured",
            attempt: 1,
            dispatchOutcome: "response_received",
            httpStatus: 503,
            createdAt: 1,
        },
    ],
    reservations: [
        {
            visitorId: "v1",
            role: "analyst",
            remaining: 2,
            slotKey: "analyst-1",
            reservedForTesting: false,
        },
        {
            visitorId: "v2",
            role: "analyst",
            remaining: 0,
            slotKey: "browser-test",
            reservedForTesting: true,
        },
    ],
};

beforeEach(() => {
    convexReactHarness.reset();
    setPaidWorkEnabled.mockReset();
    restoreQuota.mockReset();
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
            results: [
                {
                    _id: "call-1",
                    service: "exa",
                    operation: "search",
                    status: "succeeded",
                    attempt: 1,
                    createdAt: 1,
                },
            ],
            status: "Exhausted",
            loadMore: vi.fn(),
        });
    convexReactHarness.query(api.adminOperations.inspectRun).returns({
        run: {
            _id: "run-research",
            purpose: "research",
            lifecycleState: "awaiting_source_review",
            executionStatus: "paused",
            ownerVisitorId: "v1",
            createdAt: 1,
        },
        company: { legalName: "Acme Systems" },
    });
    convexReactHarness
        .mutation(api.adminOperations.setPaidWorkEnabled)
        .uses(setPaidWorkEnabled);
    convexReactHarness.mutation(api.admin.restoreQuota).uses(restoreQuota);
});

test("presents administration sections and filters dossiers by purpose", async () => {
    render(<AdminPage />);

    expect(
        screen.getByRole("heading", { name: "Administration" }),
    ).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Dossiers" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Reservations" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Provider activity" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Review decisions" })).toBeTruthy();

    expect(await screen.findByText("run-research")).toBeTruthy();
    expect(screen.queryByText("run-evaluation")).toBeNull();
    expect(
        screen.getByText("Assessment configuration unavailable"),
    ).toBeTruthy();
    expect(screen.getByText("Waiting for review")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "Benchmarks" }));

    expect(await screen.findByText("run-evaluation")).toBeTruthy();
    // The inactive purpose panel leaves the tree once its exit transition ends,
    // so only the evaluation dossier keeps an actionable inspection control.
    await waitFor(() =>
        expect(
            screen.getAllByRole("button", { name: "Inspect dossier" }),
        ).toHaveLength(1),
    );
});

test("opens a read-only dossier inspection with its provider receipts", async () => {
    render(<AdminPage />);

    fireEvent.click(
        await screen.findByRole("button", { name: "Inspect dossier" }),
    );

    const dialog = await screen.findByRole("dialog", {
        name: "Dossier inspection",
    });
    expect(dialog.textContent).toContain("Acme Systems");
    expect(dialog.textContent).toContain("Independent web discovery");
    expect(dialog.textContent).toContain("Provider receipts");
    expect(
        screen.queryByRole("button", { name: /resume|retry|start/i }),
    ).toBeNull();
});

test("shows reserved-for-validation slots and restores an unused reservation", async () => {
    render(<AdminPage />);

    fireEvent.click(screen.getByRole("tab", { name: "Reservations" }));

    expect(await screen.findByText("Reserved for validation")).toBeTruthy();
    expect(screen.getByText("2 analyses remaining")).toBeTruthy();

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

test("names review decisions instead of exposing stored keys", async () => {
    render(<AdminPage />);

    fireEvent.click(screen.getByRole("tab", { name: "Review decisions" }));

    expect(await screen.findByText("Source review")).toBeTruthy();
    expect(screen.getByText("Approved")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/source_review/);
});

test("lists provider attempts with their diagnosis", async () => {
    render(<AdminPage />);

    fireEvent.click(screen.getByRole("tab", { name: "Provider activity" }));

    expect(await screen.findByText("Configuration missing")).toBeTruthy();
    expect(screen.getByText(/Response received · HTTP 503/)).toBeTruthy();
    expect(screen.getByText(/exa_not_configured/)).toBeTruthy();
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
