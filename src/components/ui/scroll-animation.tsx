'use client';

import type { HTMLMotionProps, SVGMotionProps, Variants } from 'motion/react';
import { motion } from 'motion/react';
import type React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

type Direction = 'up' | 'down' | 'left' | 'right';

const DIRECTION_VARIANTS: Record<Direction, Variants> = {
    up: {
        hidden: { filter: 'blur(10px)', opacity: 0, y: -100 },
        visible: {
            filter: 'blur(0px)',
            opacity: 1,
            y: 0,
            transition: {
                duration: 0.5,
                ease: 'easeOut',
            },
        },
    },
    down: {
        hidden: { filter: 'blur(10px)', opacity: 0, y: 100 },
        visible: {
            filter: 'blur(0px)',
            opacity: 1,
            y: 0,
            transition: {
                duration: 0.5,
                ease: 'easeOut',
            },
        },
    },
    left: {
        hidden: { filter: 'blur(10px)', opacity: 0, x: -100 },
        visible: {
            filter: 'blur(0px)',
            opacity: 1,
            x: 0,
            transition: {
                duration: 0.5,
                ease: 'easeOut',
            },
        },
    },
    right: {
        hidden: { filter: 'blur(10px)', opacity: 0, x: 100 },
        visible: {
            filter: 'blur(0px)',
            opacity: 1,
            x: 0,
            transition: {
                duration: 0.5,
                ease: 'easeOut',
            },
        },
    },
};

const defaultViewport = { amount: 0.3, margin: '0px 0px -200px 0px' };
type MotionComponentProps = HTMLMotionProps<'div'> &
    SVGMotionProps<SVGSVGElement>;

interface ScrollElementProps extends Omit<MotionComponentProps, 'children'> {
    children: React.ReactNode;
    className?: string;
    variants?: Variants;
    viewport?: {
        amount?: number;
        margin?: string;
        once?: boolean;
    };
    delay?: number;
    direction?: Direction;
    inViewFallbackMs?: number;
    viewportRootRef?: React.RefObject<HTMLElement | null>;
    visibilityTriggerDelayMs?: number;
}

/**
 * Reveal child content once it enters the configured scroll viewport.
 */
function ScrollElement({
    children,
    className,
    variants,
    viewport = defaultViewport,
    delay = 0,
    direction = 'down',
    inViewFallbackMs,
    viewportRootRef,
    visibilityTriggerDelayMs = 40,
    ...rest
}: ScrollElementProps) {
    const elementRef = useRef<HTMLDivElement | null>(null);
    const [hasEnteredViewport, setHasEnteredViewport] = useState(false);
    const [hasFallbackTriggered, setHasFallbackTriggered] = useState(false);
    const resolvedViewport = useMemo(
        () => ({
            amount: viewport.amount ?? defaultViewport.amount,
            margin: viewport.margin ?? defaultViewport.margin,
        }),
        [viewport.amount, viewport.margin],
    );

    useEffect(() => {
        if (hasEnteredViewport) {
            return;
        }

        const node = elementRef.current;

        if (!node) {
            return;
        }

        const observer = new IntersectionObserver(
            (entries) => {
                const hasIntersectingEntry = entries.some(
                    (entry) => entry.isIntersecting,
                );

                if (!hasIntersectingEntry) {
                    return;
                }

                requestAnimationFrame(() => {
                    window.setTimeout(
                        () => {
                            setHasEnteredViewport(true);
                            setHasFallbackTriggered(false);
                        },
                        Math.max(0, visibilityTriggerDelayMs),
                    );
                });
            },
            {
                root: viewportRootRef?.current ?? null,
                rootMargin: resolvedViewport.margin,
                threshold: resolvedViewport.amount,
            },
        );

        observer.observe(node);

        return () => {
            observer.disconnect();
        };
    }, [
        hasEnteredViewport,
        resolvedViewport.amount,
        resolvedViewport.margin,
        viewportRootRef,
        visibilityTriggerDelayMs,
    ]);

    useEffect(() => {
        if (
            typeof inViewFallbackMs !== 'number' ||
            inViewFallbackMs <= 0 ||
            hasEnteredViewport
        ) {
            return;
        }

        const timer = window.setTimeout(() => {
            setHasFallbackTriggered(true);
        }, inViewFallbackMs);

        return () => {
            window.clearTimeout(timer);
        };
    }, [hasEnteredViewport, inViewFallbackMs]);

    const baseVariants = variants ?? DIRECTION_VARIANTS[direction];
    const modifiedVariants = useMemo<Variants>(() => {
        const hiddenVariant =
            baseVariants.hidden ?? DIRECTION_VARIANTS[direction].hidden;
        const visibleVariant = (baseVariants.visible ??
            DIRECTION_VARIANTS[direction].visible) as Record<
            string,
            unknown
        > & {
            transition?: Record<string, unknown>;
        };

        return {
            hidden: hiddenVariant,
            visible: {
                ...visibleVariant,
                transition: {
                    ...visibleVariant.transition,
                    delay,
                },
            },
        };
    }, [baseVariants, delay, direction]);
    const shouldBeVisible = hasEnteredViewport || hasFallbackTriggered;

    return (
        <motion.div
            ref={elementRef}
            initial="hidden"
            animate={shouldBeVisible ? 'visible' : 'hidden'}
            variants={modifiedVariants}
            className={cn(className)}
            {...rest}
        >
            {children}
        </motion.div>
    );
}

export default ScrollElement;
