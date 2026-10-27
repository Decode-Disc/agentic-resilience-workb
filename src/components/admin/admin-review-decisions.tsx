"use client";

import type { api } from "@convex/_generated/api";
import type { FunctionReturnType } from "convex/server";

import { AdminList } from "@/components/admin/admin-list";
import { Badge } from "@/components/ui/badge";
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
    checkpointDecisionLabel,
    checkpointLabel,
} from "@/lib/presentation/research-copy";

type CheckpointEvent = FunctionReturnType<
    typeof api.adminOperations.get
>["checkpoints"][number];

// Positive decisions keep the approval tone; every other decision records a
// request for more work, so it must not read as an approval.

/** Recent human review decisions, newest first. */
export function AdminReviewDecisions({
    checkpoints,
    onInspectRun,
}: {
    checkpoints: CheckpointEvent[];
    onInspectRun: (runId: CheckpointEvent["runId"]) => void;
}) {
    if (checkpoints.length === 0) {
        return (
            <Empty className="min-h-48">
                <EmptyHeader>
                    <EmptyTitle>No review decisions recorded</EmptyTitle>
                    <EmptyDescription>
                        Decisions appear here once an analyst answers a review
                        checkpoint.
                    </EmptyDescription>
                </EmptyHeader>
            </Empty>
        );
    }

    return (
        <section className="space-y-2">
            <h2 className="text-section">Recent review decisions</h2>
            <p className="text-sm text-muted-foreground">
                Newest decisions first. Each entry records one analyst answer at
                one checkpoint.
            </p>
            <AdminList
                items={checkpoints}
                getKey={(event) =>
                    `${event.runId}-${event.checkpoint}-${event.occurredAt}`
                }>
                {(event) => {
                    const approved = event.decision === "approved";
                    return (
                        <Item size="sm">
                            <ItemContent className="min-w-0">
                                <ItemTitle>
                                    {checkpointLabel(event.checkpoint)}
                                </ItemTitle>
                                <ItemDescription>
                                    {new Date(event.occurredAt).toLocaleString(
                                        "en",
                                    )}
                                </ItemDescription>
                                <p className="break-all font-mono text-xs text-muted-foreground">
                                    {event.runId}
                                </p>
                            </ItemContent>
                            <ItemActions>
                                <Badge
                                    variant={approved ? "regular" : "secondary"}
                                    color={approved ? "emerald" : "primary"}>
                                    {checkpointDecisionLabel(event.decision)}
                                </Badge>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => onInspectRun(event.runId)}>
                                    Inspect dossier
                                </Button>
                            </ItemActions>
                        </Item>
                    );
                }}
            </AdminList>
        </section>
    );
}
