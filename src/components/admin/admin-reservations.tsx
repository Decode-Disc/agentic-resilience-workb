"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
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
import { AdminLoadMore } from "@/components/admin/admin-pager";
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
import { Textarea } from "@/components/ui/textarea";

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
        <div className="space-y-6">
            <section className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-section">Remaining reservations</h2>
                    <AdminReservationFilters
                        filters={filters}
                        onChange={setFilters}
                        className="flex items-center gap-2"
                    />
                </div>
                {reservations.length === 0 ? (
                    <Empty className="min-h-40">
                        <EmptyHeader>
                            <EmptyTitle>No reserved analyses</EmptyTitle>
                            <EmptyDescription>
                                Analysts appear here once they claim an access
                                slot.
                            </EmptyDescription>
                        </EmptyHeader>
                    </Empty>
                ) : filtered.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                        No loaded reservation matches the selected filters.
                    </p>
                ) : (
                    <>
                        <AdminList
                            items={filtered}
                            getKey={(reservation) => reservation.visitorId}>
                            {(reservation) => (
                                <Item size="sm">
                                    <ItemContent className="min-w-0">
                                        <ItemTitle>
                                            Access slot {reservation.slotKey}
                                        </ItemTitle>
                                        <ItemDescription className="capitalize">
                                            {reservation.role} · Admitted{" "}
                                            {new Date(
                                                reservation.admittedAt,
                                            ).toLocaleString("en")}
                                        </ItemDescription>
                                    </ItemContent>
                                    <ItemActions>
                                        {reservation.reservedForTesting ? (
                                            <Badge
                                                variant="regular"
                                                color="amber"
                                                showDot>
                                                Reserved for validation
                                            </Badge>
                                        ) : (
                                            <Badge variant="secondary">
                                                {reservation.remaining} analyses
                                                remaining
                                            </Badge>
                                        )}
                                    </ItemActions>
                                </Item>
                            )}
                        </AdminList>
                        <p className="text-xs text-muted-foreground">
                            {filterSummary(
                                filtered.length,
                                reservations.length,
                                "reservations",
                            )}
                        </p>
                    </>
                )}
            </section>

            <RestorableReservations />
        </div>
    );
}

function RestorableReservations() {
    const restorable = usePaginatedQuery(
        api.adminOperations.listRestorableRunsPage,
        {},
        { initialNumItems: 20 },
    );
    const restoreQuota = useMutation(api.admin.restoreQuota);
    const [restoreRunId, setRestoreRunId] = useState<Id<"researchRuns"> | null>(
        null,
    );
    const [reason, setReason] = useState("");
    const [pending, setPending] = useState(false);

    return (
        <section className="space-y-2">
            <h2 className="text-section">Restorable reservations</h2>
            <p className="text-sm text-muted-foreground">
                Dossiers that never started can return their reserved analysis.
                Each restoration is recorded in the audit trail.
            </p>
            {restorable.status === "LoadingFirstPage" ? (
                <p role="status" className="text-sm text-muted-foreground">
                    Loading restorable reservations…
                </p>
            ) : restorable.results.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                    No unused reservation is eligible for restoration.
                </p>
            ) : (
                <>
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
                                        {new Date(run.createdAt).toLocaleString(
                                            "en",
                                        )}
                                    </ItemDescription>
                                </ItemContent>
                                <ItemActions>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => {
                                            setReason("");
                                            setRestoreRunId(run.runId);
                                        }}>
                                        Restore quota
                                    </Button>
                                </ItemActions>
                            </Item>
                        )}
                    </AdminList>
                    <AdminLoadMore
                        page={restorable}
                        label="Load more unused reservations"
                    />
                </>
            )}

            <Dialog
                open={restoreRunId !== null}
                onOpenChange={(open) => {
                    if (!open) setRestoreRunId(null);
                }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Restore unused reservation</DialogTitle>
                        <DialogDescription>
                            This audited action is limited to a dossier that
                            never started.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-2">
                        <Label htmlFor="quota-restoration-reason">
                            Reason for restoration
                        </Label>
                        <Textarea
                            id="quota-restoration-reason"
                            value={reason}
                            onChange={(event) => setReason(event.target.value)}
                        />
                        <p className="text-xs text-muted-foreground">
                            Recorded in the audit trail. At least 12 characters.
                        </p>
                    </div>
                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => setRestoreRunId(null)}>
                            Cancel
                        </Button>
                        <Button
                            disabled={pending || reason.trim().length < 12}
                            onClick={async () => {
                                if (!restoreRunId) return;
                                setPending(true);
                                try {
                                    await restoreQuota({
                                        runId: restoreRunId,
                                        reason: reason.trim(),
                                    });
                                    setRestoreRunId(null);
                                    toast.success(
                                        "Reservation restored. The analyst can start another dossier.",
                                    );
                                } catch {
                                    toast.error(
                                        "We couldn’t restore that reservation. Try again.",
                                    );
                                } finally {
                                    setPending(false);
                                }
                            }}>
                            {pending ? "Restoring…" : "Confirm restoration"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </section>
    );
}
