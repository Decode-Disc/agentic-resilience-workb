import {
    ComposerPrimitive,
    unstable_useSlashCommandAdapter,
    useAuiState,
} from "@assistant-ui/react";
import type { api } from "@convex/_generated/api";
import type { FunctionArgs } from "convex/server";
import { useRef } from "react";

export type ResearchControlCommand = FunctionArgs<
    typeof api.workbench.command
>["command"];
export const COMPOSER_COMMANDS = [
    { token: "/pause", label: "Pause research" },
    { token: "/resume", label: "Resume research" },
    { token: "/model", label: "Choose model" },
] as const;
export type ComposerCommand = (typeof COMPOSER_COMMANDS)[number]["token"];

/** Uses assistant-ui's native query, selection and keyboard state for explicit control drafts. */
export function ConversationSlashCommands({
    enabled,
    onExecute,
}: {
    enabled: boolean;
    onExecute: (command: ComposerCommand, original: string) => void;
}) {
    const text = useAuiState((state) => state.composer.text);
    const original = useRef(text);
    if (/^\s*\/[^\s/]*$/.test(text)) original.current = text;
    const slash = unstable_useSlashCommandAdapter({
        commands: COMPOSER_COMMANDS.map((command) => ({
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
            className="composer-slash-menu">
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
                                <span className="min-w-16 font-medium">
                                    {item.label}
                                </span>
                                <span className="text-muted-foreground">
                                    {item.description}
                                </span>
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
