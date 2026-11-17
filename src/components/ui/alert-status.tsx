import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { cva, type VariantProps } from "class-variance-authority";
import { AnimatePresence, motion } from "motion/react";
import * as React from "react";
import Icon from "@/components/icon";
import {
    Alert,
    AlertAction,
    AlertDescription,
    AlertTitle,
} from "@/components/ui/alert";
import { cn } from "@/lib/utils";

const alertStatusVariants = cva(
    "group/alert relative grid w-full gap-0.5 rounded-sm border text-left transition-colors has-data-[slot=alert-action]:relative has-data-[slot=alert-action]:pr-18 has-[>svg]:grid-cols-[auto_1fr] has-[>svg]:gap-x-2.5 *:[svg]:row-span-2 *:[svg]:translate-y-0.5 *:[svg]:text-current",
    {
        variants: {
            variant: {
                default: "",
                soft: "border-transparent",
                outline: "bg-background/50 dark:bg-transparent",
                solid: "border-transparent text-white *:data-[slot=alert-description]:text-white/80",
            },
            status: {
                default: "",
                info: "",
                success: "",
                warning: "",
                danger: "",
            },
            size: {
                default:
                    "px-4 py-3 text-sm *:[svg:not([class*='size-'])]:size-4",
                sm: "px-3 py-2 text-xs *:[svg:not([class*='size-'])]:size-3.5",
                lg: "px-5 py-4 text-base *:[svg:not([class*='size-'])]:size-5",
            },
        },
        compoundVariants: [
            // Default (Primary)
            {
                variant: "default",
                status: "default",
                className:
                    "border-primary/20 bg-primary/5 text-primary dark:border-primary/30 dark:bg-primary/10 *:data-[slot=alert-description]:text-primary/80",
            },
            {
                variant: "soft",
                status: "default",
                className:
                    "bg-primary/10 text-primary *:data-[slot=alert-description]:text-primary/80",
            },
            {
                variant: "outline",
                status: "default",
                className:
                    "border-primary text-primary *:data-[slot=alert-description]:text-primary/80",
            },
            {
                variant: "solid",
                status: "default",
                className:
                    "bg-primary text-primary-foreground *:data-[slot=alert-description]:text-primary-foreground/80",
            },

            // Info (Sky)
            {
                variant: "default",
                status: "info",
                className:
                    "border-sky-500/20 bg-sky-500/5 text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-400 *:data-[slot=alert-description]:text-sky-700/80 dark:*:data-[slot=alert-description]:text-sky-400/80",
            },
            {
                variant: "soft",
                status: "info",
                className:
                    "bg-sky-600/10 text-sky-600 dark:bg-sky-400/10 dark:text-sky-400 *:data-[slot=alert-description]:text-sky-600/80 dark:*:data-[slot=alert-description]:text-sky-400/80",
            },
            {
                variant: "outline",
                status: "info",
                className:
                    "border-sky-600 text-sky-600 dark:border-sky-400 dark:text-sky-400 *:data-[slot=alert-description]:text-sky-600/80 dark:*:data-[slot=alert-description]:text-sky-400/80",
            },
            {
                variant: "solid",
                status: "info",
                className:
                    "bg-sky-600 text-white dark:bg-sky-600/80 *:data-[slot=alert-description]:text-white/80",
            },

            // Success (Green)
            {
                variant: "default",
                status: "success",
                className:
                    "border-green-500/20 bg-green-500/5 text-green-700 dark:border-green-500/30 dark:bg-green-500/10 dark:text-green-400 *:data-[slot=alert-description]:text-green-700/80 dark:*:data-[slot=alert-description]:text-green-400/80",
            },
            {
                variant: "soft",
                status: "success",
                className:
                    "bg-green-600/10 text-green-600 dark:bg-green-400/10 dark:text-green-400 *:data-[slot=alert-description]:text-green-600/80 dark:*:data-[slot=alert-description]:text-green-400/80",
            },
            {
                variant: "outline",
                status: "success",
                className:
                    "border-green-600 text-green-600 dark:border-green-400 dark:text-green-400 *:data-[slot=alert-description]:text-green-600/80 dark:*:data-[slot=alert-description]:text-green-400/80",
            },
            {
                variant: "solid",
                status: "success",
                className:
                    "bg-green-600 text-white dark:bg-green-600/80 *:data-[slot=alert-description]:text-white/80",
            },

            // Warning (Amber)
            {
                variant: "default",
                status: "warning",
                className:
                    "border-amber-500/20 bg-amber-500/5 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400 *:data-[slot=alert-description]:text-amber-700/80 dark:*:data-[slot=alert-description]:text-amber-400/80",
            },
            {
                variant: "soft",
                status: "warning",
                className:
                    "bg-amber-600/10 text-amber-600 dark:bg-amber-400/10 dark:text-amber-400 *:data-[slot=alert-description]:text-amber-600/80 dark:*:data-[slot=alert-description]:text-amber-400/80",
            },
            {
                variant: "outline",
                status: "warning",
                className:
                    "border-amber-600 text-amber-600 dark:border-amber-400 dark:text-amber-400 *:data-[slot=alert-description]:text-amber-600/80 dark:*:data-[slot=alert-description]:text-amber-400/80",
            },
            {
                variant: "solid",
                status: "warning",
                className:
                    "bg-amber-600 text-white dark:bg-amber-600/80 *:data-[slot=alert-description]:text-white/80",
            },

            // Danger (Red)
            {
                variant: "default",
                status: "danger",
                className:
                    "border-red-500/20 bg-red-500/5 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400 *:data-[slot=alert-description]:text-red-700/80 dark:*:data-[slot=alert-description]:text-red-400/80",
            },
            {
                variant: "soft",
                status: "danger",
                className:
                    "bg-red-600/10 text-red-600 dark:bg-red-400/10 dark:text-red-400 *:data-[slot=alert-description]:text-red-600/80 dark:*:data-[slot=alert-description]:text-red-400/80",
            },
            {
                variant: "outline",
                status: "danger",
                className:
                    "border-red-600 text-red-600 dark:border-red-400 dark:text-red-400 *:data-[slot=alert-description]:text-red-600/80 dark:*:data-[slot=alert-description]:text-red-400/80",
            },
            {
                variant: "solid",
                status: "danger",
                className:
                    "bg-destructive text-white dark:bg-destructive/60 *:data-[slot=alert-description]:text-white/80",
            },
        ],
        defaultVariants: {
            variant: "default",
            status: "default",
            size: "default",
        },
    },
);

interface AlertStatusProps
    extends Omit<React.ComponentProps<typeof Alert>, "title" | "variant">,
        VariantProps<typeof alertStatusVariants> {
    title?: React.ReactNode;
    description?: React.ReactNode;
    action?: React.ReactNode;
    icon?: React.ReactNode;
    open?: boolean;
    defaultOpen?: boolean;
    onOpenChange?: (open: boolean) => void;
    onClose?: (event: React.MouseEvent<HTMLButtonElement>) => void;
    closable?: boolean;
    closeIcon?: React.ReactNode;
}

function AlertStatus({
    className,
    variant = "default",
    status = "default",
    size = "default",
    icon,
    title,
    description,
    action,
    open: controlledOpen,
    defaultOpen = true,
    onOpenChange,
    onClose,
    closable,
    closeIcon,
    children,
    ...props
}: AlertStatusProps) {
    const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen);
    const isControlled = controlledOpen !== undefined;
    const isOpen = isControlled ? controlledOpen : uncontrolledOpen;

    const handleClose = (e: React.MouseEvent<HTMLButtonElement>) => {
        onClose?.(e);
        if (!e.defaultPrevented) {
            if (!isControlled) {
                setUncontrolledOpen(false);
            }
            onOpenChange?.(false);
        }
    };

    const showClose = closable ?? Boolean(onClose);

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    initial={{ opacity: 0, height: 0, scale: 0.98 }}
                    animate={{ opacity: 1, height: "auto", scale: 1 }}
                    exit={{
                        opacity: 0,
                        height: 0,
                        scale: 0.96,
                        transition: {
                            duration: 0.2,
                            ease: [0.32, 0.72, 0, 1],
                        },
                    }}
                    transition={{
                        duration: 0.25,
                        ease: [0.32, 0.72, 0, 1],
                    }}
                    className="w-full overflow-hidden">
                    <Alert
                        data-slot="alert-status"
                        className={cn(
                            alertStatusVariants({ variant, status, size }),
                            showClose &&
                                action &&
                                "has-data-[slot=alert-action]:pr-24",
                            className,
                        )}
                        {...props}>
                        {icon}
                        {title && <AlertTitle>{title}</AlertTitle>}
                        {description && (
                            <AlertDescription>{description}</AlertDescription>
                        )}
                        {action && (
                            <AlertAction className={cn(showClose && "right-9")}>
                                {action}
                            </AlertAction>
                        )}
                        {showClose && (
                            <button
                                type="button"
                                data-slot="alert-close"
                                className="absolute top-1 right-3 cursor-pointer rounded-md p-1 opacity-70 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                onClick={handleClose}
                                aria-label="Close alert">
                                {closeIcon ?? (
                                    <Icon
                                        iconNode={Cancel01Icon}
                                        className="size-4"
                                        strokeWidth={3}
                                    />
                                )}
                            </button>
                        )}
                        {children}
                    </Alert>
                </motion.div>
            )}
        </AnimatePresence>
    );
}

export {
    AlertAction,
    AlertDescription,
    AlertStatus,
    AlertTitle,
    alertStatusVariants,
};
