import {
    SEC_NORMALIZER_VERSION,
    SEC_RETRIEVAL_VERSION,
} from "@convex/domain/evidenceArtifacts";
import { extractPassagesFromNormalizedText } from "@convex/domain/sourcePassages";
import type {
    ApprovedSourceRetrievalInput,
    ApprovedSourceRetrievalResult,
} from "@convex/integrations/approvedSourceRetrieval";
import { normalizeSecHtml } from "@convex/integrations/evidenceNormalization";
import type { SecCompanyEvidenceResolver } from "@convex/integrations/sec";

function normalizeCik(value: string | number): string {
    return String(value).replace(/^0+/, "") || "0";
}

function resolveDirectFilingUrl(canonicalUrl: string): string | null {
    if (
        canonicalUrl.startsWith("https://www.sec.gov/Archives/edgar/data/") &&
        (canonicalUrl.endsWith(".htm") ||
            canonicalUrl.endsWith(".html") ||
            canonicalUrl.endsWith(".txt"))
    ) {
        return canonicalUrl;
    }
    return null;
}

export async function retrieveAndNormalizeSecFiling(
    resolver: SecCompanyEvidenceResolver,
    input: ApprovedSourceRetrievalInput,
): Promise<ApprovedSourceRetrievalResult> {
    try {
        let retrievalUrl = resolveDirectFilingUrl(input.canonicalUrl);

        if (!retrievalUrl) {
            if (!input.companyCik || !input.secAccessionNumber) {
                return {
                    status: "failed",
                    canonicalUrl: input.canonicalUrl,
                    failureReason:
                        "Missing company CIK or SEC accession number to resolve filing",
                    errorCode: "sec_missing_identity",
                };
            }

            const cleanCik = normalizeCik(input.companyCik);
            const accessionNoDashes = input.secAccessionNumber.replaceAll(
                "-",
                "",
            );

            let primaryDocument = input.secPrimaryDocument;
            if (!primaryDocument) {
                const snapshot = await resolver.inspectEvidence(cleanCik);
                const matchedFiling = snapshot.filings.find(
                    (f) => f.accessionNumber === input.secAccessionNumber,
                );
                primaryDocument = matchedFiling?.primaryDocument;
            }

            if (!primaryDocument) {
                return {
                    status: "failed",
                    canonicalUrl: input.canonicalUrl,
                    failureReason: `Could not resolve primary document for SEC accession ${input.secAccessionNumber}`,
                    errorCode: "sec_primary_document_not_found",
                };
            }

            retrievalUrl = `https://www.sec.gov/Archives/edgar/data/${cleanCik}/${accessionNoDashes}/${primaryDocument}`;
        }

        const rawHtml = await resolver.retrieveDocumentHtml(retrievalUrl);
        const normalized = normalizeSecHtml(rawHtml);
        const passages = extractPassagesFromNormalizedText({
            text: normalized.normalizedText,
            canonicalUrl: retrievalUrl,
            sourceVersionHash: normalized.contentHash,
        });

        return {
            status: "succeeded",
            canonicalUrl: retrievalUrl,
            rawContent: rawHtml,
            normalizedText: normalized.normalizedText,
            contentHash: normalized.contentHash,
            normalizerVersion: SEC_NORMALIZER_VERSION,
            retrievalVersion: SEC_RETRIEVAL_VERSION,
            mediaType: normalized.mediaType,
            byteCount: normalized.byteCount,
            passages,
            retrievalMetadata: {
                secAccessionNumber: input.secAccessionNumber,
                secForm: input.secForm,
                companyCik: input.companyCik,
                primaryDocument: input.secPrimaryDocument,
            },
        };
    } catch (error) {
        const failureReason =
            error instanceof Error
                ? error.message
                : "Unknown SEC retrieval error";
        const errorCode =
            error instanceof Error ? error.name : "SecRetrievalError";
        return {
            status: "failed",
            canonicalUrl: input.canonicalUrl,
            failureReason,
            errorCode,
        };
    }
}
