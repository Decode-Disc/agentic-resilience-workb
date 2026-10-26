"use client";

import { api } from "@convex/_generated/api";
import { Add01Icon, Folder02Icon } from "@hugeicons/core-free-icons";
import { Link } from "@tanstack/react-router";
import { useQuery } from "convex/react";

import Icon from "@/components/icon";
import { LoadErrorBoundary } from "@/components/load-error-boundary";
import { Button } from "@/components/ui/button";
import {
    Empty,
    EmptyContent,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { ResearchDossierCard } from "@/components/workspace/research-dossier-card";
import { ResearchDossierCardSkeleton } from "@/components/workspace/research-dossier-card-skeleton";

function DossiersLoading() {
    return (
        <div
            aria-label="Loading research dossiers"
            className="space-y-8"
            role="status">
            <div className="space-y-3">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-10 w-48" />
                <Skeleton className="h-4 w-full max-w-md" />
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)] gap-5 md:grid-cols-2 xl:grid-cols-3">
                {[0, 1, 2].map((item) => (
                    <div className="mx-auto w-full max-w-md" key={item}>
                        <ResearchDossierCardSkeleton />
                    </div>
                ))}
            </div>
        </div>
    );
}

function DossiersEmpty() {
    return (
        <Empty className="surface-panel min-h-96 border border-border/60">
            <EmptyHeader>
                <EmptyMedia variant="icon">
                    <Icon iconNode={Folder02Icon} />
                </EmptyMedia>
                <EmptyTitle>No research dossiers yet</EmptyTitle>
                <EmptyDescription>
                    Choose a company to begin your first research dossier.
                </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
                <Button
                    render={<Link to="/workspace/start" />}
                    nativeButton={false}>
                    <Icon iconNode={Add01Icon} />
                    Start a dossier
                </Button>
            </EmptyContent>
        </Empty>
    );
}

function DossiersContent() {
    const dossiers = useQuery(api.researchRuns.listMine);

    if (dossiers === undefined) {
        return <DossiersLoading />;
    }

    return (
        <section className="space-y-8" aria-labelledby="dossiers-heading">
            <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
                <div className="space-y-2">
                    <p className="text-micro text-brand-purple">
                        Research workspace
                    </p>
                    <h1 id="dossiers-heading" className="text-display">
                        Dossiers
                    </h1>
                    <p className="max-w-xl text-sm text-muted-foreground sm:text-base">
                        Continue active research or revisit a completed dossier.
                    </p>
                </div>
                {dossiers.length > 0 ? (
                    <Button
                        render={<Link to="/workspace/start" />}
                        nativeButton={false}
                        variant="outline">
                        <Icon iconNode={Add01Icon} />
                        New dossier
                    </Button>
                ) : null}
            </div>

            {dossiers.length === 0 ? (
                <DossiersEmpty />
            ) : (
                <ul className="grid grid-cols-[minmax(0,1fr)] gap-5 md:grid-cols-2 xl:grid-cols-3">
                    {dossiers.map((dossier) => (
                        <li
                            className="mx-auto w-full max-w-md"
                            key={dossier.runId}>
                            <ResearchDossierCard dossier={dossier} />
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}

/**
 * Lists the admitted analyst's persisted research dossiers.
 */
export function ResearchDossiersPage() {
    return (
        <LoadErrorBoundary
            title="Research dossiers unavailable"
            description="We couldn’t load your dossiers. Try again.">
            <DossiersContent />
        </LoadErrorBoundary>
    );
}
