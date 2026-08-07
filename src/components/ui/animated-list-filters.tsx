import { FilterIcon, Tick01Icon } from "@hugeicons/core-free-icons";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import Icon from "@/components/icon";
import { cn } from "@/lib/utils";
import type { PlatformIcon } from "@/types/ui";

export type AnimatedListFilterOption<TValue extends string> = {
    value: TValue;
    label: string;
    icon: PlatformIcon;
};

type AnimatedListFilterProps<TValue extends string> = {
    label: string;
    value: TValue;
    options: ReadonlyArray<AnimatedListFilterOption<TValue>>;
    onChange: (value: TValue) => void;
    align?: "start" | "center" | "end";
    alignOffset?: number;
    side?: "top" | "bottom" | "left" | "right";
    sideOffset?: number;
    className?: string;
};

function getPositionStyle(
    side: "top" | "bottom" | "left" | "right",
    sideOffset: number,
    align: "start" | "center" | "end",
    alignOffset: number,
): React.CSSProperties {
    const style: React.CSSProperties = {};

    if (side === "bottom") {
        style.top = `calc(100% + ${sideOffset}px)`;
    } else if (side === "top") {
        style.bottom = `calc(100% + ${sideOffset}px)`;
    } else if (side === "left") {
        style.right = `calc(100% + ${sideOffset}px)`;
    } else if (side === "right") {
        style.left = `calc(100% + ${sideOffset}px)`;
    }

    if (side === "bottom" || side === "top") {
        if (align === "start") {
            style.left = `${alignOffset}px`;
        } else if (align === "end") {
            style.right = `${-alignOffset}px`;
        } else if (align === "center") {
            style.left = `calc(50% + ${alignOffset}px)`;
            style.translate = "-50% 0";
        }
    } else {
        if (align === "start") {
            style.top = `${alignOffset}px`;
        } else if (align === "end") {
            style.bottom = `${-alignOffset}px`;
        } else if (align === "center") {
            style.top = `calc(50% + ${alignOffset}px)`;
            style.translate = "0 -50%";
        }
    }

    return style;
}

function getMotionVariants(
    side: "top" | "bottom" | "left" | "right",
    shouldReduceMotion: boolean | null,
) {
    if (shouldReduceMotion) {
        return {
            initial: false,
            animate: { opacity: 1, scale: 1 },
            exit: { opacity: 0 },
        };
    }

    switch (side) {
        case "top":
            return {
                initial: { opacity: 0, y: 6, scale: 0.98 },
                animate: { opacity: 1, y: 0, scale: 1 },
                exit: { opacity: 0, y: 4, scale: 0.98 },
            };
        case "bottom":
            return {
                initial: { opacity: 0, y: -6, scale: 0.98 },
                animate: { opacity: 1, y: 0, scale: 1 },
                exit: { opacity: 0, y: -4, scale: 0.98 },
            };
        case "left":
            return {
                initial: { opacity: 0, x: 6, scale: 0.98 },
                animate: { opacity: 1, x: 0, scale: 1 },
                exit: { opacity: 0, x: 4, scale: 0.98 },
            };
        case "right":
            return {
                initial: { opacity: 0, x: -6, scale: 0.98 },
                animate: { opacity: 1, x: 0, scale: 1 },
                exit: { opacity: 0, x: -4, scale: 0.98 },
            };
    }
}

/** Accessible compact selector for secondary list filters. */
export default function AnimatedListFilter<TValue extends string>({
    label,
    value,
    options,
    onChange,
    align = "start",
    alignOffset = 0,
    side = "bottom",
    sideOffset = 4,
    className,
}: AnimatedListFilterProps<TValue>) {
    const [isOpen, setIsOpen] = useState(false);
    const shouldReduceMotion = useReducedMotion();
    const panelId = useId();
    const rootRef = useRef<HTMLElement | null>(null);
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
    const selectedIndex = Math.max(
        0,
        options.findIndex((option) => option.value === value),
    );
    const selectedOption = useMemo(
        () => options[selectedIndex] ?? options[0],
        [options, selectedIndex],
    );

    const positionStyle = useMemo(
        () => getPositionStyle(side, sideOffset, align, alignOffset),
        [side, sideOffset, align, alignOffset],
    );
    const motionVariants = useMemo(
        () => getMotionVariants(side, shouldReduceMotion),
        [side, shouldReduceMotion],
    );

    const close = (restoreFocus: boolean) => {
        setIsOpen(false);
        if (restoreFocus) {
            triggerRef.current?.focus();
        }
    };

    useEffect(() => {
        if (!isOpen) {
            return;
        }
        optionRefs.current[selectedIndex]?.focus();
        const handleOutsidePointer = (event: PointerEvent) => {
            if (!rootRef.current?.contains(event.target as Node)) {
                close(false);
            }
        };
        document.addEventListener("pointerdown", handleOutsidePointer);
        return () => {
            document.removeEventListener("pointerdown", handleOutsidePointer);
        };
    }, [isOpen, selectedIndex]);

    const moveFocus = (currentIndex: number, key: string) => {
        let nextIndex: number | null = null;
        if (key === "ArrowDown" || key === "ArrowRight") {
            nextIndex = (currentIndex + 1) % options.length;
        } else if (key === "ArrowUp" || key === "ArrowLeft") {
            nextIndex = (currentIndex - 1 + options.length) % options.length;
        } else if (key === "Home") {
            nextIndex = 0;
        } else if (key === "End") {
            nextIndex = options.length - 1;
        }
        if (nextIndex !== null) {
            optionRefs.current[nextIndex]?.focus();
        }
    };

    if (!selectedOption) {
        return null;
    }

    return (
        <section ref={rootRef} className={cn("relative", className)}>
            <button
                ref={triggerRef}
                type="button"
                aria-label={`${label}: ${selectedOption.label}`}
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={() => setIsOpen((open) => !open)}
                className="surface-panel inline-flex h-9 items-center gap-2 rounded-full border border-border/60 px-3 text-xs text-muted-foreground transition-colors hover:text-foreground">
                <Icon iconNode={FilterIcon} size={16} />
                <Icon iconNode={selectedOption.icon} size={15} />
                <span>{selectedOption.label}</span>
            </button>

            <AnimatePresence>
                {isOpen ? (
                    <motion.section
                        id={panelId}
                        role="dialog"
                        aria-label={label}
                        style={positionStyle}
                        initial={motionVariants.initial}
                        animate={motionVariants.animate}
                        exit={motionVariants.exit}
                        transition={{
                            duration: shouldReduceMotion ? 0 : 0.18,
                            ease: [0.32, 0.72, 0, 1],
                        }}
                        className="surface-floating absolute z-30 w-64 rounded-2xl border border-border/60 p-1.5">
                        <div className="flex items-center justify-between px-2 py-1.5 text-xs text-muted-foreground">
                            <span>{label}</span>
                            <button
                                type="button"
                                className="rounded-md px-2 py-1 hover:bg-accent"
                                onClick={() => close(true)}>
                                Done
                            </button>
                        </div>
                        <div role="radiogroup" aria-label={label}>
                            {options.map((option, index) => {
                                const isSelected = option.value === value;
                                return (
                                    <motion.button
                                        key={option.value}
                                        ref={(node) => {
                                            optionRefs.current[index] = node;
                                        }}
                                        type="button"
                                        role="radio"
                                        aria-checked={isSelected}
                                        tabIndex={
                                            index === selectedIndex ? 0 : -1
                                        }
                                        initial={
                                            shouldReduceMotion
                                                ? false
                                                : { opacity: 0, y: 8 }
                                        }
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{
                                            duration: shouldReduceMotion
                                                ? 0
                                                : 0.16,
                                            delay: shouldReduceMotion
                                                ? 0
                                                : index * 0.025,
                                            ease: [0.32, 0.72, 0, 1],
                                        }}
                                        onClick={() => {
                                            onChange(option.value);
                                            close(true);
                                        }}
                                        onKeyDown={(event) => {
                                            if (event.key === "Escape") {
                                                event.preventDefault();
                                                close(true);
                                                return;
                                            }
                                            if (
                                                event.key === "Enter" ||
                                                event.key === " "
                                            ) {
                                                event.preventDefault();
                                                onChange(option.value);
                                                close(true);
                                                return;
                                            }
                                            if (
                                                [
                                                    "ArrowDown",
                                                    "ArrowRight",
                                                    "ArrowUp",
                                                    "ArrowLeft",
                                                    "Home",
                                                    "End",
                                                ].includes(event.key)
                                            ) {
                                                event.preventDefault();
                                                moveFocus(index, event.key);
                                            }
                                        }}
                                        className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-sm text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                                        <span className="flex items-center gap-3">
                                            <Icon
                                                iconNode={option.icon}
                                                size={18}
                                                className="text-muted-foreground"
                                            />
                                            {option.label}
                                        </span>
                                        <span
                                            className={cn(
                                                "flex size-5 items-center justify-center rounded-full border border-border",
                                                isSelected &&
                                                    "border-primary bg-primary text-primary-foreground",
                                            )}>
                                            {isSelected ? (
                                                <Icon
                                                    iconNode={Tick01Icon}
                                                    size={13}
                                                />
                                            ) : null}
                                        </span>
                                    </motion.button>
                                );
                            })}
                        </div>
                    </motion.section>
                ) : null}
            </AnimatePresence>
        </section>
    );
}
