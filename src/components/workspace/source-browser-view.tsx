import type { api } from "@convex/_generated/api";
import type { FunctionReturnType } from "convex/server";

import { BrowserView } from "@/components/ui/browser-view";

type SourceContext = FunctionReturnType<
    typeof api.sources.listForReviewPage
>["page"][number];

/** Maps a reviewed source record to the shared external browser destination. */
export function SourceBrowserView({ source }: { source: SourceContext }) {
    return (
        <BrowserView
            url={source.canonicalUrl}
            title={source.title}
            actionLabel="Open original"
        />
    );
}
