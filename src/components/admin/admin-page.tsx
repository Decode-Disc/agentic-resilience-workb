"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
    AiBrain01Icon,
    Analytics01Icon,
    DashboardSquare01Icon,
    Folder01Icon,
    Shield01Icon,
} from "@hugeicons/core-free-icons";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { type Dispatch, type SetStateAction, useEffect, useState } from "react";
import { AdminDossiersSection } from "@/components/admin/admin-dossiers-section";
import { AdminModelsSection } from "@/components/admin/admin-models-section";
import { AdminOverview } from "@/components/admin/admin-overview";
import { AdminProviderActivity } from "@/components/admin/admin-provider-activity";
import { AdminProviderCallInspection } from "@/components/admin/admin-provider-call-inspection";
import Icon from "@/components/icon";
import { LoadErrorBoundary } from "@/components/load-error-boundary";
import { DirectionAwareTabs } from "@/components/ui/direction-aware-tabs";
import {
    Empty,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle,
} from "@/components/ui/empty";
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
    ADMIN_SECTIONS,
    type AdminSearch,
    type AdminSection,
    adminPurpose,
    adminSection,
    adminSectionSearch,
    adminView,
} from "@/lib/workspace/admin-navigation";

const SECTION_ICONS = {
    overview: DashboardSquare01Icon,
    dossiers: Folder01Icon,
    models: AiBrain01Icon,
    activity: Analytics01Icon,
} satisfies Record<AdminSection, unknown>;

type ProviderCall = FunctionReturnType<
    typeof api.adminOperations.get
>["providerCalls"][number];

/**
 * Administration for the single invited administrator: an Overview of what blocks analysts, then Dossiers,
 * Models & agents and Activity & spend. The route binds `search` to the URL through `onSearchChange`.
 */
export function AdminPage({
    search,
    onSearchChange,
}: {
    search?: AdminSearch;
    onSearchChange?: (next: AdminSearch) => void;
}) {
    // Without a handler the page owns its state, starting from `search`.
    const [localSearch, setLocalSearch] = useState<AdminSearch>(search ?? {});
    const current = onSearchChange ? (search ?? {}) : localSearch;
    const navigate = onSearchChange ?? setLocalSearch;
    const [visitor, setVisitor] = useState<
        FunctionReturnType<typeof api.visitors.current> | undefined
    >(undefined);
    const [operations, setOperations] = useState<
        FunctionReturnType<typeof api.adminOperations.get> | undefined
    >(undefined);
    const [inspectCall, setInspectCall] = useState<ProviderCall | null>(null);

    const queryBridge = (
        <LoadErrorBoundary
            title="Administration unavailable"
            description="We couldn’t load the administration view. Try again.">
            <AdminQueryBridge
                setVisitor={setVisitor}
                setOperations={setOperations}
            />
        </LoadErrorBoundary>
    );

    if (visitor === undefined) {
        return (
            <>
                {queryBridge}
                <AdminSkeleton />
            </>
        );
    }

    if (visitor?.role !== "admin") {
        return (
            <>
                {queryBridge}
                <Empty className="surface-panel min-h-64 border border-border/60">
                    <EmptyHeader>
                        <EmptyMedia variant="icon">
                            <Icon iconNode={Shield01Icon} />
                        </EmptyMedia>
                        <EmptyTitle>Administrator access required</EmptyTitle>
                        <EmptyDescription>
                            This page is restricted to the invited
                            administrator.
                        </EmptyDescription>
                    </EmptyHeader>
                </Empty>
            </>
        );
    }

    if (!operations) {
        return (
            <>
                {queryBridge}
                <AdminSkeleton />
            </>
        );
    }

    const section = adminSection(current);
    const openSection = (next: AdminSection) =>
        navigate(adminSectionSearch(next));
    const openDossier = (dossier: Id<"researchRuns">) =>
        navigate({ section: "dossiers", dossier });

    return (
        <>
            {queryBridge}
            <div className="space-y-6 py-4">
                <header className="space-y-2">
                    <h1 className="text-display">Administration</h1>
                    <p className="max-w-2xl text-sm text-muted-foreground sm:text-base">
                        Unblock analysts, inspect dossiers, configure the models
                        agents use and follow provider spend for this
                        deployment.
                    </p>
                </header>

                <DirectionAwareTabs
                    value={section}
                    onChange={(id) => {
                        const next = ADMIN_SECTIONS.find(
                            (entry) => entry.value === id,
                        );
                        if (next) openSection(next.value);
                    }}
                    containerClassName="items-start"
                    className="max-w-full"
                    contentSizing="fill"
                    tabs={ADMIN_SECTIONS.map((entry) => ({
                        id: entry.value,
                        label: (
                            <span className="flex items-center gap-2">
                                <Icon
                                    iconNode={SECTION_ICONS[entry.value]}
                                    size={16}
                                />
                                <span className="sr-only sm:not-sr-only">
                                    {entry.label}
                                </span>
                            </span>
                        ),
                        content:
                            entry.value === "overview" ? (
                                <AdminOverview
                                    operations={operations}
                                    onOpenModels={() =>
                                        navigate(
                                            adminSectionSearch(
                                                "models",
                                                "catalogue",
                                            ),
                                        )
                                    }
                                    onOpenDossier={openDossier}
                                    onOpenReservations={() =>
                                        navigate(
                                            adminSectionSearch(
                                                "dossiers",
                                                "reservations",
                                            ),
                                        )
                                    }
                                    onOpenActivity={() =>
                                        openSection("activity")
                                    }
                                />
                            ) : entry.value === "dossiers" ? (
                                <AdminDossiersSection
                                    operations={operations}
                                    view={adminView(current, "dossiers")}
                                    purpose={adminPurpose(current)}
                                    dossier={current.dossier}
                                    onNavigate={navigate}
                                    onInspectCall={setInspectCall}
                                />
                            ) : entry.value === "models" ? (
                                <AdminModelsSection
                                    view={adminView(current, "models")}
                                    onNavigate={navigate}
                                />
                            ) : (
                                <AdminProviderActivity
                                    providerCalls={operations.providerCalls}
                                    onInspectCall={setInspectCall}
                                />
                            ),
                    }))}
                />
            </div>

            <Sheet
                open={inspectCall !== null}
                onOpenChange={(open) => {
                    if (!open) setInspectCall(null);
                }}>
                <SheetContent className="w-full gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-lg">
                    <SheetHeader className="border-b border-divider pr-14">
                        <SheetTitle>Provider attempt</SheetTitle>
                        <SheetDescription>
                            Recorded response outcome and provider accounting.
                        </SheetDescription>
                    </SheetHeader>
                    <div className="min-h-0 flex-1 overflow-y-auto p-6">
                        {inspectCall ? (
                            <LoadErrorBoundary
                                title="Attempt unavailable"
                                description="We couldn’t load this provider attempt. Try again.">
                                <AdminProviderCallInspection
                                    providerCallId={inspectCall._id}
                                />
                            </LoadErrorBoundary>
                        ) : null}
                    </div>
                </SheetContent>
            </Sheet>
        </>
    );
}

function AdminSkeleton() {
    return (
        <div
            role="status"
            aria-label="Loading administration"
            aria-busy="true"
            className="space-y-6 py-4">
            <div className="space-y-3">
                <Skeleton className="h-10 w-56" />
                <Skeleton className="h-4 w-full max-w-md" />
            </div>
            <Skeleton className="h-9 w-full max-w-lg" />
            <Skeleton className="h-48 w-full rounded-xl" />
            <div className="grid gap-4 lg:grid-cols-3">
                <Skeleton className="h-36 rounded-xl" />
                <Skeleton className="h-36 rounded-xl" />
                <Skeleton className="h-36 rounded-xl" />
            </div>
        </div>
    );
}

function AdminQueryBridge({
    setVisitor,
    setOperations,
}: {
    setVisitor: Dispatch<
        SetStateAction<
            FunctionReturnType<typeof api.visitors.current> | undefined
        >
    >;
    setOperations: Dispatch<
        SetStateAction<
            FunctionReturnType<typeof api.adminOperations.get> | undefined
        >
    >;
}) {
    const visitor = useQuery(api.visitors.current);
    const operations = useQuery(
        api.adminOperations.get,
        visitor?.role === "admin" ? {} : "skip",
    );

    useEffect(() => {
        setVisitor(visitor);
        setOperations(operations);
    }, [operations, setOperations, setVisitor, visitor]);

    return null;
}
