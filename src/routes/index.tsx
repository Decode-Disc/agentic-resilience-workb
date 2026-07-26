import {
    ArrowRight01Icon,
    Audit01Icon,
    BookSearchIcon,
    ChartRelationshipIcon,
    CheckmarkCircle02Icon,
    FileSearchIcon,
    Menu01Icon,
    UserCheck01Icon,
} from '@hugeicons/core-free-icons';
import { createFileRoute, Link } from '@tanstack/react-router';
import { motion, useReducedMotion } from 'motion/react';

import Icon from '@/components/icon';
import { AppLogo } from '@/components/logo-icon';
import {
    NavigationMenu,
    NavigationMenuContent,
    NavigationMenuItem,
    NavigationMenuLink,
    NavigationMenuList,
    NavigationMenuTrigger,
} from '@/components/navigation-menu';
import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from '@/components/ui/accordion';
import { BackgroundImageTexture } from '@/components/ui/bg-image-texture';
import { Button } from '@/components/ui/button';
import { GridCard } from '@/components/ui/grid-card';
import { LiquidGlassCard } from '@/components/ui/liquid-glass';
import {
    Sheet,
    SheetClose,
    SheetContent,
    SheetDescription,
    SheetFooter,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

const easeOrganic = [0.32, 0.72, 0, 1] as const;

const navigationItems = [
    {
        id: 'project',
        label: 'Project',
        title: 'What this is',
        description:
            'A private, evidence-first research prototype that brings the architectural resilience question to life, asking whether a company keeps its role as agents become economic actors.',
        details: [
            'The evidence matrix is the primary artifact. Architecture maps and briefs are derived, inspectable views.',
            'Every claim points back to a locatable source, so the reasoning can be checked, not just trusted.',
        ],
    },
    {
        id: 'purpose',
        label: 'Purpose',
        title: 'Why it exists',
        description:
            'Judging whether a company\u2019s position survives a discontinuity takes time, and the reasoning is hard to share. This workbench makes that judgment faster to reach and easier to defend.',
        details: [
            'Uncertainty and counter-evidence stay visible; the workbench shows what isn\u2019t known yet, not just what is.',
            'The analyst stays the final authority; the system assembles evidence, it doesn\u2019t reach verdicts.',
        ],
    },
    {
        id: 'workflow',
        label: 'Workflow',
        title: 'How it works',
        description:
            'Public sources are gathered, the analyst approves what counts as evidence, then each claim is extracted, challenged, and reviewed. Conclusions arrive only after the evidence does.',
        details: [
            'The analyst approves the source corpus before any claim is drawn from it.',
            'Only claims that survive review can support an assessment, map, or brief.',
        ],
    },
    {
        id: 'principles',
        label: 'Principles',
        title: 'What remains non-negotiable',
        description:
            'The system speeds up research; it does not replace judgment or paper over thin evidence with confidence.',
        details: [
            'No aggregate resilience score. No investment recommendation.',
            'Analyst decisions are recorded and never overwritten; every override leaves a trace.',
        ],
    },
] as const;

const matrixClaims = [
    {
        claim: 'Operates proprietary inference infrastructure in owned datacenters.',
        classification: 'Fact',
        badgeClassName: 'bg-evidence-fact/10 text-evidence-fact',
        source: '10-K · Item 2 · p. 41',
    },
    {
        claim: 'Workflow integrations raise switching costs year over year.',
        classification: 'Inference',
        badgeClassName: 'bg-evidence-inference/10 text-evidence-inference',
        source: 'Earnings call · Q1 FY26',
    },
    {
        claim: 'Agent-mediated traffic could bypass the first-party interface.',
        classification: 'Hypothesis',
        badgeClassName: 'bg-evidence-hypothesis/10 text-evidence-hypothesis',
        source: 'API terms · §3.2',
    },
    {
        claim: 'Renewal terms of the largest enterprise contract.',
        classification: 'Unknown',
        badgeClassName: 'bg-evidence-unknown/10 text-evidence-unknown',
        source: 'No public source',
    },
] as const;

const capabilities = [
    {
        title: 'Source approval',
        description:
            'You approve the corpus before extraction begins. No approved source, no claim.',
        icon: CheckmarkCircle02Icon,
    },
    {
        title: 'Atomic claims',
        description:
            'Every claim is single-purpose and classified as Fact, Inference, Hypothesis, or Unknown. Conflated assertions get split apart.',
        icon: FileSearchIcon,
    },
    {
        title: 'Counter-evidence',
        description:
            'Contradictions surface beside the claims they challenge. You see the case against before you decide.',
        icon: BookSearchIcon,
    },
    {
        title: 'Dimension review',
        description:
            'Each dimension carries its own position, confidence, and three-year direction. No forced single verdict.',
        icon: UserCheck01Icon,
    },
    {
        title: 'Audit trail',
        description:
            'Every approval, override, and rejection is append-only. Retrace any conclusion to the decision that produced it.',
        icon: Audit01Icon,
    },
    {
        title: 'Derived views',
        description:
            'Architecture maps and briefs draw only from claims you approved. Derived never precedes verified.',
        icon: ChartRelationshipIcon,
    },
] as const;

function WorkbenchLink({ mobile = false }: { mobile?: boolean }) {
    return (
        <Button
            size={mobile ? 'default' : 'sm'}
            render={<Link to="/workspace/start" />}
            className={mobile ? 'w-full' : undefined}
        >
            Open workbench
        </Button>
    );
}

function NavigationPanel({
    item,
    index,
}: {
    item: (typeof navigationItems)[number];
    index: number;
}) {
    return (
        <div className="grid gap-3 sm:grid-cols-[1.45fr_1fr]">
            <GridCard tone={index % 2 === 0 ? 'primary' : 'accent'}>
                <p className="text-micro">{item.label}</p>
                <h2 className="mt-3 text-lg font-medium tracking-tight">
                    {item.title}
                </h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    {item.description}
                </p>
            </GridCard>
            <div className="grid gap-2">
                {item.details.map((detail) => (
                    <p
                        key={detail}
                        className="rounded-lg border border-border bg-muted/40 p-3 text-sm leading-5"
                    >
                        {detail}
                    </p>
                ))}
            </div>
        </div>
    );
}

function LandingHeader() {
    return (
        <header className="fixed top-4 left-1/2 z-50 w-[min(calc(100%-1.5rem),64rem)] -translate-x-1/2">
            <div className="flex h-14 items-center justify-between gap-4 rounded-full border border-border/70 bg-card/72 px-3 shadow-floating backdrop-blur-xl sm:px-4">
                <div className="flex min-w-0 items-center gap-2.5">
                    <AppLogo />
                    <span className="hidden text-base font-semibold tracking-tight sm:block">
                        Agentic Resilience
                    </span>
                </div>

                <NavigationMenu
                    aria-label="Project context"
                    className="hidden lg:flex"
                    delay={0}
                >
                    <NavigationMenuList>
                        {navigationItems.map((item, index) => (
                            <NavigationMenuItem key={item.id} value={item.id}>
                                <NavigationMenuTrigger className="hover:bg-brand-purple/8 hover:text-brand-purple data-popup-open:bg-brand-purple/10 data-popup-open:text-brand-purple">
                                    {item.label}
                                </NavigationMenuTrigger>
                                <NavigationMenuContent>
                                    <NavigationPanel
                                        item={item}
                                        index={index}
                                    />
                                </NavigationMenuContent>
                            </NavigationMenuItem>
                        ))}
                        <NavigationMenuItem>
                            <NavigationMenuLink
                                href="#capabilities"
                                className="flex h-9 items-center rounded-full px-3 text-sm font-medium text-foreground/80 transition-colors hover:bg-brand-purple/8 hover:text-brand-purple"
                            >
                                Capabilities
                            </NavigationMenuLink>
                        </NavigationMenuItem>
                    </NavigationMenuList>
                </NavigationMenu>

                <div className="flex items-center gap-2">
                    <div className="hidden sm:block">
                        <WorkbenchLink />
                    </div>
                    <Sheet>
                        <SheetTrigger
                            render={
                                <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    className="lg:hidden"
                                />
                            }
                        >
                            <Icon iconNode={Menu01Icon} className="size-5" />
                            <span className="sr-only">Open project menu</span>
                        </SheetTrigger>
                        <SheetContent
                            className="w-[min(92vw,26rem)] bg-background/96"
                            showCloseButton
                        >
                            <SheetHeader className="border-b">
                                <SheetTitle>Project context</SheetTitle>
                                <SheetDescription>
                                    The workbench, its purpose, and its
                                    guardrails.
                                </SheetDescription>
                            </SheetHeader>
                            <div className="overflow-y-auto px-4">
                                <Accordion className="my-4">
                                    {navigationItems.map((item) => (
                                        <AccordionItem
                                            key={item.id}
                                            value={item.id}
                                        >
                                            <AccordionTrigger>
                                                {item.label}
                                            </AccordionTrigger>
                                            <AccordionContent>
                                                <h2 className="font-medium">
                                                    {item.title}
                                                </h2>
                                                <p className="mt-2 text-muted-foreground">
                                                    {item.description}
                                                </p>
                                                <div className="mt-3 grid gap-2">
                                                    {item.details.map(
                                                        (detail) => (
                                                            <p
                                                                key={detail}
                                                                className="border-l-2 border-accent-foreground/40 pl-3"
                                                            >
                                                                {detail}
                                                            </p>
                                                        ),
                                                    )}
                                                </div>
                                            </AccordionContent>
                                        </AccordionItem>
                                    ))}
                                </Accordion>
                            </div>
                            <SheetClose
                                render={
                                    <a
                                        href="#capabilities"
                                        className="mx-4 mb-2 flex items-center justify-between rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm font-medium transition-colors hover:bg-brand-purple/8 hover:text-brand-purple"
                                    />
                                }
                            >
                                Capabilities
                                <Icon
                                    iconNode={ArrowRight01Icon}
                                    className="size-4"
                                />
                            </SheetClose>
                            <SheetFooter>
                                <WorkbenchLink mobile />
                            </SheetFooter>
                        </SheetContent>
                    </Sheet>
                </div>
            </div>
        </header>
    );
}

function MatrixPreview() {
    const reduceMotion = useReducedMotion();

    return (
        <LiquidGlassCard
            className="w-full text-left bg-secondary/20 border border-brand-purple/20"
            blurIntensity="xl"
            glowIntensity="sm"
            shadowIntensity="md"
            borderRadius="var(--radius-2xl)"
        >
            <div className="flex justify-center py-2">
                <Button render={<Link to="/workspace/start" />} size="lg">
                    Start the research
                    <Icon iconNode={ArrowRight01Icon} className="size-4" />
                </Button>
            </div>
            <div className="p-5 sm:p-7">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <p className="text-micro text-brand-purple">
                            Primary artifact
                        </p>
                        <h2 className="mt-1.5 text-xl font-medium tracking-tight">
                            Evidence matrix
                        </h2>
                    </div>
                    <span className="rounded-full border border-border/80 bg-muted/60 px-3 py-1 text-[0.6875rem] font-medium tracking-[0.08em] text-muted-foreground uppercase">
                        Illustrative preview
                    </span>
                </div>

                <ul className="mt-5 list-none divide-y divide-border/60 border-y border-border/60">
                    {matrixClaims.map((row, index) => (
                        <motion.li
                            key={row.classification}
                            initial={
                                reduceMotion ? false : { opacity: 0, y: 10 }
                            }
                            animate={{ opacity: 1, y: 0 }}
                            transition={{
                                duration: reduceMotion ? 0 : 0.5,
                                delay: reduceMotion ? 0 : 0.25 + index * 0.09,
                                ease: easeOrganic,
                            }}
                            className="grid gap-x-4 gap-y-1 py-3.5 sm:grid-cols-[1fr_auto] sm:items-center"
                        >
                            <div className="min-w-0">
                                <p className="text-sm leading-6">{row.claim}</p>
                                <p className="mt-0.5 font-mono text-[0.6875rem] tracking-wide text-muted-foreground">
                                    {row.source}
                                </p>
                            </div>
                            <span
                                className={cn(
                                    'w-fit rounded-full px-2.5 py-0.5 text-xs font-medium',
                                    row.badgeClassName,
                                )}
                            >
                                {row.classification}
                            </span>
                        </motion.li>
                    ))}
                </ul>

                <p className="mt-4 text-xs leading-5 text-muted-foreground">
                    Static illustration. In the workbench, every claim is
                    extracted from analyst-approved sources and remains tied to
                    a locatable passage.
                </p>
            </div>
        </LiquidGlassCard>
    );
}

function CapabilityGrid() {
    const reduceMotion = useReducedMotion();

    return (
        <motion.ul
            initial={reduceMotion ? false : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
                duration: reduceMotion ? 0 : 0.55,
                delay: reduceMotion ? 0 : 0.5,
                ease: easeOrganic,
            }}
            className="grid w-full list-none gap-px overflow-hidden rounded-2xl border border-border/70 bg-border/70 shadow-soft sm:grid-cols-2 xl:grid-cols-3"
            aria-label="Evidence matrix capabilities"
        >
            {capabilities.map((capability) => (
                <li
                    key={capability.title}
                    className="bg-card/78 p-5 backdrop-blur-md"
                >
                    <Icon
                        iconNode={capability.icon}
                        className="size-[1.125rem] text-muted-foreground"
                        strokeWidth={1.8}
                    />
                    <h3 className="mt-3 text-sm font-medium tracking-tight">
                        {capability.title}
                    </h3>
                    <p className="mt-1 text-sm leading-5 text-muted-foreground">
                        {capability.description}
                    </p>
                </li>
            ))}
        </motion.ul>
    );
}

/**
 * Standalone project home page. It introduces the evidence-first thesis without
 * mounting the authenticated workbench shell.
 */
function IndexPage() {
    const reduceMotion = useReducedMotion();

    return (
        <div className="relative isolate min-h-screen overflow-x-clip bg-(image:--landing-gradient)">
            <LandingHeader />

            <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 top-0 hidden h-[68rem] lg:block"
            >
                <div className="absolute top-[26rem] left-1/2 size-[44rem] -translate-x-1/2 rounded-full border border-dashed border-brand-purple/15" />
                <div className="absolute top-[20rem] left-1/2 size-[62rem] -translate-x-1/2 rounded-full border border-border/70" />
                <div className="absolute top-[13rem] left-1/2 size-[84rem] -translate-x-1/2 rounded-full border border-dashed border-border/60" />
            </div>


            <BackgroundImageTexture
                opacity={0.7}
                variant="groovepaper"
                className="absolute inset-0"
            />

            <main className="relative z-10 mx-auto flex w-full min-h-0 max-w-3xl flex-col items-center px-4 pb-10 pt-20">
                <motion.section
                    initial={reduceMotion ? false : { opacity: 0, y: 14 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{
                        duration: reduceMotion ? 0 : 0.55,
                        ease: easeOrganic,
                    }}
                    className="flex max-w-[36rem] flex-col gap-4 items-center text-center"
                    aria-labelledby="index-title"
                >
                    <p className="text-micro text-brand-purple">
                        Agentic Resilience Evidence Workbench
                    </p>
                    <h1
                        id="index-title"
                        className="text-5xl leading-[0.96] font-medium tracking-[-0.045em] text-balance sm:text-6xl lg:text-[4.4rem]"
                    >
                        Evidence before conclusions.
                    </h1>
                    <p className="max-w-lg text-base leading-7 text-muted-foreground">
                        An inspectable research dossier for assessing
                        architectural resilience in the agentic economy.
                    </p>
                    <p className="text-xs text-muted-foreground">
                        Private research prototype · invitation only
                    </p>
                </motion.section>

                <motion.section
                    initial={reduceMotion ? false : { opacity: 0, y: 18 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{
                        duration: reduceMotion ? 0 : 0.6,
                        delay: reduceMotion ? 0 : 0.15,
                        ease: easeOrganic,
                    }}
                    className="mt-5 w-full"
                    aria-label="Evidence matrix preview"
                >
                    <MatrixPreview />
                </motion.section>

                <section
                    id="capabilities"
                    className="mt-10 w-full scroll-mt-24"
                    aria-label="How it holds up"
                >
                    <CapabilityGrid />
                </section>

                <footer className="mt-14 w-full border-t border-border/60 pt-6 pb-2 text-center">
                    <p className="text-xs leading-5 text-muted-foreground">
                        No aggregate resilience score. No investment
                        recommendation. Analyst judgment remains final.
                    </p>
                </footer>
            </main>
        </div>
    );
}

export const Route = createFileRoute('/')({
    component: IndexPage,
});
