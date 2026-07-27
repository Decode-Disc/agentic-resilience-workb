import {
    AiBrain02Icon,
    DocumentValidationIcon,
    MarketAnalysisIcon,
    SourceCodeIcon,
    UserGroupIcon,
} from '@hugeicons/core-free-icons';
import { createFileRoute } from '@tanstack/react-router';

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

interface EvidenceLayer {
    id: string;
    title: string;
    description: string;
    icon: PlatformIcon;
}

const EVIDENCE_LAYERS: readonly EvidenceLayer[] = [
    {
        id: 'sec-filings',
        title: 'SEC filings',
        description:
            'Resolve 10-K, 10-Q and 8-K filings as the primary factual backbone.',
        icon: DocumentValidationIcon,
    },
    {
        id: 'investor-context',
        title: 'Investor context',
        description:
            'Bring in earnings transcripts, guidance and investor day framing.',
        icon: MarketAnalysisIcon,
    },
    {
        id: 'source-discovery',
        title: 'Source discovery',
        description:
            'Suggest relevant public sources for your review before they inform the dossier.',
        icon: SourceCodeIcon,
    },
    {
        id: 'evidence-extraction',
        title: 'Evidence extraction',
        description:
            'Extract traceable claims from approved sources with precise references.',
        icon: AiBrain02Icon,
    },
    {
        id: 'reference-checks',
        title: 'Reference checks',
        description:
            'Surface counter-evidence and open questions from additional sources.',
        icon: UserGroupIcon,
    },
] as const;

function StartAnalysisRoute() {
    return (
        <div className="flex flex-col justify-center gap-4 py-8 md:py-14">
            <div className="mx-auto flex w-full max-w-[610px] flex-col items-stretch">
                <div className="mb-6 flex items-baseline gap-3">
                    <div className="flex items-baseline rounded-sm bg-muted px-2 py-0.5">
                        <span
                            aria-hidden="true"
                            className="text-[32px] start-double-slash"
                        >
                            {'//'}
                        </span>
                        <h1 className="text-2xl font-medium tracking-tight text-foreground/70">
                            Start a research dossier
                        </h1>
                    </div>
                </div>

                <ResearchComposer placeholderText="Describe the resilience question to focus on for research. Or choose a company to start." />
            </div>

            <Card className="mx-0 max-w-4xl bg-card/15 sm:mx-auto">
                <CardHeader>
                    <CardTitle className="text-lg font-medium tracking-tight">
                        Evidence layers
                    </CardTitle>
                    <CardDescription>
                        Every dossier follows the same evidence safeguards. This
                        choice only changes which sources we look for first.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <ul className="m-0 flex list-none flex-col gap-0 p-0">
                        {EVIDENCE_LAYERS.map((layer) => (
                            <EvidenceLayerRow key={layer.id} layer={layer} />
                        ))}
                    </ul>
                </CardContent>
            </Card>
        </div>
    );
}

function EvidenceLayerRow({ layer }: { layer: EvidenceLayer }) {
    return (
        <li className="flex items-center justify-between gap-3 border-b border-border/60 py-3 first:pt-0 last:border-b-0 last:pb-0">
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
            <Switch checked disabled aria-label={`${layer.title} — required`} />
        </li>
    );
}
