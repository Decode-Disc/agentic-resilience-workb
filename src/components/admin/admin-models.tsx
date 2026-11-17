import { api } from "@convex/_generated/api";
import {
    Add01Icon,
    FloppyDiskIcon,
    InformationCircleIcon,
    PencilEdit02Icon,
    RefreshIcon,
} from "@hugeicons/core-free-icons";
import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Fragment, useRef, useState } from "react";
import { toast } from "sonner";
import { AdminModelStatusBadge } from "@/components/admin/admin-model-status-badge";
import { AdminScrollList } from "@/components/admin/admin-scroll-list";
import { AdminMarkBadge } from "@/components/admin/admin-status-badge";
import Icon from "@/components/icon";
import { LoadErrorBoundary } from "@/components/load-error-boundary";
import { Button } from "@/components/ui/button";
import {
    Card,
    CardAction,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
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
    EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { ItemGroup, ItemSeparator } from "@/components/ui/item";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { HelpTip } from "@/components/workbench-ui/help-tip";

import { reasoningEffortLabel } from "@/lib/presentation/model-choices";
import {
    MODEL_REFRESH_FAILURE_COPY,
    useRefreshModelProfiles,
} from "@/lib/workspace/use-refresh-model-profiles";

type CatalogModel = FunctionReturnType<
    typeof api.modelConfiguration.list
>["models"][number];

type Preference = NonNullable<CatalogModel["reasoning"]["preference"]>;
/** Unsaved row edits; a field appears only while it differs from the saved value. */
type ModelDraft = {
    preference?: Preference;
    enabled?: boolean;
    workbenchSelectable?: boolean;
};

// One column template for the catalogue header and its rows; below the large breakpoint rows stack.
const CATALOGUE_COLUMNS = "lg:grid-cols-[minmax(0,1fr)_8rem_12rem_13rem_14rem]";

/** The model catalogue: one card per model with its state, its next action and its analyst-facing settings. */
export function AdminModels() {
    const [editor, setEditor] = useState<
        { mode: "add" } | { mode: "edit"; model: CatalogModel } | null
    >(null);
    return (
        <Card>
            <CardHeader>
                <CardTitle>
                    <h3>Model catalogue</h3>
                </CardTitle>
                <CardDescription>
                    Analysts only see models that are ready, turned on and
                    offered in the composer. Edit the fields in a row, then save
                    your changes.
                </CardDescription>
                <CardAction>
                    <Button onClick={() => setEditor({ mode: "add" })}>
                        <Icon iconNode={Add01Icon} />
                        Add a model
                    </Button>
                </CardAction>
            </CardHeader>
            <CardContent>
                <LoadErrorBoundary
                    title="Model catalogue unavailable"
                    description="Try loading the catalogue again.">
                    <ModelCatalogue
                        onEdit={(model) => setEditor({ mode: "edit", model })}
                    />
                </LoadErrorBoundary>
            </CardContent>
            <ModelEditorDialog
                editor={editor}
                onClose={() => setEditor(null)}
            />
        </Card>
    );
}

function ModelEditorDialog({
    editor,
    onClose,
}: {
    editor: { mode: "add" } | { mode: "edit"; model: CatalogModel } | null;
    onClose: () => void;
}) {
    const prepare = useAction(api.modelConfigurationActions.prepare);
    const editing = editor?.mode === "edit" ? editor.model : null;
    const [model, setModel] = useState("");
    const [label, setLabel] = useState("");
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const identity = useRef<{ signature: string; key: string } | null>(null);
    const [opened, setOpened] = useState<typeof editor>(null);
    if (editor !== opened) {
        setOpened(editor);
        setModel(editing?.model ?? "");
        setLabel(editing?.label ?? "");
        setError(null);
        identity.current = null;
    }
    const submit = async () => {
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
                    "The model did not pass its check. Review its OpenRouter ID; it must support tools and stay within the price limits.",
                );
                identity.current = null;
                return;
            }
            toast.success(`${label.trim()} is saved and ready.`);
            onClose();
        } catch {
            setError(
                "The save could not be confirmed. Your entries are still here; review the catalogue before trying again.",
            );
        } finally {
            setPending(false);
        }
    };
    return (
        <Dialog
            open={editor !== null}
            onOpenChange={(open) => {
                if (!open && !pending) onClose();
            }}>
            <DialogContent>
                <form
                    className="space-y-4"
                    onSubmit={(event) => {
                        event.preventDefault();
                        void submit();
                    }}>
                    <DialogHeader>
                        <DialogTitle>
                            {editing ? `Edit ${editing.label}` : "Add a model"}
                        </DialogTitle>
                        <DialogDescription>
                            Saving checks the model with OpenRouter: its
                            capabilities, prices and limits. No model call is
                            made and paid work is not enabled.
                        </DialogDescription>
                    </DialogHeader>
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
                    {error && (
                        <p role="alert" className="text-sm text-destructive">
                            {error}
                        </p>
                    )}
                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            disabled={pending}
                            onClick={onClose}>
                            Cancel
                        </Button>
                        <Button type="submit" disabled={pending}>
                            {pending ? "Checking with OpenRouter…" : "Save"}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

function ModelCatalogue({ onEdit }: { onEdit: (model: CatalogModel) => void }) {
    const config = useQuery(api.modelConfiguration.list, {});
    const initialize = useAction(api.modelConfigurationActions.initialize);
    const update = useMutation(api.modelConfiguration.updateAvailability);
    const setReasoning = useMutation(
        api.modelConfiguration.setReasoningPreference,
    );
    const { refresh, refreshing, failed } = useRefreshModelProfiles();
    const [drafts, setDrafts] = useState<Record<string, ModelDraft>>({});
    const [saving, setSaving] = useState(false);
    const [initializing, setInitializing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    if (!config)
        return (
            <div
                role="status"
                aria-label="Loading model catalogue"
                className="grid gap-4 lg:grid-cols-2">
                {[1, 2].map((key) => (
                    <Skeleton key={key} className="h-56 w-full rounded-xl" />
                ))}
            </div>
        );
    if (!config.models.length)
        return (
            <Empty className="rounded-xl border border-dashed border-border">
                <EmptyHeader>
                    <EmptyTitle>No models configured</EmptyTitle>
                    <EmptyDescription>
                        Set up GLM-5.3-Flash and DeepSeek V4.1 Flash 1017, or
                        add another supported model.
                    </EmptyDescription>
                </EmptyHeader>
                {error && (
                    <p role="alert" className="text-sm text-destructive">
                        {error}
                    </p>
                )}
                <Button
                    disabled={initializing}
                    onClick={async () => {
                        setInitializing(true);
                        setError(null);
                        try {
                            const result = await initialize({});
                            if (!result.ready)
                                setError(
                                    "Default models could not be set up. Review the catalogue and try again.",
                                );
                        } catch {
                            setError(
                                "Setup could not be confirmed. Review the catalogue before trying again.",
                            );
                        } finally {
                            setInitializing(false);
                        }
                    }}>
                    {initializing ? "Setting up…" : "Set up default models"}
                </Button>
            </Empty>
        );
    const busy = saving;
    const current = (entry: CatalogModel) => ({
        preference: entry.reasoning.preference ?? "recommended",
        enabled: entry.enabled,
        workbenchSelectable: entry.workbenchSelectable,
    });
    const shown = (entry: CatalogModel) => ({
        ...current(entry),
        ...drafts[entry._id],
    });
    // A field returned to its saved value stops being a change.
    const stage = (entry: CatalogModel, patch: ModelDraft) =>
        setDrafts((previous) => {
            const saved = current(entry);
            const next: ModelDraft = { ...previous[entry._id], ...patch };
            for (const key of Object.keys(next) as (keyof ModelDraft)[])
                if (next[key] === saved[key]) delete next[key];
            const { [entry._id]: _, ...rest } = previous;
            return Object.keys(next).length
                ? { ...rest, [entry._id]: next }
                : rest;
        });
    const changed = Object.keys(drafts).length;
    const save = async () => {
        if (busy || !changed) return;
        setSaving(true);
        setError(null);
        let failed = 0;
        for (const [id, draft] of Object.entries(drafts)) {
            const entry = config.models.find((model) => model._id === id);
            if (!entry) continue;
            try {
                let revision = entry.revision;
                if (draft.preference !== undefined)
                    revision = (
                        await setReasoning({
                            catalogId: entry._id,
                            expectedRevision: revision,
                            preference: draft.preference,
                            requestKey: crypto.randomUUID(),
                        })
                    ).revision;
                if (
                    draft.enabled !== undefined ||
                    draft.workbenchSelectable !== undefined
                )
                    await update({
                        catalogId: entry._id,
                        expectedRevision: revision,
                        enabled: draft.enabled ?? entry.enabled,
                        workbenchSelectable:
                            draft.workbenchSelectable ??
                            entry.workbenchSelectable,
                        requestKey: crypto.randomUUID(),
                    });
                setDrafts(({ [id]: _, ...rest }) => rest);
            } catch {
                failed += 1;
            }
        }
        setSaving(false);
        if (failed)
            setError(
                "Some changes could not be saved, possibly because a model changed elsewhere. Your unsaved changes are kept; review them and save again.",
            );
        else toast.success("Model settings saved.");
    };
    return (
        <div className="space-y-3">
            {error && (
                <p role="alert" className="text-sm text-destructive">
                    {error}
                </p>
            )}
            <div
                className={`hidden gap-4 px-2 pb-2 text-xs font-medium text-muted-foreground lg:grid ${CATALOGUE_COLUMNS}`}>
                <span>Model</span>
                <ColumnHelp label="State">{STATE_HELP}</ColumnHelp>
                <ColumnHelp label="Reasoning">{REASONING_HELP}</ColumnHelp>
                <ColumnHelp label="Availability">
                    {AVAILABILITY_HELP}
                </ColumnHelp>
                <span />
            </div>
            <AdminScrollList label="Model catalogue">
                <ItemGroup>
                    {config.models.map((entry, index) => {
                        const updating = refreshing.has(entry._id);
                        const stale =
                            entry.status === "ready" && !entry.compatible;
                        const value = shown(entry);
                        const edited = entry._id in drafts;
                        return (
                            <Fragment key={entry._id}>
                                {index > 0 ? <ItemSeparator /> : null}
                                <section
                                    aria-label={entry.label}
                                    className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-3 px-2 py-3 ${CATALOGUE_COLUMNS}`}>
                                    <div className="min-w-0">
                                        <p className="truncate font-medium">
                                            {entry.label}
                                        </p>
                                        <p className="truncate text-xs text-muted-foreground">
                                            {entry.model}
                                            {entry.provider
                                                ? ` · ${entry.provider}`
                                                : " · OpenRouter"}
                                        </p>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-1.5">
                                        <AdminModelStatusBadge model={entry} />
                                        {edited ? (
                                            <AdminMarkBadge mark="edited" />
                                        ) : null}
                                    </div>
                                    <div className="col-span-2 lg:col-span-1">
                                        {entry.currentRevisionId ? (
                                            <ReasoningSelect
                                                entry={entry}
                                                preference={value.preference}
                                                disabled={
                                                    busy ||
                                                    updating ||
                                                    entry.status === "preparing"
                                                }
                                                onChange={(preference) =>
                                                    stage(entry, { preference })
                                                }
                                            />
                                        ) : (
                                            <span className="text-xs text-muted-foreground">
                                                Not checked yet
                                            </span>
                                        )}
                                    </div>
                                    <AvailabilitySelect
                                        entry={entry}
                                        enabled={value.enabled}
                                        workbenchSelectable={
                                            value.workbenchSelectable
                                        }
                                        disabled={
                                            busy ||
                                            updating ||
                                            !entry.compatible
                                        }
                                        onChange={(next) => stage(entry, next)}
                                    />
                                    <div className="col-span-2 flex flex-wrap justify-end gap-2 lg:col-span-1">
                                        {stale ||
                                        updating ||
                                        failed.has(entry._id) ? (
                                            <Tooltip>
                                                <TooltipTrigger
                                                    render={
                                                        <Button
                                                            size="sm"
                                                            variant={
                                                                entry.enabled
                                                                    ? "default"
                                                                    : "outline"
                                                            }
                                                            disabled={
                                                                busy || updating
                                                            }
                                                            onClick={async () => {
                                                                setError(null);
                                                                if (
                                                                    await refresh(
                                                                        entry,
                                                                    )
                                                                )
                                                                    toast.success(
                                                                        `${entry.label} is ready for analysts again.`,
                                                                    );
                                                                else
                                                                    setError(
                                                                        MODEL_REFRESH_FAILURE_COPY,
                                                                    );
                                                            }}>
                                                            <Icon
                                                                iconNode={
                                                                    RefreshIcon
                                                                }
                                                            />
                                                            {updating
                                                                ? "Updating…"
                                                                : "Update model"}
                                                        </Button>
                                                    }
                                                />
                                                <TooltipContent>
                                                    Re-measures this model for
                                                    the Workbench's current
                                                    tools. Offline, no model
                                                    call, no cost.
                                                </TooltipContent>
                                            </Tooltip>
                                        ) : null}
                                        {entry.status === "failed" ? (
                                            <Button
                                                size="sm"
                                                disabled={busy || updating}
                                                onClick={() => onEdit(entry)}>
                                                <Icon
                                                    iconNode={PencilEdit02Icon}
                                                />
                                                Check again
                                            </Button>
                                        ) : (
                                            <Tooltip>
                                                <TooltipTrigger
                                                    render={
                                                        <Button
                                                            size="icon-sm"
                                                            variant="outline"
                                                            aria-label="Edit configuration"
                                                            disabled={
                                                                busy || updating
                                                            }
                                                            onClick={() =>
                                                                onEdit(entry)
                                                            }>
                                                            <Icon
                                                                iconNode={
                                                                    PencilEdit02Icon
                                                                }
                                                            />
                                                        </Button>
                                                    }
                                                />
                                                <TooltipContent>
                                                    Edit the display name
                                                </TooltipContent>
                                            </Tooltip>
                                        )}
                                    </div>
                                </section>
                            </Fragment>
                        );
                    })}
                </ItemGroup>
            </AdminScrollList>
            {changed ? (
                <div
                    role="status"
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-accent px-4 py-3">
                    <p className="text-sm">
                        {changed === 1
                            ? "1 model has unsaved changes."
                            : `${changed} models have unsaved changes.`}
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

const STATE_HELP =
    "Whether the model has passed its check for the Workbench's current tools. Hover a state for what it means.";
const REASONING_HELP =
    "How much the model reasons before answering. Recommended follows the model's advised level. Dossiers already started keep their level.";
const AVAILABILITY_HELP =
    "Off: nothing new uses the model. Agents only: agents assigned to it can use it. Agents and chat menu: analysts can also pick it in the conversation's model menu.";

const AVAILABILITY_OPTIONS = [
    { value: "off", label: "Off" },
    { value: "agents", label: "Agents only" },
    { value: "everyone", label: "Agents and chat menu" },
] as const;
type Availability = (typeof AVAILABILITY_OPTIONS)[number]["value"];

/** One availability choice that sets both saved fields: usable by agents, and offered in the chat menu. */
function AvailabilitySelect({
    entry,
    enabled,
    workbenchSelectable,
    disabled,
    onChange,
}: {
    entry: CatalogModel;
    enabled: boolean;
    workbenchSelectable: boolean;
    disabled: boolean;
    onChange: (next: {
        enabled: boolean;
        workbenchSelectable: boolean;
    }) => void;
}) {
    const value: Availability = !enabled
        ? "off"
        : workbenchSelectable
          ? "everyone"
          : "agents";
    return (
        <Select
            value={value}
            disabled={disabled}
            items={AVAILABILITY_OPTIONS.map((option) => ({ ...option }))}
            onValueChange={(next) => {
                if (next === "off")
                    onChange({ enabled: false, workbenchSelectable: false });
                else if (next === "agents")
                    onChange({ enabled: true, workbenchSelectable: false });
                else if (next === "everyone")
                    onChange({ enabled: true, workbenchSelectable: true });
            }}>
            <SelectTrigger
                className="w-full"
                aria-label={`Availability of ${entry.label}`}>
                <SelectValue />
            </SelectTrigger>
            <SelectContent
                alignItemWithTrigger={false}
                className="w-auto min-w-(--anchor-width)">
                {AVAILABILITY_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                        {option.label}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}

/** A column heading with a short explanation that opens on hover, focus or tap. */
function ColumnHelp({ label, children }: { label: string; children: string }) {
    return (
        <span className="inline-flex items-center gap-1">
            {label}
            <HelpTip
                trigger={
                    <button
                        type="button"
                        aria-label={`About ${label}: ${children}`}
                        className="rounded-full text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
                        <Icon iconNode={InformationCircleIcon} size={14} />
                    </button>
                }>
                {children}
            </HelpTip>
        </span>
    );
}

/** Reasoning choice for one model; the list opens below the field, wide enough for its labels. */
function ReasoningSelect({
    entry,
    preference,
    disabled,
    onChange,
}: {
    entry: CatalogModel;
    /** The shown choice, which may be an unsaved draft. */
    preference: Preference;
    disabled: boolean;
    onChange: (preference: Preference) => void;
}) {
    const recommended = entry.reasoning.recommended
        ? reasoningEffortLabel(entry.reasoning.recommended)
        : "Provider default";
    return (
        <Select
            value={preference}
            disabled={disabled}
            onValueChange={(value) => {
                const next =
                    value === "recommended"
                        ? value
                        : entry.reasoning.choices.find(
                              (choice) => choice === value,
                          );
                if (next) onChange(next);
            }}>
            <SelectTrigger
                className="w-full"
                aria-label={`Reasoning for ${entry.label}`}>
                <SelectValue>
                    {preference !== "recommended"
                        ? reasoningEffortLabel(preference)
                        : entry.reasoning.preference === null
                          ? "Provider default"
                          : `Recommended · ${recommended}`}
                </SelectValue>
            </SelectTrigger>
            <SelectContent
                alignItemWithTrigger={false}
                className="w-auto min-w-(--anchor-width)">
                <SelectItem value="recommended">
                    Recommended · {recommended}
                </SelectItem>
                {entry.reasoning.choices.map((choice) => (
                    <SelectItem key={choice} value={choice}>
                        {reasoningEffortLabel(choice)}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}
