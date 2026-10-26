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
import { OperationsPage } from "@/components/admin/operations-page";

beforeEach(() => {
    convexReactHarness.reset();
    setPaidWorkEnabled.mockReset();
    restoreQuota.mockReset();
    convexReactHarness
        .paginatedQuery(api.adminOperations.listRunsPage)
        .returns({ results: [], status: "Exhausted", loadMore: vi.fn() });
    convexReactHarness
        .paginatedQuery(api.adminOperations.listRestorableRunsPage)
        .returns({ results: [], status: "Exhausted", loadMore: vi.fn() });
    convexReactHarness
        .mutation(api.adminOperations.setPaidWorkEnabled)
        .uses(setPaidWorkEnabled);
    convexReactHarness.mutation(api.admin.restoreQuota).uses(restoreQuota);
});

test("renders the bounded admin projection and confirms paid-work changes", async () => {
    const visitor = { role: "admin", status: "active" };
    const operations = {
        paidWork: { enabled: true },
        runs: [
            {
                runId: "run-1",
                lifecycleState: "awaiting_source_review",
                executionStatus: "paused",
                updatedAt: 1,
                preparation: {
                    preparationId: "prep-1",
                    status: "blocked",
                    configurationCheck: { available: false, checkedAt: 1 },
                },
            },
        ],
        checkpoints: [],
        providerCalls: [
            {
                service: "exa",
                operation: "search",
                status: "failed",
                errorCode: "exa_not_configured",
                createdAt: 1,
                attempt: 1,
                dispatchOutcome: "response_received",
                httpStatus: 503,
            },
        ],
        reservations: [{ visitorId: "v1", role: "analyst", remaining: 2 }],
        restorableRuns: [
            {
                runId: "run-unused",
                ownerVisitorId: "v1",
                createdAt: 1,
            },
        ],
    };
    convexReactHarness.query(api.visitors.current).returns(visitor);
    convexReactHarness.query(api.adminOperations.get).returns(operations);
    convexReactHarness
        .paginatedQuery(api.adminOperations.listRunsPage)
        .returns({
            results: operations.runs,
            status: "Exhausted",
            loadMore: vi.fn(),
        });
    convexReactHarness
        .paginatedQuery(api.adminOperations.listRestorableRunsPage)
        .returns({
            results: operations.restorableRuns,
            status: "Exhausted",
            loadMore: vi.fn(),
        });
    setPaidWorkEnabled.mockResolvedValue({ enabled: false });
    render(<OperationsPage />);

    expect(screen.getByText(/Operations control/i)).toBeTruthy();
    expect(
        screen.getByText("Assessment configuration unavailable"),
    ).toBeTruthy();
    expect(screen.getByText(/Response received · HTTP 503/)).toBeTruthy();
    expect(screen.getByText("Review source set")).toBeTruthy();
    expect(screen.getByText("Waiting for review")).toBeTruthy();
    expect(screen.getByText(/Independent web discovery/i)).toBeTruthy();
    expect(screen.getByText(/Configuration missing/i)).toBeTruthy();
    expect(screen.getByText(/exa_not_configured/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Disable paid work/i }));
    fireEvent.change(screen.getByLabelText(/Operational reason/i), {
        target: { value: "Pause Exa while spend is investigated." },
    });
    fireEvent.click(screen.getByRole("button", { name: /Confirm disable/i }));

    await waitFor(() =>
        expect(setPaidWorkEnabled).toHaveBeenCalledWith({
            enabled: false,
            reason: "Pause Exa while spend is investigated.",
        }),
    );

    fireEvent.click(screen.getByRole("button", { name: /Restore quota/i }));
    fireEvent.change(screen.getByLabelText(/Restoration reason/i), {
        target: { value: "Unused reservation approved for restoration." },
    });
    fireEvent.click(
        screen.getByRole("button", { name: /Confirm restoration/i }),
    );

    await waitFor(() =>
        expect(restoreQuota).toHaveBeenCalledWith({
            runId: "run-unused",
            reason: "Unused reservation approved for restoration.",
        }),
    );
});

test("does not expose operations to an analyst", () => {
    const visitor = { role: "analyst", status: "active" };
    convexReactHarness.query(api.visitors.current).returns(visitor);
    convexReactHarness.query(api.adminOperations.get).returns(undefined);
    render(<OperationsPage />);
    expect(screen.getByText(/Admin access required/i)).toBeTruthy();
});

test("retries operations queries after a load failure", () => {
    const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
    const visitor = { role: "admin", status: "active" };
    const operations = {
        paidWork: { enabled: true },
        runs: [],
        checkpoints: [],
        providerCalls: [],
        reservations: [],
        restorableRuns: [],
    };
    const visitorQuery = convexReactHarness.query(api.visitors.current);
    const operationsQuery = convexReactHarness.query(api.adminOperations.get);
    visitorQuery.throws(new Error("Operations query failed"));
    operationsQuery.throws(new Error("Operations query failed"));

    render(<OperationsPage />);

    expect(screen.getByText("Operations unavailable")).toBeTruthy();
    visitorQuery.returns(visitor as never);
    operationsQuery.returns(operations as never);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByText("Operations control")).toBeTruthy();
    consoleError.mockRestore();
});
