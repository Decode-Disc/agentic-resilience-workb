import { createFileRoute } from "@tanstack/react-router";

import { OperationsPage } from "@/components/admin/operations-page";

export const Route = createFileRoute("/workspace/_protected/admin")({
    component: OperationsPage,
});
