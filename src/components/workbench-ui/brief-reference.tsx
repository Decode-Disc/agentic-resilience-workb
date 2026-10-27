import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import styles from "./brief-reference.module.css";

export function BriefReference({
    kind,
    active = false,
    children,
    onActivate,
}: {
    kind: "mechanism" | "evidence";
    active?: boolean;
    children: ReactNode;
    onActivate: () => void;
}) {
    return (
        <button
            type="button"
            className={kind === "mechanism" ? styles.mref : styles.eref}
            onClick={onActivate}>
            {active && kind === "mechanism" ? (
                <svg
                    width="5"
                    height="5"
                    viewBox="0 0 10 10"
                    style={{ width: 5, height: 5 }}
                    aria-hidden="true">
                    <circle cx="5" cy="5" r="5" fill="var(--brand-purple)" />
                </svg>
            ) : null}
            {children}
        </button>
    );
}
export function BriefSection({
    label,
    title,
    children,
}: {
    label: string;
    title: string;
    children: ReactNode;
}) {
    return (
        <section className={styles.sec}>
            <span className="wb-label">{label}</span>
            <h2>{title}</h2>
            <p>{children}</p>
        </section>
    );
}
export function BriefMarginNote({
    label,
    children,
    status,
}: {
    label: string;
    children: ReactNode;
    status?: ReactNode;
}) {
    return (
        <aside className={cn(styles.note, "wb-raised")}>
            <span className="wb-label">{label}</span>
            <span style={{ fontSize: 13, lineHeight: "19px" }}>{children}</span>
            {status}
        </aside>
    );
}
