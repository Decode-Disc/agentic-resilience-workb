import type { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { type ComponentProps, useState } from 'react';

import { SourceReview } from '@/components/workspace/source-review';
import type { FunctionArgs } from 'convex/server';

type Projection = ComponentProps<typeof SourceReview>['review'];
type Decision = FunctionArgs<typeof api.sources.decide>['decision'];

const FIXTURE_REVIEW: Projection = {
    revision: 1,
    status: 'draft',
    counts: { accepted: 2, rejected: 1, pending: 2 },
    total: 5,
    candidateLimit: 48,
    sources: [
        {
            sourceId: 'src-1' as Id<'sources'>,
            canonicalUrl:
                'https://www.sec.gov/Archives/edgar/data/1373715/000162828024032498/snow-20240131.htm',
            title: 'Annual report on Form 10-K',
            origin: 'sec',
            category: 'regulatory_filing',
            decision: 'accepted',
            publishedAt: 1706745600000,
            reason: undefined,
        },
        {
            sourceId: 'src-2' as Id<'sources'>,
            canonicalUrl:
                'https://investors.servicenow.com/news-releases/news-details/default.aspx',
            title: 'Q4 earnings release and investor commentary',
            origin: 'sec',
            category: 'regulatory_filing',
            decision: 'accepted',
            publishedAt: 1706745600000,
            reason: undefined,
        },
        {
            sourceId: 'src-3' as Id<'sources'>,
            canonicalUrl:
                'https://seekingalpha.com/article/4651234-servicenow-platform-resilience',
            title: 'Platform resilience and AI distribution thesis',
            origin: 'exa',
            category: 'independent_analysis',
            decision: 'pending',
            publishedAt: 1709164800000,
            reason: undefined,
        },
        {
            sourceId: 'src-4' as Id<'sources'>,
            canonicalUrl:
                'https://www.zdnet.com/article/servicenow-meets-the-agentic-era',
            title: 'ServiceNow meets the agentic era',
            origin: 'exa',
            category: 'press_coverage',
            decision: 'pending',
            publishedAt: 1709164800000,
            reason: undefined,
        },
        {
            sourceId: 'src-5' as Id<'sources'>,
            canonicalUrl:
                'https://substack.example.com/discontinuity/p/weakening-now',
            title: 'Is the workflow moat weakening?',
            origin: 'exa',
            category: 'counter_evidence',
            decision: 'rejected',
            publishedAt: 1709164800000,
            reason: 'Author discloses short position',
        },
    ],
};

/** Prototype companion component for /prototype/source-review. */
export function ProtoSourceReview() {
    const [review, setReview] = useState(FIXTURE_REVIEW);

    const onDecide: ComponentProps<typeof SourceReview>['onDecide'] = (
        sourceId,
        decision: Decision,
    ) => {
        setReview((current) => {
            const nextSources = current.sources.map((s) =>
                s.sourceId === sourceId ? { ...s, decision } : s,
            );
            return {
                ...current,
                sources: nextSources,
                counts: {
                    accepted: nextSources.filter(
                        (s) => s.decision === 'accepted',
                    ).length,
                    rejected: nextSources.filter(
                        (s) => s.decision === 'rejected',
                    ).length,
                    pending: nextSources.filter((s) => s.decision === 'pending')
                        .length,
                },
            };
        });
    };

    return (
        <div className="py-6">
            <header className="mb-5">
                <p className="text-micro text-brand-purple">NOW · NYSE</p>
                <h1 className="mt-2 text-2xl font-medium">ServiceNow, Inc.</h1>
            </header>
            <p className="mb-4 rounded-lg border border-review/30 bg-review/10 p-3 text-xs text-muted-foreground sm:max-w-xl">
                Prototype fixture. Five sources, two accepted, one rejected, two
                pending. Used to refine the source-review layout against the
                reference.
            </p>
            <SourceReview
                runId={'proto-run' as Id<'researchRuns'>}
                corpusRevisionId={'proto-rev' as Id<'corpusRevisions'>}
                review={review}
                onDecide={onDecide}
                onApprove={() => undefined}
                onAddManualUrl={() => undefined}
            />
        </div>
    );
}
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/prototype/source-review-component')({
    component: RouteComponent,
});

function RouteComponent() {
    return <div>Hello "/prototype/source-review-component"!</div>;
}
