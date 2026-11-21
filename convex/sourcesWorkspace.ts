import type { Doc, Id } from "@convex/_generated/dataModel";
import { type QueryCtx, query } from "@convex/_generated/server";
import { mergeRunCompanyMetadata } from "@convex/domain/companyMetadata";
import {
    formatResearchSummary,
    readResearchState,
    sourcesCurrentStop,
} from "@convex/domain/researchState";
import { researchStateValidator } from "@convex/domain/researchStateContracts";
import {
    captureAvailability,
    sourceCaptureAvailabilityValidator as readingValidator,
    sourceCaptureState,
} from "@convex/domain/sourceCaptureState";
import {
    findCaptureIndex,
    sourceCaptureScopeKey,
} from "@convex/domain/sourceRetrievalPolicy";
import { SourceReviewReads } from "@convex/domain/sourceReviewReads";
import {
    classifySourceCandidate,
    sourceAuthorityTierValidator,
    sourceDocumentKindValidator,
    sourceFamilyValidator,
} from "@convex/domain/sourceSelectionPolicy";
import {
    controlledSourcesContributions,
    latestSourceQualifications,
    projectSourceDocumentState,
    readSourcesCoverage,
    readSourcesMission,
    sourcesPreparationPhase,
    tallyDocumentaryContributions,
} from "@convex/domain/sources";
import {
    documentaryContributionTallyValidator as contributionTallyValidator,
    type DocumentaryContributionTally,
    documentaryContributionValidator,
    documentaryFindingValidator,
    sourceDocumentStateValidator,
    sourcesCoverage,
} from "@convex/domain/sourcesContracts";
import { isResumableResearchPause } from "@convex/domain/transitions";
import { executionError } from "@convex/execution/errors";
import { missionStatusValidator } from "@convex/execution/executionProtocol";
import { sourceDossierCandidateLimit } from "@convex/resourceLimits";
import {
    SOURCES_HANDOFF_READ_CAPACITY,
    SOURCES_READER_CONTEXT_PASSAGES,
    SOURCES_READER_OPENING_PASSAGES,
} from "@convex/resourcePolicy";
import { requireWorkspaceRun } from "@convex/runWorkspace";
import schema from "@convex/schema";
import { v } from "convex/values";

const preparationStatus =
    schema.tables.sourceSelectionProposalRebuilds.validator.fields.status;
const contributionKind = documentaryContributionValidator.fields.kind;
const conclusion = documentaryFindingValidator.fields.conclusion;
const permittedUse = documentaryFindingValidator.fields.permittedUse;

/** Where documentary work on one need stands; never a verdict on the questions it serves. */
export const needOutcomeValidator = v.union(
    v.literal("in_progress"),
    v.literal("on_hold"),
    v.literal("prepared"),
    v.literal("gap"),
    v.literal("unfinished"),
);
const overviewValidator = v.object({
    research: researchStateValidator,
    researchSummary: v.string(),
    /** The Sources mission's recorded stop in analyst wording, shared with the research summary. */
    currentStop: v.union(v.string(), v.null()),
    preparationId: v.id("sourceSelectionProposalRebuilds"),
    preparationStatus,
    missionStatus: v.optional(missionStatusValidator),
    coverage: v.optional(sourcesCoverage),
    materialOutcome: v.union(
        v.literal("complete"),
        v.literal("partial"),
        v.literal("blocked"),
        v.null(),
    ),
    questions: v.array(
        v.object({ id: v.string(), text: v.string(), shortLabel: v.string() }),
    ),
    needs: v.array(
        v.object({
            id: v.string(),
            information: v.string(),
            questionIds: v.array(v.string()),
            outcome: needOutcomeValidator,
            gap: v.optional(v.string()),
            unfinished: v.array(v.string()),
            documents: v.number(),
            /** The documents serving this need: the handed-off result, or served contributions before handoff. */
            sourceIds: v.array(v.id("sources")),
            contributions: v.number(),
            conflicts: v.number(),
        }),
    ),
    collect: v.object({
        candidates: v.number(),
        failedFamilies:
            schema.tables.sourceSelectionProposalRebuilds.validator.fields
                .failedDiscoveryFamilies,
        searches: v.number(),
        acquisitions: v.number(),
    }),
    reading: v.object({
        captured: v.number(),
        full: v.number(),
        partial: v.number(),
        unknown: v.number(),
        unavailable: v.number(),
        capturing: v.number(),
        /** Candidates that were never captured: open leads, not judged irrelevant. */
        notCaptured: v.number(),
    }),
    /** Every control performed, including documents later not retained. */
    contributions: contributionTallyValidator,
    /** Controls on the documents retained in the handed-off material. */
    retainedContributions: contributionTallyValidator,
    organize: v.object({
        retained: v.number(),
        contextOnly: v.number(),
        notRetained: v.number(),
        /** A saved capture is available; qualification and usefulness remain separate facts. */
        notRetainedCaptured: v.number(),
        /** No committed capture is currently available, including failed or ongoing acquisition. */
        notRetainedWithoutAvailableCapture: v.number(),
        excluded: v.number(),
        restricted: v.number(),
    }),
});

const sourceRowValidator = v.object({
    sourceId: v.id("sources"),
    title: v.string(),
    url: v.string(),
    host: v.string(),
    origin: v.union(
        v.literal("sec"),
        v.literal("exa"),
        v.literal("analyst_url"),
    ),
    publishedAt: v.optional(v.number()),
    secForm: v.optional(v.string()),
    family: v.union(
        sourceFamilyValidator,
        v.literal("unrecognized"),
        v.literal("analyst_supplied"),
    ),
    documentKind: sourceDocumentKindValidator,
    authorityTier: sourceAuthorityTierValidator,
    reading: readingValidator,
    ...sourceDocumentStateValidator.fields,
});

const readerValidator = v.object({
    source: sourceRowValidator,
    capture: v.union(
        v.null(),
        v.object({
            captureId: v.id("sourceCaptures"),
            mediaType: v.optional(v.string()),
            retrievedAt: v.optional(v.number()),
            omittedPassageCount: v.optional(v.number()),
        }),
    ),
    excerpts: v.union(
        v.literal("cited"),
        v.literal("opening"),
        v.literal("none"),
    ),
    sections: v.array(
        v.object({
            id: v.string(),
            heading: v.optional(v.string()),
            passages: v.array(
                v.object({ order: v.number(), quotation: v.string() }),
            ),
        }),
    ),
    contributions: v.array(
        v.object({
            id: v.string(),
            version: v.number(),
            kind: contributionKind,
            statement: v.string(),
            period: v.string(),
            attribution: v.string(),
            needIds: v.array(v.string()),
            passageOrders: v.array(v.number()),
            /** Effective use after controls, exclusions and restrictions. */
            permittedUse,
            /** What the control reported; it never widens the effective use. */
            reportedUse: v.optional(permittedUse),
            conclusion: v.optional(conclusion),
            diagnostic: v.optional(v.string()),
            restricted: v.boolean(),
        }),
    ),
    coherence: v.union(v.boolean(), v.null()),
    observedLinks: v.array(
        v.object({
            index: v.number(),
            url: v.string(),
            originText: v.string(),
            captured: v.boolean(),
        }),
    ),
});

/** Authorizes the owner and loads the mission preparation; legacy dossiers return null. */
async function missionContext(ctx: QueryCtx, runId: Id<"researchRuns">) {
    const { run } = await requireWorkspaceRun(ctx, runId);
    const preparation = run.sourcePreparationId
        ? await ctx.db.get(run.sourcePreparationId)
        : null;
    if (
        run.sourcesProtocol !== "sources_mission_v1" ||
        !preparation?.sourcesMission ||
        preparation.runId !== run._id
    )
        return null;
    const reads = new SourceReviewReads(
        ctx.db,
        run._id,
        SOURCES_HANDOFF_READ_CAPACITY,
    );
    const controlled = await controlledSourcesContributions(
        ctx,
        preparation,
        reads,
    );
    return {
        run,
        preparation,
        data: preparation.sourcesMission,
        reads,
        controlled,
    };
}

function addTally(
    into: DocumentaryContributionTally,
    from: DocumentaryContributionTally | null,
) {
    if (!from) return into;
    into.total += from.total;
    for (const kind of Object.keys(
        into.kinds,
    ) as (keyof DocumentaryContributionTally["kinds"])[])
        into.kinds[kind] += from.kinds[kind];
    into.supported += from.supported;
    into.conflict += from.conflict;
    into.notEstablished += from.notEstablished;
    into.unchecked += from.unchecked;
    into.restricted += from.restricted;
    into.inspectionOnly += from.inspectionOnly;
    for (const use of Object.keys(
        into.effectiveUses,
    ) as (keyof DocumentaryContributionTally["effectiveUses"])[])
        into.effectiveUses[use] += from.effectiveUses[use];
    return into;
}

function hostOf(url: string) {
    try {
        return new URL(url).hostname.replace(/^www\./, "");
    } catch {
        return url;
    }
}

async function sourceRows(
    ctx: QueryCtx,
    context: NonNullable<Awaited<ReturnType<typeof missionContext>>>,
) {
    const { run, preparation, data, reads, controlled } = context;
    const limit = sourceDossierCandidateLimit(run.sourcePreparationId);
    const records = await ctx.db
        .query("sources")
        .withIndex("by_run_and_url", (q) => q.eq("runId", run._id))
        .take(limit + 1);
    if (records.length > limit)
        throw new Error("Source projection exceeds dossier capacity");
    const company = mergeRunCompanyMetadata(
        run.companySnapshot,
        run.companyId ? await ctx.db.get(run.companyId) : null,
    );
    const qualifications = latestSourceQualifications(controlled);
    return Promise.all(
        records.map(async (source) => {
            const capture = await sourceCaptureState(ctx, source._id);
            const qualification = qualifications.get(source._id);
            const decision =
                qualification?.sourceDecision ??
                (await reads.decision(
                    preparation.corpusRevisionId,
                    source._id,
                ));
            const classified = classifySourceCandidate(
                {
                    sourceId: source._id,
                    canonicalUrl: source.canonicalUrl,
                    title: source.title,
                    origin: source.origin,
                    category: source.category,
                    publishedAt: source.publishedAt,
                    providerReference: source.providerReference,
                    secForm: source.secForm,
                    secAccessionNumber: source.secAccessionNumber,
                    providerResultPosition: source.providerResultPosition,
                    discoveryQueryIndex: source.discoveryQueryIndex,
                    createdAt: source.createdAt,
                },
                company,
            );

            return {
                sourceId: source._id,
                title: source.title,
                url: source.canonicalUrl,
                host: hostOf(source.canonicalUrl),
                origin: source.origin,
                ...(source.publishedAt !== undefined
                    ? { publishedAt: source.publishedAt }
                    : {}),
                ...(source.secForm ? { secForm: source.secForm } : {}),
                family: classified.sourceFamily,
                documentKind: classified.documentKind,
                authorityTier: classified.authorityTier,
                reading: captureAvailability(capture),
                ...projectSourceDocumentState({
                    preparationId: preparation._id,
                    sourceId: source._id,
                    capture: capture.committed
                        ? {
                              captureId: capture.committed._id,
                              contentHash:
                                  capture.committed.contentHash ?? null,
                          }
                        : null,
                    result: data.result,
                    decision,
                    qualifications: controlled,
                }),
            };
        }),
    );
}

/** Needs, questions and preparation figures for the Sources overview; null for dossiers without the Sources protocol. */
export const overview = query({
    args: { runId: v.id("researchRuns") },
    returns: v.union(v.null(), overviewValidator),
    handler: async (ctx, args) => {
        const context = await missionContext(ctx, args.runId);
        if (!context) return null;
        const { run, preparation, data, controlled } = context;
        const research = await readResearchState(ctx, run);
        const mission = await readSourcesMission(ctx, run);
        const phase = sourcesPreparationPhase(run, preparation, mission);
        // Needs without a handed-off result are on hold only while research can still resume.
        const unsettledOutcome =
            phase === "collecting"
                ? ("in_progress" as const)
                : isResumableResearchPause(run)
                  ? ("on_hold" as const)
                  : ("unfinished" as const);
        const framingId =
            run.fixedFramingRevisionId ?? run.currentFramingRevisionId;
        const framing = framingId ? await ctx.db.get(framingId) : null;
        const rows = await sourceRows(ctx, context);
        const contributions = controlled.flatMap(
            (qualification) => qualification.contributions,
        );
        const result = data.result;
        const coverage = await readSourcesCoverage(ctx, preparation);
        const retainedStates = (result?.documents ?? [])
            .map((document) => {
                const qualification = controlled.find(
                    (item) =>
                        item.taskId === document.qualificationTaskId &&
                        item.version === document.qualificationVersion &&
                        item.sourceId === document.sourceId &&
                        item.captureId === document.captureId &&
                        item.contentHash === document.contentHash,
                );
                if (!qualification)
                    throw executionError("qualification_invalid");
                return projectSourceDocumentState({
                    preparationId: preparation._id,
                    sourceId: document.sourceId,
                    capture: {
                        captureId: document.captureId,
                        contentHash: document.contentHash,
                    },
                    result,
                    decision: qualification.sourceDecision,
                    qualifications: [qualification],
                });
            })
            .filter((state) => state.membership === "retained");
        const needs = data.needs.map((need) => {
            const served = contributions.filter((contribution) =>
                contribution.needIds.includes(need.id),
            );
            const sources = new Set(
                controlled
                    .filter((qualification) =>
                        qualification.contributions.some((contribution) =>
                            contribution.needIds.includes(need.id),
                        ),
                    )
                    .map((qualification) => qualification.sourceId),
            );
            const outcome = result?.needs.find(
                (entry) => entry.needId === need.id,
            );
            const outcomeTasks = new Set(
                outcome?.contributions.map(
                    (entry) => entry.qualificationTaskId,
                ),
            );
            return {
                id: need.id,
                information: need.information,
                questionIds: need.commonContext ? [] : need.questionIds,
                outcome: !outcome
                    ? unsettledOutcome
                    : outcome.unfinished.length
                      ? ("unfinished" as const)
                      : outcome.contributions.length
                        ? ("prepared" as const)
                        : ("gap" as const),
                ...(outcome?.gap ? { gap: outcome.gap } : {}),
                unfinished: outcome?.unfinished ?? [],
                documents: outcome
                    ? new Set(
                          outcome.contributions.map(
                              (entry) => entry.qualificationTaskId,
                          ),
                      ).size
                    : sources.size,
                sourceIds: outcome
                    ? (result?.documents ?? [])
                          .filter((document) =>
                              outcomeTasks.has(document.qualificationTaskId),
                          )
                          .map((document) => document.sourceId)
                    : [...sources],
                contributions: outcome
                    ? outcome.contributions.length
                    : served.length,
                conflicts: served.filter(
                    (contribution) =>
                        contribution.finding?.conclusion ===
                        "documentary_conflict",
                ).length,
            };
        });
        const count = (predicate: (row: (typeof rows)[number]) => boolean) =>
            rows.filter(predicate).length;
        return {
            research,
            researchSummary: formatResearchSummary(research),
            currentStop: sourcesCurrentStop(research),
            preparationId: preparation._id,
            preparationStatus: preparation.status,
            ...(mission ? { missionStatus: mission.status } : {}),
            materialOutcome: result?.outcome ?? null,
            ...(coverage ? { coverage } : {}),
            questions:
                framing?.content.questions.map(({ id, text, shortLabel }) => ({
                    id,
                    text,
                    shortLabel,
                })) ?? [],
            needs,
            collect: {
                candidates: rows.length,
                failedFamilies: preparation.failedDiscoveryFamilies,
                searches: data.searches,
                acquisitions: data.acquisitions,
            },
            reading: {
                captured: count((row) => row.capture !== null),
                full: count((row) => row.reading === "full"),
                partial: count((row) => row.reading === "partial"),
                unknown: count((row) => row.reading === "unknown"),
                unavailable: count((row) => row.reading === "unavailable"),
                capturing: count((row) => row.reading === "capturing"),
                notCaptured: count((row) => row.reading === "not_captured"),
            },
            contributions: tallyDocumentaryContributions(contributions),
            retainedContributions: retainedStates.reduce(
                (into, state) => addTally(into, state.contributions),
                tallyDocumentaryContributions([]),
            ),
            organize: {
                retained: count((row) => row.membership === "retained"),
                contextOnly: retainedStates.filter((state) => state.contextOnly)
                    .length,
                notRetained: count((row) => row.membership === "not_retained"),
                notRetainedCaptured: count(
                    (row) =>
                        row.membership === "not_retained" &&
                        row.capture !== null,
                ),
                notRetainedWithoutAvailableCapture: count(
                    (row) =>
                        row.membership === "not_retained" &&
                        row.capture === null,
                ),
                excluded: count((row) => row.membership === "excluded"),
                restricted: data.restrictedContributions.length,
            },
        };
    },
});

/** Every source of a Sources-protocol dossier with reading, contribution and membership kept as separate facts. */
export const listSources = query({
    args: { runId: v.id("researchRuns") },
    returns: v.union(v.null(), v.array(sourceRowValidator)),
    handler: async (ctx, args) => {
        const context = await missionContext(ctx, args.runId);
        return context ? sourceRows(ctx, context) : null;
    },
});

/** One source for the reader: cited excerpts with their neighbours, contributions and observed links. */
export const getSource = query({
    args: { runId: v.id("researchRuns"), sourceId: v.id("sources") },
    returns: v.union(v.null(), readerValidator),
    handler: async (ctx, args) => {
        const context = await missionContext(ctx, args.runId);
        if (!context) return null;
        const row = (await sourceRows(ctx, context)).find(
            (entry) => entry.sourceId === args.sourceId,
        );
        if (!row) return null;
        const { run, preparation, controlled } = context;
        const qualification = latestSourceQualifications(controlled).get(
            args.sourceId,
        );
        const state = await sourceCaptureState(ctx, args.sourceId);
        const capture =
            (qualification
                ? await ctx.db.get(qualification.captureId)
                : state.committed) ?? null;
        const index = capture
            ? await findCaptureIndex(ctx.db, preparation, capture._id)
            : null;
        if (index && index.contentHash !== capture?.contentHash)
            throw executionError("capture_identity_conflict");
        const scopeKey = index?.scopeKey ?? sourceCaptureScopeKey(run._id);
        const cited = new Set(
            qualification?.contributions.flatMap((contribution) =>
                contribution.evidence.map((evidence) => evidence.passageOrder),
            ) ?? [],
        );
        let passages: Doc<"sourceSearchPassages">[] = [];
        if (capture && cited.size) {
            const orders = new Set<number>();
            for (const order of cited)
                for (
                    let offset = -SOURCES_READER_CONTEXT_PASSAGES;
                    offset <= SOURCES_READER_CONTEXT_PASSAGES;
                    offset++
                )
                    if (order + offset >= 0) orders.add(order + offset);
            const sorted = [...orders].sort((a, b) => a - b);
            const runs: [number, number][] = [];
            for (const order of sorted) {
                const last = runs.at(-1);
                if (last && last[1] + 1 === order) last[1] = order;
                else runs.push([order, order]);
            }
            for (const [first, last] of runs)
                passages.push(
                    ...(await ctx.db
                        .query("sourceSearchPassages")
                        .withIndex("by_scope_capture_order", (q) =>
                            q
                                .eq("scopeKey", scopeKey)
                                .eq("captureId", capture._id)
                                .gte("order", first)
                                .lte("order", last),
                        )
                        .take(last - first + 1)),
                );
        } else if (capture)
            passages = await ctx.db
                .query("sourceSearchPassages")
                .withIndex("by_scope_capture_order", (q) =>
                    q.eq("scopeKey", scopeKey).eq("captureId", capture._id),
                )
                .take(SOURCES_READER_OPENING_PASSAGES);
        // Contiguous passages form one excerpt; a gap in order starts the next.
        const sections: {
            id: string;
            heading?: string;
            passages: { order: number; quotation: string }[];
        }[] = [];
        let previous: number | undefined;
        for (const passage of passages) {
            const heading = passage.headingPath.at(-1);
            const current = sections.at(-1);
            if (
                !current ||
                previous === undefined ||
                passage.order !== previous + 1
            )
                sections.push({
                    id: `excerpt-${passage.order}`,
                    ...(heading ? { heading } : {}),
                    passages: [],
                });
            sections.at(-1)?.passages.push({
                order: passage.order,
                quotation: passage.quotation,
            });
            previous = passage.order;
        }
        const observedLinks = await Promise.all(
            (capture?.observedDestinations ?? []).map(async (link, index) => {
                const destination = await ctx.db
                    .query("sources")
                    .withIndex("by_run_and_url", (q) =>
                        q.eq("runId", run._id).eq("canonicalUrl", link.url),
                    )
                    .first();
                const captured = destination
                    ? !!(await sourceCaptureState(ctx, destination._id))
                          .committed
                    : false;
                return {
                    index,
                    url: link.url,
                    originText: link.originText,
                    captured,
                };
            }),
        );
        return {
            source: {
                ...row,
                reading: captureAvailability(
                    capture
                        ? {
                              committed: capture,
                              capturing: false,
                              unavailable: false,
                          }
                        : state,
                ),
                ...projectSourceDocumentState({
                    preparationId: preparation._id,
                    sourceId: args.sourceId,
                    capture: capture
                        ? {
                              captureId: capture._id,
                              contentHash: capture.contentHash ?? null,
                          }
                        : null,
                    result: preparation.sourcesMission?.result,
                    decision:
                        qualification?.sourceDecision ??
                        (await context.reads.decision(
                            preparation.corpusRevisionId,
                            args.sourceId,
                        )),
                    qualifications: controlled,
                }),
            },
            capture: capture
                ? {
                      captureId: capture._id,
                      ...(capture.mediaType
                          ? { mediaType: capture.mediaType }
                          : {}),
                      ...(capture.retrievedAt !== undefined
                          ? { retrievedAt: capture.retrievedAt }
                          : {}),
                      ...(capture.omittedPassageCount !== undefined
                          ? { omittedPassageCount: capture.omittedPassageCount }
                          : {}),
                  }
                : null,
            excerpts: !passages.length
                ? ("none" as const)
                : cited.size
                  ? ("cited" as const)
                  : ("opening" as const),
            sections,
            contributions:
                qualification?.contributions.map((contribution) => ({
                    id: contribution.id,
                    version: contribution.version,
                    kind: contribution.kind,
                    statement: contribution.statement,
                    period: contribution.period,
                    attribution: contribution.attribution,
                    needIds: contribution.needIds,
                    passageOrders: contribution.evidence.map(
                        (evidence) => evidence.passageOrder,
                    ),
                    permittedUse: contribution.permittedUse,
                    ...(contribution.finding
                        ? {
                              conclusion: contribution.finding.conclusion,
                              diagnostic: contribution.finding.diagnostic,
                              ...("reportedUse" in contribution.finding
                                  ? {
                                        reportedUse:
                                            contribution.finding.reportedUse,
                                    }
                                  : {}),
                          }
                        : {}),
                    restricted: contribution.restrictions.length > 0,
                })) ?? [],
            coherence: qualification?.coherence ?? null,
            observedLinks,
        };
    },
});
