import { api } from "@convex/_generated/api";
import { WORKSPACE_DOSSIER_INITIAL_PAGE_SIZE } from "@convex/resourcePolicy";
import { usePaginatedQuery, useQuery } from "convex/react";

/** Resets dossier pagination when admission or the server-owned workspace changes. */
export function useWorkspaceDossiers(enabled = true, search = "") {
    const visitor = useQuery(api.visitors.current, enabled ? {} : "skip");
    const workspace = visitor?.workspace;
    const page = usePaginatedQuery(
        api.researchRuns.listMine,
        enabled && workspace
            ? { workspaceKey: workspace.key, ...(search ? { search } : {}) }
            : "skip",
        { initialNumItems: WORKSPACE_DOSSIER_INITIAL_PAGE_SIZE },
    );
    return {
        ...page,
        workspace,
        isLoading:
            enabled &&
            (visitor === undefined || page.status === "LoadingFirstPage"),
    };
}
