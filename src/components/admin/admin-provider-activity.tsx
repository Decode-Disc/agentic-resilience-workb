"use client";

import type { api } from "@convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";

import { AdminDetailDisclosure } from "@/components/admin/admin-detail-disclosure";
import { AdminProviderBilling } from "@/components/admin/admin-provider-billing";
import { AdminList } from "@/components/admin/admin-list";
import {
    AdminAttemptFilters,
    attemptFilterDefaults,
    filterSummary,
    attemptMatchesFilters,
} from "@/components/admin/admin-filters";
import { ProviderStatusBadge } from "@/components/admin/admin-status-badge";
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
import {
    providerDispatchLabel,
    providerErrorLabel,
    providerOperationLabel,
    providerServiceLabel,
} from "@/lib/presentation/research-copy";

type ProviderCall = FunctionReturnType<
    typeof api.adminOperations.get
>["providerCalls"][number];

/** Recent provider attempts with their audited outcome and diagnostics. */
export function AdminProviderActivity({
    providerCalls,
    onInspectCall,
}: {
    providerCalls: ProviderCall[];
    onInspectCall: (call: ProviderCall) => void;
}) {
    const [filters, setFilters] = useState(attemptFilterDefaults);

    if (providerCalls.length === 0) {
        return (
            <Empty className="min-h-48">
                <EmptyHeader>
                    <EmptyTitle>No provider attempts recorded</EmptyTitle>
                    <EmptyDescription>
                        Attempts appear here once a dossier requests external
                        content.
                    </EmptyDescription>
                </EmptyHeader>
            </Empty>
        );
    }

    const now = Date.now();
    const filtered = providerCalls.filter((call) =>
        attemptMatchesFilters(call, filters, now),
    );

    return (
        <section className="space-y-2">
            <h2 className="text-section">Recent provider attempts</h2>
            <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-muted-foreground">
                    Newest attempts first. Technical detail stays secondary to
                    the recorded outcome.
                </p>
                <AdminAttemptFilters
                    filters={filters}
                    onChange={setFilters}
                    className="flex items-center gap-2"
                />
            </div>
            {filtered.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                    No loaded attempt matches the selected filters.
                </p>
            ) : (
                <>
                    <AdminList
                        items={filtered}
                        getKey={(call) =>
                            `${call.service}-${call.operation}-${call.createdAt}`
                        }>
                        {(call) => (
                            <Item size="sm">
                                <ItemContent className="min-w-0">
                                    <ItemTitle>
                                        {providerServiceLabel(call.service)} ·{" "}
                                        {providerOperationLabel(call.operation)}
                                    </ItemTitle>
                                    {call.errorCode ? (
                                        <ItemDescription>
                                            {providerErrorLabel(call.errorCode)}
                                        </ItemDescription>
                                    ) : null}
                                    <ItemDescription>
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
                                        {" · "}
                                        {new Date(
                                            call.createdAt,
                                        ).toLocaleString("en")}
                                    </ItemDescription>
                                    <AdminProviderBilling call={call} />
                                    <AdminDetailDisclosure label="Technical detail">
                                        <p className="break-all font-mono text-[10px] text-muted-foreground">
                                            Diagnostic: {call.service} ·{" "}
                                            {call.operation} · {call.status}
                                            {call.errorCode
                                                ? ` · ${call.errorCode}`
                                                : ""}
                                            {call.reportedCost !== undefined
                                                ? ` · cost ${call.reportedCost}`
                                                : ""}
                                        </p>
                                    </AdminDetailDisclosure>
                                </ItemContent>
                                <ItemActions>
                                    <ProviderStatusBadge status={call.status} />
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => onInspectCall(call)}>
                                        Inspect attempt
                                    </Button>
                                </ItemActions>
                            </Item>
                        )}
                    </AdminList>
                    <p className="text-xs text-muted-foreground">
                        {filterSummary(
                            filtered.length,
                            providerCalls.length,
                            "attempts",
                        )}
                    </p>
                </>
            )}
        </section>
    );
}
