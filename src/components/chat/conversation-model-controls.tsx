import type { api } from "@convex/_generated/api";
import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import Icon from "@/components/icon";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuSeparator,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";

type ModelSelection = FunctionArgs<typeof api.workbench.setModel>;
type Effort = NonNullable<ModelSelection["reasoningEffort"]>;
const effortLabels: Record<Effort, string> = {
    none: "Off",
    minimal: "Minimal",
    low: "Low",
    medium: "Medium",
    high: "High",
    xhigh: "Extra",
    max: "Max",
};

/** Adapted from Pasta UI Model Picker (MIT; see pasta-ui.LICENSE.txt), with persisted dossier choices. */
export function WorkbenchModelSelector({
    snapshot,
    open,
    onOpenChange,
    onSelect,
    pending,
}: {
    snapshot: FunctionReturnType<typeof api.workbench.models> | undefined;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSelect: (id: ModelSelection["catalogId"], effort?: Effort) => void;
    pending: boolean;
}) {
    if (!snapshot)
        return (
            <Skeleton className="h-8 w-44" aria-label="Loading model choices" />
        );
    const effortLabel =
        (snapshot.effort ? effortLabels[snapshot.effort] : "Default") +
        (snapshot.effort &&
        snapshot.effortChoices.length &&
        !snapshot.effortChoices.includes(snapshot.effort)
            ? " · unavailable"
            : "");
    return (
        <DropdownMenu open={open} onOpenChange={onOpenChange}>
            <DropdownMenuTrigger
                disabled={pending || !snapshot.choices.length}
                aria-label="Workbench model and effort"
                render={
                    <Button
                        variant="ghost"
                        size="sm"
                        className="composer-model-trigger"
                    />
                }>
                <span className="min-w-0 max-w-48 truncate">
                    {snapshot.label}
                    {snapshot.selectedId && !snapshot.available
                        ? " · unavailable"
                        : ""}
                </span>
                <span className="shrink-0 text-muted-foreground">
                    {effortLabel}
                </span>
                <Icon iconNode={ArrowDown01Icon} size={14} />
            </DropdownMenuTrigger>
            <DropdownMenuContent
                side="top"
                align="start"
                sideOffset={8}
                className="composer-model-menu">
                <DropdownMenuRadioGroup
                    value={snapshot.selectedId ?? ""}
                    onValueChange={(id) => {
                        const choice = snapshot.choices.find(
                            (choice) => choice.id === id,
                        );
                        if (choice) onSelect(choice.id);
                    }}>
                    {snapshot.selectedId && !snapshot.available && (
                        <DropdownMenuRadioItem
                            value={snapshot.selectedId}
                            disabled>
                            {snapshot.label} · unavailable
                        </DropdownMenuRadioItem>
                    )}
                    {snapshot.choices.map((choice) => (
                        <DropdownMenuRadioItem
                            key={choice.id}
                            value={choice.id}
                            closeOnClick
                            className="composer-model-option">
                            {choice.label}
                        </DropdownMenuRadioItem>
                    ))}
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                <DropdownMenuSub>
                    <DropdownMenuSubTrigger
                        disabled={
                            pending ||
                            !snapshot.available ||
                            !snapshot.effortChoices.length
                        }
                        className="composer-model-option">
                        Effort{" "}
                        <span className="flex-1 text-right text-xs text-muted-foreground">
                            {effortLabel}
                        </span>
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent
                        sideOffset={6}
                        className="composer-model-menu composer-effort-menu">
                        <p className="px-3 py-2 text-xs leading-5 text-muted-foreground">
                            Higher effort may take longer and use more tokens.
                        </p>
                        <DropdownMenuRadioGroup
                            value={snapshot.effort ?? ""}
                            onValueChange={(value) => {
                                const effort = snapshot.effortChoices.find(
                                    (effort) => effort === value,
                                );
                                if (effort && snapshot.selectedId)
                                    onSelect(snapshot.selectedId, effort);
                            }}>
                            {snapshot.effortChoices.map((effort) => (
                                <DropdownMenuRadioItem
                                    key={effort}
                                    value={effort}
                                    closeOnClick
                                    className="composer-model-option">
                                    {effortLabels[effort]}
                                </DropdownMenuRadioItem>
                            ))}
                        </DropdownMenuRadioGroup>
                    </DropdownMenuSubContent>
                </DropdownMenuSub>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
