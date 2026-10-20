import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
    afterAll,
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    test,
    vi,
} from "vitest";

const { claimInvitation, useAction } = vi.hoisted(() => ({
    claimInvitation: vi.fn(),
    useAction: vi.fn(),
}));

vi.mock(import("convex/react"), () => ({ useAction }));

import {
    InvitationAccessProvider,
    useInvitationAccess,
} from "@/components/workspace/invitation-access-context";

class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
}

function TestConsumer({
    onSuccess,
    onCancel,
}: {
    onSuccess?: () => void;
    onCancel?: () => void;
}) {
    const { openInvitationDrawer, isOpen } = useInvitationAccess();
    return (
        <div>
            <span data-testid="drawer-status">
                {isOpen ? "Open" : "Closed"}
            </span>
            <button
                type="button"
                onClick={() => openInvitationDrawer({ onSuccess, onCancel })}>
                Open Access Drawer
            </button>
        </div>
    );
}

describe("InvitationAccessContext", () => {
    beforeAll(() => {
        vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    });

    beforeEach(() => {
        claimInvitation.mockReset();
        useAction.mockReset();
        useAction.mockReturnValue(claimInvitation);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    afterAll(() => {
        vi.unstubAllGlobals();
    });

    test("successful admission closes the drawer without invoking cancellation", async () => {
        const onSuccess = vi.fn();
        const onCancel = vi.fn();
        claimInvitation.mockResolvedValue({
            visitorId: "visitor-1",
            role: "analyst",
        });

        render(
            <InvitationAccessProvider>
                <TestConsumer onSuccess={onSuccess} onCancel={onCancel} />
            </InvitationAccessProvider>,
        );

        expect(screen.getByTestId("drawer-status").textContent).toBe("Closed");

        fireEvent.click(
            screen.getByRole("button", { name: /Open Access Drawer/i }),
        );

        expect(screen.getByTestId("drawer-status").textContent).toBe("Open");

        const accessCode = screen.getByLabelText(/Access code/i);
        fireEvent.change(accessCode, {
            target: { value: "4207" },
        });
        fireEvent.submit(
            screen.getByRole("form", { name: /Workspace access/i }),
        );

        await waitFor(() =>
            expect(claimInvitation).toHaveBeenCalledWith({
                code: "4207",
            }),
        );
        expect(onSuccess).toHaveBeenCalled();
        expect(screen.getByTestId("drawer-status").textContent).toBe("Closed");
        await waitFor(() =>
            expect(
                screen.queryByRole("form", { name: /Workspace access/i }),
            ).toBeNull(),
        );
        expect(onSuccess).toHaveBeenCalledOnce();
        expect(onCancel).not.toHaveBeenCalled();
    });

    test("explicit cancellation still invokes the cancellation callback once", async () => {
        const onCancel = vi.fn();
        const onSuccess = vi.fn();
        render(
            <InvitationAccessProvider>
                <TestConsumer onSuccess={onSuccess} onCancel={onCancel} />
            </InvitationAccessProvider>,
        );
        fireEvent.click(
            screen.getByRole("button", { name: /Open Access Drawer/i }),
        );
        fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
        await waitFor(() => expect(onCancel).toHaveBeenCalledOnce());
        expect(onSuccess).not.toHaveBeenCalled();
        expect(claimInvitation).not.toHaveBeenCalled();
    });
});
