"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { CLIENT_PAGE_SIZE } from "@convex/resourcePolicy";
import { ViewIcon } from "@hugeicons/core-free-icons";
import { usePaginatedQuery, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";

import { AdminExecutionJournal } from "@/components/admin/admin-execution-journal";
import {
    AdminAttemptFilters,
    attemptFilterDefaults,
    attemptMatchesFilters,
    filterSummary,
    formatAdminTotal,
} from "@/components/admin/admin-filters";
import { AdminList } from "@/components/admin/admin-list";
import { AdminListFooter } from "@/components/admin/admin-pager";
import { ProviderStatusBadge } from "@/components/admin/admin-status-badge";
import { dossierPurposeLabel } from "@/components/admin/dossier-purpose";
import Icon from "@/components/icon";
import { Button } from "@/components/ui/button";
import { DirectionAwareTabs } from "@/components/ui/direction-aware-tabs";
import {
    Item,
    ItemActions,
    ItemContent,
    ItemDescription,
    ItemTitle,
} from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { formatAdminCost } from "@/lib/presentation/admin";
import {
    providerErrorLabel,
    providerOperationLabel,
    providerServiceLabel,
} from "@/lib/presentation/research-copy";

type ProviderCall = FunctionReturnType<
    typeof api.adminOperations.get
>["providerCalls"][number];
type ReceiptDoc = FunctionReturnType<
    typeof api.adminOperations.listRunProviderCallsPage
>["page"][number];

/**
 * Receipt documents store the validation reason under `diagnostic`; the
 * operations projection flattens it. Written keys keep the optional fields
 * present (required-with-undefined) as the projection type expects.
 */
function toProviderCallProjection(call: ReceiptDoc): ProviderCall {
    return {
        _id: call._id,
        providerObservation: call.providerObservation,
        billing: call.billing,
        runId: call.runId,
        service: call.service,
        operation: call.operation,
        status: call.status,
        usage: call.usage,
        reportedCost: call.reportedCost,
        errorCode: call.errorCode,
        validationReason: call.diagnostic?.reason,
        preparationId: call.preparationId,
        sourceId: call.sourceId,
        attempt: call.attempt,
        dispatchOutcome: call.dispatchOutcome,
        httpStatus: call.httpStatus,
        retryAfterAt: call.retryAfterAt,
        recoveryOfProviderCallId: call.recoveryOfProviderCallId,
        createdAt: call.createdAt,
    };
}

/** Read-only dossier history with its provider receipts. */
export function AdminRunInspection({
    runId,
    onInspectCall,
}: {
    runId: Id<"researchRuns">;
    onInspectCall: (call: ProviderCall) => void;
}) {
    const details = useQuery(api.adminOperations.inspectRun, { runId });
    const calls = usePaginatedQuery(
        api.adminOperations.listRunProviderCallsPage,
        { runId },
        { initialNumItems: CLIENT_PAGE_SIZE.adminProviderCalls },
    );
    const [filters, setFilters] = useState(attemptFilterDefaults);
    const receiptTotal = useQuery(api.adminOperations.countRunProviderCalls, {
        runId,
    });

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

    const { run } = details;
    const now = Date.now();
    const filtered = calls.results.filter((call) =>
        attemptMatchesFilters(toProviderCallProjection(call), filters, now),
    );

    return (
        <div className="min-w-0 space-y-5">
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
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
            </dl>

            <DirectionAwareTabs
                defaultTabId="receipts"
                containerClassName="items-start"
                contentSizing="fill"
                tabs={[
                    {
                        id: "receipts",
                        label: `Provider receipts${receiptTotal ? ` · ${formatAdminTotal(receiptTotal)}` : ""}`,
                        content: (
                            <section
                                aria-label="Provider receipts"
                                className="space-y-2">
                                <div className="flex flex-wrap items-center gap-2">
                                    <AdminAttemptFilters
                                        filters={filters}
                                        onChange={setFilters}
                                        className="flex flex-wrap items-center gap-2"
                                    />
                                </div>

                                {calls.status === "LoadingFirstPage" ? (
                                    <p
                                        role="status"
                                        className="text-sm text-muted-foreground">
                                        Loading receipts…
                                    </p>
                                ) : calls.results.length === 0 ? (
                                    <p className="text-sm text-muted-foreground">
                                        No provider receipts for this dossier.
                                    </p>
                                ) : (
                                    <>
                                        {filtered.length === 0 ? (
                                            <p className="text-sm text-muted-foreground">
                                                No loaded receipt matches the
                                                selected filters.
                                            </p>
                                        ) : (
                                            <AdminList
                                                items={filtered}
                                                getKey={(call) => call._id}>
                                                {(call) => (
                                                    <Item
                                                        size="xs"
                                                        className="flex-wrap">
                                                        <ItemContent className="min-w-56">
                                                            <ItemTitle>
                                                                {providerServiceLabel(
                                                                    call.service,
                                                                )}{" "}
                                                                ·{" "}
                                                                {providerOperationLabel(
                                                                    call.operation,
                                                                )}
                                                            </ItemTitle>
                                                            {call.errorCode ? (
                                                                <ItemDescription>
                                                                    {providerErrorLabel(
                                                                        call.errorCode,
                                                                    )}
                                                                </ItemDescription>
                                                            ) : null}
                                                            <ItemDescription>
                                                                {new Date(
                                                                    call.createdAt,
                                                                ).toLocaleString(
                                                                    "en",
                                                                )}{" "}
                                                                · Attempt{" "}
                                                                {call.attempt}
                                                                {call.reportedCost !==
                                                                undefined
                                                                    ? ` · Reported cost ${formatAdminCost(call.reportedCost)}`
                                                                    : ""}
                                                            </ItemDescription>
                                                        </ItemContent>
                                                        <ItemActions>
                                                            <ProviderStatusBadge
                                                                status={
                                                                    call.status
                                                                }
                                                            />
                                                            <Button
                                                                size="sm"
                                                                variant="outline"
                                                                onClick={() =>
                                                                    onInspectCall(
                                                                        toProviderCallProjection(
                                                                            call,
                                                                        ),
                                                                    )
                                                                }>
                                                                <Icon
                                                                    iconNode={
                                                                        ViewIcon
                                                                    }
                                                                />
                                                                Inspect attempt
                                                            </Button>
                                                        </ItemActions>
                                                    </Item>
                                                )}
                                            </AdminList>
                                        )}
                                        <AdminListFooter
                                            summary={filterSummary(
                                                filtered.length,
                                                receiptTotal,
                                                "receipts",
                                                calls.results.length,
                                            )}
                                            page={calls}
                                            label="Load more receipts"
                                        />
                                    </>
                                )}
                            </section>
                        ),
                    },
                    {
                        id: "journal",
                        label: "Execution journal",
                        content: <AdminExecutionJournal runId={runId} />,
                    },
                ]}
            />
        </div>
    );
}
