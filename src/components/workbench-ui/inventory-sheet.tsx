import type { Dialog } from "@base-ui/react/dialog";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
    DialogClose,
    DialogContainer,
    DialogContent,
    DialogTitle,
    Dialog as LinearDialog,
} from "@/components/ui/linear-modal";
import { cn } from "@/lib/utils";
import { ClaimGlyph, type ClaimTone, WorkbenchIcon } from "./glyphs";
import styles from "./inventory-sheet.module.css";
import { WorkbenchUiRoot } from "./root";
export interface InventorySheetProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    total: number;
    query: string;
    onQueryChange: (value: string) => void;
    filters: readonly {
        id: string;
        label: string;
        count: number;
        kind?: ClaimTone;
    }[];
    selectedFilter: string;
    onFilterChange: (id: string) => void;
    recentFirst: boolean;
    onRecentFirstChange: (value: boolean) => void;
    children: ReactNode;
    footer?: ReactNode;
    portalContainer?: HTMLElement | null;
    finalFocus?: Dialog.Popup.Props["finalFocus"];
    trigger?: ReactNode;
}
/** Controlled inventory tools, with modal focus management and theme-preserving portals. */
export function InventorySheet({
    open,
    onOpenChange,
    total,
    query,
    onQueryChange,
    filters,
    selectedFilter,
    onFilterChange,
    recentFirst,
    onRecentFirstChange,
    children,
    footer,
    portalContainer,
    finalFocus,
    trigger,
}: InventorySheetProps) {
    return (
        <LinearDialog open={open} onOpenChange={onOpenChange}>
            {trigger}
            <DialogContainer
                container={portalContainer}
                render={<WorkbenchUiRoot />}
                overlayClassName={styles.dim}
                className={styles.portalPosition}
                style={{
                    position: portalContainer ? "absolute" : "fixed",
                    zIndex: portalContainer ? undefined : 50,
                }}>
                <DialogContent
                    finalFocus={finalFocus}
                    className={styles.sheet}
                    aria-describedby={undefined}>
                    <div className={styles.top}>
                        <span className={cn(styles.heading, styles.heading)}>
                            <span
                                className={cn("wb-label", styles.accentLabel)}>
                                {`// Inventory · ${total} controlled assertions`}
                            </span>
                            <DialogTitle className={styles.title}>
                                Which evidence bears on which question
                            </DialogTitle>
                        </span>
                        <label className={styles.field}>
                            <WorkbenchIcon
                                name="search"
                                size={14}
                                strokeWidth={1.6}
                            />
                            <input
                                type="search"
                                aria-label="Search assertions"
                                placeholder="Search assertions"
                                value={query}
                                onChange={(e) => onQueryChange(e.target.value)}
                            />
                        </label>
                        <DialogClose
                            render={<Button className={styles.collapse} />}>
                            <WorkbenchIcon
                                name="collapse"
                                size={14}
                                strokeWidth={1.7}
                            />
                            Collapse
                        </DialogClose>
                    </div>
                    <div className={styles.bar}>
                        <fieldset
                            className={cn(styles.filters, styles.filterGroup)}
                            aria-label="Assertion class">
                            {filters.map((f) => (
                                <Button
                                    key={f.id}
                                    className={cn(
                                        styles.filter,
                                        selectedFilter === f.id &&
                                            styles.activeFilter,
                                    )}
                                    aria-pressed={selectedFilter === f.id}
                                    onClick={() => onFilterChange(f.id)}>
                                    {f.kind && <ClaimGlyph kind={f.kind} />}{" "}
                                    {f.label} <b>{f.count}</b>
                                </Button>
                            ))}
                        </fieldset>
                        <label className={styles.sort}>
                            <input
                                type="checkbox"
                                checked={recentFirst}
                                onChange={(e) =>
                                    onRecentFirstChange(e.target.checked)
                                }
                                className={styles.sortInput}
                            />
                            Changed recently first
                        </label>
                    </div>
                    <div className={styles.content}>{children}</div>
                    {footer && <div className={styles.footer}>{footer}</div>}
                </DialogContent>
            </DialogContainer>
        </LinearDialog>
    );
}
export function InventoryUse({
    question,
    selected = false,
    children,
    onSelect,
}: {
    question: string;
    selected?: boolean;
    children: ReactNode;
    onSelect: () => void;
}) {
    return (
        <Button
            className={cn(
                styles.use,
                selected ? styles.selectedUse : undefined,
            )}
            onClick={onSelect}>
            <span
                className={cn(
                    styles.questionId,
                    selected ? styles.selectedQuestionId : undefined,
                )}>
                {question}
            </span>
            {children}
        </Button>
    );
}
