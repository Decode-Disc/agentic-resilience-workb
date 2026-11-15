import { MotionConfig, motion } from "motion/react";
import { type ReactNode, useId, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import styles from "./documentary-needs.module.css";
import { HelpTip } from "./help-tip";
import { listTransition, markerTransition } from "./motion";

/** Where documentary work on a need stands; never a judgment on the questions it serves. */
export type NeedOutcome = "in_progress" | "prepared" | "gap" | "unfinished";

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
}

export interface NeedQuestion {
    id: string;
    label: string;
    question: string;
}

const outcomes: Record<NeedOutcome, { label: string; legend: string }> = {
    in_progress: { label: "In progress", legend: "Work under way" },
    prepared: { label: "Prepared", legend: "Prepared material" },
    gap: { label: "Gap", legend: "Searched, nothing usable" },
    unfinished: { label: "Unfinished", legend: "Work not completed" },
};
const outcomeOrder: readonly NeedOutcome[] = [
    "in_progress",
    "prepared",
    "gap",
    "unfinished",
];

function needCount(relied: readonly DocumentaryNeed[]) {
    return [
        `${relied.length} documentary needs`,
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
        need.documents !== undefined && `${need.documents} documents`,
        need.contributions !== undefined &&
            `${need.contributions} contributions`,
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
                <b className={styles.tipNeed}>{need.label}</b>
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

function NeedOutcomeSummary({ need }: { need: DocumentaryNeed }) {
    if (need.outcome === "gap") return <Badge tone="review">Gap</Badge>;
    if (need.outcome === "unfinished")
        return <Badge tone="dashed">Unfinished</Badge>;
    if (need.outcome === "in_progress" && !need.contributions)
        return <Badge tone="accent">In progress</Badge>;
    const progress = need.outcome === "in_progress" && (
        <Badge tone="accent">In progress</Badge>
    );
    const counts = [
        need.documents !== undefined && `${need.documents} documents`,
        need.contributions !== undefined &&
            `${need.contributions} contributions`,
    ].filter(Boolean);
    return (
        <span className={styles.prepared}>
            {counts.length > 0 && (
                <span className="wb-meta">{counts.join(" · ")}</span>
            )}
            {need.flag}
            {progress}
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
}: {
    title?: string;
    questions: readonly NeedQuestion[];
    needs: readonly DocumentaryNeed[];
}) {
    const headingId = useId();
    const markerId = useId();
    const [lens, setLens] = useState<string>();
    const [preview, setPreview] = useState<string>();
    const focus = preview ?? lens;
    const focused = questions.find((question) => question.id === focus);
    const serves = (need: DocumentaryNeed, id = focus) =>
        id !== undefined && need.questions.includes(id);
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
                    {/* Every caption shares one grid cell, so the table never shifts under a pointer. */}
                    <p
                        role="status"
                        className={styles.lens}
                        hidden={questions.length === 0}>
                        <span
                            className={styles.lensLine}
                            data-active={!focused || undefined}
                            aria-hidden={focused ? true : undefined}>
                            <span className={styles.hint}>
                                Select a question to see the needs it relies on.
                            </span>
                        </span>
                        {questions.map((question) => {
                            const active = focused?.id === question.id;
                            const relied = needs.filter((need) =>
                                serves(need, question.id),
                            );
                            return (
                                <span
                                    key={question.id}
                                    className={styles.lensLine}
                                    data-active={active || undefined}
                                    aria-hidden={active ? undefined : true}>
                                    <b>{question.label}</b>
                                    <span>{question.question}</span>
                                    <span className="wb-meta">
                                        {needCount(relied)}
                                    </span>
                                </span>
                            );
                        })}
                    </p>
                </div>
                <table className={styles.table} aria-labelledby={headingId}>
                    <colgroup>
                        <col />
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
                                        onFocus={() => setPreview(question.id)}
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
                                    <span className={styles.needLabel}>
                                        {need.label}
                                    </span>
                                    {need.detail && (
                                        <span className={styles.detail}>
                                            {need.detail}
                                        </span>
                                    )}
                                    <span className={styles.inlineOutcome}>
                                        <NeedOutcomeSummary need={need} />
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
                                    <NeedOutcomeSummary need={need} />
                                </td>
                            </motion.tr>
                        ))}
                    </tbody>
                </table>
                <div className={styles.legend}>
                    {outcomeOrder
                        .filter(
                            (outcome) =>
                                outcome !== "in_progress" ||
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
