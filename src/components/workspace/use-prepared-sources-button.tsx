import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { approvalActionCopy } from "@convex/domain/approvalCopy";
import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { useMutation } from "convex/react";
import { type ComponentProps, useState } from "react";
import { toast } from "sonner";
import Icon from "@/components/icon";
import { Button } from "@/components/ui/button";

/** The named analyst action uses the same audited decision as the conversation's approval card. */
export function UsePreparedSourcesButton({
    runId,
    expectedGeneration,
    size,
    variant,
}: {
    runId: Id<"researchRuns">;
    expectedGeneration: number;
    size?: ComponentProps<typeof Button>["size"];
    variant?: ComponentProps<typeof Button>["variant"];
}) {
    const settlePreparation = useMutation(
        api.execution.approvals.usePreparedSources,
    );
    const [pending, setPending] = useState(false);
    return (
        <Button
            size={size}
            variant={variant}
            disabled={pending}
            onClick={async () => {
                setPending(true);
                try {
                    await settlePreparation({ runId, expectedGeneration });
                } catch {
                    toast.error(
                        "The preparation decision could not be confirmed. Review the current dossier before trying again.",
                    );
                } finally {
                    setPending(false);
                }
            }}>
            {pending
                ? "Using prepared material…"
                : approvalActionCopy.settle_sources_preparation.label}
            <Icon iconNode={ArrowRight01Icon} size={14} />
        </Button>
    );
}
