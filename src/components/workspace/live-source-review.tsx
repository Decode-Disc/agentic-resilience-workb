'use client';

import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { usePaginatedQuery, useQuery } from 'convex/react';
import {
    Component,
    type ErrorInfo,
    type ReactNode,
    useState,
} from 'react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
    type SourceFilter,
    SourceReview,
} from '@/components/workspace/source-review';

const SOURCE_REVIEW_PAGE_SIZE = 12;

type LiveSourceReviewProps = {
    runId: Id<'researchRuns'>;
    corpusRevisionId: Id<'corpusRevisions'>;
    onDecide: Parameters<typeof SourceReview>[0]['onDecide'];
    onApprove: Parameters<typeof SourceReview>[0]['onApprove'];
    onAddManualUrl?: Parameters<typeof SourceReview>[0]['onAddManualUrl'];
};

export function LiveSourceReview(props: LiveSourceReviewProps) {
    const [retryKey, setRetryKey] = useState(0);
    return (
        <SourceReviewQueryBoundary
            key={retryKey}
            onRetry={() => setRetryKey((current) => current + 1)}
        >
            <SourceReviewData {...props} />
        </SourceReviewQueryBoundary>
    );
}

function SourceReviewData({
    runId,
    corpusRevisionId,
    onDecide,
    onApprove,
    onAddManualUrl,
}: LiveSourceReviewProps) {
    const [filter, setFilter] = useState<SourceFilter>('all');
    const [selectedId, setSelectedId] = useState<Id<'sources'> | null>(null);
    const summary = useQuery(api.sources.getReviewSummary, {
        runId,
        corpusRevisionId,
    });
    const { results, status, loadMore } = usePaginatedQuery(
        api.sources.listForReviewPage,
        { runId, corpusRevisionId, filter },
        { initialNumItems: SOURCE_REVIEW_PAGE_SIZE },
    );
    const selectedSource = useQuery(
        api.sources.getReviewSource,
        selectedId
            ? { runId, corpusRevisionId, sourceId: selectedId }
            : 'skip',
    );

    if (summary === undefined) {
        return <LiveSourceReviewSkeleton />;
    }

    return (
        <SourceReview
            runId={runId}
            corpusRevisionId={corpusRevisionId}
            review={{ ...summary, sources: [...results] }}
            filter={filter}
            onFilterChange={(nextFilter) => {
                setFilter(nextFilter);
                if (nextFilter !== 'all') {
                    setSelectedId(null);
                }
            }}
            selectedId={selectedId}
            selectedSource={selectedId ? selectedSource : null}
            onSelectedIdChange={setSelectedId}
            hasMore={status === 'CanLoadMore'}
            isLoadingMore={status === 'LoadingMore'}
            isLoadingInitial={status === 'LoadingFirstPage'}
            onLoadMore={() => loadMore(SOURCE_REVIEW_PAGE_SIZE)}
            onDecide={onDecide}
            onApprove={onApprove}
            onAddManualUrl={onAddManualUrl}
        />
    );
}

function LiveSourceReviewSkeleton() {
    return (
        <div
            role="status"
            aria-label="Loading source review"
            aria-busy="true"
            className="space-y-4"
        >
            <Skeleton className="h-24 w-full rounded-xl" />
            <div className="grid min-h-168 gap-4 md:grid-cols-[minmax(18rem,36%)_minmax(26rem,1fr)]">
                <div className="surface-panel space-y-4 rounded-xl p-4">
                    <Skeleton className="h-8 w-full" />
                    {['first', 'second', 'third'].map((key) => (
                        <Skeleton
                            key={key}
                            className="h-28 w-full rounded-xl"
                        />
                    ))}
                </div>
                <Skeleton className="h-full min-h-168 rounded-xl" />
            </div>
        </div>
    );
}

class SourceReviewQueryBoundary extends Component<
    { children: ReactNode; onRetry: () => void },
    { error: boolean }
> {
    state = { error: false };

    static getDerivedStateFromError() {
        return { error: true };
    }

    componentDidCatch(_error: unknown, _info: ErrorInfo) {
        // Convex query details remain intentionally outside analyst-facing UI.
    }

    render() {
        if (!this.state.error) {
            return this.props.children;
        }
        return (
            <div
                role="alert"
                className="surface-panel rounded-xl border border-destructive/30 p-5"
            >
                <h2 className="text-base font-medium">
                    Source review could not be loaded
                </h2>
                <p className="mt-2 text-sm text-muted-foreground">
                    The candidate source collection is temporarily unavailable.
                    Try loading it again.
                </p>
                <Button
                    type="button"
                    variant="secondary"
                    className="mt-4"
                    onClick={this.props.onRetry}
                >
                    Try again
                </Button>
            </div>
        );
    }
}
