import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
    ClassDistributionBar,
    distributionColors,
} from "./class-distribution-bar";
import {
    ClaimGlyph,
    type ClaimTone,
    claimLabels,
    WorkbenchIcon,
} from "./glyphs";
import styles from "./inventory-dock.module.css";
export interface InventoryDockProps {
    expanded?: boolean;
    total: number;
    newCount?: number;
    distribution: readonly { kind: ClaimTone; count: number; label?: string }[];
    changes?: readonly { id: string; status: ReactNode; text: string }[];
    onOpen: () => void;
}
export function InventoryDock({
    expanded = false,
    total,
    newCount = 0,
    distribution,
    changes = [],
    onOpen,
}: InventoryDockProps) {
    const fresh =
        newCount > 0 ? (
            <Badge
                tone="accent"
                style={
                    expanded
                        ? undefined
                        : { marginLeft: "auto", padding: "1px 6px" }
                }>
                <svg
                    width="5"
                    height="5"
                    viewBox="0 0 10 10"
                    style={{ width: 5, height: 5 }}
                    aria-hidden="true">
                    <circle cx="5" cy="5" r="5" fill="var(--brand-purple)" />
                </svg>
                {newCount} new
            </Badge>
        ) : null;
    const bar = (
        <ClassDistributionBar
            segments={distribution}
            height={expanded ? 7 : 5}
            radius={4}
        />
    );
    const icon = (
        <span
            className={styles.ico}
            style={
                expanded
                    ? { marginLeft: "auto", width: 30, height: 30 }
                    : undefined
            }>
            <WorkbenchIcon
                name="expand"
                size={expanded ? 14 : 15}
                strokeWidth={1.7}
            />
        </span>
    );
    return (
        <Button
            aria-label="Open inventory"
            className={cn("wb-float", expanded ? styles.exp : styles.cmp)}
            onClick={onOpen}>
            {expanded ? (
                <>
                    <span
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                        }}>
                        <span className="wb-label">Inventory</span>
                        {fresh}
                        {icon}
                    </span>
                    <span
                        style={{
                            display: "flex",
                            alignItems: "baseline",
                            gap: 8,
                        }}>
                        <b
                            style={{
                                fontSize: 36,
                                lineHeight: "36px",
                                fontWeight: 500,
                                letterSpacing: "-.045em",
                            }}>
                            {total}
                        </b>
                        <span
                            style={{
                                fontSize: 13,
                                color: "var(--muted-foreground)",
                            }}>
                            controlled assertions
                        </span>
                    </span>
                    {bar}
                    <span className={styles.lgs}>
                        {distribution.map((d) => (
                            <span key={d.kind} className={styles.lg}>
                                <span
                                    style={{
                                        color:
                                            d.kind === "unknown"
                                                ? "var(--evidence-unknown)"
                                                : distributionColors[d.kind],
                                    }}>
                                    <ClaimGlyph kind={d.kind} />
                                </span>
                                {d.label ??
                                    (d.kind === "counter"
                                        ? "Counter"
                                        : claimLabels[d.kind])}
                                <b>{d.count}</b>
                            </span>
                        ))}
                    </span>
                    {changes.length > 0 && (
                        <span
                            className="wb-divider"
                            style={{
                                display: "flex",
                                flexDirection: "column",
                                gap: 7,
                                paddingTop: 12,
                            }}>
                            {changes.map((c) => (
                                <span className={styles.chg} key={c.id}>
                                    {c.status}
                                    {c.text}
                                </span>
                            ))}
                        </span>
                    )}
                </>
            ) : (
                <>
                    <span
                        style={{
                            flex: 1,
                            minWidth: 0,
                            display: "flex",
                            flexDirection: "column",
                            gap: 7,
                        }}>
                        <span
                            style={{
                                display: "flex",
                                alignItems: "baseline",
                                gap: 8,
                            }}>
                            <span
                                className="wb-label"
                                style={{ fontSize: 10.5 }}>
                                Inventory
                            </span>
                            <b
                                style={{
                                    fontSize: 16,
                                    letterSpacing: "-.02em",
                                }}>
                                {total}
                            </b>
                            <span
                                style={{
                                    fontSize: 12,
                                    color: "var(--muted-foreground)",
                                }}>
                                assertions
                            </span>
                            {fresh}
                        </span>
                        {bar}
                    </span>
                    {icon}
                </>
            )}
        </Button>
    );
}
