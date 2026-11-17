import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";

vi.mock("convex/react", async () => {
    const { convexReactHarness } = await import(
        "@/__tests__/helpers/convex-react-harness"
    );
    return convexReactHarness.module;
});

import { convexReactHarness } from "@/__tests__/helpers/convex-react-harness";
import { AdminProviderCallInspection } from "@/components/admin/admin-provider-call-inspection";

const retry = vi.fn(async () => ({ scheduled: true }));
const call = {
    _creationTime: 1,
    _id: "billing-call" as Id<"providerCalls">,
    service: "model" as const,
    operation: "agent_reasoning",
    status: "started" as const,
    attempt: 1,
    createdAt: 1,
    providerObservation: { generationId: "gen-fixture", observedAt: 1 },
    billing: {
        state: "unavailable" as const,
        attempt: 1,
        updatedAt: 1,
        retryAt: 1,
        reason: "not_found" as const,
    },
};

beforeEach(() => {
    convexReactHarness.reset();
    retry.mockClear();
    convexReactHarness.mutation(api.providerCalls.retryBilling).uses(retry);
});

test("an administrator can recheck cost while the interrupted response remains incomplete", async () => {
    convexReactHarness
        .query(api.adminOperations.inspectProviderCall)
        .returns(call);
    const view = render(
        <AdminProviderCallInspection providerCallId={call._id} />,
    );
    expect(screen.getByText("Cost unavailable")).toBeTruthy();
    expect(screen.getByText("Response incomplete")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Check cost again" }));
    await waitFor(() =>
        expect(retry).toHaveBeenCalledWith({ providerCallId: call._id }),
    );
    convexReactHarness.query(api.adminOperations.inspectProviderCall).returns({
        ...call,
        reportedCost: 0.0002137,
        billing: { state: "confirmed", attempt: 2, updatedAt: 2 },
    });
    view.rerender(<AdminProviderCallInspection providerCallId={call._id} />);
    expect(screen.getByText("Cost confirmed: $0.0002137")).toBeTruthy();
    expect(screen.getByText("Response incomplete")).toBeTruthy();
    expect(
        screen.queryByRole("button", { name: "Check cost again" }),
    ).toBeNull();
});
