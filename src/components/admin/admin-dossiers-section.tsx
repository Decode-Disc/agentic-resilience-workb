import type { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { FolderOpenIcon } from "@hugeicons/core-free-icons";
import type { FunctionReturnType } from "convex/server";
import { useRef } from "react";
import { AdminDossierBrowser } from "@/components/admin/admin-dossier-browser";
import {
    AdminDossierDetail,
    AdminDossierSheet,
} from "@/components/admin/admin-dossier-detail";
import { AdminReservations } from "@/components/admin/admin-reservations";
import { AdminReviewDecisions } from "@/components/admin/admin-review-decisions";
import Icon from "@/components/icon";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { DirectionAwareTabs } from "@/components/ui/direction-aware-tabs";
import {
    Empty,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle,
} from "@/components/ui/empty";
import { useMediaQuery } from "@/hooks/use-responsive";
import {
    ADMIN_VIEWS,
    type AdminPurpose,
    type AdminSearch,
    type AdminView,
    adminDossierSearch,
} from "@/lib/workspace/admin-navigation";

type Operations = FunctionReturnType<typeof api.adminOperations.get>;
type ProviderCall = Operations["providerCalls"][number];

/** Dossiers, reservations and review decisions; a dossier is read beside its list on wide screens. */
export function AdminDossiersSection({
    operations,
    view,
    purpose,
    dossier,
    onNavigate,
    onInspectCall,
}: {
    operations: Operations;
    view: AdminView<"dossiers">;
    /** The dossier list in view; an open dossier always belongs to it. */
    purpose: AdminPurpose;
    dossier?: Id<"researchRuns">;
    onNavigate: (search: AdminSearch) => void;
    onInspectCall: (call: ProviderCall) => void;
}) {
    const wide = useMediaQuery("(min-width: 64rem)");
    const counts: Record<AdminView<"dossiers">, number | null> = {
        dossiers: null,
        reservations: operations.reservations.length,
        reviews: operations.checkpoints.length,
    };
    // Closing the inline detail returns focus to the control that opened it.
    const opener = useRef<HTMLElement | null>(null);
    const openDossier = (runId: Id<"researchRuns">) => {
        opener.current =
            document.activeElement instanceof HTMLElement
                ? document.activeElement
                : null;
        onNavigate(adminDossierSearch(purpose, runId));
    };
    const closeDossier = () => {
        onNavigate(adminDossierSearch(purpose));
        const target = opener.current;
        requestAnimationFrame(() => target?.isConnected && target.focus());
    };
    // A dossier opened from elsewhere (an overview item, a review decision) moves the list to its own purpose.
    const followPurpose = (runPurpose: AdminPurpose) => {
        if (dossier && runPurpose !== purpose)
            onNavigate(adminDossierSearch(runPurpose, dossier));
    };
    return (
        <>
            <DirectionAwareTabs
                value={view}
                onChange={(id) =>
                    onNavigate(
                        id === "dossiers"
                            ? adminDossierSearch(purpose)
                            : {
                                  section: "dossiers",
                                  view: id as AdminView<"dossiers">,
                              },
                    )
                }
                containerClassName="items-start"
                contentSizing="fill"
                tabs={ADMIN_VIEWS.dossiers.map((entry) => ({
                    id: entry.value,
                    label: (
                        <span>
                            {entry.label}
                            {counts[entry.value] !== null ? (
                                <span className="text-muted-foreground">
                                    {" "}
                                    · {counts[entry.value]}
                                </span>
                            ) : null}
                        </span>
                    ),
                    content:
                        entry.value === "dossiers" ? (
                            <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
                                <Card>
                                    <CardHeader>
                                        <CardTitle>
                                            <h3>Dossiers</h3>
                                        </CardTitle>
                                        <CardDescription>
                                            Newest activity first. Select one to
                                            inspect it.
                                        </CardDescription>
                                    </CardHeader>
                                    <CardContent>
                                        <AdminDossierBrowser
                                            purpose={purpose}
                                            onPurposeChange={(next) =>
                                                onNavigate(
                                                    adminDossierSearch(next),
                                                )
                                            }
                                            selectedId={dossier}
                                            onOpenDossier={openDossier}
                                        />
                                    </CardContent>
                                </Card>
                                {wide ? (
                                    <Card className="min-h-[min(70svh,40rem)] gap-0 py-0">
                                        {dossier ? (
                                            <AdminDossierDetail
                                                key={dossier}
                                                runId={dossier}
                                                onInspectCall={onInspectCall}
                                                onWithdrawn={closeDossier}
                                                onClose={closeDossier}
                                                onPurpose={followPurpose}
                                                className="max-h-[calc(100svh-7rem)]"
                                            />
                                        ) : (
                                            <Empty className="my-auto">
                                                <EmptyHeader>
                                                    <EmptyMedia variant="icon">
                                                        <Icon
                                                            iconNode={
                                                                FolderOpenIcon
                                                            }
                                                        />
                                                    </EmptyMedia>
                                                    <EmptyTitle>
                                                        Select a dossier
                                                    </EmptyTitle>
                                                    <EmptyDescription>
                                                        Its status, provider
                                                        receipts and journal
                                                        appear here.
                                                    </EmptyDescription>
                                                </EmptyHeader>
                                            </Empty>
                                        )}
                                    </Card>
                                ) : null}
                            </div>
                        ) : entry.value === "reservations" ? (
                            <AdminReservations
                                reservations={operations.reservations}
                            />
                        ) : (
                            <AdminReviewDecisions
                                checkpoints={operations.checkpoints}
                                onOpenDossier={openDossier}
                            />
                        ),
                }))}
            />
            {wide ? null : (
                <AdminDossierSheet
                    runId={dossier ?? null}
                    onClose={closeDossier}
                    onInspectCall={onInspectCall}
                    onPurpose={followPurpose}
                />
            )}
        </>
    );
}
