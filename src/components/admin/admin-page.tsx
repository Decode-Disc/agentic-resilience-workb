"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Shield01Icon } from "@hugeicons/core-free-icons";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { type Dispatch, type SetStateAction, useEffect, useState } from "react";
import { toast } from "sonner";

import { AdminDossierBrowser } from "@/components/admin/admin-dossier-browser";
import {
    AdminAgentModels,
    AdminModels,
} from "@/components/admin/admin-model-configuration";
import { AdminProviderActivity } from "@/components/admin/admin-provider-activity";
import { AdminProviderCallInspection } from "@/components/admin/admin-provider-call-inspection";
import { AdminReservations } from "@/components/admin/admin-reservations";
import { AdminReviewDecisions } from "@/components/admin/admin-review-decisions";
import { AdminRunInspection } from "@/components/admin/admin-run-inspection";
import Icon from "@/components/icon";
import { LoadErrorBoundary } from "@/components/load-error-boundary";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Empty,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle,
} from "@/components/ui/empty";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

const sections = [
    { value: "models", label: "Models" },
    { value: "agent-models", label: "Agent models" },
    { value: "dossiers", label: "Dossiers" },
    { value: "reservations", label: "Reservations" },
    { value: "provider-activity", label: "Provider activity" },
    { value: "review-decisions", label: "Review decisions" },
] as const;

/** Read-mostly administration for the single invited administrator. */
export function AdminPage() {
    const [visitor, setVisitor] = useState<
        FunctionReturnType<typeof api.visitors.current> | undefined
    >(undefined);
    const [operations, setOperations] = useState<
        FunctionReturnType<typeof api.adminOperations.get> | undefined
    >(undefined);
    const setPaidWorkEnabled = useMutation(
        api.adminOperations.setPaidWorkEnabled,
    );
    const [pendingEnabled, setPendingEnabled] = useState<boolean | null>(null);
    const [reason, setReason] = useState("");
    const [pending, setPending] = useState(false);
    const [inspectRunId, setInspectRunId] = useState<Id<"researchRuns"> | null>(
        null,
    );
    const [inspectCall, setInspectCall] = useState<
        | FunctionReturnType<
              typeof api.adminOperations.get
          >["providerCalls"][number]
        | null
    >(null);

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

    const paidWorkEnabled = operations.paidWork.enabled;

    return (
        <>
            {queryBridge}
            <div className="space-y-6 py-4">
                <header className="flex flex-col justify-between gap-5 border-b border-border/60 pb-6 sm:flex-row sm:items-end">
                    <div className="space-y-2">
                        <p className="text-micro text-brand-purple">
                            Restricted administration
                        </p>
                        <h1 className="text-display">Administration</h1>
                        <p className="max-w-xl text-sm text-muted-foreground sm:text-base">
                            Dossiers, reservations, provider activity and review
                            decisions across this deployment.
                        </p>
                    </div>
                    <div className="flex items-start gap-3">
                        <div className="space-y-1">
                            <Label htmlFor="paid-work-switch">Paid work</Label>
                            <p
                                id="paid-work-consequence"
                                className="text-xs text-muted-foreground">
                                {paidWorkEnabled
                                    ? "Provider attempts are allowed."
                                    : "Provider attempts are blocked."}
                            </p>
                        </div>
                        <Switch
                            id="paid-work-switch"
                            aria-label="Paid work"
                            aria-describedby="paid-work-consequence"
                            checked={paidWorkEnabled}
                            onCheckedChange={(next) => {
                                setReason("");
                                setPendingEnabled(next);
                            }}
                        />
                    </div>
                </header>

                <Tabs
                    defaultValue="dossiers"
                    orientation="vertical"
                    className="flex-col gap-4 md:flex-row md:gap-8">
                    <TabsList className="shrink-0 md:sticky md:top-20 md:self-start">
                        {sections.map((section) => (
                            <TabsTrigger
                                key={section.value}
                                value={section.value}>
                                {section.label}
                            </TabsTrigger>
                        ))}
                    </TabsList>
                    <TabsContent value="models">
                        <AdminModels />
                    </TabsContent>
                    <TabsContent value="agent-models">
                        <AdminAgentModels />
                    </TabsContent>
                    <TabsContent value="dossiers">
                        <AdminDossierBrowser onInspectRun={setInspectRunId} />
                    </TabsContent>
                    <TabsContent value="reservations">
                        <AdminReservations
                            reservations={operations.reservations}
                        />
                    </TabsContent>
                    <TabsContent value="provider-activity">
                        <AdminProviderActivity
                            providerCalls={operations.providerCalls}
                            onInspectCall={setInspectCall}
                        />
                    </TabsContent>
                    <TabsContent value="review-decisions">
                        <AdminReviewDecisions
                            checkpoints={operations.checkpoints}
                            onInspectRun={setInspectRunId}
                        />
                    </TabsContent>
                </Tabs>
            </div>

            <Dialog
                open={pendingEnabled !== null}
                onOpenChange={(open) => {
                    if (!open) setPendingEnabled(null);
                }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>
                            {pendingEnabled ? "Enable" : "Disable"} paid work
                        </DialogTitle>
                        <DialogDescription>
                            Human checkpoints stay reviewable either way. This
                            switch blocks new provider attempts server-side.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-2">
                        <Label htmlFor="paid-work-reason">
                            Reason for this change
                        </Label>
                        <Textarea
                            id="paid-work-reason"
                            value={reason}
                            onChange={(event) => setReason(event.target.value)}
                        />
                        <p className="text-xs text-muted-foreground">
                            Recorded in the audit trail. At least 12 characters.
                        </p>
                    </div>
                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => setPendingEnabled(null)}>
                            Cancel
                        </Button>
                        <Button
                            variant={pendingEnabled ? "default" : "destructive"}
                            disabled={pending || reason.trim().length < 12}
                            onClick={async () => {
                                if (pendingEnabled === null) return;
                                setPending(true);
                                try {
                                    await setPaidWorkEnabled({
                                        enabled: pendingEnabled,
                                        reason: reason.trim(),
                                    });
                                    setPendingEnabled(null);
                                    toast.success(
                                        pendingEnabled
                                            ? "Paid work enabled. New provider attempts are allowed."
                                            : "Paid work disabled. New provider attempts are blocked.",
                                    );
                                } catch {
                                    toast.error(
                                        "We couldn’t update paid work. Try again.",
                                    );
                                } finally {
                                    setPending(false);
                                }
                            }}>
                            {pending
                                ? "Saving…"
                                : `Confirm ${pendingEnabled ? "enable" : "disable"}`}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog
                open={inspectRunId !== null}
                onOpenChange={(open) => {
                    if (!open) setInspectRunId(null);
                }}>
                <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-xl">
                    <DialogHeader>
                        <DialogTitle>Dossier inspection</DialogTitle>
                        <DialogDescription>
                            Read-only history. Dossiers cannot be resumed from
                            this view.
                        </DialogDescription>
                    </DialogHeader>
                    {inspectRunId ? (
                        <LoadErrorBoundary
                            title="Inspection unavailable"
                            description="We couldn’t load this dossier. Try again.">
                            <AdminRunInspection
                                runId={inspectRunId}
                                onInspectCall={setInspectCall}
                            />
                        </LoadErrorBoundary>
                    ) : null}
                </DialogContent>
            </Dialog>

            <Dialog
                open={inspectCall !== null}
                onOpenChange={(open) => {
                    if (!open) setInspectCall(null);
                }}>
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle>Provider attempt</DialogTitle>
                        <DialogDescription>
                            Recorded response outcome and provider accounting.
                        </DialogDescription>
                    </DialogHeader>
                    {inspectCall ? (
                        <LoadErrorBoundary
                            title="Attempt unavailable"
                            description="We couldn’t load this provider attempt. Try again.">
                            <AdminProviderCallInspection
                                providerCallId={inspectCall._id}
                            />
                        </LoadErrorBoundary>
                    ) : null}
                </DialogContent>
            </Dialog>
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
                <Skeleton className="h-4 w-44" />
                <Skeleton className="h-10 w-56" />
                <Skeleton className="h-4 w-full max-w-md" />
            </div>
            <div className="grid gap-4 md:grid-cols-[13rem_minmax(0,1fr)]">
                <Skeleton className="h-44" />
                <Skeleton className="h-96" />
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
