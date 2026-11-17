import { act, renderHook, waitFor } from "@testing-library/react";
import { useState } from "react";
import { expect, it } from "vitest";
import { useWorkbenchConversation } from "@/components/chat/workbench-conversation";

it("keeps the controlled draft on failed delivery, accepts further edits, and clears it only after success", async () => {
    let fail = true;
    const sent: string[] = [];
    const { result } = renderHook(() => {
        const [draft, setDraft] = useState("Who controls coordination?");
        return {
            draft,
            ...useWorkbenchConversation({
                messages: [],
                draft,
                onDraftChange: setDraft,
                onSend: (text) => {
                    if (fail) throw new Error("fixture_delivery_failure");
                    sent.push(text);
                    setDraft("");
                },
            }),
        };
    });
    await act(async () => {
        await result.current.runtime.thread.composer.send();
    });
    await waitFor(() => expect(result.current.failed).toBe(true));
    expect(result.current.draft).toBe("Who controls coordination?");
    expect(result.current.runtime.thread.composer.getState().text).toBe(
        "Who controls coordination?",
    );
    expect(sent).toEqual([]);
    act(() =>
        result.current.runtime.thread.composer.setText("", { origin: "user" }),
    );
    expect(result.current.draft).toBe("");
    act(() =>
        result.current.runtime.thread.composer.setText(
            "Who can redirect the work?",
            { origin: "user" },
        ),
    );
    fail = false;
    await act(async () => {
        await result.current.runtime.thread.composer.send();
    });
    await waitFor(() => expect(result.current.failed).toBe(false));
    expect(sent).toEqual(["Who can redirect the work?"]);
    expect(result.current.draft).toBe("");
    expect(result.current.runtime.thread.composer.getState().text).toBe("");
});
