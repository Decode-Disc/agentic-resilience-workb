import { Link } from "@tanstack/react-router";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Icon from "@/components/icon";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { PlatformIcon } from "@/types/ui";

export type DiscreteTabItem = {
    id: string;
    title: string;
    icon:
        | React.ComponentType<React.SVGProps<SVGSVGElement> & { size?: number }>
        | PlatformIcon;
    iconClassName?: string;
    count?: number;
    href?: string;
    prefetch?: boolean;
};

type DiscreteTabsProps = {
    tabs?: ReadonlyArray<DiscreteTabItem>;
    value?: string;
    defaultValue?: string;
    onValueChange?: (nextValue: string) => void;
    activeIndex?: number;
    className?: string;
    ariaLabel?: string;
    labelVisibility?: "active" | "all";
    overflow?: "scroll" | "wrap";
    orientation?: "horizontal" | "vertical";
    appearance?: "pill" | "plain";
    /** Optional query parameter used to preserve the local selection. */
    persistKey?: string;
};

/** Keeps controlled selection and keyboard navigation across scrolling or wrapping layouts. */
export default function DiscreteTabs({
    tabs = [],
    value,
    defaultValue,
    onValueChange,
    activeIndex = 0,
    className,
    ariaLabel,
    persistKey,
    labelVisibility = "active",
    overflow = "scroll",
    orientation = "horizontal",
    appearance = "pill",
}: DiscreteTabsProps) {
    const [internalValue, setInternalValue] = useState<string>(() => {
        if (persistKey && typeof window !== "undefined") {
            const urlValue = new URLSearchParams(window.location.search).get(
                persistKey,
            );
            if (urlValue) return urlValue;
        }
        return defaultValue ?? tabs[activeIndex]?.id ?? "";
    });
    const localTabRefs = useRef<Array<HTMLButtonElement | null>>([]);

    /**
     * Synchronise la sélection depuis l'URL au montage quand persistKey est utilisé.
     * Évite les re-rendus si la valeur URL correspond déjà à la valeur courante.
     */
    useEffect(() => {
        if (!persistKey || typeof window === "undefined") return;

        const urlValue = new URLSearchParams(window.location.search).get(
            persistKey,
        );
        if (urlValue && urlValue !== (value ?? internalValue)) {
            if (value === undefined) {
                setInternalValue(urlValue);
            }
            onValueChange?.(urlValue);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [persistKey]);

    /**
     * Persiste la valeur contrôlée dans l'URL quand le parent la modifie
     * (ex: navigation programmatique vers un onglet via un bouton externe).
     * Sans cela, seul un clic direct sur un onglet mettrait à jour l'URL.
     */
    useEffect(() => {
        if (!persistKey || typeof window === "undefined") return;
        if (value === undefined) return;

        const url = new URL(window.location.href);
        const currentUrlValue = url.searchParams.get(persistKey);

        if (currentUrlValue !== value) {
            url.searchParams.set(persistKey, value);
            window.history.replaceState(
                window.history.state,
                "",
                url.toString(),
            );
        }
    }, [persistKey, value]);

    const activeButton = value ?? internalValue;

    /**
     * Met à jour la sélection locale, persiste dans l'URL et informe le composant parent.
     */
    const setActiveButton = (nextValue: string) => {
        if (value === undefined) {
            setInternalValue(nextValue);
        }

        if (persistKey && typeof window !== "undefined") {
            const url = new URL(window.location.href);
            url.searchParams.set(persistKey, nextValue);
            window.history.replaceState(
                window.history.state,
                "",
                url.toString(),
            );
        }

        onValueChange?.(nextValue);
    };

    if (!tabs.length) {
        return null;
    }

    const resolvedActiveButton = tabs.some((tab) => tab.id === activeButton)
        ? activeButton
        : (tabs[activeIndex]?.id ?? tabs[0]?.id ?? "");
    const hasNavigationDestination = tabs.some((tab) => tab.href !== undefined);
    const handleLocalTabKeyDown = (
        event: React.KeyboardEvent<HTMLButtonElement>,
        currentIndex: number,
    ) => {
        let nextIndex: number | null = null;
        if (
            event.key ===
            (orientation === "vertical" ? "ArrowDown" : "ArrowRight")
        ) {
            nextIndex = (currentIndex + 1) % tabs.length;
        } else if (
            event.key === (orientation === "vertical" ? "ArrowUp" : "ArrowLeft")
        ) {
            nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
        } else if (event.key === "Home") {
            nextIndex = 0;
        } else if (event.key === "End") {
            nextIndex = tabs.length - 1;
        }
        if (nextIndex === null) {
            return;
        }
        event.preventDefault();
        const nextTab = tabs[nextIndex];
        if (!nextTab) {
            return;
        }
        setActiveButton(nextTab.id);
        localTabRefs.current[nextIndex]?.focus();
    };

    const navigationClassName = cn(
        "flex items-center gap-4",
        orientation === "vertical"
            ? "w-full min-w-0 flex-col items-stretch"
            : overflow === "wrap"
              ? "w-full min-w-0 flex-wrap"
              : "w-max min-w-full flex-nowrap",
        className,
    );
    const buttons = tabs.map((tab, index) => (
        <DiscreteTabButton
            key={tab.id}
            tab={tab}
            isActive={resolvedActiveButton === tab.id}
            showLabel={labelVisibility === "all"}
            appearance={appearance}
            setActiveButton={setActiveButton}
            buttonRef={(node) => {
                localTabRefs.current[index] = node;
            }}
            onKeyDown={
                hasNavigationDestination
                    ? undefined
                    : (event) => handleLocalTabKeyDown(event, index)
            }
        />
    ));
    const navigation = hasNavigationDestination ? (
        <nav className={navigationClassName} aria-label={ariaLabel}>
            {buttons}
        </nav>
    ) : (
        <div
            className={navigationClassName}
            role="tablist"
            aria-orientation={orientation}
            aria-label={ariaLabel}>
            {buttons}
        </div>
    );

    return overflow === "wrap" || orientation === "vertical" ? (
        navigation
    ) : (
        <ScrollArea
            className="relative overflow-visible"
            viewportClassName="overflow-x-auto overflow-y-visible py-0.5">
            {navigation}
            <ScrollBar
                orientation="horizontal"
                className="absolute! -bottom-2!"
            />
        </ScrollArea>
    );
}

type DiscreteTabButtonProps = {
    tab: DiscreteTabItem;
    isActive: boolean;
    showLabel: boolean;
    appearance: "pill" | "plain";
    setActiveButton: (nextValue: string) => void;
    buttonRef: (node: HTMLButtonElement | null) => void;
    onKeyDown?: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
};

/** Keeps the icon, optional label and count together across tab selection. */
const DiscreteTabButton = ({
    tab,
    isActive,
    showLabel,
    appearance,
    setActiveButton,
    buttonRef,
    onKeyDown,
}: DiscreteTabButtonProps) => {
    const [isLoaded, setIsLoaded] = useState(false);
    const [isTooltipVisible, setIsTooltipVisible] = useState(false);
    const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });
    const accessibleLabel =
        tab.count === undefined ? tab.title : `${tab.title} ${tab.count}`;
    const plain = appearance === "plain";
    const activeClass = plain
        ? "bg-card text-foreground shadow-tab"
        : "border-transparent bg-card text-foreground shadow-tab";
    const nonActiveClass = plain
        ? "text-muted-foreground hover:bg-foreground/4 hover:text-foreground"
        : "border-transparent text-muted-foreground hover:bg-muted hover:text-foreground";

    /** Positions the tooltip above the hovered or focused control. */
    const showTooltip = (event: React.SyntheticEvent<HTMLElement>) => {
        const rect = event.currentTarget.getBoundingClientRect();
        setTooltipPosition({
            x: rect.left + rect.width / 2,
            y: rect.top - 8,
        });
        setIsTooltipVisible(true);
    };

    const content = (
        <>
            {typeof document !== "undefined"
                ? createPortal(
                      <AnimatePresence>
                          {isTooltipVisible && !showLabel && (
                              <motion.span
                                  initial={{
                                      opacity: 0,
                                      y: 2,
                                      filter: "blur(2px)",
                                  }}
                                  animate={{
                                      opacity: 1,
                                      y: 0,
                                      filter: "blur(0px)",
                                  }}
                                  exit={{
                                      opacity: 0,
                                      y: 2,
                                      filter: "blur(2px)",
                                  }}
                                  transition={{ duration: 0.15 }}
                                  className="pointer-events-none fixed z-1000 -translate-x-1/2 -translate-y-full rounded-md border border-border/60 bg-popover px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-popover-foreground shadow-sm"
                                  style={{
                                      left: tooltipPosition.x,
                                      top: tooltipPosition.y,
                                  }}>
                                  {accessibleLabel}
                              </motion.span>
                          )}
                      </AnimatePresence>,
                      document.body,
                  )
                : null}

            <motion.div
                data-slot="discrete-tab-control"
                layout={!plain}
                transition={{
                    layout: {
                        type: "spring",
                        damping: 20,
                        stiffness: 230,
                        mass: 1.2,
                    },
                }}
                className={cn(
                    "flex cursor-pointer items-center gap-1.5 overflow-hidden font-mono text-xs uppercase outline-none transition-colors",
                    plain
                        ? "h-9 w-full rounded-md px-2.5"
                        : "min-h-9 rounded-full border px-3 py-2",
                    showLabel && "font-sans normal-case",
                    isActive ? activeClass : nonActiveClass,
                )}>
                <motion.div
                    layoutId={plain ? undefined : `icon-id${tab.title}`}
                    className="shrink-0"
                    style={{ willChange: "transform" }}>
                    <Icon
                        iconNode={tab.icon as PlatformIcon}
                        size={16}
                        className={tab.iconClassName}
                    />
                </motion.div>
                {(isActive || showLabel) && (
                    <motion.div
                        className="flex items-center"
                        initial={
                            isLoaded && !showLabel
                                ? { opacity: 0, filter: "blur(4px)" }
                                : false
                        }
                        animate={{ opacity: 1, filter: "blur(0px)" }}
                        transition={{
                            duration: isLoaded ? 0.2 : 0,
                            ease: [0.86, 0, 0.07, 1],
                        }}>
                        <motion.span
                            layoutId={
                                plain ? undefined : `text-id-${tab.title}`
                            }
                            className={cn(
                                "text-sm font-medium font-mono uppercase whitespace-nowrap relative inline-block",
                                showLabel && "font-sans normal-case",
                            )}
                            style={{ willChange: "transform" }}>
                            {tab.title}
                        </motion.span>
                    </motion.div>
                )}
                {tab.count !== undefined ? (
                    <span
                        className={cn(
                            "inline-flex min-w-5 items-center justify-center rounded-full bg-foreground/8 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-current",
                            plain && "ml-auto",
                        )}>
                        {tab.count}
                    </span>
                ) : null}
            </motion.div>
        </>
    );

    if (tab.href !== undefined) {
        return (
            <Link
                to={tab.href}
                aria-label={accessibleLabel}
                onMouseEnter={showTooltip}
                onMouseLeave={() => setIsTooltipVisible(false)}
                onFocus={showTooltip}
                onBlur={() => setIsTooltipVisible(false)}
                className={cn(
                    "relative flex h-fit rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                    plain ? "w-full" : "w-fit",
                )}>
                <motion.div
                    style={{ willChange: "transform" }}
                    className={plain ? "w-full" : undefined}
                    whileHover={plain ? undefined : { scale: 1.05 }}>
                    {content}
                </motion.div>
            </Link>
        );
    }

    return (
        <motion.button
            ref={buttonRef}
            type="button"
            layoutId={plain ? undefined : `button-id-${tab.title}`}
            transition={{
                layout: {
                    type: "spring",
                    damping: 20,
                    stiffness: 230,
                    mass: 1.2,
                    ease: [0.215, 0.61, 0.355, 1],
                },
            }}
            onClick={() => {
                setActiveButton(tab.id);
                setIsLoaded(true);
            }}
            onKeyDown={onKeyDown}
            onMouseEnter={showTooltip}
            onMouseLeave={() => setIsTooltipVisible(false)}
            onFocus={showTooltip}
            onBlur={() => setIsTooltipVisible(false)}
            className={cn(
                "relative flex h-fit shrink-0 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                plain ? "w-full" : "w-fit",
            )}
            style={{ willChange: "transform" }}
            whileHover={plain ? undefined : { scale: 1.05 }}
            role="tab"
            aria-selected={isActive}
            aria-label={accessibleLabel}
            tabIndex={isActive ? 0 : -1}>
            {content}
        </motion.button>
    );
};
