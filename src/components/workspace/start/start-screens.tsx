import { type ReactNode, useEffect, useId, useRef } from "react";
import { Button } from "@/components/ui/button";
import { WorkbenchIcon } from "@/components/workbench-ui/glyphs";
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
            <div className={styles.message}>{children}</div>
            {context && <div className={styles.messageContext}>{context}</div>}
        </div>
    );
}
/** A reading column with the reference's request bubble, framing card and refinement composer. */
export function StartFramingScreen({
    request,
    proposal,
    refinement,
}: {
    request: ReactNode;
    proposal: ReactNode;
    refinement?: ReactNode;
}) {
    return (
        <section className={styles.framing} aria-label="Research framing">
            <div className={styles.request}>{request}</div>
            {proposal}
            {refinement && (
                <div className={styles.refinement}>{refinement}</div>
            )}
        </section>
    );
}
/** Conversation and documentary progress remain supplied independently of workflow state. */
export function StartResearchScreen({
    conversation,
    conversationComposer,
    heading,
    summary,
    stages,
    lanes,
    limitations,
    handoff,
}: {
    conversation: ReactNode;
    conversationComposer?: ReactNode;
    heading: ReactNode;
    summary?: ReactNode;
    stages?: ReactNode;
    lanes: ReactNode;
    limitations?: ReactNode;
    handoff?: ReactNode;
}) {
    return (
        <section className={styles.research} aria-label="Research preparation">
            <aside className={styles.conversation} aria-label="Conversation">
                {conversation}
                {conversationComposer && (
                    <div className={styles.conversationComposer}>
                        {conversationComposer}
                    </div>
                )}
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
export interface StartCompanyIdentity {
    name: string;
    ticker: string;
    exchange: string;
    cik: string;
    website?: string;
    avatar?: ReactNode;
}
/** Displays supplied identity and mandate without resolving a company or authorizing work. */
export function CompanyMandatePanel({
    company,
    mandate,
    onChangeCompany,
    onConfirm,
    pending = false,
    error,
}: {
    company: StartCompanyIdentity;
    mandate: ReactNode;
    onChangeCompany?: () => void;
    onConfirm?: () => void;
    pending?: boolean;
    error?: string;
}) {
    return (
        <section
            className={styles.confirmation}
            aria-label="Confirm company and mandate">
            <div className={styles.identity}>
                {company.avatar}
                <div>
                    <span className={styles.identityLabel}>
                        Is this the company?
                    </span>
                    <h2>{company.name}</h2>
                </div>
            </div>
            <dl className={styles.metadata}>
                <div>
                    <dt>Ticker · exchange</dt>
                    <dd>
                        {company.ticker} · {company.exchange}
                    </dd>
                </div>
                <div>
                    <dt>SEC identity</dt>
                    <dd>CIK {company.cik}</dd>
                </div>
                <div>
                    <dt>Website</dt>
                    <dd>{company.website ?? "Not available"}</dd>
                </div>
            </dl>
            <div className={styles.mandate}>
                <span className={styles.label}>Mandate</span>
                <div>{mandate}</div>
            </div>
            {error && <p role="alert">{error}</p>}
            <div className={styles.actions}>
                <Button
                    variant="outline"
                    disabled={pending || !onChangeCompany}
                    onClick={onChangeCompany}>
                    Change company
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
        </section>
    );
}
export interface StartFramingQuestion {
    id: string;
    label: string;
    text: string;
}
/** Controlled framing fields; the caller owns the questions, mandate and launch authority. */
export function FramingProposal({
    introduction,
    activities,
    activity,
    onActivityChange,
    activityDetail,
    questions,
    onQuestionChange,
    onAddQuestion,
    focusQuestionId,
    optionalQuestion,
    onStart,
    pending = false,
    error,
}: {
    introduction: ReactNode;
    activities: readonly { id: string; label: string }[];
    activity: string;
    onActivityChange: (id: string) => void;
    activityDetail?: ReactNode;
    questions: readonly StartFramingQuestion[];
    onQuestionChange?: (id: string, text: string) => void;
    onAddQuestion?: () => void;
    focusQuestionId?: string;
    optionalQuestion?: ReactNode;
    onStart?: () => void;
    pending?: boolean;
    error?: string;
}) {
    const group = useId();
    const questionToFocus = useRef<HTMLTextAreaElement>(null);
    useEffect(() => {
        if (focusQuestionId) questionToFocus.current?.focus();
    }, [focusQuestionId]);
    return (
        <section className={styles.proposal} aria-label="Proposed framing">
            <div className={styles.who}>
                <span>{"//"}</span>Workbench
            </div>
            <div className={styles.introduction}>{introduction}</div>
            <div className={styles.framingCard}>
                <div className={styles.cardBody}>
                    <fieldset className={styles.activity}>
                        <legend>Activity</legend>
                        {activities.map((option) => (
                            <label key={option.id}>
                                <input
                                    type="radio"
                                    name={group}
                                    value={option.id}
                                    checked={activity === option.id}
                                    onChange={() => onActivityChange(option.id)}
                                    disabled={pending}
                                />
                                {activity === option.id && (
                                    <WorkbenchIcon name="check" size={12} />
                                )}{" "}
                                {option.label}
                            </label>
                        ))}
                    </fieldset>
                    {activityDetail}
                    <div>
                        <p className={styles.label}>Questions</p>
                        <ol className={styles.questions}>
                            {questions.map((q) => (
                                <li key={q.id}>
                                    <label>
                                        <span className={styles.questionNumber}>
                                            {q.label}
                                        </span>
                                        <textarea
                                            ref={
                                                q.id === focusQuestionId
                                                    ? questionToFocus
                                                    : undefined
                                            }
                                            rows={1}
                                            aria-label={`${q.label} research question`}
                                            value={q.text}
                                            readOnly={!onQuestionChange}
                                            disabled={pending}
                                            onChange={(e) =>
                                                onQuestionChange?.(
                                                    q.id,
                                                    e.target.value,
                                                )
                                            }
                                        />
                                        <span className={styles.edit}>
                                            <WorkbenchIcon
                                                name="edit"
                                                size={12}
                                            />
                                        </span>
                                    </label>
                                </li>
                            ))}
                        </ol>
                        <Button
                            variant="ghost"
                            className={styles.addQuestion}
                            onClick={onAddQuestion}
                            disabled={pending || !onAddQuestion}>
                            <span aria-hidden="true">+</span>Add a question ·
                            the common foundation is always included
                        </Button>
                    </div>
                    {error && <p role="alert">{error}</p>}
                </div>
                <div className={styles.launch}>
                    <p>
                        Nothing runs before you start. Primary sources first,
                        counter-evidence always sought, bounded effort.
                    </p>
                    <Button
                        variant="launch"
                        onClick={onStart}
                        disabled={pending || !onStart}>
                        {pending ? "Starting…" : "Start research"}
                        <WorkbenchIcon name="chevron" size={14} />
                    </Button>
                </div>
            </div>
            {optionalQuestion}
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
}: {
    scope?: string;
    questionCount?: number;
    onInspect?: () => void;
}) {
    return (
        <div className={styles.framingSummary}>
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
                <Button variant="ghost" onClick={onInspect}>
                    View framing
                </Button>
            )}
        </div>
    );
}
