'use client';

import { motion, useReducedMotion } from 'motion/react';
import type { ComponentPropsWithoutRef, MouseEvent } from 'react';
import { useId, useState } from 'react';

import { cn } from '@/lib/utils';

type LiquidGlassCardProps = Omit<
    ComponentPropsWithoutRef<typeof motion.div>,
    'children' | 'drag'
> & {
    children: React.ReactNode;
    draggable?: boolean;
    expandable?: boolean;
    width?: string;
    height?: string;
    expandedWidth?: string;
    expandedHeight?: string;
    blurIntensity?: 'sm' | 'md' | 'lg' | 'xl';
    shadowIntensity?: 'none' | 'xs' | 'sm' | 'md' | 'lg' | 'xl';
    borderRadius?: string;
    glowIntensity?: 'none' | 'xs' | 'sm' | 'md' | 'lg' | 'xl';
};

const blurClasses = {
    sm: 'backdrop-blur-xs',
    md: 'backdrop-blur-md',
    lg: 'backdrop-blur-lg',
    xl: 'backdrop-blur-xl',
};

const glowStyles = {
    none: 'none',
    xs: '0 8px 24px color-mix(in oklab, var(--foreground) 5%, transparent)',
    sm: '0 12px 32px color-mix(in oklab, var(--foreground) 7%, transparent)',
    md: '0 16px 40px color-mix(in oklab, var(--foreground) 9%, transparent)',
    lg: '0 18px 48px color-mix(in oklab, var(--foreground) 11%, transparent)',
    xl: '0 22px 58px color-mix(in oklab, var(--foreground) 13%, transparent)',
};

const edgeStyles = {
    none: 'none',
    xs: 'inset 1px 1px 0 color-mix(in oklab, var(--background) 62%, transparent)',
    sm: 'inset 1px 1px 0 color-mix(in oklab, var(--background) 72%, transparent)',
    md: 'inset 1px 1px 0 color-mix(in oklab, var(--background) 82%, transparent)',
    lg: 'inset 2px 2px 1px color-mix(in oklab, var(--background) 82%, transparent)',
    xl: 'inset 3px 3px 2px color-mix(in oklab, var(--background) 84%, transparent)',
};

/** Token-driven glass surface with optional drag and expansion behavior. */
function LiquidGlassCard({
    children,
    className,
    draggable = false,
    expandable = false,
    width,
    height,
    expandedWidth,
    expandedHeight,
    blurIntensity = 'xl',
    borderRadius = 'var(--radius-xl)',
    glowIntensity = 'sm',
    shadowIntensity = 'md',
    style,
    ...props
}: LiquidGlassCardProps) {
    const [isExpanded, setIsExpanded] = useState(false);
    const reduceMotion = useReducedMotion();
    const filterId = `liquid-glass-${useId().replaceAll(':', '')}`;

    const handleClick = (event: MouseEvent<HTMLDivElement>) => {
        if (!expandable || !(event.target instanceof Element)) {
            return;
        }
        if (event.target.closest('a, button, input, select, textarea')) {
            return;
        }
        setIsExpanded((value) => !value);
    };

    const dimensions = expandable
        ? {
              width: isExpanded ? (expandedWidth ?? width) : width,
              height: isExpanded ? (expandedHeight ?? height) : height,
          }
        : { width, height };

    return (
        <>
            <svg
                aria-hidden="true"
                className="pointer-events-none absolute size-0"
            >
                <defs>
                    <filter id={filterId}>
                        <feTurbulence
                            type="fractalNoise"
                            baseFrequency="0.012"
                            numOctaves="1"
                            result="noise"
                        />
                        <feDisplacementMap
                            in="SourceGraphic"
                            in2="noise"
                            scale="10"
                        />
                    </filter>
                </defs>
            </svg>
            <motion.div
                data-slot="liquid-glass-card"
                className={cn(
                    'relative isolate overflow-hidden border border-background/70 bg-card/46 text-card-foreground',
                    draggable && 'cursor-grab active:cursor-grabbing',
                    expandable && 'cursor-pointer',
                    className,
                )}
                draggable={draggable || undefined}
                drag={draggable && !reduceMotion}
                dragConstraints={
                    draggable
                        ? { left: 0, right: 0, top: 0, bottom: 0 }
                        : undefined
                }
                dragElastic={draggable ? 0.22 : undefined}
                whileHover={reduceMotion ? undefined : { scale: 1.015 }}
                whileTap={reduceMotion ? undefined : { scale: 0.99 }}
                animate={dimensions}
                transition={
                    reduceMotion
                        ? { duration: 0 }
                        : { duration: 0.4, ease: [0.32, 0.72, 0, 1] }
                }
                onClick={expandable ? handleClick : undefined}
                style={{ borderRadius, ...style }}
                {...props}
            >
                <div
                    aria-hidden="true"
                    className={cn(
                        'pointer-events-none absolute inset-0 z-0 bg-background/20',
                        blurClasses[blurIntensity],
                    )}
                    style={{ filter: `url(#${filterId})`, borderRadius }}
                />
                <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 z-10"
                    style={{
                        borderRadius,
                        boxShadow: glowStyles[glowIntensity],
                    }}
                />
                <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 z-20"
                    style={{
                        borderRadius,
                        boxShadow: edgeStyles[shadowIntensity],
                    }}
                />
                <div className="relative z-30 h-full">{children}</div>
            </motion.div>
        </>
    );
}

export { LiquidGlassCard, type LiquidGlassCardProps };
