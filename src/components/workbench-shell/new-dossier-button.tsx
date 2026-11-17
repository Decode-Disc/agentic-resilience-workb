import { Add01Icon } from "@hugeicons/core-free-icons";
import { Link } from "@tanstack/react-router";
import Icon from "@/components/icon";
import { Button, type ButtonProps } from "@/components/ui/button";

/** One creation affordance shared by the shell and dossier selector. */
export function NewDossierButton({
    onClick,
    variant = "secondary",
    size = "sm",
}: ButtonProps = {}) {
    return (
        <Button
            render={onClick ? undefined : <Link to="/workspace/start" />}
            onClick={onClick}
            nativeButton={Boolean(onClick)}
            variant={variant}
            size={size}
            aria-label="Start a company dossier"
            title="Start a company dossier"
            className={
                variant === "link"
                    ? "gap-1 px-1"
                    : "rounded-tile bg-nav-current"
            }>
            {variant === "link" ? (
                <Icon iconNode={Add01Icon} size={14} />
            ) : (
                <span className="start-double-slash">{"//"}</span>
            )}
            <span
                className={
                    variant === "link"
                        ? "start-label"
                        : "start-label text-primary"
                }>
                New dossier
            </span>
        </Button>
    );
}
