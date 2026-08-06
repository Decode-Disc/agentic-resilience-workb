import type { Id } from '@convex/_generated/dataModel';
import type { ActionCtx } from '@convex/_generated/server';
import { prepareLaunchManualSources } from '@convex/sourceActions';
import { afterEach, expect, test, vi } from 'vitest';

const originalSourceCandidateLimit = process.env.SOURCE_CANDIDATE_LIMIT;

afterEach(() => {
    if (originalSourceCandidateLimit === undefined) {
        delete process.env.SOURCE_CANDIDATE_LIMIT;
    } else {
        process.env.SOURCE_CANDIDATE_LIMIT = originalSourceCandidateLimit;
    }
});

test('inspects launch references and returns canonical source metadata', async () => {
    const runMutation = vi
        .fn()
        .mockResolvedValueOnce({
            shouldExecute: true,
            status: 'started',
        })
        .mockResolvedValueOnce({
            shouldExecute: false,
            status: 'succeeded',
        });
    const runQuery = vi.fn();
    const inspect = vi.fn(async () => ({
        canonicalUrl: 'https://example.com/report',
        title: 'Public report',
    }));

    await expect(
        prepareLaunchManualSources(
            { runMutation, runQuery } as unknown as Pick<
                ActionCtx,
                'runMutation' | 'runQuery'
            >,
            {
                ownerAuthUserId: 'user-1' as Id<'users'>,
                idempotencyKey: 'launch-with-reference',
                urls: ['https://example.com/report#overview'],
            },
            inspect,
        ),
    ).resolves.toEqual([
        {
            canonicalUrl: 'https://example.com/report',
            title: 'Public report',
            providerReference: expect.stringContaining('launch_url_metadata:'),
        },
    ]);

    expect(inspect).toHaveBeenCalledWith('https://example.com/report#overview');
    expect(runMutation.mock.calls[0]?.[1]).toMatchObject({
        service: 'url_metadata',
        operation: 'inspect_launch_manual_source',
        status: 'started',
    });
    expect(runMutation.mock.calls[1]?.[1]).toMatchObject({
        service: 'url_metadata',
        operation: 'inspect_launch_manual_source',
        status: 'succeeded',
        usage: {
            canonicalUrl: 'https://example.com/report',
            title: 'Public report',
        },
    });
});

test('deduplicates references that resolve to the same canonical URL', async () => {
    const runMutation = vi
        .fn()
        .mockResolvedValueOnce({
            shouldExecute: true,
            status: 'started',
        })
        .mockResolvedValueOnce({
            shouldExecute: false,
            status: 'succeeded',
        })
        .mockResolvedValueOnce({
            shouldExecute: true,
            status: 'started',
        })
        .mockResolvedValueOnce({
            shouldExecute: false,
            status: 'succeeded',
        });
    const inspect = vi.fn(async () => ({
        canonicalUrl: 'https://example.com/report',
        title: 'Public report',
    }));

    await expect(
        prepareLaunchManualSources(
            {
                runMutation,
                runQuery: vi.fn(),
            } as unknown as Pick<ActionCtx, 'runMutation' | 'runQuery'>,
            {
                ownerAuthUserId: 'user-1' as Id<'users'>,
                idempotencyKey: 'launch-deduplicated',
                urls: [
                    'https://example.com/report',
                    'https://example.com/report#summary',
                ],
            },
            inspect,
        ),
    ).resolves.toHaveLength(1);
});

test('rejects oversized launch references before inspecting any URL', async () => {
    process.env.SOURCE_CANDIDATE_LIMIT = '2';
    const inspect = vi.fn();

    await expect(
        prepareLaunchManualSources(
            {
                runMutation: vi.fn(),
                runQuery: vi.fn(),
            } as unknown as Pick<ActionCtx, 'runMutation' | 'runQuery'>,
            {
                ownerAuthUserId: 'user-1' as Id<'users'>,
                idempotencyKey: 'launch-over-capacity',
                urls: [
                    'https://example.com/one',
                    'https://example.com/two',
                    'https://example.com/three',
                ],
            },
            inspect,
        ),
    ).rejects.toThrow('source candidate limit');
    expect(inspect).not.toHaveBeenCalled();
});
