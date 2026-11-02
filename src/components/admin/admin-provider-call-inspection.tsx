"use client";

import { api } from "@convex/_generated/api";
import { useQuery } from "convex/react";
import type { Id } from "@convex/_generated/dataModel";

import { ProviderStatusBadge } from "@/components/admin/admin-status-badge";
import { AdminProviderBilling } from "@/components/admin/admin-provider-billing";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
    providerDispatchLabel,
    providerErrorLabel,
    providerOperationLabel,
    providerServiceLabel,
} from "@/lib/presentation/research-copy";

/** Reactive detail with accounting recovery for one recorded provider attempt. */
export function AdminProviderCallInspection({
    providerCallId,
}: {
    providerCallId: Id<"providerCalls">;
}) {
    const call = useQuery(api.adminOperations.inspectProviderCall, {
        providerCallId,
    });
    if (call === undefined)
        return (
            <section
                className="space-y-4"
                aria-label="Loading provider attempt">
                <Skeleton className="h-8" />
                <Skeleton className="h-56" />
                <Skeleton className="h-24" />
            </section>
        );
    if (call === null)
        return <p>This provider attempt is no longer available.</p>;
    return (
        <div className="space-y-4 text-sm">
            <section className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                    <h3 className="text-section">
                        {providerServiceLabel(call.service)} ·{" "}
                        {providerOperationLabel(call.operation)}
                    </h3>
                    <ProviderStatusBadge status={call.status} />
                </div>
                <AdminProviderBilling call={call} />
                <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5">
                    <dt className="text-muted-foreground">Attempt</dt>
                    <dd>{call.attempt}</dd>
                    <dt className="text-muted-foreground">Dispatch</dt>
                    <dd>{providerDispatchLabel(call.dispatchOutcome)}</dd>
                    <dt className="text-muted-foreground">Recorded</dt>
                    <dd>{new Date(call.createdAt).toLocaleString("en")}</dd>
                    {call.httpStatus !== undefined ? (
                        <>
                            <dt className="text-muted-foreground">HTTP</dt>
                            <dd>{call.httpStatus}</dd>
                        </>
                    ) : null}
                </dl>
            </section>

            <Separator />

            <section className="space-y-2">
                <h4 className="font-medium">Response</h4>
                {call.errorCode ? (
                    <p>
                        {providerErrorLabel(call.errorCode)}{" "}
                        <span className="font-mono text-xs text-muted-foreground">
                            ({call.errorCode})
                        </span>
                    </p>
                ) : (
                    <p className="text-muted-foreground">No error recorded.</p>
                )}
                {call.diagnostic?.reason ? (
                    <p className="text-muted-foreground">
                        {call.diagnostic?.reason}
                    </p>
                ) : null}
            </section>

            <Separator />

            <section className="space-y-2">
                <h4 className="font-medium">Cost and recovery</h4>
                <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5">
                    <dt className="text-muted-foreground">Reported cost</dt>
                    <dd>
                        {call.reportedCost !== undefined
                            ? String(call.reportedCost)
                            : "Not reported"}
                    </dd>
                    <dt className="text-muted-foreground">Retry after</dt>
                    <dd>
                        {call.retryAfterAt !== undefined
                            ? new Date(call.retryAfterAt).toLocaleString("en")
                            : "Not scheduled"}
                    </dd>
                    <dt className="text-muted-foreground">Recovery of</dt>
                    <dd className="break-all font-mono text-xs">
                        {call.recoveryOfProviderCallId ?? "None"}
                    </dd>
                </dl>
            </section>

            <Separator />

            <section className="space-y-2">
                <h4 className="font-medium">Identifiers</h4>
                <dl className="space-y-1.5 font-mono text-xs break-all text-muted-foreground">
                    <div className="flex flex-wrap gap-x-4">
                        <dt>Dossier</dt>
                        <dd>{call.runId ?? "None"}</dd>
                    </div>
                    <div className="flex flex-wrap gap-x-4">
                        <dt>Preparation</dt>
                        <dd>{call.preparationId ?? "None"}</dd>
                    </div>
                    <div className="flex flex-wrap gap-x-4">
                        <dt>Source</dt>
                        <dd>{call.sourceId ?? "None"}</dd>
                    </div>
                </dl>
            </section>
        </div>
    );
}
