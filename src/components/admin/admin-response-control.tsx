import { api } from "@convex/_generated/api";
import { FloppyDiskIcon } from "@hugeicons/core-free-icons";
import { useMutation, useQuery } from "convex/react";
import type { FunctionArgs } from "convex/server";
import { useState } from "react";
import Icon from "@/components/icon";
import { LoadErrorBoundary } from "@/components/load-error-boundary";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";

/** Response coherence control: an optional check on final Workbench replies, with provisional thresholds. */
export function AdminResponseControl() {
    const [draft, setDraft] = useState<FunctionArgs<
        typeof api.modelConfiguration.setResponseControl
    > | null>(null);
    return (
        <Card>
            <CardContent>
                <LoadErrorBoundary
                    title="Coherence settings unavailable"
                    description="Your edits are preserved. Try loading the settings again.">
                    <ResponseControlSettingsForm
                        draft={draft}
                        onDraft={setDraft}
                    />
                </LoadErrorBoundary>
            </CardContent>
        </Card>
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
                className="space-y-4"
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
            aria-labelledby="coherence-title"
            className="space-y-4"
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
                        "Settings could not be saved, possibly because they changed elsewhere. Your edits are kept; cancel to see the current settings, or save again.",
                    );
                } finally {
                    setSaving(false);
                }
            }}>
            <div className="flex items-center justify-between gap-4">
                <h3 id="coherence-title" className="text-section">
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
            <div className="flex flex-wrap justify-end gap-2">
                <Button
                    type="button"
                    variant="outline"
                    disabled={saving || draft === null}
                    onClick={() => {
                        onDraft(null);
                        setError(null);
                    }}>
                    Cancel
                </Button>
                <Button type="submit" disabled={saving || draft === null}>
                    <Icon iconNode={FloppyDiskIcon} />
                    {saving ? "Saving…" : "Save changes"}
                </Button>
            </div>
        </form>
    );
}
