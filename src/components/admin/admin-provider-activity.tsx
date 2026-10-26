"use client";

import type { api } from "@convex/_generated/api";
import type { FunctionReturnType } from "convex/server";

import { AdminList } from "@/components/admin/admin-list";
import { Badge } from "@/components/ui/badge";
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
    providerStatusLabel,
} from "@/lib/presentation/research-copy";

type ProviderCall = FunctionReturnType<
    typeof api.adminOperations.get
>["providerCalls"][number];
type ProviderStatus = ProviderCall["status"];

// Tailwind resolves utilities from literal source text, so each status keeps
// its full class list here rather than a composed color name.
const providerStatusTones = {
    started: "bg-info text-info-foreground ring-info/25",
    succeeded: "bg-success text-success-foreground ring-success/25",
    partial: "bg-warning text-warning-foreground ring-warning/25",
    failed: "bg-danger text-danger-foreground ring-danger/25",
} satisfies Record<ProviderStatus, string>;

/** Recent provider attempts with their audited outcome and diagnostics. */
export function AdminProviderActivity({
    providerCalls,
}: {
    providerCalls: ProviderCall[];
}) {
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

    return (
        <section className="space-y-2">
            <h2 className="text-section">Recent provider attempts</h2>
            <p className="text-sm text-muted-foreground">
                Newest attempts first. Technical detail stays secondary to the
                recorded outcome.
            </p>
            <AdminList
                items={providerCalls}
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
                                {providerDispatchLabel(call.dispatchOutcome)}
                                {call.httpStatus !== undefined
                                    ? ` · HTTP ${call.httpStatus}`
                                    : ""}
                                {call.recoveryOfProviderCallId
                                    ? " · Explicit recovery"
                                    : ""}
                                {" · "}
                                {new Date(call.createdAt).toLocaleString("en")}
                            </ItemDescription>
                            <p className="break-all font-mono text-[10px] text-muted-foreground">
                                Diagnostic: {call.service} · {call.operation} ·{" "}
                                {call.status}
                                {call.errorCode ? ` · ${call.errorCode}` : ""}
                                {call.reportedCost !== undefined
                                    ? ` · cost ${call.reportedCost}`
                                    : ""}
                            </p>
                        </ItemContent>
                        <ItemActions>
                            <Badge
                                variant="outline"
                                className={providerStatusTones[call.status]}>
                                {providerStatusLabel(call.status)}
                            </Badge>
                        </ItemActions>
                    </Item>
                )}
            </AdminList>
        </section>
    );
}
