/**
 * Cascade resolver for a company's marketing/customer website URL.
 *
 * Layered architecture: this is a pure function that takes its dependencies
 * (the Exa client adapter and the SEC-IR classifier) as injected arguments.
 * Convex wiring in `companyResolution.ts` builds these deps; tests inject
 * mocks. No Exa-specific types leak out — the only types exported here are
 * domain shapes (`WebsiteResolution`).
 *
 * Cascade order (cheapest first):
 *   1. SEC `investorWebsite`, accepted only when `classifyIr` returns it
 *      (i.e. it is not an IR-vendor subdomain).
 *   2. Exa `category: 'company'` search — semantic index returns the real
 *      homepage even for renamed/hyphenated/non-`.com` companies. Picks the
 *      best candidate via `pickBestExaCompanyResult`.
 *   3. `null` — honest "we could not resolve". The UI renders the building
 *      icon fallback.
 */

export type WebsiteSource = 'sec_ir' | 'exa' | 'probe';

export type WebsiteResolution = {
    url: string;
    source: WebsiteSource;
};

/** Normalized Exa result shape after the adapter strips provider-specific data. */
export type ExaCompanyCandidate = {
    url: string;
    /** Entity name returned by Exa's structured company data, or page title. */
    entityName: string;
};

/** Injected HTTP-level Exa search. The adapter in exa.ts builds this. */
export type ExaCompanySearch = (
    query: string,
) => Promise<ReadonlyArray<ExaCompanyCandidate>>;

/** Injected SEC-IR classifier. Twin of `classifyIrAsWebsite` from sec.ts. */
export type ClassifyIrUrl = (
    investorRelationsUrl: string | undefined,
) => string | undefined;

const AGGREGATOR_DOMAINS = new Set([
    'wikipedia.org',
    'wikimedia.org',
    'crunchbase.com',
    'linkedin.com',
    'bloomberg.com',
    'reuters.com',
    'forbes.com',
    'glassdoor.com',
    'indeed.com',
    'yahoo.com',
    'marketwatch.com',
    'stockanalysis.com',
    'macrotrends.net',
    'businessinsider.com',
    'wsj.com',
    'sec.gov',
    'nyse.com',
    'nasdaq.com',
]);

function parseHostname(url: string): string | null {
    try {
        return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    } catch {
        return null;
    }
}

function bosslessDomain(hostname: string): string {
    const parts = hostname.split('.');
    if (parts.length <= 2) {
        return hostname;
    }
    return parts.slice(-2).join('.');
}

function isAggregator(hostname: string | null): boolean {
    if (!hostname) {
        return true;
    }
    const root = bosslessDomain(hostname);
    return AGGREGATOR_DOMAINS.has(root) || AGGREGATOR_DOMAINS.has(hostname);
}

function pathDepth(url: string): number {
    try {
        const u = new URL(url);
        const segments = u.pathname.split('/').filter(Boolean);
        return segments.length;
    } catch {
        return Number.POSITIVE_INFINITY;
    }
}

function normalizeForMatch(value: string): Set<string> {
    return new Set(
        value
            .toLowerCase()
            .replace(/[.,&!"?()[\]']/g, ' ')
            .replace(/inc|corp|corporation|holdings|limited|ltd|co\b/g, ' ')
            .split(/\s+/)
            .filter((token) => token.length > 1),
    );
}

/**
 * Scores an Exa candidate against the company's legal name. Returns a number
 * where higher is better, or `null` when the candidate should be discarded
 * outright (aggregator host, no token overlap).
 */
function scoreCandidate(
    candidate: ExaCompanyCandidate,
    legalNameTokens: Set<string>,
    ticker: string,
): number | null {
    const hostname = parseHostname(candidate.url);
    if (isAggregator(hostname)) {
        return null;
    }
    const entityTokens = normalizeForMatch(candidate.entityName);
    if (legalNameTokens.size === 0) {
        return null;
    }
    let overlap = 0;
    for (const token of legalNameTokens) {
        if (entityTokens.has(token)) {
            overlap += 1;
        }
    }
    const overlapRatio = overlap / legalNameTokens.size;
    if (overlapRatio === 0) {
        return null;
    }
    const tickerBonus = entityTokens.has(ticker.toLowerCase()) ? 0.05 : 0;
    const rootPathBonus = pathDepth(candidate.url) === 0 ? 0.02 : 0;
    return overlapRatio + tickerBonus + rootPathBonus;
}

/**
 * Picks the best Exa candidate for a company's marketing homepage. Scoring
 * balances legal-name/token overlap, ticker hint, and root-path preference,
 * while rejecting aggregator domains outright. Returns `undefined` when no
 * candidate clears a minimum confidence threshold.
 */
export function pickBestExaCompanyResult(
    candidates: ReadonlyArray<ExaCompanyCandidate>,
    company: { legalName: string; ticker: string },
): ExaCompanyCandidate | undefined {
    const legalNameTokens = normalizeForMatch(company.legalName);
    let best: { candidate: ExaCompanyCandidate; score: number } | undefined;
    for (const candidate of candidates) {
        const score = scoreCandidate(
            candidate,
            legalNameTokens,
            company.ticker,
        );
        if (score === null) {
            continue;
        }
        if (best === undefined || score > best.score) {
            best = { candidate, score };
        }
    }
    const MINIMUM_SCORE_THRESHOLD = 0.5;
    if (best === undefined || best.score < MINIMUM_SCORE_THRESHOLD) {
        return undefined;
    }
    return best.candidate;
}

/**
 * Decides whether a candidate URL should be canonicalized before persisting
 * as the company website. Strips trailing path segments when the URL points
 * to the homepage (depth 0 or 1 with a non-meaningful segment), keeps
 * otherwise. Always strips hash and port per the public-HTTPS contract.
 */
function canonicalizeWebsiteUrl(url: string): string {
    const parsed = new URL(url);
    parsed.hash = '';
    parsed.port = '';
    // Prefer the bare host as the canonical website: favicons resolve from
    // the hostname regardless of path, and a root URL is the most stable
    // bookmark. Deep paths like /early-careers pass through unchanged.
    if (pathDepth(parsed.toString()) <= 1) {
        parsed.pathname = '/';
    }
    return parsed.toString();
}

/**
 * Resolves the marketing website URL for a company. See module docstring for
 * the cascade rationale.
 *
 * Errors from the Exa adapter are swallowed and treated as "no result": a
 * transient provider failure must not break preflight. The auditor can spot a
 * persistent failure via the `providerCalls` records.
 */
export async function resolveWebsiteUrl(
    company: {
        legalName: string;
        ticker: string;
        investorRelationsUrl?: string;
    },
    deps: {
        exaSearch: ExaCompanySearch;
        classifyIr: ClassifyIrUrl;
    },
): Promise<WebsiteResolution | null> {
    const secWebsite = deps.classifyIr(company.investorRelationsUrl);
    if (secWebsite) {
        return { url: secWebsite, source: 'sec_ir' };
    }

    const query = `${company.legalName} official website`;
    let results: ReadonlyArray<ExaCompanyCandidate>;
    try {
        results = await deps.exaSearch(query);
    } catch {
        return null;
    }
    const best = pickBestExaCompanyResult(results, company);
    if (!best) {
        return null;
    }
    return { url: canonicalizeWebsiteUrl(best.url), source: 'exa' };
}
