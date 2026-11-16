import { api } from "@convex/_generated/api";
import { FloppyDiskIcon } from "@hugeicons/core-free-icons";
import { useMutation, useQuery } from "convex/react";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { Fragment, useState } from "react";
import { toast } from "sonner";
import { AdminModelStatusBadge } from "@/components/admin/admin-model-status-badge";
import { AdminMarkBadge } from "@/components/admin/admin-status-badge";
import Icon from "@/components/icon";
import { LoadErrorBoundary } from "@/components/load-error-boundary";
import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import {
    Item,
    ItemActions,
    ItemContent,
    ItemDescription,
    ItemGroup,
    ItemSeparator,
    ItemTitle,
} from "@/components/ui/item";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

type Agent = FunctionArgs<typeof api.modelConfiguration.assign>["agent"];
type CatalogModel = FunctionReturnType<
    typeof api.modelConfiguration.list
>["models"][number];

/** Which model each agent uses for following missions; engaged work keeps its recorded model. */
export function AdminAgentModels() {
    return (
        <Card>
            <CardHeader>
                <CardTitle>
                    <h3>Agent models</h3>
                </CardTitle>
                <CardDescription>
                    Changes apply to following missions. Engaged work and
                    existing dossier choices keep their recorded model.
                </CardDescription>
            </CardHeader>
            <CardContent>
                <LoadErrorBoundary
                    title="Agent model settings unavailable"
                    description="Try loading the settings again.">
                    <AgentAssignments />
                </LoadErrorBoundary>
            </CardContent>
        </Card>
    );
}

function AgentAssignments() {
    const config = useQuery(api.modelConfiguration.list, {});
    const assign = useMutation(api.modelConfiguration.assign);
    const [drafts, setDrafts] = useState<
        Partial<Record<Agent, CatalogModel["_id"]>>
    >({});
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    if (!config)
        return (
            <div
                role="status"
                aria-label="Loading agent model settings"
                className="space-y-3">
                {[1, 2, 3].map((key) => (
                    <Skeleton key={key} className="h-12 w-full" />
                ))}
            </div>
        );
    const savedModel = (agent: Agent) =>
        config.assignments.find((a) => a.agent === agent)?.catalogId;
    const stage = (agent: Agent, id: CatalogModel["_id"]) =>
        setDrafts(({ [agent]: _, ...rest }) =>
            id === savedModel(agent) ? rest : { ...rest, [agent]: id },
        );
    const changed = Object.keys(drafts).length;
    const save = async () => {
        if (saving || !changed) return;
        setSaving(true);
        setError(null);
        let failed = 0;
        for (const [agent, id] of Object.entries(drafts) as [
            Agent,
            CatalogModel["_id"],
        ][]) {
            const previous = config.assignments.find((a) => a.agent === agent);
            try {
                await assign({
                    agent,
                    catalogId: id,
                    expectedRevision: previous?.revision ?? 0,
                    requestKey: crypto.randomUUID(),
                });
                setDrafts(({ [agent]: _, ...rest }) => rest);
            } catch {
                failed += 1;
            }
        }
        setSaving(false);
        if (failed)
            setError(
                "Some assignments could not be saved, possibly because they changed elsewhere. Your unsaved choices are kept; review them and save again.",
            );
        else toast.success("Agent models saved.");
    };
    const options = config.models.filter((m) => m.enabled && m.compatible);
    return (
        <div className="space-y-3">
            {error && (
                <p role="alert" className="text-sm text-destructive">
                    {error}
                </p>
            )}
            <ItemGroup>
                {config.agents.map((info, index) => {
                    const edited = info.agent in drafts;
                    const selected = config.models.find(
                        (m) =>
                            m._id ===
                            (drafts[info.agent] ?? savedModel(info.agent)),
                    );
                    return (
                        <Fragment key={info.agent}>
                            {index > 0 ? <ItemSeparator /> : null}
                            <Item size="sm" className="px-0">
                                <ItemContent className="min-w-0">
                                    <ItemTitle>{info.label}</ItemTitle>
                                    {!info.implemented ? (
                                        <ItemDescription>
                                            Not connected yet
                                        </ItemDescription>
                                    ) : info.agent === "workbench" ? (
                                        <ItemDescription>
                                            Default for new dossiers; existing
                                            dossier choices are preserved.
                                        </ItemDescription>
                                    ) : null}
                                </ItemContent>
                                <ItemActions className="flex-wrap justify-end">
                                    {selected && info.implemented ? (
                                        <AdminModelStatusBadge
                                            model={selected}
                                        />
                                    ) : null}
                                    {edited ? (
                                        <AdminMarkBadge mark="edited" />
                                    ) : null}
                                    <Select
                                        value={selected?._id ?? null}
                                        disabled={saving || !options.length}
                                        items={options.map((m) => ({
                                            value: m._id,
                                            label: m.label,
                                        }))}
                                        onValueChange={(id) => {
                                            if (id) stage(info.agent, id);
                                        }}>
                                        <SelectTrigger
                                            className="min-w-48"
                                            aria-label={`${info.label} model`}>
                                            <SelectValue>
                                                {selected?.label ??
                                                    "Choose model"}
                                                {selected && !selected.enabled
                                                    ? " · unavailable"
                                                    : ""}
                                            </SelectValue>
                                        </SelectTrigger>
                                        <SelectContent
                                            alignItemWithTrigger={false}
                                            className="w-auto min-w-(--anchor-width)">
                                            {selected && !selected.enabled && (
                                                <SelectItem
                                                    value={selected._id}
                                                    disabled>
                                                    {selected.label} ·
                                                    unavailable
                                                </SelectItem>
                                            )}
                                            {options.map((m) => (
                                                <SelectItem
                                                    key={m._id}
                                                    value={m._id}>
                                                    {m.label}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </ItemActions>
                            </Item>
                        </Fragment>
                    );
                })}
            </ItemGroup>
            {changed ? (
                <div
                    role="status"
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-accent px-4 py-3">
                    <p className="text-sm">
                        {changed === 1
                            ? "1 agent has an unsaved model choice."
                            : `${changed} agents have unsaved model choices.`}
                    </p>
                    <div className="flex gap-2">
                        <Button
                            variant="outline"
                            disabled={saving}
                            onClick={() => {
                                setDrafts({});
                                setError(null);
                            }}>
                            Cancel
                        </Button>
                        <Button disabled={saving} onClick={() => void save()}>
                            <Icon iconNode={FloppyDiskIcon} />
                            {saving ? "Saving…" : "Save changes"}
                        </Button>
                    </div>
                </div>
            ) : null}
        </div>
    );
}
