import type { Id } from "@convex/_generated/dataModel";
import {
    LOCATOR_VERSION,
    preparePassageReproduction,
} from "@convex/domain/sourcePassages";
import type { ApprovedSourceRetrievalInput } from "@convex/integrations/approvedSourceRetrieval";
import { EXA_NORMALIZER_VERSION } from "@convex/integrations/evidenceNormalization";
import {
    createExaContentsAdapter,
    type ExaContentsClient,
} from "@convex/integrations/exa";
import { createExaContentsClient } from "@convex/integrations/exaContentsClient";
import {
    EXA_RETRIEVAL_VERSION,
    retrieveAndNormalizeExaFiling,
} from "@convex/integrations/exaEvidence";
import {
    MAX_APPROVED_SOURCE_BYTES,
    MAX_EXA_CONTENTS_ATTEMPTS,
    MAX_PASSAGES_PER_SOURCE,
} from "@convex/resourcePolicy";
import { expect, test } from "vitest";

// One frozen canonical public CCC URL already present in the Phase 5 test
// corpus (src/__tests__/benchmarks/retrieval-benchmark-manifest.ts,
// id "ccc-auto-physical-damage").
const FROZEN_CCC_PUBLIC_URL = "https://www.cccis.com/insurance-carriers/apd";

test("retrieves and normalizes one frozen CCC public page through the production Exa Contents adapter", async () => {
    const apiKey = process.env.EXA_API_KEY?.trim();
    if (!apiKey) {
        throw new Error(
            "EXA_API_KEY is required for live Exa contents retrieval tests",
        );
    }

    const client = createExaContentsClient(apiKey);
    let sdkCalls = 0;
    let requestedMaxCharacters: number | undefined;
    const contentsClient: ExaContentsClient = {
        getContents: async (urls, options, requestOptions) => {
            sdkCalls += 1;
            if (
                options?.text &&
                typeof options.text === "object" &&
                typeof options.text.maxCharacters === "number"
            ) {
                requestedMaxCharacters = options.text.maxCharacters;
            }
            const response = (await client.getContents(
                urls,
                {
                    ...(options?.text === true
                        ? { text: true }
                        : options?.text &&
                            typeof options.text === "object" &&
                            typeof options.text.maxCharacters === "number"
                          ? {
                                text: {
                                    maxCharacters: options.text.maxCharacters,
                                },
                            }
                          : {}),
                },
                requestOptions,
            )) as {
                results: ReadonlyArray<{
                    id: string;
                    url: string;
                    title?: string | null;
                    text?: string;
                }>;
                searchTime?: number;
                costDollars?: { total: number };
            };
            return {
                results: response.results.map((entry) => ({
                    id: entry.id,
                    url: entry.url,
                    ...(typeof entry.title === "string"
                        ? { title: entry.title }
                        : {}),
                    ...(typeof entry.text === "string"
                        ? { text: entry.text }
                        : {}),
                })),
                searchTime: response.searchTime,
                costDollars: response.costDollars,
            };
        },
    };
    const adapter = createExaContentsAdapter(contentsClient, {
        now: Date.now,
        operationScope: "live-contract",
    });

    const input: ApprovedSourceRetrievalInput = {
        runId: "live-exa-run" as Id<"researchRuns">,
        corpusRevisionId: "live-exa-corpus" as Id<"corpusRevisions">,
        sourceId: "live-exa-source" as Id<"sources">,
        acceptedDecisionId: "live-exa-decision" as Id<"sourceDecisions">,
        executionGeneration: 1,
        canonicalUrl: FROZEN_CCC_PUBLIC_URL,
        origin: "exa",
        providerReference: FROZEN_CCC_PUBLIC_URL,
    };

    const startedAt = Date.now();
    const result = await retrieveAndNormalizeExaFiling(adapter, input);
    const latencyMs = Date.now() - startedAt;

    let locatorReproduction = "none";
    if (result.status === "succeeded") {
        expect(sdkCalls).toBeGreaterThanOrEqual(1);
        expect(sdkCalls).toBeLessThanOrEqual(MAX_EXA_CONTENTS_ATTEMPTS);
        expect(requestedMaxCharacters).toBeDefined();
        expect(requestedMaxCharacters ?? 0).toBeLessThanOrEqual(1_000_000);
        expect(requestedMaxCharacters ?? 0).toBeLessThanOrEqual(
            Math.floor(MAX_APPROVED_SOURCE_BYTES / 4),
        );
        expect(result.normalizedText?.length).toBeGreaterThan(0);
        expect(result.byteCount).toBeGreaterThan(0);
        expect(result.byteCount).toBeLessThanOrEqual(MAX_APPROVED_SOURCE_BYTES);
        expect(result.passages?.length ?? 0).toBeGreaterThan(0);
        expect(result.passages?.length ?? 0).toBeLessThanOrEqual(
            MAX_PASSAGES_PER_SOURCE,
        );
        expect(result.canonicalUrl).toBe(FROZEN_CCC_PUBLIC_URL);

        const firstPassage = result.passages?.[0];
        if (!firstPassage) {
            throw new Error("Expected at least one normalized passage");
        }
        const reproduced = preparePassageReproduction(
            result.normalizedText ?? "",
        )(firstPassage.locator);
        expect(reproduced).toBe(firstPassage.exactQuotation);
        locatorReproduction = "exact_match";
    }

    const retrievalMetadata = result.retrievalMetadata ?? {};
    console.info(
        "LIVE_PROVIDER_EVIDENCE",
        JSON.stringify({
            provider: "exa-contents-retrieval",
            sourceUrl: FROZEN_CCC_PUBLIC_URL,
            utcDateTime: new Date().toISOString(),
            adapterVersion: EXA_RETRIEVAL_VERSION,
            locatorVersion: LOCATOR_VERSION,
            normalizerVersion: EXA_NORMALIZER_VERSION,
            sdkCalls,
            latencyMs,
            byteCount: result.byteCount ?? 0,
            passageCount: result.passages?.length ?? 0,
            locatorReproduction,
            outcome: result.status,
            ...(typeof retrievalMetadata.costDollars === "number"
                ? { costDollars: retrievalMetadata.costDollars }
                : {}),
            ...(result.status === "failed"
                ? {
                      externalLimitation: result.errorCode ?? "unknown",
                  }
                : {}),
        }),
    );

    expect(
        result.status,
        `live Exa contents contract failed: errorCode=${result.errorCode ?? "none"}`,
    ).toBe("succeeded");
}, 300_000);
