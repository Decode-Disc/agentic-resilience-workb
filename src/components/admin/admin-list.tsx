"use client";

import { Fragment, type ReactNode } from "react";

import { ItemGroup, ItemSeparator } from "@/components/ui/item";

/**
 * Renders admin list rows with one separator between them, so every section
 * shares the same list rhythm instead of repeating border and index handling.
 */
export function AdminList<T>({
    items,
    getKey,
    children,
}: {
    items: readonly T[];
    getKey: (item: T) => string;
    children: (item: T) => ReactNode;
}) {
    return (
        <ItemGroup>
            {items.map((item, index) => (
                <Fragment key={getKey(item)}>
                    {index > 0 ? <ItemSeparator /> : null}
                    {children(item)}
                </Fragment>
            ))}
        </ItemGroup>
    );
}
