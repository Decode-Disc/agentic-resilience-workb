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
                styles.panel,
                emphasis === "unfinished"
                    ? "wb-dashed wb-panel-unfinished"
                    : "wb-glass",
                emphasis === "focal" && "wb-focal wb-panel-focal",
                emphasis === "waiting" && "wb-waits",
                className,
            )}
        />
    );
}
