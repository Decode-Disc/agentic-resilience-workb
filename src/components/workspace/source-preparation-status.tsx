import type { api } from "@convex/_generated/api";
import {
    AlertCircleIcon,
    ArrowUpRight01Icon,
    CheckmarkCircle02Icon,
    InformationCircleIcon,
    Loading03Icon,
} from "@hugeicons/core-free-icons";
import type { FunctionReturnType } from "convex/server";
import { AnimatePresence, motion } from "motion/react";
import Icon from "@/components/icon";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { Progress, ProgressLabel } from "@/components/ui/progress";
import { ResponsivePopover } from "@/components/ui/responsive-popover";
import { useMediaQuery } from "@/hooks/use-responsive";
import { sourcePreparationCopy } from "@/lib/presentation/research-copy";
import { cn } from "@/lib/utils";

type Summary = NonNullable<
    FunctionReturnType<typeof api.sourceSelectionProposals.getCurrent>
>;
type Source = FunctionReturnType<
    typeof api.sourceSelectionProposals.getAdjustmentSets
>["included"][number];

/** Makes saved work, the active phase and the handoff to analyst review legible without simulating progress. */
export function SourcePreparationStatus({
    preparation,
    revisionStatus,
    sources,
}: {
    preparation: NonNullable<Summary["preparation"]>;
    revisionStatus: Summary["revisionStatus"];
    sources: readonly Source[];
}) {
    const copy = sourcePreparationCopy(preparation, revisionStatus);
    const reduceMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
    const active = preparation.status === "started";
    const unavailable = sources.filter(
        (source) =>
            source.decision !== "rejected" &&
            ["reading_failed", "assessment_unavailable"].includes(
                source.readingStatus ?? "",
            ),
    );
    const phase = preparation.progress;
    const savedWithoutAssessment =
        preparation.captured === undefined
            ? 0
            : preparation.captured - (preparation.assessed ?? 0);
    const progress =
        phase?.phase === "comparison" &&
        phase.current !== undefined &&
        phase.total !== undefined &&
        phase.total > 0
            ? {
                  label: "Source comparison progress",
                  current: phase.current,
                  total: phase.total,
                  text: `${phase.current} of ${phase.total} source comparisons checked`,
              }
            : (!phase || phase.phase === "reading") && preparation.total > 0
              ? {
                    label: "Source reading progress",
                    current: preparation.checked,
                    total: preparation.total,
                    text: `${preparation.checked} of ${preparation.total} sources checked`,
                }
              : null;
    const icon = active
        ? Loading03Icon
        : copy.status === "success"
          ? CheckmarkCircle02Icon
          : copy.status === "warning" || copy.status === "danger"
            ? AlertCircleIcon
            : InformationCircleIcon;
    return (
        <motion.div
            layout="position"
            transition={{ duration: reduceMotion ? 0 : 0.2 }}
            role={copy.status === "danger" ? "alert" : "status"}
            aria-label={copy.title}
            className="space-y-3 border-t border-border/60 pt-4">
            <div className="flex flex-wrap items-start justify-between gap-x-5 gap-y-2">
                <div className="flex min-w-0 items-start gap-3">
                    <span
                        className={cn(
                            "relative mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-muted/65 text-muted-foreground transition-colors duration-200 motion-reduce:transition-none",
                            copy.status === "success" &&
                                "bg-success/10 text-success-foreground dark:text-success",
                            copy.status === "warning" &&
                                "bg-warning/10 text-warning-foreground dark:text-warning",
                            copy.status === "danger" &&
                                "bg-destructive/10 text-destructive",
                        )}>
                        <AnimatePresence initial={false} mode="popLayout">
                            <motion.span
                                key={
                                    active
                                        ? (phase?.phase ?? "reading")
                                        : copy.status
                                }
                                initial={{
                                    opacity: 0,
                                    rotate: reduceMotion ? 0 : -18,
                                }}
                                animate={{ opacity: 1, rotate: 0 }}
                                exit={{ opacity: 0 }}
                                transition={{ duration: 0.2 }}>
                                <Icon iconNode={icon} size={17} />
                            </motion.span>
                        </AnimatePresence>
                    </span>
                    <div className="min-w-0 space-y-1">
                        <AnimatePresence initial={false} mode="popLayout">
                            <motion.p
                                key={copy.title}
                                initial={{
                                    opacity: 0,
                                    y: reduceMotion ? 0 : 3,
                                }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.2 }}
                                className="text-sm font-medium leading-snug">
                                {copy.title}
                            </motion.p>
                        </AnimatePresence>
                        <p className="max-w-prose text-xs leading-relaxed text-muted-foreground">
                            {copy.description}
                        </p>
                    </div>
                </div>
                {preparation.lastActivityAt ? (
                    <time
                        dateTime={new Date(
                            preparation.lastActivityAt,
                        ).toISOString()}
                        className="text-xs tabular-nums text-muted-foreground">
                        Last activity{" "}
                        {new Date(
                            preparation.lastActivityAt,
                        ).toLocaleTimeString("en-US", {
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit",
                            hour12: false,
                        })}
                    </time>
                ) : null}
            </div>
            <Collapsible open={active && progress !== null}>
                <CollapsibleContent>
                    {progress ? (
                        <Progress
                            key={progress.label}
                            aria-label={progress.label}
                            value={progress.current}
                            max={progress.total}
                            getAriaValueText={() => progress.text}
                            className="gap-y-2 pb-1 [&_[data-slot=progress-track]]:h-1.5 [&_[data-slot=progress-indicator]]:duration-300 motion-reduce:[&_[data-slot=progress-indicator]]:transition-none">
                            <ProgressLabel className="text-xs text-muted-foreground">
                                {progress.label}
                            </ProgressLabel>
                            <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                                {progress.text}
                            </span>
                        </Progress>
                    ) : null}
                </CollapsibleContent>
            </Collapsible>
            {preparation.captured === undefined ? (
                <p className="text-xs tabular-nums text-muted-foreground">
                    {copy.counts}
                </p>
            ) : (
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs tabular-nums text-muted-foreground">
                    <span>
                        {preparation.assessed
                            ? `${preparation.assessed} ${preparation.assessed === 1 ? "source" : "sources"} read and assessed`
                            : "No sources assessed yet"}
                    </span>
                    {savedWithoutAssessment > 0 ? (
                        <span>
                            {savedWithoutAssessment} saved without assessment
                        </span>
                    ) : null}
                    {unavailable.length ? (
                        <ResponsivePopover
                            title="Sources that could not be fully prepared"
                            description="Review the original documents and the saved readings before deciding whether to include them."
                            closeLabel="Close source limitations"
                            trigger={
                                <Button
                                    variant="link"
                                    className="h-auto min-h-6 p-0 text-xs text-warning-foreground dark:text-warning">
                                    Review {unavailable.length} unavailable{" "}
                                    {unavailable.length === 1
                                        ? "source"
                                        : "sources"}
                                </Button>
                            }>
                            <ul className="max-w-sm space-y-4">
                                {unavailable.map((source) => (
                                    <li
                                        key={source.sourceId}
                                        className="space-y-1 text-sm">
                                        <p className="font-medium">
                                            {source.title}
                                        </p>
                                        <p className="text-xs leading-relaxed text-muted-foreground">
                                            {source.readingStatus ===
                                            "assessment_unavailable"
                                                ? "Content was saved, but its assessment could not finish. The saved reading remains available."
                                                : "Content could not be read. Review the original document before relying on it."}
                                        </p>
                                        <a
                                            href={source.canonicalUrl}
                                            aria-label={`Open original: ${source.title}`}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="inline-flex min-h-9 items-center gap-1 text-xs underline underline-offset-4">
                                            Open original{" "}
                                            <Icon
                                                iconNode={ArrowUpRight01Icon}
                                                size={13}
                                            />
                                        </a>
                                    </li>
                                ))}
                            </ul>
                        </ResponsivePopover>
                    ) : preparation.failed ? (
                        <span>{preparation.failed} unavailable</span>
                    ) : null}
                    {preparation.pendingComparisons ? (
                        <span>
                            {preparation.pendingComparisons}{" "}
                            {preparation.pendingComparisons === 1
                                ? "source comparison needs"
                                : "source comparisons need"}{" "}
                            review
                        </span>
                    ) : null}
                    {preparation.remaining ? (
                        <span>
                            {preparation.remaining}{" "}
                            {preparation.remaining === 1 ? "source" : "sources"}{" "}
                            still to prepare
                        </span>
                    ) : null}
                    {preparation.excluded ? (
                        <span>
                            {preparation.excluded}{" "}
                            {preparation.excluded === 1 ? "source" : "sources"}{" "}
                            excluded
                        </span>
                    ) : null}
                </div>
            )}
        </motion.div>
    );
}
