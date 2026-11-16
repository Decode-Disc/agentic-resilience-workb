"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { CLIENT_PAGE_SIZE } from "@convex/resourcePolicy";
import { ArrowTurnBackwardIcon } from "@hugeicons/core-free-icons";
import { useMutation, usePaginatedQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";
import { toast } from "sonner";

import {
    AdminReservationFilters,
    filterSummary,
    reservationFilterDefaults,
    reservationMatchesFilters,
} from "@/components/admin/admin-filters";
import { AdminList } from "@/components/admin/admin-list";
import { AdminListFooter } from "@/components/admin/admin-pager";
import { AdminReasonDialog } from "@/components/admin/admin-reason-dialog";
import { AdminScrollList } from "@/components/admin/admin-scroll-list";
import { AdminMarkBadge } from "@/components/admin/admin-status-badge";
import Icon from "@/components/icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
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

type Reservation = FunctionReturnType<
    typeof api.adminOperations.get
>["reservations"][number];

/** Remaining analysis reservations and audited restoration of unused ones. */
export function AdminReservations({
    reservations,
}: {
    reservations: Reservation[];
}) {
    const [filters, setFilters] = useState(reservationFilterDefaults);
    const filtered = reservations.filter((reservation) =>
        reservationMatchesFilters(reservation, filters, Date.now()),
    );

    return (
        <div className="grid items-start gap-4 xl:grid-cols-2">
            <Card>
                <CardHeader>
                    <CardTitle>
                        <h3>Remaining reservations</h3>
                    </CardTitle>
                    <CardDescription>
                        Each access slot and the analyses it can still start.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                    <AdminReservationFilters
                        filters={filters}
                        onChange={setFilters}
                        className="flex flex-wrap items-center gap-2"
                    />
                    {reservations.length === 0 ? (
                        <Empty className="min-h-40">
                            <EmptyHeader>
                                <EmptyTitle>No reserved analyses</EmptyTitle>
                                <EmptyDescription>
                                    Analysts appear here once they claim an
                                    access slot.
                                </EmptyDescription>
                            </EmptyHeader>
                        </Empty>
                    ) : filtered.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                            No loaded reservation matches the selected filters.
                        </p>
                    ) : (
                        <>
                            <AdminScrollList label="Remaining reservations">
                                <AdminList
                                    items={filtered}
                                    getKey={(reservation) =>
                                        reservation.visitorId
                                    }>
                                    {(reservation) => (
                                        <Item size="sm">
                                            <ItemContent className="min-w-0">
                                                <ItemTitle>
                                                    Access slot{" "}
                                                    {reservation.slotKey}
                                                </ItemTitle>
                                                <ItemDescription className="capitalize">
                                                    {reservation.role} ·
                                                    Admitted{" "}
                                                    {new Date(
                                                        reservation.admittedAt,
                                                    ).toLocaleString("en")}
                                                </ItemDescription>
                                            </ItemContent>
                                            <ItemActions>
                                                {reservation.reservedForTesting ? (
                                                    <AdminMarkBadge mark="reservedForValidation" />
                                                ) : (
                                                    <Badge>
                                                        {reservation.remaining}{" "}
                                                        analyses remaining
                                                    </Badge>
                                                )}
                                            </ItemActions>
                                        </Item>
                                    )}
                                </AdminList>
                            </AdminScrollList>
                            <p className="text-xs text-muted-foreground">
                                {filterSummary(
                                    filtered.length,
                                    reservations.length,
                                    "reservations",
                                )}
                            </p>
                        </>
                    )}
                </CardContent>
            </Card>
            <RestorableReservations />
        </div>
    );
}

function RestorableReservations() {
    const restorable = usePaginatedQuery(
        api.adminOperations.listRestorableRunsPage,
        {},
        { initialNumItems: CLIENT_PAGE_SIZE.adminReservations },
    );
    const restoreQuota = useMutation(api.admin.restoreQuota);
    const [restoreRunId, setRestoreRunId] = useState<Id<"researchRuns"> | null>(
        null,
    );

    return (
        <Card>
            <CardHeader>
                <CardTitle>
                    <h3>Restorable reservations</h3>
                </CardTitle>
                <CardDescription>
                    Dossiers that never started can return their reserved
                    analysis. Each restoration is recorded in the audit trail.
                </CardDescription>
            </CardHeader>
            <CardContent>
                {restorable.status === "LoadingFirstPage" ? (
                    <p role="status" className="text-sm text-muted-foreground">
                        Loading restorable reservations…
                    </p>
                ) : restorable.results.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                        No unused reservation is eligible for restoration.
                    </p>
                ) : (
                    <AdminScrollList label="Restorable reservations">
                        <AdminList
                            items={restorable.results}
                            getKey={(run) => run.runId}>
                            {(run) => (
                                <Item size="sm">
                                    <ItemContent className="min-w-0">
                                        <ItemTitle className="break-all font-mono text-xs font-normal">
                                            {run.runId}
                                        </ItemTitle>
                                        <ItemDescription>
                                            Created{" "}
                                            {new Date(
                                                run.createdAt,
                                            ).toLocaleString("en")}
                                        </ItemDescription>
                                    </ItemContent>
                                    <ItemActions>
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={() =>
                                                setRestoreRunId(run.runId)
                                            }>
                                            <Icon
                                                iconNode={ArrowTurnBackwardIcon}
                                            />
                                            Restore quota
                                        </Button>
                                    </ItemActions>
                                </Item>
                            )}
                        </AdminList>
                    </AdminScrollList>
                )}
                <AdminListFooter
                    page={restorable}
                    label="Load more unused reservations"
                />

                <AdminReasonDialog
                    open={restoreRunId !== null}
                    title="Restore unused reservation"
                    description="This audited action is limited to a dossier that never started."
                    reasonLabel="Reason for restoration"
                    confirmLabel="Confirm restoration"
                    pendingLabel="Restoring…"
                    onClose={() => setRestoreRunId(null)}
                    onConfirm={async (reason) => {
                        if (!restoreRunId) return false;
                        try {
                            await restoreQuota({ runId: restoreRunId, reason });
                            toast.success(
                                "Reservation restored. The analyst can start another dossier.",
                            );
                            return true;
                        } catch {
                            toast.error(
                                "We couldn’t restore that reservation. Try again.",
                            );
                            return false;
                        }
                    }}
                />
            </CardContent>
        </Card>
    );
}
