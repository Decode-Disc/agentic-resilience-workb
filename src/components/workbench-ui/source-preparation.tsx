import { type ComponentProps, type ReactNode, useId } from "react";
import { cn } from "@/lib/utils";
import styles from "./source-preparation.module.css";

export interface PreparationMetric {
    id: string;
    value: ReactNode;
    label: string;
    /** Secondary figures are muted next to the primary result. */
    quiet?: boolean;
}

/** One preparation stage with its supplied results; it does not infer completion. */
export function PreparationStageCard({
    step,
    title,
    description,
    metrics,
    footnote,
    emphasis = "ordinary",
    className,
    children,
    ...props
}: Omit<ComponentProps<"section">, "title"> & {
    step: string;
    title: ReactNode;
    description: ReactNode;
    metrics: readonly PreparationMetric[];
    footnote?: ReactNode;
    emphasis?: "ordinary" | "focal";
}) {
    const titleId = useId();
    return (
        <section
            {...props}
            aria-labelledby={titleId}
            className={cn(
                "wb-glass",
                emphasis === "focal" && ["wb-focal", styles.focal],
                styles.stage,
                className,
            )}>
            <span className={styles.header}>
                <span className={styles.step} aria-hidden="true">
                    {step}
                </span>
                <span className={styles.titles}>
                    <h2 id={titleId} className={styles.title}>
                        {title}
                    </h2>
                    <span className={styles.description}>{description}</span>
                </span>
            </span>
            <dl className={styles.metrics}>
                {metrics.map((metric) => (
                    <div
                        key={metric.id}
                        className={styles.metric}
                        data-quiet={metric.quiet || undefined}>
                        <dt className="wb-meta">{metric.label}</dt>
                        <dd>{metric.value}</dd>
                    </div>
                ))}
            </dl>
            {children}
            {footnote && (
                <span className={cn("wb-meta", styles.footnote)}>
                    {footnote}
                </span>
            )}
        </section>
    );
}

/** Ruled list shared by preparation stages and question coverage. */
export function PreparationRows({ children }: { children: ReactNode }) {
    return <ul className={styles.rows}>{children}</ul>;
}

export function PreparationStageRow({
    leading,
    meta,
    muted = false,
    children,
}: {
    leading?: ReactNode;
    meta?: ReactNode;
    muted?: boolean;
    children: ReactNode;
}) {
    return (
        <li className={styles.row} data-muted={muted || undefined}>
            {leading}
            <span className={styles.rowText}>{children}</span>
            {meta && <span className="wb-meta">{meta}</span>}
        </li>
    );
}

/** A disclosed documentary limitation; unfinished work keeps a dashed frame. */
export function DisclosedLimitation({
    cause,
    scope,
    unfinished = false,
    children,
}: {
    cause: ReactNode;
    scope: ReactNode;
    unfinished?: boolean;
    children: ReactNode;
}) {
    return (
        <li
            className={styles.limitation}
            data-unfinished={unfinished || undefined}>
            <span className={styles.limitationHead}>
                {cause}
                <span className="wb-meta">{scope}</span>
            </span>
            <span className={styles.limitationText}>{children}</span>
        </li>
    );
}
