import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
}));
const save = vi.fn(),
    start = vi.fn(),
    pause = vi.fn(),
    resumeResearch = vi.fn();
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
    researchControlAvailable: true,
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
test("Start research commits the visible revision", async () => {
    render(<ConnectedStartWorkspace runId={runId} />);
    fireEvent.click(screen.getByRole("button", { name: "Start research" }));
    await waitFor(() =>
        expect(start).toHaveBeenCalledWith(
            expect.objectContaining({ runId, expectedRevision: 2 }),
        ),
    );
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
        researchControlAvailable: true,
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
