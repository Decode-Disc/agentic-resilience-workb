import { api } from "@convex/_generated/api";
import { useQuery } from "convex/react";
import { AdminAgentModels } from "@/components/admin/admin-agent-models";
import { AdminModels } from "@/components/admin/admin-models";
import { AdminResponseControl } from "@/components/admin/admin-response-control";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMediaQuery } from "@/hooks/use-responsive";
import {
    ADMIN_VIEWS,
    type AdminSearch,
    type AdminView,
} from "@/lib/workspace/admin-navigation";

/** Models & agents: a rail of its three views with live counts beside the active one. */
export function AdminModelsSection({
    view,
    onNavigate,
}: {
    view: AdminView<"models">;
    onNavigate: (search: AdminSearch) => void;
}) {
    const wide = useMediaQuery("(min-width: 64rem)");
    const config = useQuery(api.modelConfiguration.list, {});
    const stale =
        config?.models.filter(
            (model) => model.status === "ready" && !model.compatible,
        ).length ?? 0;
    const counts: Record<AdminView<"models">, string | null> = {
        agents: config ? String(config.agents.length) : null,
        catalogue: config
            ? stale
                ? `${stale} to refresh`
                : String(config.models.length)
            : null,
        coherence: config?.responseControl
            ? config.responseControl.enabled
                ? "On"
                : "Off"
            : null,
    };
    return (
        <Tabs
            value={view}
            orientation={wide ? "vertical" : "horizontal"}
            onValueChange={(value) => {
                const next = ADMIN_VIEWS.models.find(
                    (entry) => entry.value === value,
                )?.value;
                if (next)
                    onNavigate(
                        next === "agents"
                            ? { section: "models" }
                            : { section: "models", view: next },
                    );
            }}
            className="gap-4 lg:flex-row lg:items-start lg:gap-6">
            <TabsList
                aria-label="Models & agents views"
                className="max-w-full shrink-0 justify-start overflow-x-auto lg:w-60 lg:items-stretch">
                {ADMIN_VIEWS.models.map((entry) => (
                    <TabsTrigger
                        key={entry.value}
                        value={entry.value}
                        className="justify-between gap-3">
                        <span>{entry.label}</span>
                        {counts[entry.value] ? (
                            <span className="text-xs text-muted-foreground tabular-nums">
                                {counts[entry.value]}
                            </span>
                        ) : null}
                    </TabsTrigger>
                ))}
            </TabsList>
            <div className="min-w-0 flex-1">
                <TabsContent value="agents">
                    <AdminAgentModels />
                </TabsContent>
                <TabsContent value="catalogue">
                    <AdminModels />
                </TabsContent>
                <TabsContent value="coherence">
                    <AdminResponseControl />
                </TabsContent>
            </div>
        </Tabs>
    );
}
