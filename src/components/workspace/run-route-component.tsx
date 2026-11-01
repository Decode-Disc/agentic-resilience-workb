"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useNavigate } from "@tanstack/react-router";
import { useAction, useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { CompanyFaviconAvatar } from "@/components/company-favicon-avatar";
import {
    Empty,
    EmptyDescription,
    EmptyHeader,
    EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { EvidenceInventory } from "@/components/workspace/evidence-inventory";
import { EvidenceSufficiencyReview } from "@/components/workspace/evidence-sufficiency-review";
import { LiveSourceReview } from "@/components/workspace/live-source-review";
import { RunProgress } from "@/components/workspace/run-progress";
import type { SourceReviewNavigation } from "@/components/workspace/source-proposal-review";
import { ConnectedStartWorkspace } from "@/components/workspace/start/connected-start-workspace";
import { WorkspaceNavigation } from "@/components/workspace/workspace-navigation";
import {
    type WorkspaceSection,
    type WorkspaceSubsection,
    workspaceSections,
} from "@/lib/workspace/navigation";

function decisionKey(prefix: string) {
    return `${prefix}:${crypto.randomUUID()}`;
}

/** Owner-scoped production workspace backed only by reactive Convex state. */
export function RunRouteComponent({
    runId,
    section,
    detail,
    sourceReviewNavigation,
    onSourceReviewNavigate,
    subsection,
    inventoryOpen = false,
    onInventoryOpenChange,
}: {
    runId: Id<"researchRuns">;
    section: WorkspaceSection;
    detail?: "timeline" | "framing";
    subsection?: WorkspaceSubsection;
    inventoryOpen?: boolean;
    onInventoryOpenChange?: (open: boolean) => void;
    sourceReviewNavigation?: SourceReviewNavigation;
    onSourceReviewNavigate?: (destination: SourceReviewNavigation) => void;
}) {
    const navigate = useNavigate();
    const run = useQuery(api.researchRuns.getMine, { runId });
    const events = useQuery(api.researchRuns.listMyEvents, { runId });
    const decide = useMutation(api.sources.decide);
    const decideSufficiency = useMutation(api.evidenceSufficiency.decide);
    const submitManualUrl = useAction(api.sourceActions.submitManualUrl);
    const [localInventoryOpen, setLocalInventoryOpen] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const routedToSourceReview = useRef(false);

    useEffect(() => {
        if (
            run?.startMode === "framed" ||
            run?.lifecycleState !== "awaiting_source_review"
        ) {
            routedToSourceReview.current = false;
            return;
        }
        if (
            section === "progress" &&
            !inventoryOpen &&
            !routedToSourceReview.current
        ) {
            routedToSourceReview.current = true;
            void navigate({
                to: "/workspace/$runId",
                params: { runId },
                search: { section: "sources" },
                replace: true,
            });
        }
    }, [
        navigate,
        run?.lifecycleState,
        run?.startMode,
        runId,
        section,
        inventoryOpen,
    ]);

    if (run === undefined || events === undefined) {
        return (
            <div
                role="status"
                className="flex flex-col gap-5"
                aria-label="Loading research workspace"
                aria-busy="true">
                <Skeleton className="h-10 w-full max-w-md" />
                <Skeleton className="h-8 w-64 max-w-full" />
                {section === "progress" ? (
                    <div className="grid items-start gap-5 xl:grid-cols-[var(--side-column)_minmax(0,1fr)_var(--side-column)]">
                        <div className="hidden space-y-4 xl:block">
                            <Skeleton className="h-64 rounded-2xl" />
                            <Skeleton className="h-40 rounded-2xl" />
                        </div>
                        <div className="space-y-5">
                            <Skeleton className="h-32 rounded-xl" />
                            <Skeleton className="h-80 rounded-2xl" />
                        </div>
                        <Skeleton className="hidden h-96 rounded-2xl xl:block" />
                    </div>
                ) : (
                    <div className="space-y-4">
                        <Skeleton className="h-24 rounded-xl" />
                        <Skeleton className="h-80 rounded-xl" />
                    </div>
                )}
            </div>
        );
    }

    if (!run.company) {
        return (
            <Empty>
                <EmptyHeader>
                    <EmptyTitle>Company context unavailable</EmptyTitle>
                    <EmptyDescription>
                        This dossier has no verified company. Return to company
                        selection to continue.
                    </EmptyDescription>
                </EmptyHeader>
            </Empty>
        );
    }

    const corpusRevisionId = run.activeCorpusRevisionId;
    const exaNotConfigured = run.providerFailures.some(
        ({ service, errorCode }) =>
            service === "exa" && errorCode === "exa_not_configured",
    );
    const sourceMode =
        section === "sources" &&
        (run.lifecycleState === "awaiting_source_review" ||
            run.corpusRevisionStatus === "approved") &&
        corpusRevisionId !== undefined;

    async function handleAddManualUrl(url: string) {
        if (!corpusRevisionId) {
            throw new Error(
                "The source set is not ready yet. Refresh and try again.",
            );
        }
        await submitManualUrl({
            requestKey: crypto.randomUUID(),
            url,
            target: {
                kind: "run",
                runId,
                corpusRevisionId,
            },
        });
    }

    if (run.startMode === "framed" && section === "progress")
        return (
            <ConnectedStartWorkspace
                runId={runId}
                detail={detail}
                checkpoint={
                    run.lifecycleState ===
                    "awaiting_evidence_sufficiency_review" ? (
                        <EvidenceSufficiencyReview
                            onAddManualUrl={handleAddManualUrl}
                            onDecide={async (decision) => {
                                await decideSufficiency({ runId, decision });
                            }}
                        />
                    ) : undefined
                }
                progress={
                    <RunProgress
                        run={run}
                        events={events}
                        onOpenSources={() =>
                            void navigate({
                                to: "/workspace/$runId",
                                params: { runId },
                                search: { section: "sources" },
                            })
                        }
                    />
                }
            />
        );

    return (
        <div className="min-w-0 pb-28 pt-2 sm:pb-36">
            <WorkspaceNavigation
                runId={runId}
                section={section}
                subsection={subsection}
            />
            <header className="mb-5">
                <p className="text-micro text-brand-purple">
                    {run.company.ticker} · {run.company.exchange}
                </p>
                <div className="flex gap-2 items-center mt-2">
                    <CompanyFaviconAvatar
                        company={run.company}
                        size="default"
                    />
                    <h1 className="text-section text-2xl">
                        {run.company.legalName}
                    </h1>
                </div>
            </header>
            <div className="min-w-0">
                {error ? (
                    <p
                        role="alert"
                        className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                        {error}
                    </p>
                ) : null}
                {exaNotConfigured &&
                run.lifecycleState === "awaiting_source_review" ? (
                    <p
                        role="status"
                        className="mb-4 rounded-lg border border-review/30 bg-review/10 p-3 text-sm text-muted-foreground">
                        Independent web discovery is unavailable. Filing sources
                        remain available for review.
                    </p>
                ) : null}
                {section === "progress" ? (
                    <>
                        {run.lifecycleState ===
                        "awaiting_evidence_sufficiency_review" ? (
                            <EvidenceSufficiencyReview
                                onAddManualUrl={handleAddManualUrl}
                                onDecide={async (decision) => {
                                    await decideSufficiency({
                                        runId,
                                        decision,
                                    });
                                }}
                            />
                        ) : null}
                        <RunProgress
                            run={run}
                            events={events}
                            onOpenSources={() => {
                                void navigate({
                                    to: "/workspace/$runId",
                                    params: { runId },
                                    search: { section: "sources" },
                                });
                            }}
                        />
                    </>
                ) : sourceMode ? (
                    <LiveSourceReview
                        sourceReviewNavigation={sourceReviewNavigation}
                        onSourceReviewNavigate={onSourceReviewNavigate}
                        runId={runId}
                        corpusRevisionId={corpusRevisionId}
                        canStartNewRevision={
                            run.canStartNewCorpusRevision === true
                        }
                        onDecide={async (sourceId, nextDecision) => {
                            setError(null);
                            try {
                                await decide({
                                    runId,
                                    corpusRevisionId: corpusRevisionId,
                                    sourceId,
                                    decision: nextDecision,
                                    decisionKey: decisionKey("source-decision"),
                                });
                            } catch (caught) {
                                setError(
                                    "We couldn't save that source decision. Try again.",
                                );
                                throw caught;
                            }
                        }}
                        onAddManualUrl={handleAddManualUrl}
                    />
                ) : section === "sources" ? (
                    <div className="surface-panel p-6">
                        <h2 className="text-section">Source discovery</h2>
                        <p className="mt-2 text-sm text-muted-foreground">
                            {run.lifecycleState === "discovering_sources"
                                ? "We’re gathering public sources for your review."
                                : "Sources will appear here when discovery is ready."}
                        </p>
                    </div>
                ) : (
                    <div className="rounded-2xl border-[1.5px] border-dashed border-edge-dashed p-6 sm:p-8">
                        <p className="section-chip mb-5">
                            {"//"} {section}
                        </p>
                        <h2 className="text-heading">
                            {section === "investigation"
                                ? "Investigation"
                                : "Synthesis"}{" "}
                            is not available yet
                        </h2>
                        <p className="mt-3 max-w-prose text-sm leading-6 text-muted-foreground">
                            {
                                workspaceSections.find(
                                    (item) =>
                                        item.key === section &&
                                        "unavailable" in item,
                                )?.unavailable
                            }
                        </p>
                    </div>
                )}
            </div>
            <EvidenceInventory
                runId={runId}
                open={
                    onInventoryOpenChange ? inventoryOpen : localInventoryOpen
                }
                onOpenChange={onInventoryOpenChange ?? setLocalInventoryOpen}
                expanded={section === "progress"}
            />
        </div>
    );
}
