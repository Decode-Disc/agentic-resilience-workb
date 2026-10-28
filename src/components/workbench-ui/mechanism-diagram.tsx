import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";
import styles from "./mechanism-diagram.module.css";

/** Composes supplied nodes and relations on the mechanism canvas; selection content stays with the caller. */
export function MechanismDiagram({
    children,
    selection,
    coreLabel = "Core",
    conditionsLabel = "Conditions · threats",
    className,
    ...props
}: ComponentProps<"div"> & {
    selection?: ReactNode;
    coreLabel?: ReactNode;
    conditionsLabel?: ReactNode;
}) {
    return (
        <div
            {...props}
            data-mechanism-diagram=""
            className={cn(styles.diagram, className)}>
            <div className={styles.surface} aria-hidden="true" />
            <div className={styles.glow} aria-hidden="true" />
            <div className={styles.outerOrbit} aria-hidden="true" />
            <div className={styles.innerOrbit} aria-hidden="true" />
            <span className={cn(styles.label, styles.core)}>{coreLabel}</span>
            <span className={cn(styles.label, styles.conditions)}>
                {conditionsLabel}
            </span>
            {children}
            {selection && <div className={styles.selection}>{selection}</div>}
        </div>
    );
}
