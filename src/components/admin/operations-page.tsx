"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Shield01Icon } from "@hugeicons/core-free-icons";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { type Dispatch, type SetStateAction, useEffect, useState } from "react";
import Icon from "@/components/icon";
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
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
    executionLabel,
    lifecycleLabel,
    providerDispatchLabel,
    providerErrorLabel,
    providerOperationLabel,
    providerServiceLabel,
    providerStatusLabel,
} from "@/lib/presentation/research-copy";

/** Minimal, read-mostly operational view for the single invited admin. */
export function OperationsPage() {
    const [visitor, setVisitor] = useState<
        FunctionReturnType<typeof api.visitors.current> | undefined
    >(undefined);
    const [operations, setOperations] = useState<
        FunctionReturnType<typeof api.adminOperations.get> | undefined
    >(undefined);
    const setPaidWorkEnabled = useMutation(
        api.adminOperations.setPaidWorkEnabled,
    );
    const restoreQuota = useMutation(api.admin.restoreQuota);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [reason, setReason] = useState("");
    const [pending, setPending] = useState(false);
    const [restoreRunId, setRestoreRunId] = useState<Id<"researchRuns"> | null>(
        null,
    );
    const [restoreReason, setRestoreReason] = useState("");
    const [restorePending, setRestorePending] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const queryBridge = (
        <LoadErrorBoundary
            title="Operations unavailable"
            description="We couldn’t load the operations view. Try again.">
            <OperationsQueryBridge
                setVisitor={setVisitor}
                setOperations={setOperations}
            />
        </LoadErrorBoundary>
    );

    if (visitor === undefined) {
        return (
            <>
                {queryBridge}
                <div
                    role="status"
                    aria-label="Loading operations"
                    aria-busy="true">
                    <Skeleton className="h-64" />
                </div>
            </>
        );
    }
    if (visitor?.role !== "admin") {
        return (
            <>
                {queryBridge}
                <div className="surface-panel rounded-xl p-8 text-center">
                    <h1 className="text-xl font-medium">
                        Admin access required
                    </h1>
                    <p className="mt-2 text-sm text-muted-foreground">
                        Operations data is restricted to the invited
                        administrator.
                    </p>
                </div>
            </>
        );
    }
    if (operations === undefined) {
        return (
            <>
                {queryBridge}
                <div
                    role="status"
                    aria-label="Loading operations"
                    aria-busy="true">
                    <Skeleton className="h-64" />
                </div>
            </>
        );
    }

    const nextEnabled = !operations.paidWork.enabled;

    return (
        <>
            {queryBridge}
            <div className="mx-auto max-w-6xl py-8">
                <header className="flex flex-col gap-4 border-b border-border/60 pb-6 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                        <p className="text-micro">
                            <Icon
                                iconNode={Shield01Icon}
                                className="mr-1 inline h-4 w-4"
                            />
                            Restricted administration
                        </p>
                        <h1 className="mt-2 text-3xl font-medium">
                            Operations control
                        </h1>
                        <p className="mt-2 text-sm text-muted-foreground">
                            Run health, human checkpoints, provider attempts,
                            quota, and the global paid-work circuit breaker.
                        </p>
                    </div>
                    <div className="flex items-center gap-3">
                        <Badge
                            variant={
                                operations.paidWork.enabled
                                    ? "secondary"
                                    : "destructive"
                            }>
                            Paid work{" "}
                            {operations.paidWork.enabled
                                ? "enabled"
                                : "disabled"}
                        </Badge>
                        <Button
                            variant={
                                operations.paidWork.enabled
                                    ? "destructive"
                                    : "default"
                            }
                            onClick={() => {
                                setReason("");
                                setError(null);
                                setDialogOpen(true);
                            }}>
                            {operations.paidWork.enabled
                                ? "Disable paid work"
                                : "Enable paid work"}
                        </Button>
                    </div>
                </header>

                {error ? (
                    <p role="alert" className="mt-4 text-sm text-destructive">
                        {error}
                    </p>
                ) : null}

                <div className="mt-6 grid gap-4 lg:grid-cols-2">
                    <section className="surface-panel rounded-xl p-5">
                        <h2 className="text-base font-medium">
                            Active run states
                        </h2>
                        <ul className="mt-3 space-y-2">
                            {operations.runs.map((run) => (
                                <li
                                    key={run.runId}
                                    className="flex items-center justify-between gap-3 border-b border-border/50 py-2 text-sm last:border-0">
                                    <span>
                                        <span className="font-medium">
                                            {lifecycleLabel(run.lifecycleState)}
                                        </span>
                                        <span className="mt-0.5 block font-mono text-[10px] text-muted-foreground">
                                            Diagnostic: {run.lifecycleState} ·{" "}
                                            {run.executionStatus}
                                        </span>
                                        {run.preparation?.configurationCheck ? (
                                            <span className="mt-1 block text-xs text-muted-foreground">
                                                Assessment configuration{" "}
                                                {run.preparation
                                                    .configurationCheck
                                                    .available
                                                    ? "available"
                                                    : "unavailable"}
                                            </span>
                                        ) : null}
                                        {run.preparation?.stopCode ? (
                                            <span className="mt-0.5 block font-mono text-[10px] text-muted-foreground">
                                                Preparation:{" "}
                                                {run.preparation.status} ·{" "}
                                                {run.preparation.stopCode}
                                            </span>
                                        ) : null}
                                        {run.preparation?.failures?.map(
                                            (failure) => (
                                                <span
                                                    key={failure.sourceId}
                                                    className="mt-0.5 block break-all font-mono text-[10px] text-muted-foreground">
                                                    Source {failure.sourceId}:{" "}
                                                    {failure.reasonCode}
                                                </span>
                                            ),
                                        )}
                                    </span>
                                    <Badge variant="outline">
                                        {executionLabel(run.executionStatus)}
                                    </Badge>
                                </li>
                            ))}
                        </ul>
                        {operations.restorableRuns.length > 0 ? (
                            <div className="mt-4 border-t border-border/50 pt-4">
                                <p className="text-xs text-muted-foreground">
                                    Unused reservations eligible for audited
                                    restoration
                                </p>
                                <ul className="mt-2 space-y-2">
                                    {operations.restorableRuns.map((run) => (
                                        <li
                                            key={run.runId}
                                            className="flex items-center justify-between gap-2">
                                            <span className="truncate font-mono text-xs">
                                                {run.runId}
                                            </span>
                                            <Button
                                                size="xs"
                                                variant="outline"
                                                onClick={() => {
                                                    setRestoreReason("");
                                                    setError(null);
                                                    setRestoreRunId(run.runId);
                                                }}>
                                                Restore quota
                                            </Button>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ) : null}
                    </section>
                    <section className="surface-panel rounded-xl p-5">
                        <h2 className="text-base font-medium">
                            Remaining reservations
                        </h2>
                        <ul className="mt-3 space-y-2">
                            {operations.reservations.map((reservation) => (
                                <li
                                    key={reservation.visitorId}
                                    className="flex justify-between text-sm">
                                    <span>{reservation.role}</span>
                                    <span className="font-mono">
                                        {reservation.remaining} remaining
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </section>
                    <section className="surface-panel rounded-xl p-5 lg:col-span-2">
                        <h2 className="text-base font-medium">
                            Recent provider attempts
                        </h2>
                        {operations.providerCalls.length === 0 ? (
                            <p className="mt-3 text-sm text-muted-foreground">
                                No provider attempts recorded.
                            </p>
                        ) : (
                            <ul className="mt-3 space-y-3 text-xs">
                                {operations.providerCalls.map((call) => (
                                    <li
                                        key={`${call.service}-${call.operation}-${call.createdAt}`}
                                        className="rounded-lg border border-border/50 p-3">
                                        <p className="font-medium">
                                            {providerServiceLabel(call.service)}{" "}
                                            ·{" "}
                                            {providerOperationLabel(
                                                call.operation,
                                            )}{" "}
                                            · {providerStatusLabel(call.status)}
                                        </p>
                                        {call.errorCode ? (
                                            <p className="mt-1 text-muted-foreground">
                                                {providerErrorLabel(
                                                    call.errorCode,
                                                )}
                                            </p>
                                        ) : null}
                                        <p className="mt-1 text-muted-foreground">
                                            Attempt {call.attempt} ·{" "}
                                            {providerDispatchLabel(
                                                call.dispatchOutcome,
                                            )}
                                            {call.httpStatus !== undefined
                                                ? ` · HTTP ${call.httpStatus}`
                                                : ""}
                                            {call.recoveryOfProviderCallId
                                                ? " · Explicit recovery"
                                                : ""}
                                        </p>
                                        <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                                            Diagnostic: {call.service} ·{" "}
                                            {call.operation} · {call.status}
                                            {call.errorCode
                                                ? ` · ${call.errorCode}`
                                                : ""}
                                            {call.reportedCost !== undefined
                                                ? ` · cost ${call.reportedCost}`
                                                : ""}
                                        </p>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </section>
                </div>

                <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>
                                {nextEnabled ? "Enable" : "Disable"} paid work
                            </DialogTitle>
                            <DialogDescription>
                                Existing human checkpoints remain reviewable.
                                This switch blocks new Exa provider attempts
                                server-side.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-2">
                            <Label htmlFor="paid-work-reason">
                                Operational reason
                            </Label>
                            <Textarea
                                id="paid-work-reason"
                                value={reason}
                                onChange={(event) =>
                                    setReason(event.target.value)
                                }
                            />
                        </div>
                        <DialogFooter>
                            <Button
                                variant="outline"
                                onClick={() => setDialogOpen(false)}>
                                Cancel
                            </Button>
                            <Button
                                variant={
                                    nextEnabled ? "default" : "destructive"
                                }
                                disabled={pending || reason.trim().length < 12}
                                onClick={async () => {
                                    setPending(true);
                                    setError(null);
                                    try {
                                        await setPaidWorkEnabled({
                                            enabled: nextEnabled,
                                            reason: reason.trim(),
                                        });
                                        setDialogOpen(false);
                                    } catch (caught) {
                                        setError(
                                            caught instanceof Error
                                                ? caught.message
                                                : "Paid-work control update failed.",
                                        );
                                    } finally {
                                        setPending(false);
                                    }
                                }}>
                                {pending
                                    ? "Saving…"
                                    : `Confirm ${nextEnabled ? "enable" : "disable"}`}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
                <Dialog
                    open={restoreRunId !== null}
                    onOpenChange={(open) => {
                        if (!open) {
                            setRestoreRunId(null);
                        }
                    }}>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>
                                Restore unused reservation
                            </DialogTitle>
                            <DialogDescription>
                                This audited action is limited to a draft run
                                that never started.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-2">
                            <Label htmlFor="quota-restoration-reason">
                                Restoration reason
                            </Label>
                            <Textarea
                                id="quota-restoration-reason"
                                value={restoreReason}
                                onChange={(event) =>
                                    setRestoreReason(event.target.value)
                                }
                            />
                        </div>
                        <DialogFooter>
                            <Button
                                variant="outline"
                                onClick={() => setRestoreRunId(null)}>
                                Cancel
                            </Button>
                            <Button
                                disabled={
                                    restorePending ||
                                    restoreReason.trim().length < 12
                                }
                                onClick={async () => {
                                    if (!restoreRunId) {
                                        return;
                                    }
                                    setRestorePending(true);
                                    setError(null);
                                    try {
                                        await restoreQuota({
                                            runId: restoreRunId,
                                            reason: restoreReason.trim(),
                                        });
                                        setRestoreRunId(null);
                                    } catch (caught) {
                                        setError(
                                            caught instanceof Error
                                                ? caught.message
                                                : "Quota restoration failed.",
                                        );
                                    } finally {
                                        setRestorePending(false);
                                    }
                                }}>
                                {restorePending
                                    ? "Restoring…"
                                    : "Confirm restoration"}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </div>
        </>
    );
}

function OperationsQueryBridge({
    setVisitor,
    setOperations,
}: {
    setVisitor: Dispatch<
        SetStateAction<
            FunctionReturnType<typeof api.visitors.current> | undefined
        >
    >;
    setOperations: Dispatch<
        SetStateAction<
            FunctionReturnType<typeof api.adminOperations.get> | undefined
        >
    >;
}) {
    const visitor = useQuery(api.visitors.current);
    const operations = useQuery(
        api.adminOperations.get,
        visitor?.role === "admin" ? {} : "skip",
    );

    useEffect(() => {
        setVisitor(visitor);
        setOperations(operations);
    }, [operations, setOperations, setVisitor, visitor]);

    return null;
}
