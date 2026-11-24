// @vitest-environment node

import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createExaContentsClient } from "@convex/integrations/exaContentsClient";
import { expect, test } from "vitest";
import {
    assertBenchmarkOptIn,
    assertMinimumFirecrawlCredits,
    hashBenchmarkText,
    measureBenchmarkContent,
    parseFirecrawlCreditUsage,
    parseFirecrawlScrapeResponse,
    runWithBoundedRetry,
    withBenchmarkDeadline,
} from "@/__tests__/benchmarks/retrieval-benchmark";
import { RETRIEVAL_BENCHMARK_CORPUS } from "@/__tests__/benchmarks/retrieval-benchmark-manifest";

const EXTERNAL_TIMEOUT_MS = 120_000;
const FIRECRAWL_MAX_AGE_MS = 24 * 60 * 60 * 1_000;
const EXA_MAX_AGE_HOURS = 24;
const MAX_COMMAND_BUFFER_BYTES = 25 * 1_024 * 1_024;

type Provider = "exa" | "firecrawl";

type SuccessfulRetrieval = {
    cost: unknown;
    finalUrl?: string;
    markdown: string;
    providerPayload: unknown;
    requestId?: string;
    statusCode?: number;
    title?: string;
};

type RetrievalObservation = {
    anchorCoverage: number;
    anchorMatches: boolean[];
    attempts: number;
    characterCount: number;
    clientVersion: string;
    cost: unknown;
    error?: string;
    finalUrl?: string;
    inputUrl: string;
    latencyMs: number;
    nativeHash?: string;
    normalizedHash?: string;
    provider: Provider;
    requestId?: string;
    sourceClass: "first_party" | "third_party";
    sourceId: string;
    status: "failed" | "succeeded";
    statusCode?: number;
    title?: string;
    wordCount: number;
};

test(
    "compares Exa Contents with Firecrawl Scrape on the frozen corpus",
    async () => {
        assertBenchmarkOptIn(process.env);
        const apiKey = process.env.EXA_API_KEY?.trim();
        if (!apiKey) {
            throw new Error(
                "EXA_API_KEY is required for the retrieval benchmark",
            );
        }

        const creditBefore = parseFirecrawlCreditUsage(
            (await runCommand("firecrawl", ["credit-usage", "--json"])).stdout,
        );
        assertMinimumFirecrawlCredits(creditBefore);
        const firecrawlVersion = (
            await runCommand("firecrawl", ["--version"])
        ).stdout.trim();
        const exaPackage = JSON.parse(
            await readFile("node_modules/exa-js/package.json", "utf8"),
        ) as { version: string };
        const exa = createExaContentsClient(apiKey);
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const outputDirectory = join(
            "/tmp/agentic-resilience-retrieval-benchmark",
            timestamp,
        );
        const rawDirectory = join(outputDirectory, "raw");
        const reviewDirectory = join(outputDirectory, "blind-review");
        await mkdir(rawDirectory, { recursive: true });
        await mkdir(reviewDirectory, { recursive: true });

        const observations: RetrievalObservation[] = [];
        const successfulMarkdown = new Map<string, string>();

        for (const [index, source] of RETRIEVAL_BENCHMARK_CORPUS.entries()) {
            const providers: Provider[] =
                index % 2 === 0 ? ["exa", "firecrawl"] : ["firecrawl", "exa"];

            for (const provider of providers) {
                const startedAt = Date.now();
                const result = await runWithBoundedRetry(async () => {
                    if (provider === "exa") {
                        const response = await withBenchmarkDeadline(
                            (signal) =>
                                exa.getContents(
                                    [source.url],
                                    {
                                        maxAgeHours: EXA_MAX_AGE_HOURS,
                                        text: true,
                                    },
                                    { signal },
                                ),
                            EXTERNAL_TIMEOUT_MS,
                        );
                        const first = response.results[0];
                        if (!first || typeof first.text !== "string") {
                            throw new Error(
                                "Exa Contents response did not include text",
                            );
                        }
                        return {
                            cost: response.costDollars ?? "not_reported",
                            finalUrl: first.url,
                            markdown: first.text,
                            providerPayload: response,
                            requestId: response.requestId,
                            statusCode: statusFromExaResponse(
                                response.statuses,
                            ),
                            title: first.title ?? undefined,
                        } satisfies SuccessfulRetrieval;
                    }

                    const command = await runCommand(
                        "firecrawl",
                        [
                            "scrape",
                            source.url,
                            "--format",
                            "markdown",
                            "--only-main-content",
                            "--max-age",
                            String(FIRECRAWL_MAX_AGE_MS),
                            "--json",
                            "--timing",
                        ],
                        EXTERNAL_TIMEOUT_MS,
                    );
                    const parsed = parseFirecrawlScrapeResponse(command.stdout);
                    return {
                        cost: "not_reported_per_request",
                        ...parsed,
                        providerPayload: JSON.parse(command.stdout) as unknown,
                    } satisfies SuccessfulRetrieval;
                });
                const latencyMs = Date.now() - startedAt;
                const clientVersion =
                    provider === "exa" ? exaPackage.version : firecrawlVersion;

                if (!result.value) {
                    const observation: RetrievalObservation = {
                        anchorCoverage: 0,
                        anchorMatches: source.anchors.map(() => false),
                        attempts: result.attempts,
                        characterCount: 0,
                        clientVersion,
                        cost: "not_reported",
                        error: result.error,
                        inputUrl: source.url,
                        latencyMs,
                        provider,
                        sourceClass: source.sourceClass,
                        sourceId: source.id,
                        status: "failed",
                        wordCount: 0,
                    };
                    observations.push(observation);
                    await writeFile(
                        join(rawDirectory, `${source.id}-${provider}.json`),
                        `${JSON.stringify(observation, null, 2)}\n`,
                        "utf8",
                    );
                    continue;
                }

                const measurements = measureBenchmarkContent(
                    result.value.markdown,
                    source.anchors,
                );
                successfulMarkdown.set(
                    `${source.id}:${provider}`,
                    measurements.normalizedMarkdown,
                );
                const observation: RetrievalObservation = {
                    anchorCoverage: measurements.anchorCoverage,
                    anchorMatches: measurements.anchorMatches,
                    attempts: result.attempts,
                    characterCount: measurements.characterCount,
                    clientVersion,
                    cost: result.value.cost,
                    finalUrl: result.value.finalUrl,
                    inputUrl: source.url,
                    latencyMs,
                    nativeHash: measurements.nativeHash,
                    normalizedHash: measurements.normalizedHash,
                    provider,
                    requestId: result.value.requestId,
                    sourceClass: source.sourceClass,
                    sourceId: source.id,
                    status: "succeeded",
                    statusCode: result.value.statusCode,
                    title: result.value.title,
                    wordCount: measurements.wordCount,
                };
                observations.push(observation);
                await writeFile(
                    join(rawDirectory, `${source.id}-${provider}.json`),
                    `${JSON.stringify(result.value.providerPayload, null, 2)}\n`,
                    "utf8",
                );
            }
        }

        const blindMap = [];
        const scorecard = [];
        for (const source of RETRIEVAL_BENCHMARK_CORPUS) {
            const exaMarkdown =
                successfulMarkdown.get(`${source.id}:exa`) ??
                "[Retrieval failed: no content returned]";
            const firecrawlMarkdown =
                successfulMarkdown.get(`${source.id}:firecrawl`) ??
                "[Retrieval failed: no content returned]";
            const exaIsA =
                Number.parseInt(hashBenchmarkText(source.id)[0] ?? "0", 16) %
                    2 ===
                0;
            const candidateA = exaIsA ? exaMarkdown : firecrawlMarkdown;
            const candidateB = exaIsA ? firecrawlMarkdown : exaMarkdown;
            await writeFile(
                join(reviewDirectory, `${source.id}-a.md`),
                candidateA,
                "utf8",
            );
            await writeFile(
                join(reviewDirectory, `${source.id}-b.md`),
                candidateB,
                "utf8",
            );
            blindMap.push({
                candidateA: exaIsA ? "exa" : "firecrawl",
                candidateB: exaIsA ? "firecrawl" : "exa",
                sourceId: source.id,
            });
            scorecard.push({
                candidateA: emptyManualScore(),
                candidateB: emptyManualScore(),
                sourceId: source.id,
                title: source.title,
                url: source.url,
            });
        }

        const creditAfter = parseFirecrawlCreditUsage(
            (await runCommand("firecrawl", ["credit-usage", "--json"])).stdout,
        );
        await writeFile(
            join(outputDirectory, "observations.json"),
            `${JSON.stringify(observations, null, 2)}\n`,
            "utf8",
        );
        await writeFile(
            join(outputDirectory, "blind-provider-map.json"),
            `${JSON.stringify(blindMap, null, 2)}\n`,
            "utf8",
        );
        await writeFile(
            join(outputDirectory, "blind-scorecard.json"),
            `${JSON.stringify(scorecard, null, 2)}\n`,
            "utf8",
        );
        const failures = observations.filter(
            ({ status }) => status === "failed",
        );
        const collectionStatus =
            failures.length === 0 ? "complete" : "incomplete";
        await writeFile(
            join(outputDirectory, "run.json"),
            `${JSON.stringify(
                {
                    completedAt: new Date().toISOString(),
                    collectionStatus,
                    failedObservationCount: failures.length,
                    semanticReviewStatus: "awaiting_manual_labels",
                    corpusSize: RETRIEVAL_BENCHMARK_CORPUS.length,
                    creditAfter,
                    creditBefore,
                    firecrawlCreditsConsumed: creditBefore - creditAfter,
                    observationCount: observations.length,
                },
                null,
                2,
            )}\n`,
            "utf8",
        );

        expect(observations).toHaveLength(
            RETRIEVAL_BENCHMARK_CORPUS.length * 2,
        );
        console.info(
            "LIVE_PROVIDER_EVIDENCE",
            JSON.stringify({
                collectionStatus,
                semanticReviewStatus: "awaiting_manual_labels",
                corpusSize: RETRIEVAL_BENCHMARK_CORPUS.length,
                firecrawlCreditsConsumed: creditBefore - creditAfter,
                observationCount: observations.length,
                outputDirectory,
                provider: "exa-vs-firecrawl-retrieval-benchmark",
            }),
        );
        expect(
            failures,
            `Incomplete collection; inspect ${outputDirectory}`,
        ).toEqual([]);
    },
    30 * 60 * 1_000,
);

function emptyManualScore() {
    return {
        completeness: null,
        noiseAbsence: null,
        notes: "",
        relocalizability: null,
        structure: null,
    };
}

function runCommand(
    command: string,
    args: string[],
    timeout = EXTERNAL_TIMEOUT_MS,
): Promise<{ stderr: string; stdout: string }> {
    return new Promise((resolve, reject) => {
        execFile(
            command,
            args,
            {
                encoding: "utf8",
                maxBuffer: MAX_COMMAND_BUFFER_BYTES,
                timeout,
            },
            (error, stdout, stderr) => {
                if (error) {
                    const commandError = new Error(
                        `${error.message}${stderr ? `: ${stderr}` : ""}`,
                    );
                    Object.assign(commandError, {
                        code: error.code,
                        killed: error.killed,
                    });
                    reject(commandError);
                    return;
                }
                resolve({ stderr, stdout });
            },
        );
    });
}

function statusFromExaResponse(
    statuses: Array<{ status: string }> | undefined,
): number | undefined {
    const status = statuses?.[0]?.status;
    if (!status) {
        return undefined;
    }
    const numericStatus = Number(status);
    return Number.isFinite(numericStatus) ? numericStatus : undefined;
}
