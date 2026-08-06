import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";

const { useQuery, useMutation, setPaidWorkEnabled, restoreQuota } = vi.hoisted(
    () => ({
        useQuery: vi.fn(),
        useMutation: vi.fn(),
        setPaidWorkEnabled: vi.fn(),
        restoreQuota: vi.fn(),
    }),
);

vi.mock("convex/react", () => ({ useQuery, useMutation }));

import { OperationsPage } from "@/components/admin/operations-page";

beforeEach(() => {
    useQuery.mockReset();
    useMutation.mockReset();
    setPaidWorkEnabled.mockReset();
    restoreQuota.mockReset();
    useMutation.mockImplementation(() =>
        useMutation.mock.calls.length % 2 === 1
            ? setPaidWorkEnabled
            : restoreQuota,
    );
});

test("renders the bounded admin projection and confirms paid-work changes", async () => {
    useQuery.mockImplementation(() =>
        useQuery.mock.calls.length % 2 === 1
            ? { role: "admin", status: "active" }
            : {
                  paidWork: { enabled: true },
                  runs: [
                      {
                          runId: "run-1",
                          lifecycleState: "awaiting_source_review",
                          executionStatus: "paused",
                          updatedAt: 1,
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
                      },
                  ],
                  reservations: [
                      { visitorId: "v1", role: "analyst", remaining: 2 },
                  ],
                  restorableRuns: [
                      {
                          runId: "run-unused",
                          ownerVisitorId: "v1",
                          createdAt: 1,
                      },
                  ],
              },
    );
    setPaidWorkEnabled.mockResolvedValue({ enabled: false });
    render(<OperationsPage />);

    expect(screen.getByText(/Operations control/i)).toBeTruthy();
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
    useQuery.mockImplementation(() =>
        useQuery.mock.calls.length % 2 === 1
            ? { role: "analyst", status: "active" }
            : undefined,
    );
    render(<OperationsPage />);
    expect(screen.getByText(/Admin access required/i)).toBeTruthy();
});
