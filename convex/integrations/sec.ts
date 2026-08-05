import type {
    SecCompanyMatch,
    SecCompanyResolver,
} from '@convex/companyResolution';
import Fuse from 'fuse.js';

type ProviderAttempt = {
    operation: 'resolve_company' | 'revalidate_company';
    operationKey: string;
    status: 'started' | 'succeeded' | 'failed';
    attempt: number;
    latencyMs?: number;
    errorCode?: string;
};

type SecCompanyResolverDependencies = {
    fetch: typeof globalThis.fetch;
    now: () => number;
    userAgent: string;
    reserveRequest: () => Promise<void>;
    recordAttempt: (
        attempt: ProviderAttempt,
    ) => Promise<{ shouldExecute: boolean }>;
    operationScope?: string;
};

const MAX_SEC_ATTEMPTS = 2;
const MAX_COMPANY_SEARCH_RESULTS = 8;
const MAX_FUZZY_COMPANY_SCORE = 0.45;

class SecRetryableError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'SecRetryableError';
    }
}

type CompanyIndexEntry = {
    cik: string;
    legalName: string;
    ticker: string;
    exchange: string;
};

export type SecEvidenceSnapshot = {
    company: SecCompanyMatch;
    filingCount: number;
    filings: ReadonlyArray<{
        accessionNumber: string;
        form?: string;
        filingDate?: string;
        primaryDocument?: string;
    }>;
};

export type SecCompanyEvidenceResolver = SecCompanyResolver & {
    inspectEvidence(cik: string): Promise<SecEvidenceSnapshot>;
};

function normalizeCik(value: string | number): string {
    return String(value).replace(/^0+/, '') || '0';
}

function normalizeExchange(value: string): string {
    return value.trim().toUpperCase();
}

function normalizeSearchText(value: string): string {
    return value
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .replace(/\s+/g, ' ');
}

function deterministicSearchScore(
    entry: CompanyIndexEntry,
    normalizedQuery: string,
    searchedCik: string | null,
): number | null {
    const normalizedName = normalizeSearchText(entry.legalName);
    const normalizedTicker = entry.ticker.toLowerCase();
    if (entry.cik === searchedCik) {
        return 0;
    }
    if (normalizedTicker === normalizedQuery) {
        return 1;
    }
    if (normalizedName === normalizedQuery) {
        return 2;
    }
    if (normalizedName.startsWith(normalizedQuery)) {
        return 3;
    }
    if (normalizedTicker.startsWith(normalizedQuery)) {
        return 4;
    }
    if (normalizedName.includes(normalizedQuery)) {
        return 5;
    }
    return null;
}

function extractCikSearch(query: string): string | null {
    const trimmedQuery = query.trim();
    if (/^\d+$/.test(trimmedQuery)) {
        return normalizeCik(trimmedQuery);
    }

    try {
        const url = new URL(trimmedQuery);
        if (
            url.protocol !== 'https:' ||
            !(url.hostname === 'sec.gov' || url.hostname.endsWith('.sec.gov'))
        ) {
            return null;
        }
        const cikParameter = url.searchParams.get('CIK');
        const pathCik =
            /\/data\/0*(\d+)(?:\/|$)/i.exec(url.pathname)?.[1] ??
            /CIK0*(\d+)/i.exec(url.pathname)?.[1];
        const cik = cikParameter ?? pathCik;
        return cik && /^\d+$/.test(cik) ? normalizeCik(cik) : null;
    } catch {
        return null;
    }
}

function parseCompanyIndex(value: unknown): ReadonlyArray<CompanyIndexEntry> {
    if (
        typeof value !== 'object' ||
        value === null ||
        !('fields' in value) ||
        !Array.isArray(value.fields) ||
        !('data' in value) ||
        !Array.isArray(value.data)
    ) {
        throw new Error('SEC company index response is invalid');
    }
    const fields = value.fields;
    const cikIndex = fields.indexOf('cik');
    const nameIndex = fields.indexOf('name');
    const tickerIndex = fields.indexOf('ticker');
    const exchangeIndex = fields.indexOf('exchange');
    if ([cikIndex, nameIndex, tickerIndex, exchangeIndex].includes(-1)) {
        throw new Error('SEC company index fields are incomplete');
    }

    return value.data.flatMap((row): ReadonlyArray<CompanyIndexEntry> => {
        if (!Array.isArray(row)) {
            return [];
        }
        const cik = row[cikIndex];
        const legalName = row[nameIndex];
        const ticker = row[tickerIndex];
        const exchange = row[exchangeIndex];
        if (
            (typeof cik !== 'string' && typeof cik !== 'number') ||
            typeof legalName !== 'string' ||
            typeof ticker !== 'string' ||
            typeof exchange !== 'string'
        ) {
            return [];
        }
        return [
            {
                cik: normalizeCik(cik),
                legalName,
                ticker: ticker.toUpperCase(),
                exchange: normalizeExchange(exchange),
            },
        ];
    });
}

const IR_SUBDOMAIN_PREFIXES = ['investor.', 'investors.', 'ir.'];
const IR_VENDOR_HOSTS = new Set(['q4ir.com', 'q4inc.com', 'nasdaqomx.com']);

/**
 * Decides whether a SEC `investorWebsite` URL can double as the company's
 * marketing/customer website. Returns the URL only when it is HTTPS, hosted on
 * a non-IR subdomain, and not on a known IR-vendor host (q4ir, q4inc,
 * nasdaqomx). Otherwise returns `undefined` so the website cascade can move on
 * to Exa / HEAD-probe / fallback.
 *
 * Note: this is a conservative filter. Some companies host their IR page on a
 * /investors path of the root domain (e.g. acme.com/investors); those are
 * accepted as the marketing website, since the host is the company root.
 */
export function classifyIrAsWebsite(
    investorRelationsUrl: string | undefined,
): string | undefined {
    if (!investorRelationsUrl) {
        return undefined;
    }
    let url: URL;
    try {
        url = new URL(investorRelationsUrl);
    } catch {
        return undefined;
    }
    if (url.protocol !== 'https:') {
        return undefined;
    }
    const hostname = url.hostname.toLowerCase();
    if (IR_SUBDOMAIN_PREFIXES.some((prefix) => hostname.startsWith(prefix))) {
        return undefined;
    }
    const bosslessHost = hostname.replace(/^www\./, '');
    const baseDomain = bosslessHost.split('.').slice(-2).join('.');
    if (IR_VENDOR_HOSTS.has(baseDomain) || IR_VENDOR_HOSTS.has(bosslessHost)) {
        return undefined;
    }
    return investorRelationsUrl;
}

function parseSubmission(value: unknown): SecCompanyMatch {
    if (
        typeof value !== 'object' ||
        value === null ||
        !('cik' in value) ||
        (typeof value.cik !== 'string' && typeof value.cik !== 'number') ||
        !('name' in value) ||
        typeof value.name !== 'string' ||
        !('tickers' in value) ||
        !Array.isArray(value.tickers) ||
        typeof value.tickers[0] !== 'string' ||
        !('exchanges' in value) ||
        !Array.isArray(value.exchanges) ||
        typeof value.exchanges[0] !== 'string'
    ) {
        throw new Error('SEC company submission response is invalid');
    }
    const investorRelationsUrl =
        'investorWebsite' in value &&
        typeof value.investorWebsite === 'string' &&
        value.investorWebsite.length > 0
            ? value.investorWebsite
            : undefined;
    // Today: SEC IR url doubles as the marketing website only when it isn't an
    // IR-vendor subdomain (investor./ir./q4ir./…). The Exa + HEAD-probe
    // cascade is the next slice and will populate websiteUrl for the long
    // tail of companies whose SEC IR url is a vendor subdomain.
    const websiteUrl = classifyIrAsWebsite(investorRelationsUrl);
    return {
        cik: normalizeCik(value.cik),
        legalName: value.name,
        ticker: value.tickers[0].toUpperCase(),
        exchange: normalizeExchange(value.exchanges[0]),
        investorRelationsUrl,
        websiteUrl,
        websiteUrlSource: websiteUrl ? 'sec_ir' : undefined,
    };
}

function parseEvidenceSnapshot(value: unknown): SecEvidenceSnapshot {
    const company = parseSubmission(value);
    const recent =
        typeof value === 'object' &&
        value !== null &&
        'filings' in value &&
        typeof value.filings === 'object' &&
        value.filings !== null &&
        'recent' in value.filings &&
        typeof value.filings.recent === 'object' &&
        value.filings.recent !== null
            ? value.filings.recent
            : undefined;
    const accessionNumbers =
        recent &&
        'accessionNumber' in recent &&
        Array.isArray(recent.accessionNumber)
            ? recent.accessionNumber
            : [];
    const forms =
        recent && 'form' in recent && Array.isArray(recent.form)
            ? recent.form
            : [];
    const filingDates =
        recent && 'filingDate' in recent && Array.isArray(recent.filingDate)
            ? recent.filingDate
            : [];
    const primaryDocuments =
        recent &&
        'primaryDocument' in recent &&
        Array.isArray(recent.primaryDocument)
            ? recent.primaryDocument
            : [];
    const filings = accessionNumbers.flatMap((entry, index) =>
        typeof entry === 'string' && entry.length > 0
            ? [
                  {
                      accessionNumber: entry,
                      form:
                          typeof forms[index] === 'string'
                              ? forms[index]
                              : undefined,
                      filingDate:
                          typeof filingDates[index] === 'string'
                              ? filingDates[index]
                              : undefined,
                      primaryDocument:
                          typeof primaryDocuments[index] === 'string'
                              ? primaryDocuments[index]
                              : undefined,
                  },
              ]
            : [],
    );
    return {
        company,
        filingCount: filings.length,
        filings,
    };
}

/**
 * Creates the SEC transport adapter. It maps provider JSON into application
 * types and delegates rate limiting and attempt persistence to the Action.
 */
export function createSecCompanyResolver(
    dependencies: SecCompanyResolverDependencies,
): SecCompanyEvidenceResolver {
    async function requestJson(
        operation: ProviderAttempt['operation'],
        url: string,
    ): Promise<unknown> {
        const operationKey = `${dependencies.operationScope ?? 'sec'}:${operation}:${url}`;
        for (let attempt = 1; attempt <= MAX_SEC_ATTEMPTS; attempt += 1) {
            await dependencies.reserveRequest();
            const startedAt = dependencies.now();
            const lease = await dependencies.recordAttempt({
                operation,
                operationKey,
                status: 'started',
                attempt,
            });
            if (!lease.shouldExecute) {
                throw new Error('SEC provider attempt was already recorded');
            }
            try {
                const response = await dependencies.fetch(url, {
                    headers: {
                        Accept: 'application/json',
                        'User-Agent': dependencies.userAgent,
                    },
                });
                if (!response.ok) {
                    if (response.status === 429 || response.status >= 500) {
                        throw new SecRetryableError(
                            `SEC request failed with ${response.status}`,
                        );
                    }
                    throw new Error(
                        `SEC request failed with ${response.status}`,
                    );
                }
                const value: unknown = await response.json();
                await dependencies.recordAttempt({
                    operation,
                    operationKey,
                    status: 'succeeded',
                    attempt,
                    latencyMs: Math.max(0, dependencies.now() - startedAt),
                });
                return value;
            } catch (error) {
                await dependencies.recordAttempt({
                    operation,
                    operationKey,
                    status: 'failed',
                    attempt,
                    latencyMs: Math.max(0, dependencies.now() - startedAt),
                    errorCode:
                        error instanceof Error
                            ? error.name
                            : 'UnknownProviderError',
                });
                const retryable =
                    error instanceof TypeError ||
                    error instanceof SecRetryableError;
                if (!retryable || attempt === MAX_SEC_ATTEMPTS) {
                    throw error;
                }
            }
        }
        throw new Error('SEC request exhausted its retry budget');
    }

    async function inspectEvidence(cik: string): Promise<SecEvidenceSnapshot> {
        const paddedCik = normalizeCik(cik).padStart(10, '0');
        const value = await requestJson(
            'revalidate_company',
            `https://data.sec.gov/submissions/CIK${paddedCik}.json`,
        );
        return parseEvidenceSnapshot(value);
    }

    async function revalidate(cik: string): Promise<SecCompanyMatch> {
        return (await inspectEvidence(cik)).company;
    }

    return {
        async search(query) {
            const value = await requestJson(
                'resolve_company',
                'https://www.sec.gov/files/company_tickers_exchange.json',
            );
            const normalizedQuery = normalizeSearchText(query);
            const searchedCik = extractCikSearch(query);
            const companies = parseCompanyIndex(value);
            const deterministicMatches = companies
                .flatMap((entry) => {
                    const score = deterministicSearchScore(
                        entry,
                        normalizedQuery,
                        searchedCik,
                    );
                    return score === null ? [] : [{ score, company: entry }];
                })
                .sort(
                    (left, right) =>
                        left.score - right.score ||
                        left.company.legalName.localeCompare(
                            right.company.legalName,
                        ),
                );
            if (deterministicMatches.length > 0) {
                return deterministicMatches
                    .slice(0, MAX_COMPANY_SEARCH_RESULTS)
                    .map(({ company }) => ({
                        ...company,
                        investorRelationsUrl: undefined,
                        websiteUrl: undefined,
                        websiteUrlSource: undefined,
                    }));
            }

            const fuzzyMatches = new Fuse(companies, {
                keys: ['legalName'],
                includeScore: true,
                threshold: 0.3,
                ignoreLocation: true,
                ignoreDiacritics: true,
                minMatchCharLength: 2,
                useTokenSearch: true,
                tokenMatch: 'all',
            })
                .search(normalizedQuery, {
                    limit: MAX_COMPANY_SEARCH_RESULTS,
                })
                .filter(
                    ({ score }) =>
                        score !== undefined && score <= MAX_FUZZY_COMPANY_SCORE,
                )
                .map(({ item }) => item);

            return fuzzyMatches.map((company) => ({
                ...company,
                investorRelationsUrl: undefined,
                websiteUrl: undefined,
                websiteUrlSource: undefined,
            }));
        },
        revalidate,
        inspectEvidence,
    };
}
