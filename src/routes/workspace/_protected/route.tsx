import { createFileRoute } from "@tanstack/react-router";

import { ProtectedWorkspaceRoute } from "@/components/workspace/protected-workspace-route";

export const Route = createFileRoute("/workspace/_protected")({
    component: ProtectedWorkspaceRoute,
});
