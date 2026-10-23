import type { api } from "@convex/_generated/api";
import {
    ArrowDown01Icon,
    ArrowRight01Icon,
    File01Icon,
    InformationCircleIcon,
    Search01Icon,
} from "@hugeicons/core-free-icons";
import PlusIcon from "@hugeicons/core-free-icons/PlusIcon";
import TriangleDashedIcon from "@hugeicons/core-free-icons/TriangleDashedIcon";
import type { FunctionReturnType } from "convex/server";
import {
    type ReactNode,
    type Ref,
    useEffect,
    useId,
    useRef,
    useState,
} from "react";
import Icon from "@/components/icon";
import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ResponsivePopover } from "@/components/ui/responsive-popover";
import { SourceSearchFeedback } from "@/components/workspace/source-search-feedback";
import { useMediaQuery } from "@/hooks/use-responsive";
import {
    type SourceRecoveryState,
    sourceCoverageCopy,
    sourceCoverageRoleLabel,
    sourceCoverageSearchState,
    sourceCoverageStatusHelp,
    sourceCoverageSummary,
    type sourceRecoveryFeedback,
} from "@/lib/presentation/research-copy";
import { cn } from "@/lib/utils";
import type { PlatformIcon } from "@/types/ui";

type Requirement = NonNullable<
    FunctionReturnType<typeof api.sourceSelectionProposals.getCurrent>
>["coverageRequirements"][number];
type CoverageRole = Requirement["role"];
type Availability = ReturnType<typeof sourceCoverageCopy>["availability"];

const limitedIcon = [
    [
        "circle",
        {
            cx: 12,
            cy: 12,
            r: 9,
            stroke: "currentColor",
            strokeWidth: 1.5,
            key: "outline",
        },
    ],
    ["path", { d: "M12 3a9 9 0 0 1 0 18Z", fill: "currentColor", key: "half" }],
] as const;
const coverageAppearance: Record<
    Availability,
    {
        icon: PlatformIcon;
        foreground: string;
        iconForeground?: string;
        background: string;
        glossary?: string;
    }
> = {
    not_assessed: {
        icon: TriangleDashedIcon,
        foreground: "text-muted-foreground",
        background: "bg-muted/40",
    },
    available: {
        icon: File01Icon,
        foreground: "text-success-foreground dark:text-success",
        iconForeground: "text-success",
        background: "bg-success/10",
    },
    limited: {
        icon: limitedIcon,
        foreground: "text-warning-foreground dark:text-warning",
        iconForeground: "text-warning",
        background: "bg-warning/10",
    },
    not_established: {
        icon: TriangleDashedIcon,
        foreground: "text-muted-foreground",
        background: "bg-muted/50",
        glossary: "text-foreground",
    },
};
const triggerClassName =
    "flex h-auto min-h-14 w-full min-w-0 items-start justify-start gap-3 rounded-lg border-0 px-3 py-2.5 text-left font-normal whitespace-normal transition-colors hover:bg-muted/35 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none";

function CoverageHelp() {
    return (
        <ResponsivePopover
            title="What coverage tells you"
            description="Contextual help for reading documentary coverage."
            closeLabel="Close coverage help"
            side="right"
            trigger={
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="What coverage tells you"
                    className="shrink-0 p-0! text-muted-foreground">
                    <Icon iconNode={InformationCircleIcon} />
                </Button>
            }>
            <dl className="space-y-4 text-sm leading-relaxed">
                {(Object.keys(sourceCoverageStatusHelp) as Availability[]).map(
                    (status) => {
                        const copy = sourceCoverageStatusHelp[status];
                        const appearance = coverageAppearance[status];
                        return (
                            <div key={status}>
                                <dt
                                    className={cn(
                                        "font-medium",
                                        appearance.foreground,
                                        appearance.glossary,
                                    )}>
                                    {copy.label}
                                </dt>
                                <dd className="mt-1 text-muted-foreground">
                                    {copy.description}
                                </dd>
                            </div>
                        );
                    },
                )}
            </dl>
        </ResponsivePopover>
    );
}

/** Owns the responsive Coverage container, independently of its navigation or disclosure contents. */
function CoverageContainer({
    requirements,
    children,
    scrollRef,
    className,
}: {
    requirements: ReadonlyArray<Requirement>;
    children: ReactNode;
    scrollRef?: Ref<HTMLDivElement>;
    className?: string;
}) {
    const [mobileOpen, setMobileOpen] = useState(false);
    const narrow = useMediaQuery("(width < 80rem)");
    const summaryId = useId();
    return (
        <Collapsible
            render={<aside />}
            open={!narrow || mobileOpen}
            onOpenChange={setMobileOpen}
            aria-label="Source coverage"
            className={cn(
                "surface-panel w-full min-w-0 self-start overflow-hidden rounded-xl border border-border/60 xl:sticky xl:top-20 xl:w-76",
                className,
            )}>
            <header className="border-b border-border/60 px-4 py-2">
                <div className="flex min-h-11 items-center gap-2">
                    <div className="flex items-center">
                        <h2 className="text-sm font-medium">Coverage</h2>
                        <CoverageHelp />
                    </div>
                    <CollapsibleTrigger
                        type="button"
                        aria-label="Coverage"
                        aria-describedby={summaryId}
                        className="ml-auto flex size-11 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring xl:hidden">
                        <Icon
                            iconNode={ArrowDown01Icon}
                            className={cn(mobileOpen && "rotate-180")}
                        />
                    </CollapsibleTrigger>
                </div>
                <p
                    id={summaryId}
                    className="pb-2 text-xs leading-relaxed text-muted-foreground">
                    {sourceCoverageSummary(requirements)}
                </p>
            </header>
            <CollapsibleContent keepMounted>
                <div
                    ref={scrollRef}
                    className="min-w-0 max-h-[min(42rem,70dvh)] overflow-x-hidden overflow-y-auto p-2 [scrollbar-width:thin]">
                    {children}
                </div>
            </CollapsibleContent>
        </Collapsible>
    );
}

function CoverageTopicSummary({
    requirement,
    labelId,
    children,
}: {
    requirement: Requirement;
    labelId?: string;
    children?: ReactNode;
}) {
    const copy = sourceCoverageCopy(requirement);
    const appearance = coverageAppearance[copy.availability];
    return (
        <>
            <span
                className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-md",
                    appearance.iconForeground ?? appearance.foreground,
                    appearance.background,
                )}>
                <Icon iconNode={appearance.icon} size={21} />
            </span>
            <span className="min-w-0 flex-1 space-y-1 break-words">
                <span
                    id={labelId}
                    className="block text-sm font-medium leading-snug">
                    {sourceCoverageRoleLabel(requirement.role)}
                </span>
                <span
                    className={cn(
                        "block text-xs leading-relaxed",
                        appearance.foreground,
                    )}>
                    {copy.label}
                </span>
                {children}
            </span>
        </>
    );
}

/** Compact inspection navigation has no inline disclosure or source-search actions. */
export function SourceCoverageNavigation({
    requirements,
    selectedRole,
    onReview,
}: {
    requirements: ReadonlyArray<Requirement>;
    selectedRole?: CoverageRole;
    onReview: (role: CoverageRole) => void;
}) {
    return (
        <CoverageContainer requirements={requirements} className="xl:w-64">
            <ul className="space-y-1">
                {requirements.map((requirement) => {
                    const selected = selectedRole === requirement.role;
                    return (
                        <li
                            key={requirement.role}
                            className={cn(
                                "rounded-lg border border-transparent",
                                selected &&
                                    "border-source-selection-accent/50 bg-source-selection-accent/4",
                            )}>
                            <Button
                                type="button"
                                variant="ghost"
                                aria-label={`Review coverage: ${sourceCoverageRoleLabel(requirement.role)}`}
                                aria-current={selected ? "true" : undefined}
                                onClick={() => onReview(requirement.role)}
                                className={triggerClassName}>
                                <CoverageTopicSummary
                                    requirement={requirement}
                                />
                                <Icon
                                    iconNode={ArrowRight01Icon}
                                    className="mt-1 shrink-0 text-muted-foreground"
                                />
                            </Button>
                        </li>
                    );
                })}
            </ul>
        </CoverageContainer>
    );
}

/** Overview topics own their accordion, explanations and source-review actions. */
export function SourceCoverageRail({
    requirements,
    readOnly = false,
    onReview,
    onSearch,
    onAddSource,
    searchDisabled = false,
    isSearching = false,
    recovery,
    allowanceFeedback,
}: {
    requirements: ReadonlyArray<Requirement>;
    readOnly?: boolean;
    onReview: (role: CoverageRole, preferIncluded?: boolean) => void;
    onSearch?: (role: CoverageRole) => void | Promise<void>;
    onAddSource?: () => void;
    searchDisabled?: boolean;
    isSearching?: boolean;
    recovery?: SourceRecoveryState;
    allowanceFeedback?: ReturnType<typeof sourceRecoveryFeedback> | null;
}) {
    const [expanded, setExpanded] = useState<CoverageRole | null>(null);
    const labelId = useId();
    const triggers = useRef(new Map<CoverageRole, HTMLButtonElement>());
    const scrollContainer = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!expanded) return;
        const container = scrollContainer.current;
        const item = triggers.current.get(expanded)?.closest("li");
        if (!container || !item) return;
        const reveal = () => {
            if (!container.clientHeight) return;
            const viewport = container.getBoundingClientRect();
            const bounds = item.getBoundingClientRect();
            if (bounds.bottom > viewport.bottom)
                container.scrollTop += bounds.bottom - viewport.bottom;
            else if (bounds.top < viewport.top)
                container.scrollTop -= viewport.top - bounds.top;
        };
        reveal();
        const observer = new ResizeObserver(reveal);
        observer.observe(item);
        observer.observe(container);
        return () => observer.disconnect();
    }, [expanded]);
    return (
        <CoverageContainer
            requirements={requirements}
            scrollRef={scrollContainer}>
            <Accordion<CoverageRole>
                render={<ul />}
                value={expanded ? [expanded] : []}
                onValueChange={(values) => setExpanded(values[0] ?? null)}
                className="space-y-1 rounded-none border-0">
                {requirements.map((requirement) => {
                    const copy = sourceCoverageCopy(requirement);
                    const label = sourceCoverageRoleLabel(requirement.role);
                    const included = requirement.includedSourceIds?.length ?? 0;
                    const other = requirement.candidateIds.filter(
                        (id) => !requirement.includedSourceIds?.includes(id),
                    ).length;
                    const countLabel =
                        included > 0
                            ? `${included} included ${copy.availability === "available" ? "source" : "match"}${included === 1 ? "" : copy.availability === "available" ? "s" : "es"}`
                            : `${other} potential match${other === 1 ? "" : "es"}`;
                    const selected = expanded === requirement.role;
                    const search = sourceCoverageSearchState({
                        role: requirement.role,
                        recovery,
                        isSearching,
                        disabled: searchDisabled,
                        allowanceFeedback,
                    });
                    return (
                        <AccordionItem
                            key={requirement.role}
                            value={requirement.role}
                            render={<li />}
                            className={cn(
                                "rounded-lg border border-transparent data-open:bg-source-selection-accent/4",
                                selected &&
                                    "border-source-selection-accent/50 bg-source-selection-accent/4",
                            )}
                            onKeyDown={(event) => {
                                if (event.key === "Escape") {
                                    setExpanded(null);
                                    triggers.current
                                        .get(requirement.role)
                                        ?.focus();
                                }
                            }}>
                            <AccordionTrigger
                                ref={(node) => {
                                    if (node)
                                        triggers.current.set(
                                            requirement.role,
                                            node,
                                        );
                                    else
                                        triggers.current.delete(
                                            requirement.role,
                                        );
                                }}
                                type="button"
                                aria-label={`Review coverage: ${label}`}
                                className={triggerClassName}
                                indicator={
                                    <Icon
                                        iconNode={ArrowRight01Icon}
                                        className={cn(
                                            "mt-1 shrink-0 text-muted-foreground",
                                            selected && "rotate-90",
                                        )}
                                    />
                                }>
                                <CoverageTopicSummary
                                    requirement={requirement}
                                    labelId={`${labelId}-${requirement.role}`}>
                                    <span className="block pt-0.5 text-xs leading-relaxed text-muted-foreground">
                                        {countLabel}
                                    </span>
                                </CoverageTopicSummary>
                            </AccordionTrigger>
                            <AccordionContent
                                aria-labelledby={`${labelId}-${requirement.role}`}
                                className="mx-3 space-y-3 border-t border-source-selection-accent/15 px-0 pb-3 pt-3 [&_p:not(:last-child)]:mb-0">
                                <p className="text-sm leading-relaxed text-muted-foreground">
                                    {copy.description}
                                </p>
                                <div className="flex flex-col divide-y divide-border/60">
                                    {included > 0 ? (
                                        <Button
                                            type="button"
                                            variant="outline"
                                            className="h-auto min-h-11 w-full justify-start gap-2 rounded-md border-border bg-card px-3 py-3 text-left text-sm leading-5 whitespace-normal"
                                            onClick={() =>
                                                onReview(requirement.role, true)
                                            }>
                                            <Icon iconNode={File01Icon} />
                                            <span className="min-w-0 flex-1">
                                                View {included} included source
                                                {included === 1 ? "" : "s"}
                                            </span>
                                        </Button>
                                    ) : null}
                                    {copy.availability !== "available" &&
                                    other > 0 ? (
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            aria-label={`Review candidates for ${label}`}
                                            className="h-auto min-h-11 w-full justify-start gap-2 rounded-none px-1 py-2.5 text-left text-sm leading-5 whitespace-normal"
                                            onClick={() =>
                                                onReview(requirement.role)
                                            }>
                                            <Icon iconNode={File01Icon} />
                                            <span className="min-w-0 flex-1">
                                                Review {other}{" "}
                                                {included > 0 ? "other " : ""}
                                                candidate
                                                {other === 1 ? "" : "s"}
                                            </span>
                                            <Icon iconNode={ArrowRight01Icon} />
                                        </Button>
                                    ) : null}
                                    {copy.availability !== "available" &&
                                    !readOnly &&
                                    onSearch ? (
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            aria-label={search.ariaLabel}
                                            aria-busy={search.searching}
                                            disabled={search.disabled}
                                            className="h-auto min-h-11 w-full justify-start gap-2 rounded-none px-1 py-2.5 text-left text-sm leading-5 whitespace-normal"
                                            onClick={() =>
                                                void onSearch(requirement.role)
                                            }>
                                            <Icon iconNode={Search01Icon} />
                                            <span className="min-w-0 flex-1">
                                                {search.label}
                                            </span>
                                            <Icon iconNode={ArrowRight01Icon} />
                                        </Button>
                                    ) : null}
                                    {search.feedback &&
                                    !readOnly &&
                                    onAddSource ? (
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            className="h-auto min-h-11 justify-between whitespace-normal text-left text-sm"
                                            onClick={onAddSource}>
                                            Add source link
                                            <Icon iconNode={PlusIcon} />
                                        </Button>
                                    ) : null}
                                </div>
                                <SourceSearchFeedback
                                    feedback={search.feedback}
                                    searching={search.searching}
                                    retryAfterSeconds={search.retryAfterSeconds}
                                />
                                <SourceSearchFeedback
                                    feedback={search.availabilityFeedback}
                                />
                            </AccordionContent>
                        </AccordionItem>
                    );
                })}
            </Accordion>
        </CoverageContainer>
    );
}
