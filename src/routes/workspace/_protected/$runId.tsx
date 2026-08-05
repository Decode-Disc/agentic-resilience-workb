import type { Id } from '@convex/_generated/dataModel';
import {
    createFileRoute,
    type ErrorComponentProps,
} from '@tanstack/react-router';

import { Button } from '@/components/ui/button';
import { RunRouteComponent } from '@/components/workspace/run-route-component';
import type { WorkspaceSection } from '@/components/workspace/workspace-navigation-rail';

const sections: ReadonlyArray<WorkspaceSection> = [
    'progress',
    'sources',
    'evidence',
    'assessment',
    'map',
    'brief',
];

export const Route = createFileRoute('/workspace/_protected/$runId')({
    validateSearch: (search: Record<string, unknown>) => ({
        section: sections.includes(search.section as WorkspaceSection)
            ? (search.section as WorkspaceSection)
            : ('progress' as const),
    }),
    component: RunRoute,
    errorComponent: RunError,
});

function RunRoute() {
    const { runId } = Route.useParams();
    const { section } = Route.useSearch();
    return (
        <RunRouteComponent
            runId={runId as Id<'researchRuns'>}
            section={section}
        />
    );
}

function RunError({ reset }: ErrorComponentProps) {
    return (
        <div
            role="alert"
            className="surface-panel bg-destructive/8 rounded-xl p-6"
        >
            <h1 className="text-lg font-medium text-destructive">
                Research workspace unavailable
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
                We couldn’t load this research dossier. Try again.
            </p>
            <Button type="button" className="mt-4" onClick={reset}>
                Try again
            </Button>
        </div>
    );
}
