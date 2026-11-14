import type { CSSProperties } from "react";
import { type ClaimTone, claimColors } from "./glyphs";

export type DistributionSegmentKind = ClaimTone | "remaining";
export const distributionColors: Record<DistributionSegmentKind, string> = {
    ...claimColors,
    unknown: "color-mix(in oklab,var(--foreground) 25%,transparent)",
    remaining: "color-mix(in oklab,var(--foreground) 8%,transparent)",
};

/**
 * Proportional claim-class bar. `remaining` fills the unused share of a fixed
 * scale so that rows can be compared; it carries no classification.
 */
export function ClassDistributionBar({
    segments,
    height = 6,
    radius = 3,
    width,
    style,
}: {
    segments: readonly { kind: DistributionSegmentKind; count: number }[];
    height?: number;
    radius?: number;
    width?: CSSProperties["width"];
    style?: CSSProperties;
}) {
    return (
        <span
            aria-hidden="true"
            style={{
                display: "flex",
                height,
                width,
                borderRadius: radius,
                overflow: "hidden",
                gap: 2,
                flexShrink: 0,
                ...style,
            }}>
            {segments
                .filter((segment) => segment.count > 0)
                .map((segment) => (
                    <span
                        key={segment.kind}
                        style={{
                            flex: segment.count,
                            background: distributionColors[segment.kind],
                        }}
                    />
                ))}
        </span>
    );
}
