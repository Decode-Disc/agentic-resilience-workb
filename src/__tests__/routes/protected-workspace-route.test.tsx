import { api } from "@convex/_generated/api";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

const { claimInvitation, navigate, retrySession, useAnonymousSession } =
    vi.hoisted(() => ({
        claimInvitation: vi.fn(),
        navigate: vi.fn(),
        retrySession: vi.fn(),
        useAnonymousSession: vi.fn(),
    }));

vi.mock("convex/react", async () => {
    const { convexReactHarness } = await import(
        "@/__tests__/helpers/convex-react-harness"
    );
    return convexReactHarness.module;
});
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

import { convexReactHarness } from "@/__tests__/helpers/convex-react-harness";
import { InvitationAccessProvider } from "@/components/workspace/invitation-access-context";
import { ProtectedWorkspaceRoute } from "@/components/workspace/protected-workspace-route";

describe("ProtectedWorkspaceRoute", () => {
    beforeEach(() => {
        claimInvitation.mockReset();
        navigate.mockReset();
        retrySession.mockReset();
        convexReactHarness.reset();
        convexReactHarness.action(api.invitations.claim).uses(claimInvitation);
        useAnonymousSession.mockReset();
        useAnonymousSession.mockReturnValue({
            isSessionLoading: false,
            isSessionReady: true,
            sessionError: null,
            retrySession,
        });
    });

    test("withholds protected content and opens admission for an anonymous visitor", () => {
        convexReactHarness.query(api.visitors.current).returns(null);

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
        convexReactHarness
            .query(api.visitors.current)
            .returns({ role: "analyst", status: "active" } as never);

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
        convexReactHarness.query(api.visitors.current).returns(null);
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
            expect(navigate).toHaveBeenLastCalledWith({
                to: "/workspace/dossiers",
            }),
        );
        await waitFor(() =>
            expect(
                screen.queryByRole("form", { name: /Workspace access/i }),
            ).toBeNull(),
        );
        expect(navigate).not.toHaveBeenCalledWith({ to: "/workspace/start" });
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
        const visitorQuery = convexReactHarness.query(api.visitors.current);
        visitorQuery.throws(new Error("Visitor query failed"));

        render(
            <InvitationAccessProvider>
                <ProtectedWorkspaceRoute />
            </InvitationAccessProvider>,
        );

        visitorQuery.returns({ role: "analyst", status: "active" } as never);
        fireEvent.click(screen.getByRole("button", { name: /Try again/i }));

        expect(screen.getByText("Protected route content")).toBeTruthy();
        consoleError.mockRestore();
    });
});
