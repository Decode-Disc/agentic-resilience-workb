import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { EvidenceBadge, WorkbenchIcon } from "./glyphs";
import styles from "./hypothesis-node.module.css";

const treatments = {
    holds: styles.held,
    open: styles.open,
    "set-aside": styles.setAside,
};
export interface HypothesisNodeProps {
    state: keyof typeof treatments;
    children: ReactNode;
    detail: string;
}
export function HypothesisNode({
    state,
    children,
    detail,
}: HypothesisNodeProps) {
    return (
        <div className={cn(styles.hypothesis, treatments[state])}>
            <span>
                {state === "holds" ? (
                    <Badge className={styles.waitingIcon}>
                        <WorkbenchIcon
                            name="check"
                            size={11}
                            strokeWidth={2.6}
                        />
                        Holds · current reading
                    </Badge>
                ) : state === "open" ? (
                    <Badge tone="review">
                        <svg
                            width="7"
                            height="7"
                            viewBox="0 0 10 10"
                            className={styles.statusDot}
                            aria-hidden="true">
                            <circle cx="5" cy="5" r="5" fill="var(--review)" />
                        </svg>
                        Open · needs material
                    </Badge>
                ) : (
                    <Badge tone="unknown">
                        <WorkbenchIcon
                            name="barred"
                            size={11}
                            strokeWidth={2}
                        />
                        Set aside
                    </Badge>
                )}
            </span>
            <b
                className={cn(
                    state !== "holds" && styles.inactiveTitle,
                    state === "set-aside" && styles.struckTitle,
                )}>
                {children}
            </b>
            <span className={styles.description}>{detail}</span>
        </div>
    );
}
export function EvidenceLeaf({
    relation,
    children,
}: {
    relation: "for" | "against" | "decides";
    children: ReactNode;
}) {
    const unknown = relation === "decides";
    return (
        <div
            className={cn(
                styles.leaf,
                !unknown && "wb-raised",
                unknown
                    ? styles.unknownLeaf
                    : relation === "against" && styles.opposingLeaf,
            )}>
            <span>
                {unknown ? (
                    <Badge tone="dashed">Unknown</Badge>
                ) : (
                    <EvidenceBadge
                        kind={relation === "for" ? "fact" : "counter"}>
                        {relation === "against" ? "Counter" : undefined}
                    </EvidenceBadge>
                )}{" "}
                <span
                    className={cn(
                        styles.role,
                        unknown
                            ? styles.unknownRole
                            : relation === "for"
                              ? styles.supportingRole
                              : styles.opposingRole,
                    )}>
                    {relation}
                </span>
            </span>
            {unknown ? (
                <span className={styles.inactiveTitle}>{children}</span>
            ) : (
                children
            )}
        </div>
    );
}
