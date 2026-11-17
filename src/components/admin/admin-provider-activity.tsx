"use client";

import type { api } from "@convex/_generated/api";
import { ViewIcon } from "@hugeicons/core-free-icons";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";
import {
    AdminAttemptFilters,
    attemptFilterDefaults,
    attemptMatchesFilters,
    filterSummary,
} from "@/components/admin/admin-filters";
import { AdminScrollList } from "@/components/admin/admin-scroll-list";
import { ProviderStatusBadge } from "@/components/admin/admin-status-badge";
import Icon from "@/components/icon";
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
    adminRecentSpend,
    formatAdminCost,
    providerCostState,
} from "@/lib/presentation/admin";
import {
    providerDispatchLabel,
    providerErrorLabel,
    providerOperationLabel,
    providerServiceLabel,
} from "@/lib/presentation/research-copy";

type ProviderCall = FunctionReturnType<
    typeof api.adminOperations.get
>["providerCalls"][number];

const COST_CELL: Record<
    Exclude<ReturnType<typeof providerCostState>["kind"], "confirmed">,
    string
> = {
    conflict: "Conflicting reports",
    unavailable: "Unavailable",
    checking: "Pending",
    none: "—",
};

/** Recent provider attempts: spend figures, then one table of attempts; each attempt opens its full record. */
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
            <Empty className="min-h-48 rounded-xl border border-dashed border-border">
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
    const spend = adminRecentSpend(providerCalls, now);
    const filtered = providerCalls.filter((call) =>
        attemptMatchesFilters(call, filters, now),
    );
    const figures = [
        [
            `Confirmed cost · last ${spend.attempts}`,
            formatAdminCost(spend.confirmedCost),
        ],
        ["Cost not confirmed", String(spend.unconfirmed)],
        ["Failed attempts", String(spend.failed)],
        ["Attempts in the last 24 hours", String(spend.lastDay)],
    ] as const;

    return (
        <div className="space-y-4">
            <dl
                aria-label="Recent spend"
                className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                {figures.map(([label, value]) => (
                    <Card key={label} size="sm">
                        <CardContent className="space-y-1">
                            <dt className="text-xs text-muted-foreground">
                                {label}
                            </dt>
                            <dd className="text-xl font-medium tabular-nums">
                                {value}
                            </dd>
                        </CardContent>
                    </Card>
                ))}
            </dl>
            <Card>
                <CardHeader>
                    <CardTitle>
                        <h3>Recent provider attempts</h3>
                    </CardTitle>
                    <CardDescription>
                        Newest first. Open an attempt for its full record and
                        cost checks.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                    <AdminAttemptFilters
                        filters={filters}
                        onChange={setFilters}
                        className="flex flex-wrap items-center gap-2"
                    />
                    {filtered.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                            No loaded attempt matches the selected filters.
                        </p>
                    ) : (
                        <AdminScrollList label="Recent provider attempts">
                            <table className="w-full border-collapse text-sm">
                                <thead className="sticky top-0 z-10 bg-card text-left text-xs text-muted-foreground">
                                    <tr className="border-b border-divider">
                                        <th className="py-2 pr-4 font-medium">
                                            Service
                                        </th>
                                        <th className="py-2 pr-4 font-medium">
                                            Outcome
                                        </th>
                                        <th className="hidden py-2 pr-4 font-medium sm:table-cell">
                                            Cost
                                        </th>
                                        <th className="hidden py-2 pr-4 font-medium md:table-cell">
                                            When
                                        </th>
                                        <th className="py-2 font-medium">
                                            <span className="sr-only">
                                                Actions
                                            </span>
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filtered.map((call) => {
                                        const cost = providerCostState(call);
                                        return (
                                            <tr
                                                key={call._id}
                                                className="border-b border-divider align-top last:border-0">
                                                <td className="py-3 pr-4">
                                                    <p className="font-medium">
                                                        {providerServiceLabel(
                                                            call.service,
                                                        )}{" "}
                                                        ·{" "}
                                                        {providerOperationLabel(
                                                            call.operation,
                                                        )}
                                                    </p>
                                                    <p className="text-xs text-muted-foreground">
                                                        {call.errorCode
                                                            ? `${providerErrorLabel(call.errorCode)} · `
                                                            : ""}
                                                        {providerDispatchLabel(
                                                            call.dispatchOutcome,
                                                        )}
                                                        {call.httpStatus !==
                                                        undefined
                                                            ? ` · HTTP ${call.httpStatus}`
                                                            : ""}
                                                        {call.recoveryOfProviderCallId
                                                            ? " · Explicit recovery"
                                                            : ""}
                                                    </p>
                                                </td>
                                                <td className="py-3 pr-4">
                                                    <ProviderStatusBadge
                                                        status={call.status}
                                                    />
                                                </td>
                                                <td className="hidden py-3 pr-4 font-mono text-xs tabular-nums sm:table-cell">
                                                    {cost.kind === "confirmed"
                                                        ? formatAdminCost(
                                                              cost.amount,
                                                          )
                                                        : COST_CELL[cost.kind]}
                                                </td>
                                                <td className="hidden py-3 pr-4 text-xs whitespace-nowrap text-muted-foreground md:table-cell">
                                                    {new Date(
                                                        call.createdAt,
                                                    ).toLocaleString("en")}
                                                </td>
                                                <td className="py-3 text-right">
                                                    <Button
                                                        size="sm"
                                                        variant="outline"
                                                        onClick={() =>
                                                            onInspectCall(call)
                                                        }>
                                                        <Icon
                                                            iconNode={ViewIcon}
                                                        />
                                                        Inspect attempt
                                                    </Button>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </AdminScrollList>
                    )}
                    <p className="text-xs text-muted-foreground">
                        {filterSummary(
                            filtered.length,
                            providerCalls.length,
                            "most recent attempts",
                        )}
                    </p>
                </CardContent>
            </Card>
        </div>
    );
}
