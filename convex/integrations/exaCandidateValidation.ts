"use node";

import { validatePublicSourceUrl } from "@convex/domain/publicSourceUrl";

export async function validateExaCandidates<
    Candidate extends { canonicalUrl: string },
>(
    candidates: ReadonlyArray<Candidate>,
    resolveAddresses: (hostname: string) => Promise<ReadonlyArray<string>>,
    signal?: AbortSignal,
): Promise<{ candidates: Array<Candidate>; rejected: number }> {
    signal?.throwIfAborted();
    const validation = Promise.allSettled(
        candidates.map(async (candidate) => {
            const validated = await validatePublicSourceUrl(
                candidate.canonicalUrl,
                resolveAddresses,
            );
            return {
                ...candidate,
                canonicalUrl: validated.canonicalUrl,
            };
        }),
    );
    let onAbort: (() => void) | undefined;
    try {
        const results = await (signal
            ? Promise.race([
                  validation,
                  new Promise<never>((_resolve, reject) => {
                      onAbort = () => reject(signal.reason);
                      signal.addEventListener("abort", onAbort, { once: true });
                  }),
              ])
            : validation);
        return {
            candidates: results.flatMap((result) =>
                result.status === "fulfilled" ? [result.value] : [],
            ),
            rejected: results.filter(({ status }) => status === "rejected")
                .length,
        };
    } finally {
        if (signal && onAbort) signal.removeEventListener("abort", onAbort);
    }
}
