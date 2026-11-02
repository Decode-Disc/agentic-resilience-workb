import {
    ComposerPrimitive,
    type ExternalThreadQueueAdapter,
    MessagePrimitive,
    type ThreadMessageLike,
    ThreadPrimitive,
    unstable_useTriggerPopoverRootContext,
    useAui,
    useAuiState,
    useExternalStoreRuntime,
} from "@assistant-ui/react";
import { MarkdownTextPrimitive } from "@assistant-ui/react-markdown";
import {
    CommandIcon,
    ArrowRight01Icon,
    Cancel01Icon,
    File01Icon,
    Loading03Icon,
    Task01Icon,
    Tick02Icon,
} from "@hugeicons/core-free-icons";
import { useControllableState } from "@radix-ui/react-use-controllable-state";
import { type ReactNode, type Ref, useEffect, useRef, useState } from "react";
import remarkGfm from "remark-gfm";
import {
    ComposerSurface,
    ComposerToolbar,
} from "@/components/composer/composer";
import { ComposerToolsMenu } from "@/components/composer/tools-menu";
import {
    type ConversationWorkItem,
    workStateLabels,
} from "@/components/chat/conversation-activity";
import {
    type ConversationAgent,
    type ConversationAgents,
    DEFAULT_CONVERSATION_AGENTS,
    WORKBENCH_AGENT,
} from "@/components/chat/conversation-agent";
import {
    ConversationMission,
    type ConversationMissionSnapshot,
} from "@/components/chat/conversation-mission";
import {
    Message,
    MessageBody,
    MessageContent,
    MessageFooter,
} from "@/components/chat/message";
import Icon from "@/components/icon";
import { Button } from "@/components/ui/button";
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { LoadErrorAlert } from "@/components/ui/load-error-alert";
import {
    Popover,
    PopoverContent,
    PopoverDescription,
    PopoverTitle,
    PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { useResponsive } from "@/hooks/use-responsive";
import { cn } from "@/lib/utils";
import {
    ConversationComposerActions,
    ConversationQueue,
    ConversationDeliveryOptions,
} from "@/components/composer/conversation-actions";
import {
    COMPOSER_COMMANDS,
    type ComposerCommand,
    ConversationSlashCommands,
    ConversationCommandPicker,
    type ResearchControlCommand,
} from "@/components/composer/slash-commands";
import "./workbench-conversation.css";

export {
    ConversationActivity,
    ConversationActivityGroup,
    type ConversationWorkItem,
} from "@/components/chat/conversation-activity";

export const WORKBENCH_AGENT_NAME = WORKBENCH_AGENT.name;

/** Keeps conversation identity and its context together wherever the chat is composed. */
export function ConversationHeader({
    identity,
    context,
    leading,
    agent = WORKBENCH_AGENT,
}: {
    identity?: ReactNode;
    context?: ReactNode;
    leading?: ReactNode;
    agent?: ConversationAgent;
}) {
    return (
        <header data-slot="conversation-header">
            {leading}
            <span data-slot="conversation-brand">{"//"}</span>
            <span>{agent.name}</span>
            <div>{identity}</div>
            {context}
        </header>
    );
}

/** Shares delivery state across composer messages and contextual answers; the caller owns history and drafts. */
export function useWorkbenchConversation({
    messages,
    draft,
    onDraftChange,
    onSend,
    isRunning = false,
    queue,
    onStop,
}: {
    messages: readonly ThreadMessageLike[];
    draft: string;
    onDraftChange: (text: string) => void;
    onSend: (
        text: string,
        delivery?: "queue" | "steer",
    ) => void | Promise<void>;
    isRunning?: boolean;
    queue?: ExternalThreadQueueAdapter;
    onStop?: () => void | Promise<void>;
}) {
    const syncingDraft = useRef(false);
    const currentDraft = useRef(draft);
    currentDraft.current = draft;
    const draftHandler = useRef(onDraftChange);
    draftHandler.current = onDraftChange;
    const [failed, setFailed] = useState(false);
    const [sending, setSending] = useState(false);
    const delivering = useRef(false);
    async function submit(text: string, delivery: "queue" | "steer" = "queue") {
        if (delivering.current) return false;
        delivering.current = true;
        setSending(true);
        setFailed(false);
        try {
            await onSend(text, delivery);
            return true;
        } catch {
            setFailed(true);
            return false;
        } finally {
            delivering.current = false;
            setSending(false);
        }
    }
    const runtime = useExternalStoreRuntime({
        messages,
        convertMessage: (message) => ({
            ...message,
            metadata: {
                ...message.metadata,
                custom: {
                    ...message.metadata?.custom,
                    creationTimeRecorded: Boolean(message.createdAt),
                },
            },
        }),
        isRunning,
        queue,
        onCancel: onStop
            ? async () => {
                  await onStop();
              }
            : undefined,
        isSendDisabled: sending,
        onNew: async (message) => {
            const text = message.content
                .filter((part) => part.type === "text")
                .map((part) => part.text)
                .join("\n");
            if (!(await submit(text))) {
                // Delivery failed; preserve a newer draft if the analyst already continued typing.
                if (!runtime.thread.composer.getState().text)
                    runtime.thread.composer.setText(text);
            }
        },
    });
    useEffect(() => {
        if (sending) return;
        if (runtime.thread.composer.getState().text !== draft) {
            syncingDraft.current = true;
            runtime.thread.composer.setText(draft);
            syncingDraft.current = false;
        }
    }, [runtime, draft, sending]);
    useEffect(
        () =>
            runtime.thread.composer.unstable_on(
                "textChange",
                ({ text, origin }) => {
                    if (
                        !syncingDraft.current &&
                        origin !== "send" &&
                        origin !== "reset" &&
                        text !== currentDraft.current
                    )
                        draftHandler.current(text);
                },
            ),
        [runtime],
    );
    return { runtime, failed, sending, submit };
}

/** Keeps the floating input on assistant-ui while allowing contextual answers through the same form. */
export function ConversationComposer(
    props: Parameters<typeof ConversationComposerContent>[0],
) {
    return (
        <ComposerPrimitive.TriggerPopoverRoot>
            <ConversationComposerContent {...props} />
        </ComposerPrimitive.TriggerPopoverRoot>
    );
}

function ConversationComposerContent({
    inputRef,
    label,
    placeholder = label,
    compact = false,
    failed = false,
    actionLabel,
    onCancel,
    pending = false,
    submission,
    onResumeQueue,
    onCommand,
    onOpenModels,
    modelSelector,
    controlsOpen = false,
    availableCommands,
}: {
    inputRef?: Ref<HTMLTextAreaElement>;
    onResumeQueue?: () => void;
    onCommand?: (command: ResearchControlCommand) => Promise<void>;
    onOpenModels?: () => void;
    modelSelector?: ReactNode;
    controlsOpen?: boolean;
    availableCommands?: readonly ComposerCommand[];
    label: string;
    placeholder?: string;
    compact?: boolean;
    failed?: boolean;
    pending?: boolean;
    actionLabel?: string;
    onCancel?: () => void;
    /** Uses the same field for a contextual choice or written answer, including an empty field with a selected choice. */
    submission?: { disabled: boolean; onSubmit: () => void };
}) {
    const aui = useAui();
    const text = useAuiState((s) => s.composer.text);
    const triggers = unstable_useTriggerPopoverRootContext();
    const hasDeliveryTools = useAuiState(
        (state) =>
            state.thread.isRunning &&
            !!state.thread.capabilities.queue &&
            !!state.composer.text.trim(),
    );
    const [commandError, setCommandError] = useState<{
        title: string;
        description: string;
    } | null>(null);
    const [commandPending, setCommandPending] = useState(false);
    const [commandsOpen, setCommandsOpen] = useState(false);
    const executing = useRef(false);
    const executeCommand = async (
        command: ComposerCommand,
        original = aui.composer().getState().text,
        consumed = false,
    ) => {
        if (executing.current || pending) return;
        executing.current = true;
        setCommandPending(true);
        setCommandError(null);
        const remainder = aui.composer().getState().text;
        try {
            if (command === "/model") onOpenModels?.();
            else await onCommand?.(command);
            if (!consumed && aui.composer().getState().text === original)
                aui.composer().setText("");
        } catch {
            if (consumed && aui.composer().getState().text === remainder)
                aui.composer().setText(original);
            setCommandError({
                title: "Command not confirmed",
                description:
                    "Review the conversation and current research state before trying again. Your text is still available.",
            });
        } finally {
            executing.current = false;
            setCommandPending(false);
        }
    };
    const sendCommand = () => {
        if (
            !onCommand ||
            submission ||
            actionLabel ||
            !text.trim().startsWith("/")
        )
            return false;
        const command = COMPOSER_COMMANDS.find((c) => c.token === text.trim());
        if (command) void executeCommand(command.token);
        else
            setCommandError({
                title: "Unknown command",
                description:
                    "Choose an available command from the menu. Your draft is kept.",
            });
        return true;
    };
    const root = useRef<HTMLDivElement>(null);
    const [expanded, setExpanded] = useState(false);
    const [toolsOpen, setToolsOpen] = useState(false);
    useEffect(() => {
        const dock = root.current?.closest<HTMLElement>(
            '[data-slot="conversation-thread-dock"]',
        );
        if (!dock) return;
        // Keep typing geometry when focus moves to attached controls, until it leaves the dock.
        const leaveDock = (event: FocusEvent) => {
            if (
                !(event.relatedTarget instanceof Node) ||
                !dock.contains(event.relatedTarget)
            )
                setExpanded(false);
        };
        dock.addEventListener("focusout", leaveDock);
        return () => dock.removeEventListener("focusout", leaveDock);
    }, []);
    const isExpanded =
        expanded ||
        controlsOpen ||
        toolsOpen ||
        commandsOpen ||
        Boolean(actionLabel) ||
        failed;
    return (
        <div
            ref={root}
            onFocusCapture={() => setExpanded(true)}
            data-slot="conversation-composer"
            data-composer-action={actionLabel ? true : undefined}
            data-composer-expanded={isExpanded}
            aria-busy={pending || commandPending}
            className="relative min-w-0 shrink-0">
            {commandsOpen && (
                <ConversationCommandPicker
                    anchor={root}
                    availableCommands={availableCommands}
                    onClose={() => setCommandsOpen(false)}
                    onExecute={(command) => {
                        setCommandsOpen(false);
                        void executeCommand(
                            command,
                            aui.composer().getState().text,
                            true,
                        );
                    }}
                />
            )}
            {onCommand && !submission && !actionLabel && (
                <ConversationSlashCommands
                    enabled={!pending && !commandPending && !commandsOpen}
                    availableCommands={availableCommands}
                    onExecute={(command, original) => {
                        setCommandsOpen(false);
                        void executeCommand(command, original, true);
                    }}
                />
            )}
            {commandError && (
                <div role="alert" className="composer-command-feedback">
                    <p>
                        <strong>{commandError.title}</strong>
                        <span> · {commandError.description}</span>
                    </p>
                </div>
            )}
            {failed && (
                <LoadErrorAlert
                    variant="inline"
                    title={
                        actionLabel
                            ? "Your changes could not be saved"
                            : "Your message could not be sent"
                    }
                    description="Your draft is still available. Try sending it again."
                    onRetry={
                        submission ? undefined : () => aui.composer().send()
                    }
                />
            )}
            {onCancel && (
                <div className="chat-composer-mode">
                    <span>{label}</span>
                </div>
            )}
            <ConversationQueue />
            <ComposerPrimitive.Root
                data-slot="prompt-composer"
                aria-label="Message the workbench"
                onSubmit={
                    submission
                        ? (event) => {
                              event.preventDefault();
                              if (!submission.disabled && !pending)
                                  submission.onSubmit();
                          }
                        : (event) => {
                              event.preventDefault();
                              if (sendCommand()) return;
                              if (aui.composer().getState().canSend)
                                  aui.composer().send({ steer: false });
                          }
                }>
                <ComposerSurface
                    expanded={isExpanded}
                    input={
                        <ComposerPrimitive.Input
                            render={<Textarea />}
                            ref={inputRef}
                            data-slot="prompt-composer-input"
                            aria-label={label}
                            placeholder={placeholder}
                            disabled={pending}
                            rows={1}
                            onKeyDownCapture={(event) => {
                                if (event.nativeEvent.isComposing) return;
                                const trigger = triggers
                                    .getTriggers()
                                    .get("/")?.resource;
                                if (trigger?.handleKeyDown(event)) {
                                    event.stopPropagation();
                                    return;
                                }
                                if (
                                    event.key === "Escape" &&
                                    event.defaultPrevented
                                )
                                    event.stopPropagation();
                            }}
                            onKeyDown={(event) => {
                                if (
                                    submission ||
                                    actionLabel ||
                                    event.key !== "Enter" ||
                                    event.nativeEvent.isComposing
                                )
                                    return;
                                if (
                                    event.shiftKey &&
                                    !event.ctrlKey &&
                                    !event.metaKey
                                )
                                    return;
                                event.preventDefault();
                                if (sendCommand()) return;
                                if (aui.composer().getState().canSend)
                                    aui.composer().send({
                                        steer: event.ctrlKey || event.metaKey,
                                    });
                            }}
                            cancelOnEscape={false}
                            addAttachmentOnPaste={false}
                            unstable_focusOnScrollToBottom={false}
                            className={cn(
                                "min-w-0 flex-1 resize-none rounded-none border-0 bg-transparent shadow-none outline-none! placeholder:text-muted-foreground focus-visible:ring-0 dark:bg-transparent",
                                compact
                                    ? "min-h-6 max-h-32 px-1 py-0.5 text-[12.5px]/5"
                                    : "min-h-10 max-h-40 px-1 py-2 text-[15px]/6",
                            )}
                        />
                    }
                    footer={
                        <ComposerToolbar
                            tools={
                                <>
                                    {!submission &&
                                        !actionLabel &&
                                        (onCommand || hasDeliveryTools) && (
                                            <ComposerToolsMenu
                                                onOpenChange={setToolsOpen}
                                                items={
                                                    onCommand
                                                        ? [
                                                              {
                                                                  label: "Commands",
                                                                  description:
                                                                      "Choose an available slash command",
                                                                  icon: CommandIcon,
                                                                  onSelect:
                                                                      () => {
                                                                          requestAnimationFrame(
                                                                              () =>
                                                                                  setCommandsOpen(
                                                                                      true,
                                                                                  ),
                                                                          );
                                                                      },
                                                              },
                                                          ]
                                                        : []
                                                }>
                                                <ConversationDeliveryOptions
                                                    onSendCommand={sendCommand}
                                                />
                                            </ComposerToolsMenu>
                                        )}
                                    {modelSelector}
                                </>
                            }
                            action={
                                <>
                                    {onCancel && (
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            disabled={pending}
                                            onClick={() => {
                                                onCancel();
                                                requestAnimationFrame(() =>
                                                    root.current
                                                        ?.querySelector(
                                                            "textarea",
                                                        )
                                                        ?.focus(),
                                                );
                                            }}>
                                            Cancel
                                        </Button>
                                    )}
                                    {submission ? (
                                        <Button
                                            type="submit"
                                            variant="round"
                                            disabled={
                                                submission.disabled || pending
                                            }
                                            data-text-action
                                            data-slot="prompt-composer-submit">
                                            {actionLabel ?? "Continue"}
                                        </Button>
                                    ) : (
                                        <ConversationComposerActions
                                            actionLabel={actionLabel}
                                            onResumeQueue={onResumeQueue}
                                            onSendCommand={
                                                onCommand
                                                    ? sendCommand
                                                    : undefined
                                            }
                                        />
                                    )}
                                </>
                            }
                        />
                    }
                />
            </ComposerPrimitive.Root>
        </div>
    );
}

function ConversationMessage({
    authorName,
    agents,
    presentation,
}: {
    presentation?: "work-note";
    authorName: string;
    agents: ConversationAgents;
}) {
    const role = useAuiState((s) => s.message.role);
    const agentId = useAuiState((s) => s.message.metadata.custom.agentId);
    const resolvedAuthor =
        agentId === undefined
            ? authorName
            : typeof agentId === "string"
              ? agents[agentId]?.name
              : undefined;
    const createdAt = useAuiState((s) =>
        s.message.metadata.custom.creationTimeRecorded
            ? s.message.createdAt
            : undefined,
    );
    const text = useAuiState((s) =>
        s.message.content
            .filter((part) => part.type === "text")
            .map((part) => part.text)
            .join("\n"),
    );
    const streaming = useAuiState((s) => s.message.status?.type === "running");
    const interrupted = useAuiState(
        (s) => s.message.status?.type === "incomplete",
    );
    const attributionError =
        role === "assistant" && !resolvedAuthor ? (
            <LoadErrorAlert
                variant="inline"
                title="Message attribution unavailable"
                description="The message is retained, but its author could not be identified."
            />
        ) : null;
    if (presentation === "work-note" && role === "assistant")
        return (
            <MessagePrimitive.Root
                render={
                    <div
                        role="note"
                        aria-label={`${resolvedAuthor ?? "Unidentified agent"} progress note`}
                        data-slot="conversation-work-note"
                    />
                }>
                {attributionError}
                <MessagePrimitive.Parts
                    components={{ Text: ConversationMarkdown }}
                />
            </MessagePrimitive.Root>
        );
    return (
        <MessagePrimitive.Root
            render={
                <Message
                    from={role}
                    authorName={
                        role === "assistant"
                            ? (resolvedAuthor ?? "Unidentified agent")
                            : undefined
                    }
                    streaming={streaming}
                />
            }>
            <MessageBody>
                {attributionError}
                <MessageContent>
                    <MessagePrimitive.Parts
                        components={{ Text: ConversationMarkdown }}
                    />
                </MessageContent>
                {interrupted && (
                    <p role="status">
                        Response interrupted. The partial reply remains
                        available.
                    </p>
                )}
                <MessageFooter createdAt={createdAt} text={text} />
            </MessageBody>
        </MessagePrimitive.Root>
    );
}

function ConversationMarkdown() {
    return (
        <MarkdownTextPrimitive
            smooth
            remarkPlugins={[remarkGfm]}
            className="min-w-0 wrap-anywhere [&_p]:my-0 [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_a]:text-accent-foreground [&_a]:underline [&_a]:underline-offset-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5"
        />
    );
}

/** Keeps historical groups on the same runtime and preserves their stable message identities. */
export function ConversationMessages({
    ids,
    authorName = WORKBENCH_AGENT_NAME,
    agents = DEFAULT_CONVERSATION_AGENTS,
    presentation,
}: {
    presentation?: "work-note";
    ids?: readonly string[];
    /** Identity of the assistant whose messages the caller selects. */
    authorName?: string;
    agents?: ConversationAgents;
}) {
    return (
        <ThreadPrimitive.Messages>
            {({ message }) =>
                !ids || ids.includes(message.id) ? (
                    <ConversationMessage
                        authorName={authorName}
                        agents={agents}
                        presentation={presentation}
                    />
                ) : null
            }
        </ThreadPrimitive.Messages>
    );
}

/** Keeps pending content mounted while folded and leaves its decision footer reachable. */
export function ConversationPendingPanel({
    title,
    summary,
    children,
    footer,
    composer,
    headerAction,
}: {
    title: string;
    summary: string;
    children?: ReactNode;
    footer?: ReactNode;
    composer?: ReactNode;
    headerAction?: ReactNode;
}) {
    const heading = (
        <>
            <span>{title}</span>
            <span>{summary}</span>
        </>
    );
    return (
        <section data-slot="conversation-pending-panel">
            {children ? (
                <details open data-slot="conversation-pending-details">
                    <summary>
                        {heading}
                        <Icon iconNode={ArrowRight01Icon} size={14} />
                    </summary>
                    <div data-slot="conversation-pending-body">{children}</div>
                </details>
            ) : (
                <div data-slot="conversation-pending-summary">
                    {heading}
                    {headerAction}
                </div>
            )}
            {footer && (
                <div data-slot="conversation-pending-footer">{footer}</div>
            )}
            {composer}
        </section>
    );
}

/** An inspectable input in the context card; opening it does not imply that it has been read. */
export function ConversationReference({
    title,
    description,
    children,
}: {
    title: string;
    description: string;
    children: ReactNode;
}) {
    return (
        <Collapsible>
            <CollapsibleTrigger
                render={<Button variant="ghost" size="sm" />}
                data-slot="conversation-reference"
                aria-label={`Inspect reference: ${title}`}>
                <Icon iconNode={File01Icon} size={15} />
                <span>{title}</span>
                <Icon iconNode={ArrowRight01Icon} size={12} />
            </CollapsibleTrigger>
            <CollapsibleContent>
                <div className="chat-reference-details">
                    <p className="chat-reference-description">{description}</p>
                    {children}
                </div>
            </CollapsibleContent>
        </Collapsible>
    );
}

function ContextWorkItems({
    items,
}: {
    items: readonly ConversationWorkItem[];
}) {
    return (
        <ul>
            {items.map((item) => (
                <li key={item.id} data-state={item.state}>
                    <Icon
                        iconNode={
                            item.state === "running"
                                ? Loading03Icon
                                : item.state === "completed"
                                  ? Tick02Icon
                                  : Cancel01Icon
                        }
                        size={16}
                        className={
                            item.state === "running"
                                ? "chat-working-icon"
                                : undefined
                        }
                    />
                    <div>
                        <strong>{item.title}</strong>
                        <span>{item.summary}</span>
                    </div>
                    <span className="chat-context-work-state">
                        {workStateLabels[item.state]}
                    </span>
                </li>
            ))}
        </ul>
    );
}

/** Reflects supplied activity snapshots; it never schedules or simulates work. */
function ConversationWorkList({
    activities,
    missions,
    agents,
}: {
    activities: readonly ConversationWorkItem[];
    missions: readonly ConversationMissionSnapshot[];
    agents: ConversationAgents;
}) {
    const current = activities.filter((item) => item.state !== "completed");
    const completed = activities.filter((item) => item.state === "completed");
    const working =
        current.filter((item) => item.state === "running").length +
        missions.filter((mission) => mission.state === "running").length;
    return (
        <section className="chat-context-work" aria-label="Work">
            <div className="chat-context-work-heading">
                <h2>Work</h2>
                <span role="status">
                    {working ? `${working} working` : "No active work"}
                </span>
            </div>
            {missions.map((mission) => {
                const agent = agents[mission.agentId];
                return agent ? (
                    <ConversationMission
                        key={mission.id}
                        mission={mission}
                        agent={agent}
                    />
                ) : (
                    <LoadErrorAlert
                        key={mission.id}
                        variant="inline"
                        title="Work attribution unavailable"
                        description="This mission’s agent could not be restored."
                    />
                );
            })}
            {current.length > 0 && <ContextWorkItems items={current} />}
            {completed.length > 0 && (
                <Collapsible className="chat-context-completed">
                    <CollapsibleTrigger
                        render={<Button variant="ghost" size="sm" />}
                        aria-label="Completed work">
                        <Icon iconNode={Tick02Icon} size={15} />
                        <span>{completed.length} completed</span>
                        <Icon iconNode={ArrowRight01Icon} size={12} />
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                        <ContextWorkItems items={completed} />
                    </CollapsibleContent>
                </Collapsible>
            )}
            {!activities.length && !missions.length && (
                <p className="chat-context-empty">No work recorded yet.</p>
            )}
        </section>
    );
}

/** A header-anchored overview of the current plan, retained outputs and reference inputs. */
export function ConversationContext({
    defaultOpen = true,
    open: controlledOpen,
    onOpenChange,
    title = "Research context",
    activities = [],
    missions = [],
    agents = DEFAULT_CONVERSATION_AGENTS,
    plan,
    planSummary,
    planAction,
    outputs,
    sources,
    onChangeScope,
}: {
    defaultOpen?: boolean;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    title?: string;
    activities?: readonly ConversationWorkItem[];
    missions?: readonly ConversationMissionSnapshot[];
    agents?: ConversationAgents;
    plan: ReactNode;
    planSummary?: ReactNode;
    planAction?: ReactNode;
    outputs: ReactNode;
    sources: ReactNode;
    onChangeScope?: () => void;
}) {
    const [open, setOpen] = useControllableState({
        prop: controlledOpen,
        defaultProp: defaultOpen,
        onChange: onOpenChange,
        caller: "ConversationContext",
    });
    const { isMobile } = useResponsive();
    return (
        <Popover
            open={open}
            onOpenChange={(next, details) => {
                if (
                    details.reason === "outside-press" ||
                    details.reason === "focus-out"
                ) {
                    details.cancel();
                    return;
                }
                setOpen(next);
            }}
            modal={false}>
            <PopoverTrigger
                render={<Button variant="ghost" size="icon-sm" />}
                aria-label="Research context"
                title="Research context"
                data-slot="conversation-context-trigger">
                <Icon iconNode={Task01Icon} size={19} />
            </PopoverTrigger>
            <PopoverContent
                layer="context"
                side="bottom"
                align="end"
                sideOffset={10}
                className="chat-context-card"
                initialFocus={false}>
                <div className="chat-context-topline">
                    <Icon iconNode={Task01Icon} size={16} />
                    <PopoverTitle>{title}</PopoverTitle>
                    <Button
                        variant="ghost"
                        size="icon-xs"
                        className="chat-context-close"
                        aria-label="Close research context"
                        onClick={() => setOpen(false)}>
                        <Icon iconNode={Cancel01Icon} size={14} />
                    </Button>
                </div>
                <PopoverDescription className="sr-only">
                    Current plan, retained outputs and reference inputs.
                </PopoverDescription>
                <ScrollArea
                    className="chat-context-scroll"
                    viewportClassName="chat-context-viewport"
                    viewportProps={{
                        role: "region",
                        "aria-label": "Research context details",
                        tabIndex: 0,
                    }}>
                    <div className="chat-context-sections">
                        <section aria-label="Plan">
                            <div className="chat-context-section-heading">
                                <h2>Plan</h2>
                                {planAction}
                                {onChangeScope && (
                                    <Button
                                        variant="ghost"
                                        size="xs"
                                        className="chat-context-scope-action"
                                        onClick={() => {
                                            onChangeScope();
                                            if (isMobile) setOpen(false);
                                        }}>
                                        Change scope
                                    </Button>
                                )}
                            </div>
                            {planSummary ? (
                                <Collapsible className="chat-context-plan">
                                    <CollapsibleTrigger
                                        render={
                                            <Button variant="ghost" size="sm" />
                                        }
                                        aria-label="Inspect research plan">
                                        <Icon iconNode={Task01Icon} size={15} />
                                        <span>{planSummary}</span>
                                        <Icon
                                            iconNode={ArrowRight01Icon}
                                            size={12}
                                        />
                                    </CollapsibleTrigger>
                                    <CollapsibleContent>
                                        <div className="chat-context-plan-details">
                                            {plan}
                                        </div>
                                    </CollapsibleContent>
                                </Collapsible>
                            ) : (
                                plan
                            )}
                        </section>
                        <section aria-label="Outputs">
                            <h2>Outputs</h2>
                            {outputs}
                        </section>
                        <section aria-label="Sources">
                            <h2>Sources</h2>
                            {sources}
                        </section>
                        <ConversationWorkList
                            activities={activities}
                            missions={missions}
                            agents={agents}
                        />
                    </div>
                </ScrollArea>
            </PopoverContent>
        </Popover>
    );
}
