import { api } from "@convex/_generated/api";
import { useQuery } from "convex/react";
import type { FunctionArgs } from "convex/server";
import { useState } from "react";
import { WorkbenchModelSelector } from "@/components/composer/model-picker";

type Selection = NonNullable<
    FunctionArgs<typeof api.framing.confirmCompany>["modelSelection"]
>;
/** Reads the prepared catalogue while the owning research draft retains the pre-dossier choice. */
export function ResearchModelPicker({
    ready,
    pending,
    choice,
    onSelect,
}: {
    ready: boolean;
    pending: boolean;
    choice?: Selection;
    onSelect: (choice: Selection) => void;
}) {
    const models = useQuery(api.workbench.models, ready ? {} : "skip");
    const [open, setOpen] = useState(false);
    const picked = models?.choices.find(
        (model) => model.id === choice?.catalogId,
    );
    const snapshot =
        models && picked
            ? {
                  ...models,
                  selectedId: picked.id,
                  label: picked.label,
                  available: true,
                  effort: choice?.reasoningEffort ?? picked.effort,
                  effortChoices: picked.effortChoices,
              }
            : models && choice
              ? {
                    ...models,
                    selectedId: choice.catalogId,
                    label: "Selected model unavailable",
                    available: false,
                    effort: choice.reasoningEffort ?? null,
                    effortChoices: [],
                }
              : models;
    return (
        <WorkbenchModelSelector
            snapshot={snapshot}
            open={open}
            onOpenChange={setOpen}
            pending={pending}
            onSelect={(catalogId, reasoningEffort) =>
                onSelect({
                    catalogId,
                    ...(reasoningEffort ? { reasoningEffort } : {}),
                })
            }
        />
    );
}
