import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { WorkbenchIcon } from "./glyphs";
import styles from "./progress-timeline.module.css";
export interface TimelineStep {
    id: string;
    label: string;
    state: "done" | "current" | "upcoming";
}
export interface InquiryRow {
    id: string;
    label: string;
    badge: ReactNode;
    current?: boolean;
    balance?: readonly [number, number, number];
}
export interface ProgressTimelineProps {
    steps: readonly TimelineStep[];
    title: string;
    status?: ReactNode;
    legend?: string;
    rows: readonly InquiryRow[];
}
export function ProgressTimeline({
    steps,
    title,
    status,
    legend,
    rows,
}: ProgressTimelineProps) {
    const current = steps.findIndex((s) => s.state === "current");
    return (
        <div className={styles.wrap}>
            <div className={cn("wb-glass", styles.timeline)}>
                <span className={styles.track} />
                <span
                    className={styles.fill}
                    style={{
                        width: `calc((100% - 52px) * ${Math.max(0, current) / Math.max(1, steps.length)})`,
                    }}
                />
                <div
                    className={styles.steps}
                    style={{
                        gridTemplateColumns: `repeat(${steps.length},minmax(0,1fr))`,
                    }}>
                    {steps.map((s) => (
                        <span
                            className={styles.step}
                            key={s.id}
                            aria-current={
                                s.state === "current" ? "step" : undefined
                            }>
                            <span
                                className={cn(
                                    styles.dot,
                                    s.state === "done"
                                        ? styles.done
                                        : s.state === "current"
                                          ? [styles.now, "wb-live"]
                                          : styles.todo,
                                )}>
                                {s.state === "done" ? (
                                    <WorkbenchIcon
                                        name="check"
                                        size={14}
                                        strokeWidth={2.6}
                                    />
                                ) : s.state === "current" ? (
                                    <i />
                                ) : null}
                            </span>
                            <span
                                className={cn(
                                    styles.stepLabel,
                                    s.state === "current"
                                        ? styles.currentLabel
                                        : s.state === "upcoming"
                                          ? styles.upcomingLabel
                                          : undefined,
                                )}>
                                {s.label}
                            </span>
                        </span>
                    ))}
                </div>
            </div>
            <section className={cn("wb-glass wb-focal", styles.inquiries)}>
                <div className={styles.header}>
                    <span className={styles.heading}>
                        <b className={styles.title}>{title}</b>
                        {status}
                    </span>
                    <span className="wb-meta">{legend}</span>
                </div>
                {rows.map((r) => (
                    <div
                        key={r.id}
                        className={cn(styles.question, "wb-divider")}>
                        <span
                            className={cn(
                                styles.questionId,
                                r.current
                                    ? styles.currentQuestion
                                    : styles.defaultQuestion,
                            )}>
                            {r.id}
                        </span>
                        <span className={styles.questionText}>
                            <span className={styles.questionLabel}>
                                {r.label}
                            </span>
                            <span
                                className={cn(
                                    styles.balance,
                                    r.balance
                                        ? undefined
                                        : styles.pendingBalance,
                                )}>
                                {r.balance ? (
                                    r.balance.map((n, i) => (
                                        <span
                                            key={
                                                [
                                                    "support",
                                                    "oppose",
                                                    "context",
                                                ][i]
                                            }
                                            className={styles.balanceSegment}
                                            style={{ flex: n }}
                                        />
                                    ))
                                ) : (
                                    <span
                                        className={cn("wb-sweep", styles.sweep)}
                                    />
                                )}
                            </span>
                        </span>
                        {r.badge}
                    </div>
                ))}
            </section>
        </div>
    );
}
