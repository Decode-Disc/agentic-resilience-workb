import { AssistantRuntimeProvider } from "@assistant-ui/react";
import type { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";
import {
    ConversationComposer,
    useWorkbenchConversation,
} from "@/components/chat/workbench-conversation";
import { FramingProposal } from "@/components/workspace/start/start-screens";
import StartStyles from "@/components/workspace/start/start-screens.module.css";
import { WorkbenchModelSelector } from "@/components/composer/model-picker";

const first = "illustrative-first" as Id<"modelCatalog">;
const second = "illustrative-second" as Id<"modelCatalog">;
const models: FunctionReturnType<typeof api.workbench.models> = {
    selectedId: first,
    label: "Illustrative balanced model",
    available: true,
    effort: "low",
    effortChoices: ["low", "high"],
    revision: 0,
    choices: [
        {
            id: first,
            label: "Illustrative balanced model",
            effort: "low",
            effortChoices: ["low", "high"],
        },
        {
            id: second,
            label: "Illustrative fast model",
            effort: null,
            effortChoices: [],
        },
    ],
};

/** Exercises the real composer primitives with explicit, local-only catalogue and command fixtures. */
export function ComposerExample() {
    const program = new URLSearchParams(location.search).get("program");
    const [hasQuestion, setHasQuestion] = useState(program === "ready");
    const [draft, setDraft] = useState("");
    const [snapshot, setSnapshot] = useState(models);
    const [open, setOpen] = useState(false);
    const [receipt, setReceipt] = useState("");
    const conversation = useWorkbenchConversation({
        messages: [],
        draft,
        onDraftChange: setDraft,
        onSend: async (text) => {
            setReceipt(text);
        },
    });
    const composer = (
        <ConversationComposer
            label="Message"
            availableCommands={["/pause", "/model"]}
            onCommand={async () => {
                throw new Error("Illustrative refusal");
            }}
            onOpenModels={() => setOpen(true)}
            controlsOpen={open}
            modelSelector={
                <WorkbenchModelSelector
                    snapshot={snapshot}
                    open={open}
                    onOpenChange={setOpen}
                    pending={false}
                    onSelect={(id, effort) => {
                        const choice = models.choices.find(
                            (model) => model.id === id,
                        );
                        if (choice)
                            setSnapshot({
                                ...models,
                                selectedId: id,
                                label: choice.label,
                                effort: effort ?? choice.effort,
                                effortChoices: choice.effortChoices,
                            });
                    }}
                />
            }
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
                                questions={
                                    hasQuestion
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
                                        : []
                                }
                                composer={composer}
                                onAddRequest={() => setHasQuestion(true)}
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
