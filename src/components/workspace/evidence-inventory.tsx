import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { LeftToRightListBulletIcon } from "@hugeicons/core-free-icons";
import { useQuery } from "convex/react";
import { useEffect, useState } from "react";
import Icon from "@/components/icon";
import { LoadErrorBoundary } from "@/components/load-error-boundary";
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
import { workspaceDockActionClass } from "@/components/workspace/workspace-dock";

/** A compact section-bar trigger with the real assertion count; the sheet stays mounted across closing. */
export function EvidenceInventory({
    runId,
    open,
    onOpenChange,
}: {
    runId: Id<"researchRuns">;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const [hasOpened, setHasOpened] = useState(open);
    useEffect(() => {
        if (open) setHasOpened(true);
    }, [open]);
    return (
        <Sheet open={open} onOpenChange={(nextOpen) => onOpenChange(nextOpen)}>
            <SheetTrigger
                render={
                    <button
                        type="button"
                        aria-label="Open evidence inventory"
                        className={workspaceDockActionClass}
                    />
                }>
                <Icon iconNode={LeftToRightListBulletIcon} className="size-4" />
                <span className="hidden sm:inline">Inventory</span>
                <LoadErrorBoundary
                    title="Inventory unavailable"
                    description="Try loading the inventory again."
                    variant="compact">
                    <InventoryCount runId={runId} />
                </LoadErrorBoundary>
            </SheetTrigger>
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

function InventoryCount({ runId }: { runId: Id<"researchRuns"> }) {
    const summary = useQuery(api.evidenceMatrix.getSummary, { runId });
    return summary === undefined ? (
        <Skeleton
            aria-label="Loading inventory count"
            className="h-4 w-7 bg-background/25"
        />
    ) : (
        <span className="rounded-full bg-background/18 px-2 py-0.5 font-mono text-xs font-semibold tabular-nums">
            {summary.claimCount}
            <span className="sr-only">
                {summary.claimCount === 1 ? " assertion" : " assertions"}
            </span>
        </span>
    );
}
