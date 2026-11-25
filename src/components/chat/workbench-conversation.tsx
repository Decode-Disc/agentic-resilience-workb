import {
    type AppendMessage,
    ComposerPrimitive,
    type ExternalThreadQueueAdapter,
    MessagePrimitive,
    type ThreadMessageLike,
    ThreadPrimitive,
    type ToolCallMessagePartProps,
    unstable_useTriggerPopoverRootContext,
    useAui,
    useAuiState,
    useExternalStoreRuntime,
} from "@assistant-ui/react";
import { MarkdownTextPrimitive } from "@assistant-ui/react-markdown";
import {
    ArrowDown01Icon,
    ArrowRight01Icon,
    Cancel01Icon,
    CommandIcon,
    File01Icon,
    Task01Icon,
} from "@hugeicons/core-free-icons";
import { useControllableState } from "@radix-ui/react-use-controllable-state";
import {
    type CSSProperties,
    createContext,
    type ReactNode,
    type Ref,
    useContext,
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
} from "react";
import remarkGfm from "remark-gfm";
import { AgentIdentity } from "@/components/chat/agent-identity";
import {
    type ConversationWorkItem,
    ConversationWorkMark,
    workStateLabels,
} from "@/components/chat/conversation-activity";
import {
    type ConversationAgent,
    type ConversationAgents,
    DEFAULT_CONVERSATION_AGENTS,
    WORKBENCH_AGENT,
} from "@/components/chat/conversation-agent";
import type { ConversationMissionSnapshot } from "@/components/chat/conversation-mission";
import { useConversationVisible } from "@/components/chat/conversation-thread";
import {
    Message,
    MessageBody,
    MessageContent,
    MessageFooter,
} from "@/components/chat/message";
import {
    ComposerSurface,
    ComposerToolbar,
} from "@/components/composer/composer";
import {
    ConversationComposerActions,
    ConversationDeliveryOptions,
    ConversationQueue,
} from "@/components/composer/conversation-actions";
import {
    COMPOSER_COMMANDS,
    type ComposerApprovalGrant,
    type ComposerCommand,
    ConversationCommandPicker,
    ConversationSlashCommands,
    type ResearchControlCommand,
} from "@/components/composer/slash-commands";
import { ComposerToolsMenu } from "@/components/composer/tools-menu";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useResponsive } from "@/hooks/use-responsive";
import { responseCoherenceNotice } from "@/lib/presentation/workbench";
import { cn } from "@/lib/utils";
import "./workbench-conversation.css";

export {
    ConversationActivity,
    ConversationActivityGroup,
    type ConversationWorkItem,
} from "@/components/chat/conversation-activity";

export const WORKBENCH_AGENT_NAME = WORKBENCH_AGENT.name;
const CONTEXT_PANEL_WIDTH_PX = 280;
/** Below this conversation width the card would crowd the reading lane, so it becomes a popover. */
const CONTEXT_SIDE_MIN_WIDTH_PX = CONTEXT_PANEL_WIDTH_PX + 640 + 92;

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
            <AgentIdentity agent={agent} />
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
    queue?: Omit<ExternalThreadQueueAdapter, "enqueue" | "steer">;
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
    const deliverMessage = async (
        message: AppendMessage,
        mode: "queue" | "steer" = "queue",
    ) => {
        const text = message.content
            .flatMap((part) => (part.type === "text" ? [part.text] : []))
            .join("\n");
        if (
            !(await submit(text, mode)) &&
            !runtime.thread.composer.getState().text
        )
            runtime.thread.composer.setText(text);
    };
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
        queue: queue
            ? {
                  ...queue,
                  enqueue: (message) => {
                      void deliverMessage(message);
                  },
                  steer: (message) => {
                      void deliverMessage(
                          message,
                          message.steer ? "steer" : "queue",
                      );
                  },
              }
            : undefined,
        onCancel: onStop
            ? async () => {
                  await onStop();
              }
            : undefined,
        isSendDisabled: sending,
        onNew: deliverMessage,
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
    grants,
}: {
    inputRef?: Ref<HTMLTextAreaElement>;
    onResumeQueue?: () => void;
    onCommand?: (command: ResearchControlCommand) => Promise<void>;
    onOpenModels?: () => void;
    modelSelector?: ReactNode;
    controlsOpen?: boolean;
    availableCommands?: readonly ComposerCommand[];
    grants?: readonly ComposerApprovalGrant[];
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
                    grants={grants}
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
                                            onClick={(event) => {
                                                const cancel =
                                                    event.currentTarget;
                                                onCancel();
                                                requestAnimationFrame(() => {
                                                    // Preserve an explicit return target supplied by the editing surface.
                                                    const active =
                                                        document.activeElement;
                                                    if (
                                                        !active ||
                                                        active ===
                                                            document.body ||
                                                        active === cancel
                                                    )
                                                        root.current
                                                            ?.querySelector(
                                                                "textarea",
                                                            )
                                                            ?.focus();
                                                });
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

type ApprovalRenderer = (requestId: string) => ReactNode;
const ConversationApprovalContext = createContext<ApprovalRenderer | undefined>(
    undefined,
);

/** Supplies the host's connected approval card renderer to all transcript messages in scope. */
export function ConversationApprovalProvider({
    renderApproval,
    children,
}: {
    renderApproval?: ApprovalRenderer;
    children: ReactNode;
}) {
    return (
        <ConversationApprovalContext.Provider value={renderApproval}>
            {children}
        </ConversationApprovalContext.Provider>
    );
}

const ConversationBodyRetryContext = createContext<
    ((messageId: string) => void) | undefined
>(undefined);

/** Keeps retry scoped to the reply whose body is unavailable. */
export function ConversationBodyRetryProvider({
    retry,
    children,
}: {
    retry: (messageId: string) => void;
    children: ReactNode;
}) {
    return (
        <ConversationBodyRetryContext.Provider value={retry}>
            {children}
        </ConversationBodyRetryContext.Provider>
    );
}

function ConversationApprovalPart(
    props: ToolCallMessagePartProps<{ requestId?: unknown }>,
) {
    const renderApproval = useContext(ConversationApprovalContext);
    const requestId =
        typeof props.args?.requestId === "string"
            ? props.args.requestId
            : undefined;
    if (!renderApproval || !requestId) return null;
    return <div className="mt-2.5">{renderApproval(requestId)}</div>;
}

const CONVERSATION_PART_COMPONENTS = {
    Text: ConversationMarkdown,
    tools: { by_name: { approval: ConversationApprovalPart } },
};

function ConversationMessage({
    authorName,
    agents,
    presentation,
}: {
    presentation?: "work-note";
    authorName: string;
    agents: ConversationAgents;
}) {
    const retry = useContext(ConversationBodyRetryContext);
    const messageId = useAuiState((s) => s.message.id);
    const bodyLoad = useAuiState((s) => s.message.metadata.custom.bodyLoad);
    const bodyStatus =
        bodyLoad === "loading" ? (
            <div role="status" aria-label="Loading reply">
                <Skeleton className="h-5 w-3/4" />
            </div>
        ) : bodyLoad === "failed" ? (
            <LoadErrorAlert
                variant="inline"
                title="Reply unavailable"
                description="Try again to load this reply."
                onRetry={retry ? () => retry(messageId) : undefined}
            />
        ) : null;
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
    const coherence = responseCoherenceNotice(
        useAuiState((s) => s.message.metadata.custom.responseControl),
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
                {bodyStatus}
                <MessagePrimitive.Parts
                    components={CONVERSATION_PART_COMPONENTS}
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
                {streaming && (
                    <span className="chat-reply-phase" role="status">
                        Draft reply
                    </span>
                )}
                <MessageContent>
                    {bodyStatus}
                    <MessagePrimitive.Parts
                        components={CONVERSATION_PART_COMPONENTS}
                    />
                </MessageContent>
                {role === "assistant" && coherence && (
                    <aside
                        role="note"
                        aria-label="Response consistency"
                        className="mt-3 space-y-1 rounded-lg border border-warning/40 bg-warning/5 p-3 text-xs text-muted-foreground">
                        <p className="font-medium text-foreground">
                            {coherence.title}
                        </p>
                        {coherence.score && <p>{coherence.score}</p>}
                        <p>{coherence.detail}</p>
                    </aside>
                )}
                {interrupted && (
                    <p role="status">
                        Response interrupted. The partial reply remains
                        available.
                    </p>
                )}
                <MessageFooter
                    createdAt={createdAt}
                    text={text}
                    copyDisabled={bodyStatus !== null}
                />
            </MessageBody>
        </MessagePrimitive.Root>
    );
}

function ConversationMarkdown() {
    return (
        <MarkdownTextPrimitive
            smooth
            remarkPlugins={[remarkGfm]}
            className="min-w-0 wrap-anywhere [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_a]:text-accent-foreground [&_a]:underline [&_a]:underline-offset-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5"
        />
    );
}

/** Keeps historical groups on the same runtime and preserves their stable message identities. */
export function ConversationMessages({
    ids,
    authorName = WORKBENCH_AGENT_NAME,
    agents = DEFAULT_CONVERSATION_AGENTS,
    presentation,
    renderApproval,
}: {
    presentation?: "work-note";
    ids?: readonly string[];
    /** Identity of the assistant whose messages the caller selects. */
    authorName?: string;
    agents?: ConversationAgents;
    renderApproval?: ApprovalRenderer;
}) {
    const inheritedRenderApproval = useContext(ConversationApprovalContext);
    const activeRenderApproval = renderApproval ?? inheritedRenderApproval;
    const messages = (
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
    return activeRenderApproval !== inheritedRenderApproval ? (
        <ConversationApprovalProvider renderApproval={activeRenderApproval}>
            {messages}
        </ConversationApprovalProvider>
    ) : (
        messages
    );
}

/** Marks which edges of a scrolling region hide content, so the region can show it continues. */
function useScrollEdges<T extends HTMLElement>(active: boolean) {
    const ref = useRef<T>(null);
    const [edges, setEdges] = useState<"top" | "bottom" | "both" | undefined>();
    useEffect(() => {
        const node = ref.current;
        if (!node || !active) return setEdges(undefined);
        const update = () => {
            const above = node.scrollTop > 1;
            const below =
                node.scrollHeight - node.clientHeight - node.scrollTop > 1;
            setEdges(
                above && below
                    ? "both"
                    : above
                      ? "top"
                      : below
                        ? "bottom"
                        : undefined,
            );
        };
        update();
        node.addEventListener("scroll", update, { passive: true });
        const observer = new ResizeObserver(update);
        observer.observe(node);
        for (const child of Array.from(node.children)) observer.observe(child);
        return () => {
            node.removeEventListener("scroll", update);
            observer.disconnect();
        };
    }, [active]);
    return [ref, edges] as const;
}

/** Keeps pending content mounted while folded and leaves its decision footer reachable. */
export function ConversationPendingPanel({
    title,
    summary,
    toggleLabels = { open: "Hide", closed: "Show" },
    children,
    footer,
    composer,
    headerAction,
    open: controlledOpen,
    onOpenChange,
}: {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    title: string;
    summary: ReactNode;
    /** Names what the header toggle reveals or hides. */
    toggleLabels?: { open: string; closed: string };
    children?: ReactNode;
    footer?: ReactNode;
    composer?: ReactNode;
    headerAction?: ReactNode;
}) {
    const [expanded, setExpanded] = useControllableState({
        prop: controlledOpen,
        defaultProp: true,
        onChange: onOpenChange,
        caller: "ConversationPendingPanel",
    });
    const heading = (
        <>
            <span>{title}</span>
            <span>{summary}</span>
        </>
    );
    const [bodyRef, overflow] = useScrollEdges<HTMLDivElement>(expanded);
    return (
        <section
            data-slot="conversation-pending-panel"
            data-expanded={expanded}>
            {children ? (
                <details
                    open={expanded}
                    onToggle={(event) => setExpanded(event.currentTarget.open)}
                    data-slot="conversation-pending-details">
                    {/* biome-ignore lint/a11y/noStaticElementInteractions: summary is the native keyboard-accessible details disclosure; controlled toggling also preserves externally opened edits. */}
                    <summary
                        onClick={(event) => {
                            event.preventDefault();
                            setExpanded(!expanded);
                        }}>
                        {heading}
                        <span className="chat-pending-toggle">
                            <span>
                                {expanded
                                    ? toggleLabels.open
                                    : toggleLabels.closed}
                            </span>
                            <Icon iconNode={ArrowDown01Icon} size={14} />
                        </span>
                    </summary>
                    <div
                        ref={bodyRef}
                        data-slot="conversation-pending-body"
                        data-overflow={overflow}
                        hidden={!expanded}>
                        {children}
                    </div>
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

/** The one piece of work worth surfacing beside the conversation: what is happening now. Finished work stays in the transcript. */
function currentWork(
    activities: readonly ConversationWorkItem[],
    missions: readonly ConversationMissionSnapshot[],
) {
    const mission = missions.find((m) => m.state !== "completed");
    if (mission)
        return {
            state: mission.state,
            title:
                mission.operations.find((o) => o.state === "running")?.title ??
                mission.title,
            label: mission.stateLabel ?? workStateLabels[mission.state],
        };
    const activity = [...activities]
        .reverse()
        .find((a) => a.state !== "completed");
    return activity
        ? {
              state: activity.state,
              title: activity.title,
              label: workStateLabels[activity.state],
          }
        : undefined;
}

/** Clamps long scope text and offers the rest only when it is actually cut. */
function ContextScope({ children }: { children: ReactNode }) {
    const textRef = useRef<HTMLParagraphElement>(null);
    const [expanded, setExpanded] = useState(false);
    const [clamped, setClamped] = useState(false);
    // biome-ignore lint/correctness/useExhaustiveDependencies: remeasure when the scope text changes.
    useLayoutEffect(() => {
        const text = textRef.current;
        if (text && !expanded)
            setClamped(text.scrollHeight > text.clientHeight + 1);
    }, [children, expanded]);
    return (
        <>
            <p
                ref={textRef}
                className="chat-context-scope-text"
                data-expanded={expanded || undefined}>
                {children}
            </p>
            {(clamped || expanded) && (
                <button
                    type="button"
                    className="chat-context-more"
                    aria-expanded={expanded}
                    onClick={() => setExpanded(!expanded)}>
                    {expanded ? "Show less" : "Show more"}
                </button>
            )}
        </>
    );
}

/** Floating dossier card beside the conversation: what the transcript does not already show, on one surface. */
export function ConversationContext({
    defaultOpen,
    open: controlledOpen,
    onOpenChange,
    title = "Research context",
    icon,
    activities = [],
    missions = [],
    scope,
    scopeAction,
    onChangeScope,
    questions,
    programTitle = "Research program",
    outputs,
    sources,
    sourcesSummary,
}: {
    /** Defaults to open where the card fits beside the conversation, closed where it would cover it. */
    defaultOpen?: boolean;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    title?: string;
    /** Identifies the dossier, such as the company favicon; defaults to the research context glyph. */
    icon?: ReactNode;
    activities?: readonly ConversationWorkItem[];
    missions?: readonly ConversationMissionSnapshot[];
    scope: ReactNode;
    scopeAction?: ReactNode;
    onChangeScope?: () => void;
    /** Short labels of the research questions, in program order. */
    questions: readonly string[];
    /** Names the program's state, such as an accepted program after launch. */
    programTitle?: string;
    outputs?: ReactNode;
    sources: ReactNode;
    sourcesSummary?: ReactNode;
}) {
    const [open, setOpen] = useControllableState({
        prop: controlledOpen,
        defaultProp: defaultOpen ?? false,
        onChange: onOpenChange,
        caller: "ConversationContext",
    });
    const { isMobile } = useResponsive();
    const visible = useConversationVisible();
    const triggerRef = useRef<HTMLButtonElement>(null);
    const [frame, setFrame] = useState<{
        left: number;
        top: number;
        width: number;
        height: number;
    } | null>(null);
    // biome-ignore lint/correctness/useExhaustiveDependencies: the initial placement decides the default once; later resizes never reopen a dismissed card.
    useLayoutEffect(() => {
        if (defaultOpen !== undefined) return;
        const width = triggerRef.current
            ?.closest<HTMLElement>('[data-slot="conversation-thread"]')
            ?.getBoundingClientRect().width;
        if (width ? width >= CONTEXT_SIDE_MIN_WIDTH_PX : !isMobile)
            setOpen(true);
    }, []);
    useLayoutEffect(() => {
        const host = triggerRef.current?.closest<HTMLElement>(
            '[data-slot="conversation-thread"]',
        );
        if (!host) return;
        host.style.setProperty(
            "--conversation-context-reserve",
            `${CONTEXT_PANEL_WIDTH_PX + 44}px`,
        );
        const measure = () => {
            const bounds = host.getBoundingClientRect();
            if (!bounds.width || !bounds.height) return;
            const headerHeight =
                host
                    .querySelector('[data-slot="conversation-header"]')
                    ?.getBoundingClientRect().height ?? 0;
            setFrame({
                left: bounds.left,
                top: bounds.top + headerHeight,
                width: bounds.width,
                height: bounds.height - headerHeight,
            });
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(host);
        window.addEventListener("resize", measure);
        window.addEventListener("scroll", measure, true);
        return () => {
            observer.disconnect();
            host.style.removeProperty("--conversation-context-reserve");
            window.removeEventListener("resize", measure);
            window.removeEventListener("scroll", measure, true);
        };
    }, []);
    const side = frame ? frame.width >= CONTEXT_SIDE_MIN_WIDTH_PX : !isMobile;
    const work = currentWork(activities, missions);
    return (
        <Popover
            open={open && visible}
            onOpenChange={(next, details) => {
                if (
                    side &&
                    (details.reason === "outside-press" ||
                        details.reason === "focus-out")
                ) {
                    details.cancel();
                    return;
                }
                setOpen(next);
            }}
            modal={false}>
            <PopoverTrigger
                ref={triggerRef}
                data-context-layout={side ? "side" : "popover"}
                render={<Button variant="ghost" size="icon-sm" />}
                aria-label="Research context"
                title="Research context"
                data-slot="conversation-context-trigger">
                <Icon iconNode={Task01Icon} size={19} />
            </PopoverTrigger>
            <PopoverContent
                layer={side ? "context" : "popup"}
                side="bottom"
                align="end"
                sideOffset={10}
                className="chat-context-card"
                initialFocus={false}
                data-context-layout={side ? "side" : "popover"}
                style={
                    frame
                        ? ({
                              "--context-card-max-height": `${Math.max(0, frame.height - 24)}px`,
                          } as CSSProperties)
                        : undefined
                }
                positionerStyle={
                    side && frame
                        ? {
                              position: "fixed",
                              left:
                                  frame.left +
                                  frame.width -
                                  CONTEXT_PANEL_WIDTH_PX -
                                  12,
                              top: frame.top + 12,
                              width: CONTEXT_PANEL_WIDTH_PX,
                              transform: "none",
                              margin: 0,
                          }
                        : undefined
                }>
                <div className="chat-context-topline">
                    {icon ?? <Icon iconNode={Task01Icon} size={16} />}
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
                    Current research scope, program, sources and work in
                    progress.
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
                        <section aria-label="Scope">
                            <header className="chat-context-section-heading">
                                <h2>Scope</h2>
                                {scopeAction}
                                {onChangeScope && (
                                    <Button
                                        variant="ghost"
                                        size="xs"
                                        onClick={() => {
                                            onChangeScope();
                                            if (!side) setOpen(false);
                                        }}>
                                        Change scope
                                    </Button>
                                )}
                            </header>
                            <ContextScope>{scope}</ContextScope>
                        </section>
                        <section aria-label={programTitle}>
                            <header className="chat-context-section-heading">
                                <h2>{programTitle}</h2>
                                <span>
                                    {questions.length}{" "}
                                    {questions.length === 1
                                        ? "question"
                                        : "questions"}
                                </span>
                            </header>
                            {questions.length > 0 && (
                                <p className="chat-context-program">
                                    {questions.join(" · ")}
                                </p>
                            )}
                        </section>
                        {outputs && (
                            <section aria-label="Outputs">
                                <header className="chat-context-section-heading">
                                    <h2>Outputs</h2>
                                </header>
                                {outputs}
                            </section>
                        )}
                        <Collapsible
                            render={<section aria-label="Sources" />}
                            className="chat-context-sources">
                            <header className="chat-context-section-heading">
                                <h2>Sources</h2>
                                <CollapsibleTrigger
                                    render={
                                        <Button variant="ghost" size="xs" />
                                    }
                                    aria-label="Show sources">
                                    {sourcesSummary ?? "Show"}
                                    <Icon
                                        iconNode={ArrowDown01Icon}
                                        size={12}
                                    />
                                </CollapsibleTrigger>
                            </header>
                            <CollapsibleContent className="chat-context-source-panel">
                                {sources}
                            </CollapsibleContent>
                        </Collapsible>
                        {work && (
                            <section aria-label="Work">
                                <header className="chat-context-section-heading">
                                    <h2>Work</h2>
                                </header>
                                <div
                                    className="chat-context-status"
                                    data-state={work.state}
                                    role="status">
                                    <ConversationWorkMark state={work.state} />
                                    <span>{work.title}</span>
                                    <small>{work.label}</small>
                                </div>
                            </section>
                        )}
                    </div>
                </ScrollArea>
            </PopoverContent>
        </Popover>
    );
}
