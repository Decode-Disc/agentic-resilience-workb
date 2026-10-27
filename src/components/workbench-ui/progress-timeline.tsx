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
            <div className={cn("wb-glass", styles.stp)}>
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
                            className={styles.st}
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
                                className={styles.sl}
                                style={
                                    s.state === "current"
                                        ? {
                                              fontWeight: 600,
                                              color: "var(--accent-foreground)",
                                          }
                                        : s.state === "upcoming"
                                          ? {
                                                color: "var(--muted-foreground)",
                                                fontWeight: 400,
                                            }
                                          : undefined
                                }>
                                {s.label}
                            </span>
                        </span>
                    ))}
                </div>
            </div>
            <section className={cn("wb-glass wb-focal", styles.inq)}>
                <div className={styles.hd}>
                    <span
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                        }}>
                        <b style={{ fontSize: 17, letterSpacing: "-.02em" }}>
                            {title}
                        </b>
                        {status}
                    </span>
                    <span className="wb-meta">{legend}</span>
                </div>
                {rows.map((r) => (
                    <div key={r.id} className={cn(styles.q, "wb-divider")}>
                        <span
                            className={styles.qw}
                            style={
                                r.current
                                    ? {
                                          background: "var(--accent)",
                                          color: "var(--accent-foreground)",
                                      }
                                    : {
                                          background: "var(--foreground)",
                                          color: "var(--card)",
                                      }
                            }>
                            {r.id}
                        </span>
                        <span
                            style={{
                                flex: 1,
                                display: "flex",
                                flexDirection: "column",
                                gap: 7,
                            }}>
                            <span style={{ fontSize: 14.5, fontWeight: 500 }}>
                                {r.label}
                            </span>
                            <span
                                className={styles.bal}
                                style={r.balance ? undefined : { width: 160 }}>
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
                                            style={{
                                                flex: n,
                                                background: [
                                                    "var(--foreground)",
                                                    "var(--counter-evidence)",
                                                    "color-mix(in oklab,var(--foreground) 18%,transparent)",
                                                ][i],
                                            }}
                                        />
                                    ))
                                ) : (
                                    <span
                                        style={{ flex: 1 }}
                                        className="wb-sweep"
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
