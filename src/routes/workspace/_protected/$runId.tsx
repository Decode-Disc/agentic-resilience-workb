import type { Id } from "@convex/_generated/dataModel";
import {
    createFileRoute,
    type ErrorComponentProps,
    useRouter,
} from "@tanstack/react-router";
import { useRef } from "react";

import { LoadErrorAlert } from "@/components/ui/load-error-alert";
import { RunRouteComponent } from "@/components/workspace/run-route-component";
import { workspaceSearch } from "@/lib/workspace/navigation";

export const Route = createFileRoute("/workspace/_protected/$runId")({
    validateSearch: workspaceSearch,
    component: RunRoute,
    errorComponent: RunError,
});

function RunRoute() {
    const { runId } = Route.useParams();
    const {
        section,
        subsection,
        inventory,
        detail,
        sourcesView,
        source,
        q,
        kind,
        reading,
        use,
    } = Route.useSearch();
    const navigate = Route.useNavigate();
    const router = useRouter();
    const inventoryOriginIndex = useRef<number | null>(null);
    return (
        <RunRouteComponent
            runId={runId as Id<"researchRuns">}
            section={section}
            detail={detail}
            subsection={subsection}
            inventoryOpen={inventory === 1}
            onInventoryOpenChange={(open) => {
                if (
                    !open &&
                    inventoryOriginIndex.current !== null &&
                    router.history.location.state.__TSR_index ===
                        inventoryOriginIndex.current + 1
                ) {
                    inventoryOriginIndex.current = null;
                    router.history.back();
                    return;
                }
                inventoryOriginIndex.current = open
                    ? router.history.location.state.__TSR_index
                    : null;
                void navigate({
                    search: (previous) => ({
                        ...previous,
                        inventory: open ? 1 : undefined,
                    }),
                    replace: !open,
                    resetScroll: false,
                });
            }}
            sourcesSearch={{ sourcesView, source, q, kind, reading, use }}
            onSourcesSearchChange={(patch, replace) =>
                void navigate({
                    search: (previous) => ({ ...previous, ...patch }),
                    replace,
                    resetScroll: !replace,
                })
            }
        />
    );
}

function RunError(_props: ErrorComponentProps) {
    const router = useRouter();

    return (
        <LoadErrorAlert
            title="Research workspace unavailable"
            description="We couldn’t load this research dossier. Try again."
            className="bg-destructive/8"
            onRetry={() => void router.invalidate()}
        />
    );
}
