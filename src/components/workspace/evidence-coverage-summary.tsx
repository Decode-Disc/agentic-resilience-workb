import type { api } from "@convex/_generated/api";
import type { FunctionReturnType } from "convex/server";

import { Badge } from "@/components/ui/badge";
import {
    Empty,
    EmptyDescription,
    EmptyHeader,
    EmptyTitle,
} from "@/components/ui/empty";
import { evidenceStatusCopy } from "@/lib/presentation/research-copy";

type EvidenceSummary = FunctionReturnType<typeof api.evidenceMatrix.getSummary>;

/** Read-only coverage summary for the evidence matrix. */
export function EvidenceCoverageSummary({
    summary,
}: {
    summary: EvidenceSummary;
}) {
    const status =
        summary.lifecycleState === "evidence_ready"
            ? evidenceStatusCopy.ready
            : summary.executionMode === "unavailable"
              ? evidenceStatusCopy.unavailable
              : evidenceStatusCopy.preparing;
    const hasRetrievalLimits =
        summary.frozenSources.partial > 0 || summary.frozenSources.failed > 0;

    return (
        <section aria-label="Evidence coverage summary" className="space-y-3">
            <div className="surface-floating rounded-2xl border border-border/60 p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                        <p className="text-micro text-brand-purple">
                            {status.eyebrow}
                        </p>
                        <h2 className="mt-1 text-lg font-medium">
                            {status.title}
                        </h2>
                        <p className="mt-1 text-sm text-muted-foreground">
                            {status.description}
                        </p>
                    </div>
                    {summary.isShowcase ? (
                        <Badge variant="secondary">Showcase evidence</Badge>
                    ) : null}
                </div>
            </div>

            {summary.executionMode === "unavailable" ? (
                <div
                    role="status"
                    className="rounded-xl border border-review/30 bg-review/10 p-4">
                    <p className="text-sm font-medium text-foreground">
                        Claim generation is not available for this dossier yet
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        Your approved sources are preserved and will be reused
                        when this becomes available. No claims were produced,
                        and dimension assessment stays locked until evidence can
                        be reviewed. Return to Progress to try again.
                    </p>
                </div>
            ) : null}

            {hasRetrievalLimits ? (
                <div
                    role="status"
                    className="rounded-xl border border-review/30 bg-review/10 p-4">
                    <p className="text-sm font-medium text-foreground">
                        Some sources could not be fully retrieved
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        {summary.frozenSources.partial > 0
                            ? `${summary.frozenSources.partial} source${summary.frozenSources.partial === 1 ? "" : "s"} returned partial evidence.`
                            : ""}{" "}
                        {summary.frozenSources.failed > 0
                            ? `${summary.frozenSources.failed} source${summary.frozenSources.failed === 1 ? "" : "s"} could not be retrieved.`
                            : ""}{" "}
                        Available evidence remains visible below.
                    </p>
                </div>
            ) : null}

            <dl className="grid gap-3 sm:grid-cols-3">
                <div className="surface-panel rounded-xl p-4">
                    <dt className="text-xs text-muted-foreground">
                        Claims available
                    </dt>
                    <dd className="mt-1 text-xl font-medium">
                        {summary.claimCount}
                    </dd>
                </div>
                <div className="surface-panel rounded-xl p-4">
                    <dt className="text-xs text-muted-foreground">
                        Questions covered
                    </dt>
                    <dd className="mt-1 text-xl font-medium">
                        {summary.questionCoverage.covered} /{" "}
                        {summary.questionCoverage.total}
                    </dd>
                </div>
                <div className="surface-panel rounded-xl p-4">
                    <dt className="text-xs text-muted-foreground">
                        Sources reviewed
                    </dt>
                    <dd className="mt-1 text-xl font-medium">
                        {summary.frozenSources.accepted}
                        <span className="text-xs text-muted-foreground">
                            {" "}
                            accepted
                        </span>
                    </dd>
                </div>
            </dl>

            {summary.claimCount === 0 &&
            summary.lifecycleState === "evidence_ready" ? (
                <Empty className="surface-panel min-h-36 rounded-xl p-6">
                    <EmptyHeader>
                        <EmptyTitle>No evidence claims</EmptyTitle>
                        <EmptyDescription>
                            Extraction completed without a usable claim in this
                            dossier.
                        </EmptyDescription>
                    </EmptyHeader>
                </Empty>
            ) : null}
        </section>
    );
}
