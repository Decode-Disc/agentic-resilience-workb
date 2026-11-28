"use node";

import { internal } from "@convex/_generated/api";
import { internalAction } from "@convex/_generated/server";
import {
    type DateEvidence,
    type DocumentDates,
    documentDates,
    recordedDocumentDate,
    unambiguousDocumentTime,
} from "@convex/domain/documentDates";
import {
    documentaryReference,
    savedMaterialBinding,
} from "@convex/domain/savedMaterialOperations";
import { sha256Hex, stableStringify } from "@convex/domain/sourcePassages";
import type {
    publicContextResultValidator,
    publicReadResultValidator,
} from "@convex/domain/workbenchContracts";
import {
    executionFailureCode,
    executionFailureValidation,
} from "@convex/execution/errors";
import { operationOutcomeValidator } from "@convex/execution/executionProtocol";
import { piDispatchLeaseValidator } from "@convex/execution/piSession";
import { retainedTextParts } from "@convex/execution/retainedText";
import { validateExaCandidates } from "@convex/integrations/exaCandidateValidation";
import { configuredExaContentsClient } from "@convex/integrations/exaContentsClient";
import { configuredExaHttpDiscovery } from "@convex/integrations/exaSearchClient";
import { resolveDirectFilingUrl } from "@convex/integrations/secEvidence";
import {
    DEFAULT_EXA_CONTENTS_TIMEOUT_MS,
    EXA_DISCOVERY_TIMEOUT_MS,
    MAX_EXA_TEXT_CHARACTERS,
    MAX_OPERATION_RESULT_BYTES,
    nodeActionGenerationDeadline,
    SOURCE_PUBLIC_ADDRESS_TIMEOUT_MS,
    SOURCES_MAX_EVIDENCE_REFERENCES,
} from "@convex/resourcePolicy";
import {
    acquireWorkbenchPublicDocument,
    acquireWorkbenchSuppliedReference,
    observeWorkbenchDocumentaryProvider,
    resolvePublicDocumentAddresses,
} from "@convex/sourceCaptureActions";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { type Infer, v } from "convex/values";

type Request = FunctionArgs<
    typeof internal.workbenchPublicContext.forExecution
>;
type PublicContext = Infer<typeof publicContextResultValidator>;
type Readings = PublicContext["references"];
/** Only explicit document labels and retained metadata establish documentary dates. */
function framingReading(
    url: string,
    excerpt: string,
    publishedAt?: number,
    previous?: DocumentDates,
    metadata: readonly DateEvidence[] = [],
): Readings[number] {
    const dates = documentDates({
        metadata: [
            ...metadata,
            ...(publishedAt === undefined
                ? []
                : [
                      recordedDocumentDate(
                          resolveDirectFilingUrl(url)
                              ? "filing"
                              : "publication",
                          publishedAt,
                          {
                              kind: resolveDirectFilingUrl(url)
                                  ? "sec_field"
                                  : "metadata",
                              label: resolveDirectFilingUrl(url)
                                  ? "filingDate"
                                  : "publishedAt",
                              raw: String(publishedAt),
                          },
                      ),
                  ]),
        ],
        text: excerpt,
        previous,
    });
    return {
        url,
        publisher: new URL(url).hostname,
        excerpt,
        dates,
        publishedAt: unambiguousDocumentTime(
            resolveDirectFilingUrl(url) ? dates.filing : dates.publication,
        ),
        eventAt: unambiguousDocumentTime(dates.event),
    };
}

function publicContextOutcome(references: Readings) {
    const value: PublicContext = {
        status: references.some(
            (reference) =>
                reference.publishedAt !== undefined ||
                reference.eventAt !== undefined,
        )
            ? "observed"
            : "inconclusive",
        references,
    };
    return { kind: "success" as const, valueJson: JSON.stringify(value) };
}

/** A retained page contributes progress only for visible, nonblank content, with document-level dates from its verified acquired representation. */
function publicReadPageOutcome(
    requestId: Request["requestId"],
    page: FunctionReturnType<
        typeof internal.workbenchPublicContext.readingPage
    >,
    reading: Readings[number],
    acquisitionCompleteness: NonNullable<
        Infer<typeof publicReadResultValidator>["document"]
    >["acquisitionCompleteness"],
    replayCorpusHash?: string,
) {
    const reference = reading.excerpt
        ? {
              url: reading.url,
              publisher: reading.publisher,
              excerpt: reading.excerpt,
              dates: reading.dates,
              ...(reading.publishedAt === undefined
                  ? {}
                  : {
                        publishedAt: new Date(
                            reading.publishedAt,
                        ).toISOString(),
                    }),
              ...(reading.eventAt === undefined
                  ? {}
                  : { eventAt: new Date(reading.eventAt).toISOString() }),
          }
        : undefined;
    const readable = !!reading.excerpt.trim();
    return {
        kind: "success" as const,
        valueJson: JSON.stringify({
            ...(replayCorpusHash ? { replayCorpusHash } : {}),
            readId: requestId,
            status: readable ? "observed" : "inconclusive",
            ...(reference ? { reference } : {}),
            document: {
                readId: page.readId,
                contentHash: page.contentHash,
                characters: page.characters,
                acquisitionCompleteness,
            },
            range: { start: page.start, end: page.end },
            ...(page.end < page.characters ? { continuation: requestId } : {}),
        }),
        progressKeys: readable
            ? [
                  sha256Hex(
                      stableStringify({ kind: "public_passage", ...reference }),
                  ),
              ]
            : [],
    };
}

function publicSearchOutcome(
    searchId: Request["requestId"],
    candidates: Infer<
        typeof import("@convex/domain/workbenchContracts").publicSearchResultValidator
    >["candidates"],
    definitionVersion: number,
    replayCorpusHash?: string,
) {
    return {
        kind: "success" as const,
        valueJson: JSON.stringify({
            searchId,
            candidates:
                savedMaterialBinding("workbench_v1", definitionVersion) ===
                "referenced"
                    ? candidates.map((candidate, index) => ({
                          ...candidate,
                          reference: documentaryReference({
                              issuer: "operation",
                              operationId: searchId,
                              item: "candidate",
                              index,
                          }),
                      }))
                    : candidates,
            ...(replayCorpusHash ? { replayCorpusHash } : {}),
        }),
        progressKeys: candidates.map((lead) =>
            sha256Hex(stableStringify({ kind: "public_lead", ...lead })),
        ),
    };
}

export const execute = internalAction({
    args: {
        requestId: v.id("agentOperationRequests"),
        expectedGeneration: v.number(),
        piLease: v.optional(piDispatchLeaseValidator),
    },
    returns: operationOutcomeValidator,
    handler: async (
        ctx,
        { piLease, ...args },
    ): Promise<Infer<typeof operationOutcomeValidator>> => {
        const hostDeadline = nodeActionGenerationDeadline(Date.now());
        try {
            const authority = await ctx.runQuery(
                internal.workbenchPublicContext.forExecution,
                args,
            );
            if (authority.replay?.unavailable)
                return {
                    kind: "unavailable",
                    code: "missing_configuration",
                    validation: {
                        path: "framingReplay",
                        expected: `Frozen lookup-unavailable fixture from corpus ${authority.replay.materialHash}; no provider dispatched.`,
                    },
                };
            if (
                authority.replay &&
                authority.operation === "search_public_context"
            ) {
                return publicSearchOutcome(
                    args.requestId,
                    authority.replay.documents.map((doc) => ({
                        url: doc.url,
                        title: doc.title,
                        publisher: new URL(doc.url).hostname,
                        ...(doc.publishedAt
                            ? { publishedAt: doc.publishedAt }
                            : {}),
                    })),
                    authority.workflowVersion,
                    authority.replay.materialHash,
                );
            }
            const search = configuredExaHttpDiscovery();
            const deadlineAt = Math.min(authority.deadlineAt, hostDeadline);
            const limit = SOURCES_MAX_EVIDENCE_REFERENCES;
            // Reserve room for JSON escaping and reference metadata in the shared result limit.
            const maxCharacters = Math.floor(
                MAX_OPERATION_RESULT_BYTES / (8 * limit),
            );
            if (authority.operation === "read_public_context") {
                const reference = authority.suppliedReference;
                if (!reference)
                    return {
                        kind: "unavailable",
                        code: "source_reference_not_observed",
                    };
                if (authority.retainedRead) {
                    const continued = await ctx.runAction(
                        internal.sourceRetrievalActions
                            .readRetainedPublicContextPage,
                        args,
                    );
                    if (continued.status === "unavailable")
                        return { kind: "unavailable", code: continued.reason };
                    const { page } = continued;
                    const previous = authority.retainedRead;
                    if (!previous.reference || !previous.document)
                        return {
                            kind: "unavailable",
                            code: "source_reference_not_observed",
                        };
                    const retainedDates =
                        previous.reference.dates ??
                        framingReading(
                            previous.reference.url,
                            previous.reference.excerpt,
                            previous.reference.publishedAt === undefined
                                ? undefined
                                : Date.parse(previous.reference.publishedAt),
                            undefined,
                            previous.reference.eventAt === undefined
                                ? []
                                : [
                                      recordedDocumentDate(
                                          "event",
                                          Date.parse(
                                              previous.reference.eventAt,
                                          ),
                                          {
                                              kind: "metadata",
                                              label: "eventAt",
                                              raw: previous.reference.eventAt,
                                          },
                                      ),
                                  ],
                        ).dates;
                    const reading = framingReading(
                        previous.reference.url,
                        page.excerpt,
                        undefined,
                        retainedDates,
                    );
                    return publicReadPageOutcome(
                        args.requestId,
                        page,
                        reading,
                        previous.document.acquisitionCompleteness,
                        authority.replay?.materialHash,
                    );
                }
                const acquisition = await acquireWorkbenchPublicDocument(
                    ctx,
                    { ...args, piLease },
                    authority,
                    reference,
                    deadlineAt,
                );
                if (acquisition.kind === "unavailable") return acquisition;
                const { text, url, publishedAt, dateEvidence } =
                    acquisition.value;
                const retained = retainedTextParts(text);
                for (const [index, content] of retained.parts.entries())
                    await ctx.runMutation(
                        internal.execution.operations.stageObservationText,
                        {
                            ...args,
                            fragment: { ...retained.manifest, index, content },
                        },
                    );
                const page = await ctx.runQuery(
                    internal.workbenchPublicContext.readingPage,
                    args,
                );
                return publicReadPageOutcome(
                    args.requestId,
                    page,
                    {
                        ...framingReading(
                            url,
                            text,
                            publishedAt,
                            undefined,
                            dateEvidence,
                        ),
                        excerpt: page.excerpt,
                    },
                    authority.replay
                        ? "complete"
                        : authority.selectedCandidate && !reference.confirmedSec
                          ? text.length >= MAX_EXA_TEXT_CHARACTERS
                              ? "partial"
                              : "unknown"
                          : "complete",
                    authority.replay?.materialHash,
                );
            }
            const supplied = authority.suppliedReference;
            if (supplied) {
                const result = await acquireWorkbenchSuppliedReference(
                    ctx,
                    { ...args, piLease },
                    supplied,
                    deadlineAt,
                );
                if (result.kind === "unavailable") return result;
                const excerpt = result.value.text
                    .slice(0, maxCharacters)
                    .trim();
                const { publishedAt } = result.value;
                return publicContextOutcome(
                    excerpt
                        ? [
                              framingReading(
                                  result.value.url,
                                  excerpt,
                                  publishedAt,
                                  undefined,
                                  result.value.dateEvidence,
                              ),
                          ]
                        : [],
                );
            }
            const read = configuredExaContentsClient();
            if (
                !search ||
                (authority.operation === "verify_public_context" && !read)
            )
                return { kind: "unavailable", code: "missing_configuration" };
            const found = await observeWorkbenchDocumentaryProvider(
                ctx,
                { ...args, piLease },
                "framing_context_search",
                { query: authority.query, limit },
                deadlineAt,
                EXA_DISCOVERY_TIMEOUT_MS,
                async (signal, observeDispatch) => {
                    const result = await search(
                        authority.query,
                        limit,
                        undefined,
                        signal,
                        observeDispatch,
                    );
                    return {
                        value: result.candidates,
                        cost: result.costDollars,
                    };
                },
            );
            if (found.kind === "unavailable") return found;
            await ctx.runQuery(
                internal.workbenchPublicContext.forExecution,
                args,
            );
            const remaining = deadlineAt - Date.now();
            if (remaining <= 0)
                return { kind: "unavailable", code: "execution_deadline" };
            const { candidates } = await validateExaCandidates(
                found.value.slice(0, limit),
                resolvePublicDocumentAddresses,
                AbortSignal.timeout(
                    Math.min(remaining, SOURCE_PUBLIC_ADDRESS_TIMEOUT_MS),
                ),
            );
            if (authority.operation === "search_public_context") {
                return publicSearchOutcome(
                    args.requestId,
                    candidates.map((candidate) => ({
                        url: candidate.canonicalUrl,
                        title: candidate.title,
                        publisher: new URL(candidate.canonicalUrl).hostname,
                        ...(candidate.publishedAt === undefined
                            ? {}
                            : {
                                  publishedAt: new Date(
                                      candidate.publishedAt,
                                  ).toISOString(),
                              }),
                    })),
                    authority.workflowVersion,
                );
            }
            const references: Readings = [];
            if (candidates.length && read) {
                const urls = [
                    ...new Set(
                        candidates.map((candidate) => candidate.canonicalUrl),
                    ),
                ];
                const options = { text: { maxCharacters } };
                const contents = await observeWorkbenchDocumentaryProvider(
                    ctx,
                    { ...args, piLease },
                    "framing_context_read",
                    { urls, options },
                    deadlineAt,
                    DEFAULT_EXA_CONTENTS_TIMEOUT_MS,
                    async (signal, observeDispatch) => {
                        const result = await read.getContents(urls, options, {
                            signal,
                            observeDispatch,
                        });
                        return {
                            value: result.results,
                            cost: result.costDollars?.total,
                        };
                    },
                );
                if (contents.kind === "unavailable") return contents;
                for (const url of urls) {
                    const candidate = candidates.find(
                        (entry) => entry.canonicalUrl === url,
                    );
                    const matching = contents.value.filter(
                        (entry) => entry.url === url,
                    );
                    const excerpt =
                        matching.length === 1
                            ? matching[0]?.text?.slice(0, maxCharacters).trim()
                            : undefined;
                    if (excerpt && candidate)
                        references.push(
                            framingReading(url, excerpt, candidate.publishedAt),
                        );
                }
            }
            return publicContextOutcome(references);
        } catch (error) {
            const code = executionFailureCode(error);
            if (code) {
                const validation = executionFailureValidation(error);
                return {
                    kind: "unavailable",
                    code,
                    ...(validation ? { validation } : {}),
                };
            }
            throw error;
        }
    },
});
