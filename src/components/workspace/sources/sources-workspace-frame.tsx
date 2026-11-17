import type { ReactNode } from "react";
import { WorkbenchIcon } from "@/components/workbench-ui/glyphs";
import { cn } from "@/lib/utils";
import styles from "./sources-workspace-frame.module.css";

export interface SourcesTrailStep {
    id: string;
    label: string;
    /** Earlier steps navigate back; the last step is the current screen. */
    onSelect?: () => void;
}

/**
 * Common Sources frame: section navigation, location trail, page heading and
 * the inventory dock slot. Screens supply their content and actions.
 */
export function SourcesWorkspaceFrame({
    navigation,
    trail = [],
    eyebrow,
    title,
    description,
    titleHidden = false,
    prominent = false,
    headingAside,
    dock,
    children,
}: {
    navigation: ReactNode;
    trail?: readonly SourcesTrailStep[];
    eyebrow?: string;
    title: string;
    description?: ReactNode;
    /** Keeps the title for assistive technology when the screen opens directly on its content. */
    titleHidden?: boolean;
    prominent?: boolean;
    headingAside?: ReactNode;
    dock?: ReactNode;
    children: ReactNode;
}) {
    return (
        <div className={cn(styles.frame, prominent && styles.prominent)}>
            <div className={styles.top}>
                {navigation}
                {trail.length > 1 && (
                    <nav aria-label="Sources location" className={styles.trail}>
                        <ol>
                            {trail.map((step, index) => (
                                <li key={step.id}>
                                    {index > 0 && (
                                        <WorkbenchIcon
                                            name="chevron"
                                            size={12}
                                            strokeWidth={1.6}
                                        />
                                    )}
                                    {index === trail.length - 1 ||
                                    !step.onSelect ? (
                                        <span
                                            aria-current={
                                                index === trail.length - 1
                                                    ? "page"
                                                    : undefined
                                            }>
                                            {step.label}
                                        </span>
                                    ) : (
                                        <button
                                            type="button"
                                            onClick={step.onSelect}>
                                            {step.label}
                                        </button>
                                    )}
                                </li>
                            ))}
                        </ol>
                    </nav>
                )}
            </div>
            {titleHidden ? (
                <h1 className="sr-only">{title}</h1>
            ) : (
                <div className={styles.heading}>
                    <div className={styles.titles}>
                        {eyebrow && (
                            <span className={cn("wb-label", styles.eyebrow)}>
                                {`// ${eyebrow}`}
                            </span>
                        )}
                        <h1 className={styles.title}>{title}</h1>
                        {description && (
                            <p className={styles.description}>{description}</p>
                        )}
                    </div>
                    {headingAside}
                </div>
            )}
            {children}
            {dock && <div className={styles.dock}>{dock}</div>}
        </div>
    );
}
