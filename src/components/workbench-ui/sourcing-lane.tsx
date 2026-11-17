import { motion } from "motion/react";
import { useRef } from "react";
import { cn } from "@/lib/utils";
import { WorkbenchIcon } from "./glyphs";
import { listTransition } from "./motion";
import styles from "./sourcing-lane.module.css";
export interface SourcingDocument {
    id: string;
    format: string;
    title: string;
    meta: string;
    fresh?: boolean;
}
export interface SourcingLaneProps {
    state: "found" | "capturing" | "captured";
    label: string;
    count: number;
    documents: readonly SourcingDocument[];
    remainingLabel?: string;
    emptyMessage?: string;
    active?: boolean;
}
export function SourcingLane({
    state,
    label,
    count,
    documents,
    remainingLabel,
    emptyMessage,
    active = state === "capturing",
}: SourcingLaneProps) {
    const running = active;
    // Documents present when the lane first renders appear in place; later arrivals fade in.
    const initialIds = useRef<ReadonlySet<string> | null>(null);
    initialIds.current ??= new Set(documents.map((d) => d.id));
    return (
        <div className={cn(styles.lane, running ? styles.running : undefined)}>
            <span
                className={cn(
                    styles.header,
                    running ? styles.runningHeader : undefined,
                )}>
                {running ? (
                    <span className={cn("wb-live", styles.liveDot)} />
                ) : (
                    <WorkbenchIcon
                        name={
                            state === "found"
                                ? "search"
                                : state === "captured"
                                  ? "check"
                                  : "clock"
                        }
                        size={14}
                        strokeWidth={state === "captured" ? 2.2 : 1.8}
                    />
                )}
                <b>{label}</b>
                <span className="wb-meta">{count}</span>
            </span>
            {!documents.length && emptyMessage && (
                <p className={cn("wb-meta", styles.metadata)}>{emptyMessage}</p>
            )}
            {documents.map((d) => (
                // A shared layout id lets a document glide between lanes when its state changes.
                <motion.span
                    key={d.id}
                    layoutId={`sourcing-document-${d.id}`}
                    layout="position"
                    transition={listTransition}
                    initial={
                        initialIds.current?.has(d.id)
                            ? false
                            : { opacity: 0, y: -6 }
                    }
                    animate={{ opacity: 1, y: 0 }}
                    className={cn(
                        styles.source,
                        d.fresh ? styles.freshDocument : undefined,
                    )}>
                    <span className="wb-doc">{d.format}</span>
                    <span className={styles.sourceText}>
                        <b>{d.title}</b>
                        <span className="wb-meta">{d.meta}</span>
                    </span>
                    {running && (
                        <span className={cn("wb-sweep", styles.captureSweep)} />
                    )}
                </motion.span>
            ))}
            {remainingLabel && (
                <span className={cn("wb-meta", styles.metadata)}>
                    {remainingLabel}
                </span>
            )}
        </div>
    );
}
