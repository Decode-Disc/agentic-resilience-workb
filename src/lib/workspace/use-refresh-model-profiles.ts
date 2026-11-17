import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useAction } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useRef, useState } from "react";

export const MODEL_REFRESH_FAILURE_COPY =
    "The update did not finish. Try again to update all saved configurations.";

/**
 * Re-measures a model's input profiles offline for every retained revision, following each page so
 * older dossier pins are covered. Resolves to whether the refresh completed; the caller shows the failure.
 */
export function useRefreshModelProfiles() {
    const refreshProfiles = useAction(
        api.modelConfigurationActions.refreshProfiles,
    );
    const inFlight = useRef(new Set<Id<"modelCatalog">>());
    const [refreshing, setRefreshing] = useState<
        ReadonlySet<Id<"modelCatalog">>
    >(new Set());
    const [failed, setFailed] = useState<ReadonlySet<Id<"modelCatalog">>>(
        new Set(),
    );
    const refresh = async (model: {
        _id: Id<"modelCatalog">;
        revision: number;
    }): Promise<boolean> => {
        if (inFlight.current.has(model._id)) return false;
        inFlight.current.add(model._id);
        setRefreshing(new Set(inFlight.current));
        setFailed((previous) => {
            const next = new Set(previous);
            next.delete(model._id);
            return next;
        });
        let completed = false;
        try {
            let cursor: string | null = null;
            // Descending revision history ends after at most one page per revision, plus an empty terminal page.
            for (let page = 0; page <= model.revision; page++) {
                const result: FunctionReturnType<
                    typeof api.modelConfigurationActions.refreshProfiles
                > = await refreshProfiles({ catalogId: model._id, cursor });
                if (result.isDone) {
                    completed = true;
                    return true;
                }
                if (!result.continueCursor || result.continueCursor === cursor)
                    return false;
                cursor = result.continueCursor;
            }
            return false;
        } catch {
            return false;
        } finally {
            if (!completed)
                setFailed((previous) => new Set([...previous, model._id]));
            inFlight.current.delete(model._id);
            setRefreshing(new Set(inFlight.current));
        }
    };
    return { refresh, refreshing, failed };
}
