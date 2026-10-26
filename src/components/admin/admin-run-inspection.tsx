"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { usePaginatedQuery, useQuery } from "convex/react";

import { AdminList } from "@/components/admin/admin-list";
import { AdminLoadMore } from "@/components/admin/admin-pager";
import { dossierPurposeLabel } from "@/components/admin/dossier-purpose";
import { Badge } from "@/components/ui/badge";
import {
    Item,
    ItemActions,
    ItemContent,
    ItemDescription,
    ItemTitle,
} from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import {
    executionLabel,
    lifecycleLabel,
    providerOperationLabel,
    providerServiceLabel,
    providerStatusLabel,
} from "@/lib/presentation/research-copy";

/** Read-only dossier history with its provider receipts. */
export function AdminRunInspection({ runId }: { runId: Id<"researchRuns"> }) {
    const details = useQuery(api.adminOperations.inspectRun, { runId });
    const calls = usePaginatedQuery(
        api.adminOperations.listRunProviderCallsPage,
        { runId },
        { initialNumItems: 20 },
    );

    if (!details) {
        return (
            <div
                role="status"
                aria-label="Loading dossier"
                aria-busy="true"
                className="space-y-2">
                <Skeleton className="h-32" />
                <Skeleton className="h-16" />
            </div>
        );
    }

    const { run, company } = details;

    return (
        <div className="space-y-5">
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
                <dt className="text-muted-foreground">Company</dt>
                <dd>
                    {company?.legalName ??
                        run.companySnapshot?.legalName ??
                        "Not recorded"}
                </dd>
                <dt className="text-muted-foreground">Purpose</dt>
                <dd>
                    {run.purpose
                        ? dossierPurposeLabel(run.purpose)
                        : "Awaiting classification"}
                </dd>
                <dt className="text-muted-foreground">Dossier</dt>
                <dd className="break-all font-mono text-xs">{run._id}</dd>
                <dt className="text-muted-foreground">Owner</dt>
                <dd className="break-all font-mono text-xs">
                    {run.ownerVisitorId ?? "None"}
                </dd>
                <dt className="text-muted-foreground">State</dt>
                <dd>
                    {lifecycleLabel(run.lifecycleState)} ·{" "}
                    {executionLabel(run.executionStatus)}
                </dd>
                <dt className="text-muted-foreground">Created</dt>
                <dd>{new Date(run.createdAt).toLocaleString("en")}</dd>
            </dl>

            <section className="space-y-2">
                <h3 className="text-section">Provider receipts</h3>
                {calls.status === "LoadingFirstPage" ? (
                    <p role="status" className="text-sm text-muted-foreground">
                        Loading receipts…
                    </p>
                ) : calls.results.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                        No provider receipts for this dossier.
                    </p>
                ) : (
                    <AdminList
                        items={calls.results}
                        getKey={(call) => call._id}>
                        {(call) => (
                            <Item size="xs">
                                <ItemContent className="min-w-0">
                                    <ItemTitle>
                                        {providerServiceLabel(call.service)} ·{" "}
                                        {providerOperationLabel(call.operation)}
                                    </ItemTitle>
                                    <ItemDescription>
                                        {new Date(
                                            call.createdAt,
                                        ).toLocaleString("en")}{" "}
                                        · Attempt {call.attempt}
                                        {call.reportedCost !== undefined
                                            ? ` · Reported cost ${call.reportedCost}`
                                            : ""}
                                    </ItemDescription>
                                </ItemContent>
                                <ItemActions>
                                    <Badge variant="secondary">
                                        {providerStatusLabel(call.status)}
                                    </Badge>
                                </ItemActions>
                            </Item>
                        )}
                    </AdminList>
                )}
                <AdminLoadMore page={calls} label="Load more receipts" />
            </section>
        </div>
    );
}
