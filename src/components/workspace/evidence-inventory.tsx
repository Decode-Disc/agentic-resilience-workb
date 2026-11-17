import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { ArrowExpand01Icon } from "@hugeicons/core-free-icons";
import { useQuery } from "convex/react";
import { useEffect, useState } from "react";
import Icon from "@/components/icon";
import { LoadErrorBoundary } from "@/components/load-error-boundary";
import { Button } from "@/components/ui/button";
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { EvidenceMatrix } from "@/components/workspace/evidence-matrix";
import { cn } from "@/lib/utils";

/** Keeps the real inventory in context and mounted across closing, without inventing a classification distribution. */
export function EvidenceInventory({
    runId,
    open,
    onOpenChange,
    expanded = false,
}: {
    runId: Id<"researchRuns">;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    expanded?: boolean;
}) {
    const [hasOpened, setHasOpened] = useState(open);
    useEffect(() => {
        if (open) setHasOpened(true);
    }, [open]);
    return (
        <Sheet open={open} onOpenChange={(nextOpen) => onOpenChange(nextOpen)}>
            <div
                className={cn(
                    "fixed inset-x-4 bottom-4 z-40 rounded-xl bg-surface-float p-3 shadow-float backdrop-blur-glass sm:inset-x-auto sm:right-6 sm:bottom-7 sm:w-(--dock-width) md:right-12",
                    expanded && "xl:w-(--side-column) xl:rounded-2xl xl:p-5",
                )}>
                <div className="flex items-center justify-between gap-4">
                    <div>
                        <p className="text-micro">Inventory</p>
                        <LoadErrorBoundary
                            title="Inventory unavailable"
                            description="Try loading the inventory again."
                            variant="compact">
                            <InventoryCount runId={runId} expanded={expanded} />
                        </LoadErrorBoundary>
                    </div>
                    <SheetTrigger
                        render={
                            <Button
                                type="button"
                                variant="secondary"
                                size="icon"
                                aria-label="Open evidence inventory"
                                className="rounded-tile bg-fill-quiet"
                            />
                        }>
                        <Icon iconNode={ArrowExpand01Icon} />
                    </SheetTrigger>
                </div>
            </div>
            <SheetContent
                keepMounted={hasOpened}
                overlayClassName="bg-foreground/22 supports-backdrop-filter:backdrop-blur-[2px] motion-reduce:transition-none"
                className="rounded-3xl border-0 bg-card/95 shadow-float backdrop-blur-glass motion-reduce:transition-none data-[side=right]:inset-2 data-[side=right]:h-auto data-[side=right]:w-auto sm:data-[side=right]:inset-x-6 sm:data-[side=right]:top-20 sm:data-[side=right]:bottom-7 sm:data-[side=right]:max-w-none md:data-[side=right]:inset-x-12"
                showCloseButton>
                <SheetHeader className="shrink-0 border-b border-divider pr-14">
                    <SheetTitle className="text-2xl font-medium tracking-tight">
                        Evidence inventory
                    </SheetTitle>
                    <SheetDescription>
                        Inspect assertions, cited passages and their current
                        uses.
                    </SheetDescription>
                </SheetHeader>
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6">
                    {open || hasOpened ? (
                        <EvidenceMatrix key={runId} runId={runId} />
                    ) : null}
                </div>
            </SheetContent>
        </Sheet>
    );
}

function InventoryCount({
    runId,
    expanded,
}: {
    runId: Id<"researchRuns">;
    expanded: boolean;
}) {
    const summary = useQuery(api.evidenceMatrix.getSummary, { runId });
    return summary === undefined ? (
        <Skeleton
            aria-label="Loading inventory count"
            className="mt-2 h-7 w-28"
        />
    ) : (
        <p className="mt-1 flex items-baseline gap-2">
            <span
                className={
                    expanded
                        ? "text-base font-semibold xl:text-figure"
                        : "text-base font-semibold"
                }>
                {summary.claimCount}
            </span>
            <span className="text-xs text-muted-foreground">
                {summary.claimCount === 1 ? "assertion" : "assertions"}
            </span>
        </p>
    );
}
