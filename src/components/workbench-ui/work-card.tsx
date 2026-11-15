import type { CSSProperties, ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { WorkbenchIcon } from "./glyphs";
import styles from "./work-card.module.css";

export type WorkCardProps = {
    children: ReactNode;
    className?: string;
    style?: CSSProperties;
} & (
    | {
          kind: "sources";
          onOpen: () => void;
          documentLabel: string;
          documentCount: number;
      }
    | {
          kind: "investigation";
          onOpen: () => void;
          status: ReactNode;
          footer: string;
      }
    | { kind: "locked" }
);
export function WorkCard(props: WorkCardProps) {
    const { children, className, style } = props;
    if (props.kind === "sources") {
        const { onOpen, documentLabel, documentCount } = props;
        return (
            <Button
                onClick={onOpen}
                className={cn("wb-glass", styles.card, className)}
                style={style}>
                <span className={styles.header}>
                    <span className="wb-label">Sources</span>
                    <Badge tone="ink">
                        <WorkbenchIcon
                            name="check"
                            size={11}
                            strokeWidth={2.4}
                        />
                        Prepared
                    </Badge>
                </span>
                <span className={styles.stack}>
                    <span className={cn(styles.sheet, styles.backSheet)}></span>
                    <span
                        className={cn(styles.sheet, styles.middleSheet)}></span>
                    <span className={cn(styles.sheet, styles.frontSheet)}>
                        <span className={cn("wb-meta", styles.documentLabel)}>
                            {documentLabel}
                        </span>
                        <span
                            className={cn(
                                styles.documentLine,
                                styles.longLine,
                            )}></span>
                        <span
                            className={cn(
                                styles.documentLine,
                                styles.shortLine,
                            )}></span>
                        <span
                            className={cn(
                                styles.documentLine,
                                styles.accentLine,
                            )}></span>
                    </span>
                    <span className={styles.documentCount}>
                        <b className={styles.documentCountValue}>
                            {documentCount}
                        </b>
                        <span className="wb-meta">documents</span>
                    </span>
                </span>
                <span className={styles.description}>{children}</span>
            </Button>
        );
    }
    if (props.kind === "investigation") {
        const { onOpen, status, footer } = props;
        return (
            <Button
                onClick={onOpen}
                className={cn(
                    "wb-glass",
                    "wb-focal",
                    "wb-panel-focal",
                    styles.card,
                    className,
                )}
                style={style}>
                <span className={styles.header}>
                    <span className={cn("wb-label", styles.accentLabel)}>
                        Investigation
                    </span>
                    <Badge tone="inference">
                        <span className={cn("wb-live", styles.liveDot)}></span>
                        {status}
                    </Badge>
                </span>
                <span className={styles.investigationBody}>{children}</span>
                <span
                    className={cn(
                        "wb-meta",
                        "wb-divider",
                        styles.investigationFooter,
                    )}>
                    {footer}
                </span>
            </Button>
        );
    }
    return (
        <div
            aria-disabled="true"
            className={cn(styles.card, styles.synthesis, className)}
            style={style}>
            <span className={styles.header}>
                <span className="wb-label">Synthesis</span>
                <Badge tone="dashed">
                    <WorkbenchIcon name="lock" size={11} strokeWidth={2} />
                    Locked
                </Badge>
            </span>
            <span className={styles.lockedDescription}>{children}</span>
            <span className={cn(styles.section, styles.diagram)}>
                <span className={cn("wb-label", styles.sectionLabel)}>
                    Diagram
                </span>
                <span className={styles.diagramPreview} aria-hidden="true">
                    <span className={styles.outerOrbit} />
                    <span className={styles.innerOrbit} />
                    <span className={styles.core} />
                    <span className={styles.leftNode} />
                    <span className={styles.rightNode} />
                    <span className={styles.topNode} />
                    <span className={styles.bottomNode} />
                </span>
            </span>
            <span className={cn(styles.section, styles.brief)}>
                <span className={cn("wb-label", styles.sectionLabel)}>
                    Brief
                </span>
                <span
                    className={cn(styles.briefLine, styles.briefHeadingLine)}
                    aria-hidden="true"
                />
                <span className={styles.briefLine} aria-hidden="true" />
                <span
                    className={cn(styles.briefLine, styles.briefShortLine)}
                    aria-hidden="true"
                />
                <span
                    className={cn(styles.briefLine, styles.briefParagraphLine)}
                    aria-hidden="true"
                />
                <span
                    className={cn(styles.briefLine, styles.briefLastLine)}
                    aria-hidden="true"
                />
            </span>
        </div>
    );
}
