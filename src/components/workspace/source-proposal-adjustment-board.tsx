"use client";

import type { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { DragDropHorizontalIcon } from "@hugeicons/core-free-icons";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import type { ReactNode } from "react";

import { FaviconAvatar } from "@/components/favicon-avatar";
import Icon from "@/components/icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Kanban,
    KanbanBoard,
    KanbanColumn,
    KanbanColumnContent,
    KanbanItem,
    KanbanItemHandle,
    type KanbanMoveEvent,
    KanbanOverlay,
} from "@/components/ui/kanban";
import { SourceMasterList } from "@/components/workspace/source-master-list";
import {
    sourceCategoryLabel,
    sourceOriginLabel,
} from "@/lib/presentation/research-copy";

type ProposalSource = FunctionReturnType<
    typeof api.sourceSelectionProposals.listItemsPage
>["page"][number];
type AdjustmentSets = FunctionReturnType<
    typeof api.sourceSelectionProposals.getAdjustmentSets
>;
type SourceDecision = FunctionArgs<typeof api.sources.decide>["decision"];
type AdjustmentColumn = "included" | "available";

const preservePersistedOrder = () => undefined;

export function sourceDecisionForKanbanMove(
    activeContainer: string,
    overContainer: string,
): SourceDecision | null {
    if (activeContainer === overContainer) {
        return null;
    }
    if (overContainer === "included") {
        return "accepted";
    }
    if (overContainer === "available") {
        return "rejected";
    }
    return null;
}

export function SourceProposalAdjustmentBoard({
    adjustmentSets,
    reviewStatus,
    onDecide,
    annotation,
}: {
    adjustmentSets: AdjustmentSets;
    reviewStatus: "draft" | "approved";
    onDecide: (
        sourceId: Id<"sources">,
        decision: SourceDecision,
    ) => void | Promise<void>;
    annotation?: (source: ProposalSource) => ReactNode;
}) {
    const actionDisabled = reviewStatus === "approved";
    const columns: Record<AdjustmentColumn, ProposalSource[]> = {
        included: [...adjustmentSets.included],
        available: [...adjustmentSets.available],
    };

    const handleMove = ({
        event,
        activeContainer,
        overContainer,
    }: KanbanMoveEvent) => {
        if (actionDisabled) {
            return;
        }
        const decision = sourceDecisionForKanbanMove(
            activeContainer,
            overContainer,
        );
        if (!decision) {
            return;
        }
        void onDecide(event.active.id as Id<"sources">, decision);
    };

    const renderSourceItem = (source: ProposalSource, item: ReactNode) => (
        <KanbanItem
            key={source.sourceId}
            value={source.sourceId}
            render={<li />}
            disabled={actionDisabled}>
            {item}
        </KanbanItem>
    );

    const renderSourceHandle = (source: ProposalSource) => (
        <KanbanItemHandle
            aria-label={`Move ${source.title} between proposal sets`}
            className="grid size-6 shrink-0 place-items-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Icon iconNode={DragDropHorizontalIcon} size={13} />
        </KanbanItemHandle>
    );

    return (
        <Kanban
            value={columns}
            onValueChange={preservePersistedOrder}
            getItemValue={(source) => source.sourceId}
            onMove={handleMove}>
            <KanbanBoard className="grid-cols-1 sm:grid-cols-1 md:grid-cols-2">
                <ProposalAdjustmentColumn
                    column="included"
                    title="Included"
                    badgeValue={adjustmentSets.included.length}>
                    <SourceMasterList
                        heading="Included in proposal"
                        description="Sources currently selected for the proposed corpus."
                        items={adjustmentSets.included}
                        total={adjustmentSets.included.length}
                        reviewStatus={reviewStatus}
                        collectionLabel="Included proposal sources"
                        emptyTitle="No included sources"
                        emptyDescription="Drag a source here or use Include before approval."
                        annotation={annotation}
                        itemWrapper={renderSourceItem}
                        itemHandle={renderSourceHandle}
                        rowAction={(source) => (
                            <SourceAdjustmentActions
                                source={source}
                                column="included"
                                disabled={actionDisabled}
                                onDecide={onDecide}
                            />
                        )}
                    />
                </ProposalAdjustmentColumn>

                <ProposalAdjustmentColumn
                    column="available"
                    title="Available"
                    badgeValue={adjustmentSets.available.length}>
                    <SourceMasterList
                        heading="Available alternatives"
                        description="Candidates excluded from the proposal unless you include them."
                        items={adjustmentSets.available}
                        total={adjustmentSets.available.length}
                        reviewStatus={reviewStatus}
                        collectionLabel="Available proposal sources"
                        emptyTitle="No available alternatives"
                        emptyDescription="Drag an included source here or use Remove to exclude it."
                        annotation={annotation}
                        itemWrapper={renderSourceItem}
                        itemHandle={renderSourceHandle}
                        rowAction={(source) => (
                            <SourceAdjustmentActions
                                source={source}
                                column="available"
                                disabled={actionDisabled}
                                onDecide={onDecide}
                            />
                        )}
                    />
                </ProposalAdjustmentColumn>
            </KanbanBoard>

            <KanbanOverlay>
                {({ value, variant }) => {
                    if (variant !== "item") {
                        return null;
                    }
                    const source = [
                        ...columns.included,
                        ...columns.available,
                    ].find((candidate) => candidate.sourceId === value);
                    return source ? (
                        <SourceDragOverlay source={source} />
                    ) : null;
                }}
            </KanbanOverlay>
        </Kanban>
    );
}

function ProposalAdjustmentColumn({
    column,
    title,
    badgeValue,
    children,
}: {
    column: AdjustmentColumn;
    title: string;
        badgeValue: number;
    children: ReactNode;
}) {
    return (
        <KanbanColumn
            value={column}
            aria-label={`${title} proposal drop zone`}
            className="min-w-0 rounded-(--radius-source-card) outline-2 outline-offset-2 outline-transparent transition-colors data-[dragging=true]:opacity-60">
            <div className="flex gap-1 items-center mb-2">
                <h2 className="text-section">{title}</h2>
                <Badge variant="secondary">{badgeValue}</Badge>
            </div>
            <KanbanColumnContent value={column}>{children}</KanbanColumnContent>
        </KanbanColumn>
    );
}

function SourceDragOverlay({ source }: { source: ProposalSource }) {
    return (
        <div className="w-[min(32rem,calc(100vw-2rem))] rotate-1 overflow-hidden rounded-(--radius-source-card) border border-border/70 bg-card shadow-(--surface-shadow-floating)">
            <div className="flex items-center gap-2 border-b border-border/60 bg-secondary/70 px-3 py-2 text-[10px] font-medium">
                <span className="min-w-0 flex-1 truncate">
                    {source.canonicalUrl}
                </span>
                <Icon
                    iconNode={DragDropHorizontalIcon}
                    size={13}
                    className="text-muted-foreground"
                />
            </div>
            <div className="flex min-h-28 items-start gap-3 p-4">
                <FaviconAvatar
                    canonicalUrl={source.canonicalUrl}
                    size="default"
                />
                <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">
                        {source.title}
                    </p>
                    <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                        {sourceOriginLabel(source.origin)} ·{" "}
                        {sourceCategoryLabel(source.category)}
                    </p>
                </div>
            </div>
        </div>
    );
}

function SourceAdjustmentActions({
    source,
    column,
    disabled,
    onDecide,
}: {
    source: ProposalSource;
    column: AdjustmentColumn;
    disabled: boolean;
    onDecide: (
        sourceId: Id<"sources">,
        decision: SourceDecision,
    ) => void | Promise<void>;
}) {
    const isIncluded = column === "included";

    return (
        <>
            <Button
                type="button"
                size="xs"
                variant="outline"
                disabled={disabled}
                aria-label={
                    isIncluded
                        ? `Remove ${source.title} from proposal`
                        : `Include ${source.title}`
                }
                className={isIncluded ? "text-danger" : "text-info"}
                onClick={() =>
                    void onDecide(
                        source.sourceId,
                        isIncluded ? "rejected" : "accepted",
                    )
                }>
                {isIncluded ? "Remove" : "Include"}
            </Button>
            {source.decision !== "pending" ? (
                <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    disabled={disabled}
                    aria-label={`Reset ${source.title} to proposal`}
                    onClick={() => void onDecide(source.sourceId, "pending")}>
                    Reset to proposal
                </Button>
            ) : null}
        </>
    );
}
