"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useMutation, usePaginatedQuery } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";
import { AdminList } from "@/components/admin/admin-list";
import { AdminLoadMore } from "@/components/admin/admin-pager";
import { AdminRunInspection } from "@/components/admin/admin-run-inspection";
import {
    dossierPurposes,
    type RunPurpose,
} from "@/components/admin/dossier-purpose";
import { LoadErrorBoundary } from "@/components/load-error-boundary";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Empty,
    EmptyDescription,
    EmptyHeader,
    EmptyTitle,
} from "@/components/ui/empty";
import {
    Item,
    ItemActions,
    ItemContent,
    ItemDescription,
    ItemTitle,
} from "@/components/ui/item";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
    executionLabel,
    executionStatusTone,
    lifecycleLabel,
} from "@/lib/presentation/research-copy";

/**
 * Lists technical dossiers by purpose and opens their read-only inspection.
 * Benchmark and browser-test dossiers stay out of the analyst workspaces.
 */
export function AdminDossierBrowser() {
    const [selectedRunId, setSelectedRunId] =
        useState<Id<"researchRuns"> | null>(null);
    const [withdrawRunId, setWithdrawRunId] =
        useState<Id<"researchRuns"> | null>(null);

    return (
        <section className="space-y-3">
            <Tabs defaultValue="research">
                <TabsList>
                    {dossierPurposes.map((purpose) => (
                        <TabsTrigger key={purpose.value} value={purpose.value}>
                            {purpose.label}
                        </TabsTrigger>
                    ))}
                </TabsList>
                {dossierPurposes.map((purpose) => (
                    <TabsContent
                        key={purpose.value}
                        value={purpose.value}
                        className="mt-3">
                        <DossierList
                            purpose={purpose.value}
                            onInspect={setSelectedRunId}
                            onWithdraw={setWithdrawRunId}
                        />
                    </TabsContent>
                ))}
            </Tabs>

            <WithdrawDossierDialog
                run={withdrawRunId}
                onClose={() => setWithdrawRunId(null)}
            />

            <Dialog
                open={selectedRunId !== null}
                onOpenChange={(open) => {
                    if (!open) setSelectedRunId(null);
                }}>
                <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-xl">
                    <DialogHeader>
                        <DialogTitle>Dossier inspection</DialogTitle>
                        <DialogDescription>
                            Read-only history. Dossiers cannot be resumed from
                            this view.
                        </DialogDescription>
                    </DialogHeader>
                    {selectedRunId ? (
                        <LoadErrorBoundary
                            title="Inspection unavailable"
                            description="We couldn’t load this dossier. Try again.">
                            <AdminRunInspection runId={selectedRunId} />
                        </LoadErrorBoundary>
                    ) : null}
                </DialogContent>
            </Dialog>
        </section>
    );
}

function DossierList({
    purpose,
    onInspect,
    onWithdraw,
}: {
    purpose: RunPurpose;
    onInspect: (runId: Id<"researchRuns">) => void;
    onWithdraw: (runId: Id<"researchRuns">) => void;
}) {
    const runs = usePaginatedQuery(
        api.adminOperations.listRunsPage,
        { purpose },
        { initialNumItems: 20 },
    );

    if (runs.status === "LoadingFirstPage") {
        return (
            <div
                role="status"
                aria-label="Loading dossiers"
                aria-busy="true"
                className="space-y-2">
                <Skeleton className="h-16" />
                <Skeleton className="h-16" />
                <Skeleton className="h-16" />
            </div>
        );
    }

    if (runs.results.length === 0) {
        return (
            <Empty className="min-h-48">
                <EmptyHeader>
                    <EmptyTitle>No dossiers in this category</EmptyTitle>
                    <EmptyDescription>
                        Dossiers appear here once they are created.
                    </EmptyDescription>
                </EmptyHeader>
            </Empty>
        );
    }

    return (
        <div>
            <AdminList items={runs.results} getKey={(run) => run.runId}>
                {(run) => (
                    <Item size="sm">
                        <ItemContent className="min-w-0">
                            <ItemTitle>
                                {lifecycleLabel(run.lifecycleState)}
                            </ItemTitle>
                            {run.preparation?.configurationCheck ? (
                                <ItemDescription>
                                    Assessment configuration{" "}
                                    {run.preparation.configurationCheck
                                        .available
                                        ? "available"
                                        : "unavailable"}
                                </ItemDescription>
                            ) : null}
                            <p className="break-all font-mono text-xs text-muted-foreground">
                                {run.runId}
                            </p>
                            {run.preparation?.stopCode ? (
                                <p className="break-all font-mono text-[10px] text-muted-foreground">
                                    Preparation: {run.preparation.status} ·{" "}
                                    {run.preparation.stopCode}
                                </p>
                            ) : null}
                            {run.preparation?.failures?.map((failure) => (
                                <p
                                    key={failure.sourceId}
                                    className="break-all font-mono text-[10px] text-muted-foreground">
                                    Source {failure.sourceId}:{" "}
                                    {failure.reasonCode}
                                </p>
                            ))}
                        </ItemContent>
                        <ItemActions>
                            <Badge
                                variant="outline"
                                className={executionStatusTone(
                                    run.executionStatus,
                                )}>
                                {executionLabel(run.executionStatus)}
                            </Badge>
                            {run.withdrawnAt ? (
                                <Badge
                                    variant="outline"
                                    className="text-muted-foreground">
                                    Withdrawn
                                </Badge>
                            ) : null}
                            {run.canWithdraw ? (
                                <Button
                                    size="sm"
                                    variant="destructive"
                                    onClick={() => onWithdraw(run.runId)}>
                                    Withdraw dossier
                                </Button>
                            ) : null}
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={() => onInspect(run.runId)}>
                                Inspect dossier
                            </Button>
                        </ItemActions>
                    </Item>
                )}
            </AdminList>
            <AdminLoadMore page={runs} label="Load more dossiers" />
        </div>
    );
}

function WithdrawDossierDialog({
    run,
    onClose,
}: {
    run: Id<"researchRuns"> | null;
    onClose: () => void;
}) {
    const withdrawDossier = useMutation(api.admin.withdrawDossier);
    const [reason, setReason] = useState("");
    const [pending, setPending] = useState(false);

    return (
        <Dialog
            open={run !== null}
            onOpenChange={(open) => {
                if (!open) onClose();
            }}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Withdraw dossier</DialogTitle>
                    <DialogDescription>
                        This stops unfinished execution, removes the dossier
                        from the analyst workspace list and releases its
                        analysis once. Completed results stay readable through
                        their direct link.
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-2">
                    <Label htmlFor="dossier-withdrawal-reason">
                        Reason for withdrawal
                    </Label>
                    <Textarea
                        id="dossier-withdrawal-reason"
                        value={reason}
                        onChange={(event) => setReason(event.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                        Recorded in the audit trail. At least 12 characters.
                    </p>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button
                        variant="destructive"
                        disabled={pending || reason.trim().length < 12}
                        onClick={async () => {
                            if (!run) return;
                            setPending(true);
                            try {
                                await withdrawDossier({
                                    runId: run,
                                    reason: reason.trim(),
                                });
                                toast.success(
                                    "Dossier withdrawn. The analysis seat has been released.",
                                );
                                onClose();
                            } catch {
                                toast.error(
                                    "We couldn’t withdraw the dossier. Try again.",
                                );
                            } finally {
                                setPending(false);
                            }
                        }}>
                        Confirm withdrawal
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
