import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import styles from "./chip.module.css";

const treatments = {
    section: undefined,
    curated: styles.curated,
    illustrative: styles.illustrative,
    live: styles.live,
    "not-live": styles.notLive,
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
            className={cn("wb-chip", treatments[kind], className)}
            style={style}>
            {kind === "live" ? (
                <svg
                    width="7"
                    height="7"
                    viewBox="0 0 10 10"
                    className={styles.liveDot}
                    aria-hidden="true">
                    <circle cx="5" cy="5" r="5" fill="var(--brand-purple)" />
                </svg>
            ) : null}
            {children}
        </span>
    );
}
