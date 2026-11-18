import {
    ArrowDown01Icon,
    Cancel01Icon,
    Search01Icon,
} from "@hugeicons/core-free-icons";
import {
    type ReactNode,
    type Ref,
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
} from "react";
import Icon from "@/components/icon";
import { PaginationControls } from "@/components/pagination-controls";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Drawer, DrawerClose, DrawerContent } from "@/components/ui/drawer";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
    Empty,
    EmptyContent,
    EmptyDescription,
    EmptyHeader,
    EmptyTitle,
} from "@/components/ui/empty";
import {
    InputGroup,
    InputGroupAddon,
    InputGroupInput,
} from "@/components/ui/input-group";
import {
    type DocumentaryNeed,
    DocumentaryNeeds,
    type NeedQuestion,
} from "@/components/workbench-ui/documentary-needs";
import {
    ClaimGlyph,
    ReadingBar,
    WorkbenchIcon,
} from "@/components/workbench-ui/glyphs";
import { WorkbenchUiRoot } from "@/components/workbench-ui/root";
import {
    SourceMatrix,
    type SourceMatrixProps,
    type SourceMatrixRow,
} from "@/components/workbench-ui/source-matrix";
import {
    PreparationRows,
    PreparationStageCard,
    PreparationStageRow,
} from "@/components/workbench-ui/source-preparation";
import {
    SourceReader,
    type SourceReaderProps,
} from "@/components/workbench-ui/source-reader";
import {
    SourceReaderList,
    type SourceReaderListItem,
} from "@/components/workbench-ui/source-reader-list";
import { usePagination } from "@/hooks/use-pagination";
import { useMediaQuery } from "@/hooks/use-responsive";
import { cn } from "@/lib/utils";
import styles from "./sources-screens.module.css";
import {
    type SourcesTrailStep,
    SourcesWorkspaceFrame,
} from "./sources-workspace-frame";

/** Slots shared by every Sources screen. */
export interface SourcesScreenFrame {
    navigation: ReactNode;
}

export type DiscoveryOutcome = "found" | "none" | "unavailable";

/** Presentation figures for one preparation; the consumer derives them from persisted work. */
export interface SourcesPreparationView {
    eyebrow: string;
    title: string;
    /** What was prepared and what happens next, supplied by the consumer; never a verdict on the questions. */
    summary: string;
    description?: string;
    outcome: { label: string; settled: boolean };
    coverage?: {
        label: string;
        description: string;
        searches: readonly { id: string; focus: string; status: string }[];
        assessments: readonly {
            needId: string;
            statement: string;
            sources: readonly { sourceId: string; label: string }[];
        }[];
    };
    collect: {
        candidates: number;
        /** Omitted when the preparation does not record reuse. */
        reused?: number;
        families: readonly {
            id: string;
            label: string;
            outcome: DiscoveryOutcome;
        }[];
        note?: string;
        /** How candidates were found, derived from the run; omitted when nothing is recorded. */
        description?: string;
    };
    reading: {
        captured: number;
        /** Omitted when located passages are not counted. */
        passages?: number;
        full: number;
        partial: number;
        unavailable: number;
        /** Candidates never captured: open leads, not judged irrelevant. */
        notCaptured?: number;
        /** `retained`: controls on the handed-off material; `checked`: everything controlled so far. */
        controlScope?: "retained" | "checked";
        /** Counts of controlled contributions, not documents. */
        controls: {
            supported: number;
            conflict: number;
            notEstablished: number;
            unfinished: number;
        };
        note?: string;
    };
    organize: {
        selected: number;
        context: number;
        uses: readonly {
            id: string;
            /** `conflict`: sources disagree; `unused`: captured but not retained; `lead`: no available capture; `excluded`: removed by the analyst. */
            role:
                | "primary"
                | "opposing"
                | "conflict"
                | "unused"
                | "lead"
                | "excluded";
            text: string;
        }[];
        handoff?: string;
    };
    questions: readonly NeedQuestion[];
    needs: readonly DocumentaryNeed[];
    /** A reason shared by several needs, shown once above them. */
    needsNotice?: string;
    researchNotice?: string;
}

const discoveryMeta: Record<DiscoveryOutcome, string> = {
    found: "found",
    none: "searched · none",
    unavailable: "search unavailable",
};
const roleBadges = {
    primary: <Badge tone="ink">Primary</Badge>,
    opposing: (
        <Badge tone="counter">
            <ClaimGlyph kind="counter" />
            Opposing
        </Badge>
    ),
    conflict: (
        <Badge tone="counter">
            <ClaimGlyph kind="counter" />
            Conflict
        </Badge>
    ),
    unused: <Badge tone="unknown">Not retained</Badge>,
    lead: <Badge tone="dashed">Not captured</Badge>,
    excluded: <Badge tone="unknown">Excluded</Badge>,
};
const check = <WorkbenchIcon name="check" size={11} strokeWidth={2.4} />;

/** Initial preparation: documentary needs against the questions they serve, with how preparation ran on demand. */
export function SourcesPreparationScreen({
    frame,
    view,
    onInspectSources,
    inspectEmphasis = "primary",
    actions,
    notices,
    onOpenSource,
}: {
    frame: SourcesScreenFrame;
    view: SourcesPreparationView;
    onInspectSources: () => void;
    /** Demotes "Inspect sources" when an urgent decision sits beside it. */
    inspectEmphasis?: "primary" | "secondary";
    /** Consumer decisions placed after "Inspect sources", such as a checkpoint approval. */
    actions?: ReactNode;
    /** Recovery, failed-search or availability notices shown above the needs. */
    notices?: ReactNode;
    /** Opens one of a need's documents in the reader. */
    onOpenSource?: (sourceId: string, needId: string) => void;
}) {
    const [runOpen, setRunOpen] = useState(false);
    const runTrigger = useRef<HTMLButtonElement>(null);
    // The run sits below the needs; this brings it into view with focus, then opens it.
    const showRun = () => {
        const trigger = runTrigger.current;
        if (!trigger) return;
        trigger.focus({ preventScroll: true });
        const reduced = window.matchMedia(
            "(prefers-reduced-motion: reduce)",
        ).matches;
        if (reduced || Math.abs(trigger.getBoundingClientRect().top) < 2) {
            trigger.scrollIntoView({ block: "start" });
            setRunOpen(true);
            return;
        }
        // Opening animates the panel's height, which cancels a smooth scroll in progress.
        let opened = false;
        const open = () => {
            if (opened) return;
            opened = true;
            document.removeEventListener("scrollend", open, true);
            setRunOpen(true);
        };
        document.addEventListener("scrollend", open, true);
        window.setTimeout(open, 700);
        trigger.scrollIntoView({ block: "start", behavior: "smooth" });
    };
    return (
        <SourcesWorkspaceFrame
            {...frame}
            prominent
            eyebrow={view.eyebrow}
            title={view.title}
            description={view.summary}
            headingAside={
                <div className={cn("wb-glass", styles.outcome)}>
                    <span className={styles.outcomeText}>
                        <span className="wb-label">Outcome</span>
                        <span className={styles.outcomeLabel}>
                            <WorkbenchIcon
                                name={
                                    view.outcome.settled
                                        ? "check"
                                        : "unfinished"
                                }
                                size={16}
                                strokeWidth={2}
                            />
                            {view.outcome.label}
                        </span>
                    </span>
                    <span className={styles.outcomeActions}>
                        <Button
                            variant="outline"
                            size="lg"
                            className={styles.secondaryAction}
                            onClick={showRun}>
                            How it ran
                            <Icon iconNode={ArrowDown01Icon} size={14} />
                        </Button>
                        <Button
                            variant={
                                inspectEmphasis === "secondary"
                                    ? "outline"
                                    : undefined
                            }
                            className={
                                inspectEmphasis === "secondary"
                                    ? styles.secondaryAction
                                    : styles.primaryAction
                            }
                            size="lg"
                            onClick={onInspectSources}>
                            Inspect sources
                            <WorkbenchIcon
                                name="chevron"
                                size={14}
                                strokeWidth={2}
                            />
                        </Button>
                        {actions}
                    </span>
                </div>
            }>
            {notices}
            {view.researchNotice ? <p>{view.researchNotice}</p> : null}
            <DocumentaryNeeds
                questions={view.questions}
                needs={view.needs}
                notice={view.needsNotice}
                onOpenSource={onOpenSource}
            />
            <PreparationRun
                view={view}
                open={runOpen}
                onOpenChange={setRunOpen}
                triggerRef={runTrigger}
                onOpenSource={onOpenSource}
            />
            {view.description && (
                <p className={cn("wb-meta", styles.preparationNote)}>
                    {view.description}
                </p>
            )}
        </SourcesWorkspaceFrame>
    );
}

/** How Sources collected, read and organized the material; secondary to the needs, open on demand. */
function PreparationRun({
    view,
    open,
    onOpenChange,
    triggerRef,
    onOpenSource,
}: {
    view: SourcesPreparationView;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    triggerRef: Ref<HTMLButtonElement>;
    onOpenSource?: (sourceId: string, needId: string) => void;
}) {
    const { collect, reading, organize } = view;
    return (
        <Collapsible
            open={open}
            onOpenChange={onOpenChange}
            className={cn("wb-glass", styles.process)}>
            <CollapsibleTrigger
                ref={triggerRef}
                render={
                    <Button variant="unstyled" className={styles.processLine} />
                }>
                <span className={cn("wb-label", styles.processLabel)}>
                    How preparation ran
                </span>
                <span className={styles.flow}>
                    <span className={styles.flowStep}>
                        <span>
                            <b>{collect.candidates}</b> collected
                        </span>
                    </span>
                    <StageArrow />
                    <span className={styles.flowStep}>
                        <span>
                            <b>{reading.captured}</b> captured ·{" "}
                            {captureBreakdown(reading)}
                        </span>
                        <ReadingBar
                            height={5}
                            counts={{
                                full: reading.full,
                                partial: reading.partial,
                                unavailable: reading.unavailable,
                                notCaptured: reading.notCaptured,
                            }}
                        />
                    </span>
                    <StageArrow />
                    <span className={styles.flowStep}>
                        <span>
                            <b>{organize.selected}</b> retained ·{" "}
                            {organize.context} kept as context
                        </span>
                    </span>
                </span>
                <span className={styles.processChevron} aria-hidden="true">
                    <WorkbenchIcon name="chevron" size={14} strokeWidth={2} />
                </span>
            </CollapsibleTrigger>
            <CollapsibleContent>
                {view.coverage && (
                    <div className="space-y-2 py-3 text-sm">
                        <p>
                            <strong>{view.coverage.label}</strong> ·{" "}
                            {view.coverage.description}
                        </p>
                        {view.coverage.searches.length > 0 && (
                            <ul
                                aria-label="Coverage searches"
                                className="max-h-36 space-y-1 overflow-y-auto">
                                {view.coverage.searches.map((search) => (
                                    <li key={search.id}>
                                        {search.focus} · {search.status}
                                    </li>
                                ))}
                            </ul>
                        )}
                        {view.coverage.assessments.map((assessment) => (
                            <div key={assessment.needId}>
                                <p>{assessment.statement}</p>
                                {onOpenSource &&
                                    assessment.sources.map((source) => (
                                        <Button
                                            key={source.sourceId}
                                            variant="link"
                                            onClick={() =>
                                                onOpenSource(
                                                    source.sourceId,
                                                    assessment.needId,
                                                )
                                            }>
                                            {source.label}
                                        </Button>
                                    ))}
                            </div>
                        ))}
                    </div>
                )}
                <PreparationStages view={view} />
            </CollapsibleContent>
        </Collapsible>
    );
}

function PreparationStages({ view }: { view: SourcesPreparationView }) {
    const { collect, reading, organize } = view;
    return (
        <div className={styles.stages}>
            <PreparationStageCard
                step="01"
                title="Collect sources"
                description={collect.description}
                metrics={[
                    {
                        id: "candidates",
                        value: collect.candidates,
                        label: "candidates",
                    },
                    ...(collect.reused === undefined
                        ? []
                        : [
                              {
                                  id: "reused",
                                  value: collect.reused,
                                  label: "reused",
                                  quiet: true,
                              },
                          ]),
                ]}
                footnote={collect.note}>
                <PreparationRows>
                    {collect.families.map((family) => (
                        <PreparationStageRow
                            key={family.id}
                            muted={family.outcome !== "found"}
                            leading={
                                <WorkbenchIcon
                                    name={
                                        family.outcome === "found"
                                            ? "check"
                                            : family.outcome === "none"
                                              ? "unestablished"
                                              : "unfinished-check"
                                    }
                                    size={14}
                                    strokeWidth={
                                        family.outcome === "found" ? 2.2 : 1.8
                                    }
                                />
                            }
                            meta={discoveryMeta[family.outcome]}>
                            {family.label}
                        </PreparationStageRow>
                    ))}
                </PreparationRows>
            </PreparationStageCard>
            <StageArrow />
            <PreparationStageCard
                step="02"
                title="Read and check"
                description="Captures and documentary controls"
                metrics={[
                    {
                        id: "captured",
                        value: reading.captured,
                        label: "captured",
                    },
                    ...(reading.passages === undefined
                        ? []
                        : [
                              {
                                  id: "passages",
                                  value: reading.passages,
                                  label: "passages located",
                                  quiet: true,
                              },
                          ]),
                ]}
                footnote={reading.note}>
                <span className={styles.readingSummary}>
                    <ReadingBar
                        counts={{
                            full: reading.full,
                            partial: reading.partial,
                            unavailable: reading.unavailable,
                            notCaptured: reading.notCaptured,
                        }}
                    />
                    <span className={styles.readingLegend}>
                        <span>
                            <b>{reading.full}</b> complete
                        </span>
                        <span>
                            <b>{reading.partial}</b> partial
                        </span>
                        {reading.unavailable > 0 && (
                            <span>
                                <b>{reading.unavailable}</b> unavailable
                            </span>
                        )}
                        {(reading.notCaptured ?? 0) > 0 && (
                            <span>
                                <b>{reading.notCaptured}</b> not captured
                            </span>
                        )}
                    </span>
                </span>
                <span className={styles.controls}>
                    <span className="wb-label">
                        Controls on {controlTotal(reading.controls)}
                        {reading.controlScope === "retained" ? " retained" : ""}{" "}
                        contributions
                    </span>
                    <span className={styles.badges}>
                        <Badge tone="ink">
                            {check}
                            {reading.controls.supported} supported
                        </Badge>
                        <Badge tone="counter">
                            <ClaimGlyph kind="counter" />
                            {reading.controls.conflict} in conflict
                        </Badge>
                        <Badge tone="unknown">
                            {reading.controls.notEstablished} not established
                        </Badge>
                        <Badge tone="dashed">
                            {reading.controls.unfinished} unchecked
                        </Badge>
                    </span>
                </span>
            </PreparationStageCard>
            <StageArrow />
            <PreparationStageCard
                step="03"
                emphasis="focal"
                title="Organize usable material"
                description="Selection under the dossier's rules"
                metrics={[
                    {
                        id: "selected",
                        value: organize.selected,
                        label: "selected",
                    },
                    {
                        id: "context",
                        value: organize.context,
                        label: "kept as context",
                        quiet: true,
                    },
                ]}>
                <PreparationRows>
                    {organize.uses.map((use) => (
                        <PreparationStageRow
                            key={use.id}
                            leading={roleBadges[use.role]}>
                            {use.text}
                        </PreparationStageRow>
                    ))}
                </PreparationRows>
                {organize.handoff && (
                    <span className={styles.handoff}>
                        <WorkbenchIcon
                            name="defer"
                            size={16}
                            strokeWidth={1.6}
                        />
                        {organize.handoff}
                    </span>
                )}
            </PreparationStageCard>
        </div>
    );
}

function controlTotal(controls: SourcesPreparationView["reading"]["controls"]) {
    return (
        controls.supported +
        controls.conflict +
        controls.notEstablished +
        controls.unfinished
    );
}

function captureBreakdown(reading: SourcesPreparationView["reading"]) {
    return [
        `${reading.full} complete`,
        `${reading.partial} partial`,
        reading.unavailable ? `${reading.unavailable} unavailable` : undefined,
        reading.notCaptured ? `${reading.notCaptured} not captured` : undefined,
    ]
        .filter(Boolean)
        .join(", ");
}

function StageArrow() {
    return (
        <span className={styles.stageArrow} aria-hidden="true">
            <WorkbenchIcon name="chevron" size={16} strokeWidth={1.6} />
        </span>
    );
}

/** A single-choice filter; the first option means no filtering. */
export interface SourcesMatrixFilter {
    id: string;
    label: string;
    options: readonly { id: string; label: string }[];
    value: string;
}

/** Every source with its reading, contribution and use; filtering is controlled by the consumer. */
export function SourcesMatrixScreen({
    frame,
    trail,
    rows,
    total,
    currentId,
    query,
    onQueryChange,
    filters,
    onFilterChange,
    onClearFilters,
    onOpenSource,
    pageSize = 10,
    headingActions,
    notices,
    contributionTerms,
}: {
    frame: SourcesScreenFrame;
    trail: readonly SourcesTrailStep[];
    rows: readonly SourceMatrixRow[];
    total: number;
    currentId?: string;
    query: string;
    onQueryChange: (query: string) => void;
    filters: readonly SourcesMatrixFilter[];
    onFilterChange: (filterId: string, optionId: string) => void;
    onClearFilters: () => void;
    onOpenSource: (id: string) => void;
    pageSize?: number;
    /** Placed beside the search, such as adding a source link. */
    headingActions?: ReactNode;
    notices?: ReactNode;
    contributionTerms?: SourceMatrixProps["contributionTerms"];
}) {
    const { page, pageCount, pageItems, setPage } = usePagination({
        items: rows,
        pageSize,
        resetKey: [query, ...filters.map((filter) => filter.value)].join("|"),
    });
    const revealedCurrent = useRef(false);
    useEffect(() => {
        if (revealedCurrent.current) return;
        revealedCurrent.current = true;
        const index = rows.findIndex((row) => row.id === currentId);
        if (index >= 0) setPage(Math.floor(index / pageSize) + 1);
    }, [rows, currentId, pageSize, setPage]);
    const firstShown = rows.length ? (page - 1) * pageSize + 1 : 0;
    const lastShown = (page - 1) * pageSize + pageItems.length;
    const activeFilters = filters.flatMap((filter) => {
        const option = filter.options.find((item) => item.id === filter.value);
        return option && option.id !== filter.options[0]?.id
            ? [{ filter, option }]
            : [];
    });
    return (
        <SourcesWorkspaceFrame
            {...frame}
            trail={trail}
            eyebrow="Source matrix"
            title="Sources, captures and contributions"
            headingAside={
                <span className={styles.matrixActions}>
                    {headingActions}
                    <InputGroup className={styles.search}>
                        <InputGroupAddon>
                            <Icon iconNode={Search01Icon} size={15} />
                        </InputGroupAddon>
                        <InputGroupInput
                            type="search"
                            aria-label="Search sources"
                            placeholder="Search sources or passages"
                            value={query}
                            onChange={(event) =>
                                onQueryChange(event.target.value)
                            }
                        />
                    </InputGroup>
                </span>
            }>
            {notices}
            <div className={styles.filters}>
                {filters.map((filter) => {
                    const [unfiltered] = filter.options;
                    const active = filter.options.find(
                        (option) =>
                            option.id === filter.value &&
                            option.id !== unfiltered?.id,
                    );
                    return (
                        <DropdownMenu key={filter.id}>
                            <DropdownMenuTrigger
                                render={
                                    <Button
                                        variant="secondary"
                                        size="sm"
                                        className={styles.filterTrigger}
                                        data-active={active ? "" : undefined}
                                        aria-label={filter.label}
                                    />
                                }>
                                {filter.label}
                                {active && (
                                    <span className={styles.filterValue}>
                                        {active.label}
                                    </span>
                                )}
                                <Icon iconNode={ArrowDown01Icon} size={14} />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent
                                align="start"
                                sideOffset={6}
                                className={styles.filterMenu}>
                                <DropdownMenuRadioGroup
                                    value={filter.value}
                                    onValueChange={(option) =>
                                        onFilterChange(filter.id, option)
                                    }>
                                    {filter.options.map((option) => (
                                        <DropdownMenuRadioItem
                                            key={option.id}
                                            value={option.id}
                                            closeOnClick>
                                            {option.label}
                                        </DropdownMenuRadioItem>
                                    ))}
                                </DropdownMenuRadioGroup>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    );
                })}
                <span className={cn("wb-meta", styles.count)} role="status">
                    {rows.length} of {total} sources
                </span>
            </div>
            {activeFilters.length > 0 && (
                <div className={styles.activeFilters}>
                    {activeFilters.map(({ filter, option }) => (
                        <button
                            key={filter.id}
                            type="button"
                            className={styles.activeFilter}
                            aria-label={`Remove filter ${filter.label}: ${option.label}`}
                            onClick={() =>
                                onFilterChange(
                                    filter.id,
                                    filter.options[0]?.id ?? filter.value,
                                )
                            }>
                            <span className={styles.activeFilterName}>
                                {filter.label}
                            </span>
                            {option.label}
                            <Icon iconNode={Cancel01Icon} size={12} />
                        </button>
                    ))}
                    <Button
                        variant="link"
                        size="sm"
                        className={styles.clearFilters}
                        onClick={onClearFilters}>
                        Clear filters
                    </Button>
                </div>
            )}
            <SourceMatrix
                caption="Source matrix"
                rows={pageItems}
                currentId={currentId}
                onOpen={onOpenSource}
                availabilityHelp="The extent of the saved capture. A complete capture does not establish that its contents were read or qualified."
                contributionTerms={contributionTerms}
                contributionScale={18}
                note="Included, read, contributing and usable are four separate facts."
                empty={
                    <Empty>
                        <EmptyHeader>
                            <EmptyTitle>No source matches</EmptyTitle>
                            <EmptyDescription>
                                Change the search or filters to see more
                                sources.
                            </EmptyDescription>
                        </EmptyHeader>
                        <EmptyContent>
                            <Button variant="outline" onClick={onClearFilters}>
                                Show all sources
                            </Button>
                        </EmptyContent>
                    </Empty>
                }
                footer={
                    rows.length > pageSize && (
                        <>
                            <span className="wb-meta">
                                {firstShown}–{lastShown} of {rows.length}
                            </span>
                            <PaginationControls
                                page={page}
                                pageCount={pageCount}
                                onPageChange={setPage}
                                ariaLabel="Source matrix pages"
                                className={styles.pageControls}
                            />
                        </>
                    )
                }
            />
        </SourcesWorkspaceFrame>
    );
}

/** From this width notes sit in the document's margin; below it they open under their passage. */
const marginNotesQuery = "(min-width: 1280px)";
/** Below this width the list takes the screen and each source opens in a drawer. */
const compactReaderQuery = "(max-width: 767px)";

/** One source in its reader, with the selected-source list and follow-up actions. */
export function SourcesReaderScreen({
    frame,
    trail,
    sources,
    selectedId,
    onSelectSource,
    onOpenConflict,
    openOnArrival = false,
    onCloseSource,
    summary,
    matrixLabel,
    onOpenMatrix,
    document,
    onRequestCheck,
    onChallengeSelection,
    decision,
    notices,
}: {
    frame: SourcesScreenFrame;
    trail: readonly SourcesTrailStep[];
    sources: readonly {
        id: string;
        label: string;
        items: readonly SourceReaderListItem[];
    }[];
    selectedId: string;
    onSelectSource: (id: string) => void;
    /** Opens a source on its first conflicting citation. */
    onOpenConflict?: (id: string) => void;
    /** The screen was opened on a chosen source; on narrow screens it starts in its drawer. */
    openOnArrival?: boolean;
    /** The drawer finished closing; the open source is no longer chosen. */
    onCloseSource?: () => void;
    summary: ReactNode;
    matrixLabel: string;
    onOpenMatrix: () => void;
    document: Omit<
        SourceReaderProps,
        | "followUps"
        | "decision"
        | "noteMode"
        | "notesShown"
        | "onNotesShownChange"
        | "dismiss"
        | "arriving"
    >;
    onRequestCheck?: () => void;
    onChallengeSelection?: () => void;
    /** Consumer-owned decision controls for the open source, such as include or remove. */
    decision?: ReactNode;
    /** Shown above the reader, such as a preview-only or unavailable-reading notice. */
    notices?: ReactNode;
}) {
    const marginNotes = useMediaQuery(marginNotesQuery);
    const compact = useMediaQuery(compactReaderQuery);
    const noteMode = marginNotes && !compact ? "margin" : "inline";
    // The analyst's show/hide choice holds while they move between sources.
    const [notesPreference, setNotesPreference] = useState<boolean>();
    const notes = {
        noteMode,
        notesShown: notesPreference ?? noteMode === "margin",
        onNotesShownChange: setNotesPreference,
    } as const;
    const [drawerOpen, setDrawerOpen] = useState(openOnArrival);
    /** The source the screen opened on appears at once; later selections arrive. */
    const [arriving, setArriving] = useState(false);
    const opener = useRef<HTMLElement | null>(null);
    // Selecting a source, or its conflict, opens it; on narrow screens in the drawer.
    const open = (id: string, select: (id: string) => void) => {
        if (id !== selectedId) setArriving(true);
        select(id);
        if (!compact) return;
        opener.current =
            globalThis.document.activeElement instanceof HTMLElement
                ? globalThis.document.activeElement
                : null;
        setDrawerOpen(true);
    };
    const list = (
        <SourceReaderList
            groups={sources}
            // In the drawer layout a source is chosen only while its drawer is open.
            selectedId={!compact || drawerOpen ? selectedId : undefined}
            onSelect={(id) => open(id, onSelectSource)}
            onOpenConflict={
                onOpenConflict ? (id) => open(id, onOpenConflict) : undefined
            }
            summary={summary}
            footer={
                <Button
                    variant="link"
                    className={styles.matrixLink}
                    onClick={onOpenMatrix}>
                    {matrixLabel}
                </Button>
            }
        />
    );
    const followUps = [
        ...(onRequestCheck
            ? [
                  {
                      id: "check",
                      label: "Request a targeted check",
                      onSelect: onRequestCheck,
                  },
              ]
            : []),
        ...(onChallengeSelection
            ? [
                  {
                      id: "challenge",
                      label: "Challenge this selection",
                      onSelect: onChallengeSelection,
                  },
              ]
            : []),
    ];
    // The workspace ends at the viewport's bottom edge, measured from where it actually starts.
    const workspace = useRef<HTMLDivElement>(null);
    const [workspaceTop, setWorkspaceTop] = useState<number>();
    // biome-ignore lint/correctness/useExhaustiveDependencies: the measured element changes when the layout switches between list and workspace.
    useLayoutEffect(() => {
        const element = workspace.current;
        if (!element) return;
        const measure = () =>
            setWorkspaceTop(
                element.getBoundingClientRect().top + window.scrollY,
            );
        measure();
        window.addEventListener("resize", measure);
        return () => window.removeEventListener("resize", measure);
    }, [compact]);
    // Both layouts end at the viewport's bottom edge, so long lists scroll inside their card.
    const viewportHeight =
        workspaceTop === undefined
            ? undefined
            : {
                  height: `max(${compact ? 360 : 520}px, calc(100dvh - ${Math.round(workspaceTop)}px - ${compact ? 16 : 24}px))`,
              };
    return (
        <SourcesWorkspaceFrame
            {...frame}
            trail={trail}
            titleHidden
            title={document.title}>
            {notices}
            {compact ? (
                <>
                    <div
                        ref={workspace}
                        className={styles.compactList}
                        style={viewportHeight}>
                        {list}
                    </div>
                    <Drawer
                        open={drawerOpen}
                        onOpenChange={setDrawerOpen}
                        onOpenChangeComplete={(next) => {
                            if (!next) onCloseSource?.();
                        }}
                        showSwipeHandle>
                        <DrawerContent
                            aria-label={document.title}
                            finalFocus={opener}
                            className={styles.drawer}>
                            <WorkbenchUiRoot className={styles.drawerBody}>
                                <SourceReader
                                    {...document}
                                    sourceId={document.sourceId ?? selectedId}
                                    {...notes}
                                    followUps={followUps}
                                    decision={decision}
                                    dismiss={
                                        <DrawerClose
                                            render={
                                                <Button
                                                    variant="ghost"
                                                    size="icon-sm"
                                                    className={
                                                        styles.drawerClose
                                                    }
                                                    aria-label="Close source"
                                                />
                                            }>
                                            <Icon
                                                iconNode={Cancel01Icon}
                                                size={16}
                                            />
                                        </DrawerClose>
                                    }
                                />
                            </WorkbenchUiRoot>
                        </DrawerContent>
                    </Drawer>
                </>
            ) : (
                <div
                    ref={workspace}
                    className={styles.readerWorkspace}
                    style={viewportHeight}>
                    {list}
                    <div className={cn("wb-glass", styles.readerDocument)}>
                        <SourceReader
                            {...document}
                            sourceId={document.sourceId ?? selectedId}
                            {...notes}
                            arriving={arriving}
                            followUps={followUps}
                            decision={decision}
                        />
                    </div>
                </div>
            )}
        </SourcesWorkspaceFrame>
    );
}
