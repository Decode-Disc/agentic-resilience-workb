import type { api } from "@convex/_generated/api";
import type { FunctionReturnType } from "convex/server";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Empty,
    EmptyDescription,
    EmptyHeader,
    EmptyTitle,
} from "@/components/ui/empty";
import {
    eventLabel,
    evidenceStatusCopy,
    executionLabel,
    lifecycleLabel,
} from "@/lib/presentation/research-copy";
import { cn } from "@/lib/utils";

type RunProjection = FunctionReturnType<typeof api.researchRuns.getMine>;
type RunEvents = FunctionReturnType<typeof api.researchRuns.listMyEvents>;

/** Renders only persisted workflow state and event history. */
export function RunProgress({
    run,
    events,
    onOpenSources,
}: {
    run: RunProjection;
    events: RunEvents;
    onOpenSources?: () => void;
}) {
    const canAddManualSource = [
        "awaiting_evidence_sufficiency_review",
        "awaiting_source_review",
    ].includes(run.lifecycleState);
    // Model incidents are not retrieval failures; they never imply that a source could not be read.
    const retrievalFailures = run.sourcesProtocol
        ? run.providerFailures.filter((failure) => failure.service !== "model")
        : run.providerFailures;
    const evidenceCopy =
        run.lifecycleState === "extracting_evidence"
            ? run.pauseReason === "claim_generation_unavailable"
                ? evidenceStatusCopy.unavailable
                : run.executionStatus === "running"
                  ? evidenceStatusCopy.preparing
                  : run.executionStatus === "failed"
                    ? evidenceStatusCopy.failed
                    : null
            : null;

    return (
        <section
            className="workbench-visual grid items-start gap-5 xl:grid-cols-[var(--side-column)_minmax(0,1fr)_var(--side-column)]"
            aria-label="Research progress">
            <aside className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
                <div className="surface-panel rounded-2xl p-5">
                    <div className="flex items-center justify-between gap-3">
                        <h2 className="text-micro">Sources</h2>
                        <Badge
                            tone={
                                run.executionStatus === "running" &&
                                run.lifecycleState === "discovering_sources"
                                    ? "inference"
                                    : "ink"
                            }>
                            {run.executionStatus === "running" &&
                            run.lifecycleState === "discovering_sources"
                                ? "Running"
                                : "Documentary material"}
                        </Badge>
                    </div>
                    <div
                        aria-hidden="true"
                        className="my-5 flex h-20 items-center justify-center">
                        <div className="h-16 w-24 -rotate-6 rounded-lg bg-card p-3 shadow-raised">
                            <div className="mb-2 h-1.5 w-12 rounded bg-foreground/15" />
                            <div className="mb-2 h-1 w-full rounded bg-foreground/10" />
                            <div className="h-1 w-14 rounded bg-brand-purple/30" />
                        </div>
                    </div>
                    <p className="text-sm leading-6 text-muted-foreground">
                        Inspect retained sources, selection decisions and
                        disclosed gaps.
                    </p>
                    {onOpenSources ? (
                        <Button
                            variant="outline"
                            size="sm"
                            className="mt-4 rounded-tile"
                            onClick={onOpenSources}>
                            Open Sources
                        </Button>
                    ) : null}
                </div>
                <div className="rounded-2xl border-[1.5px] border-dashed border-edge-dashed p-5">
                    <h2 className="text-micro">Investigation</h2>
                    <p className="mt-4 text-sm leading-6 text-muted-foreground">
                        Question-led investigation is not available yet.
                        Existing assertions remain inspectable in Inventory.
                    </p>
                </div>
            </aside>
            <div className="order-first min-w-0 space-y-5 xl:order-none">
                <div
                    className={cn(
                        "surface-panel p-5",
                        run.executionStatus === "running" && "shadow-focal",
                        run.executionStatus === "paused" &&
                            [
                                "awaiting_source_review",
                                "awaiting_evidence_sufficiency_review",
                            ].includes(run.lifecycleState) &&
                            "shadow-review",
                    )}>
                    <p className="text-micro text-brand-purple">
                        Current state
                    </p>
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
                            Source set approved. These sources are ready for
                            evidence preparation.
                        </p>
                    ) : null}
                    {evidenceCopy ? (
                        <div className="mt-4 text-sm">
                            <p className="font-medium">{evidenceCopy.title}</p>
                            <p className="mt-2 text-muted-foreground">
                                {evidenceCopy.description}
                            </p>
                        </div>
                    ) : null}
                    {run.lifecycleState === "evidence_ready" ? (
                        <p className="mt-4 text-sm text-muted-foreground">
                            Evidence is ready. Open Inventory to inspect the
                            extracted assertions, citations and limitations.
                        </p>
                    ) : null}
                </div>
                {retrievalFailures.length > 0 ? (
                    <div
                        className="rounded-xl border border-destructive/30 bg-destructive/5 p-4"
                        role="alert">
                        <h3 className="text-sm font-medium">
                            Some sources could not be retrieved
                        </h3>
                        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                            {run.sourcesProtocol
                                ? "Some public documents could not be retrieved. Sources shows which documents were read and which remain unavailable."
                                : run.lifecycleState ===
                                        "extracting_evidence" ||
                                    run.lifecycleState === "evidence_ready"
                                  ? "Some research sources were unavailable. Inspect the approved set in Sources and consider any evidence gaps during review."
                                  : canAddManualSource
                                    ? "Independent web discovery is unavailable. Filing sources remain available, and you can add a public source manually."
                                    : run.lifecycleState === "corpus_approved"
                                      ? "Independent web discovery was unavailable. Filing sources remain available in this approved source set."
                                      : "Independent web discovery is unavailable. Filing sources remain available for the source review checkpoint."}
                        </p>
                    </div>
                ) : null}
                {events.length === 0 ? (
                    <Empty className="surface-panel min-h-40 p-6">
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
            </div>
            <aside className="rounded-2xl border-[1.5px] border-dashed border-edge-dashed p-5">
                <div className="flex items-center justify-between gap-3">
                    <h2 className="text-micro">Synthesis</h2>
                    <Badge tone="dashed">Unavailable</Badge>
                </div>
                <p className="mt-4 text-sm leading-6 text-muted-foreground">
                    Synthesis is not available yet. No mechanism or full brief
                    has been produced.
                </p>
                <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                    <div className="rounded-lg bg-fill-quiet p-4">
                        <h3 className="text-micro">Mechanism</h3>
                        <p className="mt-3 text-xs text-muted-foreground">
                            No diagram available
                        </p>
                    </div>
                    <div className="rounded-lg bg-fill-quiet p-4">
                        <h3 className="text-micro">Full brief</h3>
                        <p className="mt-3 text-xs text-muted-foreground">
                            No brief available
                        </p>
                    </div>
                </div>
            </aside>
        </section>
    );
}
