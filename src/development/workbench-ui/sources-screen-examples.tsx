import { useId, useRef, useState } from "react";
import { WorkbenchShellSurface } from "@/components/workbench-shell/workbench-shell-surface";
import {
    HelpTip,
    InventoryDock,
    WorkbenchUiRoot,
} from "@/components/workbench-ui";
import {
    SourcesMatrixScreen,
    type SourcesPreparationMode,
    SourcesPreparationScreen,
    SourcesReaderScreen,
    type SourcesScreenFrame,
} from "@/components/workspace/sources/sources-screens";
import { distribution } from "./fixture-data";
import { IllustrativeInventorySheet } from "./inventory-sheet-fixture";
import {
    annualReport,
    defaultMatrixFilters,
    filterIllustrativeSources,
    illustrativeSources,
    type MatrixFilterValues,
    matrixFilters,
    preparationView,
    readerSourceGroups,
    selectedSources,
    totalSources,
} from "./sources-fixture-data";

export const sourcesScreenNames = ["preparation", "matrix", "reader"] as const;
export type SourcesScreenName = (typeof sourcesScreenNames)[number];

function notify(message: string) {
    window.dispatchEvent(
        new CustomEvent("workbench-example-action", { detail: message }),
    );
}

const unavailableSections = [
    [
        "Investigation",
        "Question-led investigation is not available in this preview.",
    ],
    ["Synthesis", "Synthesis is not available in this preview."],
] as const;

/** Illustrative stand-in for the router-bound workspace navigation. */
function PreviewSectionNavigation({
    onOpenProgress,
}: {
    onOpenProgress: () => void;
}) {
    const id = useId();
    return (
        <nav
            aria-label="Research workspace sections"
            className="max-w-full overflow-x-auto p-0.5">
            <div className="segment-track">
                <button
                    type="button"
                    className="segment-item"
                    onClick={onOpenProgress}>
                    Progress
                </button>
                <button
                    type="button"
                    className="segment-item"
                    aria-current="page">
                    <span aria-hidden="true" className="wb-slash">
                        {"//"}
                    </span>
                    Sources
                </button>
                {unavailableSections.map(([label, reason]) => (
                    <span key={label} className="contents">
                        <HelpTip
                            side="bottom"
                            trigger={
                                <button
                                    type="button"
                                    aria-disabled="true"
                                    aria-describedby={`${id}-${label}`}
                                    className="segment-item">
                                    {label}
                                </button>
                            }>
                            {reason}
                        </HelpTip>
                        <span id={`${id}-${label}`} className="sr-only">
                            {reason}
                        </span>
                    </span>
                ))}
            </div>
        </nav>
    );
}

/** Sources workflow screens with illustrative data and local interactions only. */
export function SourcesScreenPreview({
    name,
    theme,
    onNavigate,
    onOpenProgress,
}: {
    name: SourcesScreenName;
    theme: "light" | "dark";
    onNavigate: (screen: SourcesScreenName) => void;
    onOpenProgress: () => void;
}) {
    const [selectedId, setSelectedId] = useState("10-k");
    const [pageId, setPageId] = useState<string>();
    const [query, setQuery] = useState("");
    const [filters, setFilters] =
        useState<MatrixFilterValues>(defaultMatrixFilters);
    const [inventoryOpen, setInventoryOpen] = useState(false);
    const [preparationMode, setPreparationMode] =
        useState<SourcesPreparationMode>("summary");
    const dockFocus = useRef<HTMLElement | null>(null);
    const source =
        illustrativeSources.find((item) => item.id === selectedId) ??
        annualReport;
    const page =
        source.document.pages.find((item) => item.id === pageId) ??
        source.document.pages[source.document.initialPage ?? 0];
    const openSource = (id: string) => {
        setSelectedId(id);
        setPageId(undefined);
        onNavigate("reader");
    };
    const frame: SourcesScreenFrame = {
        navigation: (
            <PreviewSectionNavigation onOpenProgress={onOpenProgress} />
        ),
        dock: (
            <InventoryDock
                total={126}
                newCount={3}
                distribution={distribution}
                onOpen={() => {
                    dockFocus.current =
                        document.activeElement instanceof HTMLElement
                            ? document.activeElement
                            : null;
                    setInventoryOpen(true);
                }}
            />
        ),
    };
    const preparationStep = {
        id: "preparation",
        label: "Preparation",
        onSelect: () => onNavigate("preparation"),
    };
    const matrixStep = {
        id: "matrix",
        label: "Source matrix",
        onSelect: () => onNavigate("matrix"),
    };
    return (
        <WorkbenchUiRoot
            theme={theme}
            className="start-screen-preview"
            style={{ lineHeight: 1.5 }}
            data-sources-screen={name}>
            <WorkbenchShellSurface>
                {name === "preparation" ? (
                    <SourcesPreparationScreen
                        frame={frame}
                        view={preparationView}
                        mode={preparationMode}
                        onModeChange={setPreparationMode}
                        onInspectSources={() => onNavigate("matrix")}
                    />
                ) : name === "matrix" ? (
                    <SourcesMatrixScreen
                        frame={frame}
                        trail={[preparationStep, matrixStep]}
                        rows={filterIllustrativeSources(query, filters)}
                        total={totalSources}
                        currentId={selectedId}
                        query={query}
                        onQueryChange={setQuery}
                        filters={matrixFilters.map((filter) => ({
                            ...filter,
                            value: filters[filter.id],
                        }))}
                        onFilterChange={(filterId, optionId) =>
                            setFilters((current) => ({
                                ...current,
                                [filterId]: optionId,
                            }))
                        }
                        onClearFilters={() => {
                            setQuery("");
                            setFilters(defaultMatrixFilters);
                        }}
                        onOpenSource={openSource}
                    />
                ) : (
                    <SourcesReaderScreen
                        frame={frame}
                        trail={[
                            preparationStep,
                            matrixStep,
                            { id: "source", label: source.title },
                        ]}
                        sources={readerSourceGroups}
                        selectedId={source.id}
                        onSelectSource={(id) => {
                            setSelectedId(id);
                            setPageId(undefined);
                        }}
                        summary={`${selectedSources} selected`}
                        matrixLabel={`All ${totalSources} in the matrix`}
                        onOpenMatrix={() => onNavigate("matrix")}
                        document={{
                            title: source.title,
                            meta: source.document.meta,
                            pages: source.document.pages,
                            initialPage: source.document.initialPage,
                            pagePosition:
                                page && source.document.pageCount
                                    ? `${page.label} / ${source.document.pageCount}`
                                    : undefined,
                            onPageChange: setPageId,
                            contributionLabel:
                                source.document.contributionLabel,
                            contributions: source.document.contributions,
                            observedLinks: source.document.observedLinks,
                            originalHref: source.document.originalHref,
                        }}
                        onRequestCheck={() =>
                            notify(
                                "Not connected in this preview · no check was requested",
                            )
                        }
                        onChallengeSelection={() =>
                            notify(
                                "Not connected in this preview · the selection is unchanged",
                            )
                        }
                    />
                )}
            </WorkbenchShellSurface>
            <IllustrativeInventorySheet
                open={inventoryOpen}
                onOpenChange={setInventoryOpen}
                finalFocus={dockFocus}
            />
        </WorkbenchUiRoot>
    );
}
