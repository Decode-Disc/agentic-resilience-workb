import type { api } from "@convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { Badge } from "@/components/ui/badge";
import { HelpTip } from "@/components/workbench-ui/help-tip";
import { adminModelStatus } from "@/lib/presentation/admin";

type CatalogModel = FunctionReturnType<
    typeof api.modelConfiguration.list
>["models"][number];

/** A model's state that explains itself on hover, focus or tap; the same badge on every admin surface. */
export function AdminModelStatusBadge({ model }: { model: CatalogModel }) {
    const status = adminModelStatus(model);
    return (
        <HelpTip
            trigger={
                <button
                    type="button"
                    aria-label={`${status.label}: ${status.explanation}`}
                    className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <Badge tone={status.tone} className="w-fit cursor-help">
                        {status.label}
                    </Badge>
                </button>
            }>
            {status.explanation}
        </HelpTip>
    );
}
