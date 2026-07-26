import {
    AiBrain02Icon,
    DocumentValidationIcon,
    MarketAnalysisIcon,
    SourceCodeIcon,
    UserGroupIcon,
} from '@hugeicons/core-free-icons';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';

import Icon from '@/components/icon';
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { ResearchComposer } from '@/components/workspace/research-composer';
import type { PlatformIcon } from '@/types/ui';

export const Route = createFileRoute('/workspace/start')({
    component: StartAnalysisRoute,
});

/**
 * One selectable evidence layer shown in the dossier start card.
 *
 * Mirrors the Qatalog "module row" pattern: an icon, a title, a short
 * description, and a toggle that expresses whether the layer contributes to
 * the dossier. Defaults are a UI hint, not an authorization to capture sources
 * without the analyst checkpoint.
 */
interface EvidenceLayer {
    id: string;
    title: string;
    description: string;
    icon: PlatformIcon;
    defaultPressed: boolean;
}

const EVIDENCE_LAYERS: readonly EvidenceLayer[] = [
    {
        id: 'sec-filings',
        title: 'SEC filings',
        description:
            'Resolve 10-K, 10-Q and 8-K filings as the primary factual backbone.',
        icon: DocumentValidationIcon,
        defaultPressed: true,
    },
    {
        id: 'investor-context',
        title: 'Investor context',
        description:
            'Bring in earnings transcripts, guidance and investor day framing.',
        icon: MarketAnalysisIcon,
        defaultPressed: true,
    },
    {
        id: 'source-discovery',
        title: 'Source discovery',
        description:
            'Propose candidate external sources for analyst approval before capture.',
        icon: SourceCodeIcon,
        defaultPressed: true,
    },
    {
        id: 'evidence-extraction',
        title: 'Evidence extraction',
        description:
            'Extract atomic claims from approved sources with precise anchors.',
        icon: AiBrain02Icon,
        defaultPressed: true,
    },
    {
        id: 'reference-checks',
        title: 'Reference checks',
        description:
            'Cross-check counter-evidence and unknowns from secondary signals.',
        icon: UserGroupIcon,
        defaultPressed: false,
    },
] as const;

function StartAnalysisRoute() {
    const [pressedLayers, setPressedLayers] = useState<Record<string, boolean>>(
        () =>
            Object.fromEntries(
                EVIDENCE_LAYERS.map((layer) => [
                    layer.id,
                    layer.defaultPressed,
                ]),
            ),
    );

    return (
        <div className="flex flex-col gap-4 justify-center py-8 md:py-14">
            <div className="mx-auto flex w-full max-w-[610px] flex-col items-stretch">
                {/* Header block */}
                <div className="mb-6 flex items-baseline gap-3">
                    <div className="flex items-baseline bg-muted px-2 py-0.5 rounded-sm">
                        <span className="text-[32px] text-accent">
                            {'//'}
                        </span>
                        <h1 className="text-2xl font-medium tracking-tight text-foreground/80">
                            Start a research dossier
                        </h1>
                    </div>
                </div>

                {/* Composer */}
                <ResearchComposer placeholderText="Describe the resilience question to focus on for research. Or choose a company to start." />
            </div>

            {/* Evidence-layer picker (inline, with Toggle primitives) */}
            <Card className="bg-card/15 max-w-4xl sm:mx-auto mx-0">
                <CardHeader>
                    <CardTitle className="text-lg font-medium tracking-tight">
                        Evidence layers
                    </CardTitle>
                    <CardDescription>
                        Toggle the evidence layers you want to assemble for the
                        target company.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <ul className="m-0 flex list-none flex-col gap-0 p-0">
                        {EVIDENCE_LAYERS.map((layer) => (
                            <EvidenceLayerRow
                                key={layer.id}
                                layer={layer}
                                checked={Boolean(pressedLayers[layer.id])}
                                onCheckedChange={(next) =>
                                    setPressedLayers((prev) => ({
                                        ...prev,
                                        [layer.id]: next,
                                    }))
                                }
                            />
                        ))}
                    </ul>
                </CardContent>
            </Card>
        </div>
    );
}

/**
 * Evidence-layer row rendered inline on the start page. Uses the shared
 * `Switch` primitive so the on/off state is keyboard and screen-reader
 * accessible instead of relying on a custom control on every row.
 */
function EvidenceLayerRow({
    layer,
    checked,
    onCheckedChange,
}: {
    layer: EvidenceLayer;
    checked: boolean;
    onCheckedChange: (next: boolean) => void;
}) {
    return (
        <li className="flex items-center justify-between gap-3 border-b border-border/60 py-3 last:border-b-0 last:pb-0 first:pt-0">
            <span className="flex min-w-0 items-center gap-3">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted/60 text-muted-foreground">
                    <Icon iconNode={layer.icon} size={16} />
                </span>
                <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-sm font-medium text-foreground">
                        {layer.title}
                    </span>
                    <span className="text-xs text-muted-foreground">
                        {layer.description}
                    </span>
                </span>
            </span>
            <Switch
                checked={checked}
                onCheckedChange={onCheckedChange}
                aria-label={layer.title}
            />
        </li>
    );
}
