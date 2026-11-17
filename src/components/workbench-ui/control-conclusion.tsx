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
        well: styles.supportedIcon,
    },
    conflict: {
        title: "Documentary conflict",
        tone: "counter",
        icon: "conflict",
        stroke: 1.6,
        badgeStroke: 2,
        well: styles.conflictIcon,
    },
    unestablished: {
        title: "Not established",
        tone: "unknown",
        icon: "unestablished",
        stroke: 1.6,
        badgeStroke: 2,
        well: styles.unestablishedIcon,
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
            <div className={cn("wb-dashed", styles.hatch, styles.pendingCard)}>
                <div className={styles.pendingHeader}>
                    <span className="wb-label">Execution outcome</span>
                </div>
                <div className={styles.pendingBody}>
                    <span
                        className={cn(
                            "wb-well",
                            "wb-well-lg",
                            styles.pendingIcon,
                        )}>
                        <WorkbenchIcon
                            name="clock"
                            size={22}
                            strokeWidth={1.6}
                        />
                    </span>
                    <span className={styles.heading}>
                        <b className={styles.pendingTitle}>Unfinished check</b>
                        <span className={styles.description}>{children}</span>
                    </span>
                    <span className={styles.pendingActions}>
                        <Badge tone="dashed">
                            <WorkbenchIcon
                                name="unfinished-check"
                                size={12}
                                strokeWidth={2}
                            />
                            Unfinished check
                        </Badge>
                        <span className="wb-meta">{detail}</span>
                    </span>
                </div>
            </div>
        );
    const conclusion = conclusions[kind];
    return (
        <div className={styles.conclusionCard}>
            <span className={cn("wb-well wb-well-lg", conclusion.well)}>
                <WorkbenchIcon
                    name={conclusion.icon}
                    size={22}
                    strokeWidth={conclusion.stroke}
                />
            </span>
            <span className={styles.heading}>
                <b className={styles.conclusionTitle}>{conclusion.title}</b>
                <span className={styles.description}>{children}</span>
            </span>
            <span className={styles.footer}>
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
