import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import styles from "./glass-panel.module.css";
export function GlassPanel({
    emphasis = "ordinary",
    className,
    ...props
}: ComponentProps<"div"> & {
    emphasis?: "ordinary" | "focal" | "waiting" | "unfinished";
}) {
    return (
        <div
            {...props}
            className={cn(
                styles.p,
                emphasis === "unfinished"
                    ? ["wb-dashed", styles.hatch]
                    : "wb-glass",
                emphasis === "focal" && ["wb-focal", styles.focalbg],
                emphasis === "waiting" && "wb-waits",
                className,
            )}
        />
    );
}
