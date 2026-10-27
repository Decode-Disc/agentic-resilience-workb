import { CheckmarkCircle02Icon } from "@hugeicons/core-free-icons";

import Icon from "@/components/icon";
import { Badge } from "@/components/ui/badge";
import { sourceInclusionLabel } from "@/lib/presentation/research-copy";
import { cn } from "@/lib/utils";

/** Membership is independent of reading, qualification and analyst approval. */
export function SourceInclusionBadge({
    included,
    className,
}: {
    included: boolean | undefined;
    className?: string;
}) {
    return (
        <Badge
            variant="outline"
            className={cn(
                included
                    ? "bg-tint-ink text-foreground"
                    : "bg-tint-unknown text-muted-foreground",
                className,
            )}>
            {included ? (
                <Icon iconNode={CheckmarkCircle02Icon} size={14} />
            ) : null}
            {sourceInclusionLabel(included ?? false)}
        </Badge>
    );
}
