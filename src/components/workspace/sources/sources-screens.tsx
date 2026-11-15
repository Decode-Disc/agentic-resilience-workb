import {
    ArrowDown01Icon,
    Cancel01Icon,
    Search01Icon,
} from "@hugeicons/core-free-icons";
import { type ReactNode, type Ref, useEffect, useRef, useState } from "react";
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
    dock?: ReactNode;
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
    collect: {
        candidates: number;
        reused: number;
        families: readonly {
            id: string;
            label: string;
            outcome: DiscoveryOutcome;
        }[];
        note?: string;
    };
    reading: {
        captured: number;
        passages: number;
        full: number;
        partial: number;
        unavailable: number;
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
            role: "primary" | "opposing" | "excluded";
            text: string;
        }[];
        handoff?: string;
    };
    questions: readonly NeedQuestion[];
    needs: readonly DocumentaryNeed[];
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
    excluded: <Badge tone="unknown">Excluded</Badge>,
};
const check = <WorkbenchIcon name="check" size={11} strokeWidth={2.4} />;

/** Initial preparation: documentary needs against the questions they serve, with how preparation ran on demand. */
export function SourcesPreparationScreen({
    frame,
    view,
    onInspectSources,
}: {
    frame: SourcesScreenFrame;
    view: SourcesPreparationView;
    onInspectSources: () => void;
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
                            className={styles.primaryAction}
                            size="lg"
                            onClick={onInspectSources}>
                            Inspect sources
                            <WorkbenchIcon
                                name="chevron"
                                size={14}
                                strokeWidth={2}
                            />
                        </Button>
                    </span>
                </div>
            }>
            <DocumentaryNeeds questions={view.questions} needs={view.needs} />
            <PreparationRun
                view={view}
                open={runOpen}
                onOpenChange={setRunOpen}
                triggerRef={runTrigger}
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
}: {
    view: SourcesPreparationView;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    triggerRef: Ref<HTMLButtonElement>;
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
                            <b>{reading.captured}</b> read · {reading.full}{" "}
                            full, {reading.partial} partial,{" "}
                            {reading.unavailable} unavailable
                        </span>
                        <ReadingBar
                            height={5}
                            counts={{
                                full: reading.full,
                                partial: reading.partial,
                                unavailable: reading.unavailable,
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
                description="Planned discovery within the allowance"
                metrics={[
                    {
                        id: "candidates",
                        value: collect.candidates,
                        label: "candidates",
                    },
                    {
                        id: "reused",
                        value: collect.reused,
                        label: "reused",
                        quiet: true,
                    },
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
                description="Capture, passages, documentary controls"
                metrics={[
                    {
                        id: "captured",
                        value: reading.captured,
                        label: "captured",
                    },
                    {
                        id: "passages",
                        value: reading.passages,
                        label: "passages located",
                        quiet: true,
                    },
                ]}
                footnote={reading.note}>
                <span className={styles.readingSummary}>
                    <ReadingBar
                        counts={{
                            full: reading.full,
                            partial: reading.partial,
                            unavailable: reading.unavailable,
                        }}
                    />
                    <span className={styles.readingLegend}>
                        <span>
                            <b>{reading.full}</b> full reading
                        </span>
                        <span>
                            <b>{reading.partial}</b> partial
                        </span>
                        <span>
                            <b>{reading.unavailable}</b> unavailable
                        </span>
                    </span>
                </span>
                <span className={styles.controls}>
                    <span className="wb-label">Documentary controls</span>
                    <span className={styles.badges}>
                        <Badge tone="ink">
                            {check}Supported {reading.controls.supported}
                        </Badge>
                        <Badge tone="counter">
                            <ClaimGlyph kind="counter" />
                            Conflict {reading.controls.conflict}
                        </Badge>
                        <Badge tone="unknown">
                            Not established {reading.controls.notEstablished}
                        </Badge>
                        <Badge tone="dashed">
                            Unfinished {reading.controls.unfinished}
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
            title="Every source, what was read, what it gives"
            headingAside={
                <InputGroup className={styles.search}>
                    <InputGroupAddon>
                        <Icon iconNode={Search01Icon} size={15} />
                    </InputGroupAddon>
                    <InputGroupInput
                        type="search"
                        aria-label="Search sources"
                        placeholder="Search sources or passages"
                        value={query}
                        onChange={(event) => onQueryChange(event.target.value)}
                    />
                </InputGroup>
            }>
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

/** Below this width the reader's three columns no longer fit; the document and its contributions share tabs beside the list. */
const splitReaderQuery = "(max-width: 1279px)";
/** Below this width the list takes the screen and each source opens in a drawer. */
const compactReaderQuery = "(max-width: 767px)";

/** One source in its reader, with the selected-source list and follow-up actions. */
export function SourcesReaderScreen({
    frame,
    trail,
    sources,
    selectedId,
    onSelectSource,
    summary,
    matrixLabel,
    onOpenMatrix,
    document,
    onRequestCheck,
    onChallengeSelection,
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
    summary: ReactNode;
    matrixLabel: string;
    onOpenMatrix: () => void;
    document: Omit<SourceReaderProps, "navigation" | "actions" | "layout">;
    onRequestCheck?: () => void;
    onChallengeSelection?: () => void;
}) {
    const split = useMediaQuery(splitReaderQuery);
    const compact = useMediaQuery(compactReaderQuery);
    const [drawerOpen, setDrawerOpen] = useState(false);
    /** The source the screen opened on appears at once; later selections arrive. */
    const [arriving, setArriving] = useState(false);
    const opener = useRef<HTMLElement | null>(null);
    const list = (
        <SourceReaderList
            groups={sources}
            selectedId={selectedId}
            onSelect={(id) => {
                if (id !== selectedId) setArriving(true);
                onSelectSource(id);
                if (!compact) return;
                opener.current =
                    globalThis.document.activeElement instanceof HTMLElement
                        ? globalThis.document.activeElement
                        : null;
                setDrawerOpen(true);
            }}
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
    const actions = (onRequestCheck || onChallengeSelection) && (
        <span className={styles.readerActions}>
            {onRequestCheck && (
                <Button
                    className={styles.readerPrimary}
                    onClick={onRequestCheck}>
                    Request a targeted check
                </Button>
            )}
            {onChallengeSelection && (
                <Button
                    variant="outline"
                    className={styles.readerSecondary}
                    onClick={onChallengeSelection}>
                    Challenge this selection
                </Button>
            )}
        </span>
    );
    return (
        <SourcesWorkspaceFrame
            {...frame}
            trail={trail}
            titleHidden
            title={document.title}>
            {compact ? (
                <>
                    <div className={styles.compactList}>{list}</div>
                    <Drawer
                        open={drawerOpen}
                        onOpenChange={setDrawerOpen}
                        showSwipeHandle>
                        <DrawerContent
                            aria-label={document.title}
                            finalFocus={opener}
                            className={styles.drawer}>
                            <WorkbenchUiRoot className={styles.drawerBody}>
                                <SourceReader
                                    sourceId={selectedId}
                                    {...document}
                                    layout="tabs"
                                    actions={actions}
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
            ) : split ? (
                <div className={styles.split}>
                    {list}
                    <div className={cn("wb-glass", styles.splitDocument)}>
                        <SourceReader
                            sourceId={selectedId}
                            {...document}
                            arriving={arriving}
                            layout="tabs"
                            actions={actions}
                        />
                    </div>
                </div>
            ) : (
                <SourceReader
                    sourceId={selectedId}
                    {...document}
                    arriving={arriving}
                    navigation={list}
                    actions={actions}
                />
            )}
        </SourcesWorkspaceFrame>
    );
}
