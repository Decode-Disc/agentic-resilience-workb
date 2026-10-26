import { CheckmarkCircle02Icon } from "@hugeicons/core-free-icons";

import Icon from "@/components/icon";
import { Badge } from "@/components/ui/badge";
import { sourceInclusionLabel } from "@/lib/presentation/research-copy";
import { cn } from "@/lib/utils";

/**
 * Corpus membership is presented from the approval vocabulary: "Included"
 * carries the teal approval treatment and "Not included" stays a quiet
 * neutral state. Badges are non-interactive metadata — they carry no hover
 * of their own; an interactive container owns its own hover.
 */
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
                    ? "border-approved/25 bg-approved/10 text-approved"
                    : "border-border/60 bg-muted/30 text-muted-foreground",
                className,
            )}>
            {included ? (
                <Icon iconNode={CheckmarkCircle02Icon} size={14} />
            ) : null}
            {sourceInclusionLabel(included ?? false)}
        </Badge>
    );
}
