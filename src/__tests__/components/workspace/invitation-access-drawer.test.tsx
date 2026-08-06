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

const { claimInvitation, onAdmitted, useAction } = vi.hoisted(() => ({
    claimInvitation: vi.fn(),
    onAdmitted: vi.fn(),
    useAction: vi.fn(),
}));

vi.mock(import("convex/react"), () => ({ useAction }));

import { InvitationAccessDrawer } from "@/components/workspace/invitation-access-drawer";

class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
}

describe("InvitationAccessDrawer", () => {
    beforeAll(() => {
        vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    });

    beforeEach(() => {
        claimInvitation.mockReset();
        onAdmitted.mockReset();
        useAction.mockReset();
        useAction.mockReturnValue(claimInvitation);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    afterAll(() => {
        vi.unstubAllGlobals();
    });

    test("submits an access code from a top drawer", async () => {
        claimInvitation.mockResolvedValue({
            visitorId: "visitor-1",
            role: "analyst",
        });

        render(
            <InvitationAccessDrawer
                open
                onOpenChange={vi.fn()}
                onAdmitted={onAdmitted}
            />,
        );

        const title = screen.getByRole("heading", {
            name: /Protected access/i,
        });
        const popup = title.closest('[data-slot="drawer-popup"]');
        expect(popup?.getAttribute("data-swipe-direction")).toBe("up");
        expect(
            screen.queryByText(
                /company resolution is public|five|single-use|anonymous browser session/i,
            ),
        ).toBeNull();

        const accessCode = screen.getByLabelText(/Access code/i);
        expect(accessCode.getAttribute("maxlength")).toBe("4");
        expect(accessCode.getAttribute("inputmode")).toBe("numeric");

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
        expect(onAdmitted).toHaveBeenCalledWith({
            visitorId: "visitor-1",
            role: "analyst",
        });
    });

    test("keeps an incomplete code inline instead of calling Convex", async () => {
        render(
            <InvitationAccessDrawer
                open
                onOpenChange={vi.fn()}
                onAdmitted={onAdmitted}
            />,
        );

        fireEvent.change(screen.getByLabelText(/Access code/i), {
            target: { value: "420" },
        });
        fireEvent.submit(
            screen.getByRole("form", { name: /Workspace access/i }),
        );

        expect(
            await screen.findByText(/Enter the four-digit access code/i),
        ).not.toBeNull();
        expect(claimInvitation).not.toHaveBeenCalled();
    });

    test("keeps backend details out of invitation errors", async () => {
        claimInvitation.mockRejectedValue(
            new Error(
                "[CONVEX A(invitations:claim)] Server Error: Invitation claim is not configured",
            ),
        );

        render(
            <InvitationAccessDrawer
                open
                onOpenChange={vi.fn()}
                onAdmitted={onAdmitted}
            />,
        );

        fireEvent.change(screen.getByLabelText(/Access code/i), {
            target: { value: "4207" },
        });
        fireEvent.submit(
            screen.getByRole("form", { name: /Workspace access/i }),
        );

        expect(
            await screen.findByText(
                /We couldn't verify that access code\. Try again\./i,
            ),
        ).toBeTruthy();
        expect(screen.queryByText(/CONVEX|not configured/i)).toBeNull();
    });
});
