import type { Id } from "@convex/_generated/dataModel";
import { SOURCE_COVERAGE_ROLES } from "@convex/domain/sourceSelectionPolicy";
import {
    createFileRoute,
    type ErrorComponentProps,
    useRouter,
} from "@tanstack/react-router";

import { LoadErrorAlert } from "@/components/ui/load-error-alert";
import { RunRouteComponent } from "@/components/workspace/run-route-component";
import type { SourceReviewNavigation } from "@/components/workspace/source-proposal-review";
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
    validateSearch: (search: Record<string, unknown>) => {
        const section = sections.includes(search.section as WorkspaceSection)
            ? (search.section as WorkspaceSection)
            : ("progress" as const);
        const view: SourceReviewNavigation["view"] | undefined =
            section === "sources" &&
            (search.view === "inspect" || search.view === "adjust")
                ? search.view
                : undefined;
        const coverage =
            view === "inspect"
                ? SOURCE_COVERAGE_ROLES.find((role) => role === search.coverage)
                : undefined;
        return {
            section,
            ...(view ? { view } : {}),
            ...(coverage ? { coverage } : {}),
        };
    },
    component: RunRoute,
    errorComponent: RunError,
});

function RunRoute() {
    const { runId } = Route.useParams();
    const { section, view, coverage } = Route.useSearch();
    const navigate = Route.useNavigate();
    return (
        <RunRouteComponent
            runId={runId as Id<"researchRuns">}
            section={section}
            sourceReviewNavigation={{ view: view ?? "overview", coverage }}
            onSourceReviewNavigate={(destination) =>
                void navigate({
                    to: "/workspace/$runId",
                    params: { runId },
                    search: (previous) => ({
                        ...previous,
                        section: "sources",
                        view:
                            destination.view === "overview"
                                ? undefined
                                : destination.view,
                        coverage:
                            destination.view === "inspect"
                                ? destination.coverage
                                : undefined,
                    }),
                    resetScroll: false,
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
