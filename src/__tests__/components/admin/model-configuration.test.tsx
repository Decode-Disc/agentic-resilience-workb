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
import { AdminModels } from "@/components/admin/admin-model-configuration";

const prepare = vi.fn(async () => ({
    catalogId: "model-fixture" as Id<"modelCatalog">,
    revision: 1,
    ready: true,
}));

beforeEach(() => {
    convexReactHarness.reset();
    prepare.mockClear();
    convexReactHarness
        .action(api.modelConfigurationActions.initialize)
        .uses(async () => ({ ready: true }));
    convexReactHarness
        .mutation(api.modelConfiguration.updateAvailability)
        .uses(async () => ({ revision: 1 }));
    convexReactHarness
        .action(api.modelConfigurationActions.prepare)
        .uses(prepare);
    convexReactHarness.query(api.modelConfiguration.list).returns({
        models: [],
        assignments: [],
        agents: [],
    });
});

test("an administrator prepares a model without choosing an upstream provider", async () => {
    render(<AdminModels />);
    fireEvent.change(screen.getByLabelText("OpenRouter model ID"), {
        target: { value: "example/model" },
    });
    fireEvent.change(screen.getByLabelText("Display name"), {
        target: { value: "Example" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Prepare model" }));
    await waitFor(() =>
        expect(prepare).toHaveBeenCalledWith({
            model: "example/model",
            label: "Example",
            requestKey: expect.any(String),
        }),
    );
    expect(screen.queryByLabelText("Provider ID")).toBeNull();
});
