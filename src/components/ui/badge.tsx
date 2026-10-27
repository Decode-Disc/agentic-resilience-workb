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

const badgeVariants = cva(
    "inline-flex w-fit max-w-full shrink-0 items-center justify-center gap-1.5 overflow-hidden whitespace-nowrap rounded-badge px-[7px] py-0.5 text-xs leading-4.5 font-medium [&>svg]:size-3 [&>svg]:pointer-events-none",
    {
        variants: {
            variant: {
                default: "bg-tint-ink text-foreground",
                regular: "bg-tint-ink text-foreground",
                secondary: "bg-tint-ink text-foreground",
                outline: "bg-tint-ink text-foreground",
                fancy: "bg-tint-ink text-foreground",
                destructive: "bg-destructive/10 text-destructive-text",
            },
            tone: {
                ink: "bg-tint-ink text-foreground",
                fact: "bg-tint-fact text-evidence-fact",
                inference: "bg-tint-inference text-evidence-inference",
                hypothesis: "bg-tint-hypothesis text-evidence-hypothesis",
                unknown: "bg-tint-unknown text-evidence-unknown",
                counter: "bg-tint-counter text-counter-evidence",
                review: "bg-tint-review text-review-foreground",
                approved: "bg-tint-approved text-approved",
                accent: "bg-accent text-accent-foreground",
                dashed: "bg-transparent text-muted-foreground outline outline-dashed -outline-offset-1 outline-edge-dashed",
            },
        },
        defaultVariants: { variant: "default" },
    },
);

// Compatibility for existing operational badges: success is neutral, never analyst approval.
const operationalColors: Record<Color, string> = {
    primary: "bg-tint-ink text-foreground",
    emerald: "bg-tint-ink text-foreground",
    red: "bg-destructive/10 text-destructive-text",
    amber: "bg-tint-review text-review-foreground",
    orange: "bg-tint-review text-review-foreground",
    sky: "bg-accent text-accent-foreground",
    indigo: "bg-accent text-accent-foreground",
};

function Badge({
    className,
    variant,
    tone,
    asChild = false,
    color,
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
                badgeVariants({ variant, tone }),
                !tone && color ? operationalColors[color] : undefined,
                className,
            )}
            {...props}>
            {showDot ? (
                <span
                    aria-hidden="true"
                    className="size-1.5 shrink-0 rounded-full bg-current"
                />
            ) : null}
            {children}
        </Comp>
    );
}

export type { Color };
export { Badge, badgeVariants };
