import {
    AlertCircleIcon,
    ArrowDown01Icon,
    CheckmarkCircle02Icon,
} from "@hugeicons/core-free-icons";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useId, useState } from "react";

import Icon from "@/components/icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

import type { PrototypeClaim } from "./prototype-data";

const claimStatusStyles: Record<PrototypeClaim["status"], string> = {
    Approved: "border-approved/25 bg-approved/10 text-approved",
    "Needs review": "border-review/25 bg-review/10 text-review",
    Unresolved:
        "border-evidence-unknown/30 bg-evidence-unknown/10 text-evidence-unknown",
};

export function PrototypeNotice() {
    return (
        <div className="flex flex-wrap items-center justify-between gap-3 bg-foreground px-4 py-2 text-background sm:px-6">
            <p className="text-xs font-medium tracking-[0.12em] uppercase">
                Throwaway UI prototype
            </p>
            <p className="text-xs text-background/70">
                Illustrative dossier data — not a live research result
            </p>
        </div>
    );
}

export function DossierHeading({ compact = false }: { compact?: boolean }) {
    return (
        <div className="flex min-w-0 flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">CCCS · NASDAQ</Badge>
                <Badge variant="secondary">Corpus revision 2</Badge>
                <Badge variant="outline" color="amber" showDot>
                    Claim review
                </Badge>
            </div>
            <div>
                <h1
                    className={
                        compact
                            ? "text-2xl font-medium tracking-[-0.025em]"
                            : "text-3xl font-medium tracking-[-0.03em] sm:text-4xl"
                    }>
                    CCC Intelligent Solutions
                </h1>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                    Evidence-led review of workflow control, context ownership,
                    and exposure to agent-native insurance operations.
                </p>
            </div>
        </div>
    );
}

/** Sticky compact dossier summary that reveals the complete heading in place. */
export function DossierHeadingDisclosure() {
    const [isOpen, setIsOpen] = useState(false);
    const detailsId = useId();
    const reduceMotion = useReducedMotion();

    return (
        <motion.header
            layout={!reduceMotion}
            className="surface-floating sticky top-0 z-20 overflow-hidden rounded-t-none rounded-b-lg border-t-0"
            transition={{
                layout: reduceMotion
                    ? { duration: 0 }
                    : { duration: 0.36, ease: [0.32, 0.72, 0, 1] },
            }}>
            <h1 className="m-0" aria-label="CCC Intelligent Solutions">
                <Button
                    variant="ghost"
                    className="h-auto w-full justify-between rounded-t-none rounded-b-lg px-5 py-3 text-left hover:bg-muted/60 sm:px-8"
                    aria-expanded={isOpen}
                    aria-controls={detailsId}
                    aria-label={
                        isOpen
                            ? "Collapse dossier details"
                            : "Expand dossier details"
                    }
                    onClick={() => setIsOpen((value) => !value)}>
                    <span className="flex min-w-0 items-center gap-3">
                        <span className="text-micro shrink-0 text-brand-purple">
                            CCCS
                        </span>
                        <span className="truncate text-base font-medium tracking-tight text-foreground">
                            CCC Intelligent Solutions
                        </span>
                        <Badge
                            variant="outline"
                            color="amber"
                            showDot
                            className="hidden sm:inline-flex">
                            Claim review
                        </Badge>
                    </span>
                    <Icon
                        iconNode={ArrowDown01Icon}
                        className={cn(
                            "shrink-0 transition-transform duration-300",
                            isOpen && "rotate-180",
                        )}
                    />
                </Button>
            </h1>

            <AnimatePresence initial={false}>
                {isOpen && (
                    <motion.div
                        id={detailsId}
                        role="region"
                        aria-label="Dossier details"
                        initial={reduceMotion ? false : { opacity: 0, y: -8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={
                            reduceMotion
                                ? { opacity: 0 }
                                : { opacity: 0, y: -6 }
                        }
                        transition={
                            reduceMotion
                                ? { duration: 0 }
                                : {
                                      duration: 0.28,
                                      ease: [0.32, 0.72, 0, 1],
                                  }
                        }
                        className="border-t border-border/60 px-5 pt-4 pb-5 sm:px-8">
                        <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="outline">NASDAQ</Badge>
                            <Badge variant="secondary">Corpus revision 2</Badge>
                        </div>
                        <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
                            Evidence-led review of workflow control, context
                            ownership, and exposure to agent-native insurance
                            operations.
                        </p>
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.header>
    );
}

export function ClaimSurface({
    claim,
    selected = false,
    onSelect,
}: {
    claim: PrototypeClaim;
    selected?: boolean;
    onSelect?: () => void;
}) {
    const content = (
        <>
            <CardHeader>
                <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{claim.classification}</Badge>
                    <Badge variant="secondary">{claim.dimension}</Badge>
                </div>
                <CardTitle className="mt-2 leading-6">
                    {claim.statement}
                </CardTitle>
                <CardDescription>
                    {claim.evidence} · {claim.locator}
                </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
                <div
                    data-claim-status={claim.status}
                    className={cn(
                        "flex gap-2 rounded-lg border p-3 text-sm leading-6",
                        claimStatusStyles[claim.status],
                    )}>
                    <Icon
                        iconNode={
                            claim.status === "Approved"
                                ? CheckmarkCircle02Icon
                                : AlertCircleIcon
                        }
                        className="mt-1 shrink-0"
                    />
                    <p>
                        <span className="font-medium">{claim.status}.</span>{" "}
                        <span className="text-foreground/70">
                            {claim.counterEvidence}
                        </span>
                    </p>
                </div>
            </CardContent>
        </>
    );

    if (!onSelect) {
        return (
            <Card
                className={selected ? "ring-2 ring-foreground/20" : undefined}>
                {content}
            </Card>
        );
    }

    return (
        <button type="button" className="w-full text-left" onClick={onSelect}>
            <Card
                className={selected ? "ring-2 ring-foreground/20" : undefined}>
                {content}
            </Card>
        </button>
    );
}

export function EvidenceKey() {
    return (
        <div className="grid gap-3 text-xs text-muted-foreground sm:grid-cols-3">
            <p>
                <span className="font-medium text-foreground">Position</span>{" "}
                describes the evidence-backed conclusion.
            </p>
            <p>
                <span className="font-medium text-foreground">Confidence</span>{" "}
                comes from source quality and coverage.
            </p>
            <p>
                <span className="font-medium text-foreground">Direction</span>{" "}
                is a separate three-year judgment.
            </p>
        </div>
    );
}
