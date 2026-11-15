import { type ComponentProps, type ReactNode, useId } from "react";
import { cn } from "@/lib/utils";
import styles from "./mechanism-node.module.css";

export interface MechanismNodeProps
    extends Omit<ComponentProps<"div">, "children"> {
    kind:
        | "actor"
        | "participant"
        | "observed"
        | "unknown"
        | "threat"
        | "contested"
        | "outside";
    label: string;
    children: ReactNode;
    detail?: ReactNode;
}
/** Presents supplied analytical meaning; the consumer owns content, placement and relations. */
export function MechanismNode({
    kind,
    label,
    children,
    detail,
    className,
    ...props
}: MechanismNodeProps) {
    return (
        <div {...props} className={cn(styles.node, styles[kind], className)}>
            <span>
                <span className={cn("wb-label", styles.label)}>{label}</span>
                <br />
                <span className={styles.title}>{children}</span>
                {detail != null && (
                    <>
                        <br />
                        <span className={styles.detail}>{detail}</span>
                    </>
                )}
            </span>
        </div>
    );
}
export interface MechanismRelation
    extends Pick<
        ComponentProps<"path">,
        "stroke" | "strokeWidth" | "strokeDasharray" | "filter"
    > {
    id: string;
    path: string;
    viewport?: { x: number; y: number; width: number; height: number };
    uncertain?: boolean;
    arrow?: boolean;
}
/** Keeps each relation's filter and transparency local to its supplied SVG viewport. */
export function MechanismRelations({
    width,
    height,
    relations,
}: {
    width: number;
    height: number;
    relations: readonly MechanismRelation[];
}) {
    const id = useId();
    return relations.map((r) => {
        const viewport = r.viewport ?? { x: 0, y: 0, width, height };
        const stroke =
            r.stroke ??
            (r.uncertain ? "var(--muted-foreground)" : "var(--brand-purple)");
        return (
            <svg
                key={r.id}
                width={viewport.width}
                height={viewport.height}
                viewBox={`0 0 ${viewport.width} ${viewport.height}`}
                preserveAspectRatio="none"
                aria-hidden="true"
                className={styles.relation}
                style={{
                    left: viewport.x,
                    top: viewport.y,
                    width: viewport.width,
                    height: viewport.height,
                    stroke,
                    strokeWidth: r.strokeWidth ?? (r.uncertain ? 1.5 : 2),
                    strokeDasharray:
                        r.strokeDasharray ?? (r.uncertain ? "5 4" : undefined),
                    filter: r.filter,
                }}>
                <defs>
                    <marker
                        id={`${id}-${r.id}`}
                        refX="2"
                        refY="2"
                        markerWidth="5"
                        markerHeight="5"
                        orient="auto">
                        <path
                            d="M0 0 L4 2 L0 4 Z"
                            stroke="none"
                            fill={stroke}
                        />
                    </marker>
                </defs>
                <path
                    d={r.path}
                    markerEnd={
                        r.arrow === false ? undefined : `url(#${id}-${r.id})`
                    }
                />
            </svg>
        );
    });
}
