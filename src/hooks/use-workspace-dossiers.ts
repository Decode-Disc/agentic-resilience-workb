import { api } from "@convex/_generated/api";
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
        { initialNumItems: 12 },
    );
    return {
        ...page,
        workspace,
        isLoading:
            enabled &&
            (visitor === undefined || page.status === "LoadingFirstPage"),
    };
}
