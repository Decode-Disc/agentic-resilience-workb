import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it } from "vitest";
import {
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
    expect(
        result.current.state.messages.map((message) => message.text),
    ).toEqual([
        "Does CCC control the photo-led claim workflow, or supply modules an agent could replace?",
        "I can help frame this research before it starts.",
        "Inspect carrier control.",
    ]);
    expect(result.current.state.messages.at(-1)).toEqual(legacy.messages[0]);
    expect(result.current.state.draft).toBe("Keep this draft");
    await waitFor(() => expect(sessionStorage.getItem(legacyKey)).toBeNull());
    expect(
        JSON.parse(sessionStorage.getItem(previewKey) ?? "null").version,
    ).toBe(4);
    const retained = result.current.state.messages;
    unmount();
    const reloaded = renderHook(() => useStartConversationPreview("framing"));
    expect(reloaded.result.current.state.messages).toEqual(retained);
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
        result.current.state.messages.every(
            (message) => message.createdAt === undefined,
        ),
    ).toBe(true);
});

it("starts preparation once and derives its completed work from the retained turn", () => {
    const { result } = renderHook(() => useStartConversationPreview("framing"));
    act(() => result.current.startResearch());
    const started = result.current.state;
    act(() => result.current.startResearch());
    expect(result.current.state.messages).toEqual(started.messages);
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
        finished.messages.filter((message) =>
            message.text.startsWith(
                "The illustrative candidate list is ready.",
            ),
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
    const messages = result.current.state.messages;
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
    expect(reloaded.result.current.state.messages).toEqual(messages);
});

it("keeps interrupted turns when illustrative work is restarted", () => {
    const { result } = renderHook(() =>
        useStartConversationPreview("launched"),
    );
    act(() => result.current.interruptPreparation());
    const interruptedId = sourcePreparation(result.current.state).turn?.id;
    act(() => result.current.restartPreparation());
    expect(
        result.current.state.turns?.find((turn) => turn.id === interruptedId)
            ?.state,
    ).toBe("interrupted");
    expect(sourcePreparation(result.current.state).turn?.id).not.toBe(
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
