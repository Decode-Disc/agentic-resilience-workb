import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useAction } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";

export const MODEL_REFRESH_FAILURE_COPY =
    "The model could not be updated. It stays unavailable to analysts; try again.";

/**
 * Re-measures a model's input profiles offline for every retained revision, following each page so
 * older dossier pins are covered. Resolves to whether the refresh completed; the caller shows the failure.
 */
export function useRefreshModelProfiles() {
    const refreshProfiles = useAction(
        api.modelConfigurationActions.refreshProfiles,
    );
    const [refreshing, setRefreshing] = useState<Id<"modelCatalog"> | null>(
        null,
    );
    const refresh = async (model: {
        _id: Id<"modelCatalog">;
        revision: number;
    }): Promise<boolean> => {
        if (refreshing) return false;
        setRefreshing(model._id);
        try {
            let cursor: string | null = null;
            // Descending revision history ends after at most one page per revision, plus an empty terminal page.
            for (let page = 0; page <= model.revision; page++) {
                const result: FunctionReturnType<
                    typeof api.modelConfigurationActions.refreshProfiles
                > = await refreshProfiles({ catalogId: model._id, cursor });
                if (result.isDone) return true;
                if (!result.continueCursor || result.continueCursor === cursor)
                    return false;
                cursor = result.continueCursor;
            }
            return false;
        } catch {
            return false;
        } finally {
            setRefreshing(null);
        }
    };
    return { refresh, refreshing };
}
