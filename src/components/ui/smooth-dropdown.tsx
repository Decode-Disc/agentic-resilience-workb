"use client";

import {
    MoreHorizontalCircle01Icon,
} from '@hugeicons/core-free-icons';
import { motion } from 'motion/react';
import {
    type CSSProperties,
    isValidElement,
    type ReactNode,
    useEffect,
    useRef,
    useState,
} from 'react';
import { createPortal } from 'react-dom';
import Icon from '@/components/icon';
import { uiLayerClasses } from '@/lib/ui-layers';
import { cn } from '@/lib/utils';
import type { PlatformIcon } from '@/types/ui';


type RenderState = {
    isActive: boolean;
    isHovered: boolean;
    showIndicator: boolean;
};

export type SmoothDropdownItem =
    | {
        id: string;
        type?: 'item';
        label: string;
        icon?: PlatformIcon | ReactNode;
        variant?: 'default' | 'destructive';
        closeOnSelect?: boolean;
        onSelect?: () => void;
        renderLabel?: (state: RenderState) => ReactNode;
    }
    | {
        id: string;
        type: 'divider';
    };

export interface SmoothDropdownProps {
    items: SmoothDropdownItem[];
    trigger?: ReactNode;
    header?: ReactNode;
    openPosition?: 'bottom' | 'top';
    openFrom?: 'left' | 'right';
    portalContainer?: Element | DocumentFragment | null;
    className?: string;
    menuClassName?: string;
    closedWidth?: number;
    openWidth?: number;
    closedHeight?: number;
    defaultActiveItemId?: string;
    style?: CSSProperties;
}

const easeOutQuint: [number, number, number, number] = [0.23, 1, 0.32, 1];

export function SmoothDropdwon({
    items,
    trigger,
    header,
    openPosition = 'bottom',
    openFrom = 'left',
    portalContainer = null,
    className,
    menuClassName,
    closedWidth = 40,
    openWidth = 220,
    closedHeight = 40,
    defaultActiveItemId,
    style,
}: SmoothDropdownProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [activeItem, setActiveItem] = useState<string | null>(
        defaultActiveItemId ??
        null,
    );
    const [hoveredItem, setHoveredItem] = useState<string | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const [contentHeight, setContentHeight] = useState(0);
    const [portalStyle, setPortalStyle] = useState<CSSProperties>({});

    useEffect(() => {
        const contentElement = contentRef.current;

        if (!contentElement) {
            return;
        }

        const updateHeight = () => {
            const nextHeight =
                contentElement.getBoundingClientRect().height || contentElement.scrollHeight;

            setContentHeight((currentHeight) =>
                currentHeight === nextHeight ? currentHeight : nextHeight,
            );
        };

        updateHeight();

        if (typeof ResizeObserver === 'undefined') {
            return;
        }

        const observer = new ResizeObserver(() => {
            updateHeight();
        });

        observer.observe(contentElement);

        return () => {
            observer.disconnect();
        };
    }, [header, isOpen, items.length]);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            const target = event.target as Node;

            // Ignorer les clics dans les portals Radix ouverts (Popover, Dialog…)
            // qui sont attachés sur <body> et donc hors du containerRef.
            const insideRadixPortal = (event.target as Element)?.closest(
                '[data-radix-popper-content-wrapper]',
            );

            if (
                containerRef.current &&
                !containerRef.current.contains(target) &&
                !menuRef.current?.contains(target) &&
                !insideRadixPortal
            ) {
                setIsOpen(false);
            }
        };

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () =>
            document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen]);

    const openHeight = Math.max(closedHeight, Math.ceil(contentHeight));
    const opensToLeft = openFrom === 'right';
    const isPortalled = portalContainer !== null;

    useEffect(() => {
        if (!isPortalled || !isOpen || !containerRef.current) {
            return;
        }

        const updatePortalPosition = () => {
            const rect = containerRef.current?.getBoundingClientRect();

            if (!rect) {
                return;
            }

            setPortalStyle({
                ...(openPosition === 'top'
                    ? { bottom: Math.max(0, window.innerHeight - rect.bottom) }
                    : { top: Math.max(0, rect.top) }),
                ...(opensToLeft
                    ? { right: Math.max(0, window.innerWidth - rect.right) }
                    : { left: Math.max(0, rect.left) }),
            });
        };

        updatePortalPosition();

        window.addEventListener('resize', updatePortalPosition);
        window.addEventListener('scroll', updatePortalPosition, true);

        return () => {
            window.removeEventListener('resize', updatePortalPosition);
            window.removeEventListener('scroll', updatePortalPosition, true);
        };
    }, [isOpen, isPortalled, openPosition, opensToLeft]);

    const effectiveOpenWidth = (() => {
        if (!containerRef.current) return openWidth;
        const rect = containerRef.current.getBoundingClientRect();
        const available = opensToLeft ? rect.right : window.innerWidth - rect.left;
        return Math.min(openWidth, Math.floor(available));
    })();
    const itemClosedOffset = opensToLeft ? 8 : -8;

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

    const menuOriginClass = openPosition === 'top'
        ? opensToLeft
            ? 'origin-bottom-right'
            : 'origin-bottom-left'
        : opensToLeft
            ? 'origin-top-right'
            : 'origin-top-left';

    const menuPositionClass = cn(
        'absolute cursor-pointer overflow-hidden border border-border bg-popover shadow-lg',
        opensToLeft ? 'right-0' : 'left-0',
        openPosition === 'top' ? 'bottom-0' : 'top-0',
        menuOriginClass,
    );

    const menuContent = (
        <>
            <motion.div
                initial={false}
                animate={{
                    opacity: isOpen ? 0 : 1,
                    scale: isOpen ? 0.8 : 1,
                }}
                transition={{ duration: 0.15 }}
                className="absolute inset-0 flex items-center justify-center"
                style={{
                    pointerEvents: isOpen ? 'none' : 'auto',
                    willChange: 'transform',
                }}
            >
                {trigger ?? (
                    <Icon
                        iconNode={MoreHorizontalCircle01Icon}
                        className="h-6 w-6 text-muted-foreground"
                    />
                )}
            </motion.div>

            <div ref={contentRef}>
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
                    className={cn('p-2', menuClassName)}
                    style={{
                        pointerEvents: isOpen ? 'auto' : 'none',
                        willChange: 'transform',
                    }}
                >
                    {header ? <div className="mb-2">{header}</div> : null}

                    <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
                        {items.map((item, index) => {
                            if (item.type === 'divider') {
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

                            const isActive = activeItem === item.id;
                            const isDestructive =
                                item.variant === 'destructive';
                            const showIndicator = hoveredItem
                                ? hoveredItem === item.id
                                : isActive;

                            const itemDuration = isDestructive
                                ? 0.12
                                : 0.15;
                            const itemDelay = isOpen ? 0.06 + index * 0.02 : 0;

                            return (
                                <motion.li
                                    key={item.id}
                                    initial={{ opacity: 0, x: itemClosedOffset }}
                                    animate={{
                                        opacity: isOpen ? 1 : 0,
                                        x: isOpen ? 0 : itemClosedOffset,
                                    }}
                                    transition={{
                                        delay: itemDelay,
                                        duration: itemDuration,
                                        ease: easeOutQuint,
                                    }}
                                    onClick={() => {
                                        setActiveItem(item.id);

                                        item.onSelect?.();

                                        if (item.closeOnSelect !== false) {
                                            setIsOpen(false);
                                        }
                                    }}
                                    onMouseEnter={() => setHoveredItem(item.id)}
                                    onMouseLeave={() => setHoveredItem(null)}
                                    className={cn(
                                        'relative m-0 flex cursor-pointer items-center gap-3 rounded-lg py-2 pl-3 text-sm transition-colors duration-200 ease-out',
                                        isDestructive && showIndicator
                                            ? 'text-destructive'
                                            : isActive
                                                ? 'text-foreground'
                                                : isDestructive
                                                    ? 'text-foreground/80 hover:text-destructive'
                                                    : 'text-foreground/80 hover:text-foreground',
                                    )}
                                >
                                    {showIndicator && (
                                        <motion.div
                                            layoutId="activeIndicator"
                                            className={cn(
                                                'absolute inset-0 rounded',
                                                isDestructive
                                                    ? 'bg-destructive/10'
                                                    : 'bg-accent/40',
                                            )}
                                            transition={{
                                                type: 'spring',
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
                                                'absolute top-0 bottom-0 left-0 my-auto h-5 w-0.75 rounded-full',
                                                isDestructive
                                                    ? 'bg-destructive'
                                                    : 'bg-foreground',
                                            )}
                                            transition={{
                                                type: 'spring',
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
                                </motion.li>
                            );
                        })}
                    </ul>
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
            data-open-from={openFrom}
            data-open-position={openPosition}
            data-portalled={isPortalled && isOpen ? 'true' : 'false'}
            animate={{
                width: isOpen ? effectiveOpenWidth : closedWidth,
                height: isOpen ? openHeight : closedHeight,
                borderRadius: isOpen ? 14 : 12,
            }}
            transition={{
                type: 'spring' as const,
                damping: 34,
                stiffness: 380,
                mass: 0.8,
            }}
            className={cn(
                isPortalled && isOpen
                    ? 'fixed cursor-pointer overflow-hidden border border-border bg-popover shadow-lg'
                    : menuPositionClass,
                isPortalled && isOpen && uiLayerClasses.modal,
                isPortalled && isOpen && menuOriginClass,
            )}
            style={isPortalled && isOpen ? portalStyle : undefined}
            onClick={() => !isOpen && setIsOpen(true)}
        >
            {menuContent}
        </motion.div>
    );

    return (
        <div
            ref={containerRef}
            data-testid="smooth-dropdown-container"
            className={cn('relative not-prose', className)}
            style={{ width: closedWidth, height: closedHeight, ...style }}
        >
            {isPortalled ? (
                <>
                    <button
                        type="button"
                        aria-label="Open dropdown"
                        className="absolute inset-0 cursor-pointer overflow-hidden rounded-md border border-border bg-popover shadow-lg"
                        onClick={() => setIsOpen(true)}
                    >
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