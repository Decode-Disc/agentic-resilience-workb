import {
    createMemoryHistory,
    createRootRoute,
    createRoute,
    createRouter,
    RouterProvider,
} from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { Route as RunRoute } from "@/routes/workspace/_protected/$runId";

test("reloads the failed run route after retry", async () => {
    let shouldFail = true;
    const loader = vi.fn(() => {
        if (shouldFail) {
            throw new Error("Raw run loader failure");
        }
        return null;
    });
    const rootRoute = createRootRoute();
    const runRoute = createRoute({
        getParentRoute: () => rootRoute,
        path: "workspace/run-1",
        loader,
        component: () => <p>Recovered research dossier</p>,
        errorComponent: RunRoute.options.errorComponent,
    });
    const router = createRouter({
        routeTree: rootRoute.addChildren([runRoute]),
        history: createMemoryHistory({
            initialEntries: ["/workspace/run-1"],
        }),
    });

    render(<RouterProvider router={router} />);

    expect(
        await screen.findByText("Research workspace unavailable"),
    ).toBeTruthy();
    expect(screen.queryByText(/Raw run loader failure/i)).toBeNull();
    expect(loader).toHaveBeenCalledOnce();

    shouldFail = false;
    fireEvent.click(screen.getByRole("button", { name: /Try again/i }));

    expect(await screen.findByText("Recovered research dossier")).toBeTruthy();
    await waitFor(() => expect(loader).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("alert")).toBeNull();
});