import type { api } from "@convex/_generated/api";
import type { FunctionReturnType } from "convex/server";

import { Badge } from "@/components/ui/badge";
import {
    Empty,
    EmptyDescription,
    EmptyHeader,
    EmptyTitle,
} from "@/components/ui/empty";
import {
    eventLabel,
    executionLabel,
    lifecycleLabel,
} from "@/lib/presentation/research-copy";

type RunProjection = FunctionReturnType<typeof api.researchRuns.getMine>;
type RunEvents = FunctionReturnType<typeof api.researchRuns.listMyEvents>;

/** Renders only persisted workflow state and event history. */
export function RunProgress({
    run,
    events,
}: {
    run: RunProjection;
    events: RunEvents;
}) {
    const canAddManualSource = [
        "awaiting_evidence_sufficiency_review",
        "awaiting_source_review",
    ].includes(run.lifecycleState);

    return (
        <section className="space-y-5" aria-label="Research progress">
            <div className="surface-panel rounded-xl p-5">
                <p className="text-micro text-brand-purple">Current state</p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">
                        {lifecycleLabel(run.lifecycleState)}
                    </Badge>
                    <Badge variant="outline">
                        {executionLabel(run.executionStatus)}
                    </Badge>
                </div>
                {run.lifecycleState === "corpus_approved" ? (
                    <p className="mt-4 text-sm text-muted-foreground">
                        Source set approved. Evidence review will begin from
                        these sources.
                    </p>
                ) : null}
            </div>
            {run.providerFailures.length > 0 ? (
                <div
                    className="rounded-xl border border-destructive/30 bg-destructive/5 p-4"
                    role="alert">
                    <h3 className="text-sm font-medium">
                        Some sources could not be retrieved
                    </h3>
                    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                        {canAddManualSource
                            ? "Independent web discovery is unavailable. Filing sources remain available, and you can add a public source manually."
                            : run.lifecycleState === "corpus_approved"
                                ? "Independent web discovery was unavailable. Filing sources remain available in this approved source set."
                                : "Independent web discovery is unavailable. Filing sources remain available for the source review checkpoint."}
                    </p>
                </div>
            ) : null}
            {events.length === 0 ? (
                <Empty className="surface-panel min-h-40 rounded-xl p-6">
                    <EmptyHeader>
                        <EmptyTitle>No progress events yet</EmptyTitle>
                        <EmptyDescription>
                            Updates will appear here after the research run
                            starts.
                        </EmptyDescription>
                    </EmptyHeader>
                </Empty>
            ) : (
                <ol className="space-y-2">
                    {events.map((event) => (
                        <li
                            key={event._id}
                            className="border-l border-border/70 py-1 pl-4 text-sm">
                            <span className="font-medium">
                                {lifecycleLabel(event.lifecycleState)}
                            </span>
                            <span className="ml-2 text-xs text-muted-foreground">
                                {eventLabel(event.type)}
                            </span>
                        </li>
                    ))}
                </ol>
            )}
        </section>
    );
}
