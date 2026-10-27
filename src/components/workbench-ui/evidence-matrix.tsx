import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import styles from "./evidence-matrix.module.css";
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
export interface MatrixRow {
    id: string;
    text: string;
    kind: ClaimTone;
    meta: string;
    uses: Readonly<Record<string, MatrixUse | undefined>>;
}
export interface EvidenceMatrixProps {
    questions: readonly MatrixQuestion[];
    rows: readonly MatrixRow[];
    selectedQuestion?: string;
    onSelectQuestion?: (id: string) => void;
    onSelectUse: (assertionId: string, questionId: string) => void;
}
/** Presentation tones and question-specific uses arrive independently; counter is a visual tone, not a persisted claim class. */
export function EvidenceMatrix({
    questions,
    rows,
    selectedQuestion,
    onSelectQuestion,
    onSelectUse,
}: EvidenceMatrixProps) {
    const grid = {
        gridTemplateColumns: `minmax(0,1fr) repeat(${questions.length},132px)`,
    };
    return (
        <table
            className={cn("wb-glass", styles.box)}
            aria-label="Evidence by question">
            <thead>
                <tr className={cn(styles.grid, styles.head)} style={grid}>
                    <th
                        scope="col"
                        style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: 6,
                            justifyContent: "flex-end",
                        }}>
                        <span
                            className="wb-label"
                            style={{ color: "var(--accent-foreground)" }}>
                            {"// Inventory"}
                        </span>
                        <span
                            style={{
                                fontSize: 18,
                                lineHeight: "22px",
                                fontWeight: 500,
                                letterSpacing: "-.03em",
                            }}>
                            Which evidence bears on which question
                        </span>
                    </th>
                    {questions.map((q) => (
                        <th scope="col" key={q.id}>
                            {onSelectQuestion ? (
                                <Button
                                    className={cn(
                                        styles.qcard,
                                        q.id === selectedQuestion && styles.sel,
                                    )}
                                    onClick={() => onSelectQuestion(q.id)}
                                    aria-pressed={q.id === selectedQuestion}>
                                    <span className={styles.qw}>{q.label}</span>
                                    {q.title}
                                </Button>
                            ) : (
                                <span
                                    className={cn(
                                        styles.qcard,
                                        q.id === selectedQuestion && styles.sel,
                                    )}>
                                    <span className={styles.qw}>{q.label}</span>
                                    {q.title}
                                </span>
                            )}
                        </th>
                    ))}
                </tr>
            </thead>
            <tbody>
                {rows.map((r) => (
                    <tr
                        key={r.id}
                        className={cn(styles.grid, styles.row)}
                        style={grid}>
                        <th scope="row" className={styles.ev}>
                            <span
                                style={{ fontSize: 13.5, lineHeight: "19px" }}>
                                {r.text}
                            </span>
                            <span
                                style={{
                                    display: "flex",
                                    gap: 8,
                                    alignItems: "center",
                                }}>
                                <EvidenceBadge kind={r.kind}>
                                    {r.kind === "counter"
                                        ? "Counter"
                                        : undefined}
                                </EvidenceBadge>
                                <span className="wb-meta">
                                    {r.id} · {r.meta}
                                </span>
                            </span>
                        </th>
                        {questions.map((q) => {
                            const use = r.uses[q.id];
                            const label = use
                                ? {
                                      supports: "Supports",
                                      opposes: "Opposes",
                                      context: "Context",
                                  }[use]
                                : "Not used";
                            return (
                                <td key={q.id} className={styles.cell}>
                                    {use ? (
                                        <Button
                                            className={cn(
                                                styles.use,
                                                styles[
                                                    use === "supports"
                                                        ? "u-s"
                                                        : use === "opposes"
                                                          ? "u-o"
                                                          : "u-c"
                                                ],
                                            )}
                                            aria-label={`${r.id} · ${q.label} · ${label}`}
                                            onClick={() =>
                                                onSelectUse(r.id, q.id)
                                            }>
                                            {use === "supports" ? (
                                                <WorkbenchIcon
                                                    name="check"
                                                    size={12}
                                                    strokeWidth={2.4}
                                                />
                                            ) : use === "opposes" ? (
                                                <ClaimGlyph kind="counter" />
                                            ) : null}
                                            {label}
                                        </Button>
                                    ) : (
                                        <span
                                            className={cn(
                                                styles.use,
                                                styles["u-n"],
                                            )}>
                                            <span className={styles.sr}>
                                                Not used
                                            </span>
                                        </span>
                                    )}
                                </td>
                            );
                        })}
                    </tr>
                ))}
            </tbody>
        </table>
    );
}
