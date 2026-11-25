import type { AssistantRuntime } from "@assistant-ui/react";
import {
    AiChat02Icon,
    ArrowLeft01Icon,
    ArrowRight01Icon,
    Cancel01Icon,
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
    Dialog as LinearDialog,
    DialogClose as LinearDialogClose,
    DialogContainer as LinearDialogContainer,
    DialogContent as LinearDialogContent,
    DialogTitle as LinearDialogTitle,
    DialogTrigger as LinearDialogTrigger,
} from "@/components/ui/linear-modal";
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
import { Textarea } from "@/components/ui/textarea";
import { GlassPanel } from "@/components/workbench-ui/glass-panel";
import { WorkbenchIcon } from "@/components/workbench-ui/glyphs";
import {
    listExitTransition,
    listTransition,
} from "@/components/workbench-ui/motion";
import { useMediaQuery } from "@/hooks/use-responsive";
import type {
    DossierStage,
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
    const [followingEnabled, setFollowingEnabled] = useState(false);
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
        setFollowingEnabled(false);
        let frame: number | undefined;
        // A kept-mounted sheet has no scrolling geometry until it becomes visible.
        const restore = () => {
            if (viewport.clientHeight === 0) return;
            observer.disconnect();
            frame = requestAnimationFrame(() => {
                viewport.scrollTop = offset ?? viewport.scrollHeight;
                // Synchronize native following before enabling growth on the remounted viewport.
                viewport.dispatchEvent(new Event("scroll"));
                restoringScroll.current = false;
                setFollowingEnabled(true);
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
                <ConversationThreadLog
                    scrollToBottomOnInitialize={false}
                    autoScroll={followingEnabled}>
                    {children}
                </ConversationThreadLog>
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
    overview,
    heading,
    notice,
    summary,
    stages,
    lanes,
    result,
    history,
    limitations,
    handoff,
    resting = false,
}: {
    context?: ReactNode;
    runtime: AssistantRuntime;
    conversation: ReactNode;
    conversationComposer?: ReactNode;
    /** The dossier's question and stages, above the current stage's detail. */
    overview?: ReactNode;
    heading: ReactNode;
    notice?: ReactNode;
    summary?: ReactNode;
    stages?: ReactNode;
    lanes: ReactNode;
    /** The current stage's handed-off result; it takes the place of the collection lanes. */
    result?: ReactNode;
    /** The dossier's recorded steps, after the current stage. */
    history?: ReactNode;
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
                // The sheet keeps focus on its trigger; the open effect delivers this reveal.
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
    // The kept-mounted sheet keeps focus on its trigger, so the pending reveal is delivered once the conversation is open.
    useEffect(() => {
        // A reveal belongs to the compact sheet: leaving that layout drops it, as does closing.
        if (!compact || !conversationOpen) {
            pendingReveal.current = null;
            return;
        }
        const elementId = pendingReveal.current;
        if (!elementId) return;
        let frame = 0;
        let attempts = 0;
        let abandoned = false;
        const abandon = () => {
            abandoned = true;
            pendingReveal.current = null;
            cancelAnimationFrame(frame);
        };
        const deliver = () => {
            if (abandoned) return;
            const target = revealTarget(elementId);
            if (target && document.activeElement !== target)
                target.focus({ preventScroll: true });
            if (target && document.activeElement === target) {
                pendingReveal.current = null;
                target.scrollIntoView?.({ block: "center" });
                drawAttention(elementId);
                return;
            }
            if (attempts++ < 30) {
                frame = requestAnimationFrame(deliver);
                return;
            }
            // Never leave a stale reveal to replay on a later, unrelated opening.
            pendingReveal.current = null;
        };
        frame = requestAnimationFrame(deliver);
        // A deliberate pointer or key action outranks a still-pending reveal.
        document.addEventListener("pointerdown", abandon, true);
        document.addEventListener("keydown", abandon, true);
        return () => {
            cancelAnimationFrame(frame);
            document.removeEventListener("pointerdown", abandon, true);
            document.removeEventListener("keydown", abandon, true);
        };
    }, [compact, conversationOpen]);
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
                                {overview}
                                <header
                                    className={
                                        handoff ? styles.muted : undefined
                                    }>
                                    {heading}
                                </header>
                                {notice}
                                {!result && (
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
                                )}
                                {result ? (
                                    <div className={styles.stageResult}>
                                        {result}
                                    </div>
                                ) : (
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
                                )}
                                {handoff && (
                                    <div className={styles.handoff}>
                                        {handoff}
                                    </div>
                                )}
                                {history}
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
                                    return elementId
                                        ? (revealTarget(elementId) ?? true)
                                        : true;
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
/** Wording longer than this can exceed the two lines a phone shows before Read more. */
const CLAMPED_QUESTION_CHARACTERS = 70;
/** Question count against the documentary limit; the meter repeats the count visually. */
function ProgramCount({ count, limit }: { count: number; limit?: number }) {
    if (!limit)
        return (
            <span>{`${count} ${count === 1 ? "question" : "questions"}`}</span>
        );
    return (
        <>
            <span className={styles.programMeter} aria-hidden="true">
                {Array.from({ length: limit }, (_, index) => (
                    <span
                        // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional and never reorder.
                        key={index}
                        data-filled={index < count || undefined}
                    />
                ))}
            </span>
            <span className={styles.programCountFull}>
                {`${count} of ${limit} questions`}
            </span>
            <span className={styles.programCountShort} aria-hidden="true">
                {`${count}/${limit}`}
            </span>
        </>
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
    editing,
    onEditChange,
    onEditCancel,
    onEditSave,
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
    /** Opens the question's inline editor; the caller then supplies `editing`. */
    onEditRequest?: (question: StartFramingQuestion) => void;
    /** The question edited in place. The caller owns the draft so it survives recoverable failures. */
    editing?: {
        questionId: string;
        text: string;
        pending?: boolean;
        error?: string;
    };
    onEditChange?: (text: string) => void;
    onEditCancel?: () => void;
    onEditSave?: () => void;
    onAddRequest?: () => void;
    actionActive?: boolean;
    selectedQuestionId?: string;
    onStart?: () => void;
    pending?: boolean;
    error?: string;
}) {
    const summaryRef = useRef<HTMLElement>(null);
    const [reviewing, setReviewing] = useState(true);
    const editingQuestion = editing
        ? questions.find((q) => q.id === editing.questionId)
        : undefined;
    const needsInput =
        Boolean(clarification) || actionActive || Boolean(editingQuestion);
    useEffect(() => {
        if (needsInput) setReviewing(true);
    }, [needsInput]);
    const limitNoteId = useId();
    const addNoteId = useId();
    const questionListId = useId();
    const previousClarification = useRef(Boolean(clarification));
    useEffect(() => {
        if (previousClarification.current && !clarification)
            summaryRef.current?.focus();
        previousClarification.current = Boolean(clarification);
    }, [clarification]);
    // Undefined opens the first question; null keeps every question folded.
    const [selected, setSelected] = useState<string | null>();
    const current =
        editingQuestion ??
        (selected === null
            ? undefined
            : (questions.find((q) => q.id === selected) ?? questions[0]));
    const hasQuestions = questions.length > 0;
    const busy = pending || actionActive;
    const [fullQuestionId, setFullQuestionId] = useState<string>();
    const editorRef = useRef<HTMLTextAreaElement>(null);
    const editButtonRef = useRef<HTMLButtonElement>(null);
    const editorErrorId = useId();
    const editingId = editingQuestion?.id;
    const previousEditingId = useRef(editingId);
    // Entering an edit moves focus into the field; leaving it returns focus to the Edit command.
    useEffect(() => {
        const editor = editorRef.current;
        if (editingId && editor) {
            editor.focus();
            editor.setSelectionRange(editor.value.length, editor.value.length);
        } else if (previousEditingId.current) editButtonRef.current?.focus();
        previousEditingId.current = editingId;
    }, [editingId]);
    const emptyProgram =
        collapsible &&
        Boolean(composer) &&
        !hasQuestions &&
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
                    {hasQuestions && !actionActive ? (
                        <ol
                            className="chat-question-list"
                            aria-label="Research questions">
                            {questions.map((q, index) => {
                                const open = q.id === current?.id;
                                const detailId = `${questionListId}-${q.id}`;
                                return (
                                    <li
                                        key={q.id}
                                        data-open={open || undefined}>
                                        <button
                                            type="button"
                                            className="chat-question-row"
                                            aria-expanded={open}
                                            aria-controls={
                                                open ? detailId : undefined
                                            }
                                            disabled={
                                                busy || Boolean(editingQuestion)
                                            }
                                            onClick={() =>
                                                setSelected(open ? null : q.id)
                                            }>
                                            <span className="chat-question-number">
                                                {index + 1}
                                            </span>{" "}
                                            <span className="chat-question-label">
                                                {q.shortLabel ?? q.label}
                                            </span>
                                            <Icon
                                                iconNode={ArrowRight01Icon}
                                                size={14}
                                            />
                                        </button>
                                        {open && (
                                            <section
                                                id={detailId}
                                                ref={summaryRef}
                                                tabIndex={-1}
                                                className="chat-focused-question"
                                                data-full={
                                                    fullQuestionId === q.id ||
                                                    undefined
                                                }
                                                aria-label="Framing summary">
                                                {editing &&
                                                editingQuestion?.id === q.id ? (
                                                    <form
                                                        className="chat-question-editor"
                                                        onSubmit={(event) => {
                                                            event.preventDefault();
                                                            onEditSave?.();
                                                        }}>
                                                        <Textarea
                                                            ref={editorRef}
                                                            aria-label="Edit research question"
                                                            value={editing.text}
                                                            disabled={
                                                                editing.pending
                                                            }
                                                            aria-invalid={
                                                                editing.error
                                                                    ? true
                                                                    : undefined
                                                            }
                                                            aria-describedby={
                                                                editing.error
                                                                    ? editorErrorId
                                                                    : undefined
                                                            }
                                                            onChange={(event) =>
                                                                onEditChange?.(
                                                                    event.target
                                                                        .value,
                                                                )
                                                            }
                                                            onKeyDown={(
                                                                event,
                                                            ) => {
                                                                if (
                                                                    event.key ===
                                                                    "Escape"
                                                                ) {
                                                                    event.preventDefault();
                                                                    onEditCancel?.();
                                                                } else if (
                                                                    event.key ===
                                                                        "Enter" &&
                                                                    !event.shiftKey &&
                                                                    !event
                                                                        .nativeEvent
                                                                        .isComposing
                                                                ) {
                                                                    event.preventDefault();
                                                                    event.currentTarget.form?.requestSubmit();
                                                                }
                                                            }}
                                                        />
                                                        {editing.error && (
                                                            <p
                                                                id={
                                                                    editorErrorId
                                                                }
                                                                role="alert">
                                                                {editing.error}
                                                            </p>
                                                        )}
                                                        <div className="chat-question-editor-actions">
                                                            <Button
                                                                type="button"
                                                                variant="ghost"
                                                                size="sm"
                                                                onClick={
                                                                    onEditCancel
                                                                }>
                                                                Cancel
                                                            </Button>
                                                            <Button
                                                                type="submit"
                                                                size="sm"
                                                                disabled={
                                                                    editing.pending ||
                                                                    !editing.text.trim() ||
                                                                    editing.text.trim() ===
                                                                        q.text
                                                                }>
                                                                Save question
                                                            </Button>
                                                        </div>
                                                    </form>
                                                ) : (
                                                    <>
                                                        <h3>{q.text}</h3>
                                                        {q.rationale && (
                                                            <p className="chat-question-rationale">
                                                                {q.rationale}
                                                            </p>
                                                        )}
                                                    </>
                                                )}
                                                <div className="chat-question-detail-actions">
                                                    {/* Narrow screens clamp the wording; this restores it with the rationale. */}
                                                    {(q.rationale ||
                                                        q.text.length >
                                                            CLAMPED_QUESTION_CHARACTERS) && (
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            className="chat-question-more"
                                                            hidden={
                                                                editingQuestion?.id ===
                                                                q.id
                                                            }
                                                            aria-expanded={
                                                                fullQuestionId ===
                                                                q.id
                                                            }
                                                            onClick={() =>
                                                                setFullQuestionId(
                                                                    fullQuestionId ===
                                                                        q.id
                                                                        ? undefined
                                                                        : q.id,
                                                                )
                                                            }>
                                                            {fullQuestionId ===
                                                            q.id
                                                                ? "Show less"
                                                                : "Read more"}
                                                        </Button>
                                                    )}
                                                    {onEditRequest && (
                                                        <Button
                                                            ref={editButtonRef}
                                                            variant="ghost"
                                                            size="sm"
                                                            className="chat-question-edit"
                                                            hidden={
                                                                editingQuestion?.id ===
                                                                q.id
                                                            }
                                                            disabled={busy}
                                                            onClick={() =>
                                                                onEditRequest(q)
                                                            }>
                                                            <Icon
                                                                iconNode={
                                                                    PencilEdit01Icon
                                                                }
                                                                size={15}
                                                            />
                                                            Edit question
                                                        </Button>
                                                    )}
                                                </div>
                                            </section>
                                        )}
                                    </li>
                                );
                            })}
                        </ol>
                    ) : !hasQuestions && !actionActive ? (
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
        (onStart || onAddRequest) && (
            <div
                hidden={actionActive}
                className={styles.framingLaunch}
                data-empty-program={!hasQuestions || undefined}>
                <div
                    hidden={
                        actionActive ||
                        (collapsible && !reviewing && hasQuestions)
                    }
                    className="chat-question-actions">
                    {onAddRequest && (
                        <Button
                            variant="ghost"
                            size="sm"
                            aria-label="Add research question"
                            title={
                                addUnavailableReason ?? "Add research question"
                            }
                            aria-describedby={
                                addUnavailableReason ? addNoteId : undefined
                            }
                            disabled={
                                busy ||
                                Boolean(editingQuestion) ||
                                Boolean(addUnavailableReason)
                            }
                            onClick={onAddRequest}>
                            <Icon iconNode={PlusSignIcon} size={16} />
                            <span
                                className={
                                    hasQuestions
                                        ? "hidden sm:inline"
                                        : undefined
                                }>
                                Add question
                            </span>
                        </Button>
                    )}
                </div>
                {addUnavailableReason && (
                    <p id={addNoteId} className="sr-only">
                        {addUnavailableReason}
                    </p>
                )}
                {startUnavailableReason ? (
                    <p id={limitNoteId} className={styles.framingLimitNote}>
                        {startUnavailableReason}
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
                            Boolean(editingQuestion) ||
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
                        clarification ? (
                            "Research boundary"
                        ) : emptyProgram ? (
                            "No questions yet"
                        ) : (
                            <ProgramCount
                                count={questions.length}
                                limit={questionLimit}
                            />
                        )
                    }
                    toggleLabels={
                        clarification
                            ? undefined
                            : {
                                  open: "Hide questions",
                                  closed: "Show questions",
                              }
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

/**
 * The dossier's framed scope and where it stands. The scope clamps to two lines;
 * Read framing opens the full scope and its questions in a dialog that morphs
 * from the control, so the stage stays where it was. The stepper keeps every
 * stage readable and scrolls the current one into view on narrow panels.
 */
export function StageOverview({
    question,
    questions = [],
    stages,
}: {
    question: string;
    questions?: readonly StartFramingQuestion[];
    stages: readonly DossierStage[];
}) {
    const stepperRef = useRef<HTMLOListElement>(null);
    const current = stages.find((stage) => stage.state === "current")?.key;
    useEffect(() => {
        const list = stepperRef.current;
        const step = current
            ? list?.querySelector<HTMLElement>(`[data-stage="${current}"]`)
            : null;
        if (!list || !step || list.scrollWidth <= list.clientWidth) return;
        list.scrollLeft =
            step.offsetLeft - (list.clientWidth - step.offsetWidth) / 2;
    }, [current]);
    return (
        <section className={styles.stageOverview} aria-label="Dossier stage">
            <h1 className={styles.stageQuestion}>{question}</h1>
            <div className={styles.stageMeta}>
                <span className={styles.stageLinks}>
                    {questions.length > 0 && (
                        <span>{`${questions.length} ${questions.length === 1 ? "question" : "questions"}`}</span>
                    )}
                    <FramingDialog scope={question} questions={questions} />
                </span>
                <ol
                    ref={stepperRef}
                    className={styles.stepper}
                    aria-label="Dossier stages">
                    {stages.map((stage) => (
                        <li
                            key={stage.key}
                            data-stage={stage.key}
                            data-state={stage.state}
                            aria-current={
                                stage.state === "current" ? "step" : undefined
                            }>
                            <span
                                className={styles.stepMark}
                                aria-hidden="true">
                                {stage.state === "done" && (
                                    <WorkbenchIcon
                                        name="check"
                                        size={10}
                                        strokeWidth={2.4}
                                    />
                                )}
                            </span>
                            <span>{stage.label}</span>
                            {stage.state === "unavailable" && (
                                <span className="sr-only">
                                    , not available yet
                                </span>
                            )}
                        </li>
                    ))}
                </ol>
            </div>
        </section>
    );
}

/** The accepted framing in full, read without leaving the stage panel. */
function FramingDialog({
    scope,
    questions,
}: {
    scope: string;
    questions: readonly StartFramingQuestion[];
}) {
    return (
        <LinearDialog>
            <LinearDialogTrigger className={styles.framingTrigger}>
                Read framing
            </LinearDialogTrigger>
            <LinearDialogContainer className={styles.framingPosition}>
                <LinearDialogContent className={styles.framingDialog}>
                    <div className={styles.framingTop}>
                        <LinearDialogTitle className={styles.framingTitle}>
                            Research framing
                        </LinearDialogTitle>
                        <LinearDialogClose
                            className={styles.framingClose}
                            aria-label="Close framing">
                            <Icon iconNode={Cancel01Icon} size={16} />
                        </LinearDialogClose>
                    </div>
                    <div className={styles.framingBody}>
                        <section aria-label="Scope">
                            <h3 className="wb-label">Scope</h3>
                            <p>{scope}</p>
                        </section>
                        {questions.length > 0 && (
                            <section aria-label="Research questions">
                                <h3 className="wb-label">
                                    {`${questions.length} ${questions.length === 1 ? "question" : "questions"}`}
                                </h3>
                                <ol className={styles.framingQuestions}>
                                    {questions.map((item) => (
                                        <li key={item.id}>
                                            <span
                                                className={
                                                    styles.framingQuestionLabel
                                                }>
                                                {item.label}
                                            </span>
                                            <span>
                                                {item.shortLabel && (
                                                    <b>{item.shortLabel}</b>
                                                )}
                                                <span>{item.text}</span>
                                            </span>
                                        </li>
                                    ))}
                                </ol>
                            </section>
                        )}
                    </div>
                </LinearDialogContent>
            </LinearDialogContainer>
        </LinearDialog>
    );
}

export function StartSourcesHeader({
    label,
    title,
    description,
    attribution,
    actions,
    detail,
    mark = "live",
    tone = "accent",
}: {
    /** The stage state, shown as one pill beside the stage title. */
    label?: string;
    /** The stage name. */
    title: string;
    /** Status summary or explanation shown directly under the title. */
    description?: ReactNode;
    /** Who produced the stage's work, after its explanation. */
    attribution?: ReactNode;
    /** Stage controls such as pause, resume, a pending decision or settlement. */
    actions?: ReactNode;
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
                    <div className={styles.sourceTitleRow}>
                        <h2>{title}</h2>
                        {label && (
                            <span className={styles.stateLabel}>
                                <SourcesStateGlyph mark={mark} />
                                <span>{label}</span>
                            </span>
                        )}
                    </div>
                    {description && (
                        <p className={styles.sourceDescription} role="status">
                            {description}
                        </p>
                    )}
                    {attribution}
                </motion.div>
            </AnimatePresence>
            {(actions || detail) && (
                <div className={styles.openProgress}>
                    {actions && (
                        <div className={styles.sourceActions}>{actions}</div>
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
