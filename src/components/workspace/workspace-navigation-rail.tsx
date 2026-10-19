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
import { useEffect, useState } from "react";

import Icon from "@/components/icon";
import { Button } from "@/components/ui/button";
import { LiquidGlassCard } from "@/components/ui/liquid-glass";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { useResponsive } from "@/hooks/use-responsive";
import { uiLayerClasses } from "@/lib/ui-layers";
import { cn } from "@/lib/utils";

const COLLAPSED_STORAGE_KEY = "evidence-workbench.nav-rail.collapsed.v1";
const RAIL_COLLAPSED_WIDTH_DESKTOP = "4.25rem";
const RAIL_COLLAPSED_WIDTH_MOBILE = "3.25rem";
const RAIL_EXPANDED_WIDTH_DESKTOP = "14rem";
const RAIL_EXPANDED_WIDTH_MOBILE = "11.5rem";

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
    const { isMobile, isTabletOrBelow } = useResponsive();
    const [collapsed, setCollapsed] = useState<boolean>(() => {
        if (
            typeof window !== "undefined" &&
            window.matchMedia("(max-width: 64rem)").matches
        ) {
            return true;
        }
        return readStoredCollapsed();
    });
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
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
        if (isTabletOrBelow) {
            setCollapsed(true);
            persistCollapsed(true);
        }
    };

    const targetCollapsedWidth = isMobile
        ? RAIL_COLLAPSED_WIDTH_MOBILE
        : RAIL_COLLAPSED_WIDTH_DESKTOP;
    const targetExpandedWidth = isMobile
        ? RAIL_EXPANDED_WIDTH_MOBILE
        : RAIL_EXPANDED_WIDTH_DESKTOP;

    const toggleLabel = collapsed ? "Expand navigation" : "Collapse navigation";
    const ToggleIcon = collapsed ? PanelLeftOpenIcon : PanelLeftCloseIcon;

    return (
        <TooltipProvider delay={200}>
            <LiquidGlassCard
                data-slot="workspace-navigation-rail"
                aria-label="Research workspace sections"
                className={cn(
                    "relative min-h-0 overflow-hidden shadow-xl transition-[padding]",
                    isMobile ? "p-1.5" : "p-2",
                    uiLayerClasses.navigationRail,
                )}
                glowIntensity="md"
                blurIntensity="sm"
                shadowIntensity="xl"
                whileHover={undefined}
                whileTap={undefined}
                animate={
                    reduceMotion || !mounted
                        ? undefined
                        : {
                              width: collapsed
                                  ? targetCollapsedWidth
                                  : targetExpandedWidth,
                          }
                }
                style={{
                    width: mounted
                        ? collapsed
                            ? targetCollapsedWidth
                            : targetExpandedWidth
                        : undefined,
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
                                size={isMobile ? 12 : 13}
                            />
                            Sections
                        </span>
                    )}
                    <Button
                        type="button"
                        variant="secondary"
                        size={isMobile ? "icon-xs" : "icon-sm"}
                        aria-label={toggleLabel}
                        aria-expanded={!collapsed}
                        onClick={toggleCollapsed}
                        title={toggleLabel}>
                        <Icon iconNode={ToggleIcon} size={isMobile ? 14 : 16} />
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
                                            icon={item.icon}
                                            onSelect={handleItemSelect}
                                        />
                                    ) : (
                                        <LockedSection
                                            label={item.label}
                                            icon={item.icon}
                                            collapsed={collapsed}
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
                                    Evidence review is ready to begin from these
                                    approved sources.
                                </p>
                            </div>
                        ) : null}
                    </div>
                )}
            </LiquidGlassCard>
        </TooltipProvider>
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
    icon,
    onSelect,
}: NavigationItemLinkProps) {
    const reduceMotion = useReducedMotion();
    const { isMobile } = useResponsive();
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
                isMobile
                    ? "gap-2 px-2 py-1.5 text-xs"
                    : "gap-2.5 px-2.5 py-2 text-sm",
                collapsed ? "justify-center rounded-sm" : "rounded-md",
                active
                    ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}>
            <Icon
                iconNode={icon}
                size={isMobile ? 15 : 16}
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
                        isMobile ? "h-4 w-0.5" : "h-5 w-1",
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
    hint,
}: {
    label: string;
    icon: NavigationIcon;
    collapsed: boolean;
    hint: string;
}) {
    const { isMobile } = useResponsive();
    const content = (
        <div
            title={collapsed ? label : undefined}
            className={cn(
                "rounded-lg text-muted-foreground/70 transition-[padding]",
                isMobile ? "px-2 py-1.5" : "px-2.5 py-2",
                collapsed && "flex flex-col items-center gap-1",
            )}>
            <span
                className={cn(
                    "flex items-center",
                    isMobile ? "gap-2 text-xs" : "gap-2.5 text-sm",
                    collapsed && "justify-center",
                )}>
                <Icon iconNode={icon} size={isMobile ? 15 : 16} />
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
                    className={cn(
                        "mt-1 block leading-snug",
                        isMobile ? "pl-5.5 text-[10px]" : "pl-6.5 text-[11px]",
                    )}>
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
