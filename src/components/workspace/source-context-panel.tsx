import type { Id } from "@convex/_generated/dataModel";
import {
    ArrowRight01Icon,
    CheckmarkCircle02Icon,
    InformationCircleIcon,
    LinkSquare01Icon,
} from "@hugeicons/core-free-icons";
import { type ReactNode, useMemo, useState } from "react";

import { FaviconAvatar } from "@/components/favicon-avatar";
import Icon from "@/components/icon";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { CopyLinkButton } from "@/components/ui/copy-link-button";
import {
    DirectionAwareTabs,
    type Tab,
} from "@/components/ui/direction-aware-tabs";
import { ResponsivePopover } from "@/components/ui/responsive-popover";
import { Skeleton } from "@/components/ui/skeleton";
import { ApprovedSourceSearch } from "@/components/workspace/approved-source-search";
import { SourceBrowserView } from "@/components/workspace/source-browser-view";
import { SourceDecisionStatus } from "@/components/workspace/source-decision";
import { SourceDocumentKindBadge } from "@/components/workspace/source-family-badge";
import type { SourceReviewSource } from "@/components/workspace/source-review";
import {
    sourceAssessmentExplanationCopy,
    sourceAuthorityPresentation,
    sourceCoverageRoleLabel,
    sourceFindingContributionCopy,
    sourceFindingKindLabel,
    sourceInclusionLabel,
    sourceReadingConcernCopy,
    sourceReadingCopy,
    sourceUsageCopy,
} from "@/lib/presentation/research-copy";
import { cn } from "@/lib/utils";

const sourceDateFormatter = new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
});

/**
 * Selected source detail panel with preview, provenance header, and source
 * details. When a visual preview is available for a pending candidate source,
 * it is shown inside the Preview tab with a clear reference-only label.
 */
export function SourceContextPanel({
    source,
    runId,
    className,
    isReadingLoading = false,
    approvedCorpusRevisionId,
    included,
    actions,
    annotation,
}: {
    source: SourceReviewSource;
    runId?: Id<"researchRuns">;
    className?: string;
    isReadingLoading?: boolean;
    approvedCorpusRevisionId?: Id<"corpusRevisions">;
    included?: boolean;
    actions?: ReactNode;
    annotation?: ReactNode;
}) {
    const [tab, setTab] = useState<string | number>("details");
    const authority = sourceAuthorityPresentation(source.authorityTier);
    const tabs: Tab[] = useMemo(
        () =>
            [
                {
                    id: "preview",
                    label: "Preview",
                    content: (
                        <div className="h-full min-h-0 w-full overflow-hidden rounded-xl border border-border/60">
                            <SourceBrowserView
                                source={source}
                                runId={runId}
                                onViewDetails={() => setTab("details")}
                            />
                        </div>
                    ),
                },
                {
                    id: "details",
                    label: "Source details",
                    content: (
                        <div className="h-full min-h-0 w-full overflow-auto rounded-xl border border-border/60 p-5">
                            <SourceReadingDetails
                                source={source}
                                isLoading={isReadingLoading}
                            />
                            {runId &&
                            approvedCorpusRevisionId &&
                            source.decision === "accepted" ? (
                                source.qualificationStatus !== undefined ? (
                                    <ApprovedSourceSearch
                                        key={`${approvedCorpusRevisionId}:${source.sourceId}`}
                                        runId={runId}
                                        corpusRevisionId={
                                            approvedCorpusRevisionId
                                        }
                                        sourceId={source.sourceId}
                                    />
                                ) : (
                                    <p className="mt-5 border-t border-border/60 pt-4 text-sm text-muted-foreground">
                                        This source has no saved reading to
                                        search. Review the original source.
                                    </p>
                                )
                            ) : null}
                        </div>
                    ),
                },
            ].filter(
                (item) =>
                    item.id !== "preview" || source.decision === "pending",
            ),
        [source, runId, isReadingLoading, approvedCorpusRevisionId],
    );

    return (
        <article
            className={cn(
                "surface-panel flex h-full min-h-0 flex-col overflow-hidden rounded-(--radius-source-card)",
                className,
            )}>
            <header
                data-slot="source-record-header"
                className="flex flex-wrap items-start justify-between gap-4 border-b border-border/60 p-5">
                <div className="flex min-w-0 grow basis-64 items-start gap-3">
                    <FaviconAvatar
                        canonicalUrl={source.canonicalUrl}
                        entityName={source.title}
                        size="lg"
                    />
                    <div className="min-w-0">
                        <h3 className="break-words text-lg font-medium tracking-tight">
                            {source.title}
                        </h3>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                            <span className={authority.className}>
                                {authority.label}
                            </span>
                            <SourceDocumentKindBadge
                                kind={source.documentKind}
                            />
                            <span className="inline-flex min-w-0 items-center gap-1">
                                <span className="break-all">
                                    {new URL(source.canonicalUrl).hostname}
                                </span>
                                <SourceAddress
                                    key={source.sourceId}
                                    url={source.canonicalUrl}
                                />
                            </span>
                        </div>
                        {source.publishedAt !== undefined ? (
                            <p className="text-xs text-muted-foreground">
                                Published{" "}
                                <time
                                    dateTime={new Date(
                                        source.publishedAt,
                                    ).toISOString()}>
                                    {sourceDateFormatter.format(
                                        source.publishedAt,
                                    )}
                                </time>
                            </p>
                        ) : null}
                        {source.qualification?.reportingPeriodEnd ? (
                            <p className="text-xs text-muted-foreground">
                                Reporting period ending{" "}
                                <time
                                    dateTime={
                                        source.qualification.reportingPeriodEnd
                                    }>
                                    {sourceDateFormatter.format(
                                        new Date(
                                            `${source.qualification.reportingPeriodEnd}T00:00:00.000Z`,
                                        ),
                                    )}
                                </time>
                            </p>
                        ) : null}
                        {included !== undefined ? (
                            <Badge
                                variant="outline"
                                className={
                                    included
                                        ? "border-approved/30 text-approved"
                                        : undefined
                                }>
                                {included ? (
                                    <Icon
                                        iconNode={CheckmarkCircle02Icon}
                                        size={14}
                                    />
                                ) : null}
                                {sourceInclusionLabel(included)}
                            </Badge>
                        ) : (
                            <SourceDecisionStatus decision={source.decision} />
                        )}
                    </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <a
                        href={source.canonicalUrl}
                        target="_blank"
                        rel="noreferrer"
                        className={buttonVariants({
                            variant: "ghost",
                            size: "sm",
                        })}>
                        <Icon iconNode={LinkSquare01Icon} />
                        Open original
                    </a>
                    {actions}
                </div>
                {annotation ? (
                    <Collapsible
                        key={source.sourceId}
                        render={<section />}
                        aria-label="Why this source appears"
                        className="w-full border-t border-border/60 pt-2">
                        <CollapsibleTrigger
                            render={
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                />
                            }
                            className="group -ml-2 h-8 gap-1.5 px-2 text-xs font-normal text-muted-foreground">
                            <Icon
                                iconNode={ArrowRight01Icon}
                                className="size-3.5 transition-transform group-aria-expanded:rotate-90 motion-reduce:transition-none"
                            />
                            Why this source appears
                        </CollapsibleTrigger>
                        <CollapsibleContent className="pb-1 pt-2">
                            {annotation}
                        </CollapsibleContent>
                    </Collapsible>
                ) : null}
            </header>

            <div className="flex min-h-0 flex-1 flex-col p-2">
                <DirectionAwareTabs
                    tabs={tabs}
                    defaultTabId="details"
                    value={source.decision === "pending" ? tab : "details"}
                    onChange={setTab}
                    contentSizing="fill"
                    containerClassName="flex-1 min-h-0"
                />
            </div>
        </article>
    );
}

function SourceAddress({ url }: { url: string }) {
    return (
        <ResponsivePopover
            title="Source address"
            description="Full address of the original source."
            closeLabel="Close source address"
            className="sm:w-112"
            trigger={
                <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="View source address"
                    className="size-8 text-muted-foreground">
                    <Icon
                        iconNode={InformationCircleIcon}
                        className="size-3.5"
                    />
                </Button>
            }>
            <div className="flex items-start gap-3">
                <code className="min-w-0 flex-1 select-text break-all font-mono text-xs leading-relaxed text-muted-foreground">
                    {url}
                </code>
                <CopyLinkButton url={url} />
            </div>
        </ResponsivePopover>
    );
}

function SourceReadingDetails({
    source,
    isLoading,
}: {
    source: SourceReviewSource;
    isLoading: boolean;
}) {
    if (isLoading)
        return (
            <div
                role="status"
                aria-label="Loading source reading"
                aria-busy="true"
                className="mt-5 space-y-3">
                <Skeleton className="h-5 w-44" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-12 w-full rounded-lg" />
                <Skeleton className="h-12 w-full rounded-lg" />
            </div>
        );
    const reading = sourceReadingCopy(source);
    if (!reading)
        return (
            <div className="mt-6 space-y-2 text-sm leading-relaxed">
                <h4 className="font-medium">Reading not prepared</h4>
                <p className="text-muted-foreground">
                    This source has not been read yet. Review the original, or
                    prepare source reading from the proposed corpus when
                    available.
                </p>
            </div>
        );
    const qualification = source.qualification;
    const concerns = new Set(
        qualification?.limitations.map((item) => item.code),
    );
    return (
        <section aria-label="Source reading" className="mt-5 space-y-4 text-sm">
            <div className="space-y-2">
                <h4 className="font-medium">{reading.title}</h4>
                <p className="leading-relaxed text-muted-foreground">
                    {reading.description}
                </p>
                <div className="flex flex-wrap gap-2">
                    {source.inspectionStatus === "partial" ? (
                        <Badge variant="outline">Partially reviewed</Badge>
                    ) : null}
                    {source.qualificationExecutionMode === "showcase" ? (
                        <Badge variant="outline">
                            Illustrative source assessment
                        </Badge>
                    ) : null}
                </div>
            </div>
            {qualification?.findings.map((finding, index) => {
                const contribution = sourceFindingContributionCopy(
                    finding.summary,
                );
                return (
                    <details
                        key={finding.findingKey}
                        open={index === 0}
                        className="rounded-lg border border-border/60 p-4">
                        <summary className="cursor-pointer space-y-1 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                            {sourceCoverageRoleLabel(finding.role)}
                            <span className="block text-xs font-normal text-muted-foreground">
                                {sourceFindingKindLabel(finding.kind)}
                            </span>
                        </summary>
                        {contribution ? (
                            <p className="mt-3 text-sm leading-relaxed">
                                {contribution}
                            </p>
                        ) : null}
                        <p className="mt-3 leading-relaxed text-muted-foreground">
                            {sourceUsageCopy(
                                finding.usage,
                                finding.comparisonOutcome,
                                finding.kind,
                            )}
                        </p>
                        {finding.comparisonDetails ? (
                            <div className="mt-3 rounded-md bg-muted/40 p-3">
                                <p className="text-xs font-medium">
                                    Comparison note
                                </p>
                                <p className="mt-1 leading-relaxed text-muted-foreground">
                                    {sourceAssessmentExplanationCopy(
                                        finding.comparisonDetails.explanation,
                                    )}
                                </p>
                                <div className="mt-3 space-y-3">
                                    {finding.comparisonDetails.primaryPassages.map(
                                        (passage) => (
                                            <div
                                                key={`${passage.canonicalUrl}\u0000${passage.quotation}`}
                                                className="space-y-1">
                                                <a
                                                    href={passage.canonicalUrl}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    className="break-all text-xs font-medium link underline-offset-4">
                                                    {passage.title}
                                                </a>
                                                <blockquote className="whitespace-pre-wrap border-l-2 border-border pl-3 leading-relaxed text-muted-foreground">
                                                    {passage.quotation}
                                                </blockquote>
                                            </div>
                                        ),
                                    )}
                                </div>
                            </div>
                        ) : null}
                        <InspectedPassages passages={finding.passages} />
                    </details>
                );
            })}
            {concerns.size > 0 ? (
                <details className="rounded-lg border border-border/60 p-3">
                    <summary className="cursor-pointer font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        Points to verify
                    </summary>
                    <ul className="mt-3 space-y-4">
                        {[...concerns].map((code) => (
                            <li key={code}>
                                <p className="leading-relaxed text-muted-foreground">
                                    {sourceReadingConcernCopy(code)}
                                </p>
                                <InspectedPassages
                                    passages={
                                        qualification?.limitations
                                            .filter(
                                                (item) => item.code === code,
                                            )
                                            .flatMap((item) => item.passages) ??
                                        []
                                    }
                                />
                            </li>
                        ))}
                    </ul>
                </details>
            ) : null}
        </section>
    );
}

function InspectedPassages({
    passages,
}: {
    passages: NonNullable<
        SourceReviewSource["qualification"]
    >["companyPassages"];
}) {
    const unique = new Map(
        passages.map((passage) => [passage.passageKey, passage]),
    );
    return [...unique.values()].map((passage) => (
        <blockquote
            key={passage.passageKey}
            className="mt-3 whitespace-pre-wrap border-l-2 border-border pl-3 leading-relaxed">
            {passage.quotation}
        </blockquote>
    ));
}
