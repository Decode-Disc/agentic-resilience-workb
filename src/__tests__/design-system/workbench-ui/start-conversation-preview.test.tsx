import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import {
    preparationQuestionExample,
    previewKey,
    sourcePreparation,
    useStartConversationPreview,
} from "@/development/workbench-ui/start-conversation-preview";

const legacyKey = "start-conversation-preview-v3";
const savedAt = "2026-10-31T10:00:00.000Z";
const legacy = {
    scenario: "specific",
    startedAt: savedAt,
    needsContext: false,
    scope: "Claims coordination",
    questions: [
        { id: "coordination", label: "Coordination", text: "Who decides?" },
    ],
    draft: "Keep this draft",
    messages: [
        {
            id: "retained-user",
            from: "user",
            text: "Inspect carrier control.",
            createdAt: savedAt,
        },
    ],
    launched: false,
    framingMessageCount: 1,
};

beforeEach(() => sessionStorage.clear());

it("keeps research stopped while a clarification or question edit is pending", () => {
    const { result } = renderHook(() => useStartConversationPreview("framing"));
    act(() => result.current.update({ needsContext: true }));
    act(() => result.current.startResearch());
    expect(result.current.state.launched).toBe(false);
    act(() =>
        result.current.update({
            needsContext: false,
            questionAction: { text: "Review this question" },
        }),
    );
    act(() => result.current.startResearch());
    expect(result.current.state.launched).toBe(false);
});

it("migrates the old transcript once while retaining messages, dates and the draft", async () => {
    sessionStorage.setItem(legacyKey, JSON.stringify(legacy));
    const { result, unmount } = renderHook(() =>
        useStartConversationPreview("framing"),
    );
    expect(result.current.messages.map((message) => message.text)).toEqual([
        "Does CCC control the photo-led claim workflow, or supply modules an agent could replace?",
        "I can help frame this research before it starts.",
        "Inspect carrier control.",
    ]);
    expect(result.current.messages.at(-1)).toEqual(legacy.messages[0]);
    expect(result.current.state.draft).toBe("Keep this draft");
    await waitFor(() => expect(sessionStorage.getItem(legacyKey)).toBeNull());
    expect(
        JSON.parse(sessionStorage.getItem(previewKey) ?? "null").version,
    ).toBe(5);
    const retained = result.current.messages;
    unmount();
    const reloaded = renderHook(() => useStartConversationPreview("framing"));
    expect(reloaded.result.current.messages).toEqual(retained);
});

it("keeps missing historical dates unknown", () => {
    sessionStorage.setItem(
        legacyKey,
        JSON.stringify({
            ...legacy,
            startedAt: undefined,
            messages: [{ ...legacy.messages[0], createdAt: undefined }],
        }),
    );
    const { result } = renderHook(() => useStartConversationPreview("framing"));
    expect(
        result.current.messages.every(
            (message) => message.createdAt === undefined,
        ),
    ).toBe(true);
});

it("starts preparation once and derives its completed work from the retained mission", () => {
    const { result } = renderHook(() => useStartConversationPreview("framing"));
    act(() => result.current.startResearch());
    const started = result.current.state;
    act(() => result.current.startResearch());
    expect(result.current.state.history).toEqual(started.history);
    expect(result.current.state.turns).toEqual(started.turns);
    expect(
        sourcePreparation(result.current.state).activities.map(
            (activity) => activity.state,
        ),
    ).toEqual(["completed", "running"]);
    act(() => result.current.advancePreparation());
    const advanced = result.current.state;
    act(() => result.current.advancePreparation());
    expect(result.current.state).toEqual(advanced);
    expect(
        sourcePreparation(result.current.state).activities.map(
            (activity) => activity.state,
        ),
    ).toEqual(["completed", "completed", "running"]);
    act(() => result.current.finishPreparation());
    const finished = result.current.state;
    act(() => result.current.finishPreparation());
    expect(result.current.state).toEqual(finished);
    expect(sourcePreparation(finished).state).toBe("completed");
    expect(
        sourcePreparation(finished).activities.every(
            (activity) => activity.state === "completed",
        ),
    ).toBe(true);
    expect(
        finished.history
            .flatMap((entry) =>
                entry.kind === "message" ? [entry.message] : [],
            )
            .filter((message) =>
                message.text.startsWith("## Material ready for examination"),
            ),
    ).toHaveLength(1);
});

it("restores unfinished work as interrupted without losing later follow-up", async () => {
    const { result, unmount } = renderHook(() =>
        useStartConversationPreview("launched"),
    );
    await act(async () => {
        await result.current.conversation.submit(
            "Keep the evidence gap explicit.",
        );
    });
    const messages = result.current.messages;
    unmount();
    const reloaded = renderHook(() => useStartConversationPreview("launched"));
    expect(sourcePreparation(reloaded.result.current.state).state).toBe(
        "interrupted",
    );
    expect(
        sourcePreparation(reloaded.result.current.state).activities.some(
            (activity) => activity.state === "running",
        ),
    ).toBe(false);
    expect(reloaded.result.current.messages).toEqual(messages);
});

it("keeps interrupted missions when illustrative work is restarted", () => {
    const { result } = renderHook(() =>
        useStartConversationPreview("launched"),
    );
    act(() => result.current.interruptPreparation());
    const interruptedId = sourcePreparation(result.current.state).mission?.id;
    act(() => result.current.restartPreparation());
    expect(
        result.current.state.missions.find(
            (mission) => mission.id === interruptedId,
        )?.state,
    ).toBe("interrupted");
    expect(sourcePreparation(result.current.state).mission?.id).not.toBe(
        interruptedId,
    );
    expect(sourcePreparation(result.current.state).state).toBe("running");
});

it("stops a conversational response without pausing source preparation", () => {
    const { result } = renderHook(() =>
        useStartConversationPreview("launched"),
    );
    act(() => result.current.workThenReply());
    const responseId = result.current.activeTurn?.id;
    expect(responseId).toBeTruthy();
    act(() => result.current.stopResponse());
    expect(
        result.current.state.turns?.find((turn) => turn.id === responseId)
            ?.state,
    ).toBe("interrupted");
    expect(sourcePreparation(result.current.state).state).toBe("running");
});

it("preserves an invalid current save until the analyst explicitly resets it", () => {
    sessionStorage.setItem(previewKey, "invalid-json");
    sessionStorage.setItem(legacyKey, JSON.stringify(legacy));
    const { result } = renderHook(() => useStartConversationPreview("framing"));
    act(() => result.current.update({ draft: "A temporary draft" }));
    expect(sessionStorage.getItem(previewKey)).toBe("invalid-json");
    expect(sessionStorage.getItem(legacyKey)).not.toBeNull();
    act(() => result.current.selectScenario("specific"));
    expect(JSON.parse(sessionStorage.getItem(previewKey) ?? "null").draft).toBe(
        "",
    );
    expect(sessionStorage.getItem(legacyKey)).toBeNull();
});

it("preserves malformed legacy context rather than admitting a record that cannot render", () => {
    const saved = JSON.stringify({
        ...legacy,
        suppliedContext: {
            question: { invalid: true },
            answer: "Claims coordination",
        },
    });
    sessionStorage.setItem(legacyKey, saved);
    renderHook(() => useStartConversationPreview("framing"));
    expect(sessionStorage.getItem(legacyKey)).toBe(saved);
    expect(sessionStorage.getItem(previewKey)).toBeNull();
});

it("owns documentary operations as a Sources mission rather than a Workbench response turn", () => {
    const { result } = renderHook(() =>
        useStartConversationPreview("launched"),
    );
    expect(
        result.current.state.turns?.some((turn) =>
            turn.entries.some((entry) => entry.kind === "operation"),
        ),
    ).not.toBe(true);
    expect(
        result.current.conversation.runtime.thread.getState().isRunning,
    ).toBe(false);
});

it("queues the mission report behind the ongoing reply, then emits it exactly once", async () => {
    const { result } = renderHook(() =>
        useStartConversationPreview("launched"),
    );
    act(() => result.current.setExample(preparationQuestionExample.id));
    await act(async () => {
        await result.current.conversation.submit(
            preparationQuestionExample.text,
        );
    });
    expect(
        result.current.conversation.runtime.thread.getState().isRunning,
    ).toBe(true);
    act(() => result.current.finishPreparation());
    expect(sourcePreparation(result.current.state).state).toBe("completed");
    expect(result.current.state.pendingReports).toHaveLength(1);
    expect(
        result.current.messages.some((message) =>
            message.text.startsWith("## Material ready"),
        ),
    ).toBe(false);
    act(() => result.current.finishIllustrativeTurn());
    expect(result.current.state.pendingReports).toHaveLength(0);
    const texts = result.current.messages.map((message) => message.text);
    expect(texts.at(-3)).toBe(preparationQuestionExample.text);
    expect(texts.at(-2)).toContain("No conclusion is established yet.");
    expect(texts.at(-1)).toContain("Material ready for examination");
    act(() => result.current.finishPreparation());
    expect(
        result.current.messages.filter((message) =>
            message.text.startsWith("## Material ready"),
        ),
    ).toHaveLength(1);
    const saved = JSON.parse(sessionStorage.getItem(previewKey) ?? "null");
    expect(saved.messages).toBeUndefined();
    expect(
        saved.history.filter(
            (entry: { kind: string }) => entry.kind === "mission",
        ),
    ).toHaveLength(1);
});

it("keeps a stopped mission distinct from a response and flushes its report after Stop response", () => {
    const { result } = renderHook(() =>
        useStartConversationPreview("launched"),
    );
    act(() => result.current.growReply());
    act(() => result.current.interruptPreparation());
    expect(result.current.activeTurn?.state).toBe("running");
    expect(sourcePreparation(result.current.state).state).toBe("interrupted");
    expect(result.current.state.pendingReports).toHaveLength(1);
    act(() => result.current.stopResponse());
    expect(result.current.activeTurn).toBeUndefined();
    expect(result.current.messages.at(-1)?.text).toContain("Sources stopped");
    expect(result.current.state.pendingReports).toHaveLength(0);
});

it("migrates version four operations into one mission without moving historical exchanges", () => {
    const messages = [
        ...legacy.messages,
        {
            id: "launch",
            from: "assistant",
            text: "Research started.",
            createdAt: savedAt,
        },
        {
            id: "followup",
            from: "user",
            text: "What is missing?",
            createdAt: savedAt,
        },
        {
            id: "report",
            from: "assistant",
            text: "Recorded legacy result.",
            createdAt: savedAt,
        },
    ];
    sessionStorage.setItem(
        "start-conversation-preview-v4",
        JSON.stringify({
            ...legacy,
            version: 4,
            launched: true,
            messages,
            sourcePreparationTurnId: "old-mission",
            turns: [
                {
                    id: "old-mission",
                    state: "completed",
                    startedAt: savedAt,
                    finishedAt: savedAt,
                    entries: [
                        { kind: "message", id: "launch", phase: "commentary" },
                        {
                            kind: "operation",
                            operation: {
                                id: "old-op",
                                title: "Find reporting",
                                state: "completed",
                                summary: "Candidates recorded",
                            },
                        },
                        { kind: "message", id: "report", phase: "answer" },
                    ],
                },
            ],
        }),
    );
    const { result } = renderHook(() =>
        useStartConversationPreview("launched"),
    );
    expect(
        result.current.messages.slice(-4).map((message) => message.id),
    ).toEqual(messages.map((message) => message.id));
    expect(
        result.current.state.history
            .slice(-4)
            .map((entry) =>
                entry.kind === "mission" ? entry.id : entry.message.id,
            ),
    ).toEqual(["launch", "old-mission", "followup", "report"]);
    expect(
        sourcePreparation(result.current.state).mission?.operations[0]?.id,
    ).toBe("old-op");
    expect(
        result.current.state.turns.every((turn) =>
            turn.entries.every((entry) => entry.kind === "message"),
        ),
    ).toBe(true);
    expect(sessionStorage.getItem("start-conversation-preview-v4")).toBeNull();
});

it("retains the legacy record when writing its replacement is refused", () => {
    const saved = JSON.stringify(legacy);
    sessionStorage.setItem(legacyKey, saved);
    const write = vi
        .spyOn(Storage.prototype, "setItem")
        .mockImplementation(() => {
            throw new Error("storage unavailable");
        });
    const onStatus = vi.fn();
    try {
        renderHook(() => useStartConversationPreview("framing", onStatus));
        expect(sessionStorage.getItem(legacyKey)).toBe(saved);
        expect(sessionStorage.getItem(previewKey)).toBeNull();
        expect(onStatus).toHaveBeenCalledWith(
            "Preview continuity is unavailable in this browser. Your current conversation remains open.",
        );
    } finally {
        write.mockRestore();
    }
});

it("recovers an old launch without inventing a launch date or successful work", () => {
    sessionStorage.setItem(
        legacyKey,
        JSON.stringify({ ...legacy, startedAt: undefined, launched: true }),
    );
    const { result } = renderHook(() =>
        useStartConversationPreview("launched"),
    );
    const mission = sourcePreparation(result.current.state).mission;
    expect(mission?.state).toBe("interrupted");
    expect(mission?.startedAt).toBeUndefined();
    expect(
        result.current.messages.some((message) =>
            message.text.includes("Material ready"),
        ),
    ).toBe(false);
});

it("rejects a broken mission reference without overwriting the saved history", () => {
    const first = renderHook(() => useStartConversationPreview("launched"));
    const saved = {
        ...first.result.current.state,
        sourcePreparationMissionId: "missing",
    };
    first.unmount();
    const broken = JSON.stringify(saved);
    sessionStorage.setItem(previewKey, broken);
    const onStatus = vi.fn();
    renderHook(() => useStartConversationPreview("launched", onStatus));
    expect(sessionStorage.getItem(previewKey)).toBe(broken);
    expect(onStatus).toHaveBeenCalledWith(
        expect.stringContaining("Saved preview could not be restored"),
    );
});

it("restores a queued result once after interrupting the unfinished response", () => {
    const first = renderHook(() => useStartConversationPreview("launched"));
    act(() => first.result.current.growReply());
    act(() => first.result.current.finishPreparation());
    expect(first.result.current.state.pendingReports).toHaveLength(1);
    first.unmount();
    const second = renderHook(() => useStartConversationPreview("launched"));
    expect(sourcePreparation(second.result.current.state).state).toBe(
        "completed",
    );
    expect(second.result.current.activeTurn).toBeUndefined();
    expect(second.result.current.messages.at(-2)?.status).toBe("interrupted");
    expect(second.result.current.messages.at(-1)?.text).toContain(
        "Material ready for examination",
    );
    expect(second.result.current.state.pendingReports).toHaveLength(0);
    const restored = second.result.current.messages;
    second.unmount();
    const third = renderHook(() => useStartConversationPreview("launched"));
    expect(third.result.current.messages).toEqual(restored);
});

it("does not claim preparation is ongoing when a staged example is submitted after completion", async () => {
    const onStatus = vi.fn();
    const { result } = renderHook(() =>
        useStartConversationPreview("launched", onStatus),
    );
    act(() => result.current.setExample(preparationQuestionExample.id));
    act(() => result.current.finishPreparation());
    await act(async () => {
        await result.current.conversation.submit(
            preparationQuestionExample.text,
        );
    });
    expect(result.current.activeTurn).toBeUndefined();
    expect(result.current.messages.at(-1)?.from).toBe("user");
    expect(onStatus).toHaveBeenCalledWith(
        "Request recorded in this preview; freeform interpretation is not connected.",
    );
});

it("queues a message during a response and processes it in a following turn without stopping Sources", async () => {
    const { result } = renderHook(() =>
        useStartConversationPreview("launched"),
    );
    act(() => result.current.growReply());
    const activeId = result.current.activeTurn?.id;
    await act(async () => {
        await result.current.conversation.submit(
            "Keep the gap visible.",
            "queue",
        );
    });
    expect(
        result.current.messages.find((m) => m.text === "Keep the gap visible.")
            ?.delivery,
    ).toBe("queued");
    expect(result.current.activeTurn?.id).toBe(activeId);
    act(() => result.current.finishIllustrativeTurn());
    await waitFor(() =>
        expect(result.current.activeTurn?.id).not.toBe(activeId),
    );
    expect(
        result.current.messages.find((m) => m.text === "Keep the gap visible.")
            ?.delivery,
    ).toBe("processed");
    expect(sourcePreparation(result.current.state).state).toBe("running");
});

it("steers the active response without replacing its turn or cancelling Sources", async () => {
    const { result } = renderHook(() =>
        useStartConversationPreview("launched"),
    );
    act(() => result.current.growReply());
    const activeId = result.current.activeTurn?.id;
    await act(async () => {
        await result.current.conversation.submit(
            "Separate control from execution.",
            "steer",
        );
    });
    expect(
        result.current.messages.find(
            (m) => m.text === "Separate control from execution.",
        )?.delivery,
    ).toBe("steered");
    expect(result.current.activeTurn?.id).toBe(activeId);
    act(() => result.current.finishIllustrativeTurn());
    expect(
        result.current.messages.some((m) =>
            m.text.includes("Steering instruction received"),
        ),
    ).toBe(true);
    expect(sourcePreparation(result.current.state).state).toBe("running");
});

it("holds queued instructions on Stop and preserves both the queue and draft through resume", async () => {
    const { result } = renderHook(() =>
        useStartConversationPreview("launched"),
    );
    act(() => result.current.growReply());
    await act(async () => {
        await result.current.conversation.submit(
            "First queued instruction",
            "queue",
        );
    });
    act(() => result.current.setRefinement("My unsent draft"));
    act(() => result.current.stopResponse());
    expect(result.current.activeTurn).toBeUndefined();
    expect(
        result.current.messages.find(
            (m) => m.text === "First queued instruction",
        )?.delivery,
    ).toBe("queued");
    expect(result.current.state.draft).toBe("My unsent draft");
    act(() => result.current.resumeQueue?.());
    await waitFor(() => expect(result.current.activeTurn).toBeTruthy());
    expect(result.current.state.draft).toBe("My unsent draft");
});

it("retains the queued order across reload and requires explicit resume", async () => {
    const first = renderHook(() => useStartConversationPreview("launched"));
    act(() => first.result.current.growReply());
    await act(async () => {
        await first.result.current.conversation.submit("First instruction");
    });
    await act(async () => {
        await first.result.current.conversation.submit("Second instruction");
    });
    const ids = first.result.current.messages
        .filter((m) => m.delivery === "queued")
        .map((m) => m.id);
    first.unmount();
    const second = renderHook(() => useStartConversationPreview("launched"));
    expect(second.result.current.activeTurn).toBeUndefined();
    expect(
        second.result.current.messages
            .filter((m) => m.delivery === "queued")
            .map((m) => m.id),
    ).toEqual(ids);
    act(() => second.result.current.resumeQueue?.());
    await waitFor(() => expect(second.result.current.activeTurn).toBeTruthy());
    expect(
        second.result.current.messages.find((m) => m.id === ids[0])?.delivery,
    ).toBe("processed");
    expect(
        second.result.current.messages.find((m) => m.id === ids[1])?.delivery,
    ).toBe("queued");
    act(() => second.result.current.finishIllustrativeTurn());
    await waitFor(() =>
        expect(
            second.result.current.messages.find((m) => m.id === ids[1])
                ?.delivery,
        ).toBe("processed"),
    );
});

it("saves a question edit directly while a conversational response continues", async () => {
    const { result } = renderHook(() => useStartConversationPreview("framing"));
    act(() => result.current.growReply());
    const id = result.current.activeTurn?.id;
    act(() =>
        result.current.setQuestionAction({
            id: "q1",
            text: "Who sets the rules?",
        }),
    );
    await act(async () => {
        await result.current.conversation.submit("Who sets the rules?");
    });
    expect(result.current.state.questions[0]?.text).toBe("Who sets the rules?");
    expect(result.current.activeTurn?.id).toBe(id);
    expect(result.current.messages.some((m) => m.delivery === "queued")).toBe(
        false,
    );
});

it("places the steering message before its continuation and retains the earlier partial reply", async () => {
    const { result } = renderHook(() =>
        useStartConversationPreview("launched"),
    );
    act(() => result.current.growReply());
    const partial = result.current.messages.at(-1);
    await act(async () => {
        await result.current.conversation.submit(
            "Separate decision rights",
            "steer",
        );
    });
    act(() => result.current.finishIllustrativeTurn());
    const messages = result.current.messages;
    expect(messages.find((m) => m.id === partial?.id)?.text).toBe(
        partial?.text,
    );
    expect(
        messages.findIndex((m) => m.text === "Separate decision rights"),
    ).toBeLessThan(
        messages.findIndex((m) =>
            m.text.includes("Steering instruction received"),
        ),
    );
});
