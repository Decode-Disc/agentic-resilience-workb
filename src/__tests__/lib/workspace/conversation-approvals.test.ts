import { expect, test } from "vitest";
import { conversationMessageContent } from "@/lib/workspace/conversation-approvals";

test("approval parts are settled tool calls with a per-message identity", () => {
    const first = conversationMessageContent("message:1", "Notice", ["req-1"]);
    const second = conversationMessageContent("message:2", "Again", ["req-1"]);
    const calls = [...first, ...second].filter(
        (part) => typeof part !== "string" && part.type === "tool-call",
    );
    expect(calls).toHaveLength(2);
    for (const call of calls) {
        // assistant-ui reports a message with an unanswered tool call as requiring action.
        expect(call).toMatchObject({
            toolName: "approval",
            args: { requestId: "req-1" },
        });
        expect("result" in call && call.result).toBeTruthy();
    }
    expect(
        new Set(calls.map((call) => "toolCallId" in call && call.toolCallId))
            .size,
    ).toBe(2);
});
