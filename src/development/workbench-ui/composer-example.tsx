import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { useEffect, useRef, useState } from "react";
import {
    ConversationComposer,
    useWorkbenchConversation,
} from "@/components/chat/workbench-conversation";
import {
    FramingProposal,
    type StartFramingQuestion,
} from "@/components/workspace/start/start-screens";
import StartStyles from "@/components/workspace/start/start-screens.module.css";
import { usePreviewModelSelector } from "./preview-model-selector";

/** Exercises the real composer primitives with explicit, local-only catalogue and command fixtures. */
export function ComposerExample() {
    const program = new URLSearchParams(location.search).get("program");
    const [questions, setQuestions] = useState<StartFramingQuestion[]>(
        program === "ready"
            ? [
                  {
                      id: "coordination",
                      label: "Q1",
                      shortLabel: "Coordination",
                      text: "Does CCC control coordination, or supply replaceable modules?",
                      rationale:
                          "Distinguish running the workflow from deciding its rules.",
                  },
              ]
            : [],
    );
    const [editing, setEditing] = useState<{ id?: string } | null>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const actionTrigger = useRef<HTMLElement | null>(null);
    useEffect(() => {
        if (editing) inputRef.current?.focus();
        else actionTrigger.current?.focus();
    }, [editing]);
    const [draft, setDraft] = useState("");
    const modelControls = usePreviewModelSelector();
    const [receipt, setReceipt] = useState("");
    const conversation = useWorkbenchConversation({
        messages: [],
        draft,
        onDraftChange: setDraft,
        onSend: async (text) => {
            if (editing) {
                setQuestions((current) =>
                    editing.id
                        ? current.map((question) =>
                              question.id === editing.id
                                  ? { ...question, text }
                                  : question,
                          )
                        : [
                              ...current,
                              {
                                  id: crypto.randomUUID(),
                                  label: `Q${current.length + 1}`,
                                  shortLabel: "Custom question",
                                  text,
                                  rationale:
                                      "Added by the analyst for this illustrative program.",
                              },
                          ],
                );
                setEditing(null);
            } else setReceipt(text);
        },
    });
    const composer = (
        <ConversationComposer
            inputRef={inputRef}
            label={
                editing
                    ? editing.id
                        ? "Edit research question"
                        : "Add research question"
                    : "Message"
            }
            placeholder={
                editing && !editing.id
                    ? "What would you like to investigate?"
                    : undefined
            }
            actionLabel={
                editing
                    ? editing.id
                        ? "Save changes"
                        : "Add question"
                    : undefined
            }
            onCancel={
                editing
                    ? () => {
                          setEditing(null);
                          setDraft("");
                      }
                    : undefined
            }
            availableCommands={["/pause", "/model"]}
            onCommand={async () => {
                throw new Error("Illustrative refusal");
            }}
            {...modelControls}
        />
    );
    return (
        <section className="mx-auto flex w-full max-w-2xl flex-col gap-6 py-8">
            <h1 className="text-xl font-medium">Shared composer</h1>
            <p className="text-sm text-muted-foreground">
                Illustrative controls. No research or provider calls. The pause
                command deliberately fails to demonstrate draft recovery.
            </p>
            <AssistantRuntimeProvider runtime={conversation.runtime}>
                <div
                    data-slot="conversation-thread-dock"
                    className="relative mt-48">
                    {program ? (
                        <div className={StartStyles.pendingAction}>
                            <FramingProposal
                                collapsible
                                questions={questions}
                                composer={composer}
                                actionActive={editing !== null}
                                onAddRequest={() => {
                                    actionTrigger.current =
                                        document.activeElement as HTMLElement;
                                    setDraft("");
                                    setEditing({});
                                }}
                                onEditRequest={(question) => {
                                    actionTrigger.current =
                                        document.activeElement as HTMLElement;
                                    setDraft(question.text);
                                    setEditing({ id: question.id });
                                }}
                                onStart={() =>
                                    setReceipt(
                                        "Illustrative launch only; no research is executed.",
                                    )
                                }
                            />
                        </div>
                    ) : (
                        composer
                    )}
                </div>
            </AssistantRuntimeProvider>
            <output aria-live="polite">{receipt}</output>
        </section>
    );
}
