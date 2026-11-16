import {
    ComposerPrimitive,
    unstable_useSlashCommandAdapter,
    useAuiState,
} from "@assistant-ui/react";
import type { workbenchCommand } from "@convex/domain/workbenchContracts";
import {
    PauseIcon,
    PlayIcon,
    Settings02Icon,
} from "@hugeicons/core-free-icons";
import type { Infer } from "convex/values";
import { type RefObject, useId, useRef } from "react";
import Icon from "@/components/icon";
import { Button } from "@/components/ui/button";
import {
    Combobox,
    ComboboxContent,
    ComboboxEmpty,
    ComboboxInput,
    ComboboxItem,
    ComboboxList,
} from "@/components/ui/combobox";
import { uiLayerClasses } from "@/lib/ui-layers";
import { cn } from "@/lib/utils";

export type ResearchControlCommand = Infer<typeof workbenchCommand>;
export type ComposerApprovalGrant = {
    id: string;
    label: string;
    onRevoke: () => void;
};
export const COMPOSER_COMMANDS = [
    { token: "/pause", label: "Pause research", icon: PauseIcon },
    { token: "/resume", label: "Resume research", icon: PlayIcon },
    { token: "/model", label: "Choose model", icon: Settings02Icon },
] as const;
export type ComposerCommand = (typeof COMPOSER_COMMANDS)[number]["token"];

function commandChoices(available?: readonly ComposerCommand[]) {
    return COMPOSER_COMMANDS.filter(
        (command) => !available || available.includes(command.token),
    );
}

/** Opens the same command catalogue independently of the draft; Base UI owns search, keyboard and dismissal. */
export function ConversationCommandPicker({
    anchor,
    availableCommands,
    grants,
    onClose,
    onExecute,
}: {
    anchor: RefObject<HTMLDivElement | null>;
    availableCommands?: readonly ComposerCommand[];
    grants?: readonly ComposerApprovalGrant[];
    onClose: () => void;
    onExecute: (command: ComposerCommand) => void;
}) {
    const grantsHeadingId = useId();
    return (
        <Combobox<(typeof COMPOSER_COMMANDS)[number]>
            items={commandChoices(availableCommands)}
            value={null}
            open
            autoHighlight
            itemToStringLabel={(command) => `${command.token} ${command.label}`}
            onOpenChange={(open) => {
                if (!open) onClose();
            }}
            onValueChange={(command) => {
                if (command) onExecute(command.token);
            }}>
            <ComboboxContent
                anchor={anchor}
                side="top"
                align="start"
                className="composer-command-menu"
                finalFocus={() =>
                    anchor.current?.querySelector("textarea") ?? true
                }>
                <ComboboxInput
                    aria-label="Search commands"
                    placeholder="Search commands…"
                    showTrigger={false}
                />
                <ComboboxEmpty>No matching command.</ComboboxEmpty>
                <ComboboxList>
                    {(command) => (
                        <ComboboxItem
                            key={command.token}
                            value={command}
                            className="composer-slash-option">
                            <Icon iconNode={command.icon} size={16} />
                            <span className="composer-command-name">
                                {command.token}
                            </span>
                            <span className="text-muted-foreground">
                                {command.label}
                            </span>
                        </ComboboxItem>
                    )}
                </ComboboxList>
                {grants && grants.length > 0 && (
                    <fieldset
                        aria-labelledby={grantsHeadingId}
                        className="m-0 mt-1 border-0 border-t border-border p-0 px-1 pt-1.5 pb-1">
                        <p
                            id={grantsHeadingId}
                            className="px-2 py-1 text-xs font-medium text-muted-foreground">
                            Allowed actions
                        </p>
                        <div className="flex flex-col gap-0.5">
                            {grants.map((grant) => (
                                <Button
                                    key={grant.id}
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="h-auto w-full justify-between px-2 py-1.5 text-left font-normal"
                                    onClick={() => grant.onRevoke()}>
                                    <span>{grant.label}</span>
                                    <span className="text-xs text-muted-foreground">
                                        Stop allowing
                                    </span>
                                </Button>
                            ))}
                        </div>
                    </fieldset>
                )}
            </ComboboxContent>
        </Combobox>
    );
}

/** Uses assistant-ui's native query, selection and keyboard state for explicit control drafts. */
export function ConversationSlashCommands({
    enabled,
    onExecute,
    availableCommands,
}: {
    enabled: boolean;
    availableCommands?: readonly ComposerCommand[];
    onExecute: (command: ComposerCommand, original: string) => void;
}) {
    const text = useAuiState((state) => state.composer.text);
    const original = useRef(text);
    if (/^\s*\/[^\s/]*$/.test(text)) original.current = text;
    const slash = unstable_useSlashCommandAdapter({
        commands: commandChoices(availableCommands).map((command) => ({
            id: command.token.slice(1),
            label: command.token,
            description: command.label,
            execute: () => onExecute(command.token, original.current),
        })),
        removeOnExecute: true,
    });
    return (
        <ComposerPrimitive.TriggerPopover
            char="/"
            adapter={slash.adapter}
            matcher={(value, _trigger, cursor) =>
                enabled &&
                /^\s*\/[^\s/]*$/.test(value) &&
                cursor > value.indexOf("/")
                    ? {
                          query: value.slice(value.indexOf("/") + 1, cursor),
                          offset: 0,
                          endOffset: value.length,
                      }
                    : null
            }
            aria-label="Commands"
            className={cn("composer-slash-menu", uiLayerClasses.popup)}>
            <ComposerPrimitive.TriggerPopover.Action {...slash.action} />
            <ComposerPrimitive.TriggerPopoverItems>
                {(items) =>
                    items.length ? (
                        items.map((item, index) => (
                            <ComposerPrimitive.TriggerPopoverItem
                                key={item.id}
                                item={item}
                                index={index}
                                className="composer-slash-option"
                                onMouseDown={(event) => event.preventDefault()}>
                                <Icon
                                    iconNode={
                                        COMPOSER_COMMANDS.find(
                                            (command) =>
                                                command.token === item.label,
                                        )?.icon ?? Settings02Icon
                                    }
                                    size={16}
                                />
                                <span className="composer-command-name">
                                    {item.label}
                                </span>
                                <span className="text-muted-foreground">
                                    {item.description}
                                </span>
                                <kbd>↵</kbd>
                            </ComposerPrimitive.TriggerPopoverItem>
                        ))
                    ) : (
                        <p className="px-3 py-2 text-sm text-muted-foreground">
                            No matching command.
                        </p>
                    )
                }
            </ComposerPrimitive.TriggerPopoverItems>
        </ComposerPrimitive.TriggerPopover>
    );
}
