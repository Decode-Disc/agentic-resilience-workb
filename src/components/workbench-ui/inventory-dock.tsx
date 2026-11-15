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
                className={expanded ? undefined : styles.compactBadge}>
                <svg
                    width="5"
                    height="5"
                    viewBox="0 0 10 10"
                    className={styles.statusDot}
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
            className={cn(
                styles.icon,
                expanded ? styles.expandedTrigger : undefined,
            )}>
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
            className={cn(
                "wb-float",
                expanded ? styles.expanded : styles.compact,
            )}
            onClick={onOpen}>
            {expanded ? (
                <>
                    <span className={styles.header}>
                        <span className="wb-label">Inventory</span>
                        {fresh}
                        {icon}
                    </span>
                    <span className={styles.total}>
                        <b className={styles.totalValue}>{total}</b>
                        <span className={styles.totalLabel}>
                            controlled assertions
                        </span>
                    </span>
                    {bar}
                    <span className={styles.legend}>
                        {distribution.map((d) => (
                            <span key={d.kind} className={styles.legendItem}>
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
                        <span className={cn("wb-divider", styles.changes)}>
                            {changes.map((c) => (
                                <span className={styles.change} key={c.id}>
                                    {c.status}
                                    {c.text}
                                </span>
                            ))}
                        </span>
                    )}
                </>
            ) : (
                <>
                    <span className={styles.changeText}>
                        <span className={styles.total}>
                            <span
                                className={cn("wb-label", styles.changeLabel)}>
                                Inventory
                            </span>
                            <b className={styles.changeTitle}>{total}</b>
                            <span className={styles.changeDetail}>
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
