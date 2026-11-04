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

test("coherence thresholds and activation are saved together with the observed configuration version", async () => {
    convexReactHarness.query(api.modelConfiguration.list).returns({
        models: [],
        assignments: [],
        agents: [],
        responseControl: {
            revision: 4,
            enabled: false,
            model: "typesafe/jev-1.14",
            contradictionThreshold: 0.95,
            supportThreshold: 0.7,
        },
    });
    const save = vi.fn(async () => ({
        revision: 5,
        enabled: true,
        model: "typesafe/jev-1.14",
        contradictionThreshold: 0.93,
        supportThreshold: 0.75,
    }));
    convexReactHarness
        .mutation(api.modelConfiguration.setResponseControl)
        .uses(save);
    render(<AdminModels />);
    fireEvent.click(
        screen.getByRole("switch", {
            name: "Enable response coherence control",
        }),
    );
    fireEvent.change(screen.getByLabelText("Contradiction threshold"), {
        target: { value: "0.93" },
    });
    fireEvent.change(screen.getByLabelText("Support threshold"), {
        target: { value: "0.75" },
    });
    fireEvent.click(
        screen.getByRole("button", { name: "Save coherence settings" }),
    );
    await waitFor(() =>
        expect(save).toHaveBeenCalledWith({
            expectedRevision: 4,
            enabled: true,
            model: "typesafe/jev-1.14",
            contradictionThreshold: 0.93,
            supportThreshold: 0.75,
        }),
    );
});
