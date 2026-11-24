import { api } from "@convex/_generated/api";
import {
    createMemoryHistory,
    createRootRoute,
    createRoute,
    createRouter,
    Outlet,
    RouterProvider,
} from "@tanstack/react-router";
import {
    fireEvent,
    render,
    screen,
    waitFor,
    within,
} from "@testing-library/react";
import { ThemeProvider } from "next-themes";
import { expect, test, vi } from "vitest";
import { convexReactHarness } from "@/__tests__/helpers/convex-react-harness";
import {
    mockDossierList,
    mockResearchWorkspace,
} from "@/__tests__/setup/workspace-dossiers";
import { InvitationAccessProvider } from "@/components/workspace/invitation-access-context";
import { Route } from "@/routes/workspace/route";

vi.mock(
    "convex/react",
    async () =>
        (await import("@/__tests__/helpers/convex-react-harness"))
            .convexReactHarness.module,
);
vi.mock("@convex-dev/auth/react", async (original) => ({
    ...(await original<typeof import("@convex-dev/auth/react")>()),
    useAuthActions: () => ({ signIn: vi.fn(), signOut: vi.fn() }),
}));

test("the real workspace shell follows the routed dossier when the analyst switches dossiers", async () => {
    convexReactHarness.reset();
    mockResearchWorkspace();
    const dossiers = [
        { runId: "run-7", framingScope: "Claims coordination" },
        { runId: "run-8", framingScope: "Incident routing" },
    ].map((dossier) => ({
        ...dossier,
        company: {
            legalName: "Example Technology",
            cik: "123",
            ticker: "EX",
            exchange: "NASDAQ",
            websiteUrl: "https://example.com",
        },
        lifecycleState: "framing",
        executionStatus: "idle",
        updatedAt: 1,
        providerFailures: [],
    }));
    mockDossierList().returns(dossiers);
    convexReactHarness
        .query(api.researchRuns.getMine)
        .returnsFrom(({ args }) =>
            args === "skip"
                ? undefined
                : dossiers.find((dossier) => dossier.runId === args.runId),
        );
    convexReactHarness
        .action(api.companyResolution.ensureRunCompanyWebsite)
        .uses(vi.fn());
    convexReactHarness.action(api.invitations.claim).uses(vi.fn());
    const root = createRootRoute({
        component: () => (
            <ThemeProvider
                attribute="class"
                defaultTheme="light"
                enableSystem={false}>
                <InvitationAccessProvider>
                    <Outlet />
                </InvitationAccessProvider>
            </ThemeProvider>
        ),
    });
    const workspace = createRoute({
        getParentRoute: () => root,
        path: "workspace",
        component: Route.options.component,
    });
    const dossier = createRoute({
        getParentRoute: () => workspace,
        path: "$runId",
        component: () => <p>Research view</p>,
    });
    const router = createRouter({
        routeTree: root.addChildren([workspace.addChildren([dossier])]),
        history: createMemoryHistory({ initialEntries: ["/workspace/run-7"] }),
    });
    render(<RouterProvider router={router} />);
    const trigger = await screen.findByRole("button", {
        name: "Switch research dossier",
    });
    expect(trigger.textContent).toContain("Claims coordination");
    expect(screen.getByText("Research view")).toBeTruthy();
    fireEvent.click(trigger);
    const first = await screen.findByRole("option", {
        name: /Claims coordination/,
    });
    expect(within(first).getByText("Current dossier")).toBeTruthy();
    fireEvent.click(screen.getByRole("option", { name: /Incident routing/ }));
    await waitFor(() =>
        expect(router.state.location.pathname).toBe("/workspace/run-8"),
    );
    expect(trigger.textContent).toContain("Incident routing");
    expect(trigger.textContent).not.toContain("Claims coordination");
    fireEvent.click(trigger);
    const selected = await screen.findByRole("option", {
        name: /Incident routing/,
    });
    expect(within(selected).getByText("Current dossier")).toBeTruthy();
    expect(
        within(
            screen.getByRole("option", { name: /Claims coordination/ }),
        ).queryByText("Current dossier"),
    ).toBeNull();
});
