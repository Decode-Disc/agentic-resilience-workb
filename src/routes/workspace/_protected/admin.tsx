import { createFileRoute } from "@tanstack/react-router";

import { AdminPage } from "@/components/admin/admin-page";

export const Route = createFileRoute("/workspace/_protected/admin")({
    component: AdminPage,
});
