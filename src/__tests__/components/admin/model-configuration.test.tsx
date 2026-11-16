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
        .mutation(api.modelConfiguration.setReasoningPreference)
        .uses(async () => ({ revision: 1 }));
    convexReactHarness
        .mutation(api.modelConfiguration.setResponseControl)
        .uses(async () => ({
            revision: 1,
            enabled: false,
            model: "typesafe/jev-1.14",
            contradictionThreshold: 0.95,
            supportThreshold: 0.7,
        }));
    convexReactHarness
        .action(api.modelConfigurationActions.initialize)
        .uses(async () => ({ ready: true }));
    convexReactHarness
        .mutation(api.modelConfiguration.updateAvailability)
        .uses(async () => ({ revision: 1 }));
    convexReactHarness
        .action(api.modelConfigurationActions.prepare)
        .uses(prepare);
    convexReactHarness
        .action(api.modelConfigurationActions.refreshProfiles)
        .uses(async () => ({ isDone: true, continueCursor: null }));
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

test("reasoning preferences expose the recommendation and retain explicit supported choices", async () => {
    const save = vi.fn(async () => ({ revision: 3 }));
    convexReactHarness
        .mutation(api.modelConfiguration.setReasoningPreference)
        .uses(save);
    convexReactHarness.query(api.modelConfiguration.list).returns({
        models: [
            {
                _id: "reasoning-model",
                _creationTime: 1,
                currentRevisionId: "reasoning-revision",
                model: "example/model",
                label: "Test model",
                revision: 2,
                status: "ready",
                enabled: true,
                workbenchSelectable: true,
                compatible: true,
                reasoning: {
                    preference: "recommended",
                    recommended: "medium",
                    effective: "medium",
                    choices: ["none", "low", "medium", "high"],
                },
            },
        ],
        assignments: [],
        agents: [],
    });
    render(<AdminModels />);
    const select = screen.getByRole("combobox", {
        name: "Reasoning for Test model",
    });
    expect(select.textContent).toContain("Recommended");
    fireEvent.click(select);
    const option = await screen.findByRole("option", { name: "low" });
    option.focus();
    fireEvent.keyDown(option, { key: "Enter" });
    await waitFor(() =>
        expect(save).toHaveBeenCalledWith({
            catalogId: "reasoning-model",
            expectedRevision: 2,
            preference: "low",
            requestKey: expect.any(String),
        }),
    );
});

const staleModel = {
    _id: "stale-model",
    _creationTime: 1,
    currentRevisionId: "stale-revision",
    model: "example/model",
    label: "Stale model",
    revision: 3,
    status: "ready",
    enabled: true,
    workbenchSelectable: true,
    compatible: false,
    reasoning: {
        preference: "recommended",
        recommended: "medium",
        effective: "medium",
        choices: ["low", "medium", "high"],
    },
};

test("an administrator refreshes stale input profiles through every retained revision", async () => {
    const refresh = vi
        .fn()
        .mockResolvedValueOnce({ isDone: false, continueCursor: "page-2" })
        .mockResolvedValueOnce({ isDone: true, continueCursor: null });
    convexReactHarness
        .action(api.modelConfigurationActions.refreshProfiles)
        .uses(refresh);
    convexReactHarness.query(api.modelConfiguration.list).returns({
        models: [staleModel],
        assignments: [],
        agents: [],
    });
    render(<AdminModels />);
    expect(
        screen.getByText(
            "The runtime changed since this model was prepared. Refresh its input profiles before analysts can use it.",
        ),
    ).toBeTruthy();
    fireEvent.click(
        screen.getByRole("button", { name: "Refresh input profiles" }),
    );
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
    expect(refresh).toHaveBeenNthCalledWith(1, {
        catalogId: "stale-model",
        cursor: null,
    });
    expect(refresh).toHaveBeenNthCalledWith(2, {
        catalogId: "stale-model",
        cursor: "page-2",
    });
    expect(screen.queryByRole("alert")).toBeNull();
});

test("a failed profile refresh is reported without changing the model", async () => {
    convexReactHarness
        .action(api.modelConfigurationActions.refreshProfiles)
        .uses(async () => {
            throw new Error("model_profile_version_conflict");
        });
    convexReactHarness.query(api.modelConfiguration.list).returns({
        models: [staleModel],
        assignments: [],
        agents: [],
    });
    render(<AdminModels />);
    fireEvent.click(
        screen.getByRole("button", { name: "Refresh input profiles" }),
    );
    expect((await screen.findByRole("alert")).textContent).toBe(
        "The input profiles could not be refreshed. The model stays unavailable to analysts; try again.",
    );
});
