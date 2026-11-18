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
    // Adding a question uses the composer; an existing question is edited in its row.
    const [adding, setAdding] = useState(false);
    const [inlineEdit, setInlineEdit] = useState<{
        id: string;
        text: string;
    } | null>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const actionTrigger = useRef<HTMLElement | null>(null);
    useEffect(() => {
        if (adding) inputRef.current?.focus();
        else actionTrigger.current?.focus();
    }, [adding]);
    const [draft, setDraft] = useState("");
    const modelControls = usePreviewModelSelector();
    const [receipt, setReceipt] = useState("");
    const conversation = useWorkbenchConversation({
        messages: [],
        draft,
        onDraftChange: setDraft,
        onSend: async (text) => {
            if (adding) {
                setQuestions((current) => [
                    ...current,
                    {
                        id: crypto.randomUUID(),
                        label: `Q${current.length + 1}`,
                        shortLabel: "Custom question",
                        text,
                        rationale:
                            "Added by the analyst for this illustrative program.",
                    },
                ]);
                setAdding(false);
            } else setReceipt(text);
        },
    });
    const composer = (
        <ConversationComposer
            inputRef={inputRef}
            label={adding ? "Add research question" : "Message"}
            placeholder={
                adding ? "What would you like to investigate?" : undefined
            }
            actionLabel={adding ? "Add question" : undefined}
            onCancel={
                adding
                    ? () => {
                          setAdding(false);
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
                                actionActive={adding}
                                editing={
                                    inlineEdit
                                        ? {
                                              questionId: inlineEdit.id,
                                              text: inlineEdit.text,
                                          }
                                        : undefined
                                }
                                onEditChange={(text) =>
                                    inlineEdit &&
                                    setInlineEdit({ ...inlineEdit, text })
                                }
                                onEditCancel={() => setInlineEdit(null)}
                                onEditSave={() => {
                                    if (!inlineEdit) return;
                                    setQuestions((current) =>
                                        current.map((question) =>
                                            question.id === inlineEdit.id
                                                ? {
                                                      ...question,
                                                      text: inlineEdit.text.trim(),
                                                  }
                                                : question,
                                        ),
                                    );
                                    setInlineEdit(null);
                                }}
                                onAddRequest={() => {
                                    actionTrigger.current =
                                        document.activeElement as HTMLElement;
                                    setDraft("");
                                    setAdding(true);
                                }}
                                onEditRequest={(question) =>
                                    setInlineEdit({
                                        id: question.id,
                                        text: question.text,
                                    })
                                }
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
