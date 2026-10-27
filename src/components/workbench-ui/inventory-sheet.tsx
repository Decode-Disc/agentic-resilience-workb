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
                style={{
                    position: portalContainer ? "absolute" : "fixed",
                    inset: 0,
                    zIndex: portalContainer ? undefined : 50,
                }}>
                <DialogContent
                    finalFocus={finalFocus}
                    className={styles.sheet}
                    aria-describedby={undefined}>
                    <div className={styles.top}>
                        <span
                            className={styles.heading}
                            style={{
                                display: "flex",
                                flexDirection: "column",
                                gap: 6,
                            }}>
                            <span
                                className="wb-label"
                                style={{
                                    color: "var(--accent-foreground)",
                                }}>
                                {`// Inventory · ${total} controlled assertions`}
                            </span>
                            <DialogTitle
                                style={{
                                    fontSize: 22,
                                    lineHeight: "26px",
                                    fontWeight: 500,
                                    letterSpacing: "-.035em",
                                    margin: 0,
                                }}>
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
                            render={<Button className={styles.coll} />}>
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
                            className={styles.seg}
                            aria-label="Assertion class"
                            style={{ margin: 0, border: 0 }}>
                            {filters.map((f) => (
                                <Button
                                    key={f.id}
                                    className={cn(
                                        styles.flt,
                                        selectedFilter === f.id &&
                                            styles["flt-on"],
                                    )}
                                    aria-pressed={selectedFilter === f.id}
                                    onClick={() => onFilterChange(f.id)}>
                                    {f.kind && <ClaimGlyph kind={f.kind} />}{" "}
                                    {f.label} <b>{f.count}</b>
                                </Button>
                            ))}
                        </fieldset>
                        <label
                            style={{
                                marginLeft: "auto",
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 8,
                                fontSize: 13,
                                fontWeight: 500,
                            }}>
                            <input
                                type="checkbox"
                                checked={recentFirst}
                                onChange={(e) =>
                                    onRecentFirstChange(e.target.checked)
                                }
                                style={{
                                    width: 16,
                                    height: 16,
                                    margin: 0,
                                    accentColor: "var(--brand-purple)",
                                }}
                            />
                            Changed recently first
                        </label>
                    </div>
                    <div className={styles.content}>{children}</div>
                    {footer && <div className={styles.foot}>{footer}</div>}
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
            className={styles.use}
            onClick={onSelect}
            style={
                selected
                    ? {
                          boxShadow:
                              "0 0 0 1px color-mix(in oklab,var(--brand-purple) 35%,transparent)",
                      }
                    : undefined
            }>
            <span
                className={styles.qw}
                style={
                    selected
                        ? {
                              background: "var(--primary)",
                              color: "var(--primary-foreground)",
                          }
                        : undefined
                }>
                {question}
            </span>
            {children}
        </Button>
    );
}
