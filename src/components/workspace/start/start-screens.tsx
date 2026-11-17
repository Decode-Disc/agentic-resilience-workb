import type { AssistantRuntime } from "@assistant-ui/react";
import {
    AiChat02Icon,
    ArrowLeft01Icon,
    ArrowRight01Icon,
    PencilEdit01Icon,
    PlusSignIcon,
} from "@hugeicons/core-free-icons";
import { AnimatePresence, motion } from "motion/react";
import {
    createContext,
    type ReactNode,
    type RefObject,
    use,
    useCallback,
    useEffect,
    useId,
    useLayoutEffect,
    useRef,
    useState,
} from "react";
import type { GroupImperativeHandle, Layout } from "react-resizable-panels";
import { AgentIdentity } from "@/components/chat/agent-identity";
import {
    AgentQuestion,
    AgentQuestionDescription,
    AgentQuestionFooter,
    AgentQuestionItem,
    AgentQuestionOption,
    AgentQuestionOptions,
    AgentQuestionOther,
    AgentQuestionTitle,
} from "@/components/chat/agent-question";
import { SOURCES_AGENT } from "@/components/chat/conversation-agent";
import {
    ConversationThread,
    ConversationThreadDock,
    ConversationThreadLog,
} from "@/components/chat/conversation-thread";
import {
    Message,
    MessageBody,
    MessageContent,
    MessageFooter,
} from "@/components/chat/message";
import {
    ConversationHeader,
    ConversationPendingPanel,
} from "@/components/chat/workbench-conversation";
import Icon from "@/components/icon";
import { Button } from "@/components/ui/button";
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
    Empty,
    EmptyDescription,
    EmptyHeader,
    EmptyTitle,
} from "@/components/ui/empty";
import {
    ResizableHandle,
    ResizablePanel,
    ResizablePanelGroup,
} from "@/components/ui/resizable";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Sheet,
    SheetClose,
    SheetContent,
    SheetDescription,
    SheetTitle,
    SheetTrigger,
} from "@/components/ui/sheet";
import { GlassPanel } from "@/components/workbench-ui/glass-panel";
import { WorkbenchIcon } from "@/components/workbench-ui/glyphs";
import {
    listExitTransition,
    listTransition,
} from "@/components/workbench-ui/motion";
import { useMediaQuery } from "@/hooks/use-responsive";
import type {
    SourcesStateMark,
    SourcesStateTone,
} from "@/lib/presentation/sources";
import { cn } from "@/lib/utils";
import styles from "./start-screens.module.css";

export function StartRequestMessage({
    children,
    context,
    createdAt,
}: {
    children: ReactNode;
    context?: ReactNode;
    createdAt?: string;
}) {
    return (
        <div className={styles.messageGroup}>
            <Message from="user">
                <MessageBody>
                    <MessageContent>{children}</MessageContent>
                    <MessageFooter createdAt={createdAt} />
                </MessageBody>
            </Message>
            {context && <div className={styles.messageContext}>{context}</div>}
        </div>
    );
}
/** The pending action and composer stay anchored while only the message history scrolls. */
export function StartFramingScreen({
    identity,
    context,
    runtime,
    conversation,
    action,
    actionLabel = "Pending action",
    refinement,
    suggestions,
}: {
    identity?: ReactNode;
    context?: ReactNode;
    runtime: AssistantRuntime;
    conversation: ReactNode;
    action?: ReactNode;
    actionLabel?: string;
    refinement?: ReactNode;
    suggestions?: ReactNode;
}) {
    return (
        <section className={styles.framing} aria-label="Research framing">
            <ConversationThread
                runtime={runtime}
                header={
                    (identity || context) && (
                        <ConversationHeader
                            identity={identity}
                            context={context}
                        />
                    )
                }
                aria-label="Framing conversation">
                <ConversationThreadLog>{conversation}</ConversationThreadLog>
                <ConversationThreadDock className={styles.framingDock}>
                    {action && (
                        <section
                            aria-label={actionLabel}
                            className={styles.pendingAction}>
                            {action}
                        </section>
                    )}
                    {refinement}
                    {suggestions && (
                        <details className={styles.composerSuggestions}>
                            <summary>Suggestions</summary>
                            {suggestions}
                        </details>
                    )}
                </ConversationThreadDock>
            </ConversationThread>
        </section>
    );
}
function ResearchConversation({
    runtime,
    children,
    composer,
    header,
    visible,
    scrollPosition,
}: {
    runtime: AssistantRuntime;
    children: ReactNode;
    composer?: ReactNode;
    header: ReactNode;
    visible: boolean;
    scrollPosition: RefObject<number | null>;
}) {
    const container = useRef<HTMLElement>(null);
    const restoringScroll = useRef(false);
    useLayoutEffect(() => {
        if (!visible) {
            scrollPosition.current = null;
            return;
        }
        const viewport = container.current?.querySelector<HTMLElement>(
            '[data-slot="conversation-thread-log"]',
        );
        if (!viewport) return;
        const offset = scrollPosition.current;
        restoringScroll.current = true;
        let frame: number | undefined;
        // A kept-mounted sheet has no scrolling geometry until it becomes visible.
        const restore = () => {
            if (viewport.clientHeight === 0) return;
            observer.disconnect();
            frame = requestAnimationFrame(() => {
                viewport.scrollTop = offset ?? viewport.scrollHeight;
                restoringScroll.current = false;
            });
        };
        const observer = new ResizeObserver(restore);
        observer.observe(viewport);
        restore();
        return () => {
            observer.disconnect();
            if (frame !== undefined) cancelAnimationFrame(frame);
            restoringScroll.current = false;
        };
    }, [visible, scrollPosition]);
    return (
        <aside
            ref={container}
            className={styles.conversation}
            aria-label="Conversation"
            onScrollCapture={(event) => {
                const target = event.target;
                if (
                    visible &&
                    !restoringScroll.current &&
                    target instanceof HTMLElement &&
                    target.dataset.slot === "conversation-thread-log" &&
                    target.clientHeight > 0
                )
                    scrollPosition.current = target.scrollTop;
            }}>
            <ConversationThread
                runtime={runtime}
                variant="compact"
                visible={visible}
                header={header}
                aria-label="Research conversation">
                <ConversationThreadLog>{children}</ConversationThreadLog>
                {composer && (
                    <ConversationThreadDock
                        className={styles.conversationComposer}>
                        {composer}
                    </ConversationThreadDock>
                )}
            </ConversationThread>
        </aside>
    );
}

/** Conversation and documentary progress remain supplied independently of workflow state. */
const RevealInConversationContext = createContext<
    ((elementId: string) => void) | null
>(null);

let attentionTimer: number | undefined;

/** Replays the brief attention outline on a revealed element; each reveal restarts it. */
function drawAttention(elementId: string) {
    const element = document.getElementById(elementId);
    if (!element) return;
    window.clearTimeout(attentionTimer);
    element.removeAttribute("data-attention");
    // Reading layout restarts the CSS animation when the attribute returns.
    void element.offsetWidth;
    element.setAttribute("data-attention", "");
    attentionTimer = window.setTimeout(
        () => element.removeAttribute("data-attention"),
        2200,
    );
}

/** The control to focus when revealing an element: its first enabled button, or the element itself. */
function revealTarget(elementId: string): HTMLElement | null {
    const element = document.getElementById(elementId);
    return (
        element?.querySelector<HTMLElement>("button:not(:disabled)") ?? element
    );
}

function prefersReducedMotion() {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/** Brings an element of the research conversation into view and focus, opening the compact conversation first. */
export function useRevealInConversation() {
    return use(RevealInConversationContext);
}

export function StartResearchScreen({
    context,
    runtime,
    conversation,
    conversationComposer,
    heading,
    notice,
    summary,
    stages,
    lanes,
    limitations,
    handoff,
    resting = false,
}: {
    context?: ReactNode;
    runtime: AssistantRuntime;
    conversation: ReactNode;
    conversationComposer?: ReactNode;
    heading: ReactNode;
    notice?: ReactNode;
    summary?: ReactNode;
    stages?: ReactNode;
    lanes: ReactNode;
    limitations?: ReactNode;
    handoff?: ReactNode;
    /** Quiets the lanes while preparation is not working (paused, waiting or awaiting a decision). */
    resting?: boolean;
}) {
    const [conversationOpen, setConversationOpen] = useState(false);
    const compact = useMediaQuery("(width < 52rem)");
    const pendingReveal = useRef<string | null>(null);
    const reveal = useCallback(
        (elementId: string) => {
            if (compact) {
                // The sheet stays mounted; its opening focus lands on the target.
                pendingReveal.current = elementId;
                setConversationOpen(true);
                return;
            }
            const target = revealTarget(elementId);
            target?.scrollIntoView?.({
                block: "center",
                behavior: prefersReducedMotion() ? "auto" : "smooth",
            });
            target?.focus({ preventScroll: true });
            drawAttention(elementId);
        },
        [compact],
    );
    const conversationScroll = useRef<number | null>(null);
    const askAiRef = useRef<HTMLButtonElement>(null);
    const group = useRef<GroupImperativeHandle | null>(null);
    const id = useId();
    const conversationId = `${id}-conversation`;
    const progressId = `${id}-progress`;
    const desktopLayout = useRef<Layout>({
        [conversationId]: 40,
        [progressId]: 60,
    });
    useLayoutEffect(() => {
        group.current?.setLayout(
            compact
                ? { [conversationId]: 0, [progressId]: 100 }
                : desktopLayout.current,
        );
    }, [compact, conversationId, progressId]);
    const conversationPane = (
        <ResearchConversation
            runtime={runtime}
            composer={conversationComposer}
            scrollPosition={conversationScroll}
            visible={!compact || conversationOpen}
            header={
                <ConversationHeader
                    context={context}
                    leading={
                        compact ? (
                            <SheetClose
                                render={
                                    <Button variant="ghost" size="icon-lg" />
                                }
                                aria-label="Back to progress">
                                <Icon iconNode={ArrowLeft01Icon} size={18} />
                            </SheetClose>
                        ) : undefined
                    }
                />
            }>
            {conversation}
        </ResearchConversation>
    );
    return (
        <RevealInConversationContext value={reveal}>
            <section
                data-compact={compact}
                data-mobile-view={
                    conversationOpen ? "conversation" : "progress"
                }
                className={styles.research}
                aria-label="Research preparation">
                <Sheet
                    open={compact && conversationOpen}
                    onOpenChange={setConversationOpen}>
                    <ResizablePanelGroup
                        groupRef={group}
                        orientation="horizontal"
                        disabled={compact}
                        defaultLayout={desktopLayout.current}
                        onLayoutChanged={(layout, { isUserInteraction }) => {
                            if (!compact && isUserInteraction)
                                desktopLayout.current = layout;
                        }}
                        className={styles.researchPanels}>
                        <ResizablePanel
                            id={conversationId}
                            minSize={compact ? 0 : "22rem"}
                            maxSize={compact ? 0 : "100%"}
                            className={styles.researchPane}
                            style={{
                                display: compact ? "none" : undefined,
                                overflow: "hidden",
                            }}>
                            {!compact && conversationPane}
                        </ResizablePanel>
                        <ResizableHandle
                            withHandle
                            disabled={compact}
                            className={
                                compact ? styles.compactHandle : undefined
                            }
                            aria-label="Resize conversation and progress"
                        />
                        <ResizablePanel
                            id={progressId}
                            minSize={compact ? 0 : "26rem"}
                            className={styles.researchPane}
                            style={{ overflow: "hidden" }}>
                            <section
                                className={styles.progress}
                                aria-label="Documentary progress">
                                <header
                                    className={
                                        handoff ? styles.muted : undefined
                                    }>
                                    {heading}
                                </header>
                                {notice}
                                <GlassPanel className={styles.summaryPanel}>
                                    <div
                                        className={
                                            handoff
                                                ? `${styles.summaryOverview} ${styles.muted}`
                                                : styles.summaryOverview
                                        }>
                                        {summary}
                                        {stages && (
                                            <div className={styles.stages}>
                                                {stages}
                                            </div>
                                        )}
                                    </div>
                                    {limitations}
                                </GlassPanel>
                                <div
                                    className={
                                        handoff
                                            ? styles.completed
                                            : cn(
                                                  styles.lanes,
                                                  resting && styles.resting,
                                              )
                                    }>
                                    {lanes}
                                </div>
                                {handoff && (
                                    <div className={styles.handoff}>
                                        {handoff}
                                    </div>
                                )}
                            </section>
                        </ResizablePanel>
                    </ResizablePanelGroup>
                    {compact && (
                        <>
                            <SheetTrigger
                                render={
                                    <Button ref={askAiRef} variant="default" />
                                }
                                className={styles.askAi}>
                                <Icon iconNode={AiChat02Icon} size={19} />
                                Ask AI
                            </SheetTrigger>
                            <SheetContent
                                side="right"
                                keepMounted
                                showCloseButton={false}
                                finalFocus={askAiRef}
                                initialFocus={() => {
                                    const elementId = pendingReveal.current;
                                    pendingReveal.current = null;
                                    const target = elementId
                                        ? revealTarget(elementId)
                                        : null;
                                    target?.scrollIntoView?.({
                                        block: "center",
                                    });
                                    if (elementId) drawAttention(elementId);
                                    return target ?? true;
                                }}
                                className={styles.mobileConversation}>
                                <SheetTitle className="sr-only">
                                    Conversation
                                </SheetTitle>
                                <SheetDescription className="sr-only">
                                    Ask about the research and return to its
                                    progress.
                                </SheetDescription>
                                {conversationPane}
                            </SheetContent>
                        </>
                    )}
                </Sheet>
            </section>
        </RevealInConversationContext>
    );
}
export interface StartFramingQuestion {
    shortLabel?: string;
    id: string;
    label: string;
    text: string;
    rationale?: string;
}
export interface StartFramingContextQuestion {
    id: string;
    prompt: string;
    reason: string;
    choices: readonly { value: string; label: string; description?: string }[];
    proposedValue: string;
}
/** Collects a supplied scope clarification; the caller decides when it is useful and updates the framing. */
export function FramingClarification({
    question,
    onAnswer,
    pending = false,
    selection,
}: {
    selection?: { value: string; onChange: (value: string) => void };
    question: StartFramingContextQuestion;
    onAnswer: (answer: string) => void;
    pending?: boolean;
}) {
    return (
        <AgentQuestion
            key={question.id + question.proposedValue}
            aria-label="Clarify research context"
            status={pending ? "submitting" : "asking"}
            value={
                selection
                    ? { [question.id]: selection.value || "other" }
                    : undefined
            }
            onValueChange={
                selection
                    ? (answers) => {
                          const value = answers[question.id];
                          if (typeof value === "string")
                              selection.onChange(value);
                      }
                    : undefined
            }
            defaultValue={{
                [question.id]: question.choices.some(
                    (c) => c.value === question.proposedValue,
                )
                    ? question.proposedValue
                    : "other",
                [`${question.id}:other`]: question.proposedValue,
            }}
            onSubmit={(answers) => {
                const value =
                    answers[question.id] === "other"
                        ? answers[`${question.id}:other`]
                        : answers[question.id];
                if (typeof value === "string" && value.trim())
                    onAnswer(value.trim());
            }}>
            <AgentQuestionItem id={question.id} required>
                <AgentQuestionTitle>{question.prompt}</AgentQuestionTitle>
                <AgentQuestionDescription>
                    {question.reason}
                </AgentQuestionDescription>
                <AgentQuestionOptions>
                    {question.choices.map((choice) => (
                        <AgentQuestionOption
                            key={choice.value}
                            value={choice.value}
                            shortcutPosition="start"
                            label={choice.label}
                            description={
                                choice.value === question.proposedValue
                                    ? choice.description
                                        ? `Suggested · ${choice.description}`
                                        : "Suggested"
                                    : choice.description
                            }
                        />
                    ))}
                    {!selection && (
                        <AgentQuestionOther
                            label="Another activity or boundary"
                            placeholder="Describe the scope you have in mind…"
                        />
                    )}
                </AgentQuestionOptions>
            </AgentQuestionItem>
            {!selection && <AgentQuestionFooter />}
        </AgentQuestion>
    );
}
/** Separates the proposed research program from optional analyst context and corrections. */
export function FramingProposal({
    collapsible = false,
    title,
    introduction,
    scope,
    composer,
    questions,
    clarification,
    suppliedContext,
    onAdjustScope,
    onEditRequest,
    onAddRequest,
    actionActive = false,
    selectedQuestionId,
    onStart,
    pending = false,
    startDisabled = false,
    questionLimit,
    addUnavailableReason,
    startUnavailableReason,
    error,
}: {
    collapsible?: boolean;
    startDisabled?: boolean;
    /** Most questions the program can hold; shown beside the count. */
    questionLimit?: number;
    /** Disables adding a question and explains why. */
    addUnavailableReason?: string;
    /** Disables Start before any attempt and states the next step. */
    startUnavailableReason?: string;
    title?: string;
    introduction?: ReactNode;
    scope?: string;
    composer?: ReactNode;
    questions: readonly StartFramingQuestion[];
    clarification?: ReactNode;
    suppliedContext?: { question: string; answer: string };
    onAdjustScope?: () => void;
    onEditRequest?: (question: StartFramingQuestion) => void;
    onAddRequest?: () => void;
    actionActive?: boolean;
    selectedQuestionId?: string;
    onStart?: () => void;
    pending?: boolean;
    error?: string;
}) {
    const summaryRef = useRef<HTMLElement>(null);
    const [reviewing, setReviewing] = useState(!collapsible);
    const needsInput = Boolean(clarification) || actionActive;
    useEffect(() => {
        if (needsInput) setReviewing(true);
    }, [needsInput]);
    const limitNoteId = useId();
    const limitNote = startUnavailableReason ?? addUnavailableReason;
    const previousClarification = useRef(Boolean(clarification));
    useEffect(() => {
        if (previousClarification.current && !clarification)
            summaryRef.current?.focus();
        previousClarification.current = Boolean(clarification);
    }, [clarification]);
    const [selected, setSelected] = useState(questions[0]?.id);
    const current = questions.find((q) => q.id === selected) ?? questions[0];
    const busy = pending || actionActive;
    const emptyProgram =
        collapsible &&
        Boolean(composer) &&
        !current &&
        !clarification &&
        !actionActive &&
        !error;
    const body = (
        <div className={styles.framingProposal}>
            {introduction && <p>{introduction}</p>}
            {clarification ?? (
                <>
                    {scope && (
                        <section
                            className={styles.framingScope}
                            aria-label="Proposed research scope">
                            <p>{scope}</p>
                            {onAdjustScope && (
                                <Button
                                    variant="ghost"
                                    onClick={onAdjustScope}
                                    disabled={busy}>
                                    Adjust scope
                                </Button>
                            )}
                        </section>
                    )}
                    {suppliedContext && (
                        <section aria-label="Your clarification">
                            <details>
                                <summary>You clarified</summary>
                                <p>{suppliedContext.answer}</p>
                            </details>
                        </section>
                    )}
                    {current && !actionActive && (
                        <div className="chat-question-navigation">
                            <Select
                                value={current.id}
                                onValueChange={(value) => {
                                    if (value) setSelected(value);
                                }}
                                disabled={busy}>
                                <SelectTrigger
                                    aria-label="Research question"
                                    className="chat-question-selector">
                                    <SelectValue>
                                        {questions.indexOf(current) + 1} of{" "}
                                        {questions.length} ·{" "}
                                        {current.shortLabel ?? current.label}
                                    </SelectValue>
                                </SelectTrigger>
                                <SelectContent>
                                    {questions.map((q, index) => (
                                        <SelectItem key={q.id} value={q.id}>
                                            {index + 1}.{" "}
                                            {q.shortLabel ?? q.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    )}
                    {current && !actionActive ? (
                        <section
                            ref={summaryRef}
                            tabIndex={-1}
                            className="chat-focused-question"
                            aria-label="Framing summary">
                            <span className="chat-question-caption">
                                Research question
                            </span>
                            <h3>{current.text}</h3>
                            {current.rationale && (
                                <Collapsible
                                    key={current.id}
                                    className="chat-question-rationale">
                                    <CollapsibleTrigger
                                        render={
                                            <Button variant="ghost" size="xs" />
                                        }>
                                        Why this question?
                                    </CollapsibleTrigger>
                                    <CollapsibleContent>
                                        <p>{current.rationale}</p>
                                    </CollapsibleContent>
                                </Collapsible>
                            )}
                        </section>
                    ) : !current && !actionActive ? (
                        <Empty className="flex-none items-start gap-0 rounded-none px-3.5 py-3 text-left">
                            <EmptyHeader className="max-w-none items-start gap-1">
                                <EmptyTitle className="text-[13px]/[18px]">
                                    No research questions yet
                                </EmptyTitle>
                                <EmptyDescription className="text-xs/relaxed">
                                    {composer && onAddRequest
                                        ? "Refine the framing below, or add a question."
                                        : onAddRequest
                                          ? "Add a question to complete the research program."
                                          : "This program has no research questions."}
                                </EmptyDescription>
                            </EmptyHeader>
                        </Empty>
                    ) : null}
                    {error && <p role="alert">{error}</p>}
                </>
            )}
        </div>
    );
    const footer = !emptyProgram &&
        !clarification &&
        (onStart || onEditRequest || onAddRequest) && (
            <div
                hidden={actionActive}
                className={styles.framingLaunch}
                data-empty-program={!current || undefined}>
                <div
                    hidden={
                        actionActive || (collapsible && !reviewing && !!current)
                    }
                    className="chat-question-actions">
                    {current && onEditRequest && (
                        <Button
                            variant="ghost"
                            size="sm"
                            aria-label="Edit question"
                            title="Edit question"
                            disabled={busy}
                            onClick={() => onEditRequest(current)}>
                            <Icon iconNode={PencilEdit01Icon} size={16} />
                            <span className="hidden sm:inline">
                                Edit question
                            </span>
                        </Button>
                    )}
                    {onAddRequest && (
                        <Button
                            variant="ghost"
                            size="sm"
                            aria-label="Add research question"
                            title={
                                addUnavailableReason ?? "Add research question"
                            }
                            aria-describedby={
                                addUnavailableReason ? limitNoteId : undefined
                            }
                            disabled={busy || Boolean(addUnavailableReason)}
                            onClick={onAddRequest}>
                            <Icon iconNode={PlusSignIcon} size={16} />
                            <span
                                className={
                                    current ? "hidden sm:inline" : undefined
                                }>
                                Add research question
                            </span>
                        </Button>
                    )}
                </div>
                {limitNote ? (
                    <p id={limitNoteId} className={styles.framingLimitNote}>
                        {limitNote}
                    </p>
                ) : (
                    <p className="sr-only">
                        Research starts only when you choose.
                    </p>
                )}
                {onStart && (
                    <Button
                        variant="launch"
                        aria-describedby={
                            startUnavailableReason ? limitNoteId : undefined
                        }
                        disabled={
                            busy ||
                            startDisabled ||
                            Boolean(startUnavailableReason)
                        }
                        onClick={onStart}>
                        Start research
                        <Icon iconNode={ArrowRight01Icon} size={17} />
                    </Button>
                )}
            </div>
        );
    useEffect(() => {
        if (selectedQuestionId) setSelected(selectedQuestionId);
    }, [selectedQuestionId]);
    return (
        <section aria-label={title ?? "Proposed framing"}>
            {collapsible ? (
                <ConversationPendingPanel
                    open={reviewing}
                    onOpenChange={setReviewing}
                    title={
                        clarification
                            ? "Clarify the scope"
                            : (title ?? "Proposed research program")
                    }
                    summary={
                        clarification
                            ? "Research boundary"
                            : emptyProgram
                              ? "No questions yet"
                              : questionLimit
                                ? `${questions.length} of ${questionLimit} questions`
                                : `${questions.length} questions`
                    }
                    headerAction={
                        emptyProgram && onAddRequest ? (
                            <Button
                                variant="ghost"
                                size="sm"
                                aria-label="Add research question"
                                title="Add research question"
                                disabled={busy}
                                onClick={onAddRequest}>
                                <Icon iconNode={PlusSignIcon} size={16} />
                                <span className="hidden sm:inline">
                                    Add question
                                </span>
                                <span className="sm:hidden">Add</span>
                            </Button>
                        ) : undefined
                    }
                    footer={footer}
                    composer={composer}>
                    {emptyProgram ? null : body}
                </ConversationPendingPanel>
            ) : (
                <>
                    {body}
                    {footer}
                    {composer}
                </>
            )}
        </section>
    );
}
/** Source progress labels and numbers are supplied by the execution owner. */
export function StartSourceCounts({
    counts,
}: {
    counts: readonly { value: number; label: string; highlight?: boolean }[];
}) {
    return (
        <div className={styles.counts}>
            {counts.map((count) => (
                <div key={count.label}>
                    {/* A changed count rolls to its new value; the first render appears without motion. */}
                    <div className={styles.countValue}>
                        <AnimatePresence initial={false} mode="popLayout">
                            <motion.b
                                key={count.value}
                                className={
                                    count.highlight
                                        ? styles.highlight
                                        : undefined
                                }
                                initial={{ opacity: 0, y: "60%" }}
                                animate={{
                                    opacity: 1,
                                    y: 0,
                                    transition: listTransition,
                                }}
                                exit={{
                                    opacity: 0,
                                    y: "-60%",
                                    transition: listExitTransition,
                                }}>
                                {count.value}
                            </motion.b>
                        </AnimatePresence>
                    </div>
                    <span>{count.label}</span>
                </div>
            ))}
        </div>
    );
}
export function StartSourceStages({
    completedPercent,
    activePercent = 0,
    running = false,
}: {
    completedPercent: number;
    activePercent?: number;
    running?: boolean;
}) {
    return (
        <div className={styles.stageProgress}>
            <div className={styles.stageTrack} aria-hidden="true">
                <span style={{ width: `${completedPercent}%` }} />
                <span
                    className={
                        running ? `wb-sweep ${styles.stageSweep}` : undefined
                    }
                    style={{ width: `${activePercent}%` }}
                />
            </div>
            <div className={styles.stageLabels}>
                <span>Collect</span>
                <span>Read and check</span>
                <span>Organize</span>
            </div>
        </div>
    );
}
function SourcesStateGlyph({ mark }: { mark: SourcesStateMark }) {
    if (mark === "live")
        return <span className={cn("wb-live", styles.liveDot)} />;
    return <WorkbenchIcon name={mark} size={14} strokeWidth={2} />;
}

export function StartSourcesHeader({
    label,
    title,
    description,
    actions,
    onOpenProgress,
    detail,
    mark = "live",
    tone = "accent",
}: {
    label: string;
    title: string;
    /** Status summary or explanation shown directly under the title. */
    description?: ReactNode;
    /** Secondary controls (such as pause, resume or restart) grouped with the progress action. */
    actions?: ReactNode;
    /** Opens the dossier's activity log, the recorded timeline of research steps. */
    onOpenProgress?: () => void;
    detail?: string;
    mark?: SourcesStateMark;
    tone?: SourcesStateTone;
}) {
    return (
        <div className={styles.sourceHeading}>
            {/* A persisted state change hands over its label, glyph and copy together; the first render appears without motion. */}
            <AnimatePresence initial={false} mode="wait">
                <motion.div
                    key={`${mark}:${title}`}
                    className={styles.sourceTitles}
                    data-tone={tone}
                    initial={{ opacity: 0, y: 6, filter: "blur(2px)" }}
                    animate={{
                        opacity: 1,
                        y: 0,
                        filter: "blur(0px)",
                        transition: listTransition,
                    }}
                    exit={{
                        opacity: 0,
                        y: -4,
                        filter: "blur(2px)",
                        transition: listExitTransition,
                    }}>
                    <span className={styles.sourceLabel}>
                        <AgentIdentity agent={SOURCES_AGENT} />
                        <span className={styles.stateLabel}>
                            <SourcesStateGlyph mark={mark} />
                            <span>{label}</span>
                        </span>
                    </span>
                    <h1>{title}</h1>
                    {description && (
                        <p className={styles.sourceDescription} role="status">
                            {description}
                        </p>
                    )}
                </motion.div>
            </AnimatePresence>
            {(actions || onOpenProgress || detail) && (
                <div className={styles.openProgress}>
                    {(actions || onOpenProgress) && (
                        <div className={styles.sourceActions}>
                            {actions}
                            {onOpenProgress && (
                                <Button
                                    variant="launch"
                                    onClick={onOpenProgress}>
                                    View progress
                                    <WorkbenchIcon name="chevron" size={14} />
                                </Button>
                            )}
                        </div>
                    )}
                    {detail && <span>{detail}</span>}
                </div>
            )}
        </div>
    );
}

export {
    CompanyMandatePanel,
    StartAngleSuggestions,
    StartEntryScreen,
    StartShowcaseCard,
} from "./start-entry-screens";
