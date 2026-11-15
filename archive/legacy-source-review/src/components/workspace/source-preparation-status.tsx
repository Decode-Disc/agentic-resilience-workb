import type { api } from "@convex/_generated/api";
import {
    AlertCircleIcon,
    ArrowDown01Icon,
    ArrowUpRight01Icon,
    CheckmarkCircle02Icon,
} from "@hugeicons/core-free-icons";
import type { FunctionReturnType } from "convex/server";
import {
    type RefObject,
    useCallback,
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
} from "react";
import { BackgroundRuns } from "@/components/ai/background-runs";
import { JobProgressTrack } from "@/components/ai/job-progress";
import Icon from "@/components/icon";
import { Button } from "@/components/ui/button";
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ResponsivePopover } from "@/components/ui/responsive-popover";
import { useMediaQuery } from "@/hooks/use-responsive";
import {
    sourcePreparationCopy,
    sourcePreparationStages,
} from "@/lib/presentation/research-copy";
import { cn } from "@/lib/utils";

type Summary = NonNullable<
    FunctionReturnType<typeof api.sourceSelectionProposals.getCurrent>
>;
type Source = FunctionReturnType<
    typeof api.sourceSelectionProposals.getAdjustmentSets
>["included"][number];

/** Keeps completed work visible and hands the screen back to review without moving the selected reading. */
export function SourcePreparationStatus({
    preparation,
    revisionStatus,
    sources,
    readingAnchorRef,
}: {
    preparation: NonNullable<Summary["preparation"]>;
    revisionStatus: Summary["revisionStatus"];
    sources: readonly Source[];
    readingAnchorRef?: RefObject<HTMLElement | null>;
}) {
    const copy = sourcePreparationCopy(preparation, revisionStatus);
    const journey = sourcePreparationStages(preparation);
    const active = preparation.status === "started";
    const approved = revisionStatus === "approved";
    const terminalReview =
        !active && journey.published && preparation.status !== "blocked";
    const [open, setOpen] = useState(!terminalReview);
    const [stableCollapse, setStableCollapse] = useState(false);
    const previouslyActive = useRef(active);
    const contentRef = useRef<HTMLDivElement>(null);
    const pendingAnchor = useRef<{ element: HTMLElement; top: number } | null>(
        null,
    );
    const readingSnapshot = useRef<{
        element: HTMLElement;
        top: number;
    } | null>(null);
    const reduceMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
    const title = copy.title;
    const unavailable = sources.filter(
        (source) =>
            source.decision !== "rejected" &&
            ["reading_failed", "assessment_unavailable"].includes(
                source.readingStatus ?? "",
            ),
    );
    const savedWithoutAssessment =
        preparation.captured === undefined
            ? 0
            : Math.max(0, preparation.captured - (preparation.assessed ?? 0));

    const rememberReadingPosition = useCallback(() => {
        const element = readingAnchorRef?.current;
        const rect = element?.getBoundingClientRect();
        readingSnapshot.current =
            element &&
            rect &&
            window.scrollY > 0 &&
            rect.bottom > 0 &&
            rect.top < window.innerHeight
                ? { element, top: rect.top }
                : null;
    }, [readingAnchorRef]);
    useLayoutEffect(() => {
        if (active && preparation.progress?.updatedAt !== undefined)
            rememberReadingPosition();
    }, [active, preparation.progress?.updatedAt, rememberReadingPosition]);
    useEffect(() => {
        if (!active) return;
        rememberReadingPosition();
        window.addEventListener("scroll", rememberReadingPosition, {
            passive: true,
        });
        window.addEventListener("resize", rememberReadingPosition);
        return () => {
            window.removeEventListener("scroll", rememberReadingPosition);
            window.removeEventListener("resize", rememberReadingPosition);
        };
    }, [active, rememberReadingPosition]);
    const collapseForReview = useCallback(() => {
        if (contentRef.current?.contains(document.activeElement)) return;
        if (
            readingSnapshot.current &&
            readingSnapshot.current.element === readingAnchorRef?.current
        ) {
            pendingAnchor.current = readingSnapshot.current;
            setStableCollapse(true);
        }
        setOpen(false);
    }, [readingAnchorRef]);
    useLayoutEffect(() => {
        if (active && !previouslyActive.current) {
            setStableCollapse(false);
            setOpen(true);
        } else if (!active && previouslyActive.current && terminalReview) {
            collapseForReview();
        }
        previouslyActive.current = active;
    }, [active, terminalReview, collapseForReview]);
    useLayoutEffect(() => {
        if (open || !pendingAnchor.current) return;
        const anchor = pendingAnchor.current;
        pendingAnchor.current = null;
        const delta = anchor.element.getBoundingClientRect().top - anchor.top;
        if (delta && window.scrollY > 0)
            window.scrollTo(0, Math.max(0, window.scrollY + delta));
    }, [open]);

    return (
        <section
            role={
                copy.status === "danger" && !terminalReview
                    ? "alert"
                    : undefined
            }
            aria-label={title}
            className="flex flex-col gap-3 border-t border-border/60 pt-3">
            <p role="status" aria-live="polite" className="sr-only">
                {active
                    ? `Step ${journey.step} of 3. ${copy.title}.`
                    : terminalReview
                      ? "Preparation finished. Review the source proposal."
                      : `${copy.title}.`}
            </p>
            {!active && !terminalReview && !approved ? (
                <p className="text-sm font-medium">{copy.title}</p>
            ) : null}
            <Collapsible
                open={open}
                animated={!stableCollapse && !reduceMotion}
                onOpenChange={(nextOpen) => {
                    setStableCollapse(false);
                    setOpen(nextOpen);
                }}>
                {terminalReview || approved ? (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                        <span
                            className={cn(
                                "flex items-center gap-2 text-sm font-medium",
                                copy.status === "warning"
                                    ? "text-warning-foreground dark:text-warning"
                                    : "text-foreground",
                            )}>
                            <Icon
                                iconNode={
                                    copy.status === "warning"
                                        ? AlertCircleIcon
                                        : CheckmarkCircle02Icon
                                }
                                className={cn(
                                    "size-4",
                                    copy.status === "success" &&
                                        "text-success-foreground dark:text-success",
                                )}
                            />
                            {title}
                        </span>
                        <CollapsibleTrigger
                            render={
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-auto gap-2 px-1 py-0 text-xs text-muted-foreground"
                                />
                            }>
                            {open
                                ? "Hide preparation details"
                                : "View preparation details"}
                            <Icon
                                iconNode={ArrowDown01Icon}
                                className={cn(
                                    "size-3 transition-transform motion-reduce:transition-none",
                                    open && "rotate-180",
                                )}
                            />
                        </CollapsibleTrigger>
                    </div>
                ) : null}
                <CollapsibleContent
                    className={cn(stableCollapse && !open && "hidden")}
                    ref={contentRef}
                    onBlurCapture={(event) => {
                        if (
                            terminalReview &&
                            !event.currentTarget.contains(
                                event.relatedTarget as Node | null,
                            )
                        )
                            collapseForReview();
                    }}>
                    <BackgroundRuns
                        animated={!reduceMotion}
                        title="Source preparation"
                        summary={
                            active
                                ? `Step ${journey.step} of 3`
                                : terminalReview
                                  ? "Preparation finished"
                                  : "Needs attention"
                        }
                        listLabel="Preparation stages"
                        variant="embedded"
                        items={journey.stages.map((stage) => ({
                            ...stage,
                            status:
                                stage.status === "pending"
                                    ? "queued"
                                    : stage.status,
                        }))}
                        className="[&_[data-slot=background-runs-header]]:px-0 [&_[data-slot=background-runs-header]]:pt-0 [&_[data-slot=background-runs-list]]:gap-0 [&_[data-slot=background-runs-list]]:border-0 [&_[data-slot=background-runs-list]]:px-0 [&_[data-slot=background-run]]:px-0 [&_[data-slot=background-run]]:py-1.5 [&_[data-slot=background-run-content]]:relative [&_[data-slot=background-run-content]]:lg:grid [&_[data-slot=background-run-content]]:lg:grid-cols-[minmax(13rem,16rem)_minmax(0,1fr)] [&_[data-slot=background-run-content]]:lg:items-baseline [&_[data-slot=background-run-content]]:lg:gap-x-4 [&_[data-slot=background-run-content]]:lg:pr-16 [&_[data-slot=background-run-heading]]:lg:contents [&_[data-slot=background-run-meta]]:lg:absolute [&_[data-slot=background-run-meta]]:lg:right-0 [&_[data-slot=background-run-meta]]:lg:top-0.5 [&_[data-slot=background-run-detail]]:lg:mt-0">
                        <JobProgressTrack
                            stages={journey.stages}
                            className="mb-3"
                        />
                    </BackgroundRuns>
                    {preparation.lastActivityAt ? (
                        <time
                            dateTime={new Date(
                                preparation.lastActivityAt,
                            ).toISOString()}
                            className="mt-2 block text-xs tabular-nums text-muted-foreground">
                            Last activity{" "}
                            {new Date(
                                preparation.lastActivityAt,
                            ).toLocaleTimeString("en-US", {
                                hour: "2-digit",
                                minute: "2-digit",
                                hour12: false,
                            })}
                        </time>
                    ) : null}
                </CollapsibleContent>
            </Collapsible>
            {terminalReview &&
            !approved &&
            (preparation.failed || preparation.pendingComparisons) ? (
                <p className="text-xs text-muted-foreground">
                    Review the saved readings and limitations before approving.
                </p>
            ) : null}
            {!active && (!terminalReview || approved) ? (
                <p className="max-w-prose text-xs leading-relaxed text-muted-foreground">
                    {copy.description}
                </p>
            ) : null}
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
        </section>
    );
}
