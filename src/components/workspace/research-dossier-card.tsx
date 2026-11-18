"use client";

import type { api } from "@convex/_generated/api";
import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { Link } from "@tanstack/react-router";
import type { FunctionReturnType } from "convex/server";
import { motion } from "motion/react";
import { type FocusEvent, useId, useState } from "react";
import { CompanyFaviconAvatar } from "@/components/company-favicon-avatar";
import { DossierStatusBadge } from "@/components/dossier-status-badge";
import Icon from "@/components/icon";
import { Button } from "@/components/ui/button";
import {
    CutoutCard,
    CutoutCardAction,
    CutoutCardContent,
    CutoutCardFooter,
    CutoutCardImage,
    CutoutCardInsetLabel,
    CutoutCardMedia,
    CutoutCardOverlay,
    CutoutCardPin,
    CutoutCorner,
    cutoutCardSurfaceClassName,
    useCutoutContentStaggerVariants,
} from "@/components/ui/cutout-card";
import { useCompanyCoverImage } from "@/hooks/use-company-cover-image";
import { lifecycleLabel } from "@/lib/presentation/research-copy";

type ResearchDossier = FunctionReturnType<
    typeof api.researchRuns.listMine
>["page"][number];

const updatedAtFormatter = new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
});

function leavesCard(event: FocusEvent<HTMLDivElement>): boolean {
    return !event.currentTarget.contains(event.relatedTarget);
}

/**
 * Presents one persisted dossier using the complete cutout-card composition.
 */
export function ResearchDossierCard({ dossier }: { dossier: ResearchDossier }) {
    const stagger = useCutoutContentStaggerVariants();
    const [pointerHovered, setPointerHovered] = useState(false);
    const [focusWithin, setFocusWithin] = useState(false);
    const companyName = dossier.company?.legalName ?? "Research dossier";
    const statusId = useId();
    const marketIdentity = dossier.company
        ? `${dossier.company.ticker} · ${dossier.company.exchange}`
        : "Company confirmation pending";
    const description =
        dossier.researchAngle ?? `Research prepared for ${companyName}`;
    const route = {
        to: "/workspace/$runId" as const,
        params: { runId: dossier.runId },
        search: { section: "progress" as const },
    };
    const coverImage = useCompanyCoverImage(
        dossier.company?.websiteUrl,
        dossier.company?.investorRelationsUrl,
    );

    return (
        <CutoutCard
            className={`${cutoutCardSurfaceClassName} h-full`}
            hovered={pointerHovered || focusWithin}
            onHoveredChange={setPointerHovered}
            onFocusCapture={() => setFocusWithin(true)}
            onBlurCapture={(event) => {
                if (leavesCard(event)) {
                    setFocusWithin(false);
                }
            }}>
            <Link
                {...route}
                aria-label={`Open ${companyName} dossier`}
                aria-describedby={statusId}
                className="block outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
                <CutoutCardMedia className="h-72">
                    <CutoutCardImage
                        alt={`${companyName} research dossier cover`}
                        sizes="(max-width: 768px) 100vw, 448px"
                        src={coverImage.src}
                        onError={coverImage.onError}
                    />
                    <CutoutCardOverlay />
                    <CutoutCardInsetLabel className="bottom-0 left-0 rounded-tr-[20px] bg-card px-5 py-3">
                        <span className="font-semibold text-[11px] text-muted-foreground uppercase tracking-widest">
                            {dossier.lifecycleState === "sources_prepared"
                                ? "Investigation is not available yet"
                                : lifecycleLabel(dossier.lifecycleState)}
                        </span>
                        <CutoutCorner className="absolute -right-[31px] -bottom-px rotate-90 text-card" />
                        <CutoutCorner className="absolute -top-[31px] -left-px rotate-90 text-card" />
                    </CutoutCardInsetLabel>

                    <CutoutCardPin
                        id={statusId}
                        className="top-0 right-0 max-w-[calc(100%-24px)] rounded-bl-[16px] bg-card px-3 py-2 shadow-md shadow-foreground/10">
                        <DossierStatusBadge
                            run={dossier}
                            className="max-w-full whitespace-normal text-left"
                        />
                        <CutoutCorner
                            className="absolute top-0 -left-[23px] -rotate-90 text-card"
                            size={24}
                        />
                        <CutoutCorner
                            className="absolute right-0 -bottom-[23px] -rotate-90 text-card"
                            size={24}
                        />
                    </CutoutCardPin>
                </CutoutCardMedia>

                <CutoutCardContent className="min-h-0 h-full">
                    <motion.div
                        animate="show"
                        className="contents"
                        initial="hidden"
                        variants={stagger.container}>
                        <motion.h2
                            className="mb-2 text-balance font-semibold text-card-foreground text-xl leading-snug"
                            variants={stagger.item}>
                            {companyName}
                        </motion.h2>
                        <motion.p
                            className="mb-4 line-clamp-3 text-muted-foreground text-sm leading-relaxed max-w-[calc(100%-2rem)] truncate"
                            variants={stagger.item}>
                            {description}
                        </motion.p>
                        <motion.div variants={stagger.item}>
                            <CutoutCardFooter className="border-border/80 border-t pt-4">
                                <div className="flex items-center gap-3">
                                    {dossier.company ? (
                                        <CompanyFaviconAvatar
                                            size="default"
                                            company={dossier.company}
                                        />
                                    ) : (
                                        <div
                                            aria-hidden="true"
                                            className="h-8 w-8 rounded-full bg-linear-to-br from-brand-purple to-brand-green shadow-sm ring-2 ring-card"
                                        />
                                    )}
                                    <span className="font-medium text-card-foreground text-sm">
                                        {marketIdentity}
                                    </span>
                                </div>
                                <span className="text-muted-foreground text-xs tabular-nums">
                                    {updatedAtFormatter.format(
                                        dossier.updatedAt,
                                    )}
                                </span>
                            </CutoutCardFooter>
                        </motion.div>
                    </motion.div>
                </CutoutCardContent>
            </Link>

            <CutoutCardAction className="right-5 bottom-5">
                <Button
                    render={<Link {...route} />}
                    nativeButton={false}
                    size="sm"
                    className="rounded-full shadow-md">
                    Open dossier
                    <Icon iconNode={ArrowRight01Icon} />
                </Button>
            </CutoutCardAction>
        </CutoutCard>
    );
}
