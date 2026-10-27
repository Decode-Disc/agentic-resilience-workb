import type { SourceFamily } from "@convex/domain/sourceSelectionPolicy";
import type { ComponentProps } from "react";
import { Badge } from "@/components/ui/badge";
import { sourceDocumentKindLabel } from "@/lib/presentation/research-copy";
import { cn } from "@/lib/utils";

export type ExtendedSourceFamily =
    | SourceFamily
    | "unrecognized"
    | "analyst_supplied"
    | (string & {});

function humanizeFamily(family: string): string {
    const text = family.replaceAll("_", " ");
    return `${text.charAt(0).toLocaleUpperCase("en")}${text.slice(1)}`;
}

/** Presents document kind as neutral metadata, independently of source-family and decision colors. */
export function SourceDocumentKindBadge({
    kind,
    className,
}: {
    kind: Parameters<typeof sourceDocumentKindLabel>[0];
    className?: string;
}) {
    return (
        <Badge
            variant="outline"
            className={cn(
                "border-border bg-muted/40 font-normal text-muted-foreground",
                "max-w-full whitespace-normal text-left leading-snug",
                className,
            )}>
            {sourceDocumentKindLabel(kind)}
        </Badge>
    );
}

export function SourceFamilyBadge({
    family,
    variant = "outline",
    showDot = false,
    className,
}: {
    family: ExtendedSourceFamily;
    variant?: ComponentProps<typeof Badge>["variant"];
    showDot?: boolean;
    className?: string;
}) {
    return (
        <Badge
            variant={variant}
            showDot={showDot}
            tone="ink"
            className={className}>
            {humanizeFamily(family)}
        </Badge>
    );
}
