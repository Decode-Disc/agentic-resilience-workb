"use client";

import {
    AnimatePresence,
    MotionConfig,
    motion,
    useReducedMotion,
} from "motion/react";
import { type ReactNode, useId, useMemo, useRef, useState } from "react";
import useMeasure from "react-use-measure";

import { cn } from "@/lib/utils";

export type Tab = {
    id: string | number;
    label: ReactNode;
    content: ReactNode;
};

export interface DirectionAwareTabsProps {
    tabs: Tab[];
    className?: string;
    containerClassName?: string;
    /** Outer container radius (e.g. `rounded-lg`) */
    rounded?: string;
    /** Inner tab/bubble radius — should be outer radius minus container padding (~3px) */
    roundedInner?: string;
    onChange?: (tabId: string | number) => void;
    defaultTabId?: string | number;
}

function DirectionAwareTabs({
    tabs,
    className,
    containerClassName,
    rounded,
    roundedInner,
    onChange,
    defaultTabId,
}: DirectionAwareTabsProps) {
    const uniqueLayoutId = useId();
    const [activeTab, setActiveTab] = useState<string | number>(
        defaultTabId ?? tabs[0]?.id ?? 0,
    );
    const [direction, setDirection] = useState(0);
    const [ref, bounds] = useMeasure();
    const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
    const reduceMotion = useReducedMotion();

    const activeTabIndex = useMemo(
        () => tabs.findIndex((tab) => tab.id === activeTab),
        [activeTab, tabs],
    );

    const content = useMemo(() => {
        const activeTabContent = tabs.find(
            (tab) => tab.id === activeTab,
        )?.content;
        return activeTabContent || null;
    }, [activeTab, tabs]);

    const handleTabClick = (newTabId: string | number) => {
        const newIndex = tabs.findIndex((tab) => tab.id === newTabId);
        if (newTabId !== activeTab && newIndex !== -1) {
            const newDirection =
                newIndex > (activeTabIndex >= 0 ? activeTabIndex : 0) ? 1 : -1;
            setDirection(newDirection);
            setActiveTab(newTabId);
            onChange?.(newTabId);
        }
    };

    const moveFocus = (index: number) => {
        const target = tabs[index];
        if (!target) {
            return;
        }
        handleTabClick(target.id);
        tabRefs.current[index]?.focus();
    };

    const handleTabKeyDown = (
        event: React.KeyboardEvent<HTMLButtonElement>,
        index: number,
    ) => {
        let nextIndex: number | undefined;
        if (event.key === "ArrowRight") {
            nextIndex = (index + 1) % tabs.length;
        } else if (event.key === "ArrowLeft") {
            nextIndex = (index - 1 + tabs.length) % tabs.length;
        } else if (event.key === "Home") {
            nextIndex = 0;
        } else if (event.key === "End") {
            nextIndex = tabs.length - 1;
        }
        if (nextIndex === undefined || tabs.length === 0) {
            return;
        }
        event.preventDefault();
        moveFocus(nextIndex);
    };

    const variants = {
        initial: (direction: number) => ({
            x: reduceMotion ? 0 : 300 * direction,
            opacity: 0,
            filter: reduceMotion ? "blur(0px)" : "blur(4px)",
        }),
        active: {
            x: 0,
            opacity: 1,
            filter: "blur(0px)",
        },
        exit: (direction: number) => ({
            x: reduceMotion ? 0 : -300 * direction,
            opacity: 0,
            filter: reduceMotion ? "blur(0px)" : "blur(4px)",
        }),
    };

    return (
        <div
            className={cn(
                "flex flex-col items-center w-full",
                containerClassName,
            )}>
            <div
                role="tablist"
                className={cn(
                    "flex items-center space-x-1 border border-border/60 rounded-full cursor-pointer bg-muted/30 p-1 shadow-xs",
                    className,
                    rounded,
                )}>
                {tabs.map((tab, index) => {
                    const isActive = activeTab === tab.id;
                    const tabId = `direction-tab-${uniqueLayoutId}-${index}`;
                    const panelId = `direction-panel-${uniqueLayoutId}-${index}`;
                    return (
                        <button
                            key={tab.id}
                            id={tabId}
                            ref={(node) => {
                                tabRefs.current[index] = node;
                            }}
                            type="button"
                            role="tab"
                            aria-selected={isActive}
                            aria-controls={panelId}
                            tabIndex={isActive ? 0 : -1}
                            data-slot="tabs-trigger"
                            onClick={() => handleTabClick(tab.id)}
                            onKeyDown={(event) =>
                                handleTabKeyDown(event, index)
                            }
                            className={cn(
                                "relative rounded-full px-3.5 py-1.5 text-xs sm:text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring flex gap-2 items-center",
                                isActive
                                    ? "text-foreground"
                                    : "text-muted-foreground hover:text-foreground",
                                rounded ? roundedInner : undefined,
                            )}
                            style={{ WebkitTapHighlightColor: "transparent" }}>
                            {isActive && (
                                <motion.span
                                    layoutId={`direction-tab-bubble-${uniqueLayoutId}`}
                                    className={cn(
                                        "absolute inset-0 z-10 bg-secondary shadow-xs border border-border/60",
                                        rounded ? roundedInner : "rounded-full",
                                    )}
                                    transition={{
                                        type: reduceMotion ? "tween" : "spring",
                                        bounce: 0.19,
                                        duration: reduceMotion ? 0 : 0.4,
                                    }}
                                />
                            )}

                            <span className="relative z-20">{tab.label}</span>
                        </button>
                    );
                })}
            </div>
            <MotionConfig
                reducedMotion="user"
                transition={{
                    duration: reduceMotion ? 0 : 0.4,
                    type: reduceMotion ? "tween" : "spring",
                    bounce: 0.2,
                }}>
                <motion.div
                    className="relative mx-auto w-full h-full overflow-hidden mt-2"
                    initial={false}
                    animate={{
                        height: bounds.height > 0 ? bounds.height : "auto",
                    }}>
                    <div className="p-1 h-full w-full" ref={ref}>
                        <AnimatePresence custom={direction} mode="popLayout">
                            <motion.div
                                key={activeTab}
                                id={`direction-panel-${uniqueLayoutId}-${activeTabIndex}`}
                                role="tabpanel"
                                aria-labelledby={`direction-tab-${uniqueLayoutId}-${activeTabIndex}`}
                                data-slot="tabs-content"
                                variants={variants}
                                initial="initial"
                                animate="active"
                                exit="exit"
                                custom={direction}
                                className="w-full">
                                {content}
                            </motion.div>
                        </AnimatePresence>
                    </div>
                </motion.div>
            </MotionConfig>
        </div>
    );
}

export { DirectionAwareTabs };
