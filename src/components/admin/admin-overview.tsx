import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { CLIENT_PAGE_SIZE } from "@convex/resourcePolicy";
import {
    AiBrain01Icon,
    Analytics01Icon,
    ArrowTurnBackwardIcon,
    CheckmarkCircle02Icon,
    FolderOpenIcon,
    PlayIcon,
    RefreshIcon,
    Settings02Icon,
} from "@hugeicons/core-free-icons";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Fragment, useState } from "react";
import { toast } from "sonner";
import { AdminModelStatusBadge } from "@/components/admin/admin-model-status-badge";
import { AdminReasonDialog } from "@/components/admin/admin-reason-dialog";
import { AdminMarkBadge } from "@/components/admin/admin-status-badge";
import Icon from "@/components/icon";
import { Button } from "@/components/ui/button";
import {
    Card,
    CardAction,
    CardContent,
    CardDescription,
    CardFooter,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import {
    Empty,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle,
} from "@/components/ui/empty";
import {
    Item,
    ItemActions,
    ItemContent,
    ItemDescription,
    ItemGroup,
    ItemSeparator,
    ItemTitle,
} from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
    type AdminAttentionItem,
    adminAttention,
    adminRecentSpend,
    formatAdminCost,
} from "@/lib/presentation/admin";
import {
    MODEL_REFRESH_FAILURE_COPY,
    useRefreshModelProfiles,
} from "@/lib/workspace/use-refresh-model-profiles";

type Operations = FunctionReturnType<typeof api.adminOperations.get>;

/** The administration home: what blocks analysts first, then the deployment's standing state. */
export function AdminOverview({
    operations,
    onOpenModels,
    onOpenDossier,
    onOpenReservations,
    onOpenActivity,
}: {
    operations: Operations;
    onOpenModels: () => void;
    onOpenDossier: (runId: Id<"researchRuns">) => void;
    onOpenReservations: () => void;
    onOpenActivity: () => void;
}) {
    const config = useQuery(api.modelConfiguration.list, {});
    const recentRuns = usePaginatedQuery(
        api.adminOperations.listRunsPage,
        { purpose: "research" },
        { initialNumItems: CLIENT_PAGE_SIZE.adminDossiers },
    );
    const restorable = usePaginatedQuery(
        api.adminOperations.listRestorableRunsPage,
        {},
        { initialNumItems: CLIENT_PAGE_SIZE.adminReservations },
    );
    const [paidWorkTarget, setPaidWorkTarget] = useState<boolean | null>(null);
    const loading =
        !config ||
        recentRuns.status === "LoadingFirstPage" ||
        restorable.status === "LoadingFirstPage";
    const items = loading
        ? []
        : adminAttention({
              paidWorkEnabled: operations.paidWork.enabled,
              models: config.models,
              assignments: config.assignments,
              agents: config.agents,
              restorableCount: restorable.results.length,
              recentRuns: recentRuns.results,
          });
    return (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_23rem]">
            <section aria-labelledby="admin-attention-title">
                <Card>
                    <CardHeader>
                        <CardTitle>
                            <h2
                                id="admin-attention-title"
                                className="text-section">
                                Needs attention
                                {items.length ? ` · ${items.length}` : ""}
                            </h2>
                        </CardTitle>
                        <CardDescription>
                            Conditions that stop analysts from working. Failed
                            dossiers are checked among the{" "}
                            {CLIENT_PAGE_SIZE.adminDossiers} most recently
                            updated.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        {loading ? (
                            <div
                                role="status"
                                aria-label="Checking what needs attention"
                                className="space-y-3">
                                <Skeleton className="h-14 w-full" />
                                <Skeleton className="h-14 w-full" />
                            </div>
                        ) : items.length === 0 ? (
                            <Empty className="py-8">
                                <EmptyHeader>
                                    <EmptyMedia variant="icon">
                                        <Icon
                                            iconNode={CheckmarkCircle02Icon}
                                        />
                                    </EmptyMedia>
                                    <EmptyTitle>
                                        Nothing needs attention
                                    </EmptyTitle>
                                    <EmptyDescription>
                                        Paid work is on, the models agents use
                                        are ready and no recent dossier has
                                        failed.
                                    </EmptyDescription>
                                </EmptyHeader>
                            </Empty>
                        ) : (
                            <AttentionList
                                items={items}
                                models={config?.models ?? []}
                                onEnablePaidWork={() => setPaidWorkTarget(true)}
                                onOpenModels={onOpenModels}
                                onOpenDossier={onOpenDossier}
                                onOpenReservations={onOpenReservations}
                            />
                        )}
                    </CardContent>
                </Card>
            </section>
            <aside
                aria-label="Deployment status"
                className="flex flex-col gap-4">
                <PaidWorkCard
                    enabled={operations.paidWork.enabled}
                    onChange={setPaidWorkTarget}
                />
                <AgentModelsCard config={config} onOpenModels={onOpenModels} />
                <RecentSpendCard
                    providerCalls={operations.providerCalls}
                    onOpenActivity={onOpenActivity}
                />
            </aside>
            <PaidWorkDialog
                target={paidWorkTarget}
                onClose={() => setPaidWorkTarget(null)}
            />
        </div>
    );
}

// The mark carries severity alongside the wording: failures and stopped work first, then blocked agents, then housekeeping.
const ATTENTION_MARKS: Record<AdminAttentionItem["kind"], string> = {
    paid_work: "bg-destructive",
    dossier: "bg-destructive",
    model: "bg-(--review)",
    reservations: "bg-(--brand-purple)",
};

function AttentionList({
    items,
    models,
    onEnablePaidWork,
    onOpenModels,
    onOpenDossier,
    onOpenReservations,
}: {
    items: AdminAttentionItem[];
    models: FunctionReturnType<typeof api.modelConfiguration.list>["models"];
    onEnablePaidWork: () => void;
    onOpenModels: () => void;
    onOpenDossier: (runId: Id<"researchRuns">) => void;
    onOpenReservations: () => void;
}) {
    const { refresh, refreshing } = useRefreshModelProfiles();
    const [error, setError] = useState<string | null>(null);
    const actionFor = (item: AdminAttentionItem) => {
        const action = item.action;
        switch (action.kind) {
            case "enable_paid_work":
                return (
                    <Button size="sm" onClick={onEnablePaidWork}>
                        <Icon iconNode={PlayIcon} />
                        Turn paid work on
                    </Button>
                );
            case "refresh_model": {
                const model = models.find((m) => m._id === action.catalogId);
                return (
                    <Button
                        size="sm"
                        disabled={!model || !!refreshing}
                        onClick={async () => {
                            if (!model) return;
                            setError(null);
                            if (await refresh(model))
                                toast.success(
                                    `${model.label} is ready for analysts again.`,
                                );
                            else setError(MODEL_REFRESH_FAILURE_COPY);
                        }}>
                        <Icon iconNode={RefreshIcon} />
                        {refreshing === action.catalogId
                            ? "Updating…"
                            : "Update model"}
                    </Button>
                );
            }
            case "open_models":
                return (
                    <Button size="sm" variant="outline" onClick={onOpenModels}>
                        <Icon iconNode={AiBrain01Icon} />
                        Review models
                    </Button>
                );
            case "open_dossier":
                return (
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={() => onOpenDossier(action.runId)}>
                        <Icon iconNode={FolderOpenIcon} />
                        Open dossier
                    </Button>
                );
            case "open_reservations":
                return (
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={onOpenReservations}>
                        <Icon iconNode={ArrowTurnBackwardIcon} />
                        Review reservations
                    </Button>
                );
        }
    };
    return (
        <div className="space-y-3">
            {error && (
                <p role="alert" className="text-sm text-destructive">
                    {error}
                </p>
            )}
            <ItemGroup>
                {items.map((item, index) => (
                    <Fragment key={item.key}>
                        {index > 0 ? <ItemSeparator /> : null}
                        <Item size="sm" className="flex-wrap px-0">
                            <span
                                aria-hidden="true"
                                className={`mt-1.5 size-2.5 shrink-0 self-start rounded-full ${ATTENTION_MARKS[item.kind]}`}
                            />
                            <ItemContent className="min-w-56">
                                <ItemTitle>{item.title}</ItemTitle>
                                <ItemDescription className="line-clamp-none">
                                    {item.detail}
                                </ItemDescription>
                            </ItemContent>
                            <ItemActions>{actionFor(item)}</ItemActions>
                        </Item>
                    </Fragment>
                ))}
            </ItemGroup>
        </div>
    );
}

function PaidWorkCard({
    enabled,
    onChange,
}: {
    enabled: boolean;
    onChange: (enabled: boolean) => void;
}) {
    return (
        <Card size="sm">
            <CardHeader>
                <CardTitle>
                    <h3>Paid work</h3>
                </CardTitle>
                <CardDescription id="paid-work-consequence">
                    {enabled
                        ? "On. New research, preparation and Workbench replies can call providers."
                        : "Stopped. No new provider attempt can start; existing results stay readable."}
                </CardDescription>
                <CardAction>
                    <Switch
                        aria-label="Paid work"
                        aria-describedby="paid-work-consequence"
                        checked={enabled}
                        onCheckedChange={onChange}
                    />
                </CardAction>
            </CardHeader>
            <CardFooter className="mt-auto">
                <p className="text-xs text-muted-foreground">
                    Changing it asks for a reason recorded in the audit trail.
                </p>
            </CardFooter>
        </Card>
    );
}

function AgentModelsCard({
    config,
    onOpenModels,
}: {
    config: FunctionReturnType<typeof api.modelConfiguration.list> | undefined;
    onOpenModels: () => void;
}) {
    const agents = config?.agents.filter((agent) => agent.implemented) ?? [];
    return (
        <Card size="sm">
            <CardHeader>
                <CardTitle>
                    <h3>Agent models</h3>
                </CardTitle>
                <CardDescription>
                    The model each connected agent uses.
                </CardDescription>
            </CardHeader>
            <CardContent>
                {!config ? (
                    <div
                        role="status"
                        aria-label="Loading agent models"
                        className="space-y-2">
                        <Skeleton className="h-5 w-full" />
                        <Skeleton className="h-5 w-full" />
                    </div>
                ) : (
                    <dl className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2">
                        {agents.map((agent) => {
                            const assignment = config.assignments.find(
                                (a) => a.agent === agent.agent,
                            );
                            const model = config.models.find(
                                (m) => m._id === assignment?.catalogId,
                            );
                            return (
                                <Fragment key={agent.agent}>
                                    <dt className="min-w-0">
                                        <span className="block truncate font-medium">
                                            {agent.label}
                                        </span>
                                        <span className="block truncate text-xs text-muted-foreground">
                                            {model?.label ??
                                                "No model assigned"}
                                        </span>
                                    </dt>
                                    <dd>
                                        {model ? (
                                            <AdminModelStatusBadge
                                                model={model}
                                            />
                                        ) : (
                                            <AdminMarkBadge mark="unassigned" />
                                        )}
                                    </dd>
                                </Fragment>
                            );
                        })}
                    </dl>
                )}
            </CardContent>
            <CardFooter className="mt-auto">
                <Button size="sm" variant="outline" onClick={onOpenModels}>
                    <Icon iconNode={Settings02Icon} />
                    Manage models
                </Button>
            </CardFooter>
        </Card>
    );
}

function RecentSpendCard({
    providerCalls,
    onOpenActivity,
}: {
    providerCalls: Operations["providerCalls"];
    onOpenActivity: () => void;
}) {
    const spend = adminRecentSpend(providerCalls);
    return (
        <Card size="sm">
            <CardHeader>
                <CardTitle>
                    <h3>Recent spend</h3>
                </CardTitle>
                <CardDescription>
                    Across the last {spend.attempts} provider attempts.
                </CardDescription>
            </CardHeader>
            <CardContent>
                <AdminSpendFigures spend={spend} />
            </CardContent>
            <CardFooter className="mt-auto">
                <Button
                    size="sm"
                    variant="outline"
                    className="w-full"
                    onClick={onOpenActivity}>
                    <Icon iconNode={Analytics01Icon} />
                    View activity
                </Button>
            </CardFooter>
        </Card>
    );
}

/** Confirmed cost, unconfirmed costs and failures for a set of recent provider attempts. */
export function AdminSpendFigures({
    spend,
}: {
    spend: ReturnType<typeof adminRecentSpend>;
}) {
    return (
        <dl className="grid grid-cols-3 gap-3">
            {[
                ["Confirmed cost", formatAdminCost(spend.confirmedCost)],
                ["Unconfirmed", String(spend.unconfirmed)],
                ["Failed attempts", String(spend.failed)],
            ].map(([label, value]) => (
                <div key={label} className="min-w-0 space-y-1">
                    <dt className="text-xs text-muted-foreground">{label}</dt>
                    <dd className="text-base font-medium tabular-nums">
                        {value}
                    </dd>
                </div>
            ))}
        </dl>
    );
}

function PaidWorkDialog({
    target,
    onClose,
}: {
    target: boolean | null;
    onClose: () => void;
}) {
    const setPaidWorkEnabled = useMutation(
        api.adminOperations.setPaidWorkEnabled,
    );
    return (
        <AdminReasonDialog
            open={target !== null}
            title={target ? "Turn paid work on" : "Stop paid work"}
            description={
                target
                    ? "Provider attempts become possible again for research, preparation and Workbench replies."
                    : "This blocks every new provider attempt server-side. Human checkpoints and existing results stay reviewable."
            }
            reasonLabel="Reason for this change"
            confirmLabel={target ? "Turn on" : "Stop paid work"}
            pendingLabel="Saving…"
            destructive={target === false}
            onClose={onClose}
            onConfirm={async (reason) => {
                if (target === null) return false;
                try {
                    await setPaidWorkEnabled({ enabled: target, reason });
                    toast.success(
                        target
                            ? "Paid work enabled. New provider attempts are allowed."
                            : "Paid work disabled. New provider attempts are blocked.",
                    );
                    return true;
                } catch {
                    toast.error("We couldn’t update paid work. Try again.");
                    return false;
                }
            }}
        />
    );
}
