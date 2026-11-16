import { api } from "@convex/_generated/api";
import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { useRef, useState } from "react";
import { LoadErrorBoundary } from "@/components/load-error-boundary";
import { Button } from "@/components/ui/button";
import {
    Empty,
    EmptyDescription,
    EmptyHeader,
    EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";

type Configuration = FunctionReturnType<typeof api.modelConfiguration.list>;
type CatalogModel = Configuration["models"][number];

/** Keeps the editable form above the query boundary so a failed subscription cannot erase it. */
export function AdminModels() {
    const prepare = useAction(api.modelConfigurationActions.prepare);
    const initialize = useAction(api.modelConfigurationActions.initialize);
    const [model, setModel] = useState("");
    const [label, setLabel] = useState("");
    const [editing, setEditing] = useState<CatalogModel | null>(null);
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const identity = useRef<{ signature: string; key: string } | null>(null);
    const prepareModel = async () => {
        if (pending) return;
        const signature = JSON.stringify({
            model,
            label,
            revision: editing?.revision,
        });
        if (identity.current?.signature !== signature)
            identity.current = { signature, key: crypto.randomUUID() };
        setPending(true);
        setError(null);
        try {
            const result = await prepare({
                model: model.trim(),
                label: label.trim(),
                requestKey: identity.current.key,
                ...(editing
                    ? {
                          catalogId: editing._id,
                          expectedRevision: editing.revision,
                      }
                    : {}),
            });
            if (!result.ready) {
                setError(
                    "The model could not be prepared. Review its identity, capabilities and cost limits, then try again.",
                );
                identity.current = null;
                return;
            }
            setModel("");
            setLabel("");
            setEditing(null);
            identity.current = null;
        } catch {
            setError(
                "Preparation could not be confirmed. Your entries are still available; review the catalogue before trying again.",
            );
        } finally {
            setPending(false);
        }
    };
    const initializeModels = async () => {
        setPending(true);
        setError(null);
        try {
            const result = await initialize({});
            if (!result.ready)
                setError(
                    "Default models could not be prepared. Review the catalogue and try again.",
                );
        } catch {
            setError(
                "Setup could not be confirmed. Review the catalogue before trying again.",
            );
        } finally {
            setPending(false);
        }
    };
    return (
        <div className="space-y-6">
            <header className="space-y-2">
                <h2 className="text-lg font-medium">Models</h2>
                <p className="text-sm text-muted-foreground">
                    Prepare OpenRouter models and control which choices analysts
                    can use. Preparation makes no inference calls and does not
                    enable paid work.
                </p>
            </header>
            <form
                className="space-y-4 rounded-xl border border-border p-4"
                onSubmit={(event) => {
                    event.preventDefault();
                    void prepareModel();
                }}>
                <h3 className="text-sm font-medium">
                    {editing ? "Edit model configuration" : "Add a model"}
                </h3>
                <div className="grid gap-4 lg:grid-cols-2">
                    <div className="space-y-2">
                        <Label htmlFor="catalog-model">
                            OpenRouter model ID
                        </Label>
                        <Input
                            id="catalog-model"
                            value={model}
                            onChange={(e) => setModel(e.target.value)}
                            required
                            maxLength={200}
                            disabled={pending || !!editing}
                            placeholder="z-ai/glm-5.3-flash"
                        />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="catalog-label">Display name</Label>
                        <Input
                            id="catalog-label"
                            value={label}
                            onChange={(e) => setLabel(e.target.value)}
                            required
                            maxLength={100}
                            disabled={pending}
                        />
                    </div>
                </div>
                {error && (
                    <p role="alert" className="text-sm text-destructive">
                        {error}
                    </p>
                )}
                <div className="flex flex-wrap gap-2">
                    <Button type="submit" disabled={pending}>
                        {pending ? "Preparing…" : "Prepare model"}
                    </Button>
                    {editing && (
                        <Button
                            type="button"
                            variant="ghost"
                            disabled={pending}
                            onClick={() => {
                                setEditing(null);
                                setModel("");
                                setLabel("");
                            }}>
                            Cancel edit
                        </Button>
                    )}
                </div>
            </form>
            <ResponseControlSettings />
            <LoadErrorBoundary
                title="Model catalogue unavailable"
                description="Your entries are preserved. Try loading the catalogue again.">
                <ModelCatalogue
                    pending={pending}
                    onInitialize={() => void initializeModels()}
                    onEdit={(entry) => {
                        setEditing(entry);
                        setModel(entry.model);
                        setLabel(entry.label);
                        setError(null);
                    }}
                />
            </LoadErrorBoundary>
        </div>
    );
}

function ModelCatalogue({
    pending,
    onInitialize,
    onEdit,
}: {
    pending: boolean;
    onInitialize: () => void;
    onEdit: (entry: CatalogModel) => void;
}) {
    const config = useQuery(api.modelConfiguration.list, {});
    const update = useMutation(api.modelConfiguration.updateAvailability);
    const setReasoning = useMutation(
        api.modelConfiguration.setReasoningPreference,
    );
    const refreshProfiles = useAction(
        api.modelConfigurationActions.refreshProfiles,
    );
    const [saving, setSaving] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    if (!config)
        return (
            <div
                role="status"
                className="space-y-3"
                aria-label="Loading model catalogue">
                {[1, 2].map((key) => (
                    <Skeleton key={key} className="h-28 w-full rounded-xl" />
                ))}
            </div>
        );
    if (!config.models.length)
        return (
            <Empty>
                <EmptyHeader>
                    <EmptyTitle>No models configured</EmptyTitle>
                    <EmptyDescription>
                        Set up GLM-5.3-Flash and DeepSeek V4.1 Flash 1017, or
                        add another supported model.
                    </EmptyDescription>
                </EmptyHeader>
                <Button disabled={pending} onClick={onInitialize}>
                    Set up default models
                </Button>
            </Empty>
        );
    const change = async (
        entry: CatalogModel,
        enabled: boolean,
        workbenchSelectable: boolean,
    ) => {
        if (saving) return;
        setSaving(entry._id);
        setError(null);
        try {
            await update({
                catalogId: entry._id,
                expectedRevision: entry.revision,
                enabled,
                workbenchSelectable,
                requestKey: crypto.randomUUID(),
            });
        } catch {
            setError(
                "The change could not be confirmed. Review the current setting before trying again.",
            );
        } finally {
            setSaving(null);
        }
    };
    const changeReasoning = async (
        entry: CatalogModel,
        preference: CatalogModel["reasoning"]["preference"],
    ) => {
        if (!preference || saving) return;
        setSaving(entry._id);
        setError(null);
        try {
            await setReasoning({
                catalogId: entry._id,
                expectedRevision: entry.revision,
                preference,
                requestKey: crypto.randomUUID(),
            });
        } catch {
            setError(
                "The reasoning setting could not be confirmed. Review the current setting before trying again.",
            );
        } finally {
            setSaving(null);
        }
    };
    /** Re-measures input profiles offline for every retained revision, following each page so older dossier pins are covered. */
    const refresh = async (entry: CatalogModel) => {
        if (saving) return;
        setSaving(entry._id);
        setError(null);
        try {
            let cursor: string | null = null;
            // Descending revision history ends after at most one page per revision, plus an empty terminal page.
            for (let page = 0; page <= entry.revision; page++) {
                const result: FunctionReturnType<
                    typeof api.modelConfigurationActions.refreshProfiles
                > = await refreshProfiles({ catalogId: entry._id, cursor });
                if (result.isDone) return;
                if (!result.continueCursor || result.continueCursor === cursor)
                    break;
                cursor = result.continueCursor;
            }
            throw new Error("Profile refresh did not complete");
        } catch {
            setError(
                "The input profiles could not be refreshed. The model stays unavailable to analysts; try again.",
            );
        } finally {
            setSaving(null);
        }
    };
    return (
        <div className="space-y-3">
            {error && (
                <p role="alert" className="text-sm text-destructive">
                    {error}
                </p>
            )}
            {config.models.map((entry) => (
                <section
                    key={entry._id}
                    className="space-y-4 rounded-xl border border-border p-4"
                    aria-label={entry.label}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 space-y-1">
                            <h3 className="font-medium">{entry.label}</h3>
                            <p className="break-all text-xs text-muted-foreground">
                                {entry.model}
                                {entry.provider
                                    ? ` · ${entry.provider} (fixed provider)`
                                    : " · OpenRouter routing"}
                            </p>
                            <p className="text-xs text-muted-foreground">
                                {entry.status === "ready"
                                    ? entry.compatible
                                        ? "Prepared · answer quality evaluated separately"
                                        : "The runtime changed since this model was prepared. Refresh its input profiles before analysts can use it."
                                    : entry.status === "preparing"
                                      ? "Preparing compatibility checks"
                                      : "Preparation failed · review configuration and prepare again"}
                            </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {entry.status === "ready" && !entry.compatible && (
                                <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={pending || !!saving}
                                    onClick={() => void refresh(entry)}>
                                    Refresh input profiles
                                </Button>
                            )}
                            <Button
                                size="sm"
                                variant="ghost"
                                disabled={pending || !!saving}
                                onClick={() => onEdit(entry)}>
                                Edit configuration
                            </Button>
                        </div>
                    </div>
                    {entry.currentRevisionId && (
                        <div className="max-w-sm space-y-2">
                            <Label>Reasoning</Label>
                            <Select
                                value={
                                    entry.reasoning.preference ?? "recommended"
                                }
                                disabled={
                                    pending ||
                                    !!saving ||
                                    entry.status === "preparing"
                                }
                                onValueChange={(value) => {
                                    const preference =
                                        value === "recommended"
                                            ? value
                                            : entry.reasoning.choices.find(
                                                  (choice) => choice === value,
                                              );
                                    if (preference)
                                        void changeReasoning(entry, preference);
                                }}>
                                <SelectTrigger
                                    aria-label={`Reasoning for ${entry.label}`}>
                                    <SelectValue>
                                        {entry.reasoning.preference ===
                                        "recommended"
                                            ? `Recommended · ${entry.reasoning.recommended ?? "provider default"}`
                                            : (entry.reasoning.preference ??
                                              "Provider default")}
                                    </SelectValue>
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="recommended">
                                        Recommended ·{" "}
                                        {entry.reasoning.recommended ??
                                            "provider default"}
                                    </SelectItem>
                                    {entry.reasoning.choices.map((choice) => (
                                        <SelectItem key={choice} value={choice}>
                                            {choice}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <p className="text-xs text-muted-foreground">
                                Current default:{" "}
                                {entry.reasoning.effective ??
                                    "provider default"}
                                . Existing dossiers and active work keep their
                                saved choice.
                            </p>
                        </div>
                    )}
                    <div className="flex flex-wrap gap-6">
                        <Label className="flex items-center gap-2">
                            <Switch
                                checked={entry.enabled}
                                disabled={
                                    pending || !!saving || !entry.compatible
                                }
                                onCheckedChange={(value) =>
                                    void change(
                                        entry,
                                        value,
                                        entry.workbenchSelectable,
                                    )
                                }
                                aria-label={`Enable ${entry.label}`}
                            />
                            Enabled
                        </Label>
                        <Label className="flex items-center gap-2">
                            <Switch
                                checked={entry.workbenchSelectable}
                                disabled={
                                    pending || !!saving || !entry.compatible
                                }
                                onCheckedChange={(value) =>
                                    void change(entry, entry.enabled, value)
                                }
                                aria-label={`Offer ${entry.label} in composer`}
                            />
                            Available in composer
                        </Label>
                    </div>
                </section>
            ))}
        </div>
    );
}

/** Per-agent assignments are persisted independently of an analyst's dossier choice. */
export function AdminAgentModels() {
    return (
        <div className="space-y-4">
            <header className="space-y-2">
                <h2 className="text-lg font-medium">Agent models</h2>
                <p className="text-sm text-muted-foreground">
                    Changes apply to following missions. Engaged work keeps its
                    recorded model.
                </p>
            </header>
            <LoadErrorBoundary
                title="Agent model settings unavailable"
                description="Try loading the settings again.">
                <AgentAssignments />
            </LoadErrorBoundary>
        </div>
    );
}
function AgentAssignments() {
    const config = useQuery(api.modelConfiguration.list, {});
    const assign = useMutation(api.modelConfiguration.assign);
    const [pending, setPending] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    if (!config)
        return (
            <Skeleton
                className="h-64 w-full rounded-xl"
                aria-label="Loading agent model settings"
            />
        );
    const change = async (
        agent: FunctionArgs<typeof api.modelConfiguration.assign>["agent"],
        id: CatalogModel["_id"],
    ) => {
        if (pending) return;
        const previous = config.assignments.find((a) => a.agent === agent);
        setPending(agent);
        setError(null);
        try {
            await assign({
                agent,
                catalogId: id,
                expectedRevision: previous?.revision ?? 0,
                requestKey: crypto.randomUUID(),
            });
        } catch {
            setError(
                "The assignment could not be confirmed. Review the current selection before trying again.",
            );
        } finally {
            setPending(null);
        }
    };
    return (
        <div className="space-y-3">
            {error && (
                <p role="alert" className="text-sm text-destructive">
                    {error}
                </p>
            )}
            {config.agents.map((info) => {
                const assignment = config.assignments.find(
                    (a) => a.agent === info.agent,
                );
                const selected = config.models.find(
                    (m) => m._id === assignment?.catalogId,
                );
                const options = config.models.filter(
                    (m) => m.enabled && m.compatible,
                );
                return (
                    <section
                        key={info.agent}
                        className="flex flex-col justify-between gap-4 rounded-xl border border-border p-4 sm:flex-row sm:items-center">
                        <div>
                            <h3 className="text-sm font-medium">
                                {info.label}
                            </h3>
                            {!info.implemented && (
                                <p className="mt-1 text-xs text-muted-foreground">
                                    Not connected yet
                                </p>
                            )}
                            {info.agent === "workbench" && (
                                <p className="mt-1 text-xs text-muted-foreground">
                                    Default for new dossiers; existing dossier
                                    choices are preserved.
                                </p>
                            )}
                        </div>
                        <Select
                            value={selected?._id ?? null}
                            disabled={!!pending || !options.length}
                            items={options.map((m) => ({
                                value: m._id,
                                label: m.label,
                            }))}
                            onValueChange={(id) => {
                                if (id) void change(info.agent, id);
                            }}>
                            <SelectTrigger aria-label={`${info.label} model`}>
                                <SelectValue>
                                    {selected?.label ?? "Choose model"}
                                    {selected && !selected.enabled
                                        ? " · unavailable"
                                        : ""}
                                </SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                                {selected && !selected.enabled && (
                                    <SelectItem value={selected._id} disabled>
                                        {selected.label} · unavailable
                                    </SelectItem>
                                )}
                                {options.map((m) => (
                                    <SelectItem key={m._id} value={m._id}>
                                        {m.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </section>
                );
            })}
        </div>
    );
}

function ResponseControlSettings() {
    const [draft, setDraft] = useState<FunctionArgs<
        typeof api.modelConfiguration.setResponseControl
    > | null>(null);
    return (
        <LoadErrorBoundary
            title="Coherence settings unavailable"
            description="Your edits are preserved. Try loading the settings again.">
            <ResponseControlSettingsForm draft={draft} onDraft={setDraft} />
        </LoadErrorBoundary>
    );
}
function ResponseControlSettingsForm({
    draft,
    onDraft,
}: {
    draft: FunctionArgs<
        typeof api.modelConfiguration.setResponseControl
    > | null;
    onDraft: (
        value: FunctionArgs<
            typeof api.modelConfiguration.setResponseControl
        > | null,
    ) => void;
}) {
    const config = useQuery(api.modelConfiguration.list, {});
    const save = useMutation(api.modelConfiguration.setResponseControl);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    if (!config)
        return (
            <div
                className="space-y-4 rounded-xl border border-border p-4"
                role="status"
                aria-label="Loading coherence settings">
                <div className="flex items-center justify-between gap-4">
                    <Skeleton className="h-4 w-48" />
                    <Skeleton className="h-5 w-8" />
                </div>
                <Skeleton className="h-10 w-full" />
                <div className="space-y-2">
                    <Skeleton className="h-4 w-28" />
                    <Skeleton className="h-9 w-full" />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                    {["contradiction", "support"].map((field) => (
                        <div key={field} className="space-y-2">
                            <Skeleton className="h-4 w-36" />
                            <Skeleton className="h-9 w-full" />
                        </div>
                    ))}
                </div>
                <Skeleton className="h-16 w-full" />
                <div className="flex gap-2">
                    <Skeleton className="h-9 w-40" />
                    <Skeleton className="h-9 w-40" />
                </div>
            </div>
        );
    const policy = config.responseControl;
    if (!policy) return null;
    const value = draft ?? {
        expectedRevision: policy.revision,
        enabled: policy.enabled,
        model: policy.model,
        contradictionThreshold: policy.contradictionThreshold,
        supportThreshold: policy.supportThreshold,
    };
    return (
        <form
            className="space-y-4 rounded-xl border border-border p-4"
            onSubmit={async (event) => {
                event.preventDefault();
                if (saving) return;
                setSaving(true);
                setError(null);
                try {
                    await save(value);
                    onDraft(null);
                } catch {
                    setError(
                        "Settings could not be saved. Your edits are preserved. Load the current settings before trying again.",
                    );
                } finally {
                    setSaving(false);
                }
            }}>
            <div className="flex items-center justify-between gap-4">
                <h3 className="text-sm font-medium">
                    Response coherence control
                </h3>
                <Switch
                    aria-label="Enable response coherence control"
                    checked={value.enabled}
                    disabled={saving}
                    onCheckedChange={(enabled) =>
                        onDraft({ ...value, enabled })
                    }
                />
            </div>
            <p className="text-sm text-muted-foreground">
                Check final Workbench replies after operations. At most one
                explanatory correction is requested. Status filters remain
                active when this control is disabled.
            </p>
            <div className="space-y-2">
                <Label htmlFor="coherence-model">Decision model</Label>
                <Input
                    id="coherence-model"
                    value={value.model}
                    onChange={(e) =>
                        onDraft({ ...value, model: e.target.value })
                    }
                    required
                    disabled={saving}
                />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                    <Label htmlFor="coherence-contradiction">
                        Contradiction threshold
                    </Label>
                    <Input
                        id="coherence-contradiction"
                        type="number"
                        min="0"
                        max="1"
                        step="any"
                        value={value.contradictionThreshold}
                        onChange={(e) =>
                            onDraft({
                                ...value,
                                contradictionThreshold: Number(e.target.value),
                            })
                        }
                        required
                        disabled={saving}
                    />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="coherence-support">Support threshold</Label>
                    <Input
                        id="coherence-support"
                        type="number"
                        min="0"
                        max="1"
                        step="any"
                        value={value.supportThreshold}
                        onChange={(e) =>
                            onDraft({
                                ...value,
                                supportThreshold: Number(e.target.value),
                            })
                        }
                        required
                        disabled={saving}
                    />
                </div>
            </div>
            <p className="text-sm text-muted-foreground">
                Thresholds must be greater than 0 and at most 1. They are
                provisional: the control estimates consistency with recorded
                actions, not general factual accuracy. Model availability and
                shared price limits are checked before inference.
            </p>
            {error && (
                <p role="alert" className="text-sm text-destructive">
                    {error}
                </p>
            )}
            <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={saving}>
                    {saving ? "Saving…" : "Save coherence settings"}
                </Button>
                <Button
                    type="button"
                    variant="outline"
                    disabled={saving}
                    onClick={() => {
                        onDraft(null);
                        setError(null);
                    }}>
                    Load current settings
                </Button>
            </div>
        </form>
    );
}
