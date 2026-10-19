import type { Id } from "@convex/_generated/dataModel";
import {
    SEC_NORMALIZER_VERSION,
    SEC_RETRIEVAL_VERSION,
} from "@convex/domain/evidenceArtifacts";
import {
    LOCATOR_VERSION,
    reproducePassage,
} from "@convex/domain/sourcePassages";
import type { ApprovedSourceRetrievalInput } from "@convex/integrations/approvedSourceRetrieval";
import { createSecCompanyResolver } from "@convex/integrations/sec";
import { retrieveAndNormalizeSecFiling } from "@convex/integrations/secEvidence";
import {
    MAX_APPROVED_SOURCE_BYTES,
    MAX_PASSAGES_PER_SOURCE,
} from "@convex/resourceLimits";
import { expect, test } from "vitest";

// Frozen CCC Intelligent Solutions source identity, identical to the default
// scenario in src/__tests__/convex/evidence/sec-provenance-tracer.test.ts.
const FROZEN_CCC_CIK = "1818201";
const FROZEN_CCC_ACCESSION = "0001818201-24-000010";
const FROZEN_CCC_PRIMARY_DOCUMENT = "cccs-20231231.htm";
const FROZEN_SEC_ARCHIVES_URL = `https://www.sec.gov/Archives/edgar/data/${FROZEN_CCC_CIK}/000181820124000010/${FROZEN_CCC_PRIMARY_DOCUMENT}`;

// Mirror of the production retry bound in convex/integrations/sec.ts
// (MAX_SEC_ATTEMPTS = 2).
const SEC_MAX_FETCH_ATTEMPTS = 2;

test("retrieves and normalizes one frozen CCC SEC filing through the production adapter", async () => {
    if (process.env.RUN_LIVE_PROVIDER_TESTS !== "1") {
        expect(process.env.RUN_LIVE_PROVIDER_TESTS).not.toBe("1");
        return;
    }
    const userAgent = process.env.SEC_USER_AGENT?.trim();
    if (!userAgent) {
        throw new Error(
            "SEC_USER_AGENT is required for live SEC evidence retrieval tests",
        );
    }

    const requestedUrls: string[] = [];
    let requests = 0;
    const resolver = createSecCompanyResolver({
        fetch: async (input, init) => {
            requests += 1;
            requestedUrls.push(String(input));
            return fetch(input, init);
        },
        now: Date.now,
        userAgent,
        reserveRequest: async () => undefined,
        recordAttempt: async () => ({ shouldExecute: true }),
        operationScope: "live-contract",
    });

    const input: ApprovedSourceRetrievalInput = {
        runId: "live-sec-run" as Id<"researchRuns">,
        corpusRevisionId: "live-sec-corpus" as Id<"corpusRevisions">,
        sourceId: "live-sec-source" as Id<"sources">,
        acceptedDecisionId: "live-sec-decision" as Id<"sourceDecisions">,
        executionGeneration: 1,
        canonicalUrl: FROZEN_SEC_ARCHIVES_URL,
        origin: "sec",
        providerReference: FROZEN_CCC_ACCESSION,
        secAccessionNumber: FROZEN_CCC_ACCESSION,
        secForm: "10-K",
        secPrimaryDocument: FROZEN_CCC_PRIMARY_DOCUMENT,
        companyCik: FROZEN_CCC_CIK,
    };

    const startedAt = Date.now();
    const result = await retrieveAndNormalizeSecFiling(resolver, input);
    const latencyMs = Date.now() - startedAt;

    let locatorReproduction = "none";
    if (result.status === "succeeded") {
        expect(requests).toBeGreaterThanOrEqual(1);
        expect(requests).toBeLessThanOrEqual(SEC_MAX_FETCH_ATTEMPTS);
        expect(result.normalizedText?.length).toBeGreaterThan(0);
        expect(result.byteCount).toBeGreaterThan(0);
        expect(result.byteCount).toBeLessThanOrEqual(MAX_APPROVED_SOURCE_BYTES);
        expect(result.passages?.length ?? 0).toBeGreaterThan(0);
        expect(result.passages?.length ?? 0).toBeLessThanOrEqual(
            MAX_PASSAGES_PER_SOURCE,
        );
        expect(result.canonicalUrl).toBe(FROZEN_SEC_ARCHIVES_URL);
        const requestedUrl = requestedUrls[0];
        expect(requestedUrl).toBeDefined();
        const url = new URL(requestedUrl ?? "");
        expect(url.hostname).toBe("www.sec.gov");
        expect(url.pathname).toBe(
            `/Archives/edgar/data/${FROZEN_CCC_CIK}/000181820124000010/${FROZEN_CCC_PRIMARY_DOCUMENT}`,
        );

        const firstPassage = result.passages?.[0];
        if (!firstPassage) {
            throw new Error("Expected at least one normalized passage");
        }
        const reproduced = await reproducePassage(
            result.normalizedText ?? "",
            firstPassage.locator,
        );
        expect(reproduced).toBe(firstPassage.exactQuotation);
        locatorReproduction = "exact_match";
    }

    console.info(
        "LIVE_PROVIDER_EVIDENCE",
        JSON.stringify({
            provider: "sec-evidence-retrieval",
            sourceUrl: FROZEN_SEC_ARCHIVES_URL,
            sourceIdentity: {
                cik: FROZEN_CCC_CIK,
                accessionNumber: FROZEN_CCC_ACCESSION,
                primaryDocument: FROZEN_CCC_PRIMARY_DOCUMENT,
            },
            utcDateTime: new Date().toISOString(),
            adapterVersion: SEC_RETRIEVAL_VERSION,
            locatorVersion: LOCATOR_VERSION,
            normalizerVersion: SEC_NORMALIZER_VERSION,
            requests,
            latencyMs,
            byteCount: result.byteCount ?? 0,
            passageCount: result.passages?.length ?? 0,
            locatorReproduction,
            outcome: result.status,
            ...(result.status === "failed"
                ? {
                      externalLimitation: result.errorCode ?? "unknown",
                  }
                : {}),
        }),
    );

    expect(
        result.status,
        `live SEC contract failed: errorCode=${result.errorCode ?? "none"}`,
    ).toBe("succeeded");
}, 60_000);
