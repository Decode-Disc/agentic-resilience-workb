import { LeftToRightListBulletIcon } from "@hugeicons/core-free-icons";
import { type ReactNode, useRef, useState } from "react";
import Icon from "@/components/icon";
import { WorkbenchShellSurface } from "@/components/workbench-shell/workbench-shell-surface";
import { WorkbenchUiRoot } from "@/components/workbench-ui";
import {
    SourcesMatrixScreen,
    SourcesReaderScreen,
    type SourcesScreenFrame,
} from "@/components/workspace/sources/sources-screens";
import {
    WorkspaceDock,
    workspaceDockActionClass,
} from "@/components/workspace/workspace-dock";
import { useMediaQuery } from "@/hooks/use-responsive";
import { IllustrativeInventorySheet } from "./inventory-sheet-fixture";
import {
    annualReport,
    defaultMatrixFilters,
    filterIllustrativeSources,
    illustrativeSources,
    type MatrixFilterValues,
    matrixFilters,
    readerQuestionTexts,
    readerSourceGroups,
    selectedSources,
    totalSources,
} from "./sources-fixture-data";

// The document matrix is the Sources landing; the preparation result lives in Progress.
export const sourcesScreenNames = ["matrix", "reader"] as const;
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

/** Illustrative stand-in for the router-bound workspace navigation, using the same dock. */
function PreviewSectionNavigation({
    onOpenProgress,
    inventory,
}: {
    onOpenProgress: () => void;
    inventory: ReactNode;
}) {
    const narrow = useMediaQuery("(max-width: 48rem)");
    return (
        <WorkspaceDock
            compact={narrow}
            actions={inventory}
            sections={[
                {
                    key: "overview",
                    label: "Progress",
                    current: false,
                    render: <button type="button" onClick={onOpenProgress} />,
                },
                {
                    key: "sources",
                    label: "Sources",
                    current: true,
                    render: <button type="button" />,
                },
                ...unavailableSections.map(([label, reason]) => ({
                    key: label.toLowerCase() as "investigation" | "synthesis",
                    label,
                    current: false,
                    unavailable: reason,
                    render: <button type="button" />,
                })),
            ]}
        />
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
    const [focusConflict, setFocusConflict] = useState(false);
    const [selectedId, setSelectedId] = useState("10-k");
    const [query, setQuery] = useState("");
    const [filters, setFilters] =
        useState<MatrixFilterValues>(defaultMatrixFilters);
    const [inventoryOpen, setInventoryOpen] = useState(false);
    const dockFocus = useRef<HTMLElement | null>(null);
    const source =
        illustrativeSources.find((item) => item.id === selectedId) ??
        annualReport;
    // Opening a chosen source starts it in the drawer on narrow screens, as in the workspace.
    const [openedSource, setOpenedSource] = useState(false);
    const openSource = (id: string) => {
        setSelectedId(id);
        setOpenedSource(true);
        onNavigate("reader");
    };
    const frame: SourcesScreenFrame = {
        // Mirrors the live section bar: inventory opens from its end, nothing floats over the content.
        navigation: (
            <PreviewSectionNavigation
                onOpenProgress={onOpenProgress}
                inventory={
                    <button
                        type="button"
                        aria-label="Open inventory"
                        className={workspaceDockActionClass}
                        onClick={(event) => {
                            dockFocus.current = event.currentTarget;
                            setInventoryOpen(true);
                        }}>
                        <Icon
                            iconNode={LeftToRightListBulletIcon}
                            className="size-4"
                        />
                        <span className="hidden sm:inline">Inventory</span>
                        <span className="rounded-full bg-background/18 px-2 py-0.5 font-mono text-xs font-semibold tabular-nums">
                            126
                        </span>
                    </button>
                }
            />
        ),
    };
    const documentsStep = {
        id: "matrix",
        label: "Documents",
        onSelect: () => onNavigate("matrix"),
    };
    return (
        <WorkbenchUiRoot
            theme={theme}
            className="start-screen-preview"
            style={{ lineHeight: 1.5 }}
            data-sources-screen={name}>
            <WorkbenchShellSurface>
                {name === "matrix" ? (
                    <SourcesMatrixScreen
                        frame={frame}
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
                            documentsStep,
                            { id: "source", label: source.title },
                        ]}
                        sources={readerSourceGroups}
                        selectedId={source.id}
                        openOnArrival={openedSource}
                        onCloseSource={() => setOpenedSource(false)}
                        onSelectSource={(id) => {
                            setSelectedId(id);
                            setFocusConflict(false);
                        }}
                        onOpenConflict={(id) => {
                            setSelectedId(id);
                            setFocusConflict(true);
                        }}
                        summary={`${selectedSources} selected`}
                        matrixLabel={`All ${totalSources} in the matrix`}
                        onOpenMatrix={() => onNavigate("matrix")}
                        document={{
                            title: source.title,
                            meta: source.document.meta,
                            pages: source.document.pages,
                            contributionLabel:
                                source.document.contributionLabel,
                            contributions: source.document.contributions,
                            questionTexts: readerQuestionTexts,
                            focusConflict,
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
