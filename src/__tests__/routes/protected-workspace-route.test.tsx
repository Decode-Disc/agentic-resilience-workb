import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

const {
    claimInvitation,
    navigate,
    retrySession,
    useAction,
    useAnonymousSession,
    useQuery,
} = vi.hoisted(() => ({
    claimInvitation: vi.fn(),
    navigate: vi.fn(),
    retrySession: vi.fn(),
    useAction: vi.fn(),
    useAnonymousSession: vi.fn(),
    useQuery: vi.fn(),
}));

vi.mock(import("convex/react"), () => ({ useAction, useQuery }));
vi.mock(import("@tanstack/react-router"), async (importOriginal) => {
    const router = await importOriginal();
    return {
        ...router,
        Outlet: Object.assign(
            () => <div>Protected route content</div>,
            router.Outlet,
        ),
        useNavigate: () => navigate,
    };
});
vi.mock("@/hooks/use-anonymous-session", () => ({ useAnonymousSession }));

import { InvitationAccessProvider } from "@/components/workspace/invitation-access-context";
import { ProtectedWorkspaceRoute } from "@/components/workspace/protected-workspace-route";

describe("ProtectedWorkspaceRoute", () => {
    beforeEach(() => {
        claimInvitation.mockReset();
        navigate.mockReset();
        retrySession.mockReset();
        useAction.mockReset();
        useAction.mockReturnValue(claimInvitation);
        useAnonymousSession.mockReset();
        useAnonymousSession.mockReturnValue({
            isSessionLoading: false,
            isSessionReady: true,
            sessionError: null,
            retrySession,
        });
        useQuery.mockReset();
    });

    test("withholds protected content and opens admission for an anonymous visitor", () => {
        useQuery.mockReturnValue(null);

        render(
            <InvitationAccessProvider>
                <ProtectedWorkspaceRoute />
            </InvitationAccessProvider>,
        );

        expect(screen.queryByText("Protected route content")).toBeNull();
        expect(
            screen.getByRole("heading", { name: /Protected access/i }),
        ).toBeTruthy();
    });

    test("renders protected content for an active visitor", () => {
        useQuery.mockReturnValue({ role: "analyst", status: "active" });

        render(
            <InvitationAccessProvider>
                <ProtectedWorkspaceRoute />
            </InvitationAccessProvider>,
        );

        expect(screen.getByText("Protected route content")).toBeTruthy();
        expect(
            screen.queryByRole("heading", { name: /Invitation required/i }),
        ).toBeNull();
    });

    test("sends an admitted analyst to the dossiers page", async () => {
        useQuery.mockReturnValue(null);
        claimInvitation.mockResolvedValue({
            visitorId: "visitor-analyst",
            role: "analyst",
        });

        render(
            <InvitationAccessProvider>
                <ProtectedWorkspaceRoute />
            </InvitationAccessProvider>,
        );

        fireEvent.change(screen.getByLabelText(/Access code/i), {
            target: { value: "4207" },
        });
        fireEvent.submit(
            screen.getByRole("form", { name: /Workspace access/i }),
        );

        await waitFor(() =>
            expect(navigate).toHaveBeenCalledWith({
                to: "/workspace/dossiers",
            }),
        );
    });

    test("retries anonymous session preparation", () => {
        useAnonymousSession.mockReturnValue({
            isSessionLoading: false,
            isSessionReady: false,
            sessionError: "We couldn't prepare the private workspace.",
            retrySession,
        });

        render(
            <InvitationAccessProvider>
                <ProtectedWorkspaceRoute />
            </InvitationAccessProvider>,
        );

        fireEvent.click(screen.getByRole("button", { name: /Try again/i }));

        expect(retrySession).toHaveBeenCalledOnce();
    });

    test("recovers when the visitor query fails", () => {
        const consoleError = vi
            .spyOn(console, "error")
            .mockImplementation(() => undefined);
        let shouldFail = true;
        useQuery.mockImplementation(() => {
            if (shouldFail) {
                throw new Error("Visitor query failed");
            }
            return { role: "analyst", status: "active" };
        });

        render(
            <InvitationAccessProvider>
                <ProtectedWorkspaceRoute />
            </InvitationAccessProvider>,
        );

        shouldFail = false;
        fireEvent.click(screen.getByRole("button", { name: /Try again/i }));

        expect(screen.getByText("Protected route content")).toBeTruthy();
        consoleError.mockRestore();
    });
});
