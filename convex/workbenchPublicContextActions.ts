"use node";

import { lookup } from "node:dns/promises";
import { addAbortListener } from "node:events";
import { internal } from "@convex/_generated/api";
import { type ActionCtx, internalAction } from "@convex/_generated/server";
import { ManualSourceIntakeError } from "@convex/domain/manualSourceIntake";
import {
    PublicSourceUrlError,
    validatePublicSourceUrl,
} from "@convex/domain/publicSourceUrl";
import { DiscoveryRequestError } from "@convex/domain/sourceDiscoveryRecovery";
import { sha256Hex, stableStringify } from "@convex/domain/sourcePassages";
import type { ObserveProviderDispatch } from "@convex/domain/sourcePreparationAuthority";
import type {
    publicContextResultValidator,
    publicReadResultValidator,
} from "@convex/domain/workbenchContracts";
import {
    executionError as executionFailure,
    executionFailureCode,
} from "@convex/execution/errors";
import { operationOutcomeValidator } from "@convex/execution/executionProtocol";
import { retainedTextParts } from "@convex/execution/retainedText";
import {
    extractHtmlPublicationTime,
    normalizeSecHtml,
} from "@convex/integrations/evidenceNormalization";
import { ExaContentsError } from "@convex/integrations/exa";
import { validateExaCandidates } from "@convex/integrations/exaCandidateValidation";
import { configuredExaContentsClient } from "@convex/integrations/exaContentsClient";
import { configuredExaHttpDiscovery } from "@convex/integrations/exaSearchClient";
import { secFilingPublicationTime } from "@convex/integrations/sec";
import {
    resolveDirectFilingUrl,
    retrieveAndNormalizeSecFiling,
} from "@convex/integrations/secEvidence";
import {
    DEFAULT_EXA_CONTENTS_TIMEOUT_MS,
    DEFAULT_SEC_TIMEOUT_MS,
    EXA_DISCOVERY_TIMEOUT_MS,
    MANUAL_SOURCE_METADATA_TIMEOUT_MS,
    MAX_APPROVED_SOURCE_BYTES,
    MAX_EXA_TEXT_CHARACTERS,
    MAX_OPERATION_RESULT_BYTES,
    MAX_REDIRECTS,
    nodeActionGenerationDeadline,
    SOURCE_PUBLIC_ADDRESS_TIMEOUT_MS,
    SOURCES_MAX_EVIDENCE_REFERENCES,
} from "@convex/resourcePolicy";
import { requestPinnedPublicSource } from "@convex/sourceActions";
import { framingSecReadInput } from "@convex/workbenchPublicContext";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { type Infer, v } from "convex/values";

type Request = FunctionArgs<
    typeof internal.workbenchPublicContext.forExecution
>;
type PublicContext = Infer<typeof publicContextResultValidator>;
type Readings = PublicContext["references"];
type SuppliedReference = NonNullable<
    FunctionReturnType<
        typeof internal.workbenchPublicContext.forExecution
    >["suppliedReference"]
>;

const englishMonthNames = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
];

function excerptDate(match: RegExpExecArray | null) {
    if (!match) return undefined;
    const [, month, dayText, yearText] = match;
    const monthIndex = englishMonthNames.findIndex(
        (name) => name.toLowerCase() === month?.toLowerCase(),
    );
    const day = Number(dayText);
    const year = Number(yearText);
    if (monthIndex < 0 || day < 1 || day > 31 || year < 1000) return undefined;
    const timestamp = Date.UTC(year, monthIndex, day);
    return new Date(timestamp).getUTCMonth() === monthIndex
        ? timestamp
        : undefined;
}

/** Only explicit document date labels support a date derived from an excerpt. */
function framingReading(
    url: string,
    excerpt: string,
    publishedAt?: number,
): Readings[number] {
    const eventAt = resolveDirectFilingUrl(url)
        ? excerptDate(
              /Date of Report\s*\(Date of earliest event reported\)\s*:\s*([a-z]+)\s+(\d{1,2}),\s*(\d{4})\b/iu.exec(
                  excerpt,
              ),
          )
        : undefined;
    const dateline = excerptDate(
        /^[^\n]*?,\s*([a-z]+)\s+(\d{1,2}),\s*(\d{4})\s*\(GLOBE NEWSWIRE\)\s*[-–—]/imu.exec(
            excerpt,
        ),
    );
    const publicationTime = publishedAt ?? dateline;
    return {
        url,
        publisher: new URL(url).hostname,
        excerpt,
        ...(publicationTime === undefined
            ? {}
            : { publishedAt: publicationTime }),
        ...(eventAt === undefined ? {} : { eventAt }),
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

/** A retained page contributes progress only for visible, nonblank content, with dates attributed on that page. */
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
    replayCorpusHash?: string,
) {
    return {
        kind: "success" as const,
        valueJson: JSON.stringify({
            searchId,
            candidates,
            ...(replayCorpusHash ? { replayCorpusHash } : {}),
        }),
        progressKeys: candidates.map((lead) =>
            sha256Hex(stableStringify({ kind: "public_lead", ...lead })),
        ),
    };
}

async function observeProvider<T>(
    ctx: ActionCtx,
    request: Request,
    operation: "framing_context_search" | "framing_context_read",
    input: unknown,
    deadlineAt: number,
    timeout: number,
    dispatch: (
        signal: AbortSignal,
        observeDispatch: ObserveProviderDispatch,
    ) => Promise<{ value: T; cost?: number }>,
    service: "exa" | "sec" | "url_metadata" = "exa",
    stepKey: string = operation,
) {
    const authority = await ctx.runQuery(
        internal.workbenchPublicContext.forExecution,
        request,
    );
    const attempt = {
        missionId: authority.missionId,
        runId: authority.runId,
        corpusRevisionId: authority.corpusRevisionId,
        workflowVersion: authority.workflowVersion,
        executionGeneration: request.expectedGeneration,
        operationRequestId: request.requestId,
        service,
        operation,
        stepKey,
        attempt: 1,
        inputHash: sha256Hex(stableStringify(input)),
        ...(operation === "framing_context_search"
            ? { searchQuery: authority.query }
            : {}),
        operationKey: `workbench:${request.requestId}:${stepKey}`,
    };
    const admitted = await ctx.runMutation(
        internal.providerCalls.recordAttempt,
        { ...attempt, status: "started" },
    );
    if (!admitted.shouldExecute)
        return {
            kind: "unavailable" as const,
            code: "operation_outcome_unknown",
        };
    const startedAt = Date.now();
    const available = Math.min(deadlineAt, authority.deadlineAt) - startedAt;
    if (available <= 0) {
        await ctx.runMutation(internal.providerCalls.recordAttempt, {
            ...attempt,
            status: "failed",
            errorCode: "execution_deadline",
            retryable: false,
            dispatchOutcome: "not_dispatched",
        });
        return { kind: "unavailable" as const, code: "execution_deadline" };
    }
    const attemptObservation: {
        outcome: "not_dispatched" | "unknown" | "response_received";
    } = { outcome: "not_dispatched" };
    let observation: { value: T; cost?: number };
    try {
        observation = await dispatch(
            AbortSignal.timeout(Math.min(available, timeout)),
            (outcome) => {
                attemptObservation.outcome = outcome;
            },
        );
    } catch (error) {
        const code =
            error instanceof PublicSourceUrlError
                ? error.data.code === "dns_failed"
                    ? "source_url_unavailable"
                    : "source_url_not_public"
                : error instanceof DiscoveryRequestError
                  ? error.code
                  : error instanceof ExaContentsError
                    ? error.errorCode
                    : error instanceof ManualSourceIntakeError
                      ? error.data.code
                      : (executionFailureCode(error) ??
                        "framing_provider_failed");
        await ctx.runMutation(internal.providerCalls.recordAttempt, {
            ...attempt,
            status: "failed",
            errorCode: code,
            retryable: false,
            dispatchOutcome: attemptObservation.outcome,
            latencyMs: Date.now() - startedAt,
        });
        return {
            kind: "unavailable" as const,
            code,
        };
    }
    await ctx.runMutation(internal.providerCalls.recordAttempt, {
        ...attempt,
        status: "succeeded",
        reportedCost: observation.cost,
        dispatchOutcome: "response_received",
        latencyMs: Date.now() - startedAt,
    });
    return { kind: "observed" as const, value: observation.value };
}

async function resolveAddresses(hostname: string) {
    return (await lookup(hostname, { all: true, verbatim: true })).map(
        ({ address }) => address,
    );
}

async function readPinnedPublisher(
    ctx: ActionCtx,
    args: Request,
    url: string,
    confirmedSec: boolean,
    signal: AbortSignal,
    observeDispatch: ObserveProviderDispatch,
    media: "document" | "json" = "document",
) {
    let current = url;
    for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
        await ctx.runQuery(internal.workbenchPublicContext.forExecution, args);
        signal.throwIfAborted();
        let abort: ReturnType<typeof addAbortListener> | undefined;
        const destination = await Promise.race([
            validatePublicSourceUrl(current, resolveAddresses),
            new Promise<never>((_, reject) => {
                abort = addAbortListener(signal, () => reject(signal.reason));
            }),
        ]).finally(() => abort?.[Symbol.dispose]());
        const address = destination.addresses[0];
        if (!address) throw executionFailure("source_url_not_public");
        await ctx.runQuery(internal.workbenchPublicContext.forExecution, args);
        signal.throwIfAborted();
        if (confirmedSec) {
            const { retryAfter } = await ctx.runMutation(
                internal.providerCalls.reserveSecRateLimit,
                {},
            );
            if (retryAfter) throw executionFailure("sec_rate_limit");
            await ctx.runQuery(
                internal.workbenchPublicContext.forExecution,
                args,
            );
            signal.throwIfAborted();
        }
        const response = await requestPinnedPublicSource(
            destination.canonicalUrl,
            address,
            {
                signal,
                observeDispatch,
                maxBytes: MAX_APPROVED_SOURCE_BYTES,
                ...(confirmedSec
                    ? {
                          headers: {
                              ...(media === "json"
                                  ? { Accept: "application/json" }
                                  : {}),
                              "User-Agent":
                                  process.env.SEC_USER_AGENT?.trim() ||
                                  "Evidence Workbench research@evidence-workbench.org",
                          },
                      }
                    : {}),
            },
        );
        if ([301, 302, 303, 307, 308].includes(response.status)) {
            const location = response.headers.get("location");
            await response.body?.cancel();
            if (confirmedSec)
                throw executionFailure("sec_filing_identity_changed");
            if (!location)
                throw executionFailure("source_redirect_unavailable");
            current = new URL(location, destination.canonicalUrl).toString();
            continue;
        }
        const mediaType = response.headers
            .get("content-type")
            ?.split(";")[0]
            ?.trim();
        if (
            !response.ok ||
            !(
                media === "json"
                    ? ["application/json"]
                    : ["text/html", "application/xhtml+xml", "text/plain"]
            ).includes(mediaType ?? "")
        ) {
            await response.body?.cancel();
            throw executionFailure("source_read_unavailable");
        }
        return {
            url: destination.canonicalUrl,
            text: await response.text(),
            mediaType,
        };
    }
    throw executionFailure("source_redirect_unavailable");
}

async function readSuppliedReference(
    ctx: ActionCtx,
    args: Request,
    supplied: SuppliedReference,
    deadlineAt: number,
) {
    const filingInput = framingSecReadInput(supplied, "sec_filing");
    if (filingInput) {
        let publishedAt = supplied.publishedAt;
        const submissions = framingSecReadInput(supplied, "sec_submissions");
        if (submissions) {
            const metadata = await observeProvider(
                ctx,
                args,
                "framing_context_read",
                submissions,
                deadlineAt,
                DEFAULT_SEC_TIMEOUT_MS,
                async (signal, observeDispatch) => {
                    const page = await readPinnedPublisher(
                        ctx,
                        args,
                        submissions.url,
                        true,
                        signal,
                        observeDispatch,
                        "json",
                    );
                    return {
                        value: secFilingPublicationTime(
                            JSON.parse(page.text),
                            submissions,
                        ),
                    };
                },
                "sec",
                "sec_submissions",
            );
            if (metadata.kind === "unavailable") return metadata;
            publishedAt = metadata.value;
        }
        return observeProvider(
            ctx,
            args,
            "framing_context_read",
            filingInput,
            deadlineAt,
            DEFAULT_SEC_TIMEOUT_MS,
            async (signal, observeDispatch) => {
                const page = await readPinnedPublisher(
                    ctx,
                    args,
                    filingInput.url,
                    true,
                    signal,
                    observeDispatch,
                );
                const filing = await retrieveAndNormalizeSecFiling(
                    { retrieveDocumentHtml: async () => page.text },
                    { canonicalUrl: filingInput.url, origin: "sec" },
                );
                if (filing.status !== "succeeded" || !filing.normalizedText)
                    throw executionFailure("sec_filing_unavailable");
                return {
                    value: {
                        url: filing.canonicalUrl,
                        text: filing.normalizedText,
                        publishedAt,
                    },
                };
            },
            "sec",
            "sec_filing",
        );
    }
    return observeProvider(
        ctx,
        args,
        "framing_context_read",
        supplied,
        deadlineAt,
        MANUAL_SOURCE_METADATA_TIMEOUT_MS,
        async (signal, observeDispatch) => {
            const page = await readPinnedPublisher(
                ctx,
                args,
                supplied.url,
                false,
                signal,
                observeDispatch,
            );
            const knownPublishedAt =
                page.url === supplied.url ? supplied.publishedAt : undefined;
            return {
                value: {
                    url: page.url,
                    text: normalizeSecHtml(page.text).normalizedText,
                    publishedAt:
                        knownPublishedAt ??
                        (page.mediaType === "text/html" ||
                        page.mediaType === "application/xhtml+xml"
                            ? extractHtmlPublicationTime(page.text)
                            : undefined),
                },
            };
        },
        "url_metadata",
    );
}

export const execute = internalAction({
    args: {
        requestId: v.id("agentOperationRequests"),
        expectedGeneration: v.number(),
    },
    returns: operationOutcomeValidator,
    handler: async (
        ctx,
        args,
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
                    authority.replay.materialHash,
                );
            }
            const search = configuredExaHttpDiscovery();
            const read = configuredExaContentsClient();
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
                    const page = await ctx.runQuery(
                        internal.workbenchPublicContext.readingPage,
                        args,
                    );
                    const previous = authority.retainedRead;
                    if (!previous.reference || !previous.document)
                        return {
                            kind: "unavailable",
                            code: "source_reference_not_observed",
                        };
                    const reading = framingReading(
                        previous.reference.url,
                        page.excerpt,
                        previous.reference.publishedAt === undefined
                            ? undefined
                            : Date.parse(previous.reference.publishedAt),
                    );
                    if (
                        reading.eventAt === undefined &&
                        previous.reference.eventAt !== undefined
                    )
                        reading.eventAt = Date.parse(
                            previous.reference.eventAt,
                        );
                    return publicReadPageOutcome(
                        args.requestId,
                        page,
                        reading,
                        previous.document.acquisitionCompleteness,
                        authority.replay?.materialHash,
                    );
                }
                let text: string;
                let publishedAt = reference.publishedAt;
                let url = reference.url;
                if (authority.replay) {
                    const doc = authority.replay.documents.find(
                        (doc) => doc.url === url,
                    );
                    if (!doc)
                        return {
                            kind: "unavailable",
                            code: "source_reference_not_observed",
                        };
                    text = reference.confirmedSec
                        ? normalizeSecHtml(doc.text).normalizedText
                        : doc.text;
                    publishedAt =
                        doc.publishedAt === undefined
                            ? undefined
                            : Date.parse(doc.publishedAt);
                } else if (
                    authority.selectedCandidate &&
                    !reference.confirmedSec
                ) {
                    if (!read)
                        return {
                            kind: "unavailable",
                            code: "missing_configuration",
                        };
                    const options = {
                        text: { maxCharacters: MAX_EXA_TEXT_CHARACTERS },
                    };
                    const result = await observeProvider(
                        ctx,
                        args,
                        "framing_context_read",
                        { urls: [url], options },
                        deadlineAt,
                        DEFAULT_EXA_CONTENTS_TIMEOUT_MS,
                        async (signal, observeDispatch) => {
                            await validatePublicSourceUrl(
                                url,
                                resolveAddresses,
                            );
                            await ctx.runQuery(
                                internal.workbenchPublicContext.forExecution,
                                args,
                            );
                            signal.throwIfAborted();
                            const contents = await read.getContents(
                                [url],
                                options,
                                { signal, observeDispatch },
                            );
                            return {
                                value: contents.results,
                                cost: contents.costDollars?.total,
                            };
                        },
                    );
                    if (result.kind === "unavailable") return result;
                    const matching = result.value.filter(
                        (item) => item.url === url,
                    );
                    text =
                        matching.length === 1 ? (matching[0]?.text ?? "") : "";
                } else {
                    const result = await readSuppliedReference(
                        ctx,
                        args,
                        reference,
                        deadlineAt,
                    );
                    if (result.kind === "unavailable") return result;
                    ({ text, url, publishedAt } = result.value);
                }
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
                    framingReading(url, page.excerpt, publishedAt),
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
                const result = await readSuppliedReference(
                    ctx,
                    args,
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
                              ),
                          ]
                        : [],
                );
            }
            if (
                !search ||
                (authority.operation === "verify_public_context" && !read)
            )
                return { kind: "unavailable", code: "missing_configuration" };
            const found = await observeProvider(
                ctx,
                args,
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
                resolveAddresses,
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
                const contents = await observeProvider(
                    ctx,
                    args,
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
            if (code) return { kind: "unavailable", code };
            throw error;
        }
    },
});
