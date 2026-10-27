import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import styles from "./control-conclusion.module.css";
import { WorkbenchIcon } from "./glyphs";

const conclusions = {
    supported: {
        title: "Supported",
        tone: "ink",
        icon: "check",
        stroke: 1.8,
        badgeStroke: 2.2,
        well: {
            background: "var(--primary)",
            color: "var(--primary-foreground)",
            boxShadow: "inset 0 1px 0 oklch(1 0 0 / .22)",
        },
    },
    conflict: {
        title: "Documentary conflict",
        tone: "counter",
        icon: "conflict",
        stroke: 1.6,
        badgeStroke: 2,
        well: {
            background: "var(--tint-counter)",
            color: "var(--counter-evidence)",
            boxShadow:
                "inset 0 0 0 1px color-mix(in oklab,var(--counter-evidence) 24%,transparent)",
        },
    },
    unestablished: {
        title: "Not established",
        tone: "unknown",
        icon: "unestablished",
        stroke: 1.6,
        badgeStroke: 2,
        well: {
            background: "var(--tint-unknown)",
            color: "var(--evidence-unknown)",
            boxShadow:
                "inset 0 0 0 1px color-mix(in oklab,var(--foreground) 12%,transparent)",
        },
    },
} as const;
export interface ControlConclusionProps {
    kind: keyof typeof conclusions | "unfinished";
    children: ReactNode;
    detail: string;
}
export function ControlConclusion({
    kind,
    children,
    detail,
}: ControlConclusionProps) {
    if (kind === "unfinished")
        return (
            <div
                className={cn("wb-dashed", styles.hatch)}
                style={{
                    borderRadius: "var(--radius-2xl)",
                    display: "flex",
                    flexDirection: "column",
                }}>
                <div
                    style={{
                        padding: "14px 22px",
                        borderBottom:
                            "1px dashed color-mix(in oklab,var(--foreground) 14%,transparent)",
                    }}>
                    <span className={cn("wb-label")}>Execution outcome</span>
                </div>
                <div
                    style={{
                        padding: "24px 22px",
                        display: "flex",
                        flexDirection: "column",
                        gap: "14px",
                        flex: "1",
                    }}>
                    <span
                        className={cn("wb-well", "wb-well-lg")}
                        style={{
                            border: "1.5px dashed var(--edge-dashed)",
                            color: "var(--muted-foreground)",
                        }}>
                        <WorkbenchIcon
                            name="clock"
                            size={22}
                            strokeWidth={1.6}
                        />
                    </span>
                    <span
                        style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: "6px",
                        }}>
                        <b
                            style={{
                                fontSize: "17px",
                                letterSpacing: "-.02em",
                                color: "var(--muted-foreground)",
                            }}>
                            Unfinished check
                        </b>
                        <span className={cn(styles.d)}>{children}</span>
                    </span>
                    <span
                        style={{
                            marginTop: "auto",
                            display: "flex",
                            flexDirection: "column",
                            gap: "8px",
                            alignItems: "flex-start",
                        }}>
                        <Badge tone="dashed">
                            <WorkbenchIcon
                                name="unfinished-check"
                                size={12}
                                strokeWidth={2}
                            />
                            Unfinished check
                        </Badge>
                        <span className={cn("wb-meta")}>{detail}</span>
                    </span>
                </div>
            </div>
        );
    const conclusion = conclusions[kind];
    return (
        <div
            style={{
                padding: 24,
                display: "flex",
                flexDirection: "column",
                gap: 14,
            }}>
            <span className="wb-well wb-well-lg" style={conclusion.well}>
                <WorkbenchIcon
                    name={conclusion.icon}
                    size={22}
                    strokeWidth={conclusion.stroke}
                />
            </span>
            <span style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <b style={{ fontSize: 17, letterSpacing: "-.02em" }}>
                    {conclusion.title}
                </b>
                <span className={styles.d}>{children}</span>
            </span>
            <span className={styles.ft}>
                <Badge tone={conclusion.tone}>
                    <WorkbenchIcon
                        name={conclusion.icon}
                        size={12}
                        strokeWidth={conclusion.badgeStroke}
                    />
                    {conclusion.title}
                </Badge>
                <span className="wb-meta">{detail}</span>
            </span>
        </div>
    );
}
