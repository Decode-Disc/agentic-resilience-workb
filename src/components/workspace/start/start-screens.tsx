import type { AssistantRuntime } from "@assistant-ui/react";
import {
    type ComponentProps,
    type ReactNode,
    useEffect,
    useId,
    useRef,
    useState,
} from "react";
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
} from "@/components/chat/message";
import { ConversationPendingPanel } from "@/components/chat/workbench-conversation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { WorkbenchIcon } from "@/components/workbench-ui/glyphs";
import { CompanyResolutionCard } from "@/components/workspace/company-resolution-card";
import { StartDossierHeading } from "./start-dossier-heading";
import styles from "./start-screens.module.css";

/** Suggested angles are supplied by the caller, independently of company resolution. */
export function StartAngleSuggestions({
    angles,
    onSelect,
}: {
    angles: readonly { id: string; label: string }[];
    onSelect: (id: string) => void;
}) {
    return (
        <section
            className={styles.angles}
            aria-label="Suggested research angles">
            <span className={styles.label}>Try an angle</span>
            {angles.map((angle) => (
                <Button
                    variant="ghost"
                    key={angle.id}
                    onClick={() => onSelect(angle.id)}>
                    <WorkbenchIcon name="slashes" size={14} />
                    {angle.label}
                </Button>
            ))}
        </section>
    );
}
/** A single showcase action with the reference's identity, compact heading and metric footer. */
export function StartShowcaseCard({
    title,
    description,
    metrics,
    onOpen,
    avatar,
}: {
    title: string;
    description: string;
    metrics: readonly { value: string | number; label: string }[];
    onOpen: () => void;
    avatar?: ReactNode;
}) {
    return (
        <Button
            variant="ghost"
            className={styles.showcase}
            onClick={onOpen}
            aria-label={`Open showcase: ${title}`}>
            <span className={styles.showcaseHeader}>
                <span className={styles.curated}>Curated</span>
                <span className={styles.label}>Showcase dossier</span>
                <span className={styles.showcaseOpen}>
                    Open showcase
                    <WorkbenchIcon name="chevron" size={13} />
                </span>
            </span>
            <span className={styles.showcaseIdentity}>
                {avatar}
                <span>
                    <b>{title}</b>
                    <span className={styles.description}>{description}</span>
                </span>
            </span>
            <span className={styles.showcaseFooter}>
                {metrics.map((metric) => (
                    <span className={styles.stat} key={metric.label}>
                        <b>{metric.value}</b>
                        <span>{metric.label}</span>
                    </span>
                ))}
                <span className={styles.integrity}>
                    Illustrative analysis, clearly labelled
                </span>
            </span>
        </Button>
    );
}
/** The installed heading and composer form the entry surface; additional blocks remain composable. */
export function StartEntryScreen({
    composer,
    suggestions,
    showcase,
    title = "Start a research dossier",
}: {
    composer: ReactNode;
    suggestions?: ReactNode;
    showcase?: ReactNode;
    title?: string;
}) {
    return (
        <section className={styles.entry} aria-label={title}>
            <StartDossierHeading title={title} />
            <div className={`${styles.composer} @container/research-composer`}>
                {composer}
            </div>
            {suggestions}
            {showcase}
        </section>
    );
}
export function StartRequestMessage({
    children,
    context,
}: {
    children: ReactNode;
    context?: ReactNode;
}) {
    return (
        <div className={styles.messageGroup}>
            <Message from="user">
                <MessageBody>
                    <MessageContent>{children}</MessageContent>
                </MessageBody>
            </Message>
            {context && <div className={styles.messageContext}>{context}</div>}
        </div>
    );
}
function ConversationHeader({
    identity,
    context,
}: {
    identity?: ReactNode;
    context?: ReactNode;
}) {
    return (
        <header className={styles.conversationHeader}>
            <span className={styles.conversationBrand}>{"//"}</span>
            <span>Workbench</span>
            <div>{identity}</div>
            {context}
        </header>
    );
}
/** The pending action and composer stay anchored while only the message history scrolls. */
export function StartFramingScreen({
    identity,
    context,
    runtime,
    request,
    response,
    action,
    refinement,
    history,
    suggestions,
}: {
    identity?: ReactNode;
    context?: ReactNode;
    runtime: AssistantRuntime;
    request: ReactNode;
    response?: ReactNode;
    action?: ReactNode;
    refinement?: ReactNode;
    history?: ReactNode;
    suggestions?: ReactNode;
}) {
    return (
        <section className={styles.framing} aria-label="Research framing">
            {(identity || context) && (
                <ConversationHeader identity={identity} context={context} />
            )}
            <ConversationThread
                runtime={runtime}
                aria-label="Framing conversation">
                <ConversationThreadLog>
                    <div className={styles.request}>
                        <span className="sr-only">Your request</span>
                        {request}
                    </div>
                    {response && (
                        <Message from="assistant" variant="plain">
                            <MessageBody>
                                <MessageContent>{response}</MessageContent>
                            </MessageBody>
                        </Message>
                    )}
                    {history}
                </ConversationThreadLog>
                <ConversationThreadDock className={styles.framingDock}>
                    {action && (
                        <section
                            aria-label="Pending action"
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
/** Conversation and documentary progress remain supplied independently of workflow state. */
export function StartResearchScreen({
    context,
    runtime,
    conversation,
    conversationComposer,
    heading,
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
    summary?: ReactNode;
    stages?: ReactNode;
    lanes: ReactNode;
    limitations?: ReactNode;
    handoff?: ReactNode;
}) {
    const [view, setView] = useState("progress");
    return (
        <section
            data-mobile-view={view}
            className={styles.research}
            aria-label="Research preparation">
            <Tabs
                value={view}
                onValueChange={setView}
                className={styles.mobileTabs}>
                <TabsList aria-label="Research view">
                    <TabsTrigger value="conversation">Conversation</TabsTrigger>
                    <TabsTrigger value="progress">Progress</TabsTrigger>
                </TabsList>
            </Tabs>
            {context && <ConversationHeader context={context} />}
            <aside className={styles.conversation} aria-label="Conversation">
                <ConversationThread
                    runtime={runtime}
                    variant="compact"
                    aria-label="Research conversation">
                    <ConversationThreadLog>
                        {conversation}
                    </ConversationThreadLog>
                    {conversationComposer && (
                        <ConversationThreadDock
                            className={styles.conversationComposer}>
                            {conversationComposer}
                        </ConversationThreadDock>
                    )}
                </ConversationThread>
            </aside>
            <div className={styles.progress}>
                <header className={handoff ? styles.muted : undefined}>
                    {heading}
                </header>
                <div
                    className={
                        handoff
                            ? `${styles.summaryPanel} ${styles.muted}`
                            : styles.summaryPanel
                    }>
                    {summary}
                    <div className={styles.stages}>{stages}</div>
                </div>
                <div className={handoff ? styles.completed : styles.lanes}>
                    {lanes}
                </div>
                {limitations}
                {handoff && <div className={styles.handoff}>{handoff}</div>}
            </div>
        </section>
    );
}
/** Composes company confirmation and research context; the caller owns selection and launch. */
export function CompanyMandatePanel({
    company,
    mandate,
    coverage,
    onChangeCompany,
    onConfirm,
    pending = false,
    error,
}: {
    company: ComponentProps<typeof CompanyResolutionCard>["company"];
    mandate: ReactNode;
    coverage?: ReactNode;
    onChangeCompany?: () => void;
    onConfirm?: () => void;
    pending?: boolean;
    error?: string;
}) {
    return (
        <section
            className={styles.confirmation}
            aria-label="Confirm company and mandate">
            <div className={styles.confirmationIdentity}>
                <CompanyResolutionCard company={company} />
                {company.websiteUrl && (
                    <div className={styles.confirmationWebsite}>
                        <span>Website</span>
                        <a
                            href={company.websiteUrl}
                            target="_blank"
                            rel="noreferrer">
                            {company.websiteUrl
                                .replace(/^https?:\/\//, "")
                                .replace(/\/$/, "")}
                        </a>
                    </div>
                )}
            </div>
            {coverage}
            <div className={styles.mandate}>
                <span className={styles.label}>Mandate</span>
                <div>{mandate}</div>
            </div>
            {error && <p role="alert">{error}</p>}
            <div className={styles.actions}>
                <Button
                    variant="ghost"
                    disabled={pending || !onChangeCompany}
                    onClick={onChangeCompany}>
                    <WorkbenchIcon name="back" size={14} />
                    Back
                </Button>
                <Button
                    variant="launch"
                    disabled={pending || !onConfirm}
                    onClick={onConfirm}>
                    {pending
                        ? "Preparing framing…"
                        : "Confirm and propose framing"}
                    <WorkbenchIcon name="chevron" size={14} />
                </Button>
            </div>
            <p className={styles.confirmationNote}>
                Website details help recognition only. The legal identity comes
                from the SEC registration.
            </p>
        </section>
    );
}
export interface StartFramingQuestion {
    id: string;
    label: string;
    text: string;
    rationale?: string;
}
export interface StartFramingContextQuestion {
    id: string;
    prompt: string;
    reason: string;
    choices: readonly { value: string; label: string }[];
    proposedValue: string;
}
/** Collects a supplied scope clarification; the caller decides when it is useful and updates the framing. */
export function FramingClarification({
    question,
    onAnswer,
    onUseProposal,
    pending = false,
}: {
    question: StartFramingContextQuestion;
    onAnswer: (answer: string) => void;
    onUseProposal: () => void;
    pending?: boolean;
}) {
    return (
        <AgentQuestion
            key={question.id + question.proposedValue}
            aria-label="Clarify research context"
            status={pending ? "submitting" : "asking"}
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
                            recommended={
                                choice.value === question.proposedValue
                            }
                            label={choice.label}
                        />
                    ))}
                    <AgentQuestionOther
                        label="Another activity or boundary"
                        placeholder="Describe the scope you have in mind…"
                    />
                </AgentQuestionOptions>
            </AgentQuestionItem>
            <AgentQuestionFooter>
                <Button
                    variant="ghost"
                    disabled={pending}
                    onClick={onUseProposal}>
                    Use proposed scope
                </Button>
            </AgentQuestionFooter>
        </AgentQuestion>
    );
}
/** Separates the proposed research program from optional analyst context and corrections. */
export function FramingProposal({
    collapsible = false,
    introduction,
    scope,
    activity,
    questions,
    clarification,
    suppliedContext,
    onAdjustScope,
    onQuestionChange,
    onAddQuestion,
    onStart,
    pending = false,
    error,
}: {
    collapsible?: boolean;
    introduction?: ReactNode;
    scope: string;
    activity?: ReactNode;
    questions: readonly StartFramingQuestion[];
    clarification?: ReactNode;
    suppliedContext?: { question: string; answer: string };
    onAdjustScope?: () => void;
    onQuestionChange?: (id: string, text: string) => void;
    onAddQuestion?: (text: string) => void;
    onStart?: () => void;
    pending?: boolean;
    error?: string;
}) {
    const editId = useId();
    const [editing, setEditing] = useState<string | null>(null);
    const [draft, setDraft] = useState("");
    const editTrigger = useRef<HTMLButtonElement | null>(null);
    useEffect(() => {
        if (editing === null) editTrigger.current?.focus();
    }, [editing]);
    const summaryRef = useRef<HTMLElement>(null);
    const clarificationRef = useRef<HTMLDivElement>(null);
    const hasClarification = Boolean(clarification);
    const previousClarification = useRef(hasClarification);
    useEffect(() => {
        if (previousClarification.current !== hasClarification) {
            if (hasClarification)
                clarificationRef.current
                    ?.querySelector<HTMLElement>("legend")
                    ?.focus();
            else summaryRef.current?.focus();
        }
        previousClarification.current = hasClarification;
    }, [hasClarification]);
    const content = (
        <section
            className={styles.framingProposal}
            aria-label="Proposed framing">
            {introduction && (
                <>
                    <div className={styles.framingAuthor}>
                        <span>{"//"}</span>
                        <strong>Workbench</strong>
                    </div>
                    <p className={styles.framingIntroduction}>{introduction}</p>
                </>
            )}
            {clarification && <div ref={clarificationRef}>{clarification}</div>}
            {suppliedContext && (
                <section
                    className={styles.suppliedContext}
                    aria-label="Your clarification">
                    <details>
                        <summary>You clarified</summary>
                        <dl>
                            <dt>{suppliedContext.question}</dt>
                            <dd>{suppliedContext.answer}</dd>
                        </dl>
                    </details>
                </section>
            )}
            {!hasClarification && (
                <div className={styles.framingCard}>
                    <section
                        className={styles.framingScope}
                        aria-label="Proposed research scope">
                        <header>
                            <h2>Activity</h2>
                            {!activity && onAdjustScope && (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    disabled={pending || hasClarification}
                                    onClick={onAdjustScope}>
                                    Adjust scope
                                </Button>
                            )}
                        </header>
                        {activity ?? <p>{scope}</p>}
                    </section>
                    <section
                        className={styles.framingRecap}
                        aria-label="Framing summary"
                        tabIndex={-1}
                        ref={summaryRef}>
                        <header>
                            <h2>Questions</h2>
                            <span className="sr-only">
                                {questions.length} questions
                            </span>
                        </header>
                        <ol className={styles.framingQuestions}>
                            {questions.map((question) => (
                                <li key={question.id}>
                                    <span className={styles.framingQuestionId}>
                                        {question.label}
                                    </span>
                                    <div>
                                        {editing === question.id ? (
                                            <form
                                                className={
                                                    styles.questionCorrection
                                                }
                                                onSubmit={(event) => {
                                                    event.preventDefault();
                                                    if (!draft.trim()) return;
                                                    onQuestionChange?.(
                                                        question.id,
                                                        draft.trim(),
                                                    );
                                                    setEditing(null);
                                                    editTrigger.current?.focus();
                                                }}>
                                                <label htmlFor={editId}>
                                                    Edit {question.label}{" "}
                                                    wording
                                                    <Textarea
                                                        id={editId}
                                                        autoFocus
                                                        aria-label={`Edit ${question.label} wording`}
                                                        value={draft}
                                                        onChange={(event) =>
                                                            setDraft(
                                                                event.target
                                                                    .value,
                                                            )
                                                        }
                                                    />
                                                </label>
                                                <div>
                                                    <Button
                                                        size="sm"
                                                        type="submit"
                                                        disabled={
                                                            !draft.trim() ||
                                                            pending
                                                        }>
                                                        Save question
                                                    </Button>{" "}
                                                    <Button
                                                        size="sm"
                                                        variant="ghost"
                                                        type="button"
                                                        onClick={() => {
                                                            setEditing(null);
                                                            editTrigger.current?.focus();
                                                        }}>
                                                        Cancel
                                                    </Button>
                                                </div>
                                            </form>
                                        ) : question.rationale ? (
                                            <details
                                                className={
                                                    styles.questionReason
                                                }>
                                                <summary>
                                                    {question.text}
                                                </summary>
                                                <span>
                                                    {question.rationale}
                                                </span>
                                            </details>
                                        ) : (
                                            <p>{question.text}</p>
                                        )}
                                    </div>
                                    {onQuestionChange && (
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            aria-label={`Edit ${question.label}`}
                                            disabled={
                                                pending || editing !== null
                                            }
                                            onClick={(event) => {
                                                editTrigger.current =
                                                    event.currentTarget;
                                                setDraft(question.text);
                                                setEditing(question.id);
                                            }}>
                                            <WorkbenchIcon
                                                name="edit"
                                                size={13}
                                            />
                                        </Button>
                                    )}
                                </li>
                            ))}
                        </ol>
                    </section>
                    {onAddQuestion && (
                        <details className={styles.framingCorrections}>
                            <summary>
                                <span aria-hidden="true">+</span>
                                <span>Add a research question</span>
                            </summary>
                            <AdditionalFramingQuestion
                                onAddQuestion={onAddQuestion}
                                pending={pending || editing !== null}
                            />
                        </details>
                    )}
                    {editing && (
                        <p role="status">
                            Save or cancel your edit before starting research.
                        </p>
                    )}
                    {error && <p role="alert">{error}</p>}
                </div>
            )}
        </section>
    );
    const footer = onStart && (
        <div className={styles.framingLaunch}>
            <p>Research starts only when you choose.</p>
            <Button
                variant="launch"
                onClick={onStart}
                disabled={pending || !onStart || editing !== null}>
                Start research
                <WorkbenchIcon name="chevron" size={14} />
            </Button>
        </div>
    );
    return collapsible ? (
        <ConversationPendingPanel
            title={hasClarification ? "Your direction" : "Proposed research"}
            summary={
                hasClarification
                    ? "Research boundary"
                    : `${questions.length} questions`
            }
            footer={!hasClarification && footer}>
            {content}
        </ConversationPendingPanel>
    ) : (
        <>
            {content}
            {footer}
        </>
    );
}
function AdditionalFramingQuestion({
    onAddQuestion,
    pending,
}: {
    onAddQuestion: (text: string) => void;
    pending: boolean;
}) {
    const [text, setText] = useState("");
    const inputId = useId();
    return (
        <form
            className={styles.additionalQuestion}
            aria-label="Suggest a research question"
            onSubmit={(event) => {
                event.preventDefault();
                if (text.trim()) {
                    onAddQuestion(text.trim());
                    setText("");
                }
            }}>
            <label className={styles.additionalQuestionLabel} htmlFor={inputId}>
                Another question to investigate
            </label>
            <div>
                <Input
                    id={inputId}
                    aria-label="Another question to investigate"
                    placeholder="What else should the research examine?"
                    value={text}
                    onChange={(event) => setText(event.target.value)}
                    disabled={pending}
                />
                <Button
                    variant="outline"
                    type="submit"
                    disabled={pending || !text.trim()}>
                    Add to framing
                </Button>
            </div>
        </form>
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
                <span style={{ width: `${activePercent}%` }} />
                {running && (
                    <span className={`wb-sweep ${styles.stageSweep}`} />
                )}
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
    onOpenProgress,
    detail,
    running = false,
}: {
    label: string;
    title: string;
    onOpenProgress?: () => void;
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
            {onOpenProgress && (
                <div className={styles.openProgress}>
                    <Button variant="launch" onClick={onOpenProgress}>
                        Open Progress
                        <WorkbenchIcon name="chevron" size={14} />
                    </Button>
                    {detail && <span>{detail}</span>}
                </div>
            )}
        </div>
    );
}
export function StartFramingSummary({
    scope,
    questionCount,
    onInspect,
    expanded,
    detailsId,
}: {
    scope?: string;
    questionCount?: number;
    onInspect?: () => void;
    expanded?: boolean;
    detailsId?: string;
}) {
    return (
        <div
            className={styles.framingSummary}
            data-message-id="accepted-framing">
            <b>
                <WorkbenchIcon name="check" size={13} />
                Framing fixed
            </b>
            {(scope || questionCount !== undefined) && (
                <div>
                    {scope && <span>{scope}</span>}
                    {questionCount !== undefined && (
                        <span>{questionCount} questions</span>
                    )}
                </div>
            )}
            {onInspect && (
                <Button
                    variant="ghost"
                    onClick={onInspect}
                    aria-expanded={expanded}
                    aria-controls={detailsId}>
                    View framing
                </Button>
            )}
        </div>
    );
}
