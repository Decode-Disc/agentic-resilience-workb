import type { Doc, Id } from "@convex/_generated/dataModel";
import { type QueryCtx, query } from "@convex/_generated/server";
import { mergeRunCompanyMetadata } from "@convex/domain/companyMetadata";
import { sourceCaptureState } from "@convex/domain/sourceCaptureState";
import { SOURCE_RETRIEVAL_VERSION } from "@convex/domain/sourceRetrievalPolicy";
import { SourceReviewReads } from "@convex/domain/sourceReviewReads";
import {
    classifySourceCandidate,
    sourceAuthorityTierValidator,
    sourceDocumentKindValidator,
    sourceFamilyValidator,
} from "@convex/domain/sourceSelectionPolicy";
import {
    controlledSourcesContributions,
    readSourcesMission,
    sourcesPreparationPhase,
} from "@convex/domain/sources";
import {
    documentaryContributionValidator,
    documentaryFindingValidator,
} from "@convex/domain/sourcesContracts";
import { isResumableResearchPause } from "@convex/domain/transitions";
import { missionStatusValidator } from "@convex/execution/executionProtocol";
import { sourceDossierCandidateLimit } from "@convex/resourceLimits";
import {
    SOURCES_HANDOFF_READ_CAPACITY,
    SOURCES_READER_CONTEXT_PASSAGES,
    SOURCES_READER_OPENING_PASSAGES,
} from "@convex/resourcePolicy";
import { requireWorkspaceRun } from "@convex/runWorkspace";
import schema from "@convex/schema";
import { type Infer, v } from "convex/values";

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
/** Inclusion is separate from reading and contribution: pending until Sources hands off. */
const membershipValidator = v.union(
    v.literal("pending"),
    v.literal("retained"),
    v.literal("not_retained"),
    v.literal("excluded"),
);
const readingValidator = v.union(
    v.literal("full"),
    v.literal("partial"),
    v.literal("capturing"),
    v.literal("unavailable"),
    v.literal("not_captured"),
);
const contributionTallyValidator = v.object({
    total: v.number(),
    kinds: v.object({
        asserted_fact: v.number(),
        attributed_argument: v.number(),
        forecast: v.number(),
        context: v.number(),
    }),
    supported: v.number(),
    conflict: v.number(),
    notEstablished: v.number(),
    unchecked: v.number(),
    restricted: v.number(),
    inspectionOnly: v.number(),
});
type ContributionTally = Infer<typeof contributionTallyValidator>;

const overviewValidator = v.object({
    preparationId: v.id("sourceSelectionProposalRebuilds"),
    preparationStatus,
    missionStatus: v.optional(missionStatusValidator),
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
        unavailable: v.number(),
        capturing: v.number(),
    }),
    contributions: contributionTallyValidator,
    organize: v.object({
        retained: v.number(),
        contextOnly: v.number(),
        notRetained: v.number(),
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
    membership: membershipValidator,
    contextOnly: v.boolean(),
    contributions: v.union(contributionTallyValidator, v.null()),
    limitations: v.array(v.string()),
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

type Controlled = Awaited<ReturnType<typeof controlledSourcesContributions>>;

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

/** The latest qualification per source; earlier versions stay with their owners. */
function latestQualifications(controlled: Controlled) {
    const bySource = new Map<Id<"sources">, Controlled[number]>();
    for (const qualification of controlled) {
        const current = bySource.get(qualification.sourceId);
        if (!current || current.version < qualification.version)
            bySource.set(qualification.sourceId, qualification);
    }
    return bySource;
}

function emptyTally(): ContributionTally {
    return {
        total: 0,
        kinds: {
            asserted_fact: 0,
            attributed_argument: 0,
            forecast: 0,
            context: 0,
        },
        supported: 0,
        conflict: 0,
        notEstablished: 0,
        unchecked: 0,
        restricted: 0,
        inspectionOnly: 0,
    };
}

function tally(
    contributions: Controlled[number]["contributions"],
    into = emptyTally(),
) {
    for (const contribution of contributions) {
        into.total++;
        into.kinds[contribution.kind]++;
        const found = contribution.finding?.conclusion;
        if (found === "supported") into.supported++;
        else if (found === "documentary_conflict") into.conflict++;
        else if (found === "not_established") into.notEstablished++;
        else into.unchecked++;
        if (contribution.restrictions.length) into.restricted++;
        if (contribution.useStatus === "inspection_only") into.inspectionOnly++;
    }
    return into;
}

function membership(
    sourceId: Id<"sources">,
    decision: Controlled[number]["sourceDecision"] | null,
    result: NonNullable<
        Doc<"sourceSelectionProposalRebuilds">["sourcesMission"]
    >["result"],
) {
    if (decision === "rejected") return "excluded" as const;
    if (!result) return "pending" as const;
    return result.documents.some((document) => document.sourceId === sourceId)
        ? ("retained" as const)
        : ("not_retained" as const);
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
    const qualifications = latestQualifications(controlled);
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
            const contributions = qualification
                ? tally(qualification.contributions)
                : null;
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
                reading: capture.committed
                    ? capture.committed.readingCompleteness === "partial" ||
                      capture.committed.representationCompleteness === "partial"
                        ? ("partial" as const)
                        : ("full" as const)
                    : capture.capturing
                      ? ("capturing" as const)
                      : capture.unavailable
                        ? ("unavailable" as const)
                        : ("not_captured" as const),
                membership: membership(source._id, decision, data.result),
                contextOnly:
                    !!qualification?.contributions.length &&
                    qualification.contributions.every(
                        (contribution) =>
                            contribution.permittedUse === "context_only" ||
                            contribution.permittedUse === "blocked",
                    ) &&
                    qualification.contributions.some(
                        (contribution) =>
                            contribution.permittedUse === "context_only",
                    ),
                contributions,
                limitations: qualification?.limitations ?? [],
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
            preparationId: preparation._id,
            preparationStatus: preparation.status,
            ...(mission ? { missionStatus: mission.status } : {}),
            materialOutcome: result?.outcome ?? null,
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
                captured: count(
                    (row) =>
                        row.reading === "full" || row.reading === "partial",
                ),
                full: count((row) => row.reading === "full"),
                partial: count((row) => row.reading === "partial"),
                unavailable: count((row) => row.reading === "unavailable"),
                capturing: count((row) => row.reading === "capturing"),
            },
            contributions: tally(contributions),
            organize: {
                retained: count((row) => row.membership === "retained"),
                contextOnly: count(
                    (row) => row.membership === "retained" && row.contextOnly,
                ),
                notRetained: count((row) => row.membership === "not_retained"),
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
        const qualification = latestQualifications(controlled).get(
            args.sourceId,
        );
        const state = await sourceCaptureState(ctx, args.sourceId);
        const capture =
            (qualification
                ? await ctx.db.get(qualification.captureId)
                : state.committed) ?? null;
        const scopeKey = `${run._id}:${preparation.corpusRevisionId}:${SOURCE_RETRIEVAL_VERSION}`;
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
            source: row,
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
            excerpts: !capture
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
