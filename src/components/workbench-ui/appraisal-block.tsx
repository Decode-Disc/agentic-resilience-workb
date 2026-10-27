import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import styles from "./appraisal-block.module.css";
import { WorkbenchIcon } from "./glyphs";

export interface AppraisalBlockProps {
    label: string;
    interpretation: ReactNode;
    confidence: { level: 0 | 1 | 2 | 3 | 4; label: string };
    support: { text: ReactNode; meta: string };
    objection: { text: ReactNode; meta: string };
    decisiveUnknown: ReactNode;
    controlDetail: string;
    onCorrect: () => void;
    onRetain: () => void;
}
export function AppraisalBlock({
    label,
    interpretation,
    confidence,
    support,
    objection,
    decisiveUnknown,
    controlDetail,
    onCorrect,
    onRetain,
}: AppraisalBlockProps) {
    return (
        <article className={cn("wb-glass", "wb-focal", styles.art)}>
            <div className={styles.header}>
                <span
                    className={cn("wb-label")}
                    style={{ color: "var(--accent-foreground)" }}>
                    {label}
                </span>
                <Badge tone="review">
                    <svg
                        width="7"
                        height="7"
                        viewBox="0 0 10 10"
                        style={{ width: 7, height: 7 }}
                        aria-hidden="true">
                        <circle
                            cx="5"
                            cy="5"
                            r="5"
                            fill="var(--review)"></circle>
                    </svg>
                    Proposed · for review
                </Badge>
            </div>
            <div className={cn(styles.interp)}>
                <span
                    className={cn("wb-label")}
                    style={{ color: "var(--accent-foreground)" }}>
                    Interpretation
                </span>
                <span
                    style={{
                        fontSize: "19px",
                        lineHeight: "28px",
                        fontWeight: "500",
                        letterSpacing: "-.015em",
                    }}>
                    {interpretation}
                </span>
                <span
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "14px",
                        flexWrap: "wrap",
                    }}>
                    <span className={cn("wb-label")}>Confidence</span>
                    <span
                        className={styles.bars}
                        role="img"
                        aria-label={`${confidence.level} of 4`}>
                        {[1, 2, 3, 4].map((level) => (
                            <i
                                key={level}
                                className={
                                    level <= confidence.level
                                        ? styles.on
                                        : undefined
                                }
                            />
                        ))}
                    </span>
                    <span
                        style={{
                            fontSize: "13px",
                            color: "var(--muted-foreground)",
                        }}>
                        {confidence.label}
                    </span>
                </span>
            </div>
            <div>
                <span
                    className={cn("wb-label")}
                    style={{ display: "block", paddingBottom: "6px" }}>
                    Supports
                </span>
                <div className={cn(styles.row)}>
                    <span
                        style={{
                            flex: "1",
                            display: "flex",
                            flexDirection: "column",
                            gap: "5px",
                        }}>
                        <span className={cn(styles.txt)}>{support.text}</span>
                        <span className={cn("wb-meta")}>{support.meta}</span>
                    </span>
                    <Badge tone="fact">
                        <svg
                            width="7"
                            height="7"
                            viewBox="0 0 10 10"
                            style={{ width: 7, height: 7 }}
                            aria-hidden="true">
                            <rect
                                width="10"
                                height="10"
                                rx="2"
                                fill="currentColor"></rect>
                        </svg>
                        Fact
                    </Badge>
                </div>
            </div>
            <div>
                <span
                    className={cn("wb-label")}
                    style={{ display: "block", paddingBottom: "6px" }}>
                    Objections
                </span>
                <div className={cn(styles.row)}>
                    <span
                        style={{
                            flex: "1",
                            display: "flex",
                            flexDirection: "column",
                            gap: "5px",
                        }}>
                        <span className={cn(styles.txt)}>{objection.text}</span>
                        <span className={cn("wb-meta")}>{objection.meta}</span>
                    </span>
                    <Badge tone="counter">
                        <svg
                            width="8"
                            height="8"
                            viewBox="0 0 10 10"
                            style={{ width: 8, height: 8 }}
                            aria-hidden="true">
                            <rect
                                y="3.5"
                                width="10"
                                height="3"
                                rx="1"
                                fill="currentColor"></rect>
                        </svg>
                        Counter-evidence
                    </Badge>
                </div>
            </div>
            <div className={cn(styles.unk)}>
                <span className={cn(styles.q)}>?</span>
                <span
                    style={{
                        flex: "1",
                        display: "flex",
                        flexDirection: "column",
                        gap: "3px",
                    }}>
                    <span className={cn("wb-label")}>Decisive unknown</span>
                    <span
                        style={{
                            fontSize: "16px",
                            lineHeight: "22px",
                            fontWeight: "500",
                        }}>
                        {decisiveUnknown}
                    </span>
                </span>
                <span className={cn("wb-meta")} style={{ textAlign: "right" }}>
                    would move
                    <br />
                    confidence most
                </span>
            </div>
            <footer className={styles.footer}>
                <div className={styles.control}>
                    <Badge tone="ink">
                        <WorkbenchIcon
                            name="check"
                            size={11}
                            strokeWidth={2.4}
                        />
                        Control · Supported
                    </Badge>
                    <span className={cn("wb-meta")}>{controlDetail}</span>
                </div>
                <div className={styles.actions}>
                    <Button variant="outline" size="lg" onClick={onCorrect}>
                        Correct appraisal
                    </Button>
                    <Button variant="approved" size="lg" onClick={onRetain}>
                        Retain appraisal
                    </Button>
                </div>
            </footer>
        </article>
    );
}
