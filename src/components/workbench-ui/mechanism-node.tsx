import { type CSSProperties, type ReactNode, useId } from "react";
import { cn } from "@/lib/utils";
import styles from "./mechanism-node.module.css";

export interface MechanismNodeProps {
    kind: "actor" | "observed" | "unknown";
    label: string;
    children: ReactNode;
    detail?: string;
    style?: CSSProperties;
}
export function MechanismNode({
    kind,
    label,
    children,
    detail,
    style,
}: MechanismNodeProps) {
    return kind === "actor" ? (
        <div
            className={cn(styles.node)}
            style={{
                width: "200px",
                height: "96px",
                boxShadow:
                    "inset 0 1px 0 color-mix(in oklab,var(--popover) 90%,transparent),0 0 0 1.5px var(--brand-purple),0 12px 26px -14px color-mix(in oklab,var(--brand-purple) 60%,transparent)",
                ...style,
            }}>
            <span>
                <span className={cn("wb-label")} style={{ fontSize: "10px" }}>
                    {label}
                </span>
                <br />
                <b style={{ fontWeight: "500" }}>{children}</b>
            </span>
        </div>
    ) : kind === "observed" ? (
        <div
            className={cn(styles.node)}
            style={{
                width: "194px",
                height: "112px",
                padding: "16px 20px",
                background: "var(--primary)",
                color: "var(--primary-foreground)",
                boxShadow:
                    "inset 0 1px 0 oklch(1 0 0 / .22),0 0 0 1px color-mix(in oklab,var(--brand-purple) 50%,transparent),0 0 0 7px color-mix(in oklab,var(--brand-purple) 12%,transparent),0 24px 60px -18px color-mix(in oklab,var(--brand-purple) 75%,transparent)",
                ...style,
            }}>
            <span>
                <span
                    className={cn("wb-label")}
                    style={{
                        fontSize: "10px",
                        color: "inherit",
                        opacity: ".7",
                    }}>
                    {label}
                </span>
                <br />
                <b
                    style={{
                        fontSize: "19px",
                        lineHeight: "26px",
                        letterSpacing: "-.02em",
                    }}>
                    {children}
                </b>
                <br />
                <span style={{ fontSize: "12px", opacity: ".7" }}>
                    {detail}
                </span>
            </span>
        </div>
    ) : (
        <div
            className={cn(styles.node)}
            style={{
                width: "182px",
                height: "96px",
                background: "transparent",
                boxShadow: "none",
                border: "1.5px dashed var(--edge-dashed)",
                color: "var(--muted-foreground)",
                ...style,
            }}>
            <span>
                <span className={cn("wb-label")} style={{ fontSize: "10px" }}>
                    {label}
                </span>
                <br />
                <b style={{ fontWeight: "500", color: "var(--foreground)" }}>
                    {children}
                </b>
            </span>
        </div>
    );
}
/** The screen supplies relation paths and labels; this layer never infers causation. */
export function MechanismRelations({
    width,
    height,
    relations,
}: {
    width: number;
    height: number;
    relations: readonly { id: string; path: string; uncertain?: boolean }[];
}) {
    const id = useId();
    return (
        <svg
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            aria-hidden="true"
            style={{ position: "absolute", inset: 0 }}>
            <defs>
                {[false, true].map((uncertain) => (
                    <marker
                        key={String(uncertain)}
                        id={`${id}-${uncertain}`}
                        viewBox="0 0 10 10"
                        refX="9"
                        refY="5"
                        markerWidth="7"
                        markerHeight="7"
                        orient="auto">
                        <path
                            d="M0 0L10 5L0 10z"
                            fill={
                                uncertain
                                    ? "var(--muted-foreground)"
                                    : "var(--brand-purple)"
                            }
                        />
                    </marker>
                ))}
            </defs>
            {relations.map((r) => (
                <path
                    key={r.id}
                    d={r.path}
                    stroke={
                        r.uncertain
                            ? "var(--muted-foreground)"
                            : "var(--brand-purple)"
                    }
                    strokeWidth={r.uncertain ? 1.5 : 2}
                    strokeDasharray={r.uncertain ? "5 4" : undefined}
                    fill="none"
                    markerEnd={`url(#${id}-${!!r.uncertain})`}
                />
            ))}
        </svg>
    );
}
