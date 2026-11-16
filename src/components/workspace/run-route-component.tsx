"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";
import { CompanyFaviconAvatar } from "@/components/company-favicon-avatar";
import {
    Empty,
    EmptyDescription,
    EmptyHeader,
    EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { EvidenceInventory } from "@/components/workspace/evidence-inventory";
import { RunProgress } from "@/components/workspace/run-progress";
import { ConnectedSources } from "@/components/workspace/sources/connected-sources";
import {
    ConnectedStartWorkspace,
    StartWorkspaceSkeleton,
} from "@/components/workspace/start/connected-start-workspace";
import { WorkspaceNavigation } from "@/components/workspace/workspace-navigation";
import { sourcesPhasePresentation } from "@/lib/presentation/sources";
import {
    type WorkspaceSearch,
    type WorkspaceSection,
    type WorkspaceSubsection,
    workspaceSections,
} from "@/lib/workspace/navigation";
import { stashWorkbenchDraft } from "@/lib/workspace/workbench-draft";

type SourcesSearch = Pick<
    WorkspaceSearch,
    "sourcesView" | "source" | "q" | "kind" | "reading" | "use"
>;

/** Sources content before the mission records preparation, or for dossiers prepared by the retired corpus review. Follows the shared Sources mission state. */
function sourcesFallbackCopy(
    run: NonNullable<FunctionReturnType<typeof api.researchRuns.getMine>>,
) {
    if (run.lifecycleState === "framing")
        return {
            title: "Sources has not started",
            description:
                "Documentary preparation starts when you start the research.",
        };
    if (!run.sourcesProtocol)
        return {
            title: "Sources view unavailable for this dossier",
            description:
                "This dossier was prepared with a source review that is no longer available. Start a new analysis to use the current Sources view.",
        };
    const presentation = sourcesPhasePresentation(run.sourcesPhase);
    const state = presentation.workState;
    if (state === "running" || state === "waiting" || state === "paused")
        return {
            title:
                state === "paused"
                    ? presentation.title
                    : "Preparing documentary sources",
            description:
                "Sources is gathering public documents. Its preparation appears here as soon as discovery returns.",
        };
    return {
        title: "Documentary preparation stopped",
        description:
            "Research stopped before Sources could prepare any material, so there is nothing to inspect here. Start a new analysis to try again.",
    };
}

/** Owner-scoped production workspace backed only by reactive Convex state. */
export function RunRouteComponent({
    runId,
    section,
    detail,
    subsection,
    inventoryOpen = false,
    onInventoryOpenChange,
    sourcesSearch = {},
    onSourcesSearchChange,
}: {
    runId: Id<"researchRuns">;
    section: WorkspaceSection;
    detail?: "timeline" | "framing";
    subsection?: WorkspaceSubsection;
    inventoryOpen?: boolean;
    onInventoryOpenChange?: (open: boolean) => void;
    /** Location within the Sources screens. */
    sourcesSearch?: SourcesSearch;
    onSourcesSearchChange?: (patch: SourcesSearch, replace?: boolean) => void;
}) {
    const navigate = useNavigate();
    const run = useQuery(api.researchRuns.getMine, { runId });
    const events = useQuery(api.researchRuns.listMyEvents, { runId });
    const [localInventoryOpen, setLocalInventoryOpen] = useState(false);

    const needsEvents =
        section !== "progress" ||
        detail === "timeline" ||
        (run !== undefined && run !== null && run.startMode !== "framed");

    if (run === undefined || (needsEvents && events === undefined)) {
        if (section === "progress")
            return (
                <div
                    data-workbench-layout={
                        detail === "timeline" ? "document" : "viewport"
                    }
                    className="flex min-h-0 flex-1 flex-col">
                    <StartWorkspaceSkeleton
                        detail={detail}
                        ariaLabel="Loading research workspace"
                    />
                </div>
            );
        return (
            <div
                role="status"
                className="flex flex-col gap-5"
                aria-label="Loading research workspace"
                aria-busy="true">
                <Skeleton className="h-10 w-full max-w-md" />
                <Skeleton className="h-8 w-64 max-w-full" />
                <div className="space-y-4">
                    <Skeleton className="h-24 rounded-xl" />
                    <Skeleton className="h-80 rounded-xl" />
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
                        This dossier has no verified company. Return to company
                        selection to continue.
                    </EmptyDescription>
                </EmptyHeader>
            </Empty>
        );
    }

    const openSources = () =>
        void navigate({
            to: "/workspace/$runId",
            params: { runId },
            search: { section: "sources" },
        });

    if (run.startMode === "framed" && section === "progress")
        return (
            <ConnectedStartWorkspace
                runId={runId}
                detail={detail}
                progress={
                    events ? (
                        <RunProgress
                            run={run}
                            events={events}
                            onOpenSources={openSources}
                        />
                    ) : undefined
                }
            />
        );

    const navigation = (
        <WorkspaceNavigation
            runId={runId}
            section={section}
            subsection={subsection}
        />
    );
    const inventory = (
        <EvidenceInventory
            runId={runId}
            open={onInventoryOpenChange ? inventoryOpen : localInventoryOpen}
            onOpenChange={onInventoryOpenChange ?? setLocalInventoryOpen}
            expanded={section === "progress"}
        />
    );
    const fallback = sourcesFallbackCopy(run);
    const generic = (
        <div className="min-w-0 pb-28 pt-2 sm:pb-36">
            {navigation}
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
                {section === "progress" ? (
                    <RunProgress
                        run={run}
                        events={events ?? []}
                        onOpenSources={openSources}
                    />
                ) : section === "sources" ? (
                    <div className="surface-panel p-6">
                        <h2 className="text-section">{fallback.title}</h2>
                        <p className="mt-2 max-w-prose text-sm text-muted-foreground">
                            {fallback.description}
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
            {inventory}
        </div>
    );
    if (section !== "sources" || !onSourcesSearchChange) return generic;
    return (
        <ConnectedSources
            runId={runId}
            run={run}
            search={sourcesSearch}
            onSearchChange={onSourcesSearchChange}
            navigation={navigation}
            fallback={generic}
            dock={inventory}
            onFollowUp={
                run.startMode === "framed"
                    ? (draft) => {
                          stashWorkbenchDraft(runId, draft);
                          void navigate({
                              to: "/workspace/$runId",
                              params: { runId },
                              search: { section: "progress" },
                          });
                      }
                    : undefined
            }
        />
    );
}
