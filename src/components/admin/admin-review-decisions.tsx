"use client";

import type { api } from "@convex/_generated/api";
import { FolderOpenIcon } from "@hugeicons/core-free-icons";
import type { FunctionReturnType } from "convex/server";

import { AdminList } from "@/components/admin/admin-list";
import { AdminScrollList } from "@/components/admin/admin-scroll-list";
import { ReviewDecisionBadge } from "@/components/admin/admin-status-badge";
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
    Item,
    ItemActions,
    ItemContent,
    ItemDescription,
    ItemTitle,
} from "@/components/ui/item";
import { checkpointLabel } from "@/lib/presentation/research-copy";

type CheckpointEvent = FunctionReturnType<
    typeof api.adminOperations.get
>["checkpoints"][number];

/** Recent human review decisions, newest first. */
export function AdminReviewDecisions({
    checkpoints,
    onOpenDossier,
}: {
    checkpoints: CheckpointEvent[];
    onOpenDossier: (runId: CheckpointEvent["runId"]) => void;
}) {
    if (checkpoints.length === 0) {
        return (
            <Empty className="min-h-40 rounded-xl border border-dashed border-border">
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
        <Card>
            <CardHeader>
                <CardTitle>
                    <h3>Recent review decisions</h3>
                </CardTitle>
                <CardDescription>
                    Newest first. Each entry records one analyst answer at one
                    checkpoint.
                </CardDescription>
            </CardHeader>
            <CardContent>
                <AdminScrollList label="Recent review decisions">
                    <AdminList
                        items={checkpoints}
                        getKey={(event) =>
                            `${event.runId}-${event.checkpoint}-${event.occurredAt}`
                        }>
                        {(event) => {
                            return (
                                <Item size="sm">
                                    <ItemContent className="min-w-0">
                                        <ItemTitle>
                                            {checkpointLabel(event.checkpoint)}
                                        </ItemTitle>
                                        <ItemDescription>
                                            {new Date(
                                                event.occurredAt,
                                            ).toLocaleString("en")}
                                        </ItemDescription>
                                        <p className="break-all font-mono text-xs text-muted-foreground">
                                            {event.runId}
                                        </p>
                                    </ItemContent>
                                    <ItemActions>
                                        <ReviewDecisionBadge
                                            decision={event.decision}
                                        />
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={() =>
                                                onOpenDossier(event.runId)
                                            }>
                                            <Icon iconNode={FolderOpenIcon} />
                                            Open dossier
                                        </Button>
                                    </ItemActions>
                                </Item>
                            );
                        }}
                    </AdminList>
                </AdminScrollList>
            </CardContent>
        </Card>
    );
}
