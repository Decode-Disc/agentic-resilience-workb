import { api } from "@convex/_generated/api";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { claimInvitation, navigate, signIn, signOut } = vi.hoisted(() => ({
    claimInvitation: vi.fn(),
    navigate: vi.fn(),
    signIn: vi.fn(),
    signOut: vi.fn(),
}));

vi.mock("@tanstack/react-router", async (importOriginal) => {
    const router =
        await importOriginal<typeof import("@tanstack/react-router")>();

    return {
        ...router,
        useNavigate: () => navigate,
        Link: ({
            to,
            search: _search,
            children,
            ...props
        }: ComponentProps<"a"> & {
            to: string;
            search?: Record<string, string>;
        }) => (
            <a href={to} {...props}>
                {children}
            </a>
        ),
    };
});

vi.mock(import("@convex-dev/auth/react"), async (importOriginal) => {
    const auth = await importOriginal();
    return {
        ...auth,
        useAuthActions: () => ({ signIn, signOut }),
    };
});

vi.mock("convex/react", async () => {
    const { convexReactHarness } = await import(
        "@/__tests__/helpers/convex-react-harness"
    );
    return convexReactHarness.module;
});

vi.mock(import("@/components/workbench-shell/analyzed-company-list"), () => ({
    AnalyzedCompanyList: ({
        isAdmissionLoading,
    }: {
        isAdmissionLoading?: boolean;
    }) => (
        <nav
            aria-label={
                isAdmissionLoading
                    ? "Loading research dossiers"
                    : "Analyzed companies"
            }
        />
    ),
}));

import { convexReactHarness } from "@/__tests__/helpers/convex-react-harness";
import { WorkbenchShell } from "@/components/workbench-shell/workbench-shell";
import { InvitationAccessProvider } from "@/components/workspace/invitation-access-context";

describe("WorkbenchShell", () => {
    beforeEach(() => {
        claimInvitation.mockReset();
        navigate.mockReset();
        signIn.mockReset();
        signOut.mockReset();
        signOut.mockResolvedValue(undefined);
        convexReactHarness.reset();
        convexReactHarness.action(api.invitations.claim).uses(claimInvitation);
        convexReactHarness.query(api.visitors.current).returns(undefined);
    });

    it("renders header with Home link and analyzed company list", () => {
        render(
            <InvitationAccessProvider>
                <WorkbenchShell>
                    <div>Page content</div>
                </WorkbenchShell>
            </InvitationAccessProvider>,
        );

        const homeLink = screen.getByRole("button", { name: /Go to Home/i });
        const dossiersLink = screen.getByRole("button", {
            name: /Start a company dossier/i,
        });
        expect(homeLink).toBeTruthy();
        expect(homeLink.getAttribute("href")).toBe("/");
        expect(dossiersLink.getAttribute("href")).toBe("/workspace/start");
        expect(
            homeLink.compareDocumentPosition(dossiersLink) &
                Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
    });

    it("renders custom children when provided", () => {
        render(
            <InvitationAccessProvider>
                <WorkbenchShell>
                    <div data-testid="custom-page-content">Custom View</div>
                </WorkbenchShell>
            </InvitationAccessProvider>,
        );

        expect(screen.getByTestId("custom-page-content")).toBeTruthy();
    });

    it("preserves company navigation space while admission loads", () => {
        render(
            <InvitationAccessProvider>
                <WorkbenchShell>
                    <div>Page content</div>
                </WorkbenchShell>
            </InvitationAccessProvider>,
        );

        expect(
            screen.getByLabelText(/Loading research dossiers/i),
        ).toBeTruthy();
    });

    it("keeps page content visible when the workspace header fails", () => {
        const consoleError = vi
            .spyOn(console, "error")
            .mockImplementation(() => undefined);
        const visitorQuery = convexReactHarness.query(api.visitors.current);
        visitorQuery.throws(new Error("Visitor query failed"));

        render(
            <InvitationAccessProvider>
                <WorkbenchShell>
                    <div>Page content</div>
                </WorkbenchShell>
            </InvitationAccessProvider>,
        );

        expect(screen.getByText("Page content")).toBeTruthy();
        expect(
            screen.getByText("Workspace navigation unavailable"),
        ).toBeTruthy();
        visitorQuery.returns(null);
        fireEvent.click(screen.getByRole("button", { name: "Retry" }));
        expect(screen.getByRole("button", { name: "Workspace" })).toBeTruthy();
        consoleError.mockRestore();
    });

    it("opens workspace access from the public workspace button", async () => {
        convexReactHarness.query(api.visitors.current).returns(null);

        render(
            <InvitationAccessProvider>
                <WorkbenchShell>
                    <div>Page content</div>
                </WorkbenchShell>
            </InvitationAccessProvider>,
        );

        expect(
            screen.queryByRole("button", { name: /Workspace menu/i }),
        ).toBeNull();
        fireEvent.click(screen.getByRole("button", { name: /Workspace/i }));

        expect(
            await screen.findByRole("heading", { name: /Protected access/i }),
        ).toBeTruthy();
    });

    it("sends an analyst to their dossiers after workspace access", async () => {
        convexReactHarness.query(api.visitors.current).returns(null);
        claimInvitation.mockResolvedValue({
            visitorId: "visitor-analyst",
            role: "analyst",
        });

        render(
            <InvitationAccessProvider>
                <WorkbenchShell>
                    <div>Page content</div>
                </WorkbenchShell>
            </InvitationAccessProvider>,
        );

        fireEvent.click(screen.getByRole("button", { name: /Workspace/i }));
        fireEvent.change(await screen.findByLabelText(/Access code/i), {
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

    it("sends an admin to operations after workspace access", async () => {
        convexReactHarness.query(api.visitors.current).returns(null);
        claimInvitation.mockResolvedValue({
            visitorId: "visitor-admin",
            role: "admin",
        });

        render(
            <InvitationAccessProvider>
                <WorkbenchShell>
                    <div>Page content</div>
                </WorkbenchShell>
            </InvitationAccessProvider>,
        );

        fireEvent.click(screen.getByRole("button", { name: /Workspace/i }));
        fireEvent.change(await screen.findByLabelText(/Access code/i), {
            target: { value: "4207" },
        });
        fireEvent.submit(
            screen.getByRole("form", { name: /Workspace access/i }),
        );

        await waitFor(() =>
            expect(navigate).toHaveBeenCalledWith({
                to: "/workspace/admin",
            }),
        );
    });

    it("lets an admitted analyst sign out without exposing admin operations", async () => {
        convexReactHarness.query(api.visitors.current).returns({
            role: "analyst",
            status: "active",
        } as never);

        render(
            <InvitationAccessProvider>
                <WorkbenchShell>
                    <div>Page content</div>
                </WorkbenchShell>
            </InvitationAccessProvider>,
        );

        expect(screen.queryByText("Research prototype")).toBeNull();
        expect(screen.getByText("Account")).toBeTruthy();
        expect(
            screen.queryByRole("button", { name: /^Workspace access$/i }),
        ).toBeNull();
        fireEvent.click(
            screen.getByRole("button", { name: /Workspace menu/i }),
        );
        expect(screen.queryByText("Operations")).toBeNull();

        fireEvent.click(await screen.findByText("Logout"));

        await waitFor(() => expect(signOut).toHaveBeenCalledOnce());
        expect(navigate).toHaveBeenCalledWith({ to: "/workspace/start" });
    });

    it("keeps Operations in the session menu for an admitted admin", async () => {
        convexReactHarness.query(api.visitors.current).returns({
            role: "admin",
            status: "active",
        } as never);

        render(
            <InvitationAccessProvider>
                <WorkbenchShell>
                    <div>Page content</div>
                </WorkbenchShell>
            </InvitationAccessProvider>,
        );

        fireEvent.click(
            screen.getByRole("button", { name: /Workspace menu/i }),
        );
        fireEvent.click(
            await screen.findByRole("button", { name: "Operations" }),
        );

        expect(navigate).toHaveBeenCalledWith({ to: "/workspace/admin" });
    });
});
