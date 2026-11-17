import type { ComponentProps, CSSProperties } from "react";
import Icon from "@/components/icon";
import { Badge } from "@/components/ui/badge";
import type { PlatformIcon } from "@/types/ui";

const nodes = {
    defer: [
        [
            "path",
            {
                d: "M5 12h12M13 8l4 4-4 4",
                key: "defer",
                strokeLinecap: "round",
                strokeLinejoin: "round",
            },
        ],
    ],
    check: [
        [
            "path",
            {
                d: "M4 12.5l5 5L20 6.5",
                key: "0",
                strokeLinecap: "round",
                strokeLinejoin: "round",
            },
        ],
    ],
    barred: [
        [
            "circle",
            {
                cx: "12",
                cy: "12",
                r: "8",
                key: "0",
                strokeLinecap: "round",
                strokeLinejoin: "round",
            },
        ],
        [
            "path",
            {
                d: "M6.5 17.5l11-11",
                key: "1",
                strokeLinecap: "round",
                strokeLinejoin: "round",
            },
        ],
    ],
    lock: [
        [
            "rect",
            {
                x: "5",
                y: "11",
                width: "14",
                height: "9",
                rx: "2",
                key: "0",
                strokeLinecap: "round",
                strokeLinejoin: "round",
            },
        ],
        [
            "path",
            {
                d: "M8 11V8a4 4 0 0 1 8 0v3",
                key: "1",
                strokeLinecap: "round",
                strokeLinejoin: "round",
            },
        ],
    ],
    expand: [
        [
            "path",
            {
                d: "M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7",
                key: "0",
                strokeLinecap: "round",
                strokeLinejoin: "round",
            },
        ],
    ],
    search: [
        [
            "circle",
            {
                cx: "11",
                cy: "11",
                r: "6.5",
                key: "0",
                strokeLinecap: "round",
                strokeLinejoin: "round",
            },
        ],
        [
            "path",
            {
                d: "M16 16l4 4",
                key: "1",
                strokeLinecap: "round",
                strokeLinejoin: "round",
            },
        ],
    ],
    collapse: [
        [
            "path",
            {
                d: "M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7",
                key: "0",
                strokeLinecap: "round",
                strokeLinejoin: "round",
            },
        ],
    ],
    "document-check": [
        [
            "path",
            {
                d: "M6 4h9l4 4v12H6z",
                key: "0",
                strokeLinecap: "round",
                strokeLinejoin: "round",
            },
        ],
        [
            "path",
            {
                d: "M9.5 13l2 2 3.5-4",
                key: "1",
                strokeLinecap: "round",
                strokeLinejoin: "round",
            },
        ],
    ],
    "document-minus": [
        [
            "path",
            {
                d: "M6 4h9l4 4v12H6z",
                key: "0",
                strokeLinecap: "round",
                strokeLinejoin: "round",
            },
        ],
        [
            "path",
            {
                d: "M9.5 14h6",
                key: "1",
                strokeLinecap: "round",
                strokeLinejoin: "round",
            },
        ],
    ],
    half: [
        [
            "circle",
            {
                cx: "12",
                cy: "12",
                r: "8",
                key: "0",
                strokeLinecap: "round",
                strokeLinejoin: "round",
            },
        ],
        [
            "path",
            {
                d: "M12 4a8 8 0 0 1 0 16z",
                fill: "currentColor",
                key: "1",
                strokeLinecap: "round",
                strokeLinejoin: "round",
            },
        ],
    ],
    clock: [
        [
            "path",
            {
                d: "M12 4a8 8 0 1 1-8 8",
                key: "0",
                strokeLinecap: "round",
                strokeLinejoin: "round",
            },
        ],
        [
            "path",
            {
                d: "M12 8v4l2.5 2",
                key: "1",
                strokeLinecap: "round",
                strokeLinejoin: "round",
            },
        ],
    ],
    unfinished: [
        [
            "path",
            {
                d: "M12 4a8 8 0 1 1-8 8",
                key: "arc",
                strokeLinecap: "round",
                strokeLinejoin: "round",
            },
        ],
    ],
    pause: [
        [
            "path",
            {
                d: "M9 6.5v11M15 6.5v11",
                key: "0",
                strokeLinecap: "round",
                strokeLinejoin: "round",
            },
        ],
    ],
    warning: [
        [
            "path",
            {
                d: "M12 5l8 14H4z",
                key: "0",
                strokeLinecap: "round",
                strokeLinejoin: "round",
            },
        ],
        [
            "path",
            {
                d: "M12 10v4M12 16.5v.5",
                key: "1",
                strokeLinecap: "round",
                strokeLinejoin: "round",
            },
        ],
    ],
    edit: [
        [
            "path",
            {
                d: "M4 20h4L19 9l-4-4L4 16z",
                key: "0",
                strokeLinecap: "round",
                strokeLinejoin: "round",
            },
        ],
    ],
    "unfinished-check": [
        [
            "circle",
            {
                cx: "12",
                cy: "12",
                r: "8",
                key: "0",
                strokeDasharray: "3 3",
                strokeLinecap: "round",
                strokeLinejoin: "round",
            },
        ],
    ],
    conflict: [
        [
            "path",
            {
                d: "M4 8h14M14 4l4 4-4 4M20 16H6M10 12l-4 4 4 4",
                key: "0",
                strokeLinecap: "round",
                strokeLinejoin: "round",
            },
        ],
    ],
    unestablished: [
        [
            "circle",
            {
                cx: "12",
                cy: "12",
                r: "8",
                key: "0",
                strokeLinecap: "round",
                strokeLinejoin: "round",
            },
        ],
        [
            "path",
            {
                d: "M8 12h8",
                key: "1",
                strokeLinecap: "round",
                strokeLinejoin: "round",
            },
        ],
    ],
    chevron: [
        [
            "path",
            {
                d: "M9 6l6 6-6 6",
                key: "0",
                strokeLinecap: "round",
                strokeLinejoin: "round",
            },
        ],
    ],
    slashes: [
        [
            "path",
            {
                d: "M4 20L12 4M12 20L20 4",
                key: "0",
                strokeLinecap: "round",
                strokeLinejoin: "round",
            },
        ],
    ],
    back: [
        [
            "path",
            {
                d: "M15 6l-6 6 6 6",
                key: "0",
                strokeLinecap: "round",
                strokeLinejoin: "round",
            },
        ],
    ],
    external: [
        [
            "path",
            {
                d: "M9 5h10v10M19 5L8 16",
                key: "0",
                strokeLinecap: "round",
                strokeLinejoin: "round",
            },
        ],
    ],
} as const;

/** The reference stroke paths, rendered through the project's icon boundary. */
export function WorkbenchIcon({
    name,
    size = 16,
    strokeWidth = 1.8,
    style,
}: {
    name: keyof typeof nodes;
    size?: number;
    strokeWidth?: number;
    style?: CSSProperties;
}) {
    return (
        <span aria-hidden="true" style={{ display: "contents", ...style }}>
            <Icon
                iconNode={nodes[name] as PlatformIcon}
                size={size}
                strokeWidth={strokeWidth}
            />
        </span>
    );
}

export type ClaimTone =
    | "fact"
    | "inference"
    | "hypothesis"
    | "unknown"
    | "counter";
export const claimLabels: Record<ClaimTone, string> = {
    fact: "Fact",
    inference: "Inference",
    hypothesis: "Hypothesis",
    unknown: "Unknown",
    counter: "Counter-evidence",
};

const claimCountLabels: Record<ClaimTone, [string, string]> = {
    fact: ["fact", "facts"],
    inference: ["inference", "inferences"],
    hypothesis: ["hypothesis", "hypotheses"],
    unknown: ["unknown", "unknowns"],
    counter: ["counter-evidence", "counter-evidence"],
};

/** Counted claim class in running text, such as "4 inferences". */
export function claimCountLabel(kind: ClaimTone, count: number) {
    return `${count} ${claimCountLabels[kind][count === 1 ? 0 : 1]}`;
}

/** Claim-class colors; Badge tones use the same theme tokens. */
export const claimColors: Record<ClaimTone, string> = {
    fact: "var(--evidence-fact)",
    inference: "var(--evidence-inference)",
    hypothesis: "var(--evidence-hypothesis)",
    unknown: "var(--evidence-unknown)",
    counter: "var(--counter-evidence)",
};

/**
 * Geometry conveys the presentation class independently of color. Inside a
 * badge it inherits the badge color; standalone uses pass `colored`.
 */
export function ClaimGlyph({
    kind,
    size = kind === "fact" ? 8 : 9,
    colored = false,
}: {
    kind: ClaimTone;
    size?: number;
    colored?: boolean;
}) {
    return (
        <svg
            width={size}
            height={size}
            style={{
                width: size,
                height: size,
                flexShrink: 0,
                color: colored ? claimColors[kind] : undefined,
            }}
            viewBox="0 0 10 10"
            aria-hidden="true">
            {kind === "fact" ? (
                <rect width="10" height="10" rx="2" fill="currentColor" />
            ) : kind === "inference" ? (
                <path d="M5 0L10 10H0Z" fill="currentColor" />
            ) : kind === "counter" ? (
                <rect
                    y="3.5"
                    width="10"
                    height="3"
                    rx="1"
                    fill="currentColor"
                />
            ) : (
                <circle
                    cx="5"
                    cy="5"
                    r="4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={kind === "unknown" ? 1.5 : 2}
                    strokeDasharray={kind === "unknown" ? "2 2" : undefined}
                />
            )}
        </svg>
    );
}

export function EvidenceBadge({
    kind,
    children,
    ...props
}: Omit<ComponentProps<typeof Badge>, "tone"> & { kind: ClaimTone }) {
    return (
        <Badge tone={kind} {...props}>
            <ClaimGlyph kind={kind} />
            {children ?? claimLabels[kind]}
        </Badge>
    );
}

export type ReadingState = "full" | "partial" | "unavailable";
/** Capture completeness, not how much the agent read: a complete capture is not proof of complete reading. */
export const readingLabels: Record<ReadingState, string> = {
    full: "Complete capture",
    partial: "Partial capture",
    unavailable: "Unavailable",
};

/** Preparation-progress rule: violet only for completed reading, a contrasting neutral for partial work, a quiet neutral otherwise. */
export const readingColors: Record<ReadingState, string> = {
    full: "var(--brand-purple)",
    partial:
        "repeating-linear-gradient(90deg, var(--foreground) 0 3px, color-mix(in oklab, var(--foreground) 18%, transparent) 3px 5px)",
    unavailable: "color-mix(in oklab, var(--foreground) 12%, transparent)",
};
const readingGlyphColors: Record<ReadingState, string> = {
    full: "var(--brand-purple)",
    partial: "var(--foreground)",
    unavailable: "var(--muted-foreground)",
};

/** Reading availability by geometry: filled, half-filled or a dashed ring. */
export function ReadingGlyph({
    state,
    size = 14,
}: {
    state: ReadingState;
    size?: number;
}) {
    return (
        <svg
            width={size}
            height={size}
            style={{
                width: size,
                height: size,
                flexShrink: 0,
                color: readingGlyphColors[state],
            }}
            viewBox="0 0 24 24"
            aria-hidden="true">
            {state === "full" ? (
                <circle cx="12" cy="12" r="8" fill="currentColor" />
            ) : state === "partial" ? (
                <>
                    <circle
                        cx="12"
                        cy="12"
                        r="7.25"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                    />
                    <path
                        d="M12 4.75a7.25 7.25 0 0 1 0 14.5z"
                        fill="currentColor"
                    />
                </>
            ) : (
                <circle
                    cx="12"
                    cy="12"
                    r="8"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeDasharray="3 3"
                />
            )}
        </svg>
    );
}

/** Candidates never captured: an open lead, drawn as a faint hatch rather than a failure. */
const notCapturedColor =
    "repeating-linear-gradient(135deg, color-mix(in oklab, var(--foreground) 14%, transparent) 0 2px, transparent 2px 5px)";

/** Proportional capture coverage across complete, partial, unavailable and, when supplied, never-captured candidates. */
export function ReadingBar({
    counts,
    height = 8,
    width,
}: {
    counts: Record<ReadingState, number> & { notCaptured?: number };
    height?: number;
    width?: CSSProperties["width"];
}) {
    return (
        <span
            aria-hidden="true"
            style={{
                display: "flex",
                gap: 2,
                height,
                width,
                borderRadius: height / 2,
                overflow: "hidden",
                flexShrink: 0,
            }}>
            {(["full", "partial", "unavailable", "notCaptured"] as const).map(
                (state) =>
                    (counts[state] ?? 0) > 0 && (
                        <span
                            key={state}
                            style={{
                                flex: counts[state],
                                background:
                                    state === "notCaptured"
                                        ? notCapturedColor
                                        : readingColors[state],
                            }}
                        />
                    ),
            )}
        </span>
    );
}
