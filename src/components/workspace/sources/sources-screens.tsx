import {
    ArrowDown01Icon,
    Cancel01Icon,
    Search01Icon,
} from "@hugeicons/core-free-icons";
import { type ReactNode, useEffect, useRef, useState } from "react";
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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
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
    AttachedLimitation,
    CoverageBar,
    PreparationRows,
    PreparationStageCard,
    PreparationStageRow,
    PreparationSummary,
    PreparationSummaryStep,
    QuestionCoverageRow,
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
export type LimitationCause =
    | "missing-content"
    | "partial-reading"
    | "failed-preparation";

/** Presentation figures for one preparation; the consumer derives them from persisted work. */
export interface SourcesPreparationView {
    eyebrow: string;
    title: string;
    /** One readable conclusion supplied by the consumer. */
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
    coverage: readonly {
        id: string;
        label: string;
        question: string;
        contributing: number;
        opposing: number;
        covered: boolean;
    }[];
    limitations: readonly {
        id: string;
        cause: LimitationCause;
        /** The affected question; absent when the limit is not specific to one. */
        questionId?: string;
        scope: string;
        text: string;
    }[];
}

/** `summary` leads with the conclusion; `questions` puts coverage first with the full preparation on demand. */
export type SourcesPreparationMode = "summary" | "questions";

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
const roleLabels = {
    primary: "Primary",
    opposing: "Opposing",
    excluded: "Excluded",
};
/** One presentation per limitation cause: disclosed gaps in review tone, failed work in destructive tone. */
const limitationPresentation: Record<
    LimitationCause,
    { label: string; tone: "review" | "destructive" }
> = {
    "missing-content": { label: "Missing content", tone: "review" },
    "partial-reading": { label: "Partial reading", tone: "review" },
    "failed-preparation": { label: "Failed preparation", tone: "destructive" },
};
function LimitationBadge({ cause }: { cause: LimitationCause }) {
    const { label, tone } = limitationPresentation[cause];
    return <Badge tone={tone}>{label}</Badge>;
}
const check = <WorkbenchIcon name="check" size={11} strokeWidth={2.4} />;

function coverageStatus(covered: boolean) {
    return covered ? (
        <Badge tone="ink">
            {check}
            Covered
        </Badge>
    ) : (
        <Badge tone="review">Gap disclosed</Badge>
    );
}

/** Initial preparation: a readable summary by default, coverage by question with the full preparation on demand. */
export function SourcesPreparationScreen({
    frame,
    view,
    mode,
    onModeChange,
    onInspectSources,
}: {
    frame: SourcesScreenFrame;
    view: SourcesPreparationView;
    mode: SourcesPreparationMode;
    onModeChange: (mode: SourcesPreparationMode) => void;
    onInspectSources: () => void;
}) {
    const [detailsOpen, setDetailsOpen] = useState(false);
    const showDetails = () => {
        setDetailsOpen(true);
        onModeChange("questions");
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
                </div>
            }>
            <ToggleGroup
                aria-label="Preparation view"
                className={cn(styles.segment, styles.viewSwitch)}
                spacing={0}
                value={[mode]}
                onValueChange={(next) => {
                    const option = next.find((value) => value !== mode);
                    if (option === "summary" || option === "questions")
                        onModeChange(option);
                }}>
                <ToggleGroupItem value="summary" className={styles.filter}>
                    Summary
                </ToggleGroupItem>
                <ToggleGroupItem value="questions" className={styles.filter}>
                    By question
                </ToggleGroupItem>
            </ToggleGroup>
            {mode === "summary" ? (
                <PreparationSummaryView
                    view={view}
                    onShowDetails={showDetails}
                />
            ) : (
                <PreparationByQuestion
                    view={view}
                    detailsOpen={detailsOpen}
                    onDetailsOpenChange={setDetailsOpen}
                />
            )}
        </SourcesWorkspaceFrame>
    );
}

function PreparationSummaryView({
    view,
    onShowDetails,
}: {
    view: SourcesPreparationView;
    onShowDetails: () => void;
}) {
    const { collect, reading, organize } = view;
    const questionLabel = (id?: string) =>
        view.coverage.find((row) => row.id === id)?.label;
    const details = (label: string) => (
        <Button
            variant="ghost"
            size="sm"
            className={styles.detailsLink}
            aria-label={label}
            onClick={onShowDetails}>
            Details
            <WorkbenchIcon name="chevron" size={12} strokeWidth={2} />
        </Button>
    );
    return (
        <div className={styles.summaryColumn}>
            <PreparationSummary>
                <PreparationSummaryStep
                    marker="1"
                    title={`${collect.candidates} sources found, ${reading.captured} read`}
                    description={`${reading.full} full readings, ${reading.partial} partial, ${reading.unavailable} unavailable.${collect.note ? ` ${collect.note}.` : ""}`}
                    action={details("Details on how sources were read")}>
                    <ReadingBar
                        width="min(300px, 100%)"
                        height={6}
                        counts={{
                            full: reading.full,
                            partial: reading.partial,
                            unavailable: reading.unavailable,
                        }}
                    />
                </PreparationSummaryStep>
                <PreparationSummaryStep
                    marker="2"
                    title={`${organize.selected} selected, ${organize.context} kept as context`}
                    description={organize.uses
                        .map((use) => `${roleLabels[use.role]}: ${use.text}.`)
                        .join(" ")}
                    action={details("Details on the selection")}
                />
                <PreparationSummaryStep marker="3" title="Coverage by question">
                    <ul className={styles.compactCoverage}>
                        {view.coverage.map((row) => (
                            <li key={row.id}>
                                <span className="wb-meta">{row.label}</span>
                                <span>{row.question}</span>
                                <span className="wb-meta">
                                    {row.contributing} · {row.opposing} opposing
                                </span>
                                {coverageStatus(row.covered)}
                            </li>
                        ))}
                    </ul>
                </PreparationSummaryStep>
                {view.limitations.length > 0 && (
                    <PreparationSummaryStep
                        marker={
                            <WorkbenchIcon
                                name="unestablished"
                                size={15}
                                strokeWidth={2}
                            />
                        }
                        tone="attention"
                        title="What is missing">
                        <ul className={styles.missing}>
                            {view.limitations.map((limitation) => {
                                const label = questionLabel(
                                    limitation.questionId,
                                );
                                return (
                                    <li key={limitation.id}>
                                        {label && <b>{label}</b>}
                                        {limitation.text}
                                    </li>
                                );
                            })}
                        </ul>
                    </PreparationSummaryStep>
                )}
            </PreparationSummary>
        </div>
    );
}

function PreparationByQuestion({
    view,
    detailsOpen,
    onDetailsOpenChange,
}: {
    view: SourcesPreparationView;
    detailsOpen: boolean;
    onDetailsOpenChange: (open: boolean) => void;
}) {
    const { collect, reading, organize } = view;
    const scale = Math.max(1, ...view.coverage.map((row) => row.contributing));
    const general = view.limitations.filter(
        (limitation) => !limitation.questionId,
    );
    return (
        <>
            <section
                className={cn("wb-glass wb-focal", styles.panel)}
                aria-labelledby="sources-coverage-heading">
                <span className={styles.panelHead}>
                    <h2 id="sources-coverage-heading">Coverage by question</h2>
                    <span className="wb-meta">
                        sources contributing · of which opposing
                    </span>
                </span>
                <PreparationRows>
                    {view.coverage.map((row) => (
                        <QuestionCoverageRow
                            key={row.id}
                            size="prominent"
                            label={row.label}
                            question={row.question}
                            bar={
                                <CoverageBar
                                    contributing={row.contributing}
                                    opposing={row.opposing}
                                    scale={scale}
                                />
                            }
                            meta={`${row.contributing} · ${row.opposing} opposing`}
                            status={coverageStatus(row.covered)}>
                            {view.limitations
                                .filter(
                                    (limitation) =>
                                        limitation.questionId === row.id,
                                )
                                .map((limitation) => (
                                    <AttachedLimitation
                                        key={limitation.id}
                                        tone={
                                            limitationPresentation[
                                                limitation.cause
                                            ].tone
                                        }
                                        cause={
                                            limitationPresentation[
                                                limitation.cause
                                            ].label
                                        }>
                                        {limitation.text}
                                    </AttachedLimitation>
                                ))}
                        </QuestionCoverageRow>
                    ))}
                </PreparationRows>
            </section>
            <Collapsible
                open={detailsOpen}
                onOpenChange={onDetailsOpenChange}
                className={cn("wb-glass", styles.process)}>
                <div className={styles.processLine}>
                    <span className={cn("wb-label", styles.processLabel)}>
                        How it was prepared
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
                                <b>{organize.selected}</b> selected ·{" "}
                                {organize.context} kept as context
                            </span>
                        </span>
                    </span>
                    <CollapsibleTrigger
                        render={
                            <Button
                                variant="outline"
                                size="sm"
                                className={styles.processToggle}
                            />
                        }>
                        {detailsOpen ? "Hide details" : "Show details"}
                    </CollapsibleTrigger>
                </div>
                {general.length > 0 && (
                    <ul className={styles.generalLimits}>
                        {general.map((limitation) => (
                            <li key={limitation.id}>
                                <LimitationBadge cause={limitation.cause} />
                                {limitation.text}
                            </li>
                        ))}
                    </ul>
                )}
                <CollapsibleContent>
                    <PreparationStages view={view} />
                </CollapsibleContent>
            </Collapsible>
            {view.description && (
                <p className={cn("wb-meta", styles.preparationNote)}>
                    {view.description}
                </p>
            )}
        </>
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
            />
            {rows.length > pageSize && (
                <div className={styles.pages}>
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
                </div>
            )}
        </SourcesWorkspaceFrame>
    );
}

/** Below this width the reader's three columns no longer fit; sources open in a drawer instead. */
const compactReaderQuery = "(max-width: 1180px)";

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
    const compact = useMediaQuery(compactReaderQuery);
    const [drawerOpen, setDrawerOpen] = useState(false);
    const opener = useRef<HTMLElement | null>(null);
    const list = (
        <SourceReaderList
            groups={sources}
            selectedId={selectedId}
            onSelect={(id) => {
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
                                    key={selectedId}
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
            ) : (
                <SourceReader
                    key={selectedId}
                    {...document}
                    navigation={list}
                    actions={actions}
                />
            )}
        </SourcesWorkspaceFrame>
    );
}
