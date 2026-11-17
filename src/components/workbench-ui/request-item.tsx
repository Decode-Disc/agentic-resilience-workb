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
        <div className={cn(styles.item, styles.review)}>
            <span className={cn(styles.icon, styles.reviewIcon)}>
                <WorkbenchIcon name="edit" size={16} strokeWidth={1.6} />
            </span>
            <span className={styles.body}>
                <span className={styles.title}>{title}</span>
                <span className={styles.description}>{detail}</span>
            </span>
            <Button
                variant="solid"
                size="compact"
                onClick={onOpen}
                className={styles.reviewAction}>
                Review
            </Button>
        </div>
    ) : state === "searching" ? (
        <Button
            variant="unstyled"
            onClick={onOpen}
            className={cn(styles.item, styles.searching)}>
            <span className={cn(styles.icon, styles.searchIcon)}>
                <WorkbenchIcon name="search" size={16} strokeWidth={1.8} />
            </span>
            <span className={styles.body}>
                <span className={styles.title}>{title}</span>
                <span className={styles.description}>{detail}</span>
            </span>
            <Badge tone="inference" className={styles.status}>
                <span className="wb-live wb-live-dot"></span>
                Searching
            </Badge>
        </Button>
    ) : (
        <Button variant="unstyled" onClick={onOpen} className={styles.item}>
            <span className={cn(styles.icon, styles.unavailableIcon)}>
                <WorkbenchIcon name="search" size={16} strokeWidth={1.8} />
            </span>
            <span className={styles.body}>
                <span className={styles.title}>{title}</span>
                <span className={styles.description}>{detail}</span>
            </span>
            <Badge tone="dashed">Not available</Badge>
        </Button>
    );
}
