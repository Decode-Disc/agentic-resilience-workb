import {
    ActionBarPrimitive,
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
    Copy01Icon,
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
import {
    Message,
    MessageActions,
    MessageBody,
    MessageContent,
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
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@/components/ui/tooltip";
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
    const [failed, setFailed] = useState(false);
    const [sending, setSending] = useState(false);
    const runtime = useExternalStoreRuntime({
        messages,
        convertMessage: (message) => message,
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
        if (runtime.thread.composer.getState().text !== draft)
            runtime.thread.composer.setText(draft);
    }, [runtime, draft]);
    useEffect(
        () =>
            runtime.thread.composer.subscribe(() => {
                const next = runtime.thread.composer.getState().text;
                if (next !== draft) onDraftChange(next);
            }),
        [runtime, draft, onDraftChange],
    );
    return { runtime, failed };
}

/** The project's floating composer, with input and submission owned by assistant-ui. */
export function ConversationComposer({
    inputRef,
    label,
    compact = false,
    failed = false,
}: {
    inputRef?: Ref<HTMLTextAreaElement>;
    label: string;
    compact?: boolean;
    failed?: boolean;
}) {
    const aui = useAui();
    return (
        <div data-slot="conversation-composer" className="min-w-0 shrink-0">
            {failed && (
                <LoadErrorAlert
                    variant="inline"
                    title="Your message could not be sent"
                    description="Your draft is still available. Try sending it again."
                    onRetry={() => aui.composer().send()}
                />
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
                                aria-label="Send refinement"
                                data-slot="prompt-composer-submit"
                                className={cn(
                                    "disabled:opacity-100",
                                    compact
                                        ? "size-6 rounded-md"
                                        : "size-10 rounded-full",
                                )}>
                                <Icon iconNode={ArrowUp02Icon} size={16} />
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
    const copied = useAuiState((s) => s.message.isCopied);
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
                <MessageActions>
                    <Tooltip>
                        <TooltipTrigger
                            render={
                                <ActionBarPrimitive.Copy
                                    render={
                                        <Button
                                            variant="ghost"
                                            size="icon-xs"
                                        />
                                    }
                                    aria-label="Copy message"
                                />
                            }>
                            <Icon
                                iconNode={copied ? Tick02Icon : Copy01Icon}
                                size={14}
                            />
                        </TooltipTrigger>
                        <TooltipContent>
                            {copied ? "Copied" : "Copy message"}
                        </TooltipContent>
                    </Tooltip>
                    <span role="status" className="sr-only">
                        {copied ? "Copied to clipboard" : ""}
                    </span>
                </MessageActions>
            </MessageBody>
        </MessagePrimitive.Root>
    );
}

function ConversationMarkdown() {
    return (
        <MarkdownTextPrimitive
            smooth={false}
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
}: {
    title: string;
    summary: string;
    children: ReactNode;
    footer?: ReactNode;
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
            {footer}
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
            data-state={state}
            animated={false}>
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
}: {
    id: string;
    title: string;
    summary: string;
    state: ConversationWorkItem["state"];
    activities: readonly ConversationWorkItem[];
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
            animated={false}
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
                    aria-label={`Inspect ${title.toLowerCase()}`}>
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
                    {activities.map((activity) => (
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
        <Collapsible animated={false}>
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
}: {
    title?: string;
    activities?: readonly ConversationWorkItem[];
    plan: ReactNode;
    outputs: ReactNode;
    sources: ReactNode;
}) {
    const [open, setOpen] = useState(true);
    return (
        <Popover open={open} onOpenChange={setOpen} modal={false}>
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
