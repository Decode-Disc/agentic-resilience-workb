import { createFileRoute, Outlet, useParams } from "@tanstack/react-router";
import { WorkbenchShell } from "@/components/workbench-shell/workbench-shell";

export const Route = createFileRoute("/workspace")({
    component: RouteComponent,
});

function RouteComponent() {
    const { runId } = useParams({ strict: false });

    return (
        <WorkbenchShell activeRunId={runId}>
            <Outlet />
        </WorkbenchShell>
    );
}
