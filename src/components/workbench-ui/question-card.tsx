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
            onClick={onOpen}
            className={cn(
                "wb-glass",
                "wb-focal",
                styles.focalbg,
                styles.qcard,
            )}>
            <span
                style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <span className={cn(styles.qw)}>{id}</span>
                <Badge tone="inference">
                    <span
                        className={cn("wb-live")}
                        style={{
                            width: "7px",
                            height: "7px",
                            borderRadius: "50%",
                            background: "var(--brand-purple)",
                            display: "inline-block",
                        }}></span>
                    Testing
                </Badge>
                <span className={cn(styles.steps)}>
                    <span className={cn(styles.s, styles["s-done"])}>
                        <i></i>Gather
                    </span>
                    <span className={cn(styles.s, styles["s-now"])}>
                        <i></i>Test
                    </span>
                    <span className={cn(styles.s)}>
                        <i></i>Answer
                    </span>
                </span>
            </span>
            <span
                style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "6px",
                }}>
                <span
                    style={{
                        fontSize: "14px",
                        color: "var(--muted-foreground)",
                    }}>
                    {question}
                </span>
                <span className={cn(styles.reading)}>{reading}</span>
            </span>
            <span
                style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px",
                }}>
                <span className={cn(styles.bal)}>
                    <span
                        style={{
                            flex: balance[0],
                            background: "var(--foreground)",
                        }}></span>
                    <span
                        style={{
                            flex: balance[1],
                            background: "var(--counter-evidence)",
                        }}></span>
                    <span
                        style={{
                            flex: balance[2],
                            background:
                                "color-mix(in oklab,var(--foreground) 18%,transparent)",
                        }}></span>
                </span>
                <span className={cn(styles.leg)}>
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
            <span className={cn(styles.foot)}>
                <span style={{ flex: "1", color: "var(--muted-foreground)" }}>
                    {next}
                </span>
                <span
                    style={{
                        fontWeight: "500",
                        color: "var(--accent-foreground)",
                    }}>
                    {actionLabel}
                </span>
            </span>
        </Button>
    ) : (
        <Button
            onClick={onOpen}
            className={cn("wb-glass", "wb-waits", styles.waitbg, styles.qcard)}>
            <span
                style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <span
                    className={cn(styles.qw)}
                    style={{
                        background: "var(--tint-review)",
                        color: "var(--review-foreground)",
                    }}>
                    {id}
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
                    Waiting for material
                </Badge>
                <span className={cn(styles.steps)}>
                    <span className={cn(styles.s, styles["s-done"])}>
                        <i></i>Gather
                    </span>
                    <span
                        className={cn(styles.s)}
                        style={{
                            color: "var(--review-foreground)",
                            fontWeight: "500",
                        }}>
                        <i style={{ background: "var(--review)" }}></i>Test
                    </span>
                    <span className={cn(styles.s)}>
                        <i></i>Answer
                    </span>
                </span>
            </span>
            <span
                style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "6px",
                }}>
                <span
                    style={{
                        fontSize: "14px",
                        color: "var(--muted-foreground)",
                    }}>
                    {question}
                </span>
                <span
                    className={cn(styles.reading)}
                    style={{ color: "var(--muted-foreground)" }}>
                    {reading}
                </span>
            </span>
            <span className={cn(styles.ask)}>
                <span className={cn("wb-label")}>Asked of Sources</span>
                <span style={{ fontSize: "14px", fontWeight: "500" }}>
                    {request}
                </span>
            </span>
            <span className={cn(styles.foot)}>
                <span style={{ flex: "1", color: "var(--muted-foreground)" }}>
                    {next}
                </span>
                <span
                    style={{
                        fontWeight: "500",
                        color: "var(--accent-foreground)",
                    }}>
                    {actionLabel}
                </span>
            </span>
        </Button>
    );
}
