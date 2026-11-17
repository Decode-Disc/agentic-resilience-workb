import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
    act,
    fireEvent,
    render,
    screen,
    waitFor,
    within,
} from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";

vi.mock("convex/react", async () => {
    const { convexReactHarness } = await import(
        "@/__tests__/helpers/convex-react-harness"
    );
    return convexReactHarness.module;
});

import { convexReactHarness } from "@/__tests__/helpers/convex-react-harness";
import { AdminModels } from "@/components/admin/admin-models";
import { AdminResponseControl } from "@/components/admin/admin-response-control";
import { MODEL_REFRESH_FAILURE_COPY } from "@/lib/workspace/use-refresh-model-profiles";

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

test("an administrator prepares a model in a dialog without choosing an upstream provider", async () => {
    render(<AdminModels />);
    fireEvent.click(screen.getByRole("button", { name: "Add a model" }));
    await screen.findByRole("dialog", { name: "Add a model" });
    fireEvent.change(screen.getByLabelText("OpenRouter model ID"), {
        target: { value: "example/model" },
    });
    fireEvent.change(screen.getByLabelText("Display name"), {
        target: { value: "Example" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
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
    render(<AdminResponseControl />);
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
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
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
    const option = await screen.findByRole("option", { name: "Low" });
    option.focus();
    fireEvent.keyDown(option, { key: "Enter" });
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(
        await screen.findByRole("button", { name: "Save changes" }),
    );
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
    expect(screen.getByText("Needs update")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Update model" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Update model" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
        MODEL_REFRESH_FAILURE_COPY,
    );
});

test("a compatible current revision keeps Updating visible until historical refresh finishes", async () => {
    let finish!: (value: {
        isDone: boolean;
        continueCursor: string | null;
    }) => void;
    const pending = new Promise<{
        isDone: boolean;
        continueCursor: string | null;
    }>((resolve) => {
        finish = resolve;
    });
    const refresh = vi
        .fn()
        .mockResolvedValueOnce({ isDone: false, continueCursor: "history" })
        .mockImplementationOnce(() => pending);
    convexReactHarness
        .action(api.modelConfigurationActions.refreshProfiles)
        .uses(refresh);
    const config = { models: [staleModel], assignments: [], agents: [] };
    convexReactHarness.query(api.modelConfiguration.list).returns(config);
    const view = render(<AdminModels />);
    fireEvent.click(screen.getByRole("button", { name: "Update model" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
    convexReactHarness
        .query(api.modelConfiguration.list)
        .returns({ ...config, models: [{ ...staleModel, compatible: true }] });
    view.rerender(<AdminModels />);
    try {
        expect(
            screen
                .getByRole("button", { name: "Updating…" })
                .hasAttribute("disabled"),
        ).toBe(true);
    } finally {
        await act(async () => finish({ isDone: true, continueCursor: null }));
    }
    expect(screen.queryByRole("button", { name: "Updating…" })).toBeNull();
});

test("refreshing one model leaves another model available and tracks both completions independently", async () => {
    let finishFirst!: () => void;
    let finishSecond!: () => void;
    const first = new Promise<{ isDone: boolean; continueCursor: null }>(
        (resolve) => {
            finishFirst = () => resolve({ isDone: true, continueCursor: null });
        },
    );
    const second = new Promise<{ isDone: boolean; continueCursor: null }>(
        (resolve) => {
            finishSecond = () =>
                resolve({ isDone: true, continueCursor: null });
        },
    );
    convexReactHarness
        .action(api.modelConfigurationActions.refreshProfiles)
        .uses(({ catalogId }) =>
            catalogId === staleModel._id ? first : second,
        );
    convexReactHarness.query(api.modelConfiguration.list).returns({
        models: [
            staleModel,
            { ...staleModel, _id: "other-model", label: "Other model" },
        ],
        assignments: [],
        agents: [],
    });
    render(<AdminModels />);
    const firstRow = screen.getByText(staleModel.label).closest("section");
    const secondRow = screen.getByText("Other model").closest("section");
    if (!firstRow || !secondRow) throw new Error("Missing model rows");
    fireEvent.click(
        within(firstRow).getByRole("button", { name: "Update model" }),
    );
    try {
        expect(
            within(secondRow)
                .getByRole("button", { name: "Update model" })
                .hasAttribute("disabled"),
        ).toBe(false);
        fireEvent.click(
            within(secondRow).getByRole("button", { name: "Update model" }),
        );
        await act(async () => finishFirst());
        expect(
            within(firstRow).queryByRole("button", { name: "Updating…" }),
        ).toBeNull();
        expect(
            within(secondRow)
                .getByRole("button", { name: "Updating…" })
                .hasAttribute("disabled"),
        ).toBe(true);
    } finally {
        await act(async () => {
            finishFirst();
            finishSecond();
        });
    }
    expect(screen.queryByRole("button", { name: "Updating…" })).toBeNull();
});

test("a failed historical refresh does not claim that the ready current model is unavailable", async () => {
    let fail!: (error: Error) => void;
    const pending = new Promise<{
        isDone: boolean;
        continueCursor: string | null;
    }>((_resolve, reject) => {
        fail = reject;
    });
    const refresh = vi
        .fn()
        .mockResolvedValueOnce({ isDone: false, continueCursor: "historical" })
        .mockImplementationOnce(() => pending);
    convexReactHarness
        .action(api.modelConfigurationActions.refreshProfiles)
        .uses(refresh);
    const config = { models: [staleModel], assignments: [], agents: [] };
    convexReactHarness.query(api.modelConfiguration.list).returns(config);
    const view = render(<AdminModels />);
    fireEvent.click(screen.getByRole("button", { name: "Update model" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
    convexReactHarness
        .query(api.modelConfiguration.list)
        .returns({ ...config, models: [{ ...staleModel, compatible: true }] });
    view.rerender(<AdminModels />);
    await act(async () => fail(new Error("model_profile_version_conflict")));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/try again/i);
    expect(alert.textContent).not.toMatch(
        /stays unavailable|model_profile_version_conflict/,
    );
    expect(screen.getByText("Ready")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Updating…" })).toBeNull();
    refresh.mockResolvedValueOnce({ isDone: true, continueCursor: null });
    fireEvent.click(screen.getByRole("button", { name: "Update model" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(3));
    await waitFor(() =>
        expect(screen.queryByRole("button", { name: "Updating…" })).toBeNull(),
    );
});

test("editing a model prepares the same catalogue entry at its observed revision", async () => {
    convexReactHarness.query(api.modelConfiguration.list).returns({
        models: [{ ...staleModel, compatible: true }],
        assignments: [],
        agents: [],
    });
    render(<AdminModels />);
    expect(screen.getByText("Ready")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Edit configuration" }));
    await screen.findByRole("dialog", { name: "Edit Stale model" });
    expect(
        (screen.getByLabelText("OpenRouter model ID") as HTMLInputElement)
            .disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
        expect(prepare).toHaveBeenCalledWith({
            model: "example/model",
            label: "Stale model",
            requestKey: expect.any(String),
            catalogId: "stale-model",
            expectedRevision: 3,
        }),
    );
});

test("row changes wait for Save changes and Cancel discards them", async () => {
    const update = vi.fn(async () => ({ revision: 4 }));
    convexReactHarness
        .mutation(api.modelConfiguration.updateAvailability)
        .uses(update);
    convexReactHarness.query(api.modelConfiguration.list).returns({
        models: [{ ...staleModel, compatible: true }],
        assignments: [],
        agents: [],
    });
    render(<AdminModels />);
    const availability = screen.getByRole("combobox", {
        name: "Availability of Stale model",
    });
    expect(availability.textContent).toContain("Agents and chat menu");
    const choose = async (label: string) => {
        fireEvent.click(availability);
        const option = await screen.findByRole("option", { name: label });
        option.focus();
        fireEvent.keyDown(option, { key: "Enter" });
    };
    await choose("Agents only");
    expect(update).not.toHaveBeenCalled();
    expect(await screen.findByText("Edited")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText("Edited")).toBeNull();
    expect(availability.textContent).toContain("Agents and chat menu");
    await choose("Off");
    fireEvent.click(
        await screen.findByRole("button", { name: "Save changes" }),
    );
    await waitFor(() =>
        expect(update).toHaveBeenCalledWith({
            catalogId: "stale-model",
            expectedRevision: 3,
            enabled: false,
            workbenchSelectable: false,
            requestKey: expect.any(String),
        }),
    );
});
