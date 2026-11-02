import {
    ComposerPrimitive,
    unstable_useSlashCommandAdapter,
    useAuiState,
} from "@assistant-ui/react";
import type { api } from "@convex/_generated/api";
import type { FunctionArgs } from "convex/server";
import {
    PauseIcon,
    PlayIcon,
    Settings02Icon,
} from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";
import { uiLayerClasses } from "@/lib/ui-layers";
import Icon from "@/components/icon";
import { useRef, type RefObject } from "react";
import {
    Combobox,
    ComboboxContent,
    ComboboxInput,
    ComboboxList,
    ComboboxItem,
    ComboboxEmpty,
} from "@/components/ui/combobox";

export type ResearchControlCommand = FunctionArgs<
    typeof api.workbench.command
>["command"];
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
    onClose,
    onExecute,
}: {
    anchor: RefObject<HTMLDivElement | null>;
    availableCommands?: readonly ComposerCommand[];
    onClose: () => void;
    onExecute: (command: ComposerCommand) => void;
}) {
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
