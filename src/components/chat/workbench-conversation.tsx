import {
    ComposerPrimitive,
    MessagePrimitive,
    type ThreadMessageLike,
    ThreadPrimitive,
    useAui,
    useAuiState,
    useExternalStoreRuntime,
} from "@assistant-ui/react";
import { MarkdownTextPrimitive } from "@assistant-ui/react-markdown";
import {
    ArrowRight01Icon,
    ArrowUp02Icon,
    Cancel01Icon,
    File01Icon,
    Loading03Icon,
    Task01Icon,
    Tick02Icon,
} from "@hugeicons/core-free-icons";
import {
    type ReactNode,
    type Ref,
    useEffect,
    useId,
    useLayoutEffect,
    useRef,
    useState,
} from "react";
import remarkGfm from "remark-gfm";
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
import { Textarea } from "@/components/ui/textarea";
import { useResponsive } from "@/hooks/use-responsive";
import { cn } from "@/lib/utils";
import "./workbench-conversation.css";

/** Bridges externally owned history and drafts without dispatching client-side tools. */
export function useWorkbenchConversation({
    messages,
    draft,
    onDraftChange,
    onSend,
    isRunning = false,
}: {
    messages: readonly ThreadMessageLike[];
    draft: string;
    onDraftChange: (text: string) => void;
    onSend: (text: string) => void | Promise<void>;
    isRunning?: boolean;
}) {
    const syncingDraft = useRef(false);
    const currentDraft = useRef(draft);
    currentDraft.current = draft;
    const draftHandler = useRef(onDraftChange);
    draftHandler.current = onDraftChange;
    const [failed, setFailed] = useState(false);
    const [sending, setSending] = useState(false);
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
        isSendDisabled: sending,
        onNew: async (message) => {
            setSending(true);
            setFailed(false);
            const text = message.content
                .filter((part) => part.type === "text")
                .map((part) => part.text)
                .join("\n");
            try {
                await onSend(text);
            } catch {
                // Delivery failed; preserve a newer draft if the analyst already continued typing.
                if (!runtime.thread.composer.getState().text)
                    runtime.thread.composer.setText(text);
                setFailed(true);
            } finally {
                setSending(false);
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
    return { runtime, failed, sending };
}

/** The project's floating composer, with input and submission owned by assistant-ui. */
export function ConversationComposer({
    inputRef,
    label,
    compact = false,
    failed = false,
    actionLabel,
    onCancel,
    pending = false,
}: {
    inputRef?: Ref<HTMLTextAreaElement>;
    label: string;
    compact?: boolean;
    failed?: boolean;
    pending?: boolean;
    actionLabel?: string;
    onCancel?: () => void;
}) {
    const aui = useAui();
    const root = useRef<HTMLDivElement>(null);
    const [expanded, setExpanded] = useState(false);
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
    return (
        <div
            ref={root}
            onFocusCapture={() => setExpanded(true)}
            data-slot="conversation-composer"
            data-composer-action={actionLabel ? true : undefined}
            data-composer-expanded={expanded || Boolean(actionLabel) || failed}
            className="min-w-0 shrink-0">
            {failed && (
                <LoadErrorAlert
                    variant="inline"
                    title={
                        actionLabel
                            ? "Your changes could not be saved"
                            : "Your message could not be sent"
                    }
                    description="Your draft is still available. Try sending it again."
                    onRetry={() => aui.composer().send()}
                />
            )}
            {onCancel && (
                <div className="chat-composer-mode">
                    <span>{label}</span>
                    <Button
                        variant="ghost"
                        size="sm"
                        disabled={pending}
                        onClick={onCancel}>
                        Cancel
                    </Button>
                </div>
            )}
            <ComposerPrimitive.Root
                data-slot="prompt-composer"
                aria-label="Message the workbench">
                <div
                    data-slot="prompt-composer-card"
                    className="rounded-[14px] border bg-card p-1.5">
                    <div data-slot="composer-fields">
                        <ComposerPrimitive.Input
                            render={<Textarea />}
                            ref={inputRef}
                            data-slot="prompt-composer-input"
                            aria-label={label}
                            placeholder={label}
                            disabled={pending}
                            rows={1}
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
                        <div data-slot="composer-bottom">
                            <span>
                                Enter to send · Shift + Enter for a new line
                            </span>
                            <ComposerPrimitive.Send
                                render={<Button variant="round" size="icon" />}
                                aria-label={actionLabel ?? "Send refinement"}
                                data-slot="prompt-composer-submit"
                                className={cn(
                                    "disabled:opacity-100",
                                    compact
                                        ? "size-6 rounded-md"
                                        : actionLabel
                                          ? "h-10 w-auto px-4 rounded-full"
                                          : "size-10 rounded-full",
                                )}>
                                {actionLabel ?? (
                                    <Icon iconNode={ArrowUp02Icon} size={16} />
                                )}
                            </ComposerPrimitive.Send>
                        </div>
                    </div>
                </div>
            </ComposerPrimitive.Root>
        </div>
    );
}

function ConversationMessage() {
    const role = useAuiState((s) => s.message.role);
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
    return (
        <MessagePrimitive.Root
            render={<Message from={role} streaming={streaming} />}>
            <MessageBody>
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
export function ConversationMessages({ ids }: { ids?: readonly string[] }) {
    return (
        <ThreadPrimitive.Messages>
            {({ message }) =>
                !ids || ids.includes(message.id) ? (
                    <ConversationMessage />
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
}: {
    title: string;
    summary: string;
    children: ReactNode;
    footer?: ReactNode;
    composer?: ReactNode;
}) {
    return (
        <section data-slot="conversation-pending-panel">
            <details open data-slot="conversation-pending-details">
                <summary>
                    <span>{title}</span>
                    <span>{summary}</span>
                    <Icon iconNode={ArrowRight01Icon} size={14} />
                </summary>
                <div data-slot="conversation-pending-body">{children}</div>
            </details>
            {footer && (
                <div data-slot="conversation-pending-footer">{footer}</div>
            )}
            {composer}
        </section>
    );
}

/** Compact useful work in an assistant turn, with supporting detail disclosed in place. */
export function ConversationActivity({
    title,
    summary,
    state,
    children,
}: {
    title: string;
    summary: string;
    state: ConversationWorkItem["state"];
    children?: ReactNode;
}) {
    const id = useId();
    const row = (
        <>
            <Icon
                iconNode={
                    state === "running"
                        ? Loading03Icon
                        : state === "completed"
                          ? Tick02Icon
                          : Cancel01Icon
                }
                size={15}
                className={
                    state === "running" ? "chat-working-icon" : undefined
                }
            />
            <span>
                <span data-slot="activity-title">{title}</span>
                <span data-slot="activity-summary">{summary}</span>
            </span>
            <span data-slot="activity-state">{workStateLabels[state]}</span>
            {children && <Icon iconNode={ArrowRight01Icon} size={12} />}
        </>
    );
    return children ? (
        <Collapsible
            data-message-id={id}
            data-slot="conversation-activity"
            data-state={state}>
            <CollapsibleTrigger
                render={<Button variant="ghost" />}
                aria-label={`Inspect ${title}`}>
                {row}
            </CollapsibleTrigger>
            <CollapsibleContent>
                <div data-slot="activity-detail">{children}</div>
            </CollapsibleContent>
        </Collapsible>
    ) : (
        <div data-slot="conversation-activity" data-state={state}>
            <div className="chat-activity-row">{row}</div>
        </div>
    );
}

/** Keeps operations visible during a turn and folds the same retained work when that turn ends. */
export function ConversationActivityGroup({
    id,
    title,
    summary,
    state,
    activities,
    content,
    triggerLabel,
}: {
    id: string;
    title: string;
    summary: string;
    state: ConversationWorkItem["state"];
    activities: readonly ConversationWorkItem[];
    content?: ReactNode;
    triggerLabel?: string;
}) {
    const [expanded, setExpanded] = useState(false);
    const trigger = useRef<HTMLButtonElement>(null);
    const workHasFocus = useRef(false);
    const running = state === "running";
    useLayoutEffect(() => {
        if (!running && workHasFocus.current) trigger.current?.focus();
    }, [running]);
    if (!activities.length) return null;
    return (
        <Collapsible
            open={running || expanded}
            onOpenChange={setExpanded}
            role="region"
            aria-label={title}
            data-slot="conversation-work-group"
            data-message-id={id}
            data-state={state}>
            {!running && (
                <CollapsibleTrigger
                    ref={trigger}
                    render={<Button variant="ghost" />}
                    aria-label={
                        triggerLabel ?? `Inspect ${title.toLowerCase()}`
                    }>
                    <Icon iconNode={ArrowRight01Icon} size={13} />
                    <span className="chat-work-description">
                        <strong>{title}</strong>
                        <span>{summary}</span>
                    </span>
                    {state === "interrupted" && (
                        <span className="chat-work-limit">Interrupted</span>
                    )}
                </CollapsibleTrigger>
            )}
            <CollapsibleContent keepMounted>
                <div
                    className="chat-work-entries"
                    onFocusCapture={() => {
                        workHasFocus.current = true;
                    }}
                    onBlurCapture={(event) => {
                        workHasFocus.current = event.currentTarget.contains(
                            event.relatedTarget,
                        );
                    }}>
                    {content ??
                        activities.map((activity) => (
                            <ConversationActivity
                                key={activity.id}
                                title={activity.title}
                                summary={activity.summary}
                                state={activity.state}>
                                {activity.details}
                            </ConversationActivity>
                        ))}
                </div>
            </CollapsibleContent>
        </Collapsible>
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

export type ConversationWorkItem = {
    id: string;
    title: string;
    state: "running" | "completed" | "interrupted";
    summary: string;
    details?: ReactNode;
};
const workStateLabels = {
    running: "Working",
    completed: "Complete",
    interrupted: "Interrupted",
} as const;

/** Reflects supplied activity snapshots; it never schedules or simulates work. */
function ConversationWorkList({
    activities,
}: {
    activities: readonly ConversationWorkItem[];
}) {
    const working = activities.filter(
        (item) => item.state === "running",
    ).length;
    return (
        <section className="chat-context-work" aria-label="Work">
            <div className="chat-context-work-heading">
                <h2>Work</h2>
                <span role="status">
                    {working ? `${working} working` : "No active work"}
                </span>
            </div>
            {activities.length ? (
                <ul>
                    {activities.map((item) => (
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
            ) : (
                <p className="chat-context-empty">No work recorded yet.</p>
            )}
        </section>
    );
}

/** A header-anchored overview of the current plan, retained outputs and reference inputs. */
export function ConversationContext({
    title = "Research context",
    activities = [],
    plan,
    outputs,
    sources,
    onChangeScope,
}: {
    title?: string;
    activities?: readonly ConversationWorkItem[];
    plan: ReactNode;
    outputs: ReactNode;
    sources: ReactNode;
    onChangeScope?: () => void;
}) {
    const [open, setOpen] = useState(true);
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
                side="bottom"
                align="end"
                sideOffset={10}
                className="chat-context-card"
                initialFocus={false}>
                <div className="chat-context-topline">
                    <Icon iconNode={Task01Icon} size={16} />
                    <PopoverTitle>{title}</PopoverTitle>
                </div>
                <PopoverDescription className="sr-only">
                    Current plan, retained outputs and reference inputs.
                </PopoverDescription>
                <Button
                    variant="ghost"
                    size="icon-xs"
                    className="chat-context-close"
                    aria-label="Close research context"
                    onClick={() => setOpen(false)}>
                    <Icon iconNode={Cancel01Icon} size={14} />
                </Button>
                <section aria-label="Plan">
                    <h2>Plan</h2>
                    {plan}
                    {onChangeScope && (
                        <Button
                            variant="ghost"
                            size="sm"
                            className="chat-context-scope-action"
                            onClick={() => {
                                onChangeScope();
                                if (isMobile) setOpen(false);
                            }}>
                            Change scope
                        </Button>
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
                <ConversationWorkList activities={activities} />
            </PopoverContent>
        </Popover>
    );
}
