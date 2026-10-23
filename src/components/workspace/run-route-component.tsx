"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useNavigate } from "@tanstack/react-router";
import { useAction, useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";

import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { EvidenceSufficiencyReview } from "@/components/workspace/evidence-sufficiency-review";
import { EvidenceMatrix } from "@/components/workspace/evidence-matrix";
import { LiveSourceReview } from "@/components/workspace/live-source-review";
import type { SourceReviewNavigation } from "@/components/workspace/source-proposal-review";
import { RunProgress } from "@/components/workspace/run-progress";
import { CompanyFaviconAvatar } from "@/components/company-favicon-avatar";
import {
  WorkspaceNavigationRail,
  type WorkspaceSection,
} from "@/components/workspace/workspace-navigation-rail";
import { uiLayerClasses } from "@/lib/ui-layers";

function decisionKey(prefix: string) {
  return `${prefix}:${crypto.randomUUID()}`;
}

/** Owner-scoped production workspace backed only by reactive Convex state. */
export function RunRouteComponent({
  runId,
  section,
  sourceReviewNavigation,
  onSourceReviewNavigate,
}: {
  runId: Id<"researchRuns">;
  section: WorkspaceSection;
  sourceReviewNavigation?: SourceReviewNavigation;
  onSourceReviewNavigate?: (destination: SourceReviewNavigation) => void;
}) {
  const navigate = useNavigate();
  const run = useQuery(api.researchRuns.getMine, { runId });
  const events = useQuery(api.researchRuns.listMyEvents, { runId });
  const decide = useMutation(api.sources.decide);
  const decideSufficiency = useMutation(api.evidenceSufficiency.decide);
  const submitManualUrl = useAction(api.sourceActions.submitManualUrl);
  const [error, setError] = useState<string | null>(null);
  const routedToSourceReview = useRef(false);

  useEffect(() => {
    if (run?.lifecycleState !== "awaiting_source_review") {
      routedToSourceReview.current = false;
      return;
    }
    if (section === "progress" && !routedToSourceReview.current) {
      routedToSourceReview.current = true;
      void navigate({
        to: "/workspace/$runId",
        params: { runId },
        search: { section: "sources" },
        replace: true,
      });
    }
  }, [navigate, run?.lifecycleState, runId, section]);

  if (run === undefined || events === undefined) {
    return (
      <div
        role="status"
        className="grid gap-4 md:grid-cols-[minmax(11rem,14rem)_minmax(0,1fr)] xl:grid-cols-[minmax(4.25rem,14rem)_minmax(0,1fr)]"
        aria-label="Loading research workspace"
        aria-busy="true"
      >
        <Skeleton className="h-112" />
        <div className="space-y-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-52" />
        </div>
      </div>
    );
  }

  if (!run.company) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>Company context unavailable</EmptyTitle>
          <EmptyDescription>
            This dossier has no verified company. Return to company selection to continue.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const corpusRevisionId = run.activeCorpusRevisionId;
  const exaNotConfigured = run.providerFailures.some(
    ({ service, errorCode }) => service === "exa" && errorCode === "exa_not_configured",
  );
  const sourceMode =
    section === "sources" &&
    (run.lifecycleState === "awaiting_source_review" || run.corpusRevisionStatus === "approved") &&
    corpusRevisionId !== undefined;

  async function handleAddManualUrl(url: string) {
    if (!corpusRevisionId) {
      throw new Error("The source set is not ready yet. Refresh and try again.");
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

  return (
    <div className="py-4">
      <header className="mb-5">
        <p className="text-micro text-brand-purple">
          {run.company.ticker} · {run.company.exchange}
        </p>
        <div className="flex gap-2 items-center mt-2">
          <CompanyFaviconAvatar company={run.company} size="default" />
          <h1 className="text-2xl font-medium">{run.company.legalName}</h1>
        </div>
      </header>
      <div className="grid items-start gap-4 grid-cols-[auto_minmax(0,1fr)]">
        <aside className={`sticky top-20 ${uiLayerClasses.navigationRail} w-fit min-w-0`}>
          <WorkspaceNavigationRail
            runId={runId}
            section={section}
            lifecycleState={run.lifecycleState}
          />
        </aside>
        <main className="min-w-0">
          {error ? (
            <p
              role="alert"
              className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
            >
              {error}
            </p>
          ) : null}
          {exaNotConfigured && run.lifecycleState === "awaiting_source_review" ? (
            <p
              role="status"
              className="mb-4 rounded-lg border border-review/30 bg-review/10 p-3 text-sm text-muted-foreground"
            >
              Independent web discovery is unavailable. Filing sources remain available for review.
            </p>
          ) : null}
          {section === "progress" ? (
            <>
              {run.lifecycleState === "awaiting_evidence_sufficiency_review" ? (
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
              <RunProgress run={run} events={events} />
            </>
          ) : sourceMode ? (
            <LiveSourceReview
              sourceReviewNavigation={sourceReviewNavigation}
              onSourceReviewNavigate={onSourceReviewNavigate}
              runId={runId}
              corpusRevisionId={corpusRevisionId}
              canStartNewRevision={run.canStartNewCorpusRevision === true}
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
                  setError("We couldn't save that source decision. Try again.");
                  throw caught;
                }
              }}
              onAddManualUrl={handleAddManualUrl}
            />
          ) : section === "sources" ? (
            <div className="surface-panel rounded-xl p-6">
              <h2 className="text-lg font-medium">Source discovery</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                {run.lifecycleState === "discovering_sources"
                  ? "We’re gathering public sources for your review."
                  : "Sources will appear here when discovery is ready."}
              </p>
            </div>
          ) : section === "evidence" ? (
            <EvidenceMatrix runId={runId} />
          ) : (
            <div className="surface-panel rounded-xl p-6">
              <h2 className="text-lg font-medium capitalize">{section}</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                This section opens after you review and approve the preceding evidence.
              </p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
