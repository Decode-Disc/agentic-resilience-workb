import { BuildingIcon } from "lucide-react";
import { FaviconAvatar } from "@/components/favicon-avatar";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import type { AvatarSize } from "@/types/ui";

/**
 * Minimal company shape needed to render a favicon. Accepts the projected
 * company objects returned by `api.companyResolution.*` and
 * `api.researchRuns.*` without forcing callers to reshape.
 */
export type CompanyFaviconSubject = {
    legalName: string;
    ticker: string;
    /** Marketing/customer website URL. Preferred signal for the favicon. */
    websiteUrl?: string;
    /**
     * Investor-relations URL (SEC `investorWebsite`). Used as a fallback when
     * no marketing website has been resolved yet, preserving the behavior of
     * call sites that previously rendered a favicon from this field directly.
     */
    investorRelationsUrl?: string;
};

/**
 * Renders a resolved company with an initials option for company selection. Owns the company→favicon
 * composition so call sites stop repeating `canonicalUrl`, `entityName`, and
 * `fallbackIcon` — the `BuildingIcon` fallback and the website/IR cascade
 * live here once.
 *
 * Resolution order: `websiteUrl` (marketing) → `investorRelationsUrl` (SEC IR)
 * → empty string (renders the building fallback).
 */
export function CompanyFaviconAvatar({
    company,
    size = "sm",
    appearance = "favicon",
}: {
    company: CompanyFaviconSubject;
    size?: AvatarSize;
    appearance?: "favicon" | "initials";
}) {
    if (appearance === "initials") {
        return (
            <Avatar
                size={size}
                aria-label={company.legalName}
                className="rounded-tile after:rounded-tile">
                <AvatarFallback className="rounded-tile bg-primary font-mono text-xs text-primary-foreground">
                    {company.ticker.slice(0, 4)}
                </AvatarFallback>
            </Avatar>
        );
    }
    const canonicalUrl =
        company.websiteUrl ?? company.investorRelationsUrl ?? "";
    return (
        <FaviconAvatar
            canonicalUrl={canonicalUrl}
            entityName={company.legalName}
            fallbackIcon={BuildingIcon}
            size={size}
        />
    );
}
