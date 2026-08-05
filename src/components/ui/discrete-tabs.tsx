import { Link } from "@tanstack/react-router";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Icon from "@/components/icon";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { PlatformIcon } from "@/types/ui";

const Calendar: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({
    className,
    size = 20,
    ...props
}) => {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width={size}
            height={size}
            viewBox="0 0 20 20"
            className={className}
            {...props}>
            <g fill="currentColor">
                <path d="M5.25 12a.75.75 0 0 1 .75-.75h.01a.75.75 0 0 1 .75.75v.01a.75.75 0 0 1-.75.75H6a.75.75 0 0 1-.75-.75V12ZM6 13.25a.75.75 0 0 0-.75.75v.01c0 .414.336.75.75.75h.01a.75.75 0 0 0 .75-.75V14a.75.75 0 0 0-.75-.75H6ZM7.25 12a.75.75 0 0 1 .75-.75h.01a.75.75 0 0 1 .75.75v.01a.75.75 0 0 1-.75.75H8a.75.75 0 0 1-.75-.75V12ZM8 13.25a.75.75 0 0 0-.75.75v.01c0 .414.336.75.75.75h.01a.75.75 0 0 0 .75-.75V14a.75.75 0 0 0-.75-.75H8ZM9.25 10a.75.75 0 0 1 .75-.75h.01a.75.75 0 0 1 .75.75v.01a.75.75 0 0 1-.75.75H10a.75.75 0 0 1-.75-.75V10Zm.75 1.25a.75.75 0 0 0-.75.75v.01c0 .414.336.75.75.75h.01a.75.75 0 0 0 .75-.75V12a.75.75 0 0 0-.75-.75H10ZM9.25 14a.75.75 0 0 1 .75-.75h.01a.75.75 0 0 1 .75.75v.01a.75.75 0 0 1-.75.75H10a.75.75 0 0 1-.75-.75V14ZM12 9.25a.75.75 0 0 0-.75.75v.01c0 .414.336.75.75.75h.01a.75.75 0 0 0 .75-.75V10a.75.75 0 0 0-.75-.75H12ZM11.25 12a.75.75 0 0 1 .75-.75h.01a.75.75 0 0 1 .75.75v.01a.75.75 0 0 1-.75.75H12a.75.75 0 0 1-.75-.75V12Zm.75 1.25a.75.75 0 0 0-.75.75v.01c0 .414.336.75.75.75h.01a.75.75 0 0 0 .75-.75V14a.75.75 0 0 0-.75-.75H12ZM13.25 10a.75.75 0 0 1 .75-.75h.01a.75.75 0 0 1 .75.75v.01a.75.75 0 0 1-.75.75H14a.75.75 0 0 1-.75-.75V10Zm.75 1.25a.75.75 0 0 0-.75.75v.01c0 .414.336.75.75.75h.01a.75.75 0 0 0 .75-.75V12a.75.75 0 0 0-.75-.75H14Z" />
                <path
                    fillRule="evenodd"
                    d="M5.75 2a.75.75 0 0 1 .75.75V4h7V2.75a.75.75 0 0 1 1.5 0V4h.25A2.75 2.75 0 0 1 18 6.75v8.5A2.75 2.75 0 0 1 15.25 18H4.75A2.75 2.75 0 0 1 2 15.25v-8.5A2.75 2.75 0 0 1 4.75 4H5V2.75A.75.75 0 0 1 5.75 2Zm-1 5.5c-.69 0-1.25.56-1.25 1.25v6.5c0 .69.56 1.25 1.25 1.25h10.5c.69 0 1.25-.56 1.25-1.25v-6.5c0-.69-.56-1.25-1.25-1.25H4.75Z"
                    clipRule="evenodd"
                />
            </g>
        </svg>
    );
};

const Alert: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({
    className,
    size = 20,
    ...props
}) => {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width={size}
            height={size}
            viewBox="0 0 24 24"
            className={className}
            {...props}>
            <path
                fill="currentColor"
                d="M17.1 12.6v-1.8A5.4 5.4 0 0 0 13 5.6V3a1 1 0 0 0-2 0v2.4a5.4 5.4 0 0 0-4 5.5v1.8c0 2.4-1.9 3-1.9 4.2c0 .6 0 1.2.5 1.2h13c.5 0 .5-.6.5-1.2c0-1.2-1.9-1.8-1.9-4.2ZM8.8 19a3.5 3.5 0 0 0 6.4 0z"
            />
        </svg>
    );
};

const Inbox: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({
    className,
    size = 20,
    ...props
}) => {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width={size}
            height={size}
            viewBox="0 0 24 24"
            className={className}
            {...props}>
            <g id="evaEmailFill0">
                <g id="evaEmailFill1">
                    <path
                        id="evaEmailFill2"
                        fill="currentColor"
                        d="M19 4H5a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h14a3 3 0 0 0 3-3V7a3 3 0 0 0-3-3Zm0 2l-6.5 4.47a1 1 0 0 1-1 0L5 6Z"
                    />
                </g>
            </g>
        </svg>
    );
};

export type DiscreteTabItem = {
    id: string;
    title: string;
    icon:
    | React.ComponentType<React.SVGProps<SVGSVGElement> & { size?: number }>
    | PlatformIcon;
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
    /**
     * Clé de persistence de l'onglet actif dans l'URL query.
     * Quand fournie, l'onglet actif est lu puis écrit dans `?key=value`
     * sans déclencher de navigation Inertia.
     */
    persistKey?: string;
};

/**
 * Rend une navigation discrète composée d'onglets locaux et de liens optionnels.
 *
 * Entrées: éléments, valeur active, callback, libellé accessible et clé de persistence optionnelle.
 * Sortie: groupe horizontal scrollable ou rien quand la collection est vide.
 * Effets de bord: maintient la sélection locale, persiste l'onglet dans l'URL si persistKey est fourni.
 */
export default function DiscreteTabs({
    tabs = [
        { id: "Inbox", title: "Inbox", icon: Inbox },
        { id: "Planner", title: "Planner", icon: Calendar },
        { id: "Alerts", title: "Alerts", icon: Alert },
    ],
    value,
    defaultValue,
    onValueChange,
    activeIndex = 0,
    className,
    ariaLabel,
    persistKey,
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

    return (
        <ScrollArea
            className="relative overflow-visible"
            viewportClassName="overflow-x-auto overflow-y-visible py-0.5">
            <nav
                className={cn(
                    "flex w-max min-w-full flex-nowrap items-center gap-4",
                    className,
                )}
                role={hasNavigationDestination ? "navigation" : "tablist"}
                aria-label={ariaLabel}>
                {tabs.map((tab) => (
                    <DiscreteTabButton
                        key={tab.id}
                        tab={tab}
                        isActive={resolvedActiveButton === tab.id}
                        setActiveButton={setActiveButton}
                    />
                ))}
            </nav>
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
    setActiveButton: (nextValue: string) => void;
};

/**
 * Rend un élément de la navigation discrète comme onglet local ou lien Inertia.
 *
 * Entrées: définition de l'élément, état actif et callback de sélection locale.
 * Sortie: contrôle animé conservant le rendu historique du composant.
 * Effets de bord: affiche un tooltip et notifie les sélections locales.
 */
const DiscreteTabButton = ({
    tab,
    isActive,
    setActiveButton,
}: DiscreteTabButtonProps) => {
    const [isLoaded, setIsLoaded] = useState(false);
    const [isTooltipVisible, setIsTooltipVisible] = useState(false);
    const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });
    const accessibleLabel =
        tab.count === undefined ? tab.title : `${tab.title} ${tab.count}`;
    const activeClass =
        "border-foreground/15 bg-background text-foreground shadow-sm";
    const nonActiveClass =
        "border-border/60 bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground";

    /** Positionne le tooltip au-dessus du contrôle actuellement survolé ou ciblé. */
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
                        {isTooltipVisible && (
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
                layout
                transition={{
                    layout: {
                        type: "spring",
                        damping: 20,
                        stiffness: 230,
                        mass: 1.2,
                    },
                }}
                className={cn(
                    "flex min-h-9 cursor-pointer items-center gap-1.5 overflow-hidden rounded-full border px-3 py-2 font-mono text-xs uppercase outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50",
                    isActive ? activeClass : nonActiveClass,
                )}>
                <motion.div
                    layoutId={`icon-id${tab.title}`}
                    className="shrink-0"
                    style={{ willChange: "transform" }}>
                    <Icon iconNode={tab.icon as PlatformIcon} size={16} />
                </motion.div>
                {isActive && (
                    <motion.div
                        className="flex items-center"
                        initial={
                            isLoaded
                                ? { opacity: 0, filter: "blur(4px)" }
                                : false
                        }
                        animate={{ opacity: 1, filter: "blur(0px)" }}
                        transition={{
                            duration: isLoaded ? 0.2 : 0,
                            ease: [0.86, 0, 0.07, 1],
                        }}>
                        <motion.span
                            layoutId={`text-id-${tab.title}`}
                            className="text-sm font-medium font-mono uppercase whitespace-nowrap relative inline-block"
                            style={{ willChange: "transform" }}>
                            {tab.title}
                        </motion.span>
                    </motion.div>
                )}
                {tab.count !== undefined ? (
                    <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-foreground/8 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-current">
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
                className="relative flex h-fit w-fit">
                <motion.div
                    style={{ willChange: "transform" }}
                    whileHover={{ scale: 1.05 }}>
                    {content}
                </motion.div>
            </Link>
        );
    }

    return (
        <motion.button
            type="button"
            layoutId={`button-id-${tab.title}`}
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
            onMouseEnter={showTooltip}
            onMouseLeave={() => setIsTooltipVisible(false)}
            onFocus={showTooltip}
            onBlur={() => setIsTooltipVisible(false)}
            className="relative flex h-fit w-fit shrink-0"
            style={{ willChange: "transform" }}
            whileHover={{ scale: 1.05 }}
            role="tab"
            aria-selected={isActive}
            aria-label={accessibleLabel}
            tabIndex={isActive ? 0 : -1}>
            {content}
        </motion.button>
    );
};
