import { createFileRoute } from "@tanstack/react-router";

import { AdminPage } from "@/components/admin/admin-page";
import { adminSearch } from "@/lib/workspace/admin-navigation";

export const Route = createFileRoute("/workspace/_protected/admin")({
    validateSearch: adminSearch,
    component: AdminRoute,
});

function AdminRoute() {
    const search = Route.useSearch();
    const navigate = Route.useNavigate();
    return (
        <AdminPage
            search={search}
            onSearchChange={(next) =>
                void navigate({
                    search: next,
                    // Opening or closing a dossier stays in the section's history entry.
                    replace: next.section === search.section,
                    resetScroll: next.section !== search.section,
                })
            }
        />
    );
}
