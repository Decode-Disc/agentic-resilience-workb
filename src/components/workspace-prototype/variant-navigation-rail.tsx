import {
    BookOpenTextIcon,
    ChartAnalysisIcon,
    CheckmarkCircle02Icon,
    FileSearchIcon,
    MapsIcon,
} from '@hugeicons/core-free-icons';

import Icon from '@/components/icon';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LiquidGlassCard } from '@/components/ui/liquid-glass';
import {
    ResizableHandle,
    ResizablePanel,
    ResizablePanelGroup,
} from '@/components/ui/resizable';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { WorkbenchShell } from '@/components/workbench-shell/workbench-shell';
import { useResponsive } from '@/hooks/use-responsive';
import { prototypeClaims, prototypeDimensions } from './prototype-data';
import {
    ClaimSurface,
    DossierHeadingDisclosure,
    EvidenceKey,
    PrototypeNotice,
} from './prototype-primitives';

const sections = [
    { name: 'Progress', icon: CheckmarkCircle02Icon, state: 'Complete' },
    { name: 'Sources', icon: FileSearchIcon, state: '12 accepted' },
    { name: 'Evidence', icon: ChartAnalysisIcon, state: 'Active' },
    { name: 'Assessment', icon: ChartAnalysisIcon, state: '4 / 10' },
    { name: 'Map', icon: MapsIcon, state: 'Derived' },
    { name: 'Brief', icon: BookOpenTextIcon, state: 'Locked' },
] as const;

export function VariantNavigationRail() {
    const { isMobile } = useResponsive();

    return (
        <WorkbenchShell>
            <div className="flex h-[calc(100svh-5.5625rem)] min-h-0 flex-col overflow-hidden bg-muted/30 text-foreground">
                <PrototypeNotice />
                <div className="mx-auto grid min-h-0 w-full max-w-[100rem] flex-1 grid-rows-[auto_minmax(0,1fr)] overflow-hidden lg:grid-cols-[15rem_minmax(0,1fr)] lg:grid-rows-1">
                    <aside className="min-h-0 overflow-hidden border-b p-2 lg:border-r lg:border-b-0">
                        <LiquidGlassCard
                            className="h-full min-h-0 overflow-hidden p-0"
                            glowIntensity="xs"
                            shadowIntensity="sm"
                            whileHover={undefined}
                            whileTap={undefined}
                        >
                            <ScrollArea className="h-full">
                                <div className="p-4">
                                    <p className="mb-5 text-sm font-medium">
                                        Evidence Workbench
                                    </p>
                                    <nav aria-label="Research dossier">
                                        <ul className="grid grid-cols-2 gap-1 sm:grid-cols-3 lg:grid-cols-1">
                                            {sections.map((section) => (
                                                <li key={section.name}>
                                                    <Button
                                                        variant={
                                                            section.name ===
                                                            'Evidence'
                                                                ? 'secondary'
                                                                : 'ghost'
                                                        }
                                                        className="w-full justify-start"
                                                    >
                                                        <Icon
                                                            iconNode={
                                                                section.icon
                                                            }
                                                            data-icon="inline-start"
                                                        />
                                                        <span className="truncate">
                                                            {section.name}
                                                        </span>
                                                        <span className="ml-auto hidden text-xs text-muted-foreground lg:inline">
                                                            {section.state}
                                                        </span>
                                                    </Button>
                                                </li>
                                            ))}
                                        </ul>
                                    </nav>
                                    <Separator className="my-5 hidden lg:block" />
                                    <div className="hidden flex-col gap-2 text-xs text-muted-foreground lg:flex">
                                        <p className="font-medium text-foreground">
                                            Persisted workflow
                                        </p>
                                        <p>
                                            Last event · Claim extraction
                                            completed
                                        </p>
                                        <p>Workflow v2 · Generation 1</p>
                                    </div>
                                </div>
                            </ScrollArea>
                        </LiquidGlassCard>
                    </aside>

                    <main className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-background">
                        <DossierHeadingDisclosure />
                        <ResizablePanelGroup
                            orientation={isMobile ? 'vertical' : 'horizontal'}
                            defaultLayout={{
                                evidence: isMobile ? 66 : 72,
                                context: isMobile ? 34 : 20,
                            }}
                            className="min-h-0 flex-1"
                        >
                            <ResizablePanel
                                id="evidence"
                                minSize={isMobile ? '26rem' : '52%'}
                            >
                                <ScrollArea className="h-full">
                                    <section
                                        className="min-w-0 px-5 py-8 sm:px-8"
                                        aria-labelledby="variant-a-title"
                                    >
                                        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
                                            <div>
                                                <p className="text-xs font-medium tracking-[0.12em] text-muted-foreground uppercase">
                                                    Primary artifact
                                                </p>
                                                <h2
                                                    id="variant-a-title"
                                                    className="mt-2 text-2xl font-medium"
                                                >
                                                    Evidence matrix
                                                </h2>
                                            </div>
                                            <Badge variant="outline">
                                                3 claims shown · 18 total
                                            </Badge>
                                        </div>
                                        <EvidenceKey />
                                        <div className="mt-6 flex flex-col gap-4">
                                            {prototypeClaims.map((claim) => (
                                                <ClaimSurface
                                                    key={claim.id}
                                                    claim={claim}
                                                />
                                            ))}
                                        </div>
                                    </section>
                                </ScrollArea>
                            </ResizablePanel>

                            <ResizableHandle withHandle />

                            <ResizablePanel
                                id="context"
                                minSize={isMobile ? '18rem' : '16rem'}
                                maxSize={isMobile ? '50%' : '42%'}
                            >
                                <ScrollArea className="h-full">
                                    <aside className="bg-muted/30 px-5 py-8">
                                        <h2 className="text-sm font-medium">
                                            Dimension context
                                        </h2>
                                        <div className="mt-5 flex flex-col gap-5">
                                            {prototypeDimensions.map(
                                                (dimension) => (
                                                    <div
                                                        key={dimension.name}
                                                        className="flex flex-col gap-2"
                                                    >
                                                        <p className="text-sm font-medium">
                                                            {dimension.name}
                                                        </p>
                                                        <div className="flex flex-wrap gap-1">
                                                            <Badge variant="secondary">
                                                                {
                                                                    dimension.position
                                                                }
                                                            </Badge>
                                                            <Badge variant="outline">
                                                                {
                                                                    dimension.confidence
                                                                }
                                                            </Badge>
                                                        </div>
                                                        <p className="text-xs text-muted-foreground">
                                                            Three-year direction
                                                            ·{' '}
                                                            {
                                                                dimension.direction
                                                            }
                                                        </p>
                                                    </div>
                                                ),
                                            )}
                                        </div>
                                    </aside>
                                </ScrollArea>
                            </ResizablePanel>
                        </ResizablePanelGroup>
                    </main>
                </div>
            </div>
        </WorkbenchShell>
    );
}
