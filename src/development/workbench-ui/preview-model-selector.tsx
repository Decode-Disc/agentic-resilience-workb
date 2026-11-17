import type { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";
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

/** Local-only catalogue state shared by current composer examples; never invokes a provider. */
export function usePreviewModelSelector() {
    const [snapshot, setSnapshot] = useState(models);
    const [open, setOpen] = useState(false);
    return {
        onOpenModels: () => setOpen(true),
        controlsOpen: open,
        modelSelector: (
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
        ),
    };
}
