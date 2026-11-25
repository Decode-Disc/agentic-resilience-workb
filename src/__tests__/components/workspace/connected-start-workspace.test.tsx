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
    researchResumeAvailable: true,
    sourcesSettlementAvailable: false,
    sourcesPhase: "collecting",
    sourcesDecisionRequestId: null,
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
    convexReactHarness.query(api.workbench.responsePreview).returns(null);
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
    convexReactHarness.query(api.execution.approvals.listGrants).returns([]);
    convexReactHarness.query(api.execution.approvals.get).returns(undefined);
    convexReactHarness.mutation(api.execution.approvals.decide).uses(vi.fn());
    convexReactHarness
        .mutation(api.execution.approvals.revokeGrant)
        .uses(vi.fn());
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

test("a paged reply stays in one message, retries its missing chunk, and copies exact text", async () => {
    const messageId = "stored-reply" as Id<"agentMessageDeliveries">;
    const firstText = "Control sits with ";
    const lastText = "the workflow operator. 😀";
    const fullText = firstText + lastText;
    let releaseFirst: () => void = () => {};
    const firstReady = new Promise<void>((resolve) => {
        releaseFirst = resolve;
    });
    let fail = true;
    const indices: number[] = [];
    convexReactHarness
        .query(api.execution.conversations.readMessageBody)
        .returnsFrom(({ args }) => {
            if (args === "skip") return undefined;
            expect(args).toMatchObject({
                runId,
                messageId,
                contentHash: "published-reply",
            });
            indices.push(args.index);
            if (args.index === 0)
                return firstReady.then(() => ({
                    content: firstText,
                    offset: 0,
                    totalCharacters: fullText.length,
                    nextIndex: 1,
                }));
            if (fail) throw new Error("storage_debug_id");
            return {
                content: lastText,
                offset: firstText.length,
                totalCharacters: fullText.length,
                nextIndex: null,
            };
        });
    convexReactHarness
        .paginatedQuery(api.workbench.history)
        .returnsFrom(({ args }) => {
            expect(args).toMatchObject({ runId, bodyAccess: "separate" });
            return {
                results: [
                    {
                        _id: messageId,
                        runId,
                        role: "assistant",
                        delivery: "reply",
                        status: "processed",
                        text: "",
                        body: { contentHash: "published-reply" },
                        createdAt: 1,
                        work: null,
                    },
                ],
                status: "Exhausted",
                loadMore: vi.fn(),
            };
        });
    render(<ConnectedStartWorkspace runId={runId} />);
    expect(screen.getByLabelText("Loading reply")).toBeTruthy();
    expect(
        screen
            .getByRole("button", { name: "Copy message" })
            .hasAttribute("disabled"),
    ).toBe(true);
    await act(async () => releaseFirst());
    expect(await screen.findByText("Reply unavailable")).toBeTruthy();
    expect(screen.queryByText(/storage_debug_id|Control sits with/)).toBeNull();
    expect(
        screen
            .getByRole("button", { name: "Copy message" })
            .hasAttribute("disabled"),
    ).toBe(true);

    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText(fullText)).toBeTruthy();
    expect(screen.getAllByRole("article", { name: /message/i })).toHaveLength(
        1,
    );
    expect(indices).toEqual([0, 1, 1]);

    const originalClipboard = Object.getOwnPropertyDescriptor(
        navigator,
        "clipboard",
    );
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText },
    });
    try {
        fireEvent.click(screen.getByRole("button", { name: "Copy message" }));
        await waitFor(() => expect(writeText).toHaveBeenCalledWith(fullText));
    } finally {
        if (originalClipboard)
            Object.defineProperty(navigator, "clipboard", originalClipboard);
        else Reflect.deleteProperty(navigator, "clipboard");
    }
});

test("leaving a reply stops its pending fragment continuation", async () => {
    const messageId = "removed-reply" as Id<"agentMessageDeliveries">;
    let release: () => void = () => {};
    const pending = new Promise<void>((resolve) => {
        release = resolve;
    });
    const reads: number[] = [];
    convexReactHarness
        .query(api.execution.conversations.readMessageBody)
        .returnsFrom(({ args }) => {
            if (args === "skip") return undefined;
            reads.push(args.index);
            return pending.then(() => ({
                content: "Obsolete",
                offset: 0,
                totalCharacters: 20,
                nextIndex: 1,
            }));
        });
    const history = convexReactHarness.paginatedQuery(api.workbench.history);
    history.returns({
        results: [
            {
                _id: messageId,
                runId,
                role: "assistant",
                delivery: "reply",
                status: "processed",
                text: "",
                body: { contentHash: "obsolete-reply" },
                createdAt: 1,
                work: null,
            },
        ],
        status: "Exhausted",
        loadMore: vi.fn(),
    });
    const { rerender } = render(<ConnectedStartWorkspace runId={runId} />);
    expect(reads).toEqual([0]);
    history.returns({ results: [], status: "Exhausted", loadMore: vi.fn() });
    rerender(<ConnectedStartWorkspace runId={runId} />);
    await act(async () => release());
    expect(reads).toEqual([0]);
    expect(screen.queryByText("Obsolete")).toBeNull();
});

test.each([
    false,
    true,
])("a queued message is in the transcript unless a response is already active (%s)", (active) => {
    convexReactHarness.query(api.execution.conversations.get).returns({
        activeTurn: active
            ? { _id: "turn-active", status: "active", createdAt: 1 }
            : null,
        execution: active ? { status: "running" } : null,
        queuedCount: 1,
        queuePaused: false,
    });
    convexReactHarness.paginatedQuery(api.workbench.history).returns({
        results: [
            {
                _id: "pending-message",
                runId,
                requestKey: "pending",
                role: "user",
                delivery: "queue",
                status: "queued",
                text: "Inspect the existing material",
                createdAt: 1,
                work: null,
            },
        ],
        status: "Exhausted",
        loadMore: vi.fn(),
    });
    render(<ConnectedStartWorkspace runId={runId} />);
    const transcript = screen.queryByRole("article", { name: "You message" });
    if (active) {
        expect(transcript).toBeNull();
        expect(
            within(
                screen.getByRole("region", { name: "Queued messages" }),
            ).getByText("Inspect the existing material"),
        ).toBeTruthy();
    } else {
        expect(transcript?.textContent).toContain(
            "Inspect the existing material",
        );
        expect(
            screen.queryByRole("region", { name: "Queued messages" }),
        ).toBeNull();
    }
});

test("distinguishes the Sources Agent identity from the source collection", () => {
    convexReactHarness.query(api.workbench.snapshot).returns({
        ...readySnapshot,
        run: {
            ...readySnapshot.run,
            fixedFramingRevisionId: "framing-1",
            lifecycleState: "sources_prepared",
            executionStatus: "idle",
        },
        preparation: { status: "partial" },
    });
    render(<ConnectedStartWorkspace runId={runId} />);
    expect(
        screen.getByRole("region", {
            name: "Sources Agent · Documentary preparation",
        }),
    ).toBeTruthy();
    expect(
        document.querySelector('[data-slot="conversation-header"]')
            ?.textContent,
    ).not.toContain("//");
});

test("the Sources context explains a model interruption without declaring documentary completion", () => {
    const detail =
        "Preparation was interrupted because the agent's response could not be used. Retained material remains available.";
    convexReactHarness.query(api.workbench.snapshot).returns({
        ...readySnapshot,
        run: {
            ...readySnapshot.run,
            fixedFramingRevisionId: "framing-1",
            lifecycleState: "discovering_sources",
            executionStatus: "paused",
            pauseReason: "execution_interrupted",
        },
        preparation: { status: "started" },
        sourcesPhase: "interrupted",
        sourcesWork: {
            missionId: "sources-mission",
            startedAt: 1,
            operations: [],
            interruptionDetail: detail,
        },
    });
    render(<ConnectedStartWorkspace runId={runId} />);
    const work = within(
        within(
            screen.getByRole("region", { name: "Research context details" }),
        ).getByRole("region", { name: "Work" }),
    );
    expect(work.getByRole("status").textContent).toMatch(/Interrupted/);
    expect(screen.getAllByText(detail).length).toBeGreaterThan(0);
    expect(
        screen.queryByText("Documentary preparation completed with limits"),
    ).toBeNull();
    expect(
        screen.queryByText(/invalid_output|tool_arguments_invalid/),
    ).toBeNull();
});

test("the context identifies a launched research program as accepted", () => {
    convexReactHarness.query(api.workbench.snapshot).returns({
        ...readySnapshot,
        run: {
            ...readySnapshot.run,
            fixedFramingRevisionId: "framing-1",
            lifecycleState: "sources_prepared",
            executionStatus: "idle",
        },
        preparation: { status: "partial" },
    });
    render(<ConnectedStartWorkspace runId={runId} />);
    expect(
        within(
            screen.getByRole("region", { name: "Research context details" }),
        ).getByRole("region", { name: "Accepted research program" }),
    ).toBeTruthy();
    expect(
        screen.queryByRole("region", { name: "Proposed research scope" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Start research" })).toBeNull();
});

test.each([
    ["partial", "completed_with_limits", "Complete with limits", "completed"],
    ["blocked", "ended_without_material", "No material", "blocked"],
] as const)("settled %s material keeps its outcome in the header and activity", (status, sourcesPhase, label, state) => {
    convexReactHarness.query(api.workbench.snapshot).returns({
        ...readySnapshot,
        run: {
            ...readySnapshot.run,
            fixedFramingRevisionId: "framing-1",
            lifecycleState: "sources_prepared",
            executionStatus: "idle",
        },
        preparation: { status },
        sourcesPhase,
    });
    render(<ConnectedStartWorkspace runId={runId} />);
    const mission = document.querySelector(
        '[data-mission-id="sources:run-connected"]',
    );
    expect(mission).not.toBeNull();
    if (!(mission instanceof HTMLElement))
        throw new Error("Missing Sources mission");
    expect(mission.getAttribute("data-state")).toBe(state);
    // The stage is named once and its state is a single pill beside the name.
    const stage = screen.getByRole("region", { name: "Documentary progress" });
    expect(
        within(stage).getByRole("heading", { level: 2, name: "Sources" }),
    ).toBeTruthy();
    expect(within(stage).getByText(label)).toBeTruthy();
    expect(mission.textContent).toContain(label);
    expect(screen.queryByText("Documentary material ready")).toBeNull();
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
test("an inline question edit saves against the visible framing revision and leaves the composer alone", async () => {
    render(<ConnectedStartWorkspace runId={runId} />);
    expect(screen.getByText("Who controls coordination?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Edit question" }));
    fireEvent.change(
        screen.getByRole("textbox", { name: "Edit research question" }),
        { target: { value: "Who can set the workflow rules?" } },
    );
    expect(
        screen.getByRole("textbox", {
            name: "Refine the framing in your own words",
        }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save question" }));
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
    await waitFor(() =>
        expect(
            screen.queryByRole("textbox", { name: "Edit research question" }),
        ).toBeNull(),
    );
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
        screen.getByRole("button", {
            name: "Add research question",
            description:
                "This workspace can prepare sources for up to 3 research questions. Edit a question to change focus.",
        }),
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
        sourcesPhase: "collecting",
        sourcesDecisionRequestId: null,
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

test("a requested pause says it waits for the current step and can be withdrawn", async () => {
    convexReactHarness.query(api.workbench.snapshot).returns({
        ...readySnapshot,
        run: {
            ...readySnapshot.run,
            fixedFramingRevisionId: "framing-1",
            lifecycleState: "discovering_sources",
            executionStatus: "running",
            executionGeneration: 3,
            researchPauseRequested: true,
        },
        researchControlAvailable: true,
        sourcesPhase: "collecting",
    });
    render(<ConnectedStartWorkspace runId={runId} />);
    const progress = screen.getByRole("region", {
        name: "Documentary progress",
    });
    expect(
        within(progress).getByText("Pausing after the current step"),
    ).toBeTruthy();
    expect(
        within(progress).queryByRole("button", { name: "Pause research" }),
    ).toBeNull();
    fireEvent.click(
        within(progress).getByRole("button", { name: "Keep researching" }),
    );
    await waitFor(() =>
        expect(resumeResearch).toHaveBeenCalledWith({
            runId,
            expectedGeneration: 3,
        }),
    );
});

test("a query retry preserves an unsaved question and its revision", () => {
    const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
    try {
        const view = render(<ConnectedStartWorkspace runId={runId} />);
        fireEvent.click(screen.getByRole("button", { name: "Edit question" }));
        fireEvent.change(
            screen.getByRole("textbox", { name: "Edit research question" }),
            { target: { value: "Unsaved analyst wording" } },
        );
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
        expect(
            screen.getByRole<HTMLTextAreaElement>("textbox", {
                name: "Edit research question",
            }).value,
        ).toBe("Unsaved analyst wording");
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
        sourcesPhase: "insufficient_evidence",
    });
    render(<ConnectedStartWorkspace runId={runId} />);
    const stage = screen.getByRole("region", { name: "Documentary progress" });
    expect(within(stage).getByText("Limited material")).toBeTruthy();
    expect(
        within(stage).getByText(
            "Public evidence was not sufficient to prepare documentary material for this program.",
        ),
    ).toBeTruthy();
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

test("a launched dossier opens Progress with its sections, question and current stage, and no separate progress page", () => {
    convexReactHarness.query(api.workbench.snapshot).returns({
        ...readySnapshot,
        run: {
            ...readySnapshot.run,
            fixedFramingRevisionId: "framing-1",
            lifecycleState: "discovering_sources",
            executionStatus: "running",
            researchAngle: "Will Example keep its workflow position?",
        },
    });
    render(<ConnectedStartWorkspace runId={runId} />);
    const sections = screen.getByRole("navigation", {
        name: "Research workspace sections",
    });
    expect(
        within(sections)
            .getByRole("link", { name: "Overview" })
            .getAttribute("aria-current"),
    ).toBe("page");
    expect(
        within(sections).getByRole("link", { name: "Sources" }),
    ).toBeTruthy();
    const stage = screen.getByRole("region", { name: "Dossier stage" });
    expect(
        within(stage).getByRole("heading", {
            name: "Will Example keep its workflow position?",
        }),
    ).toBeTruthy();
    const stepper = within(stage).getByRole("list", { name: "Dossier stages" });
    expect(
        within(stepper)
            .getByText("Sources")
            .closest("li")
            ?.getAttribute("aria-current"),
    ).toBe("step");
    expect(screen.queryByRole("button", { name: /View progress/ })).toBeNull();
});

test("framing before launch keeps its screen without workspace sections", () => {
    render(<ConnectedStartWorkspace runId={runId} />);
    expect(
        screen.queryByRole("navigation", {
            name: "Research workspace sections",
        }),
    ).toBeNull();
});

test("the connected conversation renders a growing provisional reply outside operation details", async () => {
    const activeWork = {
        turn: {
            _id: "turn-progress",
            status: "active",
            createdAt: 1,
            preview: {
                text: "Reading the saved program.",
                instructionVersion: 1,
            },
        },
        missionStatus: "running",
        operations: [],
        operationsLimited: false,
    };
    convexReactHarness
        .query(api.workbench.snapshot)
        .returns({ ...readySnapshot, activeWork });
    convexReactHarness.query(api.workbench.responsePreview).returns({
        turnId: "turn-progress",
        text: "Reading the saved program.",
    });
    const view = render(<ConnectedStartWorkspace runId={runId} />);
    expect(await screen.findByText("Reading the saved program.")).toBeTruthy();
    expect(screen.getByText("Draft reply")).toBeTruthy();
    convexReactHarness.query(api.workbench.snapshot).returns({
        ...readySnapshot,
        activeWork: {
            ...activeWork,
            turn: {
                ...activeWork.turn,
                preview: {
                    ...activeWork.turn.preview,
                    text: "Reading the saved program. The scope is unchanged.",
                },
            },
        },
    });
    convexReactHarness.query(api.workbench.responsePreview).returns({
        turnId: "turn-progress",
        text: "Reading the saved program. The scope is unchanged.",
    });
    view.rerender(<ConnectedStartWorkspace runId={runId} />);
    expect(
        await screen.findAllByText(
            "Reading the saved program. The scope is unchanged.",
        ),
    ).toHaveLength(1);
    convexReactHarness.paginatedQuery(api.workbench.history).returns({
        results: [
            {
                _id: "published-progress",
                role: "assistant",
                turnId: "turn-progress",
                status: "processed",
                text: "The scope is unchanged.",
                createdAt: 2,
                work: {
                    ...activeWork,
                    turn: {
                        ...activeWork.turn,
                        status: "published",
                        publishedMessageId: "published-progress",
                        preview: undefined,
                    },
                },
            },
        ],
        status: "Exhausted",
        loadMore: vi.fn(),
    });
    // History and the active-work subscription can arrive in either order.
    view.rerender(<ConnectedStartWorkspace runId={runId} />);
    expect(await screen.findAllByText("The scope is unchanged.")).toHaveLength(
        1,
    );
    expect(
        screen.queryByText(
            "Reading the saved program. The scope is unchanged.",
        ),
    ).toBeNull();
});

test("a blocked response keeps its partial text without claiming it is still generating", async () => {
    convexReactHarness.query(api.workbench.snapshot).returns({
        ...readySnapshot,
        activeWork: {
            turn: { _id: "turn-blocked", status: "active", createdAt: 1 },
            missionStatus: "blocked",
            operations: [],
            operationsLimited: false,
        },
    });
    convexReactHarness.query(api.workbench.responsePreview).returns({
        turnId: "turn-blocked",
        text: "The saved material supports this first observation.",
    });
    render(<ConnectedStartWorkspace runId={runId} />);
    expect(
        await screen.findByText(
            "The saved material supports this first observation.",
        ),
    ).toBeTruthy();
    expect(screen.queryByText("Draft reply")).toBeNull();
    expect(
        screen.getByText(/Response interrupted. The partial reply remains/),
    ).toBeTruthy();
});

test("dossier context summarizes source populations without rendering the entire collection", () => {
    convexReactHarness.query(api.workbench.snapshot).returns({
        ...readySnapshot,
        sources: [
            {
                id: "source-a",
                title: "A very long annual filing title",
                state: "captured",
                url: "https://example.test/filing",
            },
            {
                id: "source-b",
                title: "Another independent reference",
                state: "found",
                url: "https://example.test/research",
            },
        ],
    });
    render(<ConnectedStartWorkspace runId={runId} />);
    expect(screen.queryByText("A very long annual filing title")).toBeNull();
    expect(screen.queryByText("Another independent reference")).toBeNull();
    expect(screen.getByText("2 references · 1 saved capture")).toBeTruthy();
});

test("offers a return to offscreen active Sources work and removes it on completion", async () => {
    const callbacks: IntersectionObserverCallback[] = [];
    vi.stubGlobal(
        "IntersectionObserver",
        class {
            constructor(callback: IntersectionObserverCallback) {
                callbacks.push(callback);
            }
            observe() {}
            unobserve() {}
            disconnect() {}
            takeRecords() {
                return [];
            }
        },
    );
    try {
        const snapshot = {
            ...readySnapshot,
            run: {
                ...readySnapshot.run,
                fixedFramingRevisionId: "framing-1",
                lifecycleState: "discovering_sources",
                executionStatus: "running",
            },
        };
        convexReactHarness.query(api.workbench.snapshot).returns(snapshot);
        const view = render(<ConnectedStartWorkspace runId={runId} />);
        const mission = document.querySelector<HTMLElement>(
            '[data-mission-id="sources:run-connected"]',
        );
        if (!mission) throw new Error("Sources mission missing");
        const observer = new IntersectionObserver(() => {});
        for (const callback of [...callbacks])
            callback(
                [
                    {
                        target: mission,
                        isIntersecting: false,
                        boundingClientRect: new DOMRect(),
                        intersectionRect: new DOMRect(),
                        rootBounds: null,
                        intersectionRatio: 0,
                        time: 0,
                    },
                ],
                observer,
            );
        const control = await screen.findByRole("button", {
            name: /Return to Sources Agent work/,
        });
        mission.scrollIntoView = vi.fn();
        fireEvent.click(control);
        expect(document.activeElement).toBe(mission);
        convexReactHarness.query(api.workbench.snapshot).returns({
            ...snapshot,
            preparation: { missionStatus: "completed", status: "partial" },
            sourcesPhase: "completed_with_limits",
        });
        view.rerender(<ConnectedStartWorkspace runId={runId} />);
        expect(
            screen.queryByRole("button", {
                name: /Return to Sources Agent work/,
            }),
        ).toBeNull();
    } finally {
        vi.unstubAllGlobals();
    }
});

const approvalRequestId = "approval-time-limit-1" as Id<"approvalRequests">;
const timeLimitSnapshot = (
    requestId: Id<"approvalRequests"> | null = approvalRequestId,
) => ({
    ...readySnapshot,
    run: {
        ...readySnapshot.run,
        fixedFramingRevisionId: "framing-1",
        lifecycleState: "discovering_sources",
        executionStatus: "paused",
        pauseReason: "sources_time_limit",
        executionGeneration: 5,
    },
    sourcesPhase: "time_limit",
    sourcesDecisionRequestId: requestId,
});
const timeLimitView = (
    overrides: Partial<{
        status: "pending" | "approved" | "denied" | "superseded";
        block: string | null;
        grantActive: boolean;
        decision: {
            choice: "once" | "always" | "alternative" | "deny";
            via: "card" | "grant" | "command";
            decidedBy: { type: "system" };
            decidedAt: number;
            outcome:
                | { kind: "applied"; action: "continue_sources_preparation" }
                | { kind: "none" };
        } | null;
    }> = {},
) => ({
    id: approvalRequestId,
    runId,
    action: "continue_sources_preparation" as const,
    alternative: "settle_sources_preparation" as const,
    requestedBy: { type: "system" as const },
    status: "pending" as const,
    block: null,
    decision: null,
    grantActive: false,
    createdAt: 1,
    ...overrides,
});
const timeLimitRaw =
    /sources_time_limit|time_limit|execution_slot_unavailable|paid_work_disabled|stale_execution|approval_already_decided|continue_sources_preparation|settle_sources_preparation/;

const timeLimitNotice = () => ({
    results: [
        {
            _id: "notice-1" as Id<"agentMessageDeliveries">,
            runId,
            requestKey: `approval-notice:${approvalRequestId}`,
            role: "assistant",
            delivery: "notice",
            status: "processed",
            createdAt: 10,
            approvalRequestId,
            text: "The Sources Agent reached its time limit. Choose whether to continue preparation or use what's prepared.",
            work: null,
        },
    ],
    status: "Exhausted",
    loadMore: vi.fn(),
});

test("the progress header points to the conversation's decision instead of repeating it", async () => {
    convexReactHarness
        .query(api.workbench.snapshot)
        .returns(timeLimitSnapshot());
    convexReactHarness
        .paginatedQuery(api.workbench.history)
        .returns(timeLimitNotice());
    convexReactHarness
        .query(api.execution.approvals.get)
        .returns(timeLimitView());
    render(<ConnectedStartWorkspace runId={runId} />);
    const progress = screen.getByRole("region", {
        name: "Documentary progress",
    });
    expect(
        screen.getAllByRole("group", {
            name: "The Sources Agent reached its time limit",
        }),
    ).toHaveLength(1);
    expect(within(progress).queryByRole("group")).toBeNull();
    expect(
        within(progress).queryByRole("button", { name: "Continue once" }),
    ).toBeNull();
    fireEvent.click(
        within(progress).getByRole("button", { name: "Open decision" }),
    );
    await waitFor(() =>
        expect(document.activeElement).toBe(
            screen.getByRole("button", { name: "Use what's prepared" }),
        ),
    );
    expect(document.body.textContent).not.toMatch(timeLimitRaw);
});

test("a notice in the conversation renders its approval card", () => {
    convexReactHarness.query(api.workbench.snapshot).returns({
        ...readySnapshot,
        run: {
            ...readySnapshot.run,
            fixedFramingRevisionId: "framing-1",
            lifecycleState: "discovering_sources",
            executionStatus: "running",
        },
        sourcesPhase: "collecting",
    });
    convexReactHarness.paginatedQuery(api.workbench.history).returns({
        results: [
            {
                _id: "notice-1" as Id<"agentMessageDeliveries">,
                runId,
                requestKey: `approval-notice:${approvalRequestId}`,
                role: "assistant",
                delivery: "notice",
                status: "processed",
                createdAt: 10,
                approvalRequestId,
                text: "The Sources Agent reached its time limit. Choose whether to continue preparation or use what's prepared.",
                work: null,
            },
        ],
        status: "Exhausted",
        loadMore: vi.fn(),
    });
    convexReactHarness
        .query(api.execution.approvals.get)
        .returns(timeLimitView());
    render(<ConnectedStartWorkspace runId={runId} />);
    expect(
        screen.getByRole("group", {
            name: "The Sources Agent reached its time limit",
        }),
    ).toBeTruthy();
    expect(
        screen.getByRole("button", { name: "Use what's prepared" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Continue once" })).toBeTruthy();
    expect(
        screen.getByRole("button", { name: "Always continue" }),
    ).toBeTruthy();
    expect(document.body.textContent).not.toMatch(timeLimitRaw);
});

test("Continue once decides through approvals with the request id", async () => {
    const decide = vi.fn().mockResolvedValue(timeLimitView());
    convexReactHarness.mutation(api.execution.approvals.decide).uses(decide);
    convexReactHarness
        .query(api.execution.approvals.get)
        .returns(timeLimitView());
    convexReactHarness
        .query(api.workbench.snapshot)
        .returns(timeLimitSnapshot());
    convexReactHarness
        .paginatedQuery(api.workbench.history)
        .returns(timeLimitNotice());
    render(<ConnectedStartWorkspace runId={runId} />);
    expect(
        screen.getByRole("group", {
            name: "The Sources Agent reached its time limit",
        }),
    ).toBeTruthy();
    expect(
        screen.queryByRole("button", { name: "Resume research" }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Continue once" }));
    await waitFor(() =>
        expect(decide).toHaveBeenCalledWith({
            requestId: approvalRequestId,
            choice: "once",
        }),
    );
    expect(document.body.textContent).not.toMatch(timeLimitRaw);
});

test("Continue preparation is disabled with its reason before any attempt, while settling stays available", () => {
    convexReactHarness
        .query(api.execution.approvals.get)
        .returns(timeLimitView({ block: "execution_slot_unavailable" }));
    convexReactHarness
        .query(api.workbench.snapshot)
        .returns(timeLimitSnapshot());
    convexReactHarness
        .paginatedQuery(api.workbench.history)
        .returns(timeLimitNotice());
    render(<ConnectedStartWorkspace runId={runId} />);
    const once = screen.getByRole("button", { name: "Continue once" });
    const always = screen.getByRole("button", { name: "Always continue" });
    expect(once).toHaveProperty("disabled", true);
    expect(always).toHaveProperty("disabled", true);
    expect(once.getAttribute("aria-describedby")).toBeTruthy();
    expect(
        screen.getByText(
            "Another of your analyses is running. Continue when it finishes, or use what's prepared now.",
        ),
    ).toBeTruthy();
    expect(
        screen.getByRole("button", { name: "Use what's prepared" }),
    ).toHaveProperty("disabled", false);
    expect(document.body.textContent).not.toMatch(timeLimitRaw);
});

test("a refused decision shows that it was already decided", async () => {
    convexReactHarness
        .mutation(api.execution.approvals.decide)
        .uses(
            vi
                .fn()
                .mockRejectedValue(
                    new ConvexError({ code: "approval_already_decided" }),
                ),
        );
    convexReactHarness
        .query(api.execution.approvals.get)
        .returns(timeLimitView());
    convexReactHarness
        .query(api.workbench.snapshot)
        .returns(timeLimitSnapshot());
    convexReactHarness
        .paginatedQuery(api.workbench.history)
        .returns(timeLimitNotice());
    render(<ConnectedStartWorkspace runId={runId} />);
    fireEvent.click(
        screen.getByRole("button", { name: "Use what's prepared" }),
    );
    expect(
        await screen.findByText(
            "This was already decided. Showing the current state.",
        ),
    ).toBeTruthy();
    expect(document.body.textContent).not.toMatch(timeLimitRaw);
});

test("allowed actions can be revoked from the Commands picker", async () => {
    const revokeGrant = vi.fn().mockResolvedValue(null);
    convexReactHarness
        .mutation(api.execution.approvals.revokeGrant)
        .uses(revokeGrant);
    convexReactHarness
        .query(api.execution.approvals.listGrants)
        .returns([{ action: "continue_sources_preparation", grantedAt: 1 }]);
    render(<ConnectedStartWorkspace runId={runId} />);
    fireEvent.click(screen.getByRole("button", { name: "Composer tools" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Commands" }));
    const group = await screen.findByText("Allowed actions");
    expect(group).toBeTruthy();
    fireEvent.click(
        screen.getByRole("button", {
            name: /Continue preparation automatically/,
        }),
    );
    await waitFor(() =>
        expect(revokeGrant).toHaveBeenCalledWith({
            runId,
            action: "continue_sources_preparation",
        }),
    );
});

test("a card decided with Always offers Stop allowing while its grant is active", async () => {
    const revokeGrant = vi.fn().mockResolvedValue(null);
    convexReactHarness
        .mutation(api.execution.approvals.revokeGrant)
        .uses(revokeGrant);
    convexReactHarness.query(api.workbench.snapshot).returns({
        ...readySnapshot,
        run: {
            ...readySnapshot.run,
            fixedFramingRevisionId: "framing-1",
            lifecycleState: "discovering_sources",
            executionStatus: "running",
        },
        sourcesPhase: "collecting",
    });
    convexReactHarness.paginatedQuery(api.workbench.history).returns({
        results: [
            {
                _id: "notice-1" as Id<"agentMessageDeliveries">,
                runId,
                requestKey: `approval-notice:${approvalRequestId}`,
                role: "assistant",
                delivery: "notice",
                status: "processed",
                createdAt: 10,
                approvalRequestId,
                text: "The Sources Agent reached its time limit.",
                work: null,
            },
        ],
        status: "Exhausted",
        loadMore: vi.fn(),
    });
    convexReactHarness.query(api.execution.approvals.get).returns(
        timeLimitView({
            status: "approved",
            grantActive: true,
            decision: {
                choice: "always",
                via: "card",
                decidedBy: { type: "system" },
                decidedAt: 2,
                outcome: {
                    kind: "applied",
                    action: "continue_sources_preparation",
                },
            },
        }),
    );
    render(<ConnectedStartWorkspace runId={runId} />);
    const stopAllowing = screen.getByRole("button", { name: "Stop allowing" });
    fireEvent.click(stopAllowing);
    await waitFor(() =>
        expect(revokeGrant).toHaveBeenCalledWith({
            runId,
            action: "continue_sources_preparation",
        }),
    );
});

test("an unrecoverable Sources stop offers Use what's prepared through its decision and hides Resume", async () => {
    const view = {
        ...timeLimitView(),
        action: "settle_sources_preparation" as const,
        alternative: null,
    };
    const usePrepared = vi.fn().mockResolvedValue(view);
    convexReactHarness
        .mutation(api.execution.approvals.usePreparedSources)
        .uses(usePrepared);
    convexReactHarness.query(api.workbench.snapshot).returns({
        ...timeLimitSnapshot(),
        run: {
            ...timeLimitSnapshot().run,
            pauseReason: "execution_interrupted",
        },
        researchResumeAvailable: false,
        sourcesSettlementAvailable: true,
        sourcesPhase: "interrupted",
    });
    convexReactHarness.paginatedQuery(api.workbench.history).returns({
        ...timeLimitNotice(),
        results: timeLimitNotice().results.map((notice) => ({
            ...notice,
            text: "Source preparation was interrupted. Use what's prepared to finish with limits.",
        })),
    });
    convexReactHarness.query(api.execution.approvals.get).returns(view);
    render(<ConnectedStartWorkspace runId={runId} />);
    expect(
        screen.queryByRole("button", { name: "Resume research" }),
    ).toBeNull();
    const progress = screen.getByRole("region", {
        name: "Documentary progress",
    });
    fireEvent.click(
        within(progress).getByRole("button", { name: "Use what's prepared" }),
    );
    const card = screen.getByRole("group", { name: "Use what's prepared" });
    expect(
        within(card).getByRole("button", { name: "Allow once" }),
    ).toBeTruthy();
    await waitFor(() =>
        expect(usePrepared).toHaveBeenCalledWith({
            runId,
            expectedGeneration: 5,
        }),
    );
    expect(resumeResearch).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toMatch(
        /configuration_unavailable|context_capacity|human_prerequisite_required/,
    );
});

test("Use what's prepared remains actionable when an older technical pause has no decision card", async () => {
    const usePrepared = vi.fn().mockResolvedValue(undefined);
    convexReactHarness
        .mutation(api.execution.approvals.usePreparedSources)
        .uses(usePrepared);
    convexReactHarness.query(api.workbench.snapshot).returns({
        ...timeLimitSnapshot(null),
        run: {
            ...timeLimitSnapshot(null).run,
            pauseReason: "execution_interrupted",
        },
        sourcesPhase: "interrupted",
        sourcesSettlementAvailable: true,
        researchResumeAvailable: false,
    });
    render(<ConnectedStartWorkspace runId={runId} />);
    expect(
        screen.queryByRole("button", { name: "Resume research" }),
    ).toBeNull();
    fireEvent.click(
        screen.getByRole("button", { name: "Use what's prepared" }),
    );
    await waitFor(() =>
        expect(usePrepared).toHaveBeenCalledWith({
            runId,
            expectedGeneration: 5,
        }),
    );
});

test("after Sources hands off, the stage panel shows its result instead of collection lanes", async () => {
    convexReactHarness.query(api.workbench.snapshot).returns({
        ...readySnapshot,
        run: {
            ...readySnapshot.run,
            fixedFramingRevisionId: "framing-1",
            lifecycleState: "sources_prepared",
            executionStatus: "idle",
        },
        preparation: { status: "partial" },
        sourcesPhase: "completed_with_limits",
        sources: [
            {
                id: "source-a",
                title: "Annual filing",
                state: "captured",
                url: "https://example.test/filing",
            },
        ],
    });
    render(
        <ConnectedStartWorkspace
            runId={runId}
            sourcesResult={<p>Documentary needs result</p>}
        />,
    );
    const stage = screen.getByRole("region", { name: "Documentary progress" });
    expect(within(stage).getByText("Documentary needs result")).toBeTruthy();
    expect(within(stage).queryByText("No documents at this stage.")).toBeNull();
    expect(within(stage).queryByText("Captured")).toBeNull();
    // The result states the outcome once: one state pill, no collection counts or generic phase sentence.
    expect(within(stage).queryByText("found")).toBeNull();
    expect(within(stage).getAllByText("Complete with limits")).toHaveLength(1);
    expect(
        within(stage).queryByText(/Investigation is not available yet/),
    ).toBeNull();
    expect(
        within(stage).getByRole("link", { name: /Open sources/ }),
    ).toBeTruthy();
    // The framing opens in a dialog over the stage, which stays where it was.
    fireEvent.click(
        within(stage).getByRole("button", { name: "Read framing" }),
    );
    const framing = await screen.findByRole("dialog", {
        name: "Research framing",
    });
    expect(within(framing).getByText("Q1")).toBeTruthy();
    expect(screen.getByText("Documentary needs result")).toBeTruthy();
});

test("while Sources collects, the stage panel keeps its lanes even when a result is available", () => {
    convexReactHarness.query(api.workbench.snapshot).returns({
        ...readySnapshot,
        run: {
            ...readySnapshot.run,
            fixedFramingRevisionId: "framing-1",
            lifecycleState: "discovering_sources",
            executionStatus: "running",
        },
        sources: [
            {
                id: "source-a",
                title: "Annual filing",
                state: "captured",
                url: "https://example.test/filing",
            },
        ],
    });
    render(
        <ConnectedStartWorkspace
            runId={runId}
            sourcesResult={<p>Documentary needs result</p>}
        />,
    );
    const stage = screen.getByRole("region", { name: "Documentary progress" });
    expect(within(stage).queryByText("Documentary needs result")).toBeNull();
    expect(within(stage).getByText("Annual filing")).toBeTruthy();
});

const launchedSnapshot = {
    ...readySnapshot,
    run: {
        ...readySnapshot.run,
        fixedFramingRevisionId: "framing-1",
        lifecycleState: "discovering_sources",
        executionStatus: "running",
    },
};
const recordedEvents = [
    {
        _id: "event-1",
        _creationTime: 1,
        runId,
        type: "run_created",
        lifecycleState: "framing",
    },
    {
        _id: "event-2",
        _creationTime: 2,
        runId,
        type: "company_confirmed",
        lifecycleState: "framing",
    },
];

test("History in the stage panel lists recorded steps only when opened", () => {
    convexReactHarness.query(api.workbench.snapshot).returns(launchedSnapshot);
    convexReactHarness
        .query(api.researchRuns.listMyEvents)
        .returns(recordedEvents);
    render(<ConnectedStartWorkspace runId={runId} />);
    const history = screen.getByRole("button", { name: /History/ });
    expect(history.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Company confirmed")).toBeNull();
    fireEvent.click(history);
    expect(screen.getByText("Company confirmed")).toBeTruthy();
    expect(screen.getByText("Research dossier created")).toBeTruthy();
});

test("an old timeline link opens Progress with History expanded instead of a separate page", () => {
    convexReactHarness.query(api.workbench.snapshot).returns(launchedSnapshot);
    convexReactHarness
        .query(api.researchRuns.listMyEvents)
        .returns(recordedEvents);
    render(<ConnectedStartWorkspace runId={runId} detail="timeline" />);
    expect(
        screen
            .getByRole("button", { name: /History/ })
            .getAttribute("aria-expanded"),
    ).toBe("true");
    expect(screen.getByText("Company confirmed")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Dossier stage" })).toBeTruthy();
    expect(
        screen.queryByRole("button", { name: /Back to research/ }),
    ).toBeNull();
});
