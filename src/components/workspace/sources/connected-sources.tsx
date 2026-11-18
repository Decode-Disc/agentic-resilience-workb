import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { type ReactNode, useState } from "react";
import { LoadErrorBoundary } from "@/components/load-error-boundary";
import { Skeleton } from "@/components/ui/skeleton";
import {
    SourcesMatrixScreen,
    SourcesPreparationResult,
    SourcesReaderScreen,
    type SourcesScreenFrame,
} from "@/components/workspace/sources/sources-screens";
import {
    documentaryContributionTerms,
    filterSourcesRows,
    type SourcesFilterId,
    type SourcesRow,
    sortSourcesRows,
    sourceFollowUpDraft,
    sourcesFilterValues,
    sourcesMatrixFilters,
    sourcesMatrixRow,
    sourcesPreparationView,
    sourcesReaderDocument,
    sourcesReaderGroups,
} from "@/lib/presentation/sources";
import type { SourcesLocation } from "@/lib/workspace/navigation";

type Run = NonNullable<FunctionReturnType<typeof api.researchRuns.getMine>>;
type SourcesSearch = SourcesLocation;

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
    onFollowUp,
}: {
    runId: Id<"researchRuns">;
    run: Run;
    search: SourcesSearch;
    /** Applies a partial Sources location; `replace` keeps typing out of history. */
    onSearchChange: (patch: SourcesSearch, replace?: boolean) => void;
    navigation: ReactNode;
    fallback: ReactNode;
    /** Opens the Workbench composer with this draft; absent when Workbench cannot receive it. */
    onFollowUp?: (draft: string) => void;
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
                onFollowUp={onFollowUp}
            />
        </LoadErrorBoundary>
    );
}

/**
 * The Sources result in the Progress stage panel once Sources has handed off:
 * the needs against the questions they serve and how preparation ran.
 */
export function ProgressSourcesResult({
    runId,
    run,
    onOpenSource,
}: {
    runId: Id<"researchRuns">;
    run: Run;
    /** Opens a need's document in the Sources reader. */
    onOpenSource: (sourceId: string, needId: string) => void;
}) {
    return (
        <LoadErrorBoundary
            title="Sources result unavailable"
            description="Your sources and decisions are unchanged. Try loading them again.">
            <ProgressSourcesResultQuery
                runId={runId}
                run={run}
                onOpenSource={onOpenSource}
            />
        </LoadErrorBoundary>
    );
}

function ProgressSourcesResultQuery({
    runId,
    run,
    onOpenSource,
}: {
    runId: Id<"researchRuns">;
    run: Run;
    onOpenSource: (sourceId: string, needId: string) => void;
}) {
    const overview = useQuery(api.sourcesWorkspace.overview, { runId });
    const rows = useQuery(
        api.sourcesWorkspace.listSources,
        overview ? { runId } : "skip",
    );
    // Older dossiers without the Sources workspace show their lanes instead.
    if (overview === null || rows === null) return null;
    if (overview === undefined || rows === undefined)
        return (
            <div
                role="status"
                aria-label="Loading the Sources result"
                aria-busy="true"
                className="flex flex-col gap-3">
                <Skeleton className="h-7 w-48 rounded-lg" />
                {[0, 1, 2, 3].map((row) => (
                    <Skeleton key={row} className="h-12 w-full rounded-xl" />
                ))}
                <Skeleton className="h-12 w-full rounded-2xl" />
            </div>
        );
    return (
        <SourcesPreparationResult
            view={sourcesPreparationView(overview, run, rows)}
            onOpenSource={onOpenSource}
        />
    );
}

type ScreenProps = {
    runId: Id<"researchRuns">;
    run: Run;
    search: SourcesSearch;
    onSearchChange: (patch: SourcesSearch, replace?: boolean) => void;
    frame: SourcesScreenFrame;
    onFollowUp?: (draft: string) => void;
};

/** Decides the path once: the corpus-approval fallback, or the Sources screens. */
function SourcesQuery({
    fallback,
    ...props
}: ScreenProps & { fallback: ReactNode }) {
    const overview = useQuery(api.sourcesWorkspace.overview, {
        runId: props.runId,
    });
    const rows = useQuery(
        api.sourcesWorkspace.listSources,
        overview ? { runId: props.runId } : "skip",
    );
    if (overview === null || rows === null) return fallback;
    return overview === undefined || rows === undefined ? (
        <SourcesSkeleton frame={props.frame} view={props.search.sourcesView} />
    ) : (
        <SourcesContent {...props} overview={overview} rows={rows} />
    );
}

function SourcesContent({
    runId,
    search,
    onSearchChange,
    frame,
    onFollowUp,
    overview,
    rows,
}: ScreenProps & {
    overview: NonNullable<
        FunctionReturnType<typeof api.sourcesWorkspace.overview>
    >;
    rows: readonly SourcesRow[];
}) {
    // The document list is the Sources landing; the reader returns to it.
    const documentsStep = {
        id: "matrix",
        label: "Documents",
        onSelect: () =>
            onSearchChange({
                sourcesView: undefined,
                source: search.source,
                need: undefined,
                focus: undefined,
            }),
    };
    // The reader shows one document; without one to show, the document list stands in.
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
                        documentsStep,
                        { id: "source", label: selected.title },
                    ]}
                    rows={rows}
                    selected={selected}
                    openOnArrival={Boolean(search.source)}
                    onCloseSource={() =>
                        onSearchChange(
                            {
                                source: undefined,
                                need: undefined,
                                focus: undefined,
                            },
                            true,
                        )
                    }
                    needId={search.need}
                    focusConflict={search.focus === "conflict"}
                    overview={overview}
                    onOpenConflict={(id) =>
                        onSearchChange({
                            sourcesView: "reader",
                            source: id,
                            need: undefined,
                            focus: "conflict",
                        })
                    }
                    onSelect={(id) =>
                        onSearchChange({
                            sourcesView: "reader",
                            source: id,
                            need: undefined,
                            focus: undefined,
                        })
                    }
                    onOpenMatrix={() =>
                        onSearchChange({
                            sourcesView: undefined,
                            source: selected.sourceId,
                        })
                    }
                    onFollowUp={onFollowUp}
                />
            );
    }
    const filters = sourcesFilterValues(search);
    return (
        <SourcesMatrixScreen
            frame={frame}
            rows={filterSourcesRows(
                sortSourcesRows(rows),
                search.q ?? "",
                filters,
            ).map(sourcesMatrixRow)}
            total={rows.length}
            currentId={search.source}
            query={search.q ?? ""}
            onQueryChange={(q) => onSearchChange({ q: q || undefined }, true)}
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
                onSearchChange({
                    sourcesView: "reader",
                    source: id,
                    need: undefined,
                    focus: undefined,
                })
            }
            contributionTerms={documentaryContributionTerms}
        />
    );
}

function SourceReaderQuery({
    runId,
    frame,
    trail,
    rows,
    selected,
    openOnArrival,
    onCloseSource,
    needId,
    focusConflict,
    onOpenConflict,
    overview,
    onSelect,
    onOpenMatrix,
    onFollowUp,
}: {
    /** The reader was opened on a chosen source. */
    openOnArrival: boolean;
    onCloseSource: () => void;
    /** The documentary need the reader was opened for. */
    needId?: string;
    /** Opens on the first conflicting citation. */
    focusConflict?: boolean;
    onOpenConflict: (id: string) => void;
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
    const [shown, setShown] = useState(
        current === undefined
            ? undefined
            : { sourceId: selected.sourceId, reading: current },
    );
    if (
        current !== undefined &&
        (current !== shown?.reading || selected.sourceId !== shown.sourceId)
    )
        setShown({ sourceId: selected.sourceId, reading: current });
    const displayed =
        current === undefined
            ? shown
            : { sourceId: selected.sourceId, reading: current };
    if (displayed === undefined)
        return <SourcesSkeleton frame={frame} view="reader" />;
    const reading = displayed.reading;
    // Where to start applies to the requested source only, once its own document is shown.
    const arrived = displayed.sourceId === selected.sourceId;
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
    const retained = rows.filter((row) => row.membership === "retained");
    return (
        <SourcesReaderScreen
            frame={frame}
            trail={trail}
            sources={sourcesReaderGroups(rows)}
            selectedId={selected.sourceId}
            onSelectSource={onSelect}
            openOnArrival={openOnArrival}
            onCloseSource={onCloseSource}
            summary={
                retained.length
                    ? `${retained.length} retained`
                    : `${rows.length} found`
            }
            matrixLabel={`All ${rows.length} in the matrix`}
            onOpenMatrix={onOpenMatrix}
            document={{
                ...document,
                sourceId: displayed.sourceId,
                focusNeedId: arrived ? needId : undefined,
                focusConflict: arrived && focusConflict,
            }}
            onOpenConflict={onOpenConflict}
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
