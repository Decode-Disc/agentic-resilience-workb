import type { ReactNode } from "react";
import "./composer.css";

/** Shared field surface and action separation; consumers retain input and submission ownership. */
export function ComposerSurface({
    input,
    footer,
    context,
    expanded = true,
}: {
    input: ReactNode;
    footer: ReactNode;
    context?: ReactNode;
    expanded?: boolean;
}) {
    return (
        <div data-slot="composer-surface" data-expanded={expanded}>
            {context && <div className="composer-context">{context}</div>}
            <div className="composer-field">{input}</div>
            {footer}
        </div>
    );
}

/** Keeps context, shared tools and the primary action aligned across both composer consumers. */
export function ComposerToolbar({
    tools,
    action,
    context,
}: {
    tools?: ReactNode;
    action: ReactNode;
    context?: ReactNode;
}) {
    return (
        <div data-slot="composer-toolbar">
            {context && (
                <div className="composer-toolbar-context">{context}</div>
            )}
            <div className="composer-tools">{tools}</div>
            <div className="composer-submit">{action}</div>
        </div>
    );
}
