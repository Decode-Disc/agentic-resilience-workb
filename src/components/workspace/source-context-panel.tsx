import type { Id } from "@convex/_generated/dataModel";
import {
    ArrowRight01Icon,
    CheckmarkCircle02Icon,
    File02Icon,
    InformationCircleIcon,
    LinkSquare01Icon,
} from "@hugeicons/core-free-icons";
import { type ReactNode, useState } from "react";
import { FaviconAvatar } from "@/components/favicon-avatar";
import Icon from "@/components/icon";
import { AlertStatus } from "@/components/ui/alert-status";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { CopyLinkButton } from "@/components/ui/copy-link-button";
import {
    Empty,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle,
} from "@/components/ui/empty";
import { ResponsivePopover } from "@/components/ui/responsive-popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApprovedSourceSearch } from "@/components/workspace/approved-source-search";
import { SourceBrowserView } from "@/components/workspace/source-browser-view";
import { SourceDecisionStatus } from "@/components/workspace/source-decision";
import { SourceDocumentKindBadge } from "@/components/workspace/source-family-badge";
import type { SourceReviewSource } from "@/components/workspace/source-review";
import {
    sourceAssessmentExplanationCopy,
    sourceAuthorityPresentation,
    sourceCompanyLinkageLabel,
    sourceCoverageRoleLabel,
    sourceFindingContributionCopy,
    sourceFindingKindLabel,
    sourceInclusionLabel,
    sourceOriginLabel,
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
 * Shared source reader with metadata, reading and pending-candidate visual previews.
 * Decision actions stay outside the scrollable reading region.
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
    const [tab, setTab] = useState<"details" | "preview">("details");
    return (
        <article
            className={cn(
                "surface-panel @container/source-reader flex h-full min-h-0 flex-col overflow-hidden rounded-(--radius-source-card)",
                className,
            )}>
            <header
                data-slot="source-record-header"
                className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 p-4 @min-[36rem]/source-reader:grid-cols-[auto_minmax(0,1fr)_auto]">
                <div className="self-start">
                    <FaviconAvatar
                        canonicalUrl={source.canonicalUrl}
                        entityName={source.title}
                        size="lg"
                    />
                </div>
                <div className="min-w-0 self-start space-y-0.5">
                    <h3 className="break-words text-lg font-medium leading-snug tracking-tight">
                        {source.title}
                    </h3>
                    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                        <span className="inline-flex min-w-0 items-center gap-1">
                            <span className="break-all">
                                {new URL(source.canonicalUrl).hostname}
                            </span>
                            <SourceAddress
                                key={source.sourceId}
                                url={source.canonicalUrl}
                            />
                        </span>
                        <a
                            href={source.canonicalUrl}
                            target="_blank"
                            rel="noreferrer"
                            className={buttonVariants({
                                variant: "outline",
                                size: "xs",
                                className:
                                    "@max-[22rem]/source-reader:size-6 @max-[22rem]/source-reader:p-0",
                            })}>
                            <Icon iconNode={LinkSquare01Icon} />
                            <span className="@max-[22rem]/source-reader:sr-only">
                                Open original
                            </span>
                        </a>
                    </div>
                </div>

                <div className="col-span-2 flex max-w-full flex-wrap items-center justify-end gap-1.5 self-end justify-self-end @max-[36rem]/source-reader:[&>button]:px-1.5 @min-[36rem]/source-reader:col-span-1 @min-[36rem]/source-reader:col-start-3 @min-[36rem]/source-reader:row-start-1">
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
                    {actions}
                </div>
            </header>
            <Tabs
                value={source.decision === "pending" ? tab : "details"}
                onValueChange={(value) => {
                    if (value === "details" || value === "preview")
                        setTab(value);
                }}
                className="min-h-0 flex-1 gap-0">
                <TabsList
                    activateOnFocus
                    variant="line"
                    className="h-10 w-full shrink-0 justify-start rounded-none border-b border-border/60 px-4">
                    <TabsTrigger
                        value="details"
                        className="flex-none rounded-none px-3 data-active:text-primary after:bg-primary">
                        Source details
                    </TabsTrigger>
                    {source.decision === "pending" ? (
                        <TabsTrigger
                            value="preview"
                            className="flex-none rounded-none px-3 data-active:text-primary after:bg-primary">
                            Preview
                        </TabsTrigger>
                    ) : null}
                </TabsList>
                <TabsContent
                    value="details"
                    className="min-h-0 flex-1 overflow-y-auto p-4">
                    <SourceMetadata source={source} />
                    {annotation ? (
                        <Collapsible
                            key={source.sourceId}
                            render={<section />}
                            aria-label="Why this source appears"
                            className="my-3 border-b border-border/60 pb-3">
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
                            <CollapsibleContent className="pt-2">
                                {annotation}
                            </CollapsibleContent>
                        </Collapsible>
                    ) : null}
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
                                corpusRevisionId={approvedCorpusRevisionId}
                                sourceId={source.sourceId}
                            />
                        ) : (
                            <p className="mt-5 border-t border-border/60 pt-4 text-sm text-muted-foreground">
                                This source has no saved reading to search.
                                Review the original source.
                            </p>
                        )
                    ) : null}
                </TabsContent>
                {source.decision === "pending" ? (
                    <TabsContent
                        value="preview"
                        className="min-h-0 flex-1 overflow-hidden p-3">
                        <SourceBrowserView
                            source={source}
                            runId={runId}
                            onViewDetails={() => setTab("details")}
                        />
                    </TabsContent>
                ) : null}
            </Tabs>
        </article>
    );
}

function SourceMetadata({ source }: { source: SourceReviewSource }) {
    return (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-4 gap-y-2 rounded-lg border border-border/60 bg-muted/10 p-3 text-xs [&>dt]:pt-0.5 [&>dt]:text-muted-foreground [&>dd]:min-w-0">
            <dt>Document type</dt>
            <dd>
                <SourceDocumentKindBadge kind={source.documentKind} />
            </dd>
            {source.publishedAt !== undefined ? (
                <>
                    <dt>Published</dt>
                    <dd>
                        <time
                            dateTime={new Date(
                                source.publishedAt,
                            ).toISOString()}>
                            {sourceDateFormatter.format(source.publishedAt)}
                        </time>
                    </dd>
                </>
            ) : null}
            {source.qualification?.reportingPeriodEnd ? (
                <>
                    <dt>Reporting period ending</dt>
                    <dd>
                        <time
                            dateTime={source.qualification.reportingPeriodEnd}>
                            {sourceDateFormatter.format(
                                new Date(
                                    `${source.qualification.reportingPeriodEnd}T00:00:00.000Z`,
                                ),
                            )}
                        </time>
                    </dd>
                </>
            ) : null}
            <dt>Source origin</dt>
            <dd>{sourceOriginLabel(source.origin)}</dd>
            <dt>Provenance</dt>
            <dd>
                <SourceProvenance source={source} />
            </dd>
        </dl>
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
                    className="size-6 text-muted-foreground">
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

function SourceProvenance({ source }: { source: SourceReviewSource }) {
    const provenance = sourceAuthorityPresentation(source.authorityTier);
    const linkage = source.companyLinkageBasis
        ? sourceCompanyLinkageLabel(
              source.companyLinkageBasis,
              source.inspectionStatus,
          )
        : null;
    return (
        <Collapsible render={<section />} aria-label="Source provenance">
            <CollapsibleTrigger
                render={<Button type="button" variant="ghost" size="sm" />}
                className={cn(
                    "group h-auto min-h-0 max-w-full gap-1.5 whitespace-normal p-0 text-left text-xs font-normal",
                    provenance.className,
                )}>
                {provenance.label}
                <Icon
                    iconNode={ArrowRight01Icon}
                    className="size-3 shrink-0 transition-transform group-aria-expanded:rotate-90 motion-reduce:transition-none"
                />
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-2 pt-2 leading-relaxed text-muted-foreground">
                <p>{provenance.description}</p>
                {linkage ? <p>{linkage}</p> : null}
            </CollapsibleContent>
        </Collapsible>
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
            <Empty className="mt-3 min-h-40 rounded-lg border border-border/60 bg-muted/20 p-6">
                <EmptyHeader>
                    <EmptyMedia>
                        <Icon
                            iconNode={File02Icon}
                            className="size-5 text-muted-foreground"
                        />
                    </EmptyMedia>
                    <EmptyTitle className="text-sm">
                        Reading not prepared
                    </EmptyTitle>
                    <EmptyDescription>
                        This source has not been read yet. Review the original,
                        or prepare source reading from the proposed corpus when
                        available.
                    </EmptyDescription>
                </EmptyHeader>
            </Empty>
        );
    const qualification = source.qualification;
    if (!qualification)
        return (
            <section aria-label="Source reading" className="mt-3">
                <Empty
                    role={reading.status === "danger" ? "alert" : "status"}
                    aria-label={reading.title}
                    className="min-h-40 rounded-lg border border-border/60 bg-muted/20 p-6">
                    <EmptyHeader>
                        <EmptyMedia>
                            <Icon
                                iconNode={File02Icon}
                                className="size-5 text-muted-foreground"
                            />
                        </EmptyMedia>
                        <EmptyTitle className="text-sm">
                            {reading.title}
                        </EmptyTitle>
                        <EmptyDescription>
                            {reading.description}
                        </EmptyDescription>
                    </EmptyHeader>
                </Empty>
            </section>
        );
    const concerns = new Set(
        qualification?.limitations.map((item) => item.code),
    );
    return (
        <section aria-label="Source reading" className="mt-5 space-y-4 text-sm">
            <div className="space-y-2">
                <AlertStatus
                    status={reading.status}
                    role={reading.status === "danger" ? "alert" : "status"}
                    aria-label={reading.title}
                    title={reading.title}
                    description={reading.description}
                />
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
