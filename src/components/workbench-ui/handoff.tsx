import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { WorkbenchIcon } from "./glyphs";
import styles from "./handoff.module.css";

export interface HandoffProps {
    summary: string;
    gaps?: string;
    durationMs?: number;
    onContinue: () => void;
    onStay?: () => void;
}

/** An instance owns one cancellable UI countdown; the caller owns navigation. */
export function Handoff({
    summary,
    gaps,
    durationMs = 3000,
    onContinue,
    onStay,
}: HandoffProps) {
    const [remaining, setRemaining] = useState(durationMs);
    const [stayed, setStayed] = useState(false);
    const finished = useRef(false);
    const continueRef = useRef(onContinue);
    continueRef.current = onContinue;
    const finish = useCallback(() => {
        if (finished.current) return;
        finished.current = true;
        continueRef.current();
    }, []);
    useEffect(() => {
        if (stayed || finished.current) return;
        const deadline = Date.now() + durationMs;
        const tick = () => {
            const next = Math.max(0, deadline - Date.now());
            setRemaining(next);
            if (next === 0) finish();
        };
        const timer = setInterval(tick, 100);
        return () => clearInterval(timer);
    }, [durationMs, stayed, finish]);
    return (
        <div role="status" className={styles.card}>
            <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span className={styles.ok}>
                    <WorkbenchIcon name="check" size={16} strokeWidth={2.4} />
                </span>
                <span
                    style={{
                        flex: 1,
                        display: "flex",
                        flexDirection: "column",
                        gap: 2,
                    }}>
                    <b style={{ fontSize: 17 }}>Sources ready</b>
                    <span
                        style={{
                            fontSize: 13,
                            color: "var(--muted-foreground)",
                        }}>
                        {summary}
                    </span>
                </span>
                {gaps ? <Badge tone="review">{gaps}</Badge> : null}
            </span>
            <span
                className="wb-divider"
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 16,
                    paddingTop: 16,
                }}>
                <span
                    style={{
                        position: "relative",
                        flexShrink: 0,
                        width: 44,
                        height: 44,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                    }}>
                    <svg
                        width="44"
                        height="44"
                        viewBox="0 0 44 44"
                        aria-hidden="true"
                        style={{
                            position: "absolute",
                            inset: 0,
                            transform: "rotate(-90deg)",
                        }}>
                        <circle
                            cx="22"
                            cy="22"
                            r="18"
                            fill="none"
                            stroke="var(--fill-quiet)"
                            strokeWidth="3"
                        />
                        <circle
                            className={stayed ? undefined : styles.ring}
                            cx="22"
                            cy="22"
                            r="18"
                            fill="none"
                            stroke="var(--brand-purple)"
                            strokeWidth="3"
                            strokeLinecap="round"
                            strokeDasharray="113"
                            strokeDashoffset="0"
                            style={{ animationDuration: `${durationMs}ms` }}
                        />
                    </svg>
                    <b style={{ fontSize: 16 }}>
                        {stayed ? "—" : Math.ceil(remaining / 1000)}
                    </b>
                </span>
                <span
                    style={{
                        flex: 1,
                        display: "flex",
                        flexDirection: "column",
                        gap: 2,
                    }}>
                    <b style={{ fontSize: 15 }}>
                        {stayed ? "Staying here" : "Opening Progress…"}
                    </b>
                    <span
                        style={{
                            fontSize: 13,
                            color: "var(--muted-foreground)",
                        }}>
                        Investigation continues there.
                    </span>
                </span>
                <Button
                    className={styles.btn}
                    disabled={stayed}
                    onClick={() => {
                        setStayed(true);
                        onStay?.();
                    }}
                    style={{
                        background: "transparent",
                        color: "var(--foreground)",
                        boxShadow:
                            "inset 0 0 0 1px color-mix(in oklab,var(--foreground) 16%,transparent)",
                    }}>
                    Stay here
                </Button>
                <Button
                    className={styles.btn}
                    onClick={finish}
                    style={{
                        padding: "0 14px",
                        background: "var(--primary)",
                        color: "var(--primary-foreground)",
                    }}>
                    Go now
                </Button>
            </span>
        </div>
    );
}
