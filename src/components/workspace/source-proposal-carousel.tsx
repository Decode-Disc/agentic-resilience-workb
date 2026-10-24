import type { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
    ArrowLeft01Icon,
    ArrowRight01Icon,
    Search01Icon,
} from "@hugeicons/core-free-icons";
import type { FunctionReturnType } from "convex/server";
import { AnimatePresence, motion } from "motion/react";
import {
    type KeyboardEvent,
    type ReactNode,
    useEffect,
    useRef,
    useState,
} from "react";
import { FaviconAvatar } from "@/components/favicon-avatar";
import Icon from "@/components/icon";
import { Button } from "@/components/ui/button";
import {
    Empty,
    EmptyDescription,
    EmptyHeader,
    EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { SourceContextPanel } from "@/components/workspace/source-context-panel";
import { SourceDocumentKindBadge } from "@/components/workspace/source-family-badge";
import { toSourceContext } from "@/components/workspace/source-master-list";
import { SourceAdjustmentActions } from "@/components/workspace/source-proposal-adjustment-board";
import { useMediaQuery } from "@/hooks/use-responsive";
import {
    sourceMatchesSearch,
    sourceReadingStatusLabel,
} from "@/lib/presentation/research-copy";
import { cn } from "@/lib/utils";

type Source = FunctionReturnType<
    typeof api.sourceSelectionProposals.getAdjustmentSets
>["included"][number];
type ReaderProps = Parameters<typeof SourceContextPanel>[0];

/** Browses the complete bounded group and keeps one source reading in the overview. */
export function SourceProposalCarousel({
    items,
    group,
    runId,
    corpusRevisionId,
    readOnly,
    selectedId,
    selectedSource,
    onSelect,
    onDecide,
    annotation,
    toolbar,
}: {
    items: ReadonlyArray<Source>;
    group: Source["disposition"];
    runId?: Id<"researchRuns">;
    corpusRevisionId: Id<"corpusRevisions">;
    readOnly: boolean;
    selectedId?: Id<"sources"> | null;
    selectedSource?: ReaderProps["source"] | null;
    onSelect?: (sourceId: Id<"sources">) => void;
    onDecide: Parameters<typeof SourceAdjustmentActions>[0]["onDecide"];
    annotation: (source: Source) => ReactNode;
    toolbar: ReactNode;
}) {
    const reduceMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
    const [browsing, setBrowsing] = useState<{
        group: Source["disposition"];
        query: string;
        activeId: Id<"sources"> | null;
    }>({ group, query: "", activeId: null });
    // Reset group browsing without remounting the toolbar and losing keyboard focus.
    if (browsing.group !== group)
        setBrowsing({ group, query: "", activeId: null });
    const { query, activeId } = browsing;
    const cards = useRef(new Map<Id<"sources">, HTMLButtonElement>());
    const visible = items.filter((source) =>
        sourceMatchesSearch(source, query),
    );
    const active =
        visible.find((source) => source.sourceId === activeId) ?? visible[0];
    const activeIndex = active ? visible.indexOf(active) : -1;
    const activeSourceId = active?.sourceId;
    useEffect(() => {
        if (activeSourceId && selectedId !== activeSourceId)
            onSelect?.(activeSourceId);
    }, [activeSourceId, selectedId, onSelect]);
    const select = (index: number, focus = false) => {
        const next = visible[index];
        if (!next) return;
        setBrowsing((current) => ({ ...current, activeId: next.sourceId }));
        const card = cards.current.get(next.sourceId);
        card?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
        if (focus) card?.focus();
    };
    const handleKey = (
        event: KeyboardEvent<HTMLButtonElement>,
        index: number,
    ) => {
        const nextIndex =
            event.key === "ArrowRight"
                ? Math.min(visible.length - 1, index + 1)
                : event.key === "ArrowLeft"
                  ? Math.max(0, index - 1)
                  : event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? visible.length - 1
                      : undefined;
        if (nextIndex === undefined) return;
        event.preventDefault();
        select(nextIndex, true);
    };
    const detailMatches = activeSourceId === selectedId;
    return (
        <div className="min-w-0 space-y-4">
            <section
                aria-label="Source carousel"
                className="surface-panel min-w-0 overflow-hidden rounded-xl border border-border/60">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
                    <div className="min-w-0 flex-1">{toolbar}</div>
                    <div className="relative w-full sm:w-64">
                        <Icon
                            iconNode={Search01Icon}
                            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                        />
                        <Input
                            type="search"
                            aria-label="Search sources in this group"
                            placeholder="Search sources in this group…"
                            value={query}
                            onChange={(event) => {
                                const query = event.target.value;
                                setBrowsing((current) => ({
                                    ...current,
                                    query,
                                }));
                            }}
                            className="h-9 rounded-md bg-background pl-9"
                        />
                    </div>
                </div>
                {visible.length > 0 ? (
                    <>
                        <div className="flex gap-2 p-3 pb-1">
                            <Button
                                type="button"
                                variant="ghost"
                                aria-label="Previous source"
                                disabled={activeIndex <= 0}
                                onClick={() => select(activeIndex - 1)}
                                className="h-auto w-7 shrink-0 self-stretch rounded-md bg-muted/65 px-0">
                                <Icon iconNode={ArrowLeft01Icon} />
                            </Button>
                            <ul
                                aria-label="Sources in this group"
                                className="flex min-w-0 flex-1 snap-x gap-2 overflow-x-auto pb-2 [scrollbar-width:thin]">
                                {visible.map((source, index) => (
                                    <li
                                        key={source.sourceId}
                                        className="w-52 shrink-0 snap-start">
                                        <button
                                            ref={(node) => {
                                                if (node)
                                                    cards.current.set(
                                                        source.sourceId,
                                                        node,
                                                    );
                                                else
                                                    cards.current.delete(
                                                        source.sourceId,
                                                    );
                                            }}
                                            type="button"
                                            aria-label={`Open ${source.title} for review`}
                                            aria-pressed={
                                                source.sourceId ===
                                                activeSourceId
                                            }
                                            tabIndex={
                                                source.sourceId ===
                                                activeSourceId
                                                    ? 0
                                                    : -1
                                            }
                                            onClick={() => select(index)}
                                            onKeyDown={(event) =>
                                                handleKey(event, index)
                                            }
                                            className={cn(
                                                "grid h-32 w-full grid-rows-[2.5rem_minmax(0,1fr)] gap-3 overflow-hidden rounded-lg border border-border/60 p-3 text-left transition-colors hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
                                                source.sourceId ===
                                                    activeSourceId &&
                                                    "border-source-selection-accent bg-source-selection-accent/5",
                                            )}>
                                            <span className="flex min-w-0 items-start gap-3">
                                                <FaviconAvatar
                                                    canonicalUrl={
                                                        source.canonicalUrl
                                                    }
                                                    entityName={source.title}
                                                    size="lg"
                                                />
                                                <span className="line-clamp-2 min-w-0 flex-1 text-sm font-medium leading-snug">
                                                    {source.title}
                                                </span>
                                            </span>
                                            <span className="flex min-w-0 flex-col items-start gap-1.5">
                                                <SourceDocumentKindBadge
                                                    kind={source.documentKind}
                                                />
                                                {source.readingStatus ? (
                                                    <span className="relative block min-h-4 text-xs leading-snug text-muted-foreground">
                                                        <AnimatePresence
                                                            initial={false}
                                                            mode="popLayout">
                                                            <motion.span
                                                                key={
                                                                    source.readingStatus
                                                                }
                                                                initial={{
                                                                    opacity: 0,
                                                                    y: reduceMotion
                                                                        ? 0
                                                                        : 3,
                                                                }}
                                                                animate={{
                                                                    opacity: 1,
                                                                    y: 0,
                                                                }}
                                                                exit={{
                                                                    opacity: 0,
                                                                }}
                                                                transition={{
                                                                    duration: 0.2,
                                                                }}
                                                                className="block">
                                                                {sourceReadingStatusLabel(
                                                                    source.readingStatus,
                                                                )}
                                                            </motion.span>
                                                        </AnimatePresence>
                                                    </span>
                                                ) : null}
                                            </span>
                                        </button>
                                    </li>
                                ))}
                            </ul>
                            <Button
                                type="button"
                                variant="ghost"
                                aria-label="Next source"
                                disabled={activeIndex >= visible.length - 1}
                                onClick={() => select(activeIndex + 1)}
                                className="h-auto w-7 shrink-0 self-stretch rounded-md bg-muted/65 px-0">
                                <Icon iconNode={ArrowRight01Icon} />
                            </Button>
                        </div>
                        <p
                            role="status"
                            className="pb-3 text-center text-xs tabular-nums text-muted-foreground">
                            {activeIndex + 1} of {visible.length}
                        </p>
                    </>
                ) : (
                    <Empty className="min-h-40 border-0">
                        <EmptyHeader>
                            <EmptyTitle>No matching sources</EmptyTitle>
                            <EmptyDescription>
                                {query
                                    ? "Try another title, document type or source address."
                                    : "This group has no sources. Choose another group or inspect all candidates."}
                            </EmptyDescription>
                        </EmptyHeader>
                    </Empty>
                )}
            </section>
            {active ? (
                <section
                    aria-label="Selected source reading"
                    className="min-w-0">
                    {detailMatches && selectedSource === null ? (
                        <Empty>
                            <EmptyHeader>
                                <EmptyTitle>
                                    Source no longer available
                                </EmptyTitle>
                                <EmptyDescription>
                                    Choose another source to continue reviewing.
                                </EmptyDescription>
                            </EmptyHeader>
                        </Empty>
                    ) : (
                        <SourceContextPanel
                            key={active.sourceId}
                            source={
                                detailMatches && selectedSource
                                    ? selectedSource
                                    : toSourceContext(active)
                            }
                            runId={runId}
                            approvedCorpusRevisionId={
                                readOnly ? corpusRevisionId : undefined
                            }
                            included={active.included}
                            annotation={annotation(active)}
                            isReadingLoading={
                                !!onSelect &&
                                (!detailMatches || selectedSource === undefined)
                            }
                            actions={
                                readOnly ? undefined : (
                                    <SourceAdjustmentActions
                                        source={active}
                                        onDecide={onDecide}
                                        disabled={false}
                                        context="overview"
                                    />
                                )
                            }
                            className="min-h-96"
                        />
                    )}
                </section>
            ) : null}
        </div>
    );
}
