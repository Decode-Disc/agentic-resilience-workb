import type { api } from "@convex/_generated/api";
import {
    Building02Icon,
    Cancel01Icon,
    ChevronDownIcon,
    Search01Icon,
} from "@hugeicons/core-free-icons";
import type { FunctionReturnType } from "convex/server";
import { type ReactNode, type Ref, useId } from "react";
import { CompanyFaviconAvatar } from "@/components/company-favicon-avatar";
import { ComposerSurface } from "@/components/composer/composer";
import Icon from "@/components/icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    InputGroup,
    InputGroupAddon,
    InputGroupInput,
} from "@/components/ui/input-group";
import { Skeleton } from "@/components/ui/skeleton";
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type PreflightResult = FunctionReturnType<
    typeof api.companyResolution.preflight
>;
type CompanyCandidate = FunctionReturnType<
    typeof api.companyResolution.search
>[number];

/** Controlled composer presentation; search, admission and launch remain with its consumer. */
export function ResearchComposerView({
    value,
    onValueChange,
    placeholder,
    companyAdornment,
    toolbar,
    id,
    textareaClassName,
    textareaRef,
}: {
    value: string;
    onValueChange: (value: string) => void;
    placeholder?: string;
    companyAdornment?: ReactNode;
    toolbar: ReactNode;
    id?: string;
    textareaClassName?: string;
    textareaRef?: Ref<HTMLTextAreaElement>;
}) {
    const generatedId = useId();
    const inputId = id ?? generatedId;
    return (
        <ComposerSurface
            expanded
            context={companyAdornment}
            footer={toolbar}
            input={
                <>
                    <label htmlFor={inputId} className="sr-only">
                        Research request — optional research angle
                    </label>
                    <textarea
                        ref={textareaRef}
                        id={inputId}
                        value={value}
                        onChange={(event) => onValueChange(event.target.value)}
                        placeholder={placeholder}
                        rows={3}
                        className={textareaClassName}
                    />
                </>
            }
        />
    );
}

export function CompanyLookup({
    companyQuery,
    isSearching,
    lookupError,
    hasResolution,
    hasSearched,
    resultCount,
    onCompanyQueryChange,
    onClear,
    onSearch,
    sessionReady,
}: {
    companyQuery: string;
    isSearching: boolean;
    lookupError: string | null;
    hasResolution: boolean;
    hasSearched: boolean;
    resultCount: number;
    onCompanyQueryChange: (next: string) => void;
    onClear: () => void;
    onSearch: () => void;
    sessionReady: boolean;
}) {
    return (
        <form
            aria-label="Company lookup"
            className="flex flex-col gap-2"
            onSubmit={(event) => {
                event.preventDefault();
                onSearch();
            }}>
            <InputGroup>
                <InputGroupAddon>
                    <Icon
                        iconNode={Search01Icon}
                        size={15}
                        className="text-muted-foreground"
                    />
                </InputGroupAddon>
                <InputGroupInput
                    value={companyQuery}
                    onChange={(event) =>
                        onCompanyQueryChange(event.target.value)
                    }
                    placeholder="Search company by Name, ticker, CIK, or SEC URL"
                    aria-label="Company search"
                    aria-invalid={Boolean(lookupError)}
                    autoComplete="off"
                />
            </InputGroup>
            <div className="flex items-center gap-2">
                <Button
                    type="submit"
                    variant="secondary"
                    size="sm"
                    disabled={isSearching || !sessionReady}
                    className="flex-1">
                    <Icon iconNode={Search01Icon} />
                    {isSearching
                        ? "Searching…"
                        : sessionReady
                          ? "Search"
                          : "Preparing workspace…"}
                </Button>
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={onClear}
                    disabled={!hasResolution && companyQuery.length === 0}>
                    <Icon iconNode={Cancel01Icon} />
                    Clear
                </Button>
            </div>
            {isSearching ? (
                <div
                    role="status"
                    aria-label="Searching companies"
                    aria-busy="true"
                    className="space-y-2 rounded-lg border border-border/60 p-3">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-1/2" />
                </div>
            ) : lookupError ? (
                <p role="alert" className="px-1 text-xs text-destructive">
                    {lookupError}
                </p>
            ) : hasSearched && resultCount === 0 ? (
                <p role="status" className="px-1 text-xs text-muted-foreground">
                    No matching companies.
                </p>
            ) : null}
        </form>
    );
}

export function CompanyCandidateLabel({
    company,
    selecting,
}: {
    company: CompanyCandidate;
    selecting: boolean;
}) {
    return (
        <span className="flex min-w-0 items-center gap-3 pr-2">
            <CompanyFaviconAvatar company={company} />
            <Tooltip>
                <TooltipTrigger
                    render={
                        <span className="min-w-0 flex-1">
                            <span className="block max-w-60 md:max-w-80 truncate font-medium text-foreground">
                                {company.legalName}
                            </span>
                            <span className="mt-0.5 block font-mono text-[10px] text-muted-foreground">
                                {company.ticker} · {company.exchange} · CIK{" "}
                                {company.cik}
                            </span>
                        </span>
                    }
                />
                <TooltipContent>
                    <p>{company.legalName}</p>
                </TooltipContent>
            </Tooltip>
            {selecting ? (
                <span className="shrink-0 text-xs text-muted-foreground">
                    Selecting…
                </span>
            ) : null}
        </span>
    );
}

export function CompanyPickerTrigger({
    label,
    ticker,
    highlighted,
}: {
    label: string;
    ticker?: string;
    highlighted: boolean;
}) {
    return (
        <Button
            type="button"
            variant="ghost"
            className={cn(
                "inline-flex h-9 w-full items-center gap-2 text-sm transition-colors",
                highlighted && "ring-2 ring-primary text-accent-foreground",
            )}>
            <Icon
                iconNode={Building02Icon}
                size={16}
                className="text-muted-foreground"
            />
            <span className="min-w-0 flex-1 truncate text-left font-medium">
                {label}
            </span>
            {ticker ? (
                <span className="font-mono text-[11px] text-muted-foreground">
                    {ticker}
                </span>
            ) : null}
            <Icon iconNode={ChevronDownIcon} size={14} />
        </Button>
    );
}

export function CompanyContextBadge({
    company,
    onRemove,
}: {
    company: Pick<PreflightResult["company"], "legalName" | "ticker">;
    onRemove: () => void;
}) {
    return (
        <div className="flex min-w-0">
            <Badge
                variant="outline"
                color="sky"
                showDot
                className="rounded-none pointer-events-auto inline-flex max-w-full items-center gap-1.5 px-1 text-xs shadow-sm backdrop-blur-sm">
                <span className="text-micro">Selected company:</span>
                <span className="max-w-60 truncate font-medium">
                    {company.legalName}
                </span>
                <span className="font-mono text-[10px] text-muted-foreground">
                    {company.ticker}
                </span>
                <button
                    type="button"
                    aria-label="Remove selected company"
                    onClick={onRemove}
                    className="ml-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground">
                    <Icon iconNode={Cancel01Icon} size={12} />
                </button>
            </Badge>
        </div>
    );
}
