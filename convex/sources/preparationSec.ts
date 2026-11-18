"use node";

import { lookup } from "node:dns/promises";
import { internal } from "@convex/_generated/api";
import type { Doc } from "@convex/_generated/dataModel";
import type { ActionCtx } from "@convex/_generated/server";
import { validatePublicSourceUrl } from "@convex/domain/publicSourceUrl";
import { sourcePreparationError } from "@convex/domain/sourcePreparationAuthority";
import { createSecCompanyResolver } from "@convex/integrations/sec";
import {
    DEFAULT_SEC_TIMEOUT_MS,
    MAX_APPROVED_SOURCE_BYTES,
} from "@convex/resourcePolicy";
import { requestPinnedPublicSource } from "@convex/sourceActions";

/** Shares authorization, pinned public transport and aggregate throttling for every preparation SEC request. */
export function preparationSecResolver(
    ctx: ActionCtx,
    preparation: Doc<"sourceSelectionProposalRebuilds">,
    attempts: Pick<
        Parameters<typeof createSecCompanyResolver>[0],
        "recordAttempt" | "firstAttempt" | "maxAttempts" | "operationScope"
    >,
) {
    const verifyActive = () =>
        ctx.runQuery(internal.sourcePreparation.getForExecution, {
            preparationId: preparation._id,
            now: Date.now(),
        });
    const remaining = () =>
        Math.max(1, (preparation.deadlineAt ?? 0) - Date.now());
    const userAgent =
        process.env.SEC_USER_AGENT?.trim() ||
        "Evidence Workbench research@evidence-workbench.org";
    return createSecCompanyResolver({
        ...attempts,
        now: Date.now,
        userAgent,
        retryPolicy: "confirmed_response",
        timeoutMs: Math.min(DEFAULT_SEC_TIMEOUT_MS, remaining()),
        reserveRequest: async () => {
            await verifyActive();
            const { retryAfter } = await ctx.runMutation(
                internal.providerCalls.reserveSecRateLimit,
                {},
            );
            if (retryAfter)
                await new Promise((resolve) =>
                    setTimeout(resolve, Math.min(retryAfter, remaining())),
                );
            await verifyActive();
        },
        fetch: async (url, init) => {
            await verifyActive();
            const signal = AbortSignal.any([
                AbortSignal.timeout(
                    Math.min(DEFAULT_SEC_TIMEOUT_MS, remaining()),
                ),
                ...(init?.signal ? [init.signal] : []),
            ]);
            signal.throwIfAborted();
            let timer: ReturnType<typeof setTimeout> | undefined;
            let destination: Awaited<
                ReturnType<typeof validatePublicSourceUrl>
            >;
            try {
                destination = await Promise.race([
                    validatePublicSourceUrl(String(url), async (hostname) => {
                        const records = await lookup(hostname, {
                            all: true,
                            verbatim: true,
                        });
                        signal.throwIfAborted();
                        return records.map((record) => record.address);
                    }),
                    new Promise<never>((_, reject) => {
                        timer = setTimeout(
                            () =>
                                reject(
                                    sourcePreparationError(
                                        "source_url_unavailable",
                                    ),
                                ),
                            Math.min(DEFAULT_SEC_TIMEOUT_MS, remaining()),
                        );
                    }),
                ]);
            } finally {
                clearTimeout(timer);
            }
            const address = destination.addresses[0];
            if (!address)
                throw sourcePreparationError("source_url_unavailable");
            await verifyActive();
            signal.throwIfAborted();
            return requestPinnedPublicSource(
                destination.canonicalUrl,
                address,
                {
                    headers: {
                        Accept:
                            new Headers(init?.headers).get("Accept") ??
                            "application/json",
                        "User-Agent": userAgent,
                    },
                    maxBytes: MAX_APPROVED_SOURCE_BYTES,
                    signal,
                    timeoutMs: Math.min(DEFAULT_SEC_TIMEOUT_MS, remaining()),
                },
            );
        },
    });
}
