import { cn } from "@/lib/utils";
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
            <span className={styles.header}>
                <span className={styles.icon}>
                    <WorkbenchIcon name="check" size={16} strokeWidth={2.4} />
                </span>
                <span className={styles.heading}>
                    <b className={styles.title}>Sources ready</b>
                    <span className={styles.description}>{summary}</span>
                </span>
                {gaps ? <Badge tone="review">{gaps}</Badge> : null}
            </span>
            <span className={cn("wb-divider", styles.actions)}>
                <span className={styles.countdown}>
                    <svg
                        width="44"
                        height="44"
                        viewBox="0 0 44 44"
                        aria-hidden="true"
                        className={styles.countdownTrack}>
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
                    <b className={styles.countdownValue}>
                        {stayed ? "—" : Math.ceil(remaining / 1000)}
                    </b>
                </span>
                <span className={styles.heading}>
                    <b className={styles.countdownLabel}>
                        {stayed ? "Staying here" : "Opening Progress…"}
                    </b>
                    <span className={styles.description}>
                        Investigation continues there.
                    </span>
                </span>
                <Button
                    className={cn(styles.button, styles.stayAction)}
                    disabled={stayed}
                    onClick={() => {
                        setStayed(true);
                        onStay?.();
                    }}>
                    Stay here
                </Button>
                <Button
                    className={cn(styles.button, styles.continueAction)}
                    onClick={finish}>
                    Go now
                </Button>
            </span>
        </div>
    );
}
