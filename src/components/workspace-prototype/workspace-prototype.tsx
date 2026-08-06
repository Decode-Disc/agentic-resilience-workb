import type { PrototypeVariant } from "./prototype-data";
import { PrototypeSwitcher } from "./prototype-switcher";
import { VariantLongForm } from "./variant-long-form";
import { VariantMasterDetail } from "./variant-master-detail";
import { VariantNavigationRail } from "./variant-navigation-rail";

// Three workspace compositions, switchable via `?variant=`, on `/prototype/workspace`.
export function WorkspacePrototype({
    variant,
    onVariantChange,
}: {
    variant: PrototypeVariant;
    onVariantChange: (variant: PrototypeVariant) => void;
}) {
    return (
        <>
            {variant === "a" && <VariantNavigationRail />}
            {variant === "b" && <VariantMasterDetail />}
            {variant === "c" && <VariantLongForm />}
            {import.meta.env.DEV && (
                <PrototypeSwitcher
                    current={variant}
                    onSelect={onVariantChange}
                />
            )}
        </>
    );
}
