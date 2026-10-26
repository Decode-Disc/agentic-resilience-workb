import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "@/lib/utils";

type Color =
    | "emerald"
    | "red"
    | "amber"
    | "sky"
    | "indigo"
    | "orange"
    | "primary";

/* Badges carry no hover states. They are non-interactive metadata; an
 * interactive container owns its own hover (filter buttons, list rows).
 * Consumers that need an interactive-looking chip must add that treatment
 * themselves rather than borrowing one from this primitive. */
const colorVariantsFancy = {
    primary:
        "border-primary/10 from-primary/10 to-primary/50 text-primary/80  dark:from-primary/30",
    emerald:
        "border-emerald-300 from-emerald-200/20 to-emerald-300 text-emerald-600 dark:from-emerald-700/50 dark:text-emerald-400",
    red: "border-red-300 from-red-200/50 to-red-400/80 text-red-600 dark:from-red-700/20 dark:to-transparent dark:text-red-400",
    amber: "border-amber-300 from-amber-200/20 to-amber-200 text-amber-600 dark:from-amber-700/50 dark:text-amber-400",
    sky: "border-sky-300 from-sky-200/20 to-sky-300 text-sky-600 dark:from-sky-700/50 dark:text-sky-400",
    indigo: "border-indigo-300 from-indigo-200/20 to-indigo-300 text-indigo-600 dark:from-indigo-700/50 dark:text-indigo-400",
    orange: "border-orange-300 from-orange-200/20 to-orange-300 text-orange-600 dark:from-orange-700/50 dark:text-orange-400",
};

const colorVariantsRegular = {
    primary: "bg-primary/10 text-primary/80 dark:bg-primary/10",
    emerald:
        "bg-emerald-100 text-emerald-600 dark:bg-emerald-600/10 dark:text-emerald-400",
    red: "bg-red-100 text-red-600 dark:bg-red-600/10 dark:text-red-400",
    amber: "bg-amber-100 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400",
    sky: "bg-sky-100 text-sky-600 dark:bg-sky-500/10 dark:text-sky-400",
    indigo: "bg-indigo-100 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400",
    orange: "bg-orange-100 text-orange-600 dark:bg-orange-500/10 dark:text-orange-400",
};

const colorVariantsOutline = {
    primary: "[&>svg]:text-primary",
    emerald: "[&>svg]:text-emerald-400",
    red: "[&>svg]:text-red-400",
    amber: "[&>svg]:text-amber-400",
    sky: "[&>svg]:text-sky-400",
    indigo: "[&>svg]:text-indigo-400",
    orange: "[&>svg]:text-orange-400",
};

const badgeVariants = cva(
    "inline-flex items-center justify-center rounded-lg border px-1.5 py-0.5 text-xs font-medium w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 gap-0.5 [&>svg]:pointer-events-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive transition-colors duration-150 overflow-hidden",
    {
        variants: {
            variant: {
                default:
                    "border-transparent bg-primary text-primary-foreground",
                regular: "border-none",
                secondary:
                    "border-transparent bg-secondary text-secondary-foreground",
                destructive:
                    "border-transparent bg-destructive text-white focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60",
                outline: "text-foreground",
                fancy: "bg-white dark:border-card dark:bg-background bg-radial-[at_40%_30%] shadow-md inset-shadow-sm shadow-shade inset-shadow-white/70 dark:inset-shadow-white/50 dark:inset-shadow-xs dark:to-transparent ",
            },
        },
        defaultVariants: {
            variant: "default",
        },
    },
);

const colorVariantSets: Record<string, Record<Color, string>> = {
    fancy: colorVariantsFancy,
    regular: colorVariantsRegular,
    outline: colorVariantsOutline,
};

const dotVariants = cva("h-2 w-2 rounded-full mr-0.5", {
    variants: {
        color: {
            emerald: "bg-emerald-400",
            red: "bg-red-400",
            amber: "bg-amber-400",
            sky: "bg-sky-400",
            indigo: "bg-indigo-400",
            orange: "bg-orange-400",
            primary: "bg-primary/80",
        },
    },
});

function Badge({
    className,
    variant,
    asChild = false,
    color = "primary",
    showDot = false,
    children,
    ...props
}: React.ComponentProps<"span"> &
    VariantProps<typeof badgeVariants> & {
        asChild?: boolean;
        color?: Color;
        showDot?: boolean;
    }) {
    const Comp = asChild ? Slot : "span";

    return (
        <Comp
            data-slot="badge"
            className={cn(
                badgeVariants({ variant }),
                colorVariantSets[variant || "default"]?.[color],
                className,
            )}
            {...props}>
            {showDot && <div className={dotVariants({ color })}></div>}
            {children}
        </Comp>
    );
}

export type { Color };
export { Badge, badgeVariants };
