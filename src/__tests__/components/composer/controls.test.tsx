import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { expect, test, vi } from "vitest";
import {
    ConversationComposer,
    useWorkbenchConversation,
} from "@/components/chat/workbench-conversation";

function Harness({ onOpenModels = vi.fn() }: { onOpenModels?: () => void }) {
    const [draft, setDraft] = useState("");
    const conversation = useWorkbenchConversation({
        messages: [],
        draft,
        onDraftChange: setDraft,
        onSend: vi.fn(),
    });
    return (
        <AssistantRuntimeProvider runtime={conversation.runtime}>
            <ConversationComposer
                label="Message"
                onCommand={vi.fn()}
                onOpenModels={onOpenModels}
                availableCommands={["/model"]}
            />
        </AssistantRuntimeProvider>
    );
}
test("slash commands only offer actions available in the current context", async () => {
    render(<Harness />);
    const input = screen.getByRole("textbox", { name: "Message" });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "/" } });
    fireEvent.select(input, { target: { selectionStart: 1, selectionEnd: 1 } });
    await waitFor(() =>
        expect(screen.getByRole("option", { name: /^\/model/ })).toBeTruthy(),
    );
    expect(screen.queryByRole("option", { name: /^\/pause/ })).toBeNull();
    expect(screen.queryByRole("option", { name: /^\/resume/ })).toBeNull();
});

test("the Commands tool opens the command list without changing the draft and preserves it through dismissal and execution", async () => {
    const openModels = vi.fn();
    render(<Harness onOpenModels={openModels} />);
    const input = screen.getByRole("textbox", { name: "Message" });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "Keep this unsent draft" } });
    const openCommands = async () => {
        fireEvent.click(screen.getByRole("button", { name: "Composer tools" }));
        fireEvent.click(
            await screen.findByRole("menuitem", {
                name: "Commands",
            }),
        );
        await screen.findByRole("option", { name: /^\/model/ });
    };
    await openCommands();
    expect((input as HTMLTextAreaElement).value).toBe("Keep this unsent draft");
    fireEvent.keyDown(
        screen.getByRole("combobox", { name: "Search commands" }),
        { key: "Escape" },
    );
    await waitFor(() =>
        expect(screen.queryByRole("option", { name: /^\/model/ })).toBeNull(),
    );
    expect((input as HTMLTextAreaElement).value).toBe("Keep this unsent draft");
    await openCommands();
    const search = screen.getByRole("combobox", { name: "Search commands" });
    fireEvent.focus(search);
    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: "Enter" });
    await waitFor(() => expect(openModels).toHaveBeenCalledOnce());
    expect((input as HTMLTextAreaElement).value).toBe("Keep this unsent draft");
    expect(screen.queryByRole("option", { name: /^\/model/ })).toBeNull();
});
