import { MotionConfig, motion } from "motion/react";
import { type ReactNode, useId, useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import styles from "./documentary-needs.module.css";
import { ReadingGlyph, type ReadingState, WorkbenchIcon } from "./glyphs";
import { HelpTip } from "./help-tip";
import { listTransition, markerTransition } from "./motion";

/** Where documentary work on a need stands; never a judgment on the questions it serves. */
export type NeedOutcome =
    | "in_progress"
    | "on_hold"
    | "prepared"
    | "gap"
    | "unfinished";

export interface DocumentaryNeed {
    id: string;
    /** The information sought. */
    label: string;
    /** Ids of the questions this need serves; empty for common context. */
    questions: readonly string[];
    outcome: NeedOutcome;
    documents?: number;
    contributions?: number;
    /** A restriction or control result attached to the prepared material. */
    flag?: ReactNode;
    /** Why the need ended this way, in the analyst's terms. */
    detail?: ReactNode;
    action?: ReactNode;
    /** Documents serving this need; listed when the need is expanded. */
    sources?: readonly NeedSource[];
}

export interface NeedSource {
    id: string;
    title: string;
    meta: string;
    reading: ReadingState;
}

export interface NeedQuestion {
    id: string;
    label: string;
    question: string;
}

const outcomes: Record<NeedOutcome, { label: string; legend: string }> = {
    in_progress: { label: "In progress", legend: "Work under way" },
    on_hold: {
        label: "On hold",
        legend: "Work stopped until research resumes",
    },
    prepared: { label: "Prepared", legend: "Prepared material" },
    gap: { label: "Gap", legend: "Searched, nothing usable" },
    unfinished: { label: "Unfinished", legend: "Work not completed" },
};
const outcomeOrder: readonly NeedOutcome[] = [
    "in_progress",
    "on_hold",
    "prepared",
    "gap",
    "unfinished",
];

function countLabel(count: number, noun: string) {
    return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function needCount(relied: readonly DocumentaryNeed[]) {
    return [
        `${relied.length} documentary ${relied.length === 1 ? "need" : "needs"}`,
        ...outcomeOrder.flatMap((outcome) => {
            const count = relied.filter(
                (need) => need.outcome === outcome,
            ).length;
            return count
                ? [`${count} ${outcomes[outcome].label.toLowerCase()}`]
                : [];
        }),
    ].join(" · ");
}

/** The mark a need leaves in each question it serves; shape and colour both carry the outcome. */
export function NeedMark({ outcome }: { outcome: NeedOutcome }) {
    return (
        <span
            className={styles.mark}
            data-outcome={outcome}
            aria-hidden="true"
        />
    );
}

/** Explains one mark: the need, the question it serves and where the work ended. Opens on hover or tap. */
function MarkTip({
    need,
    question,
}: {
    need: DocumentaryNeed;
    question: NeedQuestion;
}) {
    const counts = [
        need.documents !== undefined && countLabel(need.documents, "document"),
        need.contributions !== undefined &&
            countLabel(need.contributions, "contribution"),
    ].filter(Boolean);
    const outcome = [outcomes[need.outcome].legend, ...counts].join(" · ");
    return (
        <HelpTip
            trigger={
                // Out of the tab order: the row header and outcome column already carry this for keyboard users.
                <button
                    type="button"
                    tabIndex={-1}
                    className={styles.markButton}
                    aria-label={`Serves ${question.label}: ${outcome}`}>
                    <NeedMark outcome={need.outcome} />
                </button>
            }>
            <span className={styles.tip}>
                <span>
                    Serves <b>{question.label}</b> · {question.question}
                </span>
                <span className={styles.tipOutcome}>
                    <NeedMark outcome={need.outcome} />
                    {outcome}
                </span>
            </span>
        </HelpTip>
    );
}

/** Long needs clamp to two lines; expanding shows the full text, its reason and the documents serving it. */
/** The need clamps to two lines; an explicit control shows the rest. */
function NeedLabel({ need }: { need: DocumentaryNeed }) {
    const [full, setFull] = useState(false);
    const long = need.label.length > 110;
    return (
        <>
            <span
                className={styles.needLabel}
                data-clamp={(long && !full) || undefined}>
                {need.label}
            </span>
            {long && (
                <button
                    type="button"
                    className={styles.moreToggle}
                    aria-expanded={full}
                    onClick={() => setFull(!full)}>
                    {full ? "Show less" : "Show full need"}
                </button>
            )}
            {need.detail && (
                <span className={styles.detail}>{need.detail}</span>
            )}
        </>
    );
}

/** Each count stays whole, so narrow cells wrap between counts rather than inside one. */
function Counts({ counts }: { counts: readonly string[] }) {
    return (
        <span className={styles.counts}>
            {counts.map((count, index) => (
                <span key={count}>
                    {count}
                    {index < counts.length - 1 && " ·"}
                </span>
            ))}
        </span>
    );
}

/** Where the need ended, with its documents behind an explicit toggle. */
function NeedOutcomeSummary({
    need,
    onOpenSource,
}: {
    need: DocumentaryNeed;
    onOpenSource?: (sourceId: string, needId: string) => void;
}) {
    if (need.outcome === "gap") return <Badge tone="review">Gap</Badge>;
    const badge =
        need.outcome === "in_progress" ? (
            <Badge tone="accent">In progress</Badge>
        ) : need.outcome === "on_hold" ? (
            <Badge tone="dashed">On hold</Badge>
        ) : need.outcome === "unfinished" ? (
            <Badge tone="dashed">Unfinished</Badge>
        ) : null;
    const showCounts =
        !badge || Boolean(need.documents) || Boolean(need.contributions);
    const counts = showCounts
        ? [
              need.documents !== undefined &&
                  countLabel(need.documents, "document"),
              need.contributions !== undefined &&
                  countLabel(need.contributions, "contribution"),
          ].filter((count): count is string => Boolean(count))
        : [];
    if (!counts.length && !need.flag && badge) return badge;
    const sources = need.sources ?? [];
    return (
        <span className={styles.prepared}>
            {sources.length > 0 ? (
                <Collapsible className={styles.documents}>
                    <span className={styles.documentsHead}>
                        <CollapsibleTrigger className={styles.documentsToggle}>
                            <WorkbenchIcon
                                name="chevron"
                                size={11}
                                strokeWidth={2}
                            />
                            <Counts counts={counts} />
                        </CollapsibleTrigger>
                        {need.flag}
                        {badge}
                    </span>
                    <CollapsibleContent>
                        <ul
                            className={styles.needSources}
                            aria-label="Documents for this need">
                            {sources.map((source) => (
                                <li key={source.id}>
                                    <button
                                        type="button"
                                        className={styles.needSource}
                                        disabled={!onOpenSource}
                                        onClick={() =>
                                            onOpenSource?.(source.id, need.id)
                                        }>
                                        <ReadingGlyph
                                            state={source.reading}
                                            size={12}
                                        />
                                        <span
                                            className={styles.needSourceTitle}>
                                            {source.title}
                                        </span>
                                        <span className="wb-meta">
                                            {source.meta}
                                        </span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </CollapsibleContent>
                </Collapsible>
            ) : (
                <>
                    {counts.length > 0 && (
                        <span className="wb-meta">
                            <Counts counts={counts} />
                        </span>
                    )}
                    {need.flag}
                    {badge}
                </>
            )}
        </span>
    );
}

/**
 * Documentary needs against the questions they serve. Selecting a question
 * brings the needs it relies on forward; Sources' outcomes stay per need and
 * never become a verdict on the question.
 */
export function DocumentaryNeeds({
    title = "Documentary needs",
    questions,
    needs,
    notice,
    onOpenSource,
}: {
    title?: string;
    questions: readonly NeedQuestion[];
    needs: readonly DocumentaryNeed[];
    /** A reason shared by several needs, shown once above the table instead of on every row. */
    notice?: ReactNode;
    /** Opens a document from an expanded need. */
    onOpenSource?: (sourceId: string, needId: string) => void;
}) {
    const headingId = useId();
    const markerId = useId();
    const [lens, setLens] = useState<string>();
    const [preview, setPreview] = useState<string>();
    const focus = preview ?? lens;
    const focused = questions.find((question) => question.id === focus);
    const serves = (need: DocumentaryNeed, id = focus) =>
        id !== undefined && need.questions.includes(id);
    const relied = focused
        ? needs.filter((need) => serves(need, focused.id))
        : [];
    const repeatsNeed =
        focused !== undefined &&
        relied.some((need) => need.label.trim() === focused.question.trim());
    // A pinned question brings its needs forward; a hover or focus preview only highlights.
    const ordered = lens
        ? [
              ...needs.filter((need) => serves(need, lens)),
              ...needs.filter((need) => !serves(need, lens)),
          ]
        : needs;

    return (
        <MotionConfig reducedMotion="user">
            <section
                className={cn("wb-glass wb-focal", styles.panel)}
                aria-labelledby={headingId}
                onKeyDown={(event) => {
                    if (event.key === "Escape" && lens) setLens(undefined);
                }}>
                <div className={styles.head}>
                    <h2 id={headingId}>{title}</h2>
                    <p
                        role="status"
                        className={styles.lens}
                        hidden={questions.length === 0}>
                        {!focused ? (
                            <span className={styles.lensLine} data-active>
                                <span className={styles.hint}>
                                    Select a question to see the needs it relies
                                    on.
                                </span>
                            </span>
                        ) : (
                            <span className={styles.lensLine} data-active>
                                <b>{focused.label}</b>
                                {!repeatsNeed && (
                                    <span>{focused.question}</span>
                                )}
                                <span className="wb-meta">
                                    {needCount(relied)}
                                </span>
                            </span>
                        )}
                    </p>
                </div>
                {notice && <p className={styles.notice}>{notice}</p>}
                <table className={styles.table} aria-labelledby={headingId}>
                    <colgroup>
                        <col className={styles.needCol} />
                        {questions.map((question) => (
                            <col
                                key={question.id}
                                className={styles.questionCol}
                            />
                        ))}
                        <col className={styles.outcomeCol} />
                    </colgroup>
                    <thead>
                        <tr>
                            <th scope="col" className={styles.needHead}>
                                <span className="wb-label">Need</span>
                            </th>
                            {questions.map((question, column) => (
                                <th
                                    key={question.id}
                                    scope="col"
                                    className={styles.questionHead}
                                    data-edge={
                                        column === questions.length - 1 ||
                                        undefined
                                    }
                                    data-lens={
                                        focus === question.id || undefined
                                    }
                                    onPointerEnter={(event) => {
                                        if (event.pointerType === "mouse")
                                            setPreview(question.id);
                                    }}
                                    onPointerLeave={() =>
                                        setPreview(undefined)
                                    }>
                                    <button
                                        type="button"
                                        className={styles.question}
                                        aria-label={`${question.label}: ${question.question}`}
                                        aria-pressed={lens === question.id}
                                        // Pointer focus must not move the button before its click completes.
                                        onFocus={(event) => {
                                            if (
                                                event.currentTarget.matches(
                                                    ":focus-visible",
                                                )
                                            )
                                                setPreview(question.id);
                                        }}
                                        onBlur={() => setPreview(undefined)}
                                        onClick={() =>
                                            setLens((current) =>
                                                current === question.id
                                                    ? undefined
                                                    : question.id,
                                            )
                                        }>
                                        {lens === question.id && (
                                            <motion.span
                                                layoutId={markerId}
                                                className={
                                                    styles.questionMarker
                                                }
                                                transition={markerTransition}
                                            />
                                        )}
                                        {question.label}
                                    </button>
                                </th>
                            ))}
                            <th scope="col" className={styles.outcomeHead}>
                                <span className="wb-label">Outcome</span>
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {ordered.map((need) => (
                            <motion.tr
                                key={need.id}
                                layout="position"
                                transition={listTransition}
                                className={styles.row}
                                data-dim={
                                    (focus !== undefined && !serves(need)) ||
                                    undefined
                                }>
                                <th scope="row" className={styles.need}>
                                    <NeedLabel need={need} />
                                    <span className={styles.inlineOutcome}>
                                        <NeedOutcomeSummary
                                            need={need}
                                            onOpenSource={onOpenSource}
                                        />
                                    </span>
                                    {need.action && (
                                        <span className={styles.action}>
                                            {need.action}
                                        </span>
                                    )}
                                </th>
                                {questions.length === 0 ? null : need.questions
                                      .length === 0 ? (
                                    <td
                                        colSpan={questions.length}
                                        className={styles.context}>
                                        <span className="wb-meta">
                                            Common context
                                        </span>
                                    </td>
                                ) : (
                                    questions.map((question, column) => (
                                        <td
                                            key={question.id}
                                            className={styles.cell}
                                            data-edge={
                                                column ===
                                                    questions.length - 1 ||
                                                undefined
                                            }
                                            data-lens={
                                                focus === question.id ||
                                                undefined
                                            }>
                                            {serves(need, question.id) && (
                                                <MarkTip
                                                    need={need}
                                                    question={question}
                                                />
                                            )}
                                        </td>
                                    ))
                                )}
                                <td className={styles.outcome}>
                                    <NeedOutcomeSummary
                                        need={need}
                                        onOpenSource={onOpenSource}
                                    />
                                </td>
                            </motion.tr>
                        ))}
                    </tbody>
                </table>
                <div className={styles.legend}>
                    {outcomeOrder
                        .filter(
                            (outcome) =>
                                (outcome !== "in_progress" &&
                                    outcome !== "on_hold") ||
                                needs.some((need) => need.outcome === outcome),
                        )
                        .map((outcome) => (
                            <span key={outcome} className={styles.legendItem}>
                                <NeedMark outcome={outcome} />
                                {outcomes[outcome].legend}
                            </span>
                        ))}
                </div>
            </section>
        </MotionConfig>
    );
}
