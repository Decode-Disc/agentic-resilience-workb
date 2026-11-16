import { Badge } from "@/components/ui/badge";
import { dossierStatus } from "@/lib/presentation/research-copy";

/** A dossier's status as one label and tone on every surface, from the single `dossierStatus` owner. */
export function DossierStatusBadge({
    run,
}: {
    run: Parameters<typeof dossierStatus>[0];
}) {
    const status = dossierStatus(run);
    return (
        <Badge tone={status.tone} showDot={status.running ? "running" : false}>
            {status.label}
        </Badge>
    );
}
