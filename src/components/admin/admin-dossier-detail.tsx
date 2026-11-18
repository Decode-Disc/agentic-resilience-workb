import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { withdrawableRun } from "@convex/domain/runWithdrawal";
import {
    Cancel01Icon,
    Delete02Icon,
    RotateLeft01Icon,
} from "@hugeicons/core-free-icons";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { type ComponentType, type ReactNode, useEffect, useState } from "react";
import { toast } from "sonner";
import { AdminReasonDialog } from "@/components/admin/admin-reason-dialog";
import { AdminRunInspection } from "@/components/admin/admin-run-inspection";
import { AdminMarkBadge } from "@/components/admin/admin-status-badge";
import {
    dossierPurposeLabel,
    type RunPurpose,
} from "@/components/admin/dossier-purpose";
import { DossierStatusBadge } from "@/components/dossier-status-badge";
import Icon from "@/components/icon";
import { LoadErrorBoundary } from "@/components/load-error-boundary";
import { Button } from "@/components/ui/button";
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { lifecycleLabel } from "@/lib/presentation/research-copy";
import { cn } from "@/lib/utils";

type ProviderCall = FunctionReturnType<
    typeof api.adminOperations.get
>["providerCalls"][number];

type TextSlot = ComponentType<{ className?: string; children: ReactNode }>;

const PlainTitle: TextSlot = ({ className, children }) => (
    <h3 className={className}>{children}</h3>
);
const PlainDescription: TextSlot = ({ className, children }) => (
    <p className={className}>{children}</p>
);

/**
 * One dossier's operational detail: readable status first, then its recorded history, then withdrawal when
 * the domain allows it. Rendered beside the list on wide screens and in a side panel on narrow ones.
 */
export function AdminDossierDetail({
    runId,
    onInspectCall,
    onWithdrawn,
    onClose,
    onPurpose,
    Title = PlainTitle,
    Description = PlainDescription,
    className,
}: {
    runId: Id<"researchRuns">;
    onInspectCall: (call: ProviderCall) => void;
    onWithdrawn: () => void;
    /** An inline host closes the detail itself; a side panel brings its own close control. */
    onClose?: () => void;
    /** Reports the loaded dossier's purpose so its host can show the list it belongs to. */
    onPurpose?: (purpose: RunPurpose) => void;
    /** Panel hosts supply their accessible title and description components. */
    Title?: TextSlot;
    Description?: TextSlot;
    className?: string;
}) {
    return (
        <section
            aria-label="Dossier detail"
            className={cn("relative flex min-h-0 flex-col", className)}>
            {onClose ? (
                <Button
                    size="icon-sm"
                    variant="outline"
                    aria-label="Close dossier"
                    title="Close dossier"
                    className="absolute top-4 right-4 z-10"
                    onClick={onClose}>
                    <Icon iconNode={Cancel01Icon} />
                </Button>
            ) : null}
            <LoadErrorBoundary
                title="Dossier unavailable"
                description="We couldn’t load this dossier. Try again.">
                <DossierDetailBody
                    runId={runId}
                    onInspectCall={onInspectCall}
                    onWithdrawn={onWithdrawn}
                    onPurpose={onPurpose}
                    Title={Title}
                    Description={Description}
                />
            </LoadErrorBoundary>
        </section>
    );
}

/** The narrow-screen host: the same detail in a right side panel. */
export function AdminDossierSheet({
    runId,
    onClose,
    onInspectCall,
    onPurpose,
}: {
    runId: Id<"researchRuns"> | null;
    onClose: () => void;
    onInspectCall: (call: ProviderCall) => void;
    onPurpose?: (purpose: RunPurpose) => void;
}) {
    return (
        <Sheet
            open={runId !== null}
            onOpenChange={(open) => {
                if (!open) onClose();
            }}>
            <SheetContent className="w-full gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-2xl">
                {runId ? (
                    <AdminDossierDetail
                        runId={runId}
                        onInspectCall={onInspectCall}
                        onWithdrawn={onClose}
                        onPurpose={onPurpose}
                        Title={SheetTitle}
                        Description={SheetDescription}
                        className="h-full"
                    />
                ) : null}
            </SheetContent>
        </Sheet>
    );
}

function DossierDetailBody({
    runId,
    onInspectCall,
    onWithdrawn,
    onPurpose,
    Title,
    Description,
}: {
    runId: Id<"researchRuns">;
    onInspectCall: (call: ProviderCall) => void;
    onWithdrawn: () => void;
    onPurpose?: (purpose: RunPurpose) => void;
    Title: TextSlot;
    Description: TextSlot;
}) {
    const details = useQuery(api.adminOperations.inspectRun, { runId });
    const withdrawDossier = useMutation(api.admin.withdrawDossier);
    const [withdrawing, setWithdrawing] = useState(false);
    const reopenDossier = useMutation(api.admin.reopenAtSourcesTimeLimit);
    const [reopening, setReopening] = useState(false);
    const run = details?.run;
    const purpose = run?.purpose;
    useEffect(() => {
        if (purpose) onPurpose?.(purpose);
    }, [purpose, onPurpose]);
    const company =
        details?.company?.legalName ??
        run?.companySnapshot?.legalName ??
        "Company not recorded";
    return (
        <>
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-divider p-6 pr-14">
                <div className="min-w-0 space-y-1">
                    <Title className="text-lg font-medium">
                        {run ? company : "Dossier"}
                    </Title>
                    <Description className="text-sm text-muted-foreground">
                        {run
                            ? [
                                  run.purpose
                                      ? dossierPurposeLabel(run.purpose)
                                      : null,
                                  run.lifecycleState === "sources_prepared"
                                      ? "Investigation is not available yet"
                                      : lifecycleLabel(run.lifecycleState),
                                  `created ${new Date(run.createdAt).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" })}`,
                              ]
                                  .filter(Boolean)
                                  .join(" · ")
                            : "Loading dossier…"}
                    </Description>
                </div>
                {run ? (
                    <div className="flex flex-wrap items-center gap-2">
                        <DossierStatusBadge
                            run={{ ...run, sourcesPhase: details.sourcesPhase }}
                        />
                        {run.withdrawnAt ? (
                            <AdminMarkBadge mark="withdrawn" />
                        ) : null}
                        {details?.reopenable ? (
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setReopening(true)}>
                                <Icon iconNode={RotateLeft01Icon} />
                                Reopen at time limit
                            </Button>
                        ) : null}
                        {withdrawableRun(run) ? (
                            <Button
                                size="sm"
                                variant="destructive"
                                onClick={() => setWithdrawing(true)}>
                                <Icon iconNode={Delete02Icon} />
                                Withdraw dossier
                            </Button>
                        ) : null}
                    </div>
                ) : (
                    <Skeleton className="h-5 w-24" />
                )}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-6">
                <AdminRunInspection
                    runId={runId}
                    onInspectCall={onInspectCall}
                />
            </div>
            <AdminReasonDialog
                open={reopening}
                title="Reopen at time limit"
                description="This dossier failed when Sources preparation reached its deadline. Reopening keeps the material already gathered and asks the analyst, in the dossier conversation, whether to continue preparation or use what's prepared. Nothing new runs until they decide."
                reasonLabel="Reason for reopening"
                confirmLabel="Confirm reopening"
                pendingLabel="Reopening…"
                onClose={() => setReopening(false)}
                onConfirm={async (reason) => {
                    try {
                        await reopenDossier({ runId, reason });
                        toast.success(
                            "Dossier reopened. The analyst can now continue preparation or use what's prepared.",
                        );
                        return true;
                    } catch {
                        toast.error(
                            "We couldn’t reopen the dossier. It may have changed; reload it and try again.",
                        );
                        return false;
                    }
                }}
            />
            <AdminReasonDialog
                open={withdrawing}
                title="Withdraw dossier"
                description="Withdrawing stops unfinished work, removes the dossier from the analyst's workspace list and releases its analysis once. Completed results stay readable through their direct link."
                reasonLabel="Reason for withdrawal"
                confirmLabel="Confirm withdrawal"
                pendingLabel="Withdrawing…"
                destructive
                onClose={() => setWithdrawing(false)}
                onConfirm={async (reason) => {
                    try {
                        await withdrawDossier({ runId, reason });
                        toast.success(
                            "Dossier withdrawn. The analysis seat has been released.",
                        );
                        onWithdrawn();
                        return true;
                    } catch {
                        toast.error(
                            "We couldn’t withdraw the dossier. Try again.",
                        );
                        return false;
                    }
                }}
            />
        </>
    );
}
