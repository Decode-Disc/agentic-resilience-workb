import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';

const {
    useQuery,
    useMutation,
    useAction,
    decideSource,
    approveCorpus,
    decideSufficiency,
    addManualUrl,
    navigate,
} = vi.hoisted(() => ({
    useQuery: vi.fn(),
    useMutation: vi.fn(),
    useAction: vi.fn(),
    decideSource: vi.fn(),
    approveCorpus: vi.fn(),
    decideSufficiency: vi.fn(),
    addManualUrl: vi.fn(),
    navigate: vi.fn(),
}));

vi.mock('convex/react', () => ({ useQuery, useMutation, useAction }));
vi.mock('@tanstack/react-router', () => ({
    useNavigate: () => navigate,
    Link: ({ children, ...props }: React.ComponentProps<'a'>) => (
        <a {...props}>{children}</a>
    ),
}));

import { RunRouteComponent } from '@/components/workspace/run-route-component';

beforeEach(() => {
    useQuery.mockReset();
    useMutation.mockReset();
    useAction.mockReset();
    decideSource.mockReset();
    approveCorpus.mockReset();
    decideSufficiency.mockReset();
    addManualUrl.mockReset();
    navigate.mockReset();
    useMutation.mockImplementation(() => {
        const index = (useMutation.mock.calls.length - 1) % 3;
        return [decideSource, approveCorpus, decideSufficiency][index];
    });
    useAction.mockReturnValue(addManualUrl);
});

test('wires the evidence sufficiency checkpoint', async () => {
    useQuery.mockImplementation(() => {
        const index = (useQuery.mock.calls.length - 1) % 3;
        return [
            {
                runId: 'run-1',
                company: {
                    legalName: 'Example Corp',
                    ticker: 'EXM',
                    exchange: 'NASDAQ',
                    cik: '123',
                },
                lifecycleState: 'awaiting_evidence_sufficiency_review',
                executionStatus: 'paused',
                pauseReason: 'evidence_sufficiency_review',
                activeCorpusRevisionId: 'revision-1',
                providerFailures: [],
                updatedAt: 1,
            },
            [],
            undefined,
        ][index];
    });
    addManualUrl.mockResolvedValue({ sourceId: 'source-1' });
    decideSufficiency.mockResolvedValue({ accepted: true });

    render(<RunRouteComponent runId={'run-1' as never} section="progress" />);

    fireEvent.click(
        screen.getByRole('button', { name: /Add public source link/i }),
    );
    fireEvent.change(screen.getByLabelText(/Public source link/i), {
        target: { value: 'https://example.com/report' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Add source$/i }));
    await waitFor(() =>
        expect(addManualUrl).toHaveBeenCalledWith({
            runId: 'run-1',
            corpusRevisionId: 'revision-1',
            url: 'https://example.com/report',
        }),
    );
    fireEvent.click(screen.getByRole('button', { name: /Done/i }));

    fireEvent.click(screen.getByRole('button', { name: /Recheck evidence/i }));
    await waitFor(() =>
        expect(decideSufficiency).toHaveBeenCalledWith({
            runId: 'run-1',
            decision: expect.objectContaining({ kind: 'recheck' }),
        }),
    );

    fireEvent.change(screen.getByLabelText(/Reason for this decision/i), {
        target: {
            value: 'Public evidence remains too limited for a credible review.',
        },
    });
    fireEvent.click(
        screen.getByRole('button', { name: /Finish with limited evidence/i }),
    );
    await waitFor(() =>
        expect(decideSufficiency).toHaveBeenCalledWith({
            runId: 'run-1',
            decision: expect.objectContaining({
                kind: 'complete_insufficient',
                reason: 'Public evidence remains too limited for a credible review.',
            }),
        }),
    );
});

test('does not expose corpus approval while discovery is running', () => {
    useQuery.mockImplementation(() => {
        const index = (useQuery.mock.calls.length - 1) % 3;
        return [
            {
                runId: 'run-1',
                company: {
                    legalName: 'Example Corp',
                    ticker: 'EXM',
                    exchange: 'NASDAQ',
                    cik: '123',
                },
                lifecycleState: 'discovering_sources',
                executionStatus: 'running',
                activeCorpusRevisionId: 'revision-1',
                providerFailures: [],
                updatedAt: 1,
            },
            [],
            {
                revision: 1,
                status: 'draft',
                counts: { accepted: 0, rejected: 0, pending: 0 },
                sources: [],
            },
        ][index];
    });

    render(<RunRouteComponent runId={'run-1' as never} section="sources" />);

    expect(
        screen.getByText(/We’re gathering public sources for your review/i),
    ).toBeTruthy();
    expect(
        screen.queryByRole('button', { name: /Approve corpus/i }),
    ).toBeNull();
});

test('routes the analyst to the active source-review checkpoint', async () => {
    useQuery.mockImplementation(() => {
        const index = (useQuery.mock.calls.length - 1) % 3;
        return [
            {
                runId: 'run-1',
                company: {
                    legalName: 'Example Corp',
                    ticker: 'EXM',
                    exchange: 'NASDAQ',
                    cik: '123',
                },
                lifecycleState: 'awaiting_source_review',
                executionStatus: 'paused',
                pauseReason: 'source_review',
                activeCorpusRevisionId: 'revision-1',
                providerFailures: [
                    {
                        service: 'exa',
                        operation: 'search',
                        errorCode: 'exa_not_configured',
                        occurredAt: 1,
                    },
                ],
                updatedAt: 1,
            },
            [],
            {
                revision: 1,
                status: 'draft',
                counts: { accepted: 0, rejected: 0, pending: 0 },
                sources: [],
            },
        ][index];
    });

    render(<RunRouteComponent runId={'run-1' as never} section="progress" />);

    await waitFor(() =>
        expect(navigate).toHaveBeenCalledWith({
            to: '/workspace/$runId',
            params: { runId: 'run-1' },
            search: { section: 'sources' },
            replace: true,
        }),
    );
    expect(
        screen.getAllByText(
            /Independent web discovery is unavailable.*filing sources remain available/i,
        ).length,
    ).toBeTruthy();
    expect(screen.getByText(/Review source set/i)).toBeTruthy();
    expect(
        screen.queryByText(
            /EXA_API_KEY|Convex deployment|awaiting_source_review|exa_not_configured/i,
        ),
    ).toBeNull();
});
