import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { ApprovalChoice } from "@convex/execution/approvalContracts";
import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { useState } from "react";
import { ApprovalCard } from "@/components/chat/approval-card";
import { Skeleton } from "@/components/ui/skeleton";
import {
    APPROVAL_STALE_COPY,
    approvalBlockCopy,
    approvalCardPresentation,
} from "@/lib/presentation/approvals";

function refusalCode(error: unknown) {
    return error instanceof ConvexError &&
        typeof error.data === "object" &&
        error.data &&
        "code" in error.data
        ? String(error.data.code)
        : undefined;
}

/** The DOM id of a request's card, so another surface can bring the decision into view. */
export function approvalCardElementId(requestId: Id<"approvalRequests">) {
    return `approval-${requestId}`;
}

/** Connects one approval request record to the neutral ApprovalCard and Convex approval actions. */
export function ConnectedApprovalCard({
    requestId,
    className,
}: {
    requestId: Id<"approvalRequests">;
    className?: string;
}) {
    const view = useQuery(api.execution.approvals.get, { requestId });
    const decide = useMutation(api.execution.approvals.decide);
    const revokeGrant = useMutation(api.execution.approvals.revokeGrant);
    const [pending, setPending] = useState(false);
    const [feedback, setFeedback] = useState<string | null>(null);

    if (view === undefined) {
        return (
            <div
                id={approvalCardElementId(requestId)}
                role="status"
                aria-label="Loading approval request"
                className="rounded-xl border border-divider bg-card p-3.5">
                <div className="flex items-start gap-2.5">
                    <Skeleton className="size-4 shrink-0" />
                    <div className="flex min-w-0 flex-1 flex-col gap-2">
                        <Skeleton className="h-4 w-3/4" />
                        <Skeleton className="h-3 w-full" />
                        <Skeleton className="h-3 w-2/3" />
                    </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                    <Skeleton className="h-8 w-28" />
                    <Skeleton className="h-8 w-24" />
                    <Skeleton className="h-8 w-28" />
                </div>
            </div>
        );
    }
    if (view === null) {
        return null;
    }

    const presentation = approvalCardPresentation(view);
    const appliedAction =
        view.decision?.outcome.kind === "applied"
            ? view.decision.outcome.action
            : view.action;
    const canRevoke =
        view.status === "approved" &&
        view.decision?.choice === "always" &&
        view.grantActive;

    const handleChoose = async (choice: ApprovalChoice) => {
        setPending(true);
        setFeedback(null);
        try {
            await decide({ requestId, choice });
        } catch (caught) {
            const code = refusalCode(caught);
            if (
                code === "approval_already_decided" ||
                code === "stale_execution" ||
                code === "human_prerequisite_required"
            ) {
                setFeedback(APPROVAL_STALE_COPY);
            } else if (code) {
                setFeedback(approvalBlockCopy(code));
            } else {
                setFeedback(
                    "That decision could not be applied. Your saved dossier is unchanged. Try again.",
                );
            }
        } finally {
            setPending(false);
        }
    };

    const handleRevoke = async () => {
        setPending(true);
        setFeedback(null);
        try {
            await revokeGrant({
                runId: view.runId,
                action: appliedAction,
            });
        } catch (caught) {
            const code = refusalCode(caught);
            setFeedback(
                code
                    ? approvalBlockCopy(code)
                    : "That permission could not be updated. Your saved dossier is unchanged. Try again.",
            );
        } finally {
            setPending(false);
        }
    };

    return (
        <div id={approvalCardElementId(requestId)} className={className}>
            <ApprovalCard
                title={presentation.title}
                description={presentation.description}
                details={presentation.details}
                state={pending ? "running" : presentation.state}
                statusLabel={
                    pending ? "Applying choice..." : presentation.statusLabel
                }
                choices={presentation.choices}
                onChoose={(choice) => void handleChoose(choice)}
                receiptAction={
                    canRevoke
                        ? {
                              label: "Stop allowing",
                              onSelect: () => void handleRevoke(),
                          }
                        : undefined
                }
            />
            {feedback && (
                <p role="status" className="mt-2 text-xs text-muted-foreground">
                    {feedback}
                </p>
            )}
        </div>
    );
}
