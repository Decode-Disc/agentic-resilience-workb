"use client"

import { AnimatePresence, MotionConfig, motion } from "motion/react"
import { type ReactNode, useId, useMemo, useState } from "react"
import useMeasure from "react-use-measure"

import { cn } from "@/lib/utils"

export type Tab = {
    id: string | number
    label: ReactNode
    content: ReactNode
}

export interface DirectionAwareTabsProps {
    tabs: Tab[]
    className?: string
    containerClassName?: string
    /** Outer container radius (e.g. `rounded-lg`) */
    rounded?: string
    /** Inner tab/bubble radius — should be outer radius minus container padding (~3px) */
    roundedInner?: string
    onChange?: (tabId: string | number) => void
    defaultTabId?: string | number
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
    const uniqueLayoutId = useId()
    const [activeTab, setActiveTab] = useState<string | number>(
        defaultTabId ?? tabs[0]?.id ?? 0
    )
    const [direction, setDirection] = useState(0)
    const [isAnimating, setIsAnimating] = useState(false)
    const [ref, bounds] = useMeasure()

    const activeTabIndex = useMemo(
        () => tabs.findIndex((tab) => tab.id === activeTab),
        [activeTab, tabs]
    )

    const content = useMemo(() => {
        const activeTabContent = tabs.find((tab) => tab.id === activeTab)?.content
        return activeTabContent || null
    }, [activeTab, tabs])

    const handleTabClick = (newTabId: string | number) => {
        const newIndex = tabs.findIndex((tab) => tab.id === newTabId)
        if (newTabId !== activeTab && newIndex !== -1) {
            const newDirection = newIndex > (activeTabIndex >= 0 ? activeTabIndex : 0) ? 1 : -1
            setDirection(newDirection)
            setActiveTab(newTabId)
            onChange?.(newTabId)
        }
    }

    const variants = {
        initial: (direction: number) => ({
            x: 300 * direction,
            opacity: 0,
            filter: "blur(4px)",
        }),
        active: {
            x: 0,
            opacity: 1,
            filter: "blur(0px)",
        },
        exit: (direction: number) => ({
            x: -300 * direction,
            opacity: 0,
            filter: "blur(4px)",
        }),
    }

    return (
        <div className={cn("flex flex-col items-center w-full", containerClassName)}>
            <div
                className={cn(
                    "flex items-center space-x-1 border border-border/60 rounded-full cursor-pointer bg-muted/30 p-1 shadow-xs",
                    className,
                    rounded
                )}
            >
                {tabs.map((tab) => {
                    const isActive = activeTab === tab.id
                    return (
                        <button
                            key={tab.id}
                            type="button"
                            onClick={() => handleTabClick(tab.id)}
                            className={cn(
                                "relative rounded-full px-3.5 py-1.5 text-xs sm:text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring flex gap-2 items-center",
                                isActive
                                    ? "text-foreground"
                                    : "text-muted-foreground hover:text-foreground",
                                rounded ? roundedInner : undefined
                            )}
                            style={{ WebkitTapHighlightColor: "transparent" }}
                        >
                            {isActive && (
                                <motion.span
                                    layoutId={`direction-tab-bubble-${uniqueLayoutId}`}
                                    className={cn(
                                        "absolute inset-0 z-10 bg-secondary shadow-xs border border-border/60",
                                        rounded ? roundedInner : "rounded-full"
                                    )}
                                    transition={{
                                        type: "spring",
                                        bounce: 0.19,
                                        duration: 0.4,
                                    }}
                                />
                            )}

                            <span className="relative z-20">{tab.label}</span>
                        </button>
                    )
                })}
            </div>
            <MotionConfig transition={{ duration: 0.4, type: "spring", bounce: 0.2 }}>
                <motion.div
                    className="relative mx-auto w-full h-full overflow-hidden mt-2"
                    initial={false}
                    animate={{ height: bounds.height > 0 ? bounds.height : "auto" }}
                >
                    <div className="p-1 h-full w-full" ref={ref}>
                        <AnimatePresence
                            custom={direction}
                            mode="popLayout"
                            onExitComplete={() => setIsAnimating(false)}
                        >
                            <motion.div
                                key={activeTab}
                                variants={variants}
                                initial="initial"
                                animate="active"
                                exit="exit"
                                custom={direction}
                                onAnimationStart={() => setIsAnimating(true)}
                                onAnimationComplete={() => setIsAnimating(false)}
                                className="w-full"
                            >
                                {content}
                            </motion.div>
                        </AnimatePresence>
                    </div>
                </motion.div>
            </MotionConfig>
        </div>
    )
}

export { DirectionAwareTabs }
