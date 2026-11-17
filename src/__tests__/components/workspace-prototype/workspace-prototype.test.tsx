import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async (importOriginal) => {
    const router =
        await importOriginal<typeof import("@tanstack/react-router")>();

    return {
        ...router,
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
        useNavigate: () => vi.fn(),
    };
});

vi.mock("convex/react", () => ({
    useAction: () => vi.fn(),
    useQuery: vi.fn().mockReturnValue(undefined),
}));

vi.mock("@convex-dev/auth/react", async (importOriginal) => {
    const auth =
        await importOriginal<typeof import("@convex-dev/auth/react")>();
    return {
        ...auth,
        useAuthActions: () => ({
            signIn: vi.fn(),
            signOut: vi.fn(),
        }),
    };
});

import { WorkspacePrototype } from "@/components/workspace-prototype/workspace-prototype";
import { InvitationAccessProvider } from "@/components/workspace/invitation-access-context";

function renderWithInvitationAccess(component: ReactNode) {
    return render(
        <InvitationAccessProvider>{component}</InvitationAccessProvider>,
    );
}

class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
}

describe("WorkspacePrototype", () => {
    beforeAll(() => {
        vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    });

    afterAll(() => {
        vi.unstubAllGlobals();
    });

    it("expands and collapses the compact dossier heading", async () => {
        renderWithInvitationAccess(
            <WorkspacePrototype variant="a" onVariantChange={vi.fn()} />,
        );

        const trigger = screen.getByRole("button", {
            name: "Expand dossier details",
        });

        expect(trigger.getAttribute("aria-expanded")).toBe("false");
        expect(
            screen.queryByText(/Evidence-led review of workflow control/i),
        ).toBeNull();

        fireEvent.click(trigger);

        expect(trigger.getAttribute("aria-expanded")).toBe("true");
        expect(
            screen.getByText(/Evidence-led review of workflow control/i),
        ).toBeTruthy();
        expect(
            screen.getAllByText("CCC Intelligent Solutions", { exact: true }),
        ).toHaveLength(1);
        expect(screen.getAllByText("Claim review")).toHaveLength(1);

        fireEvent.click(trigger);

        expect(trigger.getAttribute("aria-expanded")).toBe("false");
        await waitFor(() => {
            expect(
                screen.queryByText(/Evidence-led review of workflow control/i),
            ).toBeNull();
        });
    });
});
