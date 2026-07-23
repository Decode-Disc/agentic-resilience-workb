import { Cancel02Icon } from '@hugeicons/core-free-icons';
import { AnimatePresence, motion } from 'motion/react';
import {
    createContext,
    type ReactNode,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import Icon from '@/components/icon';
import { uiLayerClasses } from '@/lib/ui-layers';
import type { PlatformIcon } from '@/types/ui';

// Context
interface ExpandableScreenContextValue {
    isExpanded: boolean;
    isTransitioning: boolean;
    startTransitionFeedback: () => void;
    expand: () => void;
    collapse: () => void;
    layoutId: string;
    triggerRadius: string;
    contentRadius: string;
    animationDuration: number;
}

const ExpandableScreenContext =
    createContext<ExpandableScreenContextValue | null>(null);

function useExpandableScreen() {
    const context = useContext(ExpandableScreenContext);
    if (!context) {
        throw new Error(
            'useExpandableScreen must be used within an ExpandableScreen',
        );
    }
    return context;
}

// Root Component
interface ExpandableScreenProps {
    children: ReactNode;
    defaultExpanded?: boolean;
    onExpandChange?: (expanded: boolean) => void;
    layoutId?: string;
    triggerRadius?: string;
    contentRadius?: string;
    animationDuration?: number;
    lockScroll?: boolean;
}

export function ExpandableScreen({
    children,
    defaultExpanded = false,
    onExpandChange,
    layoutId = 'expandable-card',
    triggerRadius = '100px',
    contentRadius = '24px',
    animationDuration = 0.3,
    lockScroll = true,
}: ExpandableScreenProps) {
    const [isExpanded, setIsExpanded] = useState(defaultExpanded);
    const [isTransitioning, setIsTransitioning] = useState(false);
    const transitionTimeoutRef = useRef<number | null>(null);

    const startTransitionFeedback = useCallback(() => {
        setIsTransitioning((current) => (current ? current : true));
    }, []);

    const beginTransition = useCallback(
        (nextExpanded: boolean) => {
            if (isExpanded === nextExpanded) {
                return;
            }

            startTransitionFeedback();
            setIsExpanded(nextExpanded);
            onExpandChange?.(nextExpanded);
        },
        [isExpanded, onExpandChange, startTransitionFeedback],
    );

    const expand = useCallback(() => {
        beginTransition(true);
    }, [beginTransition]);

    const collapse = useCallback(() => {
        beginTransition(false);
    }, [beginTransition]);

    useEffect(() => {
        if (transitionTimeoutRef.current !== null) {
            window.clearTimeout(transitionTimeoutRef.current);
        }

        transitionTimeoutRef.current = window.setTimeout(
            () => {
                setIsTransitioning(false);
                transitionTimeoutRef.current = null;
            },
            Math.max(animationDuration * 1000, 120),
        );

        return () => {
            if (transitionTimeoutRef.current !== null) {
                window.clearTimeout(transitionTimeoutRef.current);
            }
        };
    }, [animationDuration]);

    useEffect(() => {
        if (!lockScroll) {
            return;
        }

        document.body.style.overflow = isExpanded ? 'hidden' : 'unset';

        return () => {
            document.body.style.overflow = 'unset';
        };
    }, [isExpanded, lockScroll]);

    const contextValue = useMemo(
        () => ({
            isExpanded,
            isTransitioning,
            startTransitionFeedback,
            expand,
            collapse,
            layoutId,
            triggerRadius,
            contentRadius,
            animationDuration,
        }),
        [
            animationDuration,
            collapse,
            contentRadius,
            expand,
            isExpanded,
            isTransitioning,
            layoutId,
            startTransitionFeedback,
            triggerRadius,
        ],
    );

    return (
        <ExpandableScreenContext.Provider value={contextValue}>
            {children}
        </ExpandableScreenContext.Provider>
    );
}

// Trigger Component
interface ExpandableScreenTriggerProps {
    children: ReactNode;
    className?: string;
}

export function ExpandableScreenTrigger({
    children,
    className = '',
}: ExpandableScreenTriggerProps) {
    const { isExpanded, expand, layoutId, triggerRadius } =
        useExpandableScreen();

    return (
        <AnimatePresence initial={false}>
            {!isExpanded && (
                <motion.div className={`inline-block relative ${className}`}>
                    {/* Background layer with shared layoutId for morphing */}
                    <motion.div
                        style={{
                            borderRadius: triggerRadius,
                        }}
                        layout
                        layoutId={layoutId}
                        className="absolute inset-0 transform-gpu will-change-transform"
                    />
                    {/* Content layer that fades out on expand */}
                    <motion.div
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: 0.2 }}
                        exit={{ opacity: 0, scale: 0.8 }}
                        layout={false}
                        onClick={expand}
                        className="relative cursor-pointer"
                    >
                        {children}
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}

// Content Component
interface ExpandableScreenContentProps {
    children: ReactNode;
    className?: string;
    showCloseButton?: boolean;
    closeButtonClassName?: string;
    closeButtonIcon?: PlatformIcon;
}

export function ExpandableScreenContent({
    children,
    className = '',
    showCloseButton = true,
    closeButtonClassName = '',
    closeButtonIcon = Cancel02Icon,
}: ExpandableScreenContentProps) {
    const { isExpanded, collapse, layoutId, contentRadius, animationDuration } =
        useExpandableScreen();

    return (
        <AnimatePresence initial={false}>
            {isExpanded && (
                <div
                    className={`fixed inset-0 ${uiLayerClasses.expandableScreen} flex items-center justify-center p-3 sm:p-2`}
                >
                    {/* Backdrop overlay */}
                    <motion.div
                        className="absolute inset-0 bg-black/30"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: animationDuration * 0.4 }}
                    />
                    {/* Morphing background with shared layoutId */}
                    <motion.div
                        layoutId={layoutId}
                        transition={{
                            type: 'spring',
                            stiffness: 260,
                            damping: 28,
                        }}
                        style={{
                            borderRadius: contentRadius,
                        }}
                        layout
                        className={`relative flex h-full w-full overflow-y-auto transform-gpu will-change-transform ${className}`}
                    >
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: animationDuration * 0.45 }}
                            className="relative z-20 w-full"
                        >
                            {children}
                        </motion.div>

                        {showCloseButton && (
                            <motion.button
                                onClick={collapse}
                                className={`absolute right-6 top-6 z-30 flex h-10 w-10 items-center justify-center transition-colors rounded-full ${
                                    closeButtonClassName ||
                                    'text-foreground bg-transparent hover:bg-foreground/10'
                                }`}
                                aria-label="Close"
                            >
                                <Icon
                                    iconNode={closeButtonIcon}
                                    className="h-5 w-5"
                                />
                            </motion.button>
                        )}
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
}

// Background Component (optional)
interface ExpandableScreenBackgroundProps {
    trigger?: ReactNode;
    content?: ReactNode;
    className?: string;
}

export function ExpandableScreenBackground({
    trigger,
    content,
    className = '',
}: ExpandableScreenBackgroundProps) {
    const { isExpanded, animationDuration } = useExpandableScreen();

    return (
        <AnimatePresence initial={false}>
            {isExpanded && content ? (
                <motion.div
                    key="expandable-bg-expanded"
                    className={className}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: animationDuration * 0.45 }}
                >
                    {content}
                </motion.div>
            ) : (
                trigger && (
                    <motion.div
                        key="expandable-bg-collapsed"
                        className={className}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        transition={{
                            duration: animationDuration * 0.45,
                            ease: [0.16, 1, 0.3, 1],
                        }}
                    >
                        {trigger}
                    </motion.div>
                )
            )}
        </AnimatePresence>
    );
}

export { useExpandableScreen };
