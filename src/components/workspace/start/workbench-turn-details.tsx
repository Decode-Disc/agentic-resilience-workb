import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useQuery } from "convex/react";
import { ConversationActivity } from "@/components/chat/conversation-activity";
import { ConversationActivityList } from "@/components/chat/conversation-activity-list";
import { LoadErrorBoundary } from "@/components/load-error-boundary";
import { Empty, EmptyDescription } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { workbenchTurn } from "@/lib/presentation/workbench";

/** Subscribes to retained operations only while the analyst inspects this turn. */
export function WorkbenchTurnDetails(props: {
    runId: Id<"researchRuns">;
    turnId: Id<"agentConversationTurns">;
    open: boolean;
}) {
    return (
        <LoadErrorBoundary
            title="Recorded work unavailable"
            description="Try again to inspect this turn. Your conversation remains available."
            variant="inline">
            <TurnDetailsQuery {...props} />
        </LoadErrorBoundary>
    );
}
function TurnDetailsQuery({
    runId,
    turnId,
    open,
}: {
    runId: Id<"researchRuns">;
    turnId: Id<"agentConversationTurns">;
    open: boolean;
}) {
    const work = useQuery(
        api.workbench.turnWork,
        open ? { runId, turnId } : "skip",
    );
    if (!open) return null;
    if (work === undefined)
        return (
            <Skeleton
                className="h-16 w-full"
                aria-label="Loading recorded work"
            />
        );
    return (
        <>
            {work.operations.length === 0 ? (
                <Empty className="p-2">
                    <EmptyDescription>
                        No operations were recorded for this turn.
                    </EmptyDescription>
                </Empty>
            ) : (
                <ConversationActivityList>
                    {workbenchTurn(work).entries.map((entry) =>
                        entry.kind === "operation" ? (
                            <ConversationActivity
                                key={entry.operation.id}
                                {...entry.operation}
                                compact
                            />
                        ) : null,
                    )}
                </ConversationActivityList>
            )}
            {work.operationsLimited && (
                <p>Only the most recent operations are shown.</p>
            )}
        </>
    );
}
