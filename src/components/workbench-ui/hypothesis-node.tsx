import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { EvidenceBadge, WorkbenchIcon } from "./glyphs";
import styles from "./hypothesis-node.module.css";

const treatments = {
    holds: {
        background:
            "linear-gradient(160deg,color-mix(in oklab,var(--brand-purple) 14%,var(--card)),var(--card) 70%)",
        boxShadow:
            "inset 0 1px 0 color-mix(in oklab,var(--popover) 90%,transparent),0 0 0 2px var(--brand-purple),0 24px 50px -22px color-mix(in oklab,var(--brand-purple) 65%,transparent)",
    },
    open: {
        background: "color-mix(in oklab,var(--review) 9%,var(--card))",
        border: "1.5px dashed var(--review-foreground)",
    },
    "set-aside": {
        background: "var(--surface-glass)",
        boxShadow:
            "0 0 0 1px color-mix(in oklab,var(--foreground) 12%,transparent)",
        color: "var(--muted-foreground)",
    },
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
        <div className={styles.hyp} style={treatments[state]}>
            <span>
                {state === "holds" ? (
                    <Badge
                        style={{
                            color: "var(--primary-foreground)",
                            background: "var(--brand-purple)",
                        }}>
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
                            style={{ width: 7, height: 7 }}
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
                style={
                    state === "holds"
                        ? undefined
                        : {
                              fontWeight: 500,
                              ...(state === "set-aside"
                                  ? {
                                        color: "var(--foreground)",
                                        textDecoration: "line-through",
                                        textDecorationColor:
                                            "color-mix(in oklab,var(--foreground) 35%,transparent)",
                                    }
                                  : {}),
                          }
                }>
                {children}
            </b>
            <span className={styles.sub}>{detail}</span>
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
            className={cn(styles.leaf, !unknown && "wb-raised")}
            style={
                unknown
                    ? { border: "1.5px dashed var(--edge-dashed)" }
                    : relation === "against"
                      ? {
                            boxShadow:
                                "0 0 0 1px color-mix(in oklab,var(--counter-evidence) 35%,transparent),var(--shadow-raised)",
                        }
                      : undefined
            }>
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
                    className={styles.role}
                    style={{
                        color: unknown
                            ? "var(--muted-foreground)"
                            : relation === "for"
                              ? "var(--evidence-fact)"
                              : "var(--counter-evidence)",
                    }}>
                    {relation}
                </span>
            </span>
            {unknown ? (
                <span style={{ fontWeight: 500 }}>{children}</span>
            ) : (
                children
            )}
        </div>
    );
}
