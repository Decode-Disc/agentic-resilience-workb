import type { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
    ChartEvaluationIcon,
    CheckListIcon,
    FileSearchIcon,
    Flowchart01Icon,
    LeftToRightListDashIcon,
    MapsIcon,
    Note01Icon,
    PanelLeftCloseIcon,
    PanelLeftOpenIcon,
} from "@hugeicons/core-free-icons";
import { Link } from "@tanstack/react-router";
import type { FunctionReturnType } from "convex/server";
import { motion, useReducedMotion } from "motion/react";
import { type CSSProperties, useEffect, useState } from "react";

import Icon from "@/components/icon";
import { Button } from "@/components/ui/button";
import { LiquidGlassCard } from "@/components/ui/liquid-glass";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { useMediaQuery } from "@/hooks/use-responsive";
import { uiLayerClasses } from "@/lib/ui-layers";
import { cn } from "@/lib/utils";

const MOBILE_RAIL_QUERY = "(width < 48rem)";

const COLLAPSED_STORAGE_KEY = "evidence-workbench.nav-rail.collapsed.v1";
const railSizes = {
    mobile: {
        collapsedWidth: "3.25rem",
        expandedWidth: "11.5rem",
        padding: "p-1.5",
        eyebrowIcon: 12,
        toggleButton: "icon-xs",
        toggleIcon: 14,
        itemIcon: 15,
        itemSpacing: "gap-2 px-2 py-1.5 text-xs",
        activeIndicator: "h-4 w-0.5",
        lockedPadding: "px-2 py-1.5",
        lockedLabel: "gap-2 text-xs",
        lockedHint: "pl-5.5 text-[10px]",
    },
    desktop: {
        collapsedWidth: "4.25rem",
        expandedWidth: "14rem",
        padding: "p-2",
        eyebrowIcon: 13,
        toggleButton: "icon-sm",
        toggleIcon: 16,
        itemIcon: 16,
        itemSpacing: "gap-2.5 px-2.5 py-2 text-sm",
        activeIndicator: "h-5 w-1",
        lockedPadding: "px-2.5 py-2",
        lockedLabel: "gap-2.5 text-sm",
        lockedHint: "pl-6.5 text-[11px]",
    },
} as const;

type RailSizes = (typeof railSizes)[keyof typeof railSizes];

export type WorkspaceSection =
    | "progress"
    | "sources"
    | "evidence"
    | "assessment"
    | "map"
    | "brief";

type LifecycleState = NonNullable<
    FunctionReturnType<typeof api.researchRuns.getMine>
>["lifecycleState"];

const sections = [
    { key: "progress", label: "Progress", icon: Flowchart01Icon },
    { key: "sources", label: "Sources", icon: FileSearchIcon },
    { key: "evidence", label: "Evidence", icon: CheckListIcon },
    { key: "assessment", label: "Assessment", icon: ChartEvaluationIcon },
    { key: "map", label: "Map", icon: MapsIcon },
    { key: "brief", label: "Brief", icon: Note01Icon },
] as const;

const lifecycleOrder: ReadonlyArray<LifecycleState> = [
    "draft",
    "checking_public_evidence",
    "awaiting_evidence_sufficiency_review",
    "discovering_sources",
    "awaiting_source_review",
    "corpus_approved",
    "extracting_evidence",
    "evidence_ready",
    "assessing_dimensions",
    "awaiting_assessment_review",
    "completed",
];

function isUnlocked(section: WorkspaceSection, lifecycle: LifecycleState) {
    if (section === "progress" || section === "sources") {
        return true;
    }
    const index = lifecycleOrder.indexOf(lifecycle);
    if (section === "evidence") {
        return index >= lifecycleOrder.indexOf("evidence_ready");
    }
    if (section === "assessment") {
        return index >= lifecycleOrder.indexOf("assessing_dimensions");
    }
    if (section === "map" || section === "brief") {
        return index >= lifecycleOrder.indexOf("completed");
    }
    return false;
}

function prerequisite(section: WorkspaceSection) {
    if (section === "evidence") {
        return "Wait for claim extraction to finish building the evidence set.";
    }
    if (section === "assessment") {
        return "Review and approve the evidence first.";
    }
    return "Review the dimension assessment first.";
}

function readStoredCollapsed(): boolean {
    if (typeof window === "undefined") {
        return false;
    }
    try {
        return window.localStorage.getItem(COLLAPSED_STORAGE_KEY) === "true";
    } catch {
        return false;
    }
}

function persistCollapsed(collapsed: boolean) {
    if (typeof window === "undefined") {
        return;
    }
    try {
        window.localStorage.setItem(
            COLLAPSED_STORAGE_KEY,
            collapsed ? "true" : "false",
        );
    } catch {
        // Ignore storage failures (private mode, quota): the choice stays
        // session-local rather than persisted.
    }
}

/** Persistent six-section navigation with explicit lock prerequisites. */
export function WorkspaceNavigationRail({
    runId,
    section,
    lifecycleState,
}: {
    runId: Id<"researchRuns">;
    section: WorkspaceSection;
    lifecycleState: LifecycleState;
}) {
    const reduceMotion = useReducedMotion();
    const isMobile = useMediaQuery(MOBILE_RAIL_QUERY);
    const [collapsed, setCollapsed] = useState(false);
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setCollapsed(
            window.matchMedia(MOBILE_RAIL_QUERY).matches ||
                readStoredCollapsed(),
        );
        setMounted(true);
    }, []);

    const toggleCollapsed = () => {
        setCollapsed((previous) => {
            const next = !previous;
            persistCollapsed(next);
            return next;
        });
    };

    const handleItemSelect = () => {
        if (isMobile) {
            setCollapsed(true);
        }
    };

    const sizes = railSizes[isMobile ? "mobile" : "desktop"];
    const targetWidth = collapsed ? sizes.collapsedWidth : sizes.expandedWidth;

    const toggleLabel = collapsed ? "Expand navigation" : "Collapse navigation";
    const ToggleIcon = collapsed ? PanelLeftOpenIcon : PanelLeftCloseIcon;

    return (
        <div
            className="w-(--rail-collapsed-width) md:w-fit"
            style={
                {
                    "--rail-collapsed-width": railSizes.mobile.collapsedWidth,
                } as CSSProperties
            }>
            <TooltipProvider delay={200}>
                <LiquidGlassCard
                    data-slot="workspace-navigation-rail"
                    aria-label="Research workspace sections"
                    className={cn(
                        "relative min-h-0 overflow-hidden shadow-xl transition-[padding]",
                        sizes.padding,
                        uiLayerClasses.navigationRail,
                    )}
                    glowIntensity="md"
                    blurIntensity="xl"
                    shadowIntensity="lg"
                    whileHover={undefined}
                    whileTap={undefined}
                    animate={
                        reduceMotion || !mounted
                            ? undefined
                            : {
                                  width: targetWidth,
                              }
                    }
                    style={{
                        width: targetWidth,
                    }}>
                    <div
                        className={cn(
                            "flex items-center gap-1 rounded-t-xl",
                            collapsed
                                ? "justify-center py-1"
                                : "justify-between px-2 py-1.5 sm:py-2",
                        )}>
                        {collapsed ? null : (
                            <span className="flex items-center gap-1.5 px-1 text-[10px] font-medium tracking-[0.12em] text-muted-foreground uppercase sm:text-[11px]">
                                <Icon
                                    iconNode={LeftToRightListDashIcon}
                                    size={sizes.eyebrowIcon}
                                />
                                Sections
                            </span>
                        )}
                        <Button
                            type="button"
                            variant="secondary"
                            size={sizes.toggleButton}
                            aria-label={toggleLabel}
                            aria-expanded={!collapsed}
                            onClick={toggleCollapsed}
                            title={toggleLabel}>
                            <Icon
                                iconNode={ToggleIcon}
                                size={sizes.toggleIcon}
                            />
                        </Button>
                    </div>

                    <nav aria-label="Research workspace sections">
                        <ul className="space-y-0.5">
                            {sections.map((item) => {
                                const unlocked = isUnlocked(
                                    item.key,
                                    lifecycleState,
                                );
                                const active = item.key === section;
                                return (
                                    <li key={item.key} className="min-w-0">
                                        {unlocked ? (
                                            <NavigationItemLink
                                                to="/workspace/$runId"
                                                params={{ runId }}
                                                search={{ section: item.key }}
                                                label={item.label}
                                                active={active}
                                                collapsed={collapsed}
                                                sizes={sizes}
                                                icon={item.icon}
                                                onSelect={handleItemSelect}
                                            />
                                        ) : (
                                            <LockedSection
                                                label={item.label}
                                                icon={item.icon}
                                                collapsed={collapsed}
                                                sizes={sizes}
                                                hint={prerequisite(item.key)}
                                            />
                                        )}
                                    </li>
                                );
                            })}
                        </ul>
                    </nav>

                    {collapsed ? null : (
                        <div className="mt-3 border-t border-border/40 pt-3">
                            {lifecycleState === "corpus_approved" ? (
                                <div className="rounded-lg border border-approved/30 bg-approved/10 p-3">
                                    <p className="text-xs font-medium text-approved">
                                        Source set approved
                                    </p>
                                    <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                                        Evidence review is ready to begin from
                                        these approved sources.
                                    </p>
                                </div>
                            ) : null}
                        </div>
                    )}
                </LiquidGlassCard>
            </TooltipProvider>
        </div>
    );
}

type NavigationIcon = NonNullable<(typeof sections)[number]["icon"]>;

type NavigationItemLinkProps = {
    to: "/workspace/$runId";
    params: { runId: Id<"researchRuns"> };
    search: { section: WorkspaceSection };
    label: string;
    active: boolean;
    collapsed: boolean;
    sizes: RailSizes;
    icon: NavigationIcon;
    onSelect?: () => void;
};

function NavigationItemLink({
    to,
    params,
    search,
    label,
    active,
    collapsed,
    sizes,
    icon,
    onSelect,
}: NavigationItemLinkProps) {
    const reduceMotion = useReducedMotion();
    const link = (
        <Link
            to={to}
            params={params}
            search={search}
            onClick={onSelect}
            aria-current={active ? "page" : undefined}
            title={collapsed ? label : undefined}
            className={cn(
                "group/nav-item relative flex items-center transition-[background-color,color,padding] duration-200",
                sizes.itemSpacing,
                collapsed ? "justify-center rounded-sm" : "rounded-md",
                active
                    ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}>
            <Icon
                iconNode={icon}
                size={sizes.itemIcon}
                className={cn(
                    "shrink-0",
                    active
                        ? "text-sidebar-accent-foreground"
                        : "text-muted-foreground group-hover/nav-item:text-foreground",
                )}
            />
            {collapsed ? null : <span className="truncate">{label}</span>}
            {active ? (
                <motion.span
                    aria-hidden="true"
                    layoutId={reduceMotion ? undefined : "nav-active-rail"}
                    className={cn(
                        "absolute top-1/2 left-0 -translate-y-1/2 rounded-full bg-sidebar-accent-foreground",
                        sizes.activeIndicator,
                    )}
                    transition={
                        reduceMotion
                            ? { duration: 0 }
                            : { type: "spring", stiffness: 380, damping: 30 }
                    }
                />
            ) : null}
        </Link>
    );

    if (!collapsed) {
        return link;
    }

    return (
        <Tooltip>
            <TooltipTrigger render={link as never} />
            <TooltipContent side="right">{label}</TooltipContent>
        </Tooltip>
    );
}

function LockedSection({
    label,
    icon,
    collapsed,
    sizes,
    hint,
}: {
    label: string;
    icon: NavigationIcon;
    collapsed: boolean;
    sizes: RailSizes;
    hint: string;
}) {
    const content = (
        <div
            title={collapsed ? label : undefined}
            className={cn(
                "rounded-lg text-muted-foreground/70 transition-[padding]",
                sizes.lockedPadding,
                collapsed && "flex flex-col items-center gap-1",
            )}>
            <span
                className={cn(
                    "flex items-center",
                    sizes.lockedLabel,
                    collapsed && "justify-center",
                )}>
                <Icon iconNode={icon} size={sizes.itemIcon} />
                {collapsed ? (
                    <span className="sr-only">{label}</span>
                ) : (
                    <span className="truncate">{label}</span>
                )}
            </span>
            {collapsed ? (
                <>
                    <span
                        aria-hidden="true"
                        className="h-1 w-1 rounded-full bg-current opacity-50"
                    />
                    <span className="sr-only">{hint}</span>
                </>
            ) : (
                <span
                    className={cn("mt-1 block leading-snug", sizes.lockedHint)}>
                    {hint}
                </span>
            )}
        </div>
    );

    if (!collapsed) {
        return content;
    }

    return (
        <Tooltip>
            <TooltipTrigger render={content as never} />
            <TooltipContent side="right">{hint}</TooltipContent>
        </Tooltip>
    );
}
