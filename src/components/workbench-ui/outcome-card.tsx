import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { WorkbenchIcon } from "./glyphs";
import styles from "./outcome-card.module.css";

const treatments = {
    appraisal: {
        icon: "document-check",
    },
    insufficiency: {
        icon: "document-minus",
    },
    limited: {
        icon: "half",
    },
    "non-establishment": {
        icon: "barred",
    },
    pending: {
        icon: null,
    },
    "no-retained": {
        icon: "lock",
    },
    unfinished: {
        icon: "unfinished",
    },
    interruption: {
        icon: "warning",
    },
} as const;
export type OutcomeKind = keyof typeof treatments;
export interface OutcomeCardProps {
    kind: OutcomeKind;
    title: string;
    children: ReactNode;
    next: string;
}
/** Named presentation states; the caller supplies the outcome and its explanation. */
export function OutcomeCard({ kind, title, children, next }: OutcomeCardProps) {
    const treatment = treatments[kind];
    const unfinished = kind === "unfinished" || kind === "interruption";
    return (
        <div
            data-outcome={kind}
            className={cn(
                unfinished ? "wb-dashed" : "wb-glass",
                kind === "pending" && "wb-waits",
                styles.o,
            )}>
            <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span className={cn("wb-well", styles.well)}>
                    {treatment.icon ? (
                        <WorkbenchIcon
                            name={treatment.icon}
                            size={18}
                            strokeWidth={1.6}
                        />
                    ) : (
                        <svg
                            width="14"
                            height="14"
                            viewBox="0 0 10 10"
                            style={{ width: 14, height: 14 }}
                            aria-hidden="true">
                            <circle cx="5" cy="5" r="5" fill="currentColor" />
                        </svg>
                    )}
                </span>
                <b
                    style={{
                        fontSize: 15,
                    }}>
                    {title}
                </b>
            </span>
            <span className={styles.d}>{children}</span>
            <span className="wb-meta">{next}</span>
        </div>
    );
}
