import { WorkbenchIcon } from "./glyphs";
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
    active?: boolean;
}
export function SourcingLane({
    state,
    label,
    count,
    documents,
    remainingLabel,
    active = state === "capturing",
}: SourcingLaneProps) {
    const running = active;
    return (
        <div
            className={styles.lane}
            style={
                running
                    ? {
                          background:
                              "color-mix(in oklab,var(--brand-purple) 6%,transparent)",
                          boxShadow:
                              "inset 0 0 0 1px color-mix(in oklab,var(--brand-purple) 22%,transparent)",
                      }
                    : undefined
            }>
            <span
                className={styles.lh}
                style={
                    running ? { color: "var(--accent-foreground)" } : undefined
                }>
                {running ? (
                    <span
                        className="wb-live"
                        style={{
                            width: 8,
                            height: 8,
                            borderRadius: "50%",
                            background: "var(--brand-purple)",
                        }}
                    />
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
            {documents.map((d) => (
                <span
                    key={d.id}
                    className={styles.sc}
                    style={
                        d.fresh
                            ? {
                                  boxShadow:
                                      "0 0 0 1px color-mix(in oklab,var(--brand-purple) 35%,transparent),var(--shadow-raised)",
                              }
                            : undefined
                    }>
                    <span className="wb-doc">{d.format}</span>
                    <span className={styles.ct}>
                        <b>{d.title}</b>
                        <span className="wb-meta">{d.meta}</span>
                    </span>
                    {running && (
                        <span
                            className="wb-sweep"
                            style={{
                                position: "absolute",
                                inset: 0,
                                display: "block",
                            }}
                        />
                    )}
                </span>
            ))}
            {remainingLabel && (
                <span className="wb-meta" style={{ padding: 4 }}>
                    {remainingLabel}
                </span>
            )}
        </div>
    );
}
