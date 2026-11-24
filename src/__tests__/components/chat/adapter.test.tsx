import { act, renderHook, waitFor } from "@testing-library/react";
import { useState } from "react";
import { expect, it } from "vitest";
import { useWorkbenchConversation } from "@/components/chat/workbench-conversation";
import { conversationMessageContent } from "@/lib/workspace/conversation-approvals";

it("recorded approvals stay settled across repeated notices and allow the next instruction", async () => {
    const messages = [
        { id: "empty", text: "", requests: [] },
        { id: "plain", text: "Prepared material is available", requests: [] },
        {
            id: "message:1",
            text: "Choose how to proceed",
            requests: ["req-1", "req-2"],
        },
        { id: "message:2", text: "", requests: ["req-1"] },
    ].map(({ id, text, requests }) => ({
        id,
        role: "assistant" as const,
        content: conversationMessageContent(id, text, requests),
    }));
    const sent: string[] = [];
    const { result } = renderHook(() => {
        const [draft, setDraft] = useState("Inspect the counter-evidence");
        return useWorkbenchConversation({
            messages,
            draft,
            onDraftChange: setDraft,
            onSend: (text) => {
                sent.push(text);
                setDraft("");
            },
        });
    });
    expect(result.current.runtime.thread.getState().messages).toHaveLength(4);
    for (const message of result.current.runtime.thread.getState().messages) {
        expect(message.status).toMatchObject({ type: "complete" });
    }
    expect(messages.map((message) => message.content)).toEqual([
        [{ type: "text", text: "" }],
        [{ type: "text", text: "Prepared material is available" }],
        [
            { type: "text", text: "Choose how to proceed" },
            {
                type: "tool-call",
                toolCallId: "message:1:approval:req-1",
                toolName: "approval",
                args: { requestId: "req-1" },
                result: { requestId: "req-1" },
            },
            {
                type: "tool-call",
                toolCallId: "message:1:approval:req-2",
                toolName: "approval",
                args: { requestId: "req-2" },
                result: { requestId: "req-2" },
            },
        ],
        [
            {
                type: "tool-call",
                toolCallId: "message:2:approval:req-1",
                toolName: "approval",
                args: { requestId: "req-1" },
                result: { requestId: "req-1" },
            },
        ],
    ]);
    expect(result.current.runtime.thread.composer.getState().canSend).toBe(
        true,
    );
    await act(async () => result.current.runtime.thread.composer.send());
    expect(sent).toEqual(["Inspect the counter-evidence"]);
    expect(result.current.runtime.thread.composer.getState().text).toBe("");
});

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
