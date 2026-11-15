import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
    fireEvent,
    render,
    screen,
    waitFor,
    within,
} from "@testing-library/react";
import { ConvexError } from "convex/values";
import { beforeEach, expect, test, vi } from "vitest";
import { convexReactHarness } from "@/__tests__/helpers/convex-react-harness";
import { ConnectedStartWorkspace } from "@/components/workspace/start/connected-start-workspace";

vi.mock(
    "convex/react",
    async () =>
        (await import("@/__tests__/helpers/convex-react-harness"))
            .convexReactHarness.module,
);
vi.mock("@tanstack/react-router", async (original) => ({
    ...(await original<typeof import("@tanstack/react-router")>()),
    useNavigate: () => vi.fn(),
    // Launched dossiers show the section navigation; its links need no router here.
    Link: ({
        children,
        to,
        params: _params,
        search: _search,
        ...props
    }: React.ComponentProps<"a"> & {
        to: string;
        params?: unknown;
        search?: unknown;
    }) => (
        <a href={to} {...props}>
            {children}
        </a>
    ),
}));
const save = vi.fn(),
    start = vi.fn(),
    pause = vi.fn(),
    resumeResearch = vi.fn();
const command = vi.fn(),
    setModel = vi.fn(),
    submitMessage = vi.fn();
const runId = "run-connected" as Id<"researchRuns">;
const readySnapshot = {
    run: {
        _id: runId,
        startMode: "framed",
        lifecycleState: "framing",
        executionStatus: "idle",
        executionGeneration: 1,
        createdAt: 1,
    },
    company: {
        legalName: "Example Technology",
        ticker: "EX",
        exchange: "NASDAQ",
        cik: "123",
    },
    framing: {
        _id: "framing-1",
        revision: 2,
        content: {
            scope: "Claims coordination",
            questions: [
                {
                    id: "q1",
                    shortLabel: "Coordination",
                    text: "Who controls coordination?",
                    rationale: "Distinguish control from supply.",
                },
            ],
        },
    },
    researchStart: { block: null, questionCapacity: 3 },
    researchControlAvailable: true,
    availableCommands: ["/pause", "/resume"],
    activeWork: null,
    preparation: null,
    instructions: [],
    sources: [],
};
beforeEach(() => {
    convexReactHarness.reset();
    save.mockReset().mockResolvedValue(3);
    start.mockReset().mockResolvedValue(runId);
    pause.mockReset().mockResolvedValue(3);
    resumeResearch.mockReset().mockResolvedValue(4);
    convexReactHarness.query(api.workbench.snapshot).returns(readySnapshot);
    convexReactHarness.query(api.workbench.models).returns({
        selectedId: "model-glm",
        effort: "low",
        effortChoices: ["low", "high", "max"],
        label: "GLM-5.3-Flash",
        available: true,
        revision: 0,
        choices: [
            { id: "model-glm", label: "GLM-5.3-Flash" },
            { id: "model-deepseek", label: "DeepSeek V4.1 Flash 1017" },
        ],
    });
    command.mockReset().mockResolvedValue({
        outcome: "refused",
        text: "Research has not started.",
    });
    setModel.mockReset().mockResolvedValue({ revision: 1 });
    convexReactHarness.mutation(api.workbench.command).uses(command);
    convexReactHarness.mutation(api.workbench.setModel).uses(setModel);
    submitMessage.mockReset().mockResolvedValue(undefined);
    convexReactHarness.query(api.execution.conversations.get).returns({
        activeTurn: null,
        execution: null,
        queuedCount: 0,
        queuePaused: false,
    });
    convexReactHarness
        .paginatedQuery(api.workbench.history)
        .returns({ results: [], status: "Exhausted", loadMore: vi.fn() });
    convexReactHarness.mutation(api.framing.save).uses(save);
    convexReactHarness
        .mutation(api.execution.researchControl.pause)
        .uses(pause);
    convexReactHarness
        .mutation(api.execution.researchControl.resume)
        .uses(resumeResearch);
    convexReactHarness.mutation(api.framing.startResearch).uses(start);
    for (const ref of [
        api.execution.conversations.submit,
        api.execution.conversations.removeQueued,
        api.execution.conversations.promoteQueued,
        api.execution.conversations.stopResponse,
        api.execution.conversations.resumeQueue,
    ])
        convexReactHarness.mutation(ref).uses(vi.fn());
    convexReactHarness
        .mutation(api.execution.conversations.submit)
        .uses(submitMessage);
});

test.each([
    "partial",
    "blocked",
])("the connected Sources mission does not claim completion for %s material", (status) => {
    convexReactHarness.query(api.workbench.snapshot).returns({
        ...readySnapshot,
        run: {
            ...readySnapshot.run,
            fixedFramingRevisionId: "framing-1",
            lifecycleState: "sources_prepared",
            executionStatus: "idle",
        },
        preparation: { status },
    });
    render(<ConnectedStartWorkspace runId={runId} />);
    const mission = document.querySelector(
        '[data-mission-id="sources:run-connected"]',
    );
    expect(mission).not.toBeNull();
    if (!(mission instanceof HTMLElement))
        throw new Error("Missing Sources mission");
    expect(within(mission).queryByText(/Completed/)).toBeNull();
    expect(mission.getAttribute("data-state")).toBe("interrupted");
    expect(mission.textContent).not.toMatch(
        /sources_prepared|operation_result_capacity/,
    );
});

test("a recoverable research interruption exposes the existing public Resume control", async () => {
    convexReactHarness.query(api.workbench.snapshot).returns({
        ...readySnapshot,
        run: {
            ...readySnapshot.run,
            fixedFramingRevisionId: "framing-1",
            lifecycleState: "discovering_sources",
            executionStatus: "paused",
            pauseReason: "execution_interrupted",
        },
    });
    render(<ConnectedStartWorkspace runId={runId} />);
    fireEvent.click(screen.getByRole("button", { name: "Resume research" }));
    await waitFor(() =>
        expect(resumeResearch).toHaveBeenCalledWith({
            runId,
            expectedGeneration: 1,
        }),
    );
    expect(screen.queryByText("execution_interrupted")).toBeNull();
});

test("selecting a slash control executes it immediately without submitting a model message", async () => {
    render(<ConnectedStartWorkspace runId={runId} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "/p" } });
    await screen.findByRole("option", { name: /^\/pause/ });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
        expect(command).toHaveBeenCalledWith(
            expect.objectContaining({
                runId,
                command: "/pause",
                expectedGeneration: 1,
                requestKey: expect.any(String),
            }),
        ),
    );
    expect(submitMessage).not.toHaveBeenCalled();
    await waitFor(() => expect((input as HTMLTextAreaElement).value).toBe(""));
});

test("the simple model selector sends a versioned dossier choice", async () => {
    render(<ConnectedStartWorkspace runId={runId} />);
    fireEvent.click(
        screen.getByRole("button", { name: "Workbench model and effort" }),
    );
    const option = await screen.findByRole("menuitemradio", {
        name: "DeepSeek V4.1 Flash 1017",
    });
    fireEvent.pointerDown(option, { pointerType: "mouse", button: 0 });
    fireEvent.click(option);
    await waitFor(() =>
        expect(setModel).toHaveBeenCalledWith(
            expect.objectContaining({
                runId,
                catalogId: "model-deepseek",
                expectedRevision: 0,
                requestKey: expect.any(String),
            }),
        ),
    );
});

test("a command acknowledgement failure keeps the draft without claiming that no action occurred", async () => {
    command.mockRejectedValueOnce(new Error("Lost acknowledgement"));
    render(<ConnectedStartWorkspace runId={runId} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "/pause" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await screen.findByText("Command not confirmed");
    expect((input as HTMLTextAreaElement).value).toBe("/pause");
    expect(screen.queryByText("Command not sent")).toBeNull();
    expect(submitMessage).not.toHaveBeenCalled();
});

test("Escape dismisses command suggestions without submitting, losing the draft or closing another surface", () => {
    render(<ConnectedStartWorkspace runId={runId} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "/r" } });
    expect(screen.getByRole("listbox", { name: "Commands" })).toBeTruthy();
    const outerEscape = vi.fn();
    document.addEventListener("keydown", outerEscape);
    try {
        fireEvent.keyDown(input, { key: "Escape" });
        expect(screen.queryByRole("listbox", { name: "Commands" })).toBeNull();
        expect((input as HTMLTextAreaElement).value).toBe("/r");
        expect(outerEscape).not.toHaveBeenCalled();
        expect(command).not.toHaveBeenCalled();
        expect(submitMessage).not.toHaveBeenCalled();
    } finally {
        document.removeEventListener("keydown", outerEscape);
    }
});
test("a command-like message with unsupported arguments stays in the field without inference", async () => {
    render(<ConnectedStartWorkspace runId={runId} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, {
        target: { value: "/pause and explain the evidence" },
    });
    fireEvent.keyDown(input, { key: "Enter" });
    await screen.findByText("Unknown command");
    expect(command).not.toHaveBeenCalled();
    expect(submitMessage).not.toHaveBeenCalled();
    expect((input as HTMLTextAreaElement).value).toBe(
        "/pause and explain the evidence",
    );
});
test("plain text requesting a pause still uses the model message path", async () => {
    render(<ConnectedStartWorkspace runId={runId} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Pause research." } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
        expect(submitMessage).toHaveBeenCalledWith(
            expect.objectContaining({ text: "Pause research." }),
        ),
    );
    expect(command).not.toHaveBeenCalled();
});
test("selecting /model opens the same model menu without a research operation", async () => {
    render(<ConnectedStartWorkspace runId={runId} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "/model" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(
        await screen.findByRole("menuitemradio", {
            name: "DeepSeek V4.1 Flash 1017",
        }),
    ).toBeTruthy();
    expect(command).not.toHaveBeenCalled();
    expect(submitMessage).not.toHaveBeenCalled();
});
test("the same composer saves an edited question against the visible framing revision", async () => {
    render(<ConnectedStartWorkspace runId={runId} />);
    expect(screen.getByText("Who controls coordination?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Edit question" }));
    fireEvent.change(screen.getByRole("textbox"), {
        target: { value: "Who can set the workflow rules?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
        expect(save).toHaveBeenCalledWith(
            expect.objectContaining({
                runId,
                expectedRevision: 2,
                content: expect.objectContaining({
                    questions: [
                        expect.objectContaining({
                            id: "q1",
                            text: "Who can set the workflow rules?",
                        }),
                    ],
                }),
            }),
        ),
    );
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
});
test("adding a question preserves the existing program and draft without starting research", async () => {
    render(<ConnectedStartWorkspace runId={runId} />);
    fireEvent.change(
        screen.getByRole("textbox", {
            name: "Refine the framing in your own words",
        }),
        { target: { value: "Keep my ordinary draft." } },
    );
    fireEvent.click(
        screen.getByRole("button", { name: "Add research question" }),
    );
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Start research" })).toBeNull();
    fireEvent.change(
        screen.getByRole("textbox", { name: "Add research question" }),
        { target: { value: "Can agents change pricing power?" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Add question" }));
    await waitFor(() =>
        expect(save).toHaveBeenCalledWith({
            runId,
            expectedRevision: 2,
            requestKey: expect.any(String),
            content: {
                scope: "Claims coordination",
                questions: [
                    readySnapshot.framing.content.questions[0],
                    {
                        id: expect.any(String),
                        text: "Can agents change pricing power?",
                        shortLabel: "Question 2",
                        rationale: "Added by the analyst.",
                    },
                ],
            },
        }),
    );
    await waitFor(() =>
        expect(
            screen.getByRole<HTMLTextAreaElement>("textbox", {
                name: "Refine the framing in your own words",
            }).value,
        ).toBe("Keep my ordinary draft."),
    );
    expect(start).not.toHaveBeenCalled();
    expect(submitMessage).not.toHaveBeenCalled();
});

test("Start research commits the visible revision", async () => {
    render(<ConnectedStartWorkspace runId={runId} />);
    fireEvent.click(screen.getByRole("button", { name: "Start research" }));
    await waitFor(() =>
        expect(start).toHaveBeenCalledWith(
            expect.objectContaining({ runId, expectedRevision: 2 }),
        ),
    );
});

const programQuestion = (id: string) => ({
    id,
    shortLabel: id,
    text: `What constrains ${id}?`,
    rationale: "Economic control.",
});
function frameProgram(
    questions: string[],
    researchStart: { block: string | null; questionCapacity: number | null },
) {
    convexReactHarness.query(api.workbench.snapshot).returns({
        ...readySnapshot,
        framing: {
            ...readySnapshot.framing,
            content: {
                ...readySnapshot.framing.content,
                questions: questions.map(programQuestion),
            },
        },
        researchStart,
    });
}

test("a program at documentary capacity shows its limit and cannot grow, while Start stays available", () => {
    frameProgram(["switching", "pricing", "renewals"], {
        block: null,
        questionCapacity: 3,
    });
    render(<ConnectedStartWorkspace runId={runId} />);
    expect(screen.getByText("3 of 3 questions")).toBeTruthy();
    const add = screen.getByRole<HTMLButtonElement>("button", {
        name: "Add research question",
    });
    expect(add.disabled).toBe(true);
    expect(
        screen.getByText(
            "Documentary preparation can take on 3 research questions in this workspace. Edit an existing question instead.",
        ),
    ).toBeTruthy();
    expect(
        screen.getByRole<HTMLButtonElement>("button", {
            name: "Start research",
        }).disabled,
    ).toBe(false);
});

test.each([
    {
        block: "sources_need_capacity",
        questions: ["switching", "pricing", "renewals"],
        capacity: 1,
        copy: "Remove 2 questions to start. Documentary preparation can take on 1 research question in this workspace. Your research program is saved.",
    },
    {
        block: "sources_configuration_unavailable",
        questions: ["switching"],
        capacity: null,
        copy: "Documentary preparation is not available in this workspace yet, so research cannot start. Your research program is saved.",
    },
    {
        block: "analysis_limit_reached",
        questions: ["switching"],
        capacity: 3,
        copy: "Every analysis available to this workspace has been used, so research cannot start. Your research program is saved.",
    },
    {
        block: "execution_slot_unavailable",
        questions: ["switching"],
        capacity: 3,
        copy: "Another of your analyses is still running. Start this one when it finishes. Your research program is saved.",
    },
])("Start is unavailable before any attempt when $block, with the next step", ({
    block,
    questions,
    capacity,
    copy,
}) => {
    frameProgram(questions, { block, questionCapacity: capacity });
    const view = render(<ConnectedStartWorkspace runId={runId} />);
    const startButton = screen.getByRole<HTMLButtonElement>("button", {
        name: "Start research",
    });
    expect(startButton.disabled).toBe(true);
    expect(screen.getByText(copy)).toBeTruthy();
    fireEvent.click(startButton);
    expect(start).not.toHaveBeenCalled();
    expect(screen.queryByText("Action unavailable")).toBeNull();
    expect(view.container.textContent).not.toContain(block);
});

test("research pause has a distinct control from stopping the conversation", async () => {
    const existing = convexReactHarness.query(api.workbench.snapshot);
    existing.returns({
        run: {
            _id: runId,
            startMode: "framed",
            fixedFramingRevisionId: "framing-1",
            lifecycleState: "discovering_sources",
            executionStatus: "running",
            executionGeneration: 3,
        },
        company: { legalName: "Example Technology", ticker: "EX" },
        framing: null,
        researchStart: {
            block: "research_already_started",
            questionCapacity: null,
        },
        researchControlAvailable: true,
        availableCommands: ["/pause"],
        activeWork: null,
        preparation: null,
        instructions: [],
        sources: [],
    });
    render(<ConnectedStartWorkspace runId={runId} />);
    fireEvent.click(screen.getByRole("button", { name: "Pause research" }));
    await waitFor(() =>
        expect(pause).toHaveBeenCalledWith({ runId, expectedGeneration: 3 }),
    );
    expect(screen.queryByText("executionGeneration")).toBeNull();
});

test("a query retry preserves an unsaved question and its revision", () => {
    const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
    try {
        const view = render(<ConnectedStartWorkspace runId={runId} />);
        fireEvent.click(screen.getByRole("button", { name: "Edit question" }));
        fireEvent.change(screen.getByRole("textbox"), {
            target: { value: "Unsaved analyst wording" },
        });
        convexReactHarness
            .query(api.workbench.snapshot)
            .throws(new Error("private diagnostic"));
        expect(() =>
            view.rerender(<ConnectedStartWorkspace runId={runId} />),
        ).not.toThrow();
        expect(
            screen.getByText("Research conversation unavailable"),
        ).toBeTruthy();
        expect(screen.queryByText("private diagnostic")).toBeNull();
        convexReactHarness.query(api.workbench.snapshot).returns(readySnapshot);
        fireEvent.click(screen.getByRole("button", { name: "Try again" }));
        expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
            "Unsaved analyst wording",
        );
    } finally {
        consoleError.mockRestore();
    }
});

test("insufficient evidence does not announce prepared sources or future discovery", () => {
    convexReactHarness.query(api.workbench.snapshot).returns({
        ...readySnapshot,
        run: {
            ...readySnapshot.run,
            fixedFramingRevisionId: "framing-1",
            lifecycleState: "completed",
            executionStatus: "completed",
            completionOutcome: "insufficient_public_evidence",
        },
    });
    render(<ConnectedStartWorkspace runId={runId} />);
    expect(screen.getByText("Public evidence is insufficient")).toBeTruthy();
    expect(screen.queryByText("Documentary material ready")).toBeNull();
    expect(
        screen.queryByText("Documents will appear as they are found."),
    ).toBeNull();
    expect(
        screen.getByRole("button", { name: "Start another analysis" }),
    ).toBeTruthy();
});

test("historical work subscribes to its operation detail only on inspection", () => {
    const turnId = "turn-old" as Id<"agentConversationTurns">;
    const turn = {
        _id: turnId,
        status: "published",
        createdAt: 1,
        completedAt: 2,
        publishedMessageId: "answer-old",
    };
    convexReactHarness.paginatedQuery(api.workbench.history).returns({
        results: [
            {
                _id: "answer-old",
                role: "assistant",
                text: "A retained answer",
                status: "published",
                turnId,
                work: {
                    turn,
                    deferred: true,
                    operations: [],
                    operationsLimited: false,
                },
            },
        ],
        status: "Exhausted",
        loadMore: vi.fn(),
    });
    const details = vi.fn(() => ({
        turn,
        operations: [
            {
                id: "operation-old",
                title: "Inspect dossier progress",
                status: "completed",
                succeeded: true,
                createdAt: 1,
            },
        ],
        operationsLimited: false,
    }));
    convexReactHarness.query(api.workbench.turnWork).returnsFrom(details);
    render(<ConnectedStartWorkspace runId={runId} />);
    expect(details).not.toHaveBeenCalled();
    expect(screen.getByText("A retained answer")).toBeTruthy();
    fireEvent.click(
        screen.getByRole("button", { name: "Inspect work for this turn" }),
    );
    expect(details).toHaveBeenCalledWith({ args: { runId, turnId } });
    expect(screen.getByText("Inspect dossier progress")).toBeTruthy();
    expect(screen.getByText("A retained answer")).toBeTruthy();
});

test("an oversized queued message shows recovery guidance without diagnostic keys", () => {
    convexReactHarness.query(api.execution.conversations.get).returns({
        activeTurn: null,
        execution: null,
        queuedCount: 1,
        queuePaused: true,
        admissionFailure: { code: "context_capacity" },
    });
    render(<ConnectedStartWorkspace runId={runId} />);
    expect(screen.getByText("A queued message needs attention")).toBeTruthy();
    expect(
        screen.getByText(
            "A queued message could not fit in this response. Remove it from the queue and send a shorter request; later messages are saved.",
        ),
    ).toBeTruthy();
    expect(screen.queryByText("context_capacity")).toBeNull();
    expect(screen.queryByRole("button", { name: "Resume queue" })).toBeNull();
});

test("the PastaUI effort menu sends a persisted choice and preserves the draft", async () => {
    render(<ConnectedStartWorkspace runId={runId} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Keep this draft" } });
    fireEvent.click(
        screen.getByRole("button", { name: "Workbench model and effort" }),
    );
    fireEvent.click(
        await screen.findByRole("menuitem", { name: /Effort Low/ }),
    );
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "High" }));
    await waitFor(() =>
        expect(setModel).toHaveBeenCalledWith(
            expect.objectContaining({
                runId,
                catalogId: "model-glm",
                reasoningEffort: "high",
                expectedRevision: 0,
            }),
        ),
    );
    expect((input as HTMLTextAreaElement).value).toBe("Keep this draft");
    expect(submitMessage).not.toHaveBeenCalled();
});

test("a native slash selection restores its original draft after an unconfirmed operation", async () => {
    command.mockRejectedValueOnce(new Error("Lost acknowledgement"));
    render(<ConnectedStartWorkspace runId={runId} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "/p" } });
    fireEvent.click(await screen.findByRole("option", { name: /^\/pause/ }));
    await screen.findByText("Command not confirmed");
    expect((input as HTMLTextAreaElement).value).toBe("/p");
    expect(submitMessage).not.toHaveBeenCalled();
});

test("cancelling the first question restores the ordinary draft and keyboard focus", async () => {
    convexReactHarness.query(api.workbench.snapshot).returns({
        ...readySnapshot,
        framing: {
            ...readySnapshot.framing,
            content: { ...readySnapshot.framing.content, questions: [] },
        },
    });
    render(<ConnectedStartWorkspace runId={runId} />);
    const input = screen.getByRole("textbox", {
        name: "Refine the framing in your own words",
    });
    fireEvent.change(input, {
        target: { value: "Keep my conversation draft" },
    });
    fireEvent.click(
        screen.getByRole("button", { name: "Add research question" }),
    );
    fireEvent.change(
        screen.getByRole("textbox", { name: "Add research question" }),
        { target: { value: "Who sets the rules?" } },
    );
    const cancel = screen.getByRole("button", { name: "Cancel" });
    cancel.focus();
    fireEvent.click(cancel);
    await waitFor(() => {
        const restored = screen.getByRole("textbox", {
            name: "Refine the framing in your own words",
        });
        expect((restored as HTMLTextAreaElement).value).toBe(
            "Keep my conversation draft",
        );
        expect(document.activeElement).toBe(restored);
    });
});

test("keeps an ordinary message available after a rejected submission", async () => {
    submitMessage.mockRejectedValueOnce(
        new Error("Rejected before persistence"),
    );
    render(<ConnectedStartWorkspace runId={runId} />);
    const input = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(input, {
        target: { value: "My unsaved analyst request" },
    });
    fireEvent.keyDown(input, { key: "Enter" });
    await screen.findByText("Your message could not be sent");
    expect(input.value).toBe("My unsaved analyst request");
});

test("prevents a second ordinary send while first acknowledgement is pending", async () => {
    submitMessage.mockImplementationOnce(() => new Promise(() => {}));
    render(<ConnectedStartWorkspace runId={runId} />);
    const input = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "One request" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(submitMessage).toHaveBeenCalledTimes(1));
    expect(input.disabled).toBe(true);
});

test.each([
    true,
    false,
])("model selection renews a confirmed conflict and replays an unknown acknowledgement (%s)", async (confirmed) => {
    setModel.mockRejectedValueOnce(
        confirmed
            ? new ConvexError({ code: "model_configuration_conflict" })
            : new Error("Acknowledgement unavailable"),
    );
    const view = render(<ConnectedStartWorkspace runId={runId} />);
    const choose = async () => {
        fireEvent.click(
            screen.getByRole("button", { name: "Workbench model and effort" }),
        );
        const option = await screen.findByRole("menuitemradio", {
            name: "DeepSeek V4.1 Flash 1017",
        });
        fireEvent.pointerDown(option, { pointerType: "mouse", button: 0 });
        fireEvent.click(option);
    };
    await choose();
    await screen.findByText(
        "The model settings could not be confirmed. Check the selection and try again.",
    );
    convexReactHarness.query(api.workbench.models).returns({
        selectedId: "model-glm",
        effort: "low",
        effortChoices: ["low", "high"],
        label: "GLM-5.3-Flash",
        available: true,
        revision: 1,
        choices: [
            { id: "model-glm", label: "GLM-5.3-Flash" },
            { id: "model-deepseek", label: "DeepSeek V4.1 Flash 1017" },
        ],
    });
    view.rerender(<ConnectedStartWorkspace runId={runId} />);
    await choose();
    await waitFor(() => expect(setModel).toHaveBeenCalledTimes(2));
    expect(setModel.mock.calls[1]?.[0].expectedRevision).toBe(
        confirmed ? 1 : 0,
    );
    const first = setModel.mock.calls[0]?.[0],
        second = setModel.mock.calls[1]?.[0];
    if (confirmed) expect(second?.requestKey).not.toBe(first?.requestKey);
    else expect(second?.requestKey).toBe(first?.requestKey);
});

test("a launched dossier keeps the research viewport free of segment-scroll and offers workspace sections on the timeline detail view", () => {
    convexReactHarness.query(api.workbench.snapshot).returns({
        ...readySnapshot,
        run: {
            ...readySnapshot.run,
            fixedFramingRevisionId: "framing-1",
            lifecycleState: "discovering_sources",
            executionStatus: "running",
        },
    });
    const { rerender } = render(<ConnectedStartWorkspace runId={runId} />);
    expect(
        screen.queryByRole("navigation", {
            name: "Research workspace sections",
        }),
    ).toBeNull();
    expect(
        screen.getAllByRole("button", { name: /View progress/ }).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /Open Progress/i })).toBeNull();

    rerender(
        <ConnectedStartWorkspace
            runId={runId}
            detail="timeline"
            progress={<p>Timeline entries</p>}
        />,
    );
    const sections = screen.getByRole("navigation", {
        name: "Research workspace sections",
    });
    expect(
        within(sections)
            .getByRole("link", { name: /Research/ })
            .getAttribute("aria-current"),
    ).toBe("page");
    expect(
        within(sections).getByRole("link", { name: "Sources" }),
    ).toBeTruthy();
});

test("framing before launch keeps its screen without workspace sections", () => {
    render(<ConnectedStartWorkspace runId={runId} />);
    expect(
        screen.queryByRole("navigation", {
            name: "Research workspace sections",
        }),
    ).toBeNull();
});
