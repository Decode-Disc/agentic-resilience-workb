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
        <article className={cn("wb-glass", "wb-focal", styles.appraisal)}>
            <div className={styles.header}>
                <span className={cn("wb-label", styles.accentLabel)}>
                    {label}
                </span>
                <Badge tone="review">
                    <svg
                        width="7"
                        height="7"
                        viewBox="0 0 10 10"
                        className={styles.statusDot}
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
            <div className={styles.interpretationPanel}>
                <span className={cn("wb-label", styles.accentLabel)}>
                    Interpretation
                </span>
                <span className={styles.interpretation}>{interpretation}</span>
                <span className={styles.confidence}>
                    <span className="wb-label">Confidence</span>
                    <span
                        className={styles.bars}
                        role="img"
                        aria-label={`${confidence.level} of 4`}>
                        {[1, 2, 3, 4].map((level) => (
                            <i
                                key={level}
                                className={
                                    level <= confidence.level
                                        ? styles.activeBar
                                        : undefined
                                }
                            />
                        ))}
                    </span>
                    <span className={styles.confidenceDetail}>
                        {confidence.label}
                    </span>
                </span>
            </div>
            <div>
                <span className={cn("wb-label", styles.sectionLabel)}>
                    Supports
                </span>
                <div className={styles.row}>
                    <span className={styles.evidenceText}>
                        <span className={styles.evidenceTextGroup}>
                            {support.text}
                        </span>
                        <span className="wb-meta">{support.meta}</span>
                    </span>
                    <Badge tone="fact">
                        <svg
                            width="7"
                            height="7"
                            viewBox="0 0 10 10"
                            className={styles.statusDot}
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
                <span className={cn("wb-label", styles.sectionLabel)}>
                    Objections
                </span>
                <div className={styles.row}>
                    <span className={styles.evidenceText}>
                        <span className={styles.evidenceTextGroup}>
                            {objection.text}
                        </span>
                        <span className="wb-meta">{objection.meta}</span>
                    </span>
                    <Badge tone="counter">
                        <svg
                            width="8"
                            height="8"
                            viewBox="0 0 10 10"
                            className={styles.claimGlyph}
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
            <div className={styles.unknown}>
                <span className={styles.unknownText}>?</span>
                <span className={styles.controlText}>
                    <span className="wb-label">Decisive unknown</span>
                    <span className={styles.controlTitle}>
                        {decisiveUnknown}
                    </span>
                </span>
                <span className={cn("wb-meta", styles.controlStatus)}>
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
                    <span className="wb-meta">{controlDetail}</span>
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
