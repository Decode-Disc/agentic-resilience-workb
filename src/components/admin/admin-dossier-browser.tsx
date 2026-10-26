"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { usePaginatedQuery } from "convex/react";
import { useState } from "react";

import {
    dossierPurposes,
    type RunPurpose,
} from "@/components/admin/dossier-purpose";
import { AdminList } from "@/components/admin/admin-list";
import { AdminLoadMore } from "@/components/admin/admin-pager";
import { AdminRunInspection } from "@/components/admin/admin-run-inspection";
import { LoadErrorBoundary } from "@/components/load-error-boundary";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
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
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
                        />
                    </TabsContent>
                ))}
            </Tabs>

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
}: {
    purpose: RunPurpose;
    onInspect: (runId: Id<"researchRuns">) => void;
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
