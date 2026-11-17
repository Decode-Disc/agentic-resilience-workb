import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { type ReactNode, useState } from "react";
import { LoadErrorBoundary } from "@/components/load-error-boundary";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { WorkbenchIcon } from "@/components/workbench-ui/glyphs";
import {
    SourcesMatrixScreen,
    SourcesPreparationScreen,
    SourcesReaderScreen,
    type SourcesScreenFrame,
} from "@/components/workspace/sources/sources-screens";
import { UsePreparedSourcesButton } from "@/components/workspace/use-prepared-sources-button";
import {
    documentaryContributionTerms,
    filterSourcesRows,
    type SourcesFilterId,
    type SourcesRow,
    sourceFollowUpDraft,
    sourcesFilterValues,
    sourcesMatrixFilters,
    sourcesMatrixRow,
    sourcesPreparationView,
    sourcesReaderDocument,
    sourcesReaderGroups,
} from "@/lib/presentation/sources";
import type { WorkspaceSearch } from "@/lib/workspace/navigation";

type Run = NonNullable<FunctionReturnType<typeof api.researchRuns.getMine>>;
type SourcesSearch = Pick<
    WorkspaceSearch,
    "sourcesView" | "source" | "q" | "kind" | "reading" | "use"
>;

/**
 * Sources section for dossiers prepared by the Sources mission. Dossiers on
 * the corpus-approval path render `fallback` unchanged.
 */
export function ConnectedSources({
    runId,
    run,
    search,
    onSearchChange,
    navigation,
    fallback,
    dock,
    onFollowUp,
    onOpenDecision,
}: {
    runId: Id<"researchRuns">;
    run: Run;
    search: SourcesSearch;
    /** Applies a partial Sources location; `replace` keeps typing out of history. */
    onSearchChange: (patch: SourcesSearch, replace?: boolean) => void;
    navigation: ReactNode;
    fallback: ReactNode;
    /** The inventory dock, rendered beside the Sources screens. */
    dock?: ReactNode;
    /** Opens the Workbench composer with this draft; absent when Workbench cannot receive it. */
    onFollowUp?: (draft: string) => void;
    /** Opens the conversation that holds the dossier's pending time-limit decision. */
    onOpenDecision?: () => void;
}) {
    const frame: SourcesScreenFrame = { navigation };
    return (
        <LoadErrorBoundary
            title="Sources unavailable"
            description="Your sources and decisions are unchanged. Try loading them again."
            className="mt-4">
            <SourcesQuery
                runId={runId}
                run={run}
                search={search}
                onSearchChange={onSearchChange}
                frame={frame}
                fallback={fallback}
                dock={dock}
                onFollowUp={onFollowUp}
                onOpenDecision={onOpenDecision}
            />
        </LoadErrorBoundary>
    );
}

type ScreenProps = {
    runId: Id<"researchRuns">;
    run: Run;
    search: SourcesSearch;
    onSearchChange: (patch: SourcesSearch, replace?: boolean) => void;
    frame: SourcesScreenFrame;
    onFollowUp?: (draft: string) => void;
    onOpenDecision?: () => void;
};

/** Decides the path once: the corpus-approval fallback, or the Sources screens with the dock. */
function SourcesQuery({
    fallback,
    dock,
    ...props
}: ScreenProps & { fallback: ReactNode; dock?: ReactNode }) {
    const overview = useQuery(api.sourcesWorkspace.overview, {
        runId: props.runId,
    });
    const rows = useQuery(
        api.sourcesWorkspace.listSources,
        overview ? { runId: props.runId } : "skip",
    );
    if (overview === null || rows === null) return fallback;
    return (
        <>
            {overview === undefined || rows === undefined ? (
                <SourcesSkeleton
                    frame={props.frame}
                    view={props.search.sourcesView}
                />
            ) : (
                <SourcesContent {...props} overview={overview} rows={rows} />
            )}
            {dock}
        </>
    );
}

function SourcesContent({
    runId,
    run,
    search,
    onSearchChange,
    frame,
    onFollowUp,
    onOpenDecision,
    overview,
    rows,
}: ScreenProps & {
    overview: NonNullable<
        FunctionReturnType<typeof api.sourcesWorkspace.overview>
    >;
    rows: readonly SourcesRow[];
}) {
    const preparationStep = {
        id: "preparation",
        label: "Preparation",
        onSelect: () =>
            onSearchChange({
                sourcesView: undefined,
                source: undefined,
            }),
    };
    const matrixStep = {
        id: "matrix",
        label: "Source matrix",
        onSelect: () =>
            onSearchChange({ sourcesView: "matrix", source: search.source }),
    };
    if (search.sourcesView === "matrix") {
        const filters = sourcesFilterValues(search);
        return (
            <SourcesMatrixScreen
                frame={frame}
                trail={[preparationStep, matrixStep]}
                rows={filterSourcesRows(rows, search.q ?? "", filters).map(
                    sourcesMatrixRow,
                )}
                total={rows.length}
                currentId={search.source}
                query={search.q ?? ""}
                onQueryChange={(q) =>
                    onSearchChange({ q: q || undefined }, true)
                }
                filters={sourcesMatrixFilters.map((filter) => ({
                    ...filter,
                    value: filters[filter.id],
                }))}
                onFilterChange={(filterId, optionId) => {
                    const filter = sourcesMatrixFilters.find(
                        (entry) => entry.id === filterId,
                    );
                    if (!filter) return;
                    onSearchChange({
                        [filterId as SourcesFilterId]:
                            optionId === filter.options[0].id
                                ? undefined
                                : optionId,
                    });
                }}
                onClearFilters={() =>
                    onSearchChange({
                        q: undefined,
                        kind: undefined,
                        reading: undefined,
                        use: undefined,
                    })
                }
                onOpenSource={(id) =>
                    onSearchChange({ sourcesView: "reader", source: id })
                }
                contributionTerms={documentaryContributionTerms}
            />
        );
    }
    if (search.sourcesView === "reader") {
        const selected =
            rows.find((row) => row.sourceId === search.source) ??
            rows.find((row) => row.membership === "retained") ??
            rows[0];
        if (selected)
            return (
                <SourceReaderQuery
                    runId={runId}
                    frame={frame}
                    trail={[
                        preparationStep,
                        matrixStep,
                        { id: "source", label: selected.title },
                    ]}
                    rows={rows}
                    selected={selected}
                    overview={overview}
                    onSelect={(id) =>
                        onSearchChange({ sourcesView: "reader", source: id })
                    }
                    onOpenMatrix={() =>
                        onSearchChange({
                            sourcesView: "matrix",
                            source: selected.sourceId,
                        })
                    }
                    onFollowUp={onFollowUp}
                />
            );
    }
    return (
        <SourcesPreparationScreen
            frame={frame}
            view={sourcesPreparationView(overview, run, rows)}
            onInspectSources={() => onSearchChange({ sourcesView: "matrix" })}
            inspectEmphasis={
                run.sourcesPhase === "time_limit" &&
                run.sourcesDecisionRequestId
                    ? "secondary"
                    : "primary"
            }
            actions={
                // The decision itself is made on its card in the conversation.
                run.sourcesPhase === "time_limit" &&
                run.sourcesDecisionRequestId &&
                onOpenDecision ? (
                    <Button size="lg" onClick={onOpenDecision}>
                        Open decision
                        <WorkbenchIcon
                            name="chevron"
                            size={14}
                            strokeWidth={2}
                        />
                    </Button>
                ) : run.sourcesSettlementAvailable ? (
                    <UsePreparedSourcesButton
                        runId={runId}
                        expectedGeneration={run.executionGeneration}
                        size="lg"
                    />
                ) : undefined
            }
        />
    );
}

function SourceReaderQuery({
    runId,
    frame,
    trail,
    rows,
    selected,
    overview,
    onSelect,
    onOpenMatrix,
    onFollowUp,
}: {
    runId: Id<"researchRuns">;
    frame: SourcesScreenFrame;
    trail: Parameters<typeof SourcesReaderScreen>[0]["trail"];
    rows: readonly SourcesRow[];
    selected: SourcesRow;
    overview: Parameters<typeof sourcesReaderDocument>[1];
    onSelect: (id: string) => void;
    onOpenMatrix: () => void;
    onFollowUp?: (draft: string) => void;
}) {
    const current = useQuery(api.sourcesWorkspace.getSource, {
        runId,
        sourceId: selected.sourceId,
    });
    // The previous document stays in place until the next one arrives, so the list never collapses.
    const [shown, setShown] = useState(current);
    if (current !== undefined && current !== shown) setShown(current);
    const reading = current === undefined ? shown : current;
    const [page, setPage] = useState<{ source: string; id: string }>();
    const pageId = page?.source === selected.sourceId ? page.id : undefined;
    if (reading === undefined)
        return <SourcesSkeleton frame={frame} view="reader" />;
    const document = reading
        ? sourcesReaderDocument(reading, overview)
        : {
              title: selected.title,
              meta: selected.host,
              pages: [],
              contributionLabel: selected.title,
              contributions: [],
              observedLinks: [],
              originalHref: selected.url,
          };
    const index = Math.max(
        0,
        document.pages.findIndex((page) => page.id === pageId),
    );
    const retained = rows.filter((row) => row.membership === "retained");
    return (
        <SourcesReaderScreen
            frame={frame}
            trail={trail}
            sources={sourcesReaderGroups(rows)}
            selectedId={selected.sourceId}
            onSelectSource={onSelect}
            summary={
                retained.length
                    ? `${retained.length} retained`
                    : `${rows.length} found`
            }
            matrixLabel={`All ${rows.length} in the matrix`}
            onOpenMatrix={onOpenMatrix}
            document={{
                ...document,
                pagePosition: document.pages.length
                    ? `Excerpt ${index + 1} / ${document.pages.length}`
                    : undefined,
                onPageChange: (id) =>
                    setPage({ source: selected.sourceId, id }),
            }}
            onRequestCheck={
                onFollowUp
                    ? () => onFollowUp(sourceFollowUpDraft("check", selected))
                    : undefined
            }
            onChallengeSelection={
                onFollowUp
                    ? () =>
                          onFollowUp(sourceFollowUpDraft("challenge", selected))
                    : undefined
            }
        />
    );
}

/** Keeps each screen's regions while the dossier's sources load. */
function SourcesSkeleton({
    frame,
    view,
}: {
    frame: SourcesScreenFrame;
    view?: SourcesSearch["sourcesView"];
}) {
    return (
        <div
            role="status"
            aria-label="Loading sources"
            aria-busy="true"
            className="flex flex-col gap-5 pt-2 pb-28">
            {frame.navigation}
            {view === "reader" ? (
                <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,1fr)_320px]">
                    <div className="hidden flex-col gap-2 lg:flex">
                        <Skeleton className="h-5 w-24" />
                        {Array.from({ length: 6 }, (_, index) => (
                            <Skeleton
                                // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders
                                key={index}
                                className="h-14 rounded-xl"
                            />
                        ))}
                    </div>
                    <div className="flex flex-col gap-3">
                        <Skeleton className="h-10 w-3/4" />
                        <Skeleton className="h-96 rounded-2xl" />
                    </div>
                    <div className="hidden flex-col gap-3 xl:flex">
                        <Skeleton className="h-6 w-40" />
                        <Skeleton className="h-28 rounded-xl" />
                        <Skeleton className="h-28 rounded-xl" />
                    </div>
                </div>
            ) : view === "matrix" ? (
                <>
                    <div className="flex flex-wrap items-end justify-between gap-4">
                        <div className="flex flex-col gap-2">
                            <Skeleton className="h-4 w-28" />
                            <Skeleton className="h-9 w-80 max-w-full" />
                        </div>
                        <Skeleton className="h-10 w-80 max-w-full rounded-xl" />
                    </div>
                    <div className="flex gap-3">
                        <Skeleton className="h-8 w-28 rounded-lg" />
                        <Skeleton className="h-8 w-24 rounded-lg" />
                        <Skeleton className="h-8 w-28 rounded-lg" />
                    </div>
                    <div className="flex flex-col gap-2 rounded-2xl p-4">
                        {Array.from({ length: 8 }, (_, index) => (
                            <Skeleton
                                // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders
                                key={index}
                                className="h-12"
                            />
                        ))}
                    </div>
                </>
            ) : (
                <>
                    <div className="flex flex-wrap items-end justify-between gap-6">
                        <div className="flex max-w-2xl flex-1 flex-col gap-3">
                            <Skeleton className="h-4 w-36" />
                            <Skeleton className="h-11 w-full" />
                            <Skeleton className="h-4 w-4/5" />
                        </div>
                        <Skeleton className="h-28 w-96 max-w-full rounded-2xl" />
                    </div>
                    <div className="flex flex-col gap-2 rounded-2xl p-5">
                        <Skeleton className="h-6 w-48" />
                        {Array.from({ length: 6 }, (_, index) => (
                            <Skeleton
                                // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders
                                key={index}
                                className="h-11"
                            />
                        ))}
                    </div>
                    <Skeleton className="h-14 rounded-2xl" />
                </>
            )}
        </div>
    );
}
