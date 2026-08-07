import { createHash } from "node:crypto";

export function normalizeBenchmarkMarkdown(markdown: string): string {
    return markdown
        .normalize("NFKC")
        .replace(/\r\n?/g, "\n")
        .split("\n")
        .map((line) => line.replace(/[\t ]+$/g, ""))
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

export function hashBenchmarkText(text: string): string {
    return createHash("sha256").update(text).digest("hex");
}

export type BenchmarkContentMeasurements = {
    anchorCoverage: number;
    anchorMatches: boolean[];
    characterCount: number;
    nativeHash: string;
    normalizedHash: string;
    normalizedMarkdown: string;
    wordCount: number;
};

export function measureBenchmarkContent(
    markdown: string,
    anchors: readonly string[],
): BenchmarkContentMeasurements {
    const normalizedMarkdown = normalizeBenchmarkMarkdown(markdown);
    const searchable = normalizedMarkdown.toLocaleLowerCase("en-US");
    const anchorMatches = anchors.map((anchor) =>
        searchable.includes(
            normalizeBenchmarkMarkdown(anchor).toLocaleLowerCase("en-US"),
        ),
    );
    const matchedAnchorCount = anchorMatches.filter(Boolean).length;
    const words = normalizedMarkdown.match(
        /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu,
    );

    return {
        anchorCoverage:
            anchors.length === 0 ? 0 : matchedAnchorCount / anchors.length,
        anchorMatches,
        characterCount: normalizedMarkdown.length,
        nativeHash: hashBenchmarkText(markdown),
        normalizedHash: hashBenchmarkText(normalizedMarkdown),
        normalizedMarkdown,
        wordCount: words?.length ?? 0,
    };
}

export type RetrievalScore = 0 | 1 | 2;

export type ManualRetrievalScores = {
    completeness: RetrievalScore;
    noiseAbsence: RetrievalScore;
    relocalizability: RetrievalScore;
    structure: RetrievalScore;
};

export type RetrievalClassification = "partial" | "unusable" | "usable";

export function classifyRetrieval(input: {
    error?: string;
    markdown: string;
    scores: ManualRetrievalScores;
}): RetrievalClassification {
    if (
        input.error ||
        normalizeBenchmarkMarkdown(input.markdown).length === 0
    ) {
        return "unusable";
    }
    if (Object.values(input.scores).some((score) => score === 0)) {
        return "unusable";
    }
    if (
        input.scores.completeness === 2 &&
        input.scores.relocalizability === 2
    ) {
        return "usable";
    }
    return "partial";
}

type ProviderDecisionInput = {
    anchorCoverage: number;
    classification: RetrievalClassification;
    relocalizability: RetrievalScore;
};

export type RetrievalDecisionPair = {
    exa: ProviderDecisionInput;
    firecrawl: ProviderDecisionInput;
    sourceId: string;
};

export function recommendFirecrawlFallback(rows: RetrievalDecisionPair[]): {
    materialWinSourceIds: string[];
    materialWins: number;
    recommend: boolean;
} {
    const materialWinSourceIds = rows
        .filter(
            ({ exa, firecrawl }) =>
                firecrawl.classification === "usable" &&
                exa.classification !== "usable" &&
                firecrawl.anchorCoverage >= exa.anchorCoverage &&
                firecrawl.relocalizability >= exa.relocalizability,
        )
        .map(({ sourceId }) => sourceId);

    return {
        materialWinSourceIds,
        materialWins: materialWinSourceIds.length,
        recommend: materialWinSourceIds.length >= 2,
    };
}

export function assertBenchmarkOptIn(env: NodeJS.ProcessEnv): void {
    if (env.RUN_LIVE_PROVIDER_TESTS !== "1") {
        throw new Error(
            "RUN_LIVE_PROVIDER_TESTS=1 is required for the retrieval benchmark",
        );
    }
    if (env.RUN_RETRIEVAL_BENCHMARK !== "1") {
        throw new Error(
            "RUN_RETRIEVAL_BENCHMARK=1 is required for the retrieval benchmark",
        );
    }
}

export function parseFirecrawlCreditUsage(rawJson: string): number {
    const parsed: unknown = JSON.parse(rawJson);
    if (
        !isRecord(parsed) ||
        parsed.success !== true ||
        !isRecord(parsed.data)
    ) {
        throw new Error("Firecrawl authentication or credit preflight failed");
    }
    const remainingCredits = parsed.data.remainingCredits;
    if (
        typeof remainingCredits !== "number" ||
        !Number.isFinite(remainingCredits)
    ) {
        throw new Error("Firecrawl did not report a valid credit balance");
    }
    return remainingCredits;
}

export function assertMinimumFirecrawlCredits(
    remainingCredits: number,
    minimumCredits = 20,
): void {
    if (remainingCredits < minimumCredits) {
        throw new Error(
            `At least ${minimumCredits} Firecrawl credits are required before benchmark calls`,
        );
    }
}

export type ParsedFirecrawlScrape = {
    finalUrl?: string;
    markdown: string;
    requestId?: string;
    statusCode?: number;
    title?: string;
};

export function parseFirecrawlScrapeResponse(
    rawJson: string,
): ParsedFirecrawlScrape {
    const parsed: unknown = JSON.parse(rawJson);
    if (!isRecord(parsed) || typeof parsed.markdown !== "string") {
        throw new Error("Firecrawl scrape response did not include Markdown");
    }
    const metadata = isRecord(parsed.metadata) ? parsed.metadata : {};
    const finalUrl =
        readStringProperty(metadata, "url") ??
        readStringProperty(metadata, "sourceURL");
    const requestId = readStringProperty(metadata, "scrapeId");
    const statusCode = readNumericProperty(metadata, "statusCode");
    const title = readStringProperty(metadata, "title");

    return {
        ...(finalUrl ? { finalUrl } : {}),
        markdown: parsed.markdown,
        ...(requestId ? { requestId } : {}),
        ...(statusCode !== undefined ? { statusCode } : {}),
        ...(title ? { title } : {}),
    };
}

export function isRetryableRetrievalError(error: unknown): boolean {
    const statusCode = readNumericProperty(error, "statusCode");
    if (
        statusCode === 408 ||
        statusCode === 429 ||
        (statusCode !== undefined && statusCode >= 500)
    ) {
        return true;
    }

    const code = readStringProperty(error, "code")?.toUpperCase();
    if (
        code &&
        ["ECONNRESET", "ECONNREFUSED", "ENETUNREACH", "ETIMEDOUT"].includes(
            code,
        )
    ) {
        return true;
    }

    const message = error instanceof Error ? error.message : String(error);
    return /\b(?:408|429|5\d\d)\b|timed? ?out|timeout|network|socket hang up/i.test(
        message,
    );
}

export async function runWithBoundedRetry<T>(
    operation: () => Promise<T>,
    maxAttempts = 2,
): Promise<{ attempts: number; error?: string; value?: T }> {
    let lastError: unknown;
    let attempts = 0;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        attempts = attempt;
        try {
            return { attempts, value: await operation() };
        } catch (error) {
            lastError = error;
            if (attempt === maxAttempts || !isRetryableRetrievalError(error)) {
                break;
            }
        }
    }
    return {
        attempts,
        error: formatBenchmarkError(lastError),
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function readNumericProperty(value: unknown, key: string): number | undefined {
    if (!isRecord(value)) {
        return undefined;
    }
    const property = value[key];
    return typeof property === "number" ? property : undefined;
}

function readStringProperty(value: unknown, key: string): string | undefined {
    if (!isRecord(value)) {
        return undefined;
    }
    const property = value[key];
    return typeof property === "string" ? property : undefined;
}

function formatBenchmarkError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return message.replace(/[\r\n]+/g, " ").slice(0, 500);
}
