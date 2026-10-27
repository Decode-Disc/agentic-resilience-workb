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
                    className={styles.mark}
                    style={{ display: "var(--wb-mark-light-display)" }}
                    src={lightMark}
                    alt=""
                />
                <img
                    className={styles.mark}
                    style={{
                        display: "var(--wb-mark-dark-display)",
                        borderRadius: 12,
                    }}
                    src={darkMark}
                    alt=""
                />
                <Chip>{section}</Chip>
                <h1>{title}</h1>
                <span className={styles.sub}>{subtitle}</span>
            </div>
            <div className={styles.card}>
                <span
                    style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                    }}>
                    <span
                        className="wb-label"
                        style={{ color: "var(--accent-foreground)" }}>
                        {appraisalLabel}
                    </span>
                    {status ?? (
                        <Badge tone="review">
                            <svg
                                width="7"
                                height="7"
                                viewBox="0 0 10 10"
                                style={{ width: 7, height: 7 }}
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
                <span className={styles.bal}>
                    {balance.map((value, i) => (
                        <span
                            key={["support", "oppose", "context"][i]}
                            style={{
                                flex: value,
                                background: [
                                    "var(--foreground)",
                                    "var(--counter-evidence)",
                                    "color-mix(in oklab,var(--foreground) 18%,transparent)",
                                ][i],
                            }}
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
