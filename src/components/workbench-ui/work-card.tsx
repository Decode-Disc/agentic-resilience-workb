import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { WorkbenchIcon } from "./glyphs";
import styles from "./work-card.module.css";

export type WorkCardProps = { children: ReactNode } & (
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
    const { children } = props;
    if (props.kind === "sources") {
        const { onOpen, documentLabel, documentCount } = props;
        return (
            <Button onClick={onOpen} className={cn("wb-glass", styles.wc)}>
                <span className={cn(styles.hd)}>
                    <span className={cn("wb-label")}>Sources</span>
                    <Badge tone="ink">
                        <WorkbenchIcon
                            name="check"
                            size={11}
                            strokeWidth={2.4}
                        />
                        Prepared
                    </Badge>
                </span>
                <span className={cn(styles.stack)}>
                    <span
                        className={cn(styles.sheet)}
                        style={{
                            left: "36px",
                            top: "0",
                            transform: "rotate(5deg)",
                        }}></span>
                    <span
                        className={cn(styles.sheet)}
                        style={{
                            left: "18px",
                            top: "8px",
                            transform: "rotate(-3deg)",
                        }}></span>
                    <span
                        className={cn(styles.sheet)}
                        style={{
                            left: "0",
                            top: "16px",
                            width: "170px",
                            padding: "12px 14px",
                            display: "flex",
                            flexDirection: "column",
                            gap: "6px",
                            boxShadow: "var(--shadow-raised)",
                        }}>
                        <span
                            className={cn("wb-meta")}
                            style={{ fontSize: "10.5px" }}>
                            {documentLabel}
                        </span>
                        <span
                            className={cn(styles.ln)}
                            style={{ width: "120px" }}></span>
                        <span
                            className={cn(styles.ln)}
                            style={{ width: "96px" }}></span>
                        <span
                            className={cn(styles.ln)}
                            style={{
                                width: "108px",
                                background:
                                    "color-mix(in oklab,var(--brand-purple) 30%,transparent)",
                            }}></span>
                    </span>
                    <span
                        style={{
                            position: "absolute",
                            right: "0",
                            top: "30px",
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "flex-end",
                        }}>
                        <b
                            style={{
                                fontSize: "30px",
                                lineHeight: "32px",
                                fontWeight: "500",
                                letterSpacing: "-.04em",
                            }}>
                            {documentCount}
                        </b>
                        <span className={cn("wb-meta")}>documents</span>
                    </span>
                </span>
                <span
                    style={{
                        fontSize: 13.5,
                        lineHeight: "19px",
                        color: "var(--muted-foreground)",
                    }}>
                    {children}
                </span>
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
                    styles.focalbg,
                    styles.wc,
                )}>
                <span className={cn(styles.hd)}>
                    <span
                        className={cn("wb-label")}
                        style={{ color: "var(--accent-foreground)" }}>
                        Investigation
                    </span>
                    <Badge tone="inference">
                        <span
                            className={cn("wb-live")}
                            style={{
                                width: "7px",
                                height: "7px",
                                borderRadius: "50%",
                                background: "var(--brand-purple)",
                                display: "inline-block",
                            }}></span>
                        {status}
                    </Badge>
                </span>
                <span
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 10,
                    }}>
                    {children}
                </span>
                <span
                    className={cn("wb-meta", "wb-divider")}
                    style={{ paddingTop: "10px" }}>
                    {footer}
                </span>
            </Button>
        );
    }
    return (
        <div
            className={cn("wb-dashed", styles.wc)}
            style={{ color: "var(--muted-foreground)" }}>
            <span className={cn(styles.hd)}>
                <span className={cn("wb-label")}>Synthesis</span>
                <Badge tone="dashed">
                    <WorkbenchIcon name="lock" size={11} strokeWidth={2} />
                    Locked
                </Badge>
            </span>
            <span
                style={{
                    fontSize: "13.5px",
                    lineHeight: "19px",
                    color: "var(--foreground)",
                }}>
                {children}
            </span>
            <span className={cn(styles.sec)}>
                <span className={cn("wb-label")} style={{ fontSize: "10px" }}>
                    Diagram
                </span>
                <span
                    style={{
                        height: "120px",
                        display: "block",
                        borderRadius: "50%",
                        border: "1px dashed currentColor",
                        width: "120px",
                        margin: "0 auto",
                        opacity: ".6",
                    }}></span>
            </span>
            <span className={cn(styles.sec)}>
                <span className={cn("wb-label")} style={{ fontSize: "10px" }}>
                    Brief
                </span>
                <span
                    className={cn(styles.ln)}
                    style={{ height: "7px", width: "92%" }}></span>
                <span
                    className={cn(styles.ln)}
                    style={{ height: "7px", width: "100%" }}></span>
                <span
                    className={cn(styles.ln)}
                    style={{ height: "7px", width: "70%" }}></span>
            </span>
        </div>
    );
}
