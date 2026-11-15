import { cn } from "@/lib/utils";
import type { ReactNode } from "react";
import lightMark from "@/assets/logos/logo.png";
import darkMark from "@/assets/logos/logo-bgdark.png";
import { Badge } from "@/components/ui/badge";
import { Chip } from "./chip";
import styles from "./cover.module.css";
import { EvidenceBadge } from "./glyphs";
export interface CoverProps {
    title: string;
    subtitle: string;
    section: string;
    appraisalLabel: string;
    reading: ReactNode;
    balance: readonly [number, number, number];
    status?: ReactNode;
    legend?: ReactNode;
}
export function Cover({
    title,
    subtitle,
    section,
    appraisalLabel,
    reading,
    balance,
    status,
    legend,
}: CoverProps) {
    return (
        <div className={styles.cover}>
            <div className={styles.left}>
                <img
                    className={cn(styles.mark, styles.lightMark)}
                    src={lightMark}
                    alt=""
                />
                <img
                    className={cn(styles.mark, styles.darkMark)}
                    src={darkMark}
                    alt=""
                />
                <Chip>{section}</Chip>
                <h1>{title}</h1>
                <span className={styles.subtitle}>{subtitle}</span>
            </div>
            <div className={styles.card}>
                <span className={styles.cardHeader}>
                    <span className={cn("wb-label", styles.accentLabel)}>
                        {appraisalLabel}
                    </span>
                    {status ?? (
                        <Badge tone="review">
                            <svg
                                width="7"
                                height="7"
                                viewBox="0 0 10 10"
                                className={styles.statusDot}
                                aria-hidden="true">
                                <circle
                                    cx="5"
                                    cy="5"
                                    r="5"
                                    fill="var(--review)"
                                />
                            </svg>
                            For review
                        </Badge>
                    )}
                </span>
                <span className={styles.reading}>{reading}</span>
                <span className={styles.balance}>
                    {balance.map((value, i) => (
                        <span
                            key={["support", "oppose", "context"][i]}
                            className={styles.balanceSegment}
                            style={{ flex: value }}
                        />
                    ))}
                </span>
                <span className={styles.row}>
                    {legend ?? (
                        <>
                            <EvidenceBadge kind="fact" />
                            <EvidenceBadge kind="inference" />
                            <EvidenceBadge kind="counter">
                                Counter
                            </EvidenceBadge>
                            <Badge tone="dashed">Unknown</Badge>
                        </>
                    )}
                </span>
            </div>
        </div>
    );
}
