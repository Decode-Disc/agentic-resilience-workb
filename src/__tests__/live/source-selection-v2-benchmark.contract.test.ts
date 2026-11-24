// @vitest-environment node

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildResearchPlan } from "@convex/domain/researchPlan";
import { createExaDiscoveryAdapter } from "@convex/integrations/exa";
import { fetchExaSearch } from "@convex/integrations/exaSearchClient";
import { expect, test } from "vitest";
import { withBenchmarkDeadline } from "@/__tests__/benchmarks/retrieval-benchmark";
import { SOURCE_SELECTION_V2_LIVE_COMPANIES } from "@/__tests__/benchmarks/source-selection-v2-benchmark-manifest";

const MAX_EXA_REQUESTS = 30;
const MAX_SEC_REQUESTS = 5;
const REQUEST_TIMEOUT_MS = 10_000;

test("acquires a bounded metadata-only source-selection benchmark corpus", async () => {
    if (process.env.RUN_SOURCE_SELECTION_BENCHMARK !== "1") {
        throw new Error(
            "RUN_SOURCE_SELECTION_BENCHMARK=1 is required for source-selection corpus acquisition",
        );
    }
    const exaKey = process.env.EXA_API_KEY?.trim();
    const secUserAgent = process.env.SEC_USER_AGENT?.trim();
    if (!exaKey || !secUserAgent)
        throw new Error("Live benchmark provider configuration is incomplete");

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const outputDirectory = join(
        "/tmp/agentic-resilience-source-selection-v2-benchmark",
        timestamp,
    );
    await mkdir(outputDirectory, { recursive: true });
    const exa = createExaDiscoveryAdapter({
        search: (query, options) =>
            withBenchmarkDeadline(
                (signal) => fetchExaSearch(exaKey, query, options, signal),
                REQUEST_TIMEOUT_MS,
            ),
    });
    let exaRequests = 0;
    let secRequests = 0;
    const observations: Array<unknown> = [];

    for (const company of SOURCE_SELECTION_V2_LIVE_COMPANIES) {
        if (++secRequests > MAX_SEC_REQUESTS)
            throw new Error("SEC benchmark request ceiling exceeded");
        const secStartedAt = Date.now();
        const controller = new AbortController();
        const timeout = setTimeout(
            () => controller.abort(),
            REQUEST_TIMEOUT_MS,
        );
        let secPayload: unknown;
        try {
            const response = await fetch(
                `https://data.sec.gov/submissions/CIK${company.cik.padStart(10, "0")}.json`,
                {
                    headers: {
                        Accept: "application/json",
                        "User-Agent": secUserAgent,
                    },
                    signal: controller.signal,
                },
            );
            if (!response.ok)
                throw new Error(
                    `SEC benchmark request failed with ${response.status}`,
                );
            secPayload = await response.json();
        } finally {
            clearTimeout(timeout);
        }
        const plan = buildResearchPlan({
            company,
            coveragePreset: company.coveragePreset,
        });
        const webBatches = [];
        for (const query of plan.queries) {
            if (++exaRequests > MAX_EXA_REQUESTS)
                throw new Error("Exa benchmark request ceiling exceeded");
            webBatches.push({
                query,
                batch: await exa.search(query.query, 4, query.includeDomains),
            });
        }
        observations.push({
            company,
            secLatencyMs: Date.now() - secStartedAt,
            secPayload,
            webBatches,
        });
        await writeFile(
            join(outputDirectory, `${company.id}.json`),
            `${JSON.stringify({ company, secPayload, webBatches }, null, 2)}\n`,
            "utf8",
        );
    }
    await writeFile(
        join(outputDirectory, "scorecard.json"),
        `${JSON.stringify({ status: "awaiting_manual_labels", companies: SOURCE_SELECTION_V2_LIVE_COMPANIES.map(({ id }) => ({ id, labels: [] })) }, null, 2)}\n`,
        "utf8",
    );
    await writeFile(
        join(outputDirectory, "run.json"),
        `${JSON.stringify({ timestamp, collectionStatus: "complete", semanticReviewStatus: "awaiting_manual_labels", persisted: false, secRequests, exaRequests, maximums: { sec: MAX_SEC_REQUESTS, exa: MAX_EXA_REQUESTS }, observations: observations.map((observation) => ({ company: (observation as { company: { id: string } }).company.id })) }, null, 2)}\n`,
        "utf8",
    );
    expect(secRequests).toBeLessThanOrEqual(MAX_SEC_REQUESTS);
    expect(exaRequests).toBeLessThanOrEqual(MAX_EXA_REQUESTS);
});
