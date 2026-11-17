import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import styles from "./evidence-matrix.module.css";
import useStyles from "./evidence-use.module.css";
import {
    EvidenceUsePopover,
    type MatrixPassage,
    type MatrixUseDetails,
} from "./evidence-use-popover";
import {
    ClaimGlyph,
    type ClaimTone,
    EvidenceBadge,
    WorkbenchIcon,
} from "./glyphs";
export interface MatrixQuestion {
    id: string;
    label: string;
    title: string;
}
export type MatrixUse = "supports" | "opposes" | "context";
export const matrixUseLabels: Record<MatrixUse, string> = {
    supports: "Supports",
    opposes: "Opposes",
    context: "Context",
};
const sourceChecks = {
    verified: { label: "Verified", icon: "check" },
    disputed: { label: "Sources disagree", icon: "conflict" },
    unestablished: { label: "Not established", icon: "unestablished" },
    unchecked: { label: "Not checked", icon: "clock" },
} as const;
export type MatrixSourceStatus = keyof typeof sourceChecks;
export interface MatrixRow {
    id: string;
    text: string;
    kind: ClaimTone;
    meta: string;
    sourceStatus?: MatrixSourceStatus;
    passage?: MatrixPassage;
    useDetails?: Readonly<Record<string, MatrixUseDetails | undefined>>;
    uses: Readonly<Record<string, MatrixUse | undefined>>;
}
export interface EvidenceMatrixProps {
    questions: readonly MatrixQuestion[];
    rows: readonly MatrixRow[];
    selectedQuestion?: string;
    selectedAssertion?: string;
    introduction?: ReactNode;
    className?: string;
    onSelectQuestion?: (id: string) => void;
    onSelectUse: (assertionId: string, questionId: string) => void;
    onChallengeUse?: (assertionId: string, questionId: string) => void;
    onOpenPassage?: (assertionId: string, questionId: string) => void;
    onOpenQuestionReasoning?: (questionId: string) => void;
}
/** Claim classes, source checks and question uses are supplied independently; absent checks remain explicitly unchecked. */
export function EvidenceMatrix({
    questions,
    rows,
    selectedQuestion,
    selectedAssertion,
    introduction,
    className,
    onSelectQuestion,
    onSelectUse,
    onChallengeUse,
    onOpenPassage,
    onOpenQuestionReasoning,
}: EvidenceMatrixProps) {
    const reducedMotion = useReducedMotion();
    const selectionTransition = {
        duration: reducedMotion ? 0 : 0.18,
        ease: "easeOut" as const,
    };
    const grid = {
        gridTemplateColumns: `minmax(260px,1fr) repeat(${questions.length},132px) 132px`,
    };
    return (
        <table
            className={cn("wb-glass", styles.box, className)}
            aria-label="Evidence by question">
            <thead>
                <tr className={cn(styles.grid, styles.axes)} style={grid}>
                    <th scope="col">
                        Evidence <span aria-hidden="true">↓</span>
                    </th>
                    <th
                        scope="colgroup"
                        colSpan={questions.length}
                        className={styles.questionAxis}
                        style={{ gridColumn: `span ${questions.length}` }}>
                        Questions <span className={styles.axisLine} />
                        <span aria-hidden="true">→</span>
                    </th>
                    <th scope="col" className={styles.sourceHeading}>
                        Source
                    </th>
                </tr>
                <tr className={cn(styles.grid, styles.header)} style={grid}>
                    <th scope="col" className={styles.introduction}>
                        {introduction ?? (
                            <>
                                <span
                                    className={cn(
                                        "wb-label",
                                        styles.accentLabel,
                                    )}>
                                    {"// Inventory"}
                                </span>
                                <span className={styles.introductionTitle}>
                                    Which evidence bears on which question
                                </span>
                            </>
                        )}
                    </th>
                    {questions.map((q) => (
                        <th scope="col" key={q.id}>
                            {onSelectQuestion ? (
                                <Button
                                    variant="unstyled"
                                    render={
                                        <motion.button
                                            initial={false}
                                            animate={{
                                                "--question-selection":
                                                    q.id === selectedQuestion
                                                        ? 1
                                                        : 0,
                                            }}
                                            transition={selectionTransition}
                                        />
                                    }
                                    className={cn(
                                        styles.qcard,
                                        q.id === selectedQuestion &&
                                            styles.selectedQuestion,
                                    )}
                                    onClick={() => onSelectQuestion(q.id)}
                                    aria-label={`${q.label} ${q.title}`}
                                    aria-pressed={q.id === selectedQuestion}>
                                    <span className={styles.questionId}>
                                        {q.label}
                                    </span>
                                    {q.title}
                                </Button>
                            ) : (
                                <motion.span
                                    initial={false}
                                    animate={{
                                        "--question-selection":
                                            q.id === selectedQuestion ? 1 : 0,
                                    }}
                                    transition={selectionTransition}
                                    className={cn(
                                        styles.qcard,
                                        q.id === selectedQuestion &&
                                            styles.selectedQuestion,
                                    )}>
                                    <span className={styles.questionId}>
                                        {q.label}
                                    </span>
                                    {q.title}
                                </motion.span>
                            )}
                        </th>
                    ))}
                    <th scope="col" className={styles.sourceIntro}>
                        Checked against
                        <br />
                        the cited passage
                    </th>
                </tr>
            </thead>
            <tbody>
                {rows.map((r) => {
                    const sourceStatus = r.sourceStatus ?? "unchecked";
                    const sourceCheck = sourceChecks[sourceStatus];
                    return (
                        <motion.tr
                            key={r.id}
                            initial={false}
                            animate={{
                                "--row-selection":
                                    r.id === selectedAssertion ? 1 : 0,
                            }}
                            transition={selectionTransition}
                            className={cn(
                                styles.grid,
                                styles.row,
                                r.id === selectedAssertion &&
                                    styles.selectedRow,
                            )}
                            style={grid}>
                            <th scope="row" className={styles.evidence}>
                                <span className={styles.evidenceHeading}>
                                    <EvidenceBadge kind={r.kind}>
                                        {r.kind === "counter"
                                            ? "Counter"
                                            : undefined}
                                    </EvidenceBadge>
                                    <span
                                        className={cn(
                                            "wb-meta",
                                            styles.metadata,
                                        )}>
                                        {r.id}
                                        {r.id === selectedAssertion
                                            ? " · selected"
                                            : ""}
                                    </span>
                                </span>
                                <span className={styles.evidenceText}>
                                    {r.text}
                                </span>
                                <span className="wb-meta">{r.meta}</span>
                            </th>
                            {questions.map((q) => {
                                const use = r.uses[q.id];
                                const label = use
                                    ? matrixUseLabels[use]
                                    : "Not used";
                                return (
                                    <motion.td
                                        key={q.id}
                                        className={styles.cell}
                                        initial={false}
                                        animate={{
                                            "--column-selection":
                                                q.id === selectedQuestion
                                                    ? 1
                                                    : 0,
                                        }}
                                        transition={selectionTransition}>
                                        {use ? (
                                            <EvidenceUsePopover
                                                assertionId={r.id}
                                                questionLabel={q.label}
                                                use={use}
                                                useLabel={label}
                                                passage={r.passage}
                                                details={r.useDetails?.[q.id]}
                                                onChallenge={
                                                    onChallengeUse
                                                        ? () =>
                                                              onChallengeUse(
                                                                  r.id,
                                                                  q.id,
                                                              )
                                                        : undefined
                                                }
                                                onOpenPassage={
                                                    onOpenPassage
                                                        ? () =>
                                                              onOpenPassage(
                                                                  r.id,
                                                                  q.id,
                                                              )
                                                        : undefined
                                                }
                                                onOpenReasoning={
                                                    onOpenQuestionReasoning
                                                        ? () =>
                                                              onOpenQuestionReasoning(
                                                                  q.id,
                                                              )
                                                        : undefined
                                                }
                                                trigger={
                                                    <Button
                                                        variant="unstyled"
                                                        render={
                                                            <motion.button
                                                                initial={false}
                                                                animate={{
                                                                    "--use-selection":
                                                                        r.id ===
                                                                            selectedAssertion &&
                                                                        q.id ===
                                                                            selectedQuestion
                                                                            ? 1
                                                                            : 0,
                                                                }}
                                                                transition={
                                                                    selectionTransition
                                                                }
                                                            />
                                                        }
                                                        className={cn(
                                                            useStyles.treatment,
                                                            styles.use,
                                                        )}
                                                        aria-label={`${r.id} · ${q.label} · ${label}`}
                                                        data-use={use}
                                                        aria-pressed={
                                                            r.id ===
                                                                selectedAssertion &&
                                                            q.id ===
                                                                selectedQuestion
                                                        }
                                                        onClick={() =>
                                                            onSelectUse(
                                                                r.id,
                                                                q.id,
                                                            )
                                                        }>
                                                        {use === "supports" ? (
                                                            <span
                                                                className={
                                                                    styles.supportDot
                                                                }
                                                                aria-hidden="true"
                                                            />
                                                        ) : use ===
                                                          "opposes" ? (
                                                            <ClaimGlyph kind="counter" />
                                                        ) : (
                                                            <span
                                                                className={
                                                                    styles.contextDot
                                                                }
                                                                aria-hidden="true"
                                                            />
                                                        )}
                                                        {label}
                                                    </Button>
                                                }
                                            />
                                        ) : (
                                            <span
                                                className={cn(
                                                    useStyles.treatment,
                                                    styles.use,
                                                    styles.useCount,
                                                )}>
                                                <span
                                                    className={
                                                        styles.sourceResult
                                                    }>
                                                    Not used
                                                </span>
                                            </span>
                                        )}
                                    </motion.td>
                                );
                            })}
                            <td
                                className={styles.source}
                                data-source-status={sourceStatus}>
                                <WorkbenchIcon
                                    name={sourceCheck.icon}
                                    size={14}
                                />
                                {sourceCheck.label}
                            </td>
                        </motion.tr>
                    );
                })}
            </tbody>
        </table>
    );
}
