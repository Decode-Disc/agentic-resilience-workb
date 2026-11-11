"use node";

import { lookup } from "node:dns/promises";
import {
    PublicSourceUrlError,
    validatePublicSourceUrl,
} from "@convex/domain/publicSourceUrl";
import {
    extractPdfPassagesFromPages,
    preparePassageReproduction,
    sha256Hex,
} from "@convex/domain/sourcePassages";
import type {
    ApprovedSourceRetrievalInput,
    ApprovedSourceRetrievalResult,
    SourceDocumentRetrievalInput,
} from "@convex/integrations/approvedSourceRetrieval";
import {
    normalizePdfPages,
    PDF_NORMALIZER_VERSION,
} from "@convex/integrations/evidenceNormalization";
import {
    MAX_APPROVED_SOURCE_BYTES,
    MAX_PDF_ATTEMPTS,
    MAX_PDF_PAGES,
    MAX_REDIRECTS,
    PDF_REQUEST_TIMEOUT_MS,
} from "@convex/resourcePolicy";
import { requestPinnedPublicSource } from "@convex/sourceActions";

export const PDF_RETRIEVAL_VERSION = "pdf-direct-v1";

export type PdfFixtureDefinition = {
    bytes: Uint8Array | string;
    pages: Array<{
        pageNumber: number;
        text: string;
        headingPath?: string[];
    }>;
    /** Optional deterministic acquisition limitation: count of pages whose text could not be extracted (e.g. scanned without OCR). */
    ocrUnavailablePages?: number;
};

const pdfFixtureRegistry = new Map<string, PdfFixtureDefinition>();

export function registerPdfFixture(
    keyOrDef: string | PdfFixtureDefinition,
    definition?: PdfFixtureDefinition,
): void {
    const def = typeof keyOrDef === "string" ? definition : keyOrDef;
    if (!def) {
        throw new Error("PdfFixtureDefinition is required");
    }
    const bytes =
        typeof def.bytes === "string"
            ? new TextEncoder().encode(def.bytes)
            : def.bytes;
    const hash = sha256Hex(bytes);
    pdfFixtureRegistry.set(hash, {
        bytes,
        pages: def.pages,
        ocrUnavailablePages: def.ocrUnavailablePages,
    });
}

export function clearPdfFixtures(): void {
    pdfFixtureRegistry.clear();
}

export function lookupPdfFixture(
    pdfBytes: Uint8Array,
): PdfFixtureDefinition | null {
    const hash = sha256Hex(pdfBytes);
    return pdfFixtureRegistry.get(hash) ?? null;
}

export type PublicPdfResolverDependencies = {
    beforeResolve?: () => Promise<void>;
    resolveAddresses?: (hostname: string) => Promise<ReadonlyArray<string>>;
    request?: typeof requestPinnedPublicSource;
    recordAttempt?: (attempt: {
        operation: string;
        operationKey: string;
        status: "started" | "succeeded" | "failed";
        attempt: number;
        latencyMs?: number;
        errorCode?: string;
    }) => Promise<{ shouldExecute: boolean }>;
    operationScope?: string;
    now?: () => number;
    timeoutMs?: number;
};

export class PdfRetrievalError extends Error {
    readonly errorCode: string;
    constructor(message: string, errorCode = "PdfRetrievalError") {
        super(message);
        this.name = "PdfRetrievalError";
        this.errorCode = errorCode;
    }
}

function isRetryablePdfError(error: unknown): boolean {
    if (error && typeof error === "object") {
        const errorObj = error as Record<string, unknown>;
        const causeObj =
            errorObj.cause && typeof errorObj.cause === "object"
                ? (errorObj.cause as Record<string, unknown>)
                : undefined;
        const status =
            typeof errorObj.status === "number"
                ? errorObj.status
                : typeof errorObj.statusCode === "number"
                  ? errorObj.statusCode
                  : typeof causeObj?.status === "number"
                    ? causeObj.status
                    : typeof causeObj?.statusCode === "number"
                      ? causeObj.statusCode
                      : undefined;
        if (typeof status === "number") {
            return (
                status === 408 ||
                status === 429 ||
                (status >= 500 && status <= 599)
            );
        }
        const code =
            typeof errorObj.code === "string"
                ? errorObj.code
                : typeof causeObj?.code === "string"
                  ? causeObj.code
                  : undefined;
        if (
            code &&
            [
                "ECONNRESET",
                "ETIMEDOUT",
                "ECONNREFUSED",
                "EAI_AGAIN",
                "ENOTFOUND",
                "UND_ERR_CONNECT_TIMEOUT",
                "UND_ERR_SOCKET",
            ].includes(code)
        ) {
            return true;
        }
    }
    if (error instanceof Error) {
        if (error.name === "AbortError" || error.name === "TimeoutError") {
            return true;
        }
        if (error instanceof PdfRetrievalError) {
            if (
                error.errorCode === "http_408" ||
                error.errorCode === "http_429" ||
                /^http_5\d{2}$/.test(error.errorCode) ||
                error.errorCode === "timeout" ||
                error.errorCode === "network_error"
            ) {
                return true;
            }
        }
    }
    return false;
}

export async function retrieveAndNormalizePublicPdf(
    deps: PublicPdfResolverDependencies,
    input: SourceDocumentRetrievalInput | ApprovedSourceRetrievalInput,
): Promise<ApprovedSourceRetrievalResult> {
    const resolveAddresses =
        deps.resolveAddresses ??
        (async (hostname: string) => {
            const records = await lookup(hostname, {
                all: true,
                verbatim: true,
            });
            return records.map((record) => record.address);
        });

    const request = deps.request ?? requestPinnedPublicSource;
    const now = deps.now ?? Date.now;
    const timeoutMs = deps.timeoutMs ?? PDF_REQUEST_TIMEOUT_MS;

    let currentUrl = input.canonicalUrl;
    let redirectCount = 0;

    try {
        while (redirectCount <= MAX_REDIRECTS) {
            if (deps.beforeResolve) {
                await deps.beforeResolve();
            }
            const validated = await validatePublicSourceUrl(
                currentUrl,
                resolveAddresses,
            );
            const pinnedAddress = validated.addresses[0];
            if (!pinnedAddress) {
                return {
                    status: "failed",
                    canonicalUrl: input.canonicalUrl,
                    failureReason: "No public DNS address for host",
                    errorCode: "dns_failed",
                };
            }

            const operation = "retrieve_pdf";
            const operationKey = `${deps.operationScope ?? "pdf"}:${operation}:${currentUrl}`;

            let response: Response | null = null;
            let lastError: unknown = null;

            for (let attempt = 1; attempt <= MAX_PDF_ATTEMPTS; attempt += 1) {
                const startedAt = now();
                if (deps.recordAttempt) {
                    const lease = await deps.recordAttempt({
                        operation,
                        operationKey,
                        status: "started",
                        attempt,
                    });
                    if (!lease.shouldExecute) {
                        throw new PdfRetrievalError(
                            "PDF provider attempt was already recorded",
                            "PdfAttemptReplayError",
                        );
                    }
                }

                try {
                    response = await request(
                        validated.canonicalUrl,
                        pinnedAddress,
                        {
                            allowPdfBody: true,
                            maxBytes: MAX_APPROVED_SOURCE_BYTES,
                            timeoutMs,
                        },
                    );

                    if (
                        response.status >= 300 &&
                        response.status < 400 &&
                        response.headers.get("location")
                    ) {
                        // Handled in outer redirect loop
                        if (deps.recordAttempt) {
                            await deps.recordAttempt({
                                operation,
                                operationKey,
                                status: "succeeded",
                                attempt,
                                latencyMs: Math.max(0, now() - startedAt),
                            });
                        }
                        break;
                    }

                    if (!response.ok) {
                        if (
                            response.status === 429 ||
                            response.status >= 500 ||
                            response.status === 408
                        ) {
                            throw new PdfRetrievalError(
                                `PDF fetch failed with status ${response.status}`,
                                `http_${response.status}`,
                            );
                        }
                        throw new PdfRetrievalError(
                            `PDF fetch failed with status ${response.status}`,
                            `http_${response.status}`,
                        );
                    }

                    const contentType =
                        response.headers.get("content-type")?.toLowerCase() ??
                        "";
                    if (!contentType.startsWith("application/pdf")) {
                        throw new PdfRetrievalError(
                            `Unsupported media type for PDF: ${contentType}`,
                            "unsupported_content_type",
                        );
                    }

                    if (deps.recordAttempt) {
                        await deps.recordAttempt({
                            operation,
                            operationKey,
                            status: "succeeded",
                            attempt,
                            latencyMs: Math.max(0, now() - startedAt),
                        });
                    }
                    break;
                } catch (err) {
                    lastError = err;
                    const latencyMs = Math.max(0, now() - startedAt);
                    const errorCode =
                        err instanceof PdfRetrievalError
                            ? err.errorCode
                            : err instanceof Error
                              ? err.name
                              : "PdfFetchError";

                    if (deps.recordAttempt) {
                        await deps.recordAttempt({
                            operation,
                            operationKey,
                            status: "failed",
                            attempt,
                            latencyMs,
                            errorCode,
                        });
                    }

                    const retryable = isRetryablePdfError(err);
                    if (!retryable || attempt === MAX_PDF_ATTEMPTS) {
                        throw err;
                    }
                }
            }

            if (!response) {
                throw (
                    lastError ?? new Error("PDF fetch failed without response")
                );
            }

            const location = response.headers.get("location");
            if (response.status >= 300 && response.status < 400 && location) {
                redirectCount += 1;
                if (redirectCount > MAX_REDIRECTS) {
                    return {
                        status: "failed",
                        canonicalUrl: input.canonicalUrl,
                        failureReason:
                            "Too many redirects during PDF retrieval",
                        errorCode: "redirect_limit",
                    };
                }
                const nextUrl = new URL(location, currentUrl);
                currentUrl = nextUrl.toString();
                continue;
            }

            const buffer = await response.arrayBuffer();
            const pdfBytes = new Uint8Array(buffer);

            if (pdfBytes.byteLength > MAX_APPROVED_SOURCE_BYTES) {
                return {
                    status: "failed",
                    canonicalUrl: input.canonicalUrl,
                    failureReason: `PDF byte size ${pdfBytes.byteLength} exceeds limit of ${MAX_APPROVED_SOURCE_BYTES} bytes`,
                    errorCode: "response_too_large",
                };
            }

            // Normalization: Fixture lookup
            const fixture = lookupPdfFixture(pdfBytes);
            if (!fixture) {
                return {
                    status: "failed",
                    canonicalUrl: input.canonicalUrl,
                    failureReason:
                        "PDF normalizer is unavailable for non-fixture documents in prototype",
                    errorCode: "normalizer_unavailable",
                };
            }

            if (fixture.pages.length > MAX_PDF_PAGES) {
                return {
                    status: "failed",
                    canonicalUrl: input.canonicalUrl,
                    failureReason: `PDF page count ${fixture.pages.length} exceeds maximum limit of ${MAX_PDF_PAGES} pages`,
                    errorCode: "pdf_page_limit_exceeded",
                };
            }

            const normalized = normalizePdfPages(fixture.pages);
            if (!normalized.normalizedPages) {
                return {
                    status: "failed",
                    canonicalUrl: input.canonicalUrl,
                    failureReason:
                        "PDF normalization failed to produce per-page text",
                    errorCode: "normalization_failed",
                };
            }

            const passages = extractPdfPassagesFromPages(
                normalized.normalizedPages,
                {
                    canonicalUrl: validated.canonicalUrl,
                    sourceVersionHash: normalized.contentHash,
                },
            );

            // Replay verify every passage against normalized text before persistence
            let reproduce:
                | ReturnType<typeof preparePassageReproduction>
                | undefined;
            for (const passage of passages) {
                try {
                    reproduce ??= preparePassageReproduction(
                        normalized.normalizedText,
                    );
                    reproduce(passage.locator);
                } catch (replayErr) {
                    return {
                        status: "failed",
                        canonicalUrl: input.canonicalUrl,
                        failureReason: `PDF passage reproduction failed: ${replayErr instanceof Error ? replayErr.message : String(replayErr)}`,
                        errorCode: "passage_reproduction_failed",
                    };
                }
            }

            const unavailablePages = fixture.ocrUnavailablePages ?? 0;
            if (unavailablePages > 0) {
                return {
                    status: "partial",
                    canonicalUrl: validated.canonicalUrl,
                    rawContent: normalized.normalizedText,
                    normalizedText: normalized.normalizedText,
                    contentHash: normalized.contentHash,
                    normalizerVersion: PDF_NORMALIZER_VERSION,
                    retrievalVersion: PDF_RETRIEVAL_VERSION,
                    mediaType: "text/plain",
                    byteCount: normalized.byteCount,
                    pageCount: fixture.pages.length,
                    passages,
                    retrievalMetadata: {
                        contentType: "application/pdf",
                        pageCount: fixture.pages.length,
                    },
                    failureReason: `pdf_acquisition_partial: ${unavailablePages} of ${fixture.pages.length} pages had no extractable text`,
                };
            }

            return {
                status: "succeeded",
                canonicalUrl: validated.canonicalUrl,
                rawContent: normalized.normalizedText,
                normalizedText: normalized.normalizedText,
                contentHash: normalized.contentHash,
                normalizerVersion: PDF_NORMALIZER_VERSION,
                retrievalVersion: PDF_RETRIEVAL_VERSION,
                mediaType: "text/plain",
                byteCount: normalized.byteCount,
                pageCount: fixture.pages.length,
                passages,
                retrievalMetadata: {
                    contentType: "application/pdf",
                    pageCount: fixture.pages.length,
                },
            };
        }

        return {
            status: "failed",
            canonicalUrl: input.canonicalUrl,
            failureReason: "Too many redirects during PDF retrieval",
            errorCode: "redirect_limit",
        };
    } catch (error) {
        const failureReason =
            error instanceof Error
                ? error.message
                : "Unknown PDF retrieval error";
        const errorCode =
            error instanceof PdfRetrievalError
                ? error.errorCode
                : error instanceof PublicSourceUrlError
                  ? error.data.code
                  : error instanceof Error
                    ? error.name
                    : "PdfRetrievalError";
        return {
            status: "failed",
            canonicalUrl: input.canonicalUrl,
            failureReason,
            errorCode,
        };
    }
}
