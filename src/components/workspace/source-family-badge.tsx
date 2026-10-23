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

type FamilyMeta = {
    label: string;
    className: string;
};

const FAMILY_CONFIG: Record<string, FamilyMeta> = {
    regulatory: {
        label: "Regulatory",
        className:
            "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:border-sky-400/30 dark:bg-sky-400/10 dark:text-sky-300 hover:bg-sky-500/20",
    },
    investor_relations: {
        label: "Investor relations",
        className:
            "border-indigo-500/40 bg-indigo-500/10 text-indigo-700 dark:border-indigo-400/30 dark:bg-indigo-400/10 dark:text-indigo-300 hover:bg-indigo-500/20",
    },
    official_product: {
        label: "Official product",
        className:
            "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-300 hover:bg-emerald-500/20",
    },
    official_commercial: {
        label: "Official commercial",
        className:
            "border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-700 dark:border-fuchsia-400/30 dark:bg-fuchsia-400/10 dark:text-fuchsia-300 hover:bg-fuchsia-500/20",
    },
    official_security: {
        label: "Official security",
        className:
            "border-cyan-500/40 bg-cyan-500/10 text-cyan-700 dark:border-cyan-400/30 dark:bg-cyan-400/10 dark:text-cyan-300 hover:bg-cyan-500/20",
    },
    independent_analysis: {
        label: "Independent analysis",
        className:
            "border-purple-500/40 bg-purple-500/10 text-purple-700 dark:border-purple-400/30 dark:bg-purple-400/10 dark:text-purple-300 hover:bg-purple-500/20",
    },
    counter_evidence: {
        label: "Counter evidence",
        className:
            "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:border-rose-400/30 dark:bg-rose-400/10 dark:text-rose-300 hover:bg-rose-500/20",
    },
    unrecognized: {
        label: "Unrecognized",
        className:
            "border-orange-500/40 bg-orange-500/10 text-orange-700 dark:border-orange-400/30 dark:bg-orange-400/10 dark:text-orange-300 hover:bg-orange-500/20",
    },
    analyst_supplied: {
        label: "Analyst supplied",
        className:
            "border-slate-500/40 bg-slate-500/10 text-slate-700 dark:border-slate-400/30 dark:bg-slate-400/10 dark:text-slate-300 hover:bg-slate-500/20",
    },
};

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
    const config = FAMILY_CONFIG[family] ?? {
        label: humanizeFamily(family),
        className: "border-border bg-accent/50 text-foreground",
    };

    return (
        <Badge
            variant={variant}
            showDot={showDot}
            className={cn(config.className, className)}>
            {config.label}
        </Badge>
    );
}
