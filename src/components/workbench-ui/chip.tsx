import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

const treatments = {
    section: undefined,
    curated: {
        color: "var(--foreground)",
        background: "var(--card)",
        boxShadow: "inset 0 0 0 1px var(--foreground)",
    },
    illustrative: {
        color: "var(--muted-foreground)",
        background: "transparent",
        boxShadow: "none",
        outline: "1px dashed var(--muted-foreground)",
        outlineOffset: -1,
    },
    live: {
        color: "var(--foreground)",
        background: "var(--card)",
        boxShadow: "inset 0 0 0 1px var(--input-border)",
    },
    "not-live": {
        color: "var(--muted-foreground)",
        background: "var(--muted)",
        boxShadow: "none",
    },
};
export function Chip({
    kind = "section",
    children,
    className,
    style,
    ...props
}: ComponentProps<"span"> & { kind?: keyof typeof treatments }) {
    return (
        <span
            {...props}
            className={cn("wb-chip", className)}
            style={{ ...treatments[kind], ...style }}>
            {kind === "live" ? (
                <svg
                    width="7"
                    height="7"
                    viewBox="0 0 10 10"
                    style={{ width: 7, height: 7 }}
                    aria-hidden="true">
                    <circle cx="5" cy="5" r="5" fill="var(--brand-purple)" />
                </svg>
            ) : null}
            {children}
        </span>
    );
}
