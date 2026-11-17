"use client";

import { MoreHorizontalCircle01Icon } from "@hugeicons/core-free-icons";
import { motion } from "motion/react";
import {
    type CSSProperties,
    isValidElement,
    type ReactNode,
    useEffect,
    useRef,
    useState,
} from "react";
import { createPortal } from "react-dom";
import Icon from "@/components/icon";
import { uiLayerClasses } from "@/lib/ui-layers";
import { cn } from "@/lib/utils";
import type { PlatformIcon } from "@/types/ui";

type RenderState = {
    isActive: boolean;
    isHovered: boolean;
    showIndicator: boolean;
};

export type SmoothDropdownItem =
    | {
          id: string;
          type?: "item";
          label: string;
          icon?: PlatformIcon | ReactNode;
          variant?: "default" | "destructive";
          closeOnSelect?: boolean;
          onSelect?: () => void;
          renderLabel?: (state: RenderState) => ReactNode;
      }
    | {
          id: string;
          type: "divider";
      };

export interface SmoothDropdownProps {
    items: SmoothDropdownItem[];
    trigger?: ReactNode;
    header?: ReactNode;
    footer?: ReactNode;
    openPosition?: "bottom" | "top";
    openFrom?: "left" | "right";
    align?: "start" | "center" | "end";
    alignOffset?: number;
    portalContainer?: Element | DocumentFragment | null;
    className?: string;
    menuClassName?: string;
    itemsAriaLabel?: string;
    closedWidth?: number;
    openWidth?: number;
    closedHeight?: number;
    defaultActiveItemId?: string;
    /** Controlled selection, independent of the current filtered items. */
    activeItemId?: string;
    /** Accessible name of the portalled menu’s persistent trigger. */
    triggerAriaLabel?: string;
    triggerClassName?: string;
    /** Consumer-specific closed geometry; the expanded menu retains its shared shape. */
    closedRadius?: number;
    style?: CSSProperties;
    /**
     * Optional controlled open state. When omitted, the dropdown manages its
     * own open/close toggling exactly as before. When provided, the parent
     * owns the open state and must apply changes via `onOpenChange`.
     */
    open?: boolean;
    /**
     * Optional controlled default. Same contract as `open` but uncontrolled:
     * used only for the initial render when `open` is not provided.
     */
    defaultOpen?: boolean;
    /** Notified whenever the dropdown requests an open state change. */
    onOpenChange?: (open: boolean) => void;
}

const easeOutQuint: [number, number, number, number] = [0.23, 1, 0.32, 1];

export function SmoothDropdwon({
    items,
    trigger,
    header,
    footer,
    openPosition = "bottom",
    openFrom = "left",
    align,
    alignOffset = 0,
    portalContainer = null,
    className,
    menuClassName,
    itemsAriaLabel = "Dropdown options",
    closedWidth = 40,
    openWidth = 220,
    closedHeight = 40,
    defaultActiveItemId,
    activeItemId,
    triggerAriaLabel = "Open dropdown",
    triggerClassName,
    closedRadius = 12,
    style,
    open: openProp,
    defaultOpen = false,
    onOpenChange,
}: SmoothDropdownProps) {
    const [internalOpen, setInternalOpen] = useState(defaultOpen);
    const isControlled = openProp !== undefined;
    const isOpen = isControlled ? Boolean(openProp) : internalOpen;

    const requestOpenChange = (next: boolean) => {
        if (!isControlled) {
            setInternalOpen(next);
        }
        onOpenChange?.(next);
    };
    const [activeItem, setActiveItem] = useState<string | null>(
        defaultActiveItemId ?? null,
    );
    const [hoveredItem, setHoveredItem] = useState<string | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const triggerContentRef = useRef<HTMLDivElement>(null);
    const restoreTriggerFocus = useRef(false);
    const [contentHeight, setContentHeight] = useState(0);
    const [portalStyle, setPortalStyle] = useState<CSSProperties>({});

    useEffect(() => {
        if (isOpen) {
            contentRef.current
                ?.querySelector<HTMLElement>(
                    "input:not(:disabled), textarea:not(:disabled), [role=option]:not([aria-disabled=true])",
                )
                ?.focus();
        } else if (restoreTriggerFocus.current) {
            const triggerButton =
                triggerContentRef.current?.querySelector<HTMLButtonElement>(
                    "button",
                ) ??
                containerRef.current?.querySelector<HTMLButtonElement>(
                    "button",
                );
            triggerButton?.focus();
            restoreTriggerFocus.current = false;
        }
    }, [isOpen]);

    useEffect(() => {
        const contentElement = contentRef.current;

        if (!contentElement) {
            return;
        }

        const updateHeight = () => {
            const nextHeight =
                contentElement.getBoundingClientRect().height ||
                contentElement.scrollHeight;

            setContentHeight((currentHeight) =>
                currentHeight === nextHeight ? currentHeight : nextHeight,
            );
        };

        updateHeight();

        if (typeof ResizeObserver === "undefined") {
            return;
        }

        const observer = new ResizeObserver(() => {
            updateHeight();
        });

        observer.observe(contentElement);

        return () => {
            observer.disconnect();
        };
    }, [footer, header, isOpen, items.length]);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            const target = event.target as Node;

            // Ignorer les clics dans les portals Radix ouverts (Popover, Dialog…)
            // qui sont attachés sur <body> et donc hors du containerRef.
            const insideRadixPortal = (event.target as Element)?.closest(
                "[data-radix-popper-content-wrapper]",
            );

            if (
                containerRef.current &&
                !containerRef.current.contains(target) &&
                !menuRef.current?.contains(target) &&
                !insideRadixPortal
            ) {
                requestOpenChange(false);
            }
        };

        if (isOpen) {
            document.addEventListener("mousedown", handleClickOutside);
        }
        return () =>
            document.removeEventListener("mousedown", handleClickOutside);
    }, [isOpen, isControlled]);

    const openHeight = Math.max(closedHeight, Math.ceil(contentHeight));
    const resolvedAlign = align ?? (openFrom === "right" ? "end" : "start");
    const opensToLeft = resolvedAlign === "end";
    const isCentered = resolvedAlign === "center";
    const isPortalled = portalContainer !== null;

    const effectiveOpenWidth = (() => {
        if (!containerRef.current) return openWidth;
        const rect = containerRef.current.getBoundingClientRect();
        const available = isCentered
            ? window.innerWidth - 16
            : opensToLeft
              ? rect.right - alignOffset
              : window.innerWidth - rect.left - alignOffset;
        return Math.min(openWidth, Math.floor(available));
    })();
    const itemClosedOffset = opensToLeft ? 8 : -8;

    useEffect(() => {
        if (!isPortalled || !isOpen || !containerRef.current) {
            return;
        }

        const updatePortalPosition = () => {
            const rect = containerRef.current?.getBoundingClientRect();

            if (!rect) {
                return;
            }

            const horizontalStyle: CSSProperties = isCentered
                ? {
                      left: Math.max(
                          8,
                          Math.min(
                              rect.left +
                                  rect.width / 2 -
                                  effectiveOpenWidth / 2 +
                                  alignOffset,
                              window.innerWidth - effectiveOpenWidth - 8,
                          ),
                      ),
                  }
                : opensToLeft
                  ? {
                        right: Math.max(
                            0,
                            window.innerWidth - rect.right - alignOffset,
                        ),
                    }
                  : {
                        left: Math.max(0, rect.left + alignOffset),
                    };

            setPortalStyle({
                ...(openPosition === "top"
                    ? { bottom: Math.max(0, window.innerHeight - rect.bottom) }
                    : { top: Math.max(0, rect.top) }),
                ...horizontalStyle,
            });
        };

        updatePortalPosition();

        window.addEventListener("resize", updatePortalPosition);
        window.addEventListener("scroll", updatePortalPosition, true);

        return () => {
            window.removeEventListener("resize", updatePortalPosition);
            window.removeEventListener("scroll", updatePortalPosition, true);
        };
    }, [
        alignOffset,
        effectiveOpenWidth,
        isCentered,
        isOpen,
        isPortalled,
        openPosition,
        opensToLeft,
    ]);

    const renderItemIcon = (icon: PlatformIcon | ReactNode | undefined) => {
        if (!icon) {
            return null;
        }

        if (isValidElement(icon)) {
            return <span className="relative z-10">{icon}</span>;
        }

        return (
            <Icon
                iconNode={icon as PlatformIcon}
                className="relative z-10 h-4.5 w-4.5"
            />
        );
    };

    const menuOriginClass =
        openPosition === "top"
            ? isCentered
                ? "origin-bottom"
                : opensToLeft
                  ? "origin-bottom-right"
                  : "origin-bottom-left"
            : isCentered
              ? "origin-top"
              : opensToLeft
                ? "origin-top-right"
                : "origin-top-left";

    const menuPositionClass = cn(
        "absolute cursor-pointer overflow-hidden border border-border bg-popover shadow-lg",
        isCentered
            ? "left-1/2 -translate-x-1/2"
            : opensToLeft
              ? "right-0"
              : "left-0",
        openPosition === "top" ? "bottom-0" : "top-0",
        menuOriginClass,
    );

    const menuContent = (
        <>
            <motion.div
                ref={triggerContentRef}
                aria-hidden={isOpen}
                inert={isOpen}
                initial={false}
                animate={{
                    opacity: isOpen ? 0 : 1,
                    scale: isOpen ? 0.8 : 1,
                }}
                transition={{ duration: 0.15 }}
                className="absolute inset-0 flex items-center justify-center"
                style={{
                    pointerEvents: isOpen ? "none" : "auto",
                    willChange: "transform",
                }}>
                {trigger ?? (
                    <Icon
                        iconNode={MoreHorizontalCircle01Icon}
                        className="h-6 w-6 text-muted-foreground"
                    />
                )}
            </motion.div>

            <div ref={contentRef} aria-hidden={!isOpen} inert={!isOpen}>
                <motion.div
                    layout
                    initial={false}
                    animate={{
                        opacity: isOpen ? 1 : 0,
                    }}
                    transition={{
                        duration: isOpen ? 0.08 : 0.3,
                        delay: isOpen ? 0.08 : 0.2,
                    }}
                    className={cn("p-2", menuClassName)}
                    style={{
                        pointerEvents: isOpen ? "auto" : "none",
                        willChange: "transform",
                    }}>
                    {header ? <div className="mb-2">{header}</div> : null}

                    <div
                        role="listbox"
                        aria-label={itemsAriaLabel}
                        className="m-0 flex list-none flex-col gap-0.5 p-0">
                        {items.map((item, index) => {
                            if (item.type === "divider") {
                                return (
                                    <motion.hr
                                        key={item.id}
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: isOpen ? 1 : 0 }}
                                        transition={{
                                            delay: isOpen
                                                ? 0.12 + index * 0.015
                                                : 0,
                                        }}
                                        className="my-1.5 border-border"
                                    />
                                );
                            }

                            const isActive =
                                (activeItemId ?? activeItem) === item.id;
                            const isDestructive =
                                item.variant === "destructive";
                            const showIndicator = hoveredItem
                                ? hoveredItem === item.id
                                : isActive;

                            const itemDuration = isDestructive ? 0.12 : 0.15;
                            const itemDelay = isOpen ? 0.06 + index * 0.02 : 0;
                            const selectItem = () => {
                                setActiveItem(item.id);
                                item.onSelect?.();
                                if (item.closeOnSelect !== false) {
                                    restoreTriggerFocus.current = true;
                                    requestOpenChange(false);
                                }
                            };

                            return (
                                <motion.div
                                    key={item.id}
                                    role="option"
                                    aria-selected={isActive}
                                    tabIndex={isOpen ? 0 : -1}
                                    initial={{
                                        opacity: 0,
                                        x: itemClosedOffset,
                                    }}
                                    animate={{
                                        opacity: isOpen ? 1 : 0,
                                        x: isOpen ? 0 : itemClosedOffset,
                                    }}
                                    transition={{
                                        delay: itemDelay,
                                        duration: itemDuration,
                                        ease: easeOutQuint,
                                    }}
                                    onClick={(event) => {
                                        // Stop the click from bubbling back up to
                                        // the menu surface (which re-opens when
                                        // closed) — otherwise selecting an item
                                        // closes then immediately reopens the
                                        // picker in the same event tick.
                                        event.stopPropagation();
                                        selectItem();
                                    }}
                                    onKeyDown={(event) => {
                                        if (
                                            event.key === "Enter" ||
                                            event.key === " "
                                        ) {
                                            event.preventDefault();
                                            event.stopPropagation();
                                            selectItem();
                                        }
                                    }}
                                    onMouseEnter={() => setHoveredItem(item.id)}
                                    onMouseLeave={() => setHoveredItem(null)}
                                    className={cn(
                                        "relative m-0 flex cursor-pointer items-center gap-3 rounded-lg py-2 pl-3 text-sm transition-colors duration-200 ease-out",
                                        isDestructive && showIndicator
                                            ? "text-destructive"
                                            : isActive
                                              ? "text-foreground"
                                              : isDestructive
                                                ? "text-foreground/80 hover:text-destructive"
                                                : "text-foreground/80 hover:text-foreground",
                                    )}>
                                    {showIndicator && (
                                        <motion.div
                                            layoutId="activeIndicator"
                                            className={cn(
                                                "absolute inset-0 rounded",
                                                isDestructive
                                                    ? "bg-destructive/10"
                                                    : "bg-accent/60",
                                            )}
                                            transition={{
                                                type: "spring",
                                                damping: 30,
                                                stiffness: 520,
                                                mass: 0.8,
                                            }}
                                        />
                                    )}
                                    {showIndicator && (
                                        <motion.div
                                            layoutId="leftBar"
                                            className={cn(
                                                "absolute top-0 bottom-0 left-0 my-auto h-5 w-0.75 rounded-full",
                                                isDestructive
                                                    ? "bg-destructive"
                                                    : "bg-accent-foreground",
                                            )}
                                            transition={{
                                                type: "spring",
                                                damping: 30,
                                                stiffness: 520,
                                                mass: 0.8,
                                            }}
                                        />
                                    )}
                                    {renderItemIcon(item.icon)}
                                    {item.renderLabel ? (
                                        <span className="relative z-10 flex-1">
                                            {item.renderLabel({
                                                isActive,
                                                isHovered:
                                                    hoveredItem === item.id,
                                                showIndicator,
                                            })}
                                        </span>
                                    ) : (
                                        <span className="relative z-10 font-medium">
                                            {item.label}
                                        </span>
                                    )}
                                </motion.div>
                            );
                        })}
                    </div>
                    {footer ? <div className="mt-2">{footer}</div> : null}
                </motion.div>
            </div>
        </>
    );

    const menuNode = (
        <motion.div
            ref={menuRef}
            layout
            initial={false}
            data-testid="smooth-dropdown-menu"
            data-align={resolvedAlign}
            data-open-from={opensToLeft ? "right" : "left"}
            data-open-position={openPosition}
            data-portalled={isPortalled && isOpen ? "true" : "false"}
            animate={{
                width: isOpen ? effectiveOpenWidth : closedWidth,
                height: isOpen ? openHeight : closedHeight,
                borderRadius: isOpen ? 14 : closedRadius,
            }}
            transition={{
                type: "spring" as const,
                damping: 34,
                stiffness: 380,
                mass: 0.8,
            }}
            className={cn(
                isPortalled && isOpen
                    ? "fixed cursor-pointer overflow-hidden border border-border bg-popover shadow-lg"
                    : menuPositionClass,
                isPortalled && isOpen && uiLayerClasses.popup,
                isPortalled && isOpen && menuOriginClass,
            )}
            style={isPortalled && isOpen ? portalStyle : undefined}
            onClick={() => !isOpen && requestOpenChange(true)}>
            {menuContent}
        </motion.div>
    );

    return (
        <div
            ref={containerRef}
            role="group"
            onKeyDown={(event) => {
                if (
                    isOpen &&
                    (event.key === "ArrowDown" || event.key === "ArrowUp")
                ) {
                    const options = Array.from(
                        contentRef.current?.querySelectorAll<HTMLElement>(
                            '[role="option"]:not([aria-disabled="true"])',
                        ) ?? [],
                    );
                    if (options.length) {
                        const current = options.findIndex((option) =>
                            option.contains(event.target as Node),
                        );
                        const next =
                            current < 0
                                ? event.key === "ArrowDown"
                                    ? 0
                                    : options.length - 1
                                : (current +
                                      (event.key === "ArrowDown" ? 1 : -1) +
                                      options.length) %
                                  options.length;
                        event.preventDefault();
                        event.stopPropagation();
                        options[next]?.focus();
                    }
                }
                if (isOpen && event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    restoreTriggerFocus.current = true;
                    requestOpenChange(false);
                }
            }}
            data-testid="smooth-dropdown-container"
            data-open={isOpen ? "true" : undefined}
            className={cn("relative not-prose", className)}
            style={{ width: closedWidth, height: closedHeight, ...style }}>
            {isPortalled ? (
                <>
                    <button
                        type="button"
                        aria-label={triggerAriaLabel}
                        aria-expanded={isOpen}
                        aria-haspopup="listbox"
                        style={{ borderRadius: closedRadius }}
                        className={cn(
                            "absolute inset-0 cursor-pointer overflow-hidden border border-border bg-popover shadow-lg",
                            triggerClassName,
                        )}
                        onClick={() => requestOpenChange(true)}>
                        <div className="absolute inset-0 flex items-center justify-center">
                            {trigger ?? (
                                <Icon
                                    iconNode={MoreHorizontalCircle01Icon}
                                    className="h-6 w-6 text-muted-foreground"
                                />
                            )}
                        </div>
                    </button>

                    {isOpen ? createPortal(menuNode, portalContainer) : null}
                </>
            ) : (
                menuNode
            )}
        </div>
    );
}
