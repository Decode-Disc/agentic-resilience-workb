import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import styles from "./framing-controls.module.css";
import { WorkbenchIcon } from "./glyphs";
export interface FramingChoice {
    id: string;
    label: string;
}
export interface FramingControlsProps {
    angles: readonly FramingChoice[];
    onAngle: (id: string) => void;
    userTurn?: ReactNode;
    children: ReactNode;
    options: readonly FramingChoice[];
    selected: readonly string[];
    onOption: (id: string) => void;
    replies: readonly FramingChoice[];
    onReply: (id: string) => void;
    onStart: () => void;
    startLabel?: string;
}
export function FramingControls({
    angles,
    onAngle,
    userTurn,
    children,
    options,
    selected,
    onOption,
    replies,
    onReply,
    onStart,
    startLabel = "Start research",
}: FramingControlsProps) {
    return (
        <div className={styles.wrap}>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <span className="wb-label" style={{ paddingLeft: 4 }}>
                    Try an angle
                </span>
                {angles.map((a) => (
                    <Button
                        key={a.id}
                        className={styles.angle}
                        onClick={() => onAngle(a.id)}>
                        <WorkbenchIcon name="slashes" size={14} />
                        {a.label}
                    </Button>
                ))}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {userTurn && <span className={styles.user}>{userTurn}</span>}
                <span className={styles.who}>
                    <span
                        className="wb-slash"
                        style={{ letterSpacing: "-.08em" }}>
                        {"//"}
                    </span>
                    Workbench
                </span>
                <span style={{ fontSize: 14.5, lineHeight: "21px" }}>
                    {children}
                </span>
                <span className={styles.row}>
                    {options.map((o) => (
                        <Button
                            key={o.id}
                            className={styles.opt}
                            aria-pressed={selected.includes(o.id)}
                            onClick={() => onOption(o.id)}>
                            {selected.includes(o.id) && (
                                <WorkbenchIcon
                                    name="check"
                                    size={12}
                                    strokeWidth={2.4}
                                />
                            )}{" "}
                            {o.label}
                        </Button>
                    ))}
                </span>
                <span className={styles.row}>
                    {replies.map((r) => (
                        <Button
                            key={r.id}
                            className={styles.reply}
                            onClick={() => onReply(r.id)}>
                            {r.label}
                        </Button>
                    ))}
                    <span style={{ flex: 1 }} />
                    <Button variant="launch" onClick={onStart}>
                        {startLabel}
                        <WorkbenchIcon name="chevron" />
                    </Button>
                </span>
            </div>
        </div>
    );
}
