'use node';

import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { getAuthUserId } from '@convex-dev/auth/server';
import { v } from 'convex/values';

import { api, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import type { ActionCtx } from './_generated/server';
import { action, internalAction } from './_generated/server';
import { validatePublicSourceUrl } from './domain/publicSourceUrl';
import { assertSourceCandidateRequestFits } from './domain/sourceCandidateCapacity';
import { sourceCandidateLimit } from './resourceLimits';

const MAX_REDIRECTS = 5;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;

type MetadataDependencies = {
    resolveAddresses: (hostname: string) => Promise<ReadonlyArray<string>>;
    request: (url: string, pinnedAddress: string) => Promise<Response>;
};

type PreparedLaunchManualSource = {
    canonicalUrl: string;
    title: string;
    providerReference: string;
};

async function readBoundedText(response: Response): Promise<string> {
    const declaredLength = Number(response.headers.get('content-length'));
    if (
        Number.isFinite(declaredLength) &&
        declaredLength > MAX_RESPONSE_BYTES
    ) {
        throw new Error('Source metadata response is too large');
    }
    if (!response.body) {
        return '';
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let bytes = 0;
    let text = '';
    while (true) {
        const { done, value } = await reader.read();
        if (done) {
            break;
        }
        bytes += value.byteLength;
        if (bytes > MAX_RESPONSE_BYTES) {
            await reader.cancel();
            throw new Error('Source metadata response is too large');
        }
        text += decoder.decode(value, { stream: true });
    }
    return `${text}${decoder.decode()}`;
}

export async function inspectPublicSourceMetadata(
    rawUrl: string,
    dependencies: MetadataDependencies,
): Promise<{ canonicalUrl: string; title: string }> {
    let current = rawUrl;
    for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
        let resolvedAddresses: ReadonlyArray<string> = [];
        const validated = await validatePublicSourceUrl(
            current,
            async (hostname) => {
                resolvedAddresses =
                    await dependencies.resolveAddresses(hostname);
                return resolvedAddresses;
            },
        );
        const pinnedAddress =
            resolvedAddresses[0] ??
            (isIP(validated.hostname) ? validated.hostname : undefined);
        if (!pinnedAddress) {
            throw new Error('Source URL did not resolve to a public address');
        }
        const response = await dependencies.request(
            validated.canonicalUrl,
            pinnedAddress,
        );
        if (
            response.status >= 300 &&
            response.status < 400 &&
            response.headers.has('location')
        ) {
            if (redirect === MAX_REDIRECTS) {
                throw new Error('Source URL exceeded the redirect limit');
            }
            current = new URL(
                response.headers.get('location') ?? '',
                validated.canonicalUrl,
            ).toString();
            continue;
        }
        if (!response.ok) {
            throw new Error(
                `Source metadata request failed with ${response.status}`,
            );
        }
        const contentType =
            response.headers.get('content-type')?.toLowerCase() ?? '';
        if (
            !contentType.startsWith('text/html') &&
            !contentType.startsWith('application/xhtml+xml') &&
            !contentType.startsWith('application/pdf')
        ) {
            throw new Error('Source URL returned an unsupported content type');
        }
        const body = contentType.startsWith('application/pdf')
            ? ''
            : await readBoundedText(response);
        const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(body)?.[1];
        return {
            canonicalUrl: validated.canonicalUrl,
            title:
                titleMatch?.replace(/\s+/g, ' ').trim() ||
                new URL(validated.canonicalUrl).hostname,
        };
    }
    throw new Error('Source URL exceeded the redirect limit');
}

export async function prepareLaunchManualSources(
    ctx: Pick<ActionCtx, 'runMutation' | 'runQuery'>,
    args: {
        ownerAuthUserId: Id<'users'>;
        idempotencyKey: string;
        urls: ReadonlyArray<string>;
    },
    inspect: (url: string) => Promise<{ canonicalUrl: string; title: string }>,
): Promise<Array<PreparedLaunchManualSource>> {
    assertSourceCandidateRequestFits(args.urls.length, sourceCandidateLimit());
    const prepared = new Map<string, PreparedLaunchManualSource>();
    for (const rawUrl of args.urls) {
        const url = rawUrl.trim();
        const operationKey = `launch_url_metadata:${createHash('sha256')
            .update(
                `${args.ownerAuthUserId}:${args.idempotencyKey.trim()}:${url}`,
            )
            .digest('hex')}`;
        let metadata: { canonicalUrl: string; title: string } | null = null;

        for (let attempt = 1; attempt <= 2; attempt += 1) {
            const startedAt = Date.now();
            const lease = await ctx.runMutation(
                internal.providerCalls.recordAttempt,
                {
                    service: 'url_metadata',
                    operation: 'inspect_launch_manual_source',
                    operationKey,
                    status: 'started',
                    attempt,
                },
            );
            if (!lease.shouldExecute) {
                if (lease.status === 'succeeded') {
                    metadata = await ctx.runQuery(
                        internal.providerCalls.getSucceededUrlMetadata,
                        { operationKey },
                    );
                    if (!metadata) {
                        throw new Error(
                            'Completed source metadata operation has no result',
                        );
                    }
                    break;
                }
                if (lease.status === 'started') {
                    throw new Error(
                        'Source metadata inspection is already in progress',
                    );
                }
                continue;
            }

            try {
                metadata = await inspect(url);
                await ctx.runMutation(internal.providerCalls.recordAttempt, {
                    service: 'url_metadata',
                    operation: 'inspect_launch_manual_source',
                    operationKey,
                    status: 'succeeded',
                    attempt,
                    latencyMs: Date.now() - startedAt,
                    usage: metadata,
                });
                break;
            } catch (error) {
                await ctx.runMutation(internal.providerCalls.recordAttempt, {
                    service: 'url_metadata',
                    operation: 'inspect_launch_manual_source',
                    operationKey,
                    status: 'failed',
                    attempt,
                    latencyMs: Date.now() - startedAt,
                    errorCode:
                        error instanceof Error
                            ? error.name
                            : 'UnknownProviderError',
                });
                throw error;
            }
        }

        if (!metadata) {
            throw new Error('Source metadata retry limit reached');
        }
        prepared.set(metadata.canonicalUrl, {
            ...metadata,
            providerReference: operationKey,
        });
    }
    return [...prepared.values()];
}

function normalizeRemoteAddress(address: string | undefined): string {
    return address?.replace(/^::ffff:/, '').toLowerCase() ?? '';
}

/**
 * Performs one HTTPS request against the exact address approved by the URL
 * policy while preserving the hostname for Host and TLS SNI validation.
 */
export function requestPinnedPublicSource(
    rawUrl: string,
    pinnedAddress: string,
): Promise<Response> {
    const url = new URL(rawUrl);
    return new Promise((resolve, reject) => {
        const request = httpsRequest(
            url,
            {
                method: 'GET',
                headers: {
                    Accept: 'text/html,application/xhtml+xml,application/pdf;q=0.8',
                    'Accept-Encoding': 'identity',
                    Host: url.host,
                },
                servername: url.hostname,
                lookup: (_hostname, _options, callback) => {
                    callback(
                        null,
                        pinnedAddress,
                        isIP(pinnedAddress) === 6 ? 6 : 4,
                    );
                },
            },
            (response) => {
                const connectedAddress = normalizeRemoteAddress(
                    response.socket.remoteAddress,
                );
                if (
                    connectedAddress !== normalizeRemoteAddress(pinnedAddress)
                ) {
                    response.destroy();
                    reject(
                        new Error(
                            'Source connection did not use the validated address',
                        ),
                    );
                    return;
                }
                const headers = new Headers();
                for (const [name, value] of Object.entries(response.headers)) {
                    if (Array.isArray(value)) {
                        for (const item of value) {
                            headers.append(name, item);
                        }
                    } else if (value !== undefined) {
                        headers.set(name, String(value));
                    }
                }
                const encoding =
                    headers.get('content-encoding')?.toLowerCase() ??
                    'identity';
                if (encoding !== 'identity') {
                    response.destroy();
                    reject(
                        new Error(
                            'Source metadata response uses unsupported content encoding',
                        ),
                    );
                    return;
                }
                const declaredLength = Number(headers.get('content-length'));
                if (
                    Number.isFinite(declaredLength) &&
                    declaredLength > MAX_RESPONSE_BYTES
                ) {
                    response.destroy();
                    reject(new Error('Source metadata response is too large'));
                    return;
                }
                const chunks: Uint8Array[] = [];
                let bytes = 0;
                response.on('data', (chunk: Buffer) => {
                    bytes += chunk.byteLength;
                    if (bytes > MAX_RESPONSE_BYTES) {
                        response.destroy(
                            new Error('Source metadata response is too large'),
                        );
                        return;
                    }
                    chunks.push(chunk);
                });
                response.on('error', reject);
                response.on('end', () => {
                    resolve(
                        new Response(Buffer.concat(chunks), {
                            status: response.statusCode ?? 500,
                            headers,
                        }),
                    );
                });
            },
        );
        request.setTimeout(REQUEST_TIMEOUT_MS, () => {
            request.destroy(new Error('Source metadata request timed out'));
        });
        request.on('error', reject);
        request.end();
    });
}

export async function addManualUrlWithInspector(
    ctx: Pick<ActionCtx, 'runMutation' | 'runQuery'>,
    args: {
        runId: Id<'researchRuns'>;
        corpusRevisionId: Id<'corpusRevisions'>;
        url: string;
    },
    inspect: (url: string) => Promise<{ canonicalUrl: string; title: string }>,
): Promise<{ sourceId: Id<'sources'> }> {
    const authorization = await ctx.runQuery(
        internal.sources.authorizeManualCandidate,
        {
            runId: args.runId,
            corpusRevisionId: args.corpusRevisionId,
        },
    );
    const operationKey = `run:${args.runId}:generation:${authorization.executionGeneration}:corpus:${args.corpusRevisionId}:url_metadata:${createHash('sha256').update(args.url.trim()).digest('hex')}`;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
        const startedAt = Date.now();
        const lease = await ctx.runMutation(
            internal.providerCalls.recordAttempt,
            {
                runId: args.runId,
                corpusRevisionId: args.corpusRevisionId,
                executionGeneration: authorization.executionGeneration,
                workflowVersion: 2,
                stepKey: authorization.stepKey,
                service: 'url_metadata',
                operation: 'inspect_manual_source',
                operationKey,
                status: 'started',
                attempt,
            },
        );
        if (!lease.shouldExecute) {
            if (lease.status === 'succeeded') {
                const sourceId = await ctx.runQuery(
                    internal.sources.findManualCandidateByProviderReference,
                    {
                        runId: args.runId,
                        providerReference: operationKey,
                    },
                );
                if (!sourceId) {
                    throw new Error(
                        'Completed source metadata operation has no candidate',
                    );
                }
                return { sourceId };
            }
            if (lease.status === 'started') {
                throw new Error(
                    'Source metadata inspection is already in progress',
                );
            }
            continue;
        }
        try {
            const metadata = await inspect(args.url);
            const sourceId = await ctx.runMutation(
                internal.sources.persistManualCandidate,
                {
                    runId: args.runId,
                    corpusRevisionId: args.corpusRevisionId,
                    executionGeneration: authorization.executionGeneration,
                    providerReference: operationKey,
                    ...metadata,
                },
            );
            await ctx.runMutation(internal.providerCalls.recordAttempt, {
                runId: args.runId,
                corpusRevisionId: args.corpusRevisionId,
                executionGeneration: authorization.executionGeneration,
                workflowVersion: 2,
                stepKey: authorization.stepKey,
                service: 'url_metadata',
                operation: 'inspect_manual_source',
                operationKey,
                status: 'succeeded',
                attempt,
                latencyMs: Date.now() - startedAt,
            });
            return { sourceId };
        } catch (error) {
            await ctx.runMutation(internal.providerCalls.recordAttempt, {
                runId: args.runId,
                corpusRevisionId: args.corpusRevisionId,
                executionGeneration: authorization.executionGeneration,
                workflowVersion: 2,
                stepKey: authorization.stepKey,
                service: 'url_metadata',
                operation: 'inspect_manual_source',
                operationKey,
                status: 'failed',
                attempt,
                latencyMs: Date.now() - startedAt,
                errorCode:
                    error instanceof Error
                        ? error.name
                        : 'UnknownProviderError',
            });
            throw error;
        }
    }
    throw new Error('Source metadata retry limit reached');
}

export const addManualUrl = action({
    args: {
        runId: v.id('researchRuns'),
        corpusRevisionId: v.id('corpusRevisions'),
        url: v.string(),
    },
    returns: v.object({ sourceId: v.id('sources') }),
    handler: async (ctx, args): Promise<{ sourceId: Id<'sources'> }> => {
        const authUserId = await getAuthUserId(ctx);
        if (!authUserId) {
            throw new Error('Not authenticated');
        }
        const visitor = await ctx.runQuery(api.visitors.current, {});
        if (visitor?.status !== 'active') {
            throw new Error('Unauthorized');
        }
        return addManualUrlWithInspector(ctx, args, (url) =>
            inspectPublicSourceMetadata(url, {
                resolveAddresses: async (hostname) =>
                    (
                        await lookup(hostname, {
                            all: true,
                            verbatim: true,
                        })
                    ).map(({ address }) => address),
                request: requestPinnedPublicSource,
            }),
        );
    },
});

export const prepareLaunchUrls = internalAction({
    args: {
        idempotencyKey: v.string(),
        urls: v.array(v.string()),
    },
    returns: v.array(
        v.object({
            canonicalUrl: v.string(),
            title: v.string(),
            providerReference: v.string(),
        }),
    ),
    handler: async (ctx, args): Promise<Array<PreparedLaunchManualSource>> => {
        const authUserId = await getAuthUserId(ctx);
        if (!authUserId) {
            throw new Error('Not authenticated');
        }
        const visitor = await ctx.runQuery(api.visitors.current, {});
        if (visitor?.status !== 'active') {
            throw new Error('Unauthorized');
        }
        return prepareLaunchManualSources(
            ctx,
            {
                ownerAuthUserId: authUserId,
                idempotencyKey: args.idempotencyKey,
                urls: args.urls,
            },
            (url) =>
                inspectPublicSourceMetadata(url, {
                    resolveAddresses: async (hostname) =>
                        (
                            await lookup(hostname, {
                                all: true,
                                verbatim: true,
                            })
                        ).map(({ address }) => address),
                    request: requestPinnedPublicSource,
                }),
        );
    },
});
