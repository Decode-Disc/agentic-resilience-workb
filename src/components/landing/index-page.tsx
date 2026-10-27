import {
  ArrowRight01Icon,
  Audit01Icon,
  BookSearchIcon,
  ChartRelationshipIcon,
  CheckmarkCircle02Icon,
  FileSearchIcon,
  Menu01Icon,
  Sparkles,
  UserCheck01Icon,
} from "@hugeicons/core-free-icons";
import { Link } from "@tanstack/react-router";
import { motion } from "motion/react";
import type React from "react";
import { useEffect, useRef } from "react";

import Icon from "@/components/icon";
import { AppLogo } from "@/components/logo-icon";
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuList,
  NavigationMenuTrigger,
} from "@/components/navigation-menu";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { GridCard } from "@/components/ui/grid-card";
import { LiquidGlassCard } from "@/components/ui/liquid-glass";
import { LiquidMetalBorderButton } from "@/components/ui/liquid-metal-border-button";
import MotionAnimatePresence from "@/components/ui/motion-animate-presence";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { PRODUCT_NAME, PRODUCT_SHORT_NAME } from "@/config/product";
import { cn } from "@/lib/utils";

const easeOrganic = [0.32, 0.72, 0, 1] as const;

const navigationItems = [
  {
    id: "value",
    label: "Value at stake",
    title: "See what could hold. And what could erode.",
    description:
      "Look beyond AI announcements to examine who owns the context, directs the work, and captures the value.",
    details: ["Workflow control and context ownership", "Dependencies and exposure to bypass"],
  },
  {
    id: "thesis",
    label: "Test the thesis",
    title: "Put the company's story to the test.",
    description:
      "Bring filings, product documentation, and independent analysis into one research dossier. Examine the support, contradictions, and unanswered questions.",
    details: ["Traceable sources and passages", "Counter-evidence and critical unknowns"],
  },
  {
    id: "judgment",
    label: "Your judgment",
    title: "Keep every conclusion open to challenge.",
    description:
      "Inspect the sources, question interpretations, and record your reasoning. The workbench prepares the evidence. You make the assessment.",
    details: ["Explicit uncertainty", "Recorded decisions and overrides"],
  },
] as const;

const matrixClaims = [
  {
    claim: "CCC reports insurer-configurable workflows connecting insurers and repair facilities.",
    classification: "Fact",
    badgeClassName: "bg-evidence-fact/10 text-evidence-fact",
    source: "Company-reported · Annual Report, p. 8",
  },
  {
    claim: "Workflow execution alone does not establish CCC's authority over insurer decisions.",
    classification: "Inference",
    badgeClassName: "bg-evidence-inference/10 text-evidence-inference",
    source: "Objection · insurer-configurable rules, p. 8",
  },
  {
    claim: "An external agent could coordinate the claim while using CCC for specific tasks.",
    classification: "Hypothesis",
    badgeClassName: "bg-evidence-hypothesis/10 text-evidence-hypothesis",
    source: "Research hypothesis · requires testing",
  },
  {
    claim: "Could an insurer replace CCC without losing workflow context and integrations?",
    classification: "Unknown",
    badgeClassName: "bg-evidence-unknown/10 text-evidence-unknown",
    source: "Not established by the cited passages",
  },
] as const;

const matrixSource = {
  label: "CCC 2025 Annual Report, pp. 8–9",
  url: "https://cccis.gcs-web.com/static-files/915c24e8-371f-4d42-b0bf-d52881a52bd8",
} as const;

const capabilities = [
  {
    title: "See the business in context",
    description: "Situate the company and focus on a workflow that matters to its economics.",
    icon: BookSearchIcon,
  },
  {
    title: "Find the control points",
    description:
      "Identify who owns the context, directs execution, and holds the right to act.",
    icon: ChartRelationshipIcon,
  },
  {
    title: "Examine what agents could change",
    description:
      "Explore what could be strengthened, bypassed, or made replaceable.",
    icon: Audit01Icon,
  },
  {
    title: "Confront competing interpretations",
    description:
      "Weigh each interpretation against supporting evidence, objections, and dependencies.",
    icon: FileSearchIcon,
  },
  {
    title: "Surface the decisive unknowns",
    description:
      "Identify what remains unestablished and what could change the assessment.",
    icon: UserCheck01Icon,
  },
  {
    title: "Connect evidence to economic consequences",
    description:
      "Follow the reasoning from sourced observations to mechanisms and their implications.",
    icon: CheckmarkCircle02Icon,
  },
] as const;

function WorkbenchLink({ mobile = false }: { mobile?: boolean }) {
  return (
    <Link to="/workspace/start" className={cn(buttonVariants({ size: "lg" }), mobile && "w-full")}>
      Open workbench
    </Link>
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
    <section
      aria-labelledby={`landing-${item.id}-title`}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: Text-only menu panels need a focus target for keyboard opening and Escape return.
      tabIndex={0}
      className="grid gap-3 rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/30 sm:grid-cols-[1.45fr_1fr]"
    >
      <GridCard tone={index % 2 === 0 ? "primary" : "accent"}>
        <p className="text-micro">{item.label}</p>
        <h2 id={`landing-${item.id}-title`} className="mt-3 text-lg font-medium tracking-tight">
          {item.title}
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.description}</p>
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
    </section>
  );
}

function LandingHeader() {
  return (
    <header className="fixed top-4 left-1/2 z-50 w-[min(calc(100%-1.5rem),64rem)] -translate-x-1/2">
      <div className="flex h-14 items-center justify-between gap-4 rounded-full border border-border/70 bg-card/30 px-3 shadow-floating backdrop-blur-xl sm:px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <AppLogo />
          <span className="text-sm sm:text-base font-semibold tracking-tight">
            {PRODUCT_SHORT_NAME}
          </span>
        </div>

        <NavigationMenu aria-label="Project context" className="hidden lg:flex" delay={0}>
          <NavigationMenuList>
            {navigationItems.map((item, index) => (
              <NavigationMenuItem key={item.id} value={item.id}>
                <NavigationMenuTrigger className="hover:bg-brand-purple/8 text-base hover:text-brand-purple data-popup-open:bg-brand-purple/10 data-popup-open:text-brand-purple">
                  {item.label}
                </NavigationMenuTrigger>
                <NavigationMenuContent>
                  <NavigationPanel item={item} index={index} />
                </NavigationMenuContent>
              </NavigationMenuItem>
            ))}
          </NavigationMenuList>
        </NavigationMenu>

        <div className="flex items-center gap-2">
          <div className="hidden sm:block">
            <WorkbenchLink />
          </div>
          <Sheet>
            <SheetTrigger render={<Button variant="ghost" size="icon-sm" className="lg:hidden" />}>
              <Icon iconNode={Menu01Icon} className="size-5" />
              <span className="sr-only">Open project menu</span>
            </SheetTrigger>
            <SheetContent className="w-[min(92vw,26rem)] bg-background/96" showCloseButton>
              <SheetHeader className="border-b">
                <SheetTitle>Project context</SheetTitle>
                <SheetDescription>
                  Value at stake, evidence to examine, and decisions that stay yours.
                </SheetDescription>
              </SheetHeader>
              <div className="overflow-y-auto px-4">
                <Accordion className="my-4">
                  {navigationItems.map((item) => (
                    <AccordionItem key={item.id} value={item.id}>
                      <AccordionTrigger>{item.label}</AccordionTrigger>
                      <AccordionContent>
                        <h2 className="font-medium">{item.title}</h2>
                        <p className="mt-2 text-muted-foreground">{item.description}</p>
                        <div className="mt-3 grid gap-2">
                          {item.details.map((detail) => (
                            <p key={detail} className="border-l-2 border-accent-foreground/40 pl-3">
                              {detail}
                            </p>
                          ))}
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              </div>
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
  return (
    <LiquidGlassCard
      className="relative w-full text-left bg-card/80 border border-brand-purple/30 shadow shadow-primary motion-reduce:transform-none!"
      blurIntensity="md"
      glowIntensity="sm"
      shadowIntensity="md"
      borderRadius="var(--radius-2xl)"
    >
      <Noise patternAlpha={15} className="absolute inset-0" />

      <div className="p-5 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-micro text-brand-purple">Examine the evidence</p>
            <h2 className="mt-1.5 text-xl font-medium tracking-tight">Evidence matrix</h2>
          </div>
          <span className="rounded-full border border-border/80 bg-muted/60 px-3 py-1 text-[0.6875rem] font-medium tracking-[0.08em] text-muted-foreground uppercase">
            Illustrative preview
          </span>
        </div>

        <p className="mt-4 text-sm font-medium leading-6">CCC · Photo-led auto claims</p>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          Does CCC control coordination, or provide replaceable modules?
        </p>

        <ul className="mt-5 list-none divide-y divide-border/60 border-y border-border/60">
          {matrixClaims.map((row, index) => (
            <motion.li
              key={row.classification}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: 0.5,
                delay: 0.25 + index * 0.09,
                ease: easeOrganic,
              }}
              className="grid gap-x-4 gap-y-1 py-3.5 motion-reduce:!transform-none motion-reduce:!opacity-100 sm:grid-cols-[1fr_auto] sm:items-center"
            >
              <div className="min-w-0">
                <p className="text-sm leading-6">{row.claim}</p>
                <p className="mt-0.5 font-mono text-[0.6875rem] tracking-wide text-muted-foreground">
                  {row.source}
                </p>
              </div>
              <span
                className={cn(
                  "w-fit rounded-full px-2.5 py-0.5 text-xs font-medium",
                  row.badgeClassName,
                )}
              >
                {row.classification}
              </span>
            </motion.li>
          ))}
        </ul>

        <p className="mt-4 text-xs leading-5 text-muted-foreground">
          Illustrative analysis based on{" "}
          <a
            href={matrixSource.url}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {matrixSource.label}
          </a>
          . Reasoning is illustrative; unanswered questions concern the cited passages.
        </p>
      </div>
    </LiquidGlassCard>
  );
}

function CapabilityGrid() {
  return (
    <motion.ul
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.55,
        delay: 0.5,
        ease: easeOrganic,
      }}
      className="grid w-full list-none gap-px overflow-hidden rounded-2xl border border-border/70 bg-border/70 shadow-soft motion-reduce:!transform-none motion-reduce:!opacity-100 sm:grid-cols-2 xl:grid-cols-3"
      aria-label="Research capabilities"
    >
      {capabilities.map((capability) => (
        <GridCard key={capability.title} tone="primary">
          <li className="bg-card/10 p-5 backdrop-blur-md">
            <Icon
              iconNode={capability.icon}
              className="size-[1.125rem] text-muted-foreground"
              strokeWidth={1.8}
            />
            <h3 className="mt-3 text-sm font-medium tracking-tight sm:min-h-10">{capability.title}</h3>
            <p className="mt-1 text-sm leading-5 text-muted-foreground">{capability.description}</p>
          </li>
        </GridCard>
      ))}
    </motion.ul>
  );
}

/** Inline Noise overlay */
const Noise: React.FC<{
  patternRefreshInterval?: number;
  patternAlpha?: number;
  className?: string;
}> = ({ patternRefreshInterval = 2, patternAlpha = 16, className }) => {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;
    let frame = 0;
    let id = 0;
    const size = 1024;
    const resize = () => {
      canvas.width = size;
      canvas.height = size;
      canvas.style.width = "100vw";
      canvas.style.height = "100vh";
    };
    const draw = () => {
      const img = ctx.createImageData(size, size);
      const data = img.data;
      for (let i = 0; i < data.length; i += 4) {
        const v = Math.random() * 255;
        data[i] = v;
        data[i + 1] = v;
        data[i + 2] = v;
        data[i + 3] = patternAlpha;
      }
      ctx.putImageData(img, 0, 0);
    };
    const loop = () => {
      if (frame % patternRefreshInterval === 0) draw();
      frame++;
      id = requestAnimationFrame(loop);
    };
    addEventListener("resize", resize);
    resize();
    loop();
    return () => {
      removeEventListener("resize", resize);
      cancelAnimationFrame(id);
    };
  }, [patternRefreshInterval, patternAlpha]);
  return (
    <canvas
      ref={ref}
      className={cn("pointer-events-none", className)}
      style={{ imageRendering: "pixelated" }}
    />
  );
};

/**
 * Standalone project home page. It introduces the evidence-first thesis without
 * mounting the authenticated workbench shell.
 */
export function IndexPage() {
  return (
    <div className="relative isolate min-h-screen overflow-x-clip bg-(image:--landing-gradient)">
      {/* Purple spotlight */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_620px_at_50%_200px,rgba(103,37,235,0.35),transparent_70%)]" />
      {/* Soft grid with top fade */}
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,#94a3b81f_1px,transparent_1px),linear-gradient(to_bottom,#94a3b81f_1px,transparent_1px)] bg-[size:22px_22px] [mask-image:radial-gradient(ellipse_85%_55%_at_50%_15%,#000_75%,transparent_100%)] [-webkit-mask-image:radial-gradient(ellipse_85%_55%_at_50%_15%,#000_75%,transparent_100%)] [mask-repeat:no-repeat] [-webkit-mask-repeat:no-repeat]" />

      <LandingHeader />

      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 hidden h-[68rem] lg:block"
      >
        <div className="absolute top-[26rem] left-1/2 size-[44rem] -translate-x-1/2 rounded-full border border-dashed border-brand-purple/30" />
        <div className="absolute top-[20rem] left-1/2 size-[62rem] -translate-x-1/2 rounded-full border border-brand-purple/15" />
        <div className="absolute top-[13rem] left-1/2 size-[84rem] -translate-x-1/2 rounded-full border border-dashed border-brand-purple/40" />
      </div>

      <main className="relative z-10 mx-auto flex w-full min-h-0 max-w-4xl flex-col items-center px-4 pb-10 pt-20 md:pt-30">
        <motion.section
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            duration: 0.55,
            ease: easeOrganic,
          }}
          className="flex max-w-[40rem] xl:max-w-[50rem] flex-col gap-4 items-center text-center motion-reduce:transform-none! motion-reduce:opacity-100!"
          aria-labelledby="index-title"
        >
          <Badge
            variant="fancy"
            color="indigo"
            className="rounded-none p-2 font-mono font-medium tracking-[0.12em] uppercase"
          >
            <Icon iconNode={Sparkles} className="size-8" />
            {PRODUCT_NAME}
          </Badge>
          <h1
            id="index-title"
            className="text-5xl leading-[0.96] font-medium tracking-[-0.045em] text-balance sm:text-6xl lg:text-[4.4rem]"
          >
            Which advantages survive the agentic shift?
          </h1>
          <p className="max-w-lg text-lg leading-7 text-foreground/90">
            Investigate who controls the workflow, what agents can bypass, and where a company's
            advantage may hold.
          </p>
          <div className="flex justify-center">
            <LiquidMetalBorderButton
              label="Explore the workbench"
              className="py-5 px-6"
              render={<Link to="/workspace/start" />}
            >
              <span className="text-lg">Explore the workbench</span>
              <Icon iconNode={ArrowRight01Icon} className="size-5" />
            </LiquidMetalBorderButton>
          </div>
          <p className="text-micro text-[10px]">
            Independent research prototype · US-listed technology companies
          </p>
        </motion.section>

        <motion.section
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            duration: 0.6,
            delay: 0.15,
            ease: easeOrganic,
          }}
          className="mt-5 w-full motion-reduce:!transform-none motion-reduce:!opacity-100"
          aria-label="Evidence matrix preview"
        >
          <MotionAnimatePresence
            preset="zoom"
            delay={0.2}
            className="motion-reduce:!transform-none motion-reduce:!opacity-100"
          >
            <MatrixPreview />
          </MotionAnimatePresence>
        </motion.section>

        <section
          id="capabilities"
          className="mt-10 w-full scroll-mt-24"
          aria-label="How it holds up"
        >
          <MotionAnimatePresence
            infinite
            preset="slide-up"
            className="motion-reduce:!transform-none motion-reduce:!opacity-100"
          >
            <CapabilityGrid />
          </MotionAnimatePresence>
        </section>

        <footer className="mt-14 w-full border-t border-border pt-6 pb-2 text-center">
          <p className="text-xs leading-5 text-muted-foreground">
            No aggregate resilience score. No investment recommendation. Analyst judgment remains
            final.
          </p>
        </footer>
      </main>
    </div>
  );
}
