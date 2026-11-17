"use client";

import { Cancel01Icon } from "@hugeicons/core-free-icons";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import * as React from "react";
import Icon from "@/components/icon";
import { uiLayerClasses } from "@/lib/ui-layers";
import { cn } from "@/lib/utils";

const TRANSITION = {
    type: "spring" as const,
    bounce: 0.05,
    duration: 0.3,
};

type CultPopoverContextValue = {
    isOpen: boolean;
    openPopover: () => void;
    closePopover: () => void;
    uniqueId: string;
    note: string;
    setNote: React.Dispatch<React.SetStateAction<string>>;
};

const CultPopoverContext = React.createContext<CultPopoverContextValue | null>(
    null,
);

/**
 * Resolve the current cult popover context for child components.
 */
function useCultPopoverContext(): CultPopoverContextValue {
    const context = React.useContext(CultPopoverContext);

    if (!context) {
        throw new Error(
            "Cult popover components must be used within <Popover>.",
        );
    }

    return context;
}

type PopoverProps = React.ComponentProps<typeof PopoverPrimitive.Root> & {
    className?: string;
};

/**
 * Root popover component with Radix-compatible props plus cult animation state.
 */
function Popover({
    className,
    children,
    open: controlledOpen,
    defaultOpen = false,
    onOpenChange,
    ...props
}: PopoverProps) {
    const uniqueId = React.useId();
    const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen);
    const [note, setNote] = React.useState("");
    const isControlled = controlledOpen !== undefined;
    const isOpen = isControlled ? controlledOpen : uncontrolledOpen;

    const handleOpenChange = React.useCallback(
        (nextOpen: boolean) => {
            if (!isControlled) {
                setUncontrolledOpen(nextOpen);
            }

            if (!nextOpen) {
                setNote("");
            }

            onOpenChange?.(nextOpen);
        },
        [isControlled, onOpenChange],
    );

    const contextValue = React.useMemo<CultPopoverContextValue>(
        () => ({
            isOpen,
            openPopover: () => handleOpenChange(true),
            closePopover: () => handleOpenChange(false),
            uniqueId,
            note,
            setNote,
        }),
        [handleOpenChange, isOpen, note, uniqueId],
    );

    const content = (
        <PopoverPrimitive.Root
            data-slot="popover"
            open={isOpen}
            onOpenChange={handleOpenChange}
            {...props}>
            {children}
        </PopoverPrimitive.Root>
    );

    return (
        <CultPopoverContext.Provider value={contextValue}>
            <MotionConfig transition={TRANSITION}>
                {className ? (
                    <div className={className}>{content}</div>
                ) : (
                    content
                )}
            </MotionConfig>
        </CultPopoverContext.Provider>
    );
}

/**
 * Trigger with Radix-compatible props while preserving cult shared-layout animation.
 */
function PopoverTrigger({
    className,
    children,
    asChild,
    ...props
}: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
    const { uniqueId } = useCultPopoverContext();

    if (asChild) {
        return (
            <PopoverPrimitive.Trigger
                data-slot="popover-trigger"
                asChild
                {...props}>
                {children}
            </PopoverPrimitive.Trigger>
        );
    }

    return (
        <PopoverPrimitive.Trigger
            data-slot="popover-trigger"
            asChild
            {...props}>
            <motion.button
                layoutId={`cult-popover-${uniqueId}`}
                className={cn(
                    "flex h-9 items-center border border-zinc-950/10 bg-white px-3 text-zinc-950 dark:border-zinc-50/10 dark:bg-zinc-700 dark:text-zinc-50",
                    className,
                )}
                style={{ borderRadius: 8 }}>
                <motion.span
                    layoutId={`cult-popover-label-${uniqueId}`}
                    className="text-sm">
                    {children}
                </motion.span>
            </motion.button>
        </PopoverPrimitive.Trigger>
    );
}

/**
 * Animated content that keeps cult transitions while matching Radix content props.
 *
 */
function PopoverContent({
    className,
    align = "center",
    sideOffset = 4,
    children,
    ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
    const { isOpen, uniqueId } = useCultPopoverContext();

    return (
        <PopoverPrimitive.Portal forceMount>
            <AnimatePresence>
                {isOpen ? (
                    <PopoverPrimitive.Content
                        forceMount
                        align={align}
                        sideOffset={sideOffset}
                        data-slot="popover-content"
                        className={cn(
                            "w-72 origin-(--radix-popover-content-transform-origin) overflow-hidden rounded-xl border border-zinc-950/10 bg-white shadow-xl outline-hidden dark:border-zinc-50/10 dark:bg-zinc-700",
                            uiLayerClasses.popup,
                            className,
                        )}
                        {...props}>
                        <motion.div
                            layoutId={`cult-popover-${uniqueId}`}
                            initial={{ opacity: 0, scale: 0.96, y: 8 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.96, y: 8 }}
                            className="h-full w-full">
                            {children}
                        </motion.div>
                    </PopoverPrimitive.Content>
                ) : null}
            </AnimatePresence>
        </PopoverPrimitive.Portal>
    );
}

function PopoverAnchor({
    ...props
}: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
    return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />;
}

function PopoverHeader({ className, ...props }: React.ComponentProps<"div">) {
    return <div className={cn("px-4 py-2", className)} {...props} />;
}

function PopoverTitle({ className, ...props }: React.ComponentProps<"h2">) {
    return (
        <h2
            className={cn(
                "font-semibold text-zinc-900 dark:text-zinc-100",
                className,
            )}
            {...props}
        />
    );
}

function PopoverDescription({
    className,
    ...props
}: React.ComponentProps<"p">) {
    return (
        <p
            className={cn(
                "text-sm text-zinc-500 dark:text-zinc-400",
                className,
            )}
            {...props}
        />
    );
}

type PopoverFormProps = {
    children: React.ReactNode;
    onSubmit?: (note: string) => void;
    className?: string;
};

function PopoverForm({ children, onSubmit, className }: PopoverFormProps) {
    const { note, closePopover } = useCultPopoverContext();

    const handleSubmit = (
        event: React.SyntheticEvent<HTMLFormElement, SubmitEvent>,
    ) => {
        event.preventDefault();
        onSubmit?.(note);
        closePopover();
    };

    return (
        <form
            className={cn("flex h-full flex-col", className)}
            onSubmit={handleSubmit}>
            {children}
        </form>
    );
}

type PopoverLabelProps = {
    children: React.ReactNode;
    className?: string;
};

function PopoverLabel({ children, className }: PopoverLabelProps) {
    const { uniqueId, note } = useCultPopoverContext();

    return (
        <motion.span
            layoutId={`cult-popover-label-${uniqueId}`}
            aria-hidden="true"
            style={{ opacity: note ? 0 : 1 }}
            className={cn(
                "absolute left-4 top-3 select-none text-sm text-zinc-500 dark:text-zinc-400",
                className,
            )}>
            {children}
        </motion.span>
    );
}

function PopoverTextarea({
    className,
    ...props
}: React.ComponentProps<"textarea">) {
    const { note, setNote } = useCultPopoverContext();

    return (
        <textarea
            className={cn(
                "h-full w-full resize-none rounded-md bg-transparent px-4 py-3 text-sm outline-none",
                className,
            )}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            {...props}
        />
    );
}

function PopoverFooter({ className, ...props }: React.ComponentProps<"div">) {
    return (
        <div
            className={cn("flex justify-between px-4 py-3", className)}
            {...props}
        />
    );
}

function PopoverCloseButton({
    className,
    onClick,
    ...props
}: React.ComponentProps<"button">) {
    const { closePopover } = useCultPopoverContext();

    return (
        <button
            type="button"
            className={cn("flex items-center", className)}
            onClick={(event) => {
                onClick?.(event);

                if (!event.defaultPrevented) {
                    closePopover();
                }
            }}
            aria-label="Close popover"
            {...props}>
            <Icon
                iconNode={Cancel01Icon}
                size={16}
                className="text-zinc-900 dark:text-zinc-100"
            />
        </button>
    );
}

function PopoverSubmitButton({
    className,
    ...props
}: React.ComponentProps<"button">) {
    return (
        <button
            className={cn(
                "relative ml-1 flex h-8 shrink-0 scale-100 select-none appearance-none items-center justify-center rounded-lg border border-zinc-950/10 bg-transparent px-2 text-sm text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800 focus-visible:ring-2 active:scale-[0.98] dark:border-zinc-50/10 dark:text-zinc-50 dark:hover:bg-zinc-800",
                className,
            )}
            type="submit"
            aria-label="Submit note"
            {...props}>
            {props.children ?? "Submit"}
        </button>
    );
}

function PopoverBody({ className, ...props }: React.ComponentProps<"div">) {
    return <div className={cn("p-4", className)} {...props} />;
}

function PopoverButton({
    className,
    ...props
}: React.ComponentProps<"button">) {
    return (
        <button
            type="button"
            className={cn(
                "flex w-full items-center gap-2 rounded-md px-4 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-700",
                className,
            )}
            {...props}
        />
    );
}

const PopoverRoot = Popover;

export {
    Popover,
    PopoverAnchor,
    PopoverBody,
    PopoverButton,
    PopoverCloseButton,
    PopoverContent,
    PopoverDescription,
    PopoverFooter,
    PopoverForm,
    PopoverHeader,
    PopoverLabel,
    PopoverRoot,
    PopoverSubmitButton,
    PopoverTextarea,
    PopoverTitle,
    PopoverTrigger,
};
