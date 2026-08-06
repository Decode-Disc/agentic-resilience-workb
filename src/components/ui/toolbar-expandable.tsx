"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
    memo,
    type ReactNode,
    useCallback,
    useEffect,
    useId,
    useRef,
    useState,
} from "react";
import Icon from "@/components/icon";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { PlatformIcon } from "@/types/ui";

const transition = {
    type: "spring" as const,
    bounce: 0.1,
    duration: 0.25,
};

export interface DynamicStep {
    id: string;
    title: string;
    description: string;
    icon: PlatformIcon;
    content: ReactNode;
}

export interface DynamicToolbarExpandableProps {
    steps: DynamicStep[];
    badgeText?: string;
    className?: string;
    expanded?: boolean;
    onExpandedChange?: (expanded: boolean) => void;
    activeStep?: string | null;
    onActiveStepChange?: (stepId: string | null) => void;
}

const DynamicToolbarExpandable = memo<DynamicToolbarExpandableProps>(
    function DynamicToolbarExpandable({
        steps,
        badgeText,
        className,
        expanded: controlledExpanded,
        onExpandedChange,
        activeStep: controlledActiveStep,
        onActiveStepChange,
    }) {
        const [internalActive, setInternalActive] = useState<string | null>(
            null,
        );
        const [internalIsOpen, setInternalIsOpen] = useState(false);
        const containerRef = useRef<HTMLDivElement | null>(null);
        const contentId = useId();
        const shouldReduceMotion = useReducedMotion();

        const active =
            controlledActiveStep !== undefined
                ? controlledActiveStep
                : internalActive;
        const isOpen =
            controlledExpanded !== undefined
                ? controlledExpanded
                : internalIsOpen;

        const setActive = useCallback(
            (value: string | null) => {
                if (controlledActiveStep === undefined) {
                    setInternalActive(value);
                }
                onActiveStepChange?.(value);
            },
            [controlledActiveStep, onActiveStepChange],
        );

        const setIsOpen = useCallback(
            (value: boolean) => {
                if (controlledExpanded === undefined) {
                    setInternalIsOpen(value);
                }
                onExpandedChange?.(value);
            },
            [controlledExpanded, onExpandedChange],
        );

        useEffect(() => {
            if (!isOpen) return;

            const handlePointerDown = (event: MouseEvent | TouchEvent) => {
                const target = event.target;
                if (!(target instanceof Node)) return;
                if (containerRef.current?.contains(target)) return;
                setIsOpen(false);
                setActive(null);
            };

            document.addEventListener("mousedown", handlePointerDown);
            document.addEventListener("touchstart", handlePointerDown);

            return () => {
                document.removeEventListener("mousedown", handlePointerDown);
                document.removeEventListener("touchstart", handlePointerDown);
            };
        }, [isOpen, setActive, setIsOpen]);

        const handleNavClick = useCallback(
            (item: string) => {
                if (active === item && isOpen) {
                    setIsOpen(false);
                    setActive(null);
                    return;
                }

                setActive(item);
                setIsOpen(true);
            },
            [active, isOpen, setActive, setIsOpen],
        );

        const activeStepDefinition = active
            ? steps.find((step) => step.id === active)
            : undefined;

        return (
            <div className={cn("w-full space-y-2", className)}>
                {badgeText && (
                    <Badge
                        variant="outline"
                        className="border-border bg-muted text-muted-foreground">
                        {badgeText}
                    </Badge>
                )}

                <div
                    ref={containerRef}
                    className="surface-floating w-full overflow-hidden rounded-lg border border-border/60">
                    <ScrollArea
                        className="w-full"
                        viewportClassName="overflow-x-auto">
                        <div
                            data-slot="toolbar-action-list"
                            className="flex w-max min-w-full flex-nowrap items-center p-1">
                            {steps.map((step) => {
                                const isActive = active === step.id && isOpen;
                                return (
                                    <button
                                        key={step.id}
                                        type="button"
                                        aria-label={step.title}
                                        aria-expanded={isActive}
                                        aria-controls={`${contentId}-${step.id}`}
                                        onClick={() => handleNavClick(step.id)}
                                        className={cn(
                                            "flex min-h-10 shrink-0 items-center gap-2 rounded-md px-3 text-xs font-medium text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                                            isActive
                                                ? "bg-accent text-accent-foreground"
                                                : "bg-muted/50 hover:bg-muted hover:text-foreground",
                                        )}>
                                        <Icon iconNode={step.icon} size={16} />
                                        <span>{step.title}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </ScrollArea>

                    <AnimatePresence initial={false} mode="wait">
                        {isOpen && activeStepDefinition ? (
                            <motion.div
                                key={activeStepDefinition.id}
                                id={`${contentId}-${activeStepDefinition.id}`}
                                role="region"
                                aria-label={activeStepDefinition.title}
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: "auto", opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={
                                    shouldReduceMotion
                                        ? { duration: 0 }
                                        : transition
                                }
                                className="overflow-hidden border-t border-border/60">
                                <div className="space-y-4 p-4">
                                    <div className="space-y-1">
                                        <h3 className="text-sm font-semibold text-foreground">
                                            {activeStepDefinition.title}
                                        </h3>
                                        <p className="text-xs leading-relaxed text-muted-foreground">
                                            {activeStepDefinition.description}
                                        </p>
                                    </div>
                                    {activeStepDefinition.content}
                                </div>
                            </motion.div>
                        ) : null}
                    </AnimatePresence>
                </div>
            </div>
        );
    },
);

DynamicToolbarExpandable.displayName = "DynamicToolbarExpandable";

export default function ToolbarExpandable(
    props: DynamicToolbarExpandableProps,
) {
    return <DynamicToolbarExpandable {...props} />;
}
