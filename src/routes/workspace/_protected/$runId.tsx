import type { Id } from "@convex/_generated/dataModel";
import {
    createFileRoute,
    type ErrorComponentProps,
    useRouter,
} from "@tanstack/react-router";

import { LoadErrorAlert } from "@/components/ui/load-error-alert";
import { RunRouteComponent } from "@/components/workspace/run-route-component";
import type { WorkspaceSection } from "@/components/workspace/workspace-navigation-rail";

const sections: ReadonlyArray<WorkspaceSection> = [
    "progress",
    "sources",
    "evidence",
    "assessment",
    "map",
    "brief",
];

export const Route = createFileRoute("/workspace/_protected/$runId")({
    validateSearch: (search: Record<string, unknown>) => ({
        section: sections.includes(search.section as WorkspaceSection)
            ? (search.section as WorkspaceSection)
            : ("progress" as const),
    }),
    component: RunRoute,
    errorComponent: RunError,
});

function RunRoute() {
    const { runId } = Route.useParams();
    const { section } = Route.useSearch();
    return (
        <RunRouteComponent
            runId={runId as Id<"researchRuns">}
            section={section}
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
