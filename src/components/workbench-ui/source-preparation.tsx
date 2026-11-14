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
            <span className={styles.head}>
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

/** A framed question with its supplied documentary coverage status and any limitation attached to it. */
export function QuestionCoverageRow({
    label,
    question,
    meta,
    status,
    bar,
    size = "compact",
    children,
}: {
    label: string;
    question: ReactNode;
    meta: ReactNode;
    status: ReactNode;
    /** Optional proportional view of the same figures as `meta`. */
    bar?: ReactNode;
    size?: "compact" | "prominent";
    children?: ReactNode;
}) {
    return (
        <li
            className={cn(styles.row, styles.coverage)}
            data-size={size === "prominent" || undefined}>
            <span className={styles.coverageLine}>
                <span className={styles.questionId}>{label}</span>
                <span className={styles.question}>{question}</span>
                {bar && <span className={styles.coverageBar}>{bar}</span>}
                <span className={cn("wb-meta", styles.meta)}>{meta}</span>
                <span className={styles.status}>{status}</span>
            </span>
            {children && <span className={styles.attached}>{children}</span>}
        </li>
    );
}

/**
 * Contributing sources on a shared scale, with the opposing share marked.
 * The scale keeps questions comparable; it is not a completeness target.
 */
export function CoverageBar({
    contributing,
    opposing,
    scale,
}: {
    contributing: number;
    opposing: number;
    scale: number;
}) {
    const supporting = Math.max(0, contributing - opposing);
    return (
        <span className={styles.bar} aria-hidden="true">
            {supporting > 0 && (
                <span data-part="supporting" style={{ flex: supporting }} />
            )}
            {opposing > 0 && (
                <span data-part="opposing" style={{ flex: opposing }} />
            )}
            <span style={{ flex: Math.max(0, scale - contributing) }} />
        </span>
    );
}

/** A limitation shown beside the question it affects. */
export function AttachedLimitation({
    cause,
    tone = "review",
    children,
}: {
    cause: ReactNode;
    /** Follows the Badge tone used for the same cause elsewhere. */
    tone?: "review" | "destructive";
    children: ReactNode;
}) {
    return (
        <span className={styles.attachedLimitation} data-tone={tone}>
            <span className={styles.attachedCause}>{cause}</span>
            <span>{children}</span>
        </span>
    );
}

/** One numbered step of a preparation summary, with an optional way into its detail. */
export function PreparationSummaryStep({
    marker,
    tone = "ordinary",
    title,
    description,
    action,
    children,
}: {
    marker: ReactNode;
    tone?: "ordinary" | "attention";
    title: ReactNode;
    description?: ReactNode;
    action?: ReactNode;
    children?: ReactNode;
}) {
    const titleId = useId();
    return (
        <li className={styles.summaryStep} aria-labelledby={titleId}>
            <span
                className={styles.summaryMarker}
                data-tone={tone}
                aria-hidden="true">
                {marker}
            </span>
            <span className={styles.summaryBody}>
                <span className={styles.summaryHead}>
                    <h3 id={titleId} className={styles.summaryTitle}>
                        {title}
                    </h3>
                    {action}
                </span>
                {description && (
                    <span className={styles.summaryDescription}>
                        {description}
                    </span>
                )}
                {children}
            </span>
        </li>
    );
}

/** Ordered container for PreparationSummaryStep. */
export function PreparationSummary({ children }: { children: ReactNode }) {
    return <ol className={cn("wb-glass", styles.summary)}>{children}</ol>;
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
