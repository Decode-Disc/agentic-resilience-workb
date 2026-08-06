"use node";

import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { action } from "./_generated/server";
import {
    classifyManualSourceIntakeError,
    manualSourceIntakeError,
} from "./domain/manualSourceIntake";
import { validatePublicSourceUrl } from "./domain/publicSourceUrl";
import { assertSourceCandidateRequestFits } from "./domain/sourceCandidateCapacity";
import { sourceCandidateLimit } from "./resourceLimits";

const MAX_REDIRECTS = 5;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;
const PREPARATION_TTL_MS = 10 * 60_000;
const manualSourceTargetValidator = v.union(
    v.object({
        kind: v.literal("prelaunch"),
        collectionKey: v.string(),
    }),
    v.object({
        kind: v.literal("run"),
        runId: v.id("researchRuns"),
        corpusRevisionId: v.id("corpusRevisions"),
    }),
);
const manualSourceResultValidator = v.union(
    v.object({
        kind: v.literal("prepared"),
        preparationId: v.id("manualSourcePreparations"),
        canonicalUrl: v.string(),
        title: v.string(),
        expiresAt: v.number(),
    }),
    v.object({
        kind: v.literal("persisted"),
        sourceId: v.id("sources"),
        canonicalUrl: v.string(),
        title: v.string(),
    }),
);

type MetadataDependencies = {
    resolveAddresses: (hostname: string) => Promise<ReadonlyArray<string>>;
    request: (url: string, pinnedAddress: string) => Promise<Response>;
};

type PreparedLaunchManualSource = {
    canonicalUrl: string;
    title: string;
    providerReference: string;
};

type ManualCandidateAuthorization = {
    executionGeneration: number;
    workflowVersion: number;
    stepKey: "evidence_sufficiency_review" | "source_review";
    hasCapacity: boolean;
};

type ManualSourceTarget =
    | { kind: "prelaunch"; collectionKey: string }
    | {
          kind: "run";
          runId: Id<"researchRuns">;
          corpusRevisionId: Id<"corpusRevisions">;
      };

type ManualSourceResult =
    | {
          kind: "prepared";
          preparationId: Id<"manualSourcePreparations">;
          canonicalUrl: string;
          title: string;
          expiresAt: number;
      }
    | {
          kind: "persisted";
          sourceId: Id<"sources">;
          canonicalUrl: string;
          title: string;
      };

async function readBoundedText(response: Response): Promise<string> {
    const declaredLength = Number(response.headers.get("content-length"));
    if (
        Number.isFinite(declaredLength) &&
        declaredLength > MAX_RESPONSE_BYTES
    ) {
        throw manualSourceIntakeError("response_too_large", { field: "url" });
    }
    if (!response.body) {
        return "";
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let bytes = 0;
    let text = "";
    while (true) {
        const { done, value } = await reader.read();
        if (done) {
            break;
        }
        bytes += value.byteLength;
        if (bytes > MAX_RESPONSE_BYTES) {
            await reader.cancel();
            throw manualSourceIntakeError("response_too_large", {
                field: "url",
            });
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
            throw manualSourceIntakeError("dns_failed", { field: "url" });
        }
        let response: Response;
        try {
            response = await dependencies.request(
                validated.canonicalUrl,
                pinnedAddress,
            );
        } catch (error) {
            throw classifyManualSourceIntakeError(error);
        }
        if (
            response.status >= 300 &&
            response.status < 400 &&
            response.headers.has("location")
        ) {
            if (redirect === MAX_REDIRECTS) {
                throw manualSourceIntakeError("redirect_limit", {
                    field: "url",
                });
            }
            current = new URL(
                response.headers.get("location") ?? "",
                validated.canonicalUrl,
            ).toString();
            continue;
        }
        if (!response.ok) {
            if (response.status === 401 || response.status === 403) {
                throw manualSourceIntakeError("access_blocked", {
                    field: "url",
                });
            }
            if (response.status === 404) {
                throw manualSourceIntakeError("not_found", { field: "url" });
            }
            if (response.status === 429) {
                throw manualSourceIntakeError("upstream_rate_limited", {
                    field: "url",
                });
            }
            if (response.status >= 500) {
                throw manualSourceIntakeError("upstream_unavailable", {
                    field: "url",
                });
            }
            throw manualSourceIntakeError("access_blocked", { field: "url" });
        }
        const contentType =
            response.headers.get("content-type")?.toLowerCase() ?? "";
        if (
            !contentType.startsWith("text/html") &&
            !contentType.startsWith("application/xhtml+xml") &&
            !contentType.startsWith("application/pdf")
        ) {
            throw manualSourceIntakeError("unsupported_content_type", {
                field: "url",
            });
        }
        if (contentType.startsWith("application/pdf")) {
            const disposition = response.headers.get("content-disposition");
            const filename = disposition?.match(
                /filename\*?=(?:UTF-8''|["']?)([^"';]+)["']?/i,
            )?.[1];
            const pathTitle = new URL(validated.canonicalUrl).pathname
                .split("/")
                .filter(Boolean)
                .at(-1);
            return {
                canonicalUrl: validated.canonicalUrl,
                title:
                    (filename ? decodeURIComponent(filename) : pathTitle) ||
                    new URL(validated.canonicalUrl).hostname,
            };
        }
        const body = await readBoundedText(response);
        const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(body)?.[1];
        return {
            canonicalUrl: validated.canonicalUrl,
            title:
                titleMatch?.replace(/\s+/g, " ").trim() ||
                new URL(validated.canonicalUrl).hostname,
        };
    }
    throw manualSourceIntakeError("redirect_limit", { field: "url" });
}

async function inspectPrelaunchManualSource(
    ctx: Pick<ActionCtx, "runMutation" | "runQuery">,
    args: {
        ownerAuthUserId: Id<"users">;
        idempotencyKey: string;
        url: string;
    },
    inspect: (url: string) => Promise<{ canonicalUrl: string; title: string }>,
): Promise<PreparedLaunchManualSource> {
    assertSourceCandidateRequestFits(1, sourceCandidateLimit());
    const url = args.url.trim();
    const operationKey = `launch_url_metadata:${createHash("sha256")
        .update(`${args.ownerAuthUserId}:${args.idempotencyKey.trim()}:${url}`)
        .digest("hex")}`;
    let metadata: { canonicalUrl: string; title: string } | null = null;

    for (let attempt = 1; attempt <= 2; attempt += 1) {
        const startedAt = Date.now();
        const lease = await ctx.runMutation(
            internal.providerCalls.recordAttempt,
            {
                service: "url_metadata",
                operation: "inspect_launch_manual_source",
                operationKey,
                status: "started",
                attempt,
            },
        );
        if (!lease.shouldExecute) {
            if (lease.status === "succeeded") {
                metadata = await ctx.runQuery(
                    internal.providerCalls.getSucceededUrlMetadata,
                    { operationKey },
                );
                if (!metadata) {
                    throw new Error(
                        "Completed source metadata operation has no result",
                    );
                }
                break;
            }
            if (lease.status === "started") {
                throw new Error(
                    "Source metadata inspection is already in progress",
                );
            }
            continue;
        }

        try {
            metadata = await inspect(url);
            await ctx.runMutation(internal.providerCalls.recordAttempt, {
                service: "url_metadata",
                operation: "inspect_launch_manual_source",
                operationKey,
                status: "succeeded",
                attempt,
                latencyMs: Date.now() - startedAt,
                usage: metadata,
            });
            break;
        } catch (error) {
            const classified = classifyManualSourceIntakeError(error);
            await ctx.runMutation(internal.providerCalls.recordAttempt, {
                service: "url_metadata",
                operation: "inspect_launch_manual_source",
                operationKey,
                status: "failed",
                attempt,
                latencyMs: Date.now() - startedAt,
                errorCode: classified.data.code,
            });
            if (classified.data.retryable && attempt < 2) {
                continue;
            }
            throw classified;
        }
    }
    if (!metadata) {
        throw new Error("Source metadata retry limit reached");
    }
    return {
        ...metadata,
        providerReference: operationKey,
    };
}

export async function submitManualUrlWithInspector(
    ctx: Pick<ActionCtx, "runMutation" | "runQuery">,
    authUserId: Id<"users">,
    args: {
        requestKey: string;
        url: string;
        target: ManualSourceTarget;
    },
    inspect: (url: string) => Promise<{ canonicalUrl: string; title: string }>,
    now: () => number = Date.now,
): Promise<ManualSourceResult> {
    if (args.target.kind === "run") {
        const persisted = await addManualUrlWithInspector(
            ctx,
            {
                authUserId,
                runId: args.target.runId,
                corpusRevisionId: args.target.corpusRevisionId,
                requestKey: args.requestKey,
                url: args.url,
            },
            inspect,
        );
        return {
            kind: "persisted",
            ...persisted,
        };
    }
    const requestKey = args.requestKey.trim();
    const collectionKey = args.target.collectionKey.trim();
    const url = args.url.trim();
    if (
        requestKey.length === 0 ||
        requestKey.length > 128 ||
        collectionKey.length === 0 ||
        collectionKey.length > 128 ||
        url.length === 0 ||
        url.length > 2_048
    ) {
        throw manualSourceIntakeError("invalid_url", { field: "url" });
    }
    const inputDigest = createHash("sha256").update(url).digest("hex");
    const currentTime = now();
    const existing: {
        preparationId: Id<"manualSourcePreparations">;
        canonicalUrl: string;
        title: string;
        expiresAt: number;
    } | null = await ctx.runQuery(internal.sourceIntake.findPreparation, {
        collectionKey,
        requestKey,
        inputDigest,
        now: currentTime,
    });
    if (existing) {
        return { kind: "prepared", ...existing };
    }
    await ctx.runMutation(
        internal.providerCalls.reserveSourceMetadataRateLimit,
        {
            authUserId,
        },
    );
    const prepared = await inspectPrelaunchManualSource(
        ctx,
        {
            ownerAuthUserId: authUserId,
            idempotencyKey: `${collectionKey}:${requestKey}`,
            url,
        },
        inspect,
    );
    const persisted: {
        preparationId: Id<"manualSourcePreparations">;
        canonicalUrl: string;
        title: string;
        expiresAt: number;
    } = await ctx.runMutation(internal.sourceIntake.persistPreparation, {
        collectionKey,
        requestKey,
        inputDigest,
        canonicalUrl: prepared.canonicalUrl,
        title: prepared.title,
        providerReference: prepared.providerReference,
        expiresAt: currentTime + PREPARATION_TTL_MS,
    });
    return { kind: "prepared", ...persisted };
}

function normalizeRemoteAddress(address: string | undefined): string {
    return address?.replace(/^::ffff:/, "").toLowerCase() ?? "";
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
                method: "GET",
                headers: {
                    Accept: "text/html,application/xhtml+xml,application/pdf;q=0.8",
                    "Accept-Encoding": "identity",
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
                            "Source connection did not use the validated address",
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
                    headers.get("content-encoding")?.toLowerCase() ??
                    "identity";
                if (encoding !== "identity") {
                    response.destroy();
                    reject(
                        manualSourceIntakeError("unsupported_content_type", {
                            field: "url",
                        }),
                    );
                    return;
                }
                const contentType =
                    headers.get("content-type")?.toLowerCase() ?? "";
                if (contentType.startsWith("application/pdf")) {
                    response.destroy();
                    resolve(
                        new Response(null, {
                            status: response.statusCode ?? 500,
                            headers,
                        }),
                    );
                    return;
                }
                const declaredLength = Number(headers.get("content-length"));
                if (
                    Number.isFinite(declaredLength) &&
                    declaredLength > MAX_RESPONSE_BYTES
                ) {
                    response.destroy();
                    reject(
                        manualSourceIntakeError("response_too_large", {
                            field: "url",
                        }),
                    );
                    return;
                }
                const chunks: Uint8Array[] = [];
                let bytes = 0;
                response.on("data", (chunk: Buffer) => {
                    bytes += chunk.byteLength;
                    if (bytes > MAX_RESPONSE_BYTES) {
                        response.destroy(
                            manualSourceIntakeError("response_too_large", {
                                field: "url",
                            }),
                        );
                        return;
                    }
                    chunks.push(chunk);
                });
                response.on("error", reject);
                response.on("end", () => {
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
            request.destroy(manualSourceIntakeError("request_timeout"));
        });
        request.on("error", reject);
        request.end();
    });
}

export async function addManualUrlWithInspector(
    ctx: Pick<ActionCtx, "runMutation" | "runQuery">,
    args: {
        authUserId: Id<"users">;
        runId: Id<"researchRuns">;
        corpusRevisionId: Id<"corpusRevisions">;
        requestKey: string;
        url: string;
    },
    inspect: (url: string) => Promise<{ canonicalUrl: string; title: string }>,
): Promise<{
    sourceId: Id<"sources">;
    canonicalUrl: string;
    title: string;
}> {
    const requestKey = args.requestKey.trim();
    const url = args.url.trim();
    if (
        requestKey.length === 0 ||
        requestKey.length > 128 ||
        url.length === 0 ||
        url.length > 2_048
    ) {
        throw manualSourceIntakeError("invalid_url", { field: "url" });
    }
    const authorization: ManualCandidateAuthorization = await ctx.runQuery(
        internal.sources.authorizeManualCandidate,
        {
            runId: args.runId,
            corpusRevisionId: args.corpusRevisionId,
        },
    );
    const requestDigest = createHash("sha256").update(requestKey).digest("hex");
    const urlDigest = createHash("sha256").update(url).digest("hex");
    const operationKey = `run:${args.runId}:workflow:${authorization.workflowVersion}:generation:${authorization.executionGeneration}:corpus:${args.corpusRevisionId}:step:${authorization.stepKey}:request:${requestDigest}:url_metadata:${urlDigest}`;
    const existing: {
        sourceId: Id<"sources">;
        canonicalUrl: string;
        title: string;
    } | null = await ctx.runQuery(
        internal.sources.findManualCandidateByProviderReference,
        {
            runId: args.runId,
            providerReference: operationKey,
        },
    );
    if (existing) {
        return existing;
    }
    if (!authorization.hasCapacity) {
        throw manualSourceIntakeError("candidate_limit");
    }
    await ctx.runMutation(
        internal.providerCalls.reserveSourceMetadataRateLimit,
        {
            authUserId: args.authUserId,
        },
    );
    for (let attempt = 1; attempt <= 2; attempt += 1) {
        const startedAt = Date.now();
        const lease = await ctx.runMutation(
            internal.providerCalls.recordAttempt,
            {
                runId: args.runId,
                corpusRevisionId: args.corpusRevisionId,
                executionGeneration: authorization.executionGeneration,
                workflowVersion: authorization.workflowVersion,
                stepKey: authorization.stepKey,
                service: "url_metadata",
                operation: "inspect_manual_source",
                operationKey,
                status: "started",
                attempt,
            },
        );
        if (!lease.shouldExecute) {
            if (lease.status === "succeeded") {
                const persisted: {
                    sourceId: Id<"sources">;
                    canonicalUrl: string;
                    title: string;
                } | null = await ctx.runQuery(
                    internal.sources.findManualCandidateByProviderReference,
                    {
                        runId: args.runId,
                        providerReference: operationKey,
                    },
                );
                if (!persisted) {
                    throw new Error(
                        "Completed source metadata operation has no candidate",
                    );
                }
                return persisted;
            }
            if (lease.status === "started") {
                throw new Error(
                    "Source metadata inspection is already in progress",
                );
            }
            continue;
        }
        try {
            const metadata = await inspect(url);
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
                workflowVersion: authorization.workflowVersion,
                stepKey: authorization.stepKey,
                service: "url_metadata",
                operation: "inspect_manual_source",
                operationKey,
                status: "succeeded",
                attempt,
                latencyMs: Date.now() - startedAt,
            });
            return { sourceId, ...metadata };
        } catch (error) {
            const classified = classifyManualSourceIntakeError(error);
            await ctx.runMutation(internal.providerCalls.recordAttempt, {
                runId: args.runId,
                corpusRevisionId: args.corpusRevisionId,
                executionGeneration: authorization.executionGeneration,
                workflowVersion: 2,
                stepKey: authorization.stepKey,
                service: "url_metadata",
                operation: "inspect_manual_source",
                operationKey,
                status: "failed",
                attempt,
                latencyMs: Date.now() - startedAt,
                errorCode: classified.data.code,
            });
            if (classified.data.retryable && attempt < 2) {
                continue;
            }
            throw classified;
        }
    }
    throw new Error("Source metadata retry limit reached");
}

export const submitManualUrl = action({
    args: {
        requestKey: v.string(),
        url: v.string(),
        target: manualSourceTargetValidator,
    },
    returns: manualSourceResultValidator,
    handler: async (ctx, args): Promise<ManualSourceResult> => {
        const authUserId = await getAuthUserId(ctx);
        if (!authUserId) {
            throw new ConvexError(
                manualSourceIntakeError("not_authenticated").data,
            );
        }
        try {
            return await submitManualUrlWithInspector(
                ctx,
                authUserId,
                args,
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
        } catch (error) {
            const classified = classifyManualSourceIntakeError(error);
            throw new ConvexError(classified.data);
        }
    },
});
