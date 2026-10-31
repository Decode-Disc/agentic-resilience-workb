import type { AssistantRuntime } from "@assistant-ui/react";
import {
    ArrowLeft01Icon,
    ArrowRight01Icon,
    File01Icon,
    PencilEdit01Icon,
    PlusSignIcon,
} from "@hugeicons/core-free-icons";
import {
    type ComponentProps,
    type ReactNode,
    useEffect,
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
    MessageFooter,
} from "@/components/chat/message";
import { ConversationPendingPanel } from "@/components/chat/workbench-conversation";
import Icon from "@/components/icon";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
    responseText,
    responseCreatedAt,
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
    responseText?: string;
    responseCreatedAt?: string;
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
                                <MessageFooter
                                    createdAt={responseCreatedAt}
                                    text={responseText}
                                />
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
    error,
}: {
    collapsible?: boolean;
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
    const previousClarification = useRef(Boolean(clarification));
    useEffect(() => {
        if (previousClarification.current && !clarification)
            summaryRef.current?.focus();
        previousClarification.current = Boolean(clarification);
    }, [clarification]);
    const [selected, setSelected] = useState(questions[0]?.id);
    const current = questions.find((q) => q.id === selected) ?? questions[0];
    const busy = pending || actionActive;
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
                    <div className="chat-question-navigation">
                        <fieldset
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
                                <Icon iconNode={ArrowLeft01Icon} size={17} />
                            </Button>
                            <span>
                                {current ? questions.indexOf(current) + 1 : 0}{" "}
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
                                <Icon iconNode={ArrowRight01Icon} size={17} />
                            </Button>
                        </fieldset>
                    </div>
                    {current ? (
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
                    ) : (
                        <p>
                            No questions yet. Add a research question to begin.
                        </p>
                    )}
                    {error && <p role="alert">{error}</p>}
                </>
            )}
        </div>
    );
    const footer = !clarification &&
        (onStart || onEditRequest || onAddRequest) && (
            <div className={styles.framingLaunch}>
                <div hidden={actionActive} className="chat-question-actions">
                    {current && onEditRequest && (
                        <Button
                            variant="ghost"
                            size="sm"
                            disabled={busy}
                            onClick={() => onEditRequest(current)}>
                            <Icon iconNode={PencilEdit01Icon} size={16} />
                            Edit question
                        </Button>
                    )}
                    {onAddRequest && (
                        <Button
                            variant="ghost"
                            size="sm"
                            disabled={busy}
                            onClick={onAddRequest}>
                            <Icon iconNode={PlusSignIcon} size={16} />
                            Add research question
                        </Button>
                    )}
                </div>
                <p className={actionActive ? undefined : "sr-only"}>
                    {actionActive
                        ? "Save or cancel your draft before starting research."
                        : "Research starts only when you choose."}
                </p>
                {onStart && (
                    <Button variant="launch" disabled={busy} onClick={onStart}>
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
        <section aria-label="Proposed framing">
            {collapsible ? (
                <ConversationPendingPanel
                    title={
                        clarification
                            ? "Clarify the scope"
                            : "Proposed research program"
                    }
                    summary={
                        clarification
                            ? "Research boundary"
                            : `${questions.length} questions`
                    }
                    footer={footer}
                    composer={composer}>
                    {body}
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
