import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, cx, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";
import styles from "./button.module.css";

const interactionClasses =
    "group/button shrink-0 transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4";
const appearanceClasses =
    "inline-flex items-center justify-center rounded-md border border-transparent text-md font-medium whitespace-nowrap";

const buttonStyleVariants = cva("", {
    variants: {
        variant: {
            unstyled: cn(styles.unstyled, "text-left whitespace-normal"),
            solid: styles.solid,
            quiet: styles.quiet,
            default: "bg-primary text-primary-foreground hover:bg-primary/80",
            outline:
                "border-border bg-transparent border-primary/35 hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:bg-transparent dark:hover:bg-input/30",
            secondary:
                "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
            ghost: "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50",
            destructive:
                "bg-destructive/10 text-destructive-text hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40",
            link: "text-accent-foreground underline-offset-4 hover:underline",
            approved:
                "bg-approved text-approved-foreground hover:bg-approved/90",
            launch: "border-0 rounded-full bg-linear-to-b from-primary-sheen to-primary to-55% text-primary-foreground shadow-launch hover:brightness-110",
            round: "border-0 rounded-full bg-primary text-primary-foreground shadow-[inset_0_1px_0_oklch(1_0_0_/_0.2)] hover:bg-primary/80",
        },
        size: {
            unstyled: "",
            compact: styles.compact,
            default:
                "h-9 gap-1.5 px-3 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5",
            xs: "h-6 gap-1 px-2.5 text-xs has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3",
            sm: "h-8 gap-1 px-3 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
            lg: "h-11 gap-1.5 px-5 has-data-[icon=inline-end]:pr-3.5 has-data-[icon=inline-start]:pl-3.5 text-base",
            icon: "size-9",
            "icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-3",
            "icon-sm": "size-8",
            "icon-lg": "size-10",
        },
    },
    compoundVariants: [{ variant: "launch", className: "text-[15px] gap-2.5" }],
    defaultVariants: {
        variant: "default",
        size: "default",
    },
});

/** Keeps interaction states shared while an unstyled surface owns its layout and material. */
function buttonVariants({
    variant,
    size,
    ...options
}: NonNullable<Parameters<typeof buttonStyleVariants>[0]> = {}) {
    // Recipe consumers own merging; merging here would change existing link styles.
    return cx(
        interactionClasses,
        variant !== "unstyled" && appearanceClasses,
        buttonStyleVariants({
            variant,
            size:
                variant === "unstyled" && size === undefined
                    ? "unstyled"
                    : size,
            ...options,
        }),
    );
}

type ButtonProps = ButtonPrimitive.Props & VariantProps<typeof buttonVariants>;

function Button({
    className,
    variant = "default",
    size,
    ...props
}: ButtonProps) {
    return (
        <ButtonPrimitive
            data-slot="button"
            className={cn(
                buttonVariants({
                    variant,
                    size:
                        size === undefined
                            ? variant === "round"
                                ? "icon-lg"
                                : variant === "launch"
                                  ? "lg"
                                  : undefined
                            : size,
                    className: cn(
                        variant === "round" && size === undefined && "size-11",
                        className,
                    ),
                }),
            )}
            {...props}
        />
    );
}

export { Button, type ButtonProps, buttonVariants };
