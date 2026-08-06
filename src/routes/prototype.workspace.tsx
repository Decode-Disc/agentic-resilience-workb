import { createFileRoute } from "@tanstack/react-router";

import type { PrototypeVariant } from "@/components/workspace-prototype/prototype-data";
import { WorkspacePrototype } from "@/components/workspace-prototype/workspace-prototype";

const prototypeVariants = new Set<PrototypeVariant>(["a", "b", "c"]);

function isPrototypeVariant(value: unknown): value is PrototypeVariant {
    return (
        typeof value === "string" &&
        prototypeVariants.has(value as PrototypeVariant)
    );
}

export const Route = createFileRoute("/prototype/workspace")({
    validateSearch: (search: Record<string, unknown>) => ({
        variant: isPrototypeVariant(search.variant) ? search.variant : "a",
    }),
    component: WorkspacePrototypeRoute,
});

function WorkspacePrototypeRoute() {
    const { variant } = Route.useSearch();
    const navigate = Route.useNavigate();

    return (
        <WorkspacePrototype
            variant={variant}
            onVariantChange={(nextVariant) => {
                void navigate({
                    search: { variant: nextVariant },
                    replace: true,
                });
            }}
        />
    );
}
