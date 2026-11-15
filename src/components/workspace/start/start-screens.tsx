import type { AssistantRuntime } from "@assistant-ui/react";
import {
    AiChat02Icon,
    ArrowLeft01Icon,
    ArrowRight01Icon,
    File01Icon,
    PencilEdit01Icon,
    PlusSignIcon,
} from "@hugeicons/core-free-icons";
import {
    type ReactNode,
    type RefObject,
    useEffect,
    useId,
    useLayoutEffect,
    useRef,
    useState,
} from "react";
import type { GroupImperativeHandle, Layout } from "react-resizable-panels";
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
    Sheet,
    SheetClose,
    SheetContent,
    SheetDescription,
    SheetTitle,
    SheetTrigger,
} from "@/components/ui/sheet";
import { GlassPanel } from "@/components/workbench-ui/glass-panel";
import { WorkbenchIcon } from "@/components/workbench-ui/glyphs";
import { useMediaQuery } from "@/hooks/use-responsive";
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
    scrollPosition: RefObject<number>;
}) {
    const container = useRef<HTMLElement>(null);
    const restoringScroll = useRef(false);
    useLayoutEffect(() => {
        if (!visible) return;
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
                viewport.scrollTop = offset;
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
}) {
    const [conversationOpen, setConversationOpen] = useState(false);
    const compact = useMediaQuery("(width < 52rem)");
    const conversationScroll = useRef(0);
    const askAiRef = useRef<HTMLButtonElement>(null);
    const group = useRef<GroupImperativeHandle | null>(null);
    const id = useId();
    const conversationId = `${id}-conversation`;
    const progressId = `${id}-progress`;
    const desktopLayout = useRef<Layout>({
        [progressId]: 60,
        [conversationId]: 40,
    });
    useLayoutEffect(() => {
        group.current?.setLayout(
            compact
                ? { [progressId]: 100, [conversationId]: 0 }
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
        <section
            data-compact={compact}
            data-mobile-view={conversationOpen ? "conversation" : "progress"}
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
                        id={progressId}
                        minSize={compact ? 0 : "26rem"}
                        className={styles.researchPane}
                        style={{ overflow: "hidden" }}>
                        <section
                            className={styles.progress}
                            aria-label="Documentary progress">
                            <header
                                className={handoff ? styles.muted : undefined}>
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
                                    <div className={styles.stages}>
                                        {stages}
                                    </div>
                                </div>
                                {limitations}
                            </GlassPanel>
                            <div
                                className={
                                    handoff ? styles.completed : styles.lanes
                                }>
                                {lanes}
                            </div>
                            {handoff && (
                                <div className={styles.handoff}>{handoff}</div>
                            )}
                        </section>
                    </ResizablePanel>
                    <ResizableHandle
                        withHandle
                        disabled={compact}
                        className={compact ? styles.compactHandle : undefined}
                        aria-label="Resize conversation and progress"
                    />
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
                </ResizablePanelGroup>
                {compact && (
                    <>
                        <SheetTrigger
                            render={<Button ref={askAiRef} variant="default" />}
                            className={styles.askAi}>
                            <Icon iconNode={AiChat02Icon} size={19} />
                            Ask AI
                        </SheetTrigger>
                        <SheetContent
                            side="right"
                            keepMounted
                            showCloseButton={false}
                            finalFocus={askAiRef}
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
    const topicsRef = useRef<HTMLFieldSetElement>(null);
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
    useLayoutEffect(() => {
        const topics = topicsRef.current;
        if (!topics || clarification || !current) return;
        const revealSelection = () => {
            const button = topics.querySelector<HTMLButtonElement>(
                '[aria-pressed="true"]',
            );
            if (!button) return;
            const strip = topics.getBoundingClientRect();
            const selectedTopic = button.getBoundingClientRect();
            const shift =
                selectedTopic.left < strip.left
                    ? selectedTopic.left - strip.left
                    : Math.max(0, selectedTopic.right - strip.right);
            topics.scrollLeft += shift;
        };
        revealSelection();
        const observer = new ResizeObserver(revealSelection);
        observer.observe(topics);
        return () => observer.disconnect();
    }, [current, clarification]);
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
                    {current && (
                        <div className="chat-question-navigation">
                            <fieldset
                                ref={topicsRef}
                                className="chat-question-topics"
                                aria-label="Research questions">
                                {questions.map((q) => (
                                    <Button
                                        key={q.id}
                                        variant="outline"
                                        aria-pressed={q.id === current?.id}
                                        disabled={busy}
                                        onClick={() => setSelected(q.id)}>
                                        <Icon iconNode={File01Icon} size={17} />
                                        {q.shortLabel ?? q.label}
                                    </Button>
                                ))}
                            </fieldset>
                            <fieldset
                                className="chat-question-pagination"
                                aria-label="Question navigation">
                                <Button
                                    variant="outline"
                                    size="icon"
                                    aria-label="Previous research question"
                                    disabled={
                                        busy ||
                                        !current ||
                                        questions.indexOf(current) === 0
                                    }
                                    onClick={() =>
                                        setSelected(
                                            questions[
                                                (current
                                                    ? questions.indexOf(current)
                                                    : 0) - 1
                                            ]?.id,
                                        )
                                    }>
                                    <Icon
                                        iconNode={ArrowLeft01Icon}
                                        size={17}
                                    />
                                </Button>
                                <span>
                                    {current
                                        ? questions.indexOf(current) + 1
                                        : 0}{" "}
                                    of {questions.length}
                                </span>
                                <Button
                                    variant="outline"
                                    size="icon"
                                    aria-label="Next research question"
                                    disabled={
                                        busy ||
                                        !current ||
                                        questions.indexOf(current) ===
                                            questions.length - 1
                                    }
                                    onClick={() =>
                                        setSelected(
                                            questions[
                                                (current
                                                    ? questions.indexOf(current)
                                                    : 0) + 1
                                            ]?.id,
                                        )
                                    }>
                                    <Icon
                                        iconNode={ArrowRight01Icon}
                                        size={17}
                                    />
                                </Button>
                            </fieldset>
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
                                <div className="chat-question-rationale">
                                    <span className="chat-question-caption">
                                        Rationale
                                    </span>
                                    <p>{current.rationale}</p>
                                </div>
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
        !actionActive &&
        !clarification &&
        (onStart || onEditRequest || onAddRequest) && (
            <div
                className={styles.framingLaunch}
                data-empty-program={!current || undefined}>
                <div hidden={actionActive} className="chat-question-actions">
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
                    <b
                        className={
                            count.highlight ? styles.highlight : undefined
                        }>
                        {count.value}
                    </b>
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
export function StartSourcesHeader({
    label,
    title,
    onOpenActivity,
    detail,
    running = false,
}: {
    label: string;
    title: string;
    /** Opens the dossier's activity log, the recorded timeline of research steps. */
    onOpenActivity?: () => void;
    detail?: string;
    running?: boolean;
}) {
    return (
        <div className={styles.sourceHeading}>
            <div>
                <span className={styles.sourceLabel}>
                    {running && (
                        <span className={styles.liveDot} aria-hidden="true" />
                    )}
                    {label}
                </span>
                <h1>{title}</h1>
            </div>
            {onOpenActivity && (
                <div className={styles.openProgress}>
                    <Button variant="launch" onClick={onOpenActivity}>
                        Activity log
                        <WorkbenchIcon name="chevron" size={14} />
                    </Button>
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
