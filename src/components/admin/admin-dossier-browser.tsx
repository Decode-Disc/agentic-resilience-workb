"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { CLIENT_PAGE_SIZE } from "@convex/resourcePolicy";
import { FolderOpenIcon } from "@hugeicons/core-free-icons";
import { usePaginatedQuery, useQuery } from "convex/react";
import { useState } from "react";
import { AdminDetailDisclosure } from "@/components/admin/admin-detail-disclosure";
import {
    AdminDossierFilters,
    type DossierRunFilters,
    dossierFilterDefaults,
    dossierMatchesFilters,
    filterSummary,
} from "@/components/admin/admin-filters";
import { AdminList } from "@/components/admin/admin-list";
import { AdminListFooter } from "@/components/admin/admin-pager";
import { AdminScrollList } from "@/components/admin/admin-scroll-list";
import { AdminMarkBadge } from "@/components/admin/admin-status-badge";
import {
    dossierPurposes,
    type RunPurpose,
} from "@/components/admin/dossier-purpose";
import { DossierStatusBadge } from "@/components/dossier-status-badge";
import Icon from "@/components/icon";
import { Button } from "@/components/ui/button";
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
import { lifecycleLabel } from "@/lib/presentation/research-copy";

/**
 * Lists dossiers of one purpose; opening one shows its detail beside the list. The purpose is controlled so
 * an open dossier always belongs to the list in view. Benchmark and browser-test dossiers stay out of the
 * analyst workspaces.
 */
export function AdminDossierBrowser({
    purpose,
    onPurposeChange,
    selectedId,
    onOpenDossier,
}: {
    purpose: RunPurpose;
    onPurposeChange: (purpose: RunPurpose) => void;
    /** The dossier shown beside the list, marked as current. */
    selectedId?: Id<"researchRuns">;
    onOpenDossier: (runId: Id<"researchRuns">) => void;
}) {
    const [filters, setFilters] = useState(dossierFilterDefaults);

    return (
        <Tabs
            value={purpose}
            onValueChange={(value) => {
                const next = dossierPurposes.find(
                    (entry) => entry.value === value,
                )?.value;
                if (next) onPurposeChange(next);
            }}
            className="gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <TabsList>
                    {dossierPurposes.map((entry) => (
                        <TabsTrigger key={entry.value} value={entry.value}>
                            {entry.label}
                        </TabsTrigger>
                    ))}
                </TabsList>
                <AdminDossierFilters
                    filters={filters}
                    onChange={setFilters}
                    className="flex items-center gap-2"
                />
            </div>
            {dossierPurposes.map((entry) => (
                <TabsContent key={entry.value} value={entry.value}>
                    <DossierList
                        purpose={entry.value}
                        filters={filters}
                        selectedId={selectedId}
                        onOpenDossier={onOpenDossier}
                    />
                </TabsContent>
            ))}
        </Tabs>
    );
}

function DossierList({
    purpose,
    filters,
    selectedId,
    onOpenDossier,
}: {
    purpose: RunPurpose;
    filters: DossierRunFilters;
    selectedId?: Id<"researchRuns">;
    onOpenDossier: (runId: Id<"researchRuns">) => void;
}) {
    const purposeLabel =
        dossierPurposes.find((entry) => entry.value === purpose)?.label ??
        "Dossier";
    const runs = usePaginatedQuery(
        api.adminOperations.listRunsPage,
        { purpose },
        { initialNumItems: CLIENT_PAGE_SIZE.adminDossiers },
    );
    const total = useQuery(api.adminOperations.countRuns, { purpose });

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

    const filtered = runs.results.filter((run) =>
        dossierMatchesFilters(run, filters, Date.now()),
    );

    return (
        <div>
            {filtered.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                    No loaded dossier matches the selected filters.
                </p>
            ) : (
                <AdminScrollList label={`${purposeLabel} dossiers`}>
                    <AdminList items={filtered} getKey={(run) => run.runId}>
                        {(run) => (
                            <Item
                                size="sm"
                                aria-current={
                                    run.runId === selectedId
                                        ? "true"
                                        : undefined
                                }
                                className="flex-wrap px-2 aria-current:bg-accent">
                                <ItemContent className="min-w-56">
                                    <ItemTitle>
                                        {run.companyLegalName ??
                                            "Company not recorded"}
                                    </ItemTitle>
                                    <ItemDescription className="flex flex-wrap gap-x-1.5">
                                        <span>
                                            {run.lifecycleState ===
                                            "sources_prepared"
                                                ? "Investigation is not available yet"
                                                : lifecycleLabel(
                                                      run.lifecycleState,
                                                  )}
                                        </span>
                                        <span aria-hidden="true">·</span>
                                        <span>
                                            Updated{" "}
                                            {new Date(
                                                run.updatedAt,
                                            ).toLocaleString("en", {
                                                dateStyle: "medium",
                                                timeStyle: "short",
                                            })}
                                        </span>
                                    </ItemDescription>
                                    <p className="truncate font-mono text-xs text-muted-foreground">
                                        {run.runId}
                                    </p>
                                    {run.preparation ? (
                                        <AdminDetailDisclosure label="Preparation details">
                                            {run.preparation
                                                .configurationCheck ? (
                                                <p className="text-xs text-muted-foreground">
                                                    Assessment configuration{" "}
                                                    {run.preparation
                                                        .configurationCheck
                                                        .available
                                                        ? "available"
                                                        : "unavailable"}
                                                </p>
                                            ) : null}
                                            {run.preparation.stopCode ? (
                                                <p className="break-all font-mono text-[10px] text-muted-foreground">
                                                    Preparation:{" "}
                                                    {run.preparation.status} ·{" "}
                                                    {run.preparation.stopCode}
                                                </p>
                                            ) : null}
                                            {run.preparation.failures?.map(
                                                (failure) => (
                                                    <p
                                                        key={failure.sourceId}
                                                        className="break-all font-mono text-[10px] text-muted-foreground">
                                                        Source{" "}
                                                        {failure.sourceId}:{" "}
                                                        {failure.reasonCode}
                                                    </p>
                                                ),
                                            )}
                                        </AdminDetailDisclosure>
                                    ) : null}
                                </ItemContent>
                                <ItemActions>
                                    <DossierStatusBadge run={run} />
                                    {run.withdrawnAt ? (
                                        <AdminMarkBadge mark="withdrawn" />
                                    ) : null}
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() =>
                                            onOpenDossier(run.runId)
                                        }>
                                        <Icon iconNode={FolderOpenIcon} />
                                        Open dossier
                                    </Button>
                                </ItemActions>
                            </Item>
                        )}
                    </AdminList>
                </AdminScrollList>
            )}
            <AdminListFooter
                summary={filterSummary(
                    filtered.length,
                    total,
                    "dossiers",
                    runs.results.length,
                )}
                page={runs}
                label="Load more dossiers"
            />
        </div>
    );
}
