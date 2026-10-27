import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { WorkbenchIcon } from "./glyphs";
import styles from "./request-item.module.css";

export interface RequestItemProps {
    state: "review" | "searching" | "unavailable";
    title: string;
    detail: string;
    onOpen: () => void;
}
export function RequestItem({
    state,
    title,
    detail,
    onOpen,
}: RequestItemProps) {
    return state === "review" ? (
        <div
            className={cn(styles.it)}
            style={{
                background: "color-mix(in oklab,var(--review) 10%,var(--card))",
                boxShadow:
                    "0 0 0 1px color-mix(in oklab,var(--review) 50%,transparent)",
            }}>
            <span
                className={cn(styles.ico)}
                style={{
                    background:
                        "color-mix(in oklab,var(--review) 25%,var(--card))",
                    color: "var(--review-foreground)",
                }}>
                <WorkbenchIcon name="edit" size={16} strokeWidth={1.6} />
            </span>
            <span
                style={{
                    flex: "1",
                    display: "flex",
                    flexDirection: "column",
                    gap: "5px",
                }}>
                <span className={cn(styles.t)}>{title}</span>
                <span className={cn(styles.d)}>{detail}</span>
            </span>
            <Button onClick={onOpen} className={cn(styles.go)}>
                Review
            </Button>
        </div>
    ) : state === "searching" ? (
        <Button
            onClick={onOpen}
            className={cn(styles.it)}
            style={{
                background: "var(--card)",
                boxShadow:
                    "0 0 0 1.5px color-mix(in oklab,var(--brand-purple) 45%,transparent),0 12px 24px -16px color-mix(in oklab,var(--brand-purple) 60%,transparent)",
            }}>
            <span
                className={cn(styles.ico)}
                style={{
                    background: "var(--accent)",
                    color: "var(--accent-foreground)",
                }}>
                <WorkbenchIcon name="search" size={16} strokeWidth={1.8} />
            </span>
            <span
                style={{
                    flex: "1",
                    display: "flex",
                    flexDirection: "column",
                    gap: "5px",
                }}>
                <span className={cn(styles.t)}>{title}</span>
                <span className={cn(styles.d)}>{detail}</span>
            </span>
            <Badge tone="inference" style={{ alignSelf: "center" }}>
                <span
                    className={cn("wb-live")}
                    style={{
                        width: "7px",
                        height: "7px",
                        borderRadius: "50%",
                        background: "var(--brand-purple)",
                        display: "inline-block",
                    }}></span>
                Searching
            </Badge>
        </Button>
    ) : (
        <Button onClick={onOpen} className={cn(styles.it)}>
            <span
                className={cn(styles.ico)}
                style={{
                    background: "var(--fill-quiet)",
                    color: "var(--muted-foreground)",
                }}>
                <WorkbenchIcon name="search" size={16} strokeWidth={1.8} />
            </span>
            <span
                style={{
                    flex: "1",
                    display: "flex",
                    flexDirection: "column",
                    gap: "5px",
                }}>
                <span className={cn(styles.t)}>{title}</span>
                <span className={cn(styles.d)}>{detail}</span>
            </span>
            <Badge tone="dashed">Not available</Badge>
        </Button>
    );
}
