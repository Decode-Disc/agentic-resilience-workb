import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import styles from "./question-card.module.css";

export interface QuestionCardProps {
    id: string;
    question: string;
    reading: ReactNode;
    next: string;
    actionLabel: string;
    onOpen: () => void;
    state: "testing" | "waiting";
    balance?: readonly [number, number, number];
    request?: ReactNode;
}
export function QuestionCard({
    id,
    question,
    reading,
    next,
    actionLabel,
    onOpen,
    state,
    balance = [0, 0, 0],
    request,
}: QuestionCardProps) {
    return state === "testing" ? (
        <Button
            variant="unstyled"
            onClick={onOpen}
            className={cn(
                "wb-glass wb-focal wb-panel-focal",
                styles.card,
                styles.testing,
            )}>
            <span className={styles.header}>
                <span className={styles.questionId}>{id}</span>
                <Badge tone="inference">
                    <span className="wb-live wb-live-dot" />
                    Testing
                </Badge>
                <span className={styles.steps}>
                    <span className={cn(styles.step, styles.completedStep)}>
                        <i />
                        Gather
                    </span>
                    <span className={cn(styles.step, styles.currentStep)}>
                        <i />
                        Test
                    </span>
                    <span className={styles.step}>
                        <i />
                        Answer
                    </span>
                </span>
            </span>
            <span className={styles.body}>
                <span className={styles.question}>{question}</span>
                <span className={styles.reading}>{reading}</span>
            </span>
            <span className={styles.balance}>
                <span className={styles.balanceBar}>
                    <span
                        style={{ flex: balance[0] }}
                        className={styles.support}
                    />
                    <span
                        style={{ flex: balance[1] }}
                        className={styles.opposition}
                    />
                    <span
                        style={{ flex: balance[2] }}
                        className={styles.context}
                    />
                </span>
                <span className={styles.legend}>
                    <span>
                        <b>{balance[0]}</b> support
                    </span>
                    <span>
                        <b>{balance[1]}</b> oppose
                    </span>
                    <span>
                        <b>{balance[2]}</b> context
                    </span>
                </span>
            </span>
            <span className={styles.footer}>
                <span className={styles.next}>{next}</span>
                <span className={styles.action}>{actionLabel}</span>
            </span>
        </Button>
    ) : (
        <Button
            variant="unstyled"
            onClick={onOpen}
            className={cn("wb-glass wb-waits", styles.card, styles.waiting)}>
            <span className={styles.header}>
                <span className={styles.questionId}>{id}</span>
                <Badge tone="review">
                    <svg
                        width="7"
                        height="7"
                        viewBox="0 0 10 10"
                        className={styles.reviewDot}
                        aria-hidden="true">
                        <circle cx="5" cy="5" r="5" fill="var(--review)" />
                    </svg>
                    Waiting for material
                </Badge>
                <span className={styles.steps}>
                    <span className={cn(styles.step, styles.completedStep)}>
                        <i />
                        Gather
                    </span>
                    <span className={cn(styles.step, styles.currentStep)}>
                        <i />
                        Test
                    </span>
                    <span className={styles.step}>
                        <i />
                        Answer
                    </span>
                </span>
            </span>
            <span className={styles.body}>
                <span className={styles.question}>{question}</span>
                <span className={styles.reading}>{reading}</span>
            </span>
            <span className={styles.request}>
                <span className="wb-label">Asked of Sources</span>
                <span className={styles.requestText}>{request}</span>
            </span>
            <span className={styles.footer}>
                <span className={styles.next}>{next}</span>
                <span className={styles.action}>{actionLabel}</span>
            </span>
        </Button>
    );
}
