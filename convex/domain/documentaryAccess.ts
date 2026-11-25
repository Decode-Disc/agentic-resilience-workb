import { internal } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import type { QueryCtx } from "@convex/_generated/server";
import type { AnalystTurnWording } from "@convex/domain/preparedAnalystWording";
import { requireMissionAuthority } from "@convex/execution/authority";
import { conversationInstructions } from "@convex/execution/conversations";
import { executionError } from "@convex/execution/errors";
import { operationHasStarted } from "@convex/execution/executionProtocol";
import { missionScope } from "@convex/execution/missionData";
import {
    EXA_NORMALIZER_VERSION,
    QUALIFICATION_NORMALIZER_VERSION,
    SEC_NORMALIZER_VERSION,
} from "@convex/integrations/evidenceNormalization";
import { EXA_RETRIEVAL_VERSION } from "@convex/integrations/exaEvidence";
import { validate } from "convex-helpers/validators";
import { mergeRunCompanyMetadata } from "./companyMetadata";
import { SEC_RETRIEVAL_VERSION } from "./evidenceArtifacts";
import {
    documentaryReference,
    parseDocumentaryReference,
    referencedContextResult,
} from "./savedMaterialOperations";
import { sha256Hex, stableStringify } from "./sourcePassages";
import { readPreparationSourceDecision } from "./sourcePreparationAuthority";
import { requireSourcesPreparation } from "./sources";
import {
    explicitFramingPreservation,
    explicitResearchCommand,
    framingObservationRefusal,
    publicSearchOutcomeValidator,
} from "./workbenchContracts";

export const PINNED_PUBLIC_RETRIEVAL_VERSION = "pinned-public-document-v1";

function acquisitionIdentity(
    canonicalUrl: string,
    cik: string,
    retrievalVersion: string,
    normalizerVersion: string,
    refreshFrom?: Id<"sourceCaptures">,
) {
    return sha256Hex(
        stableStringify({
            canonicalUrl,
            cik,
            retrievalVersion,
            normalizerVersion,
            ...(refreshFrom ? { refreshFrom } : {}),
        }),
    );
}

/** Resolves a destination recorded on a capture available to this preparation. */
export async function sourcesObservedDestination(
    ctx: QueryCtx,
    state: Awaited<ReturnType<typeof requireSourcesPreparation>>,
    captureId: Id<"sourceCaptures"> | undefined,
    index: number | undefined,
) {
    if (
        !captureId ||
        !state.data.captureIds.includes(captureId) ||
        index === undefined ||
        !Number.isSafeInteger(index) ||
        index < 0
    )
        throw executionError("observed_destination_unavailable");
    const capture = await ctx.db.get(captureId);
    const destination = capture?.observedDestinations?.[index];
    if (
        capture?.runId !== state.run._id ||
        capture.status !== "committed" ||
        !destination ||
        !canonicalFramingUrl(destination.url) ||
        (await readPreparationSourceDecision(ctx.db, {
            runId: state.run._id,
            corpusRevisionId: state.revision._id,
            sourceId: capture.sourceId,
        })) === "rejected"
    )
        throw executionError("observed_destination_unavailable");
    return {
        url: destination.url,
        providerReference: `capture:${captureId}:link:${index}`,
    };
}

export async function resolveSourcesAcquisition(
    ctx: QueryCtx,
    mission: Doc<"agentMissions">,
    token: string,
) {
    const scope = missionScope(mission);
    if (scope.kind !== "sources_v1")
        throw executionError("operation_not_allowed");
    const state = await requireSourcesPreparation(ctx, scope.preparationId);
    const company = mergeRunCompanyMetadata(
        state.run.companySnapshot,
        state.run.companyId ? await ctx.db.get(state.run.companyId) : null,
    );
    if (state.run._id !== mission.runId || !company)
        throw executionError("sources_scope_invalid");
    const reference = parseDocumentaryReference(token);
    let source: Doc<"sources"> | null = null;
    let observed:
        | Awaited<ReturnType<typeof sourcesObservedDestination>>
        | undefined;
    let refreshFrom: Id<"sourceCaptures"> | undefined;
    if (reference?.issuer === "source") {
        const sourceId = ctx.db.normalizeId("sources", reference.sourceId);
        source = sourceId ? await ctx.db.get(sourceId) : null;
    } else if (
        reference?.issuer === "capture_refresh" &&
        !reference.conversationCause
    ) {
        const captureId = ctx.db.normalizeId(
            "sourceCaptures",
            reference.captureId,
        );
        const capture = captureId ? await ctx.db.get(captureId) : null;
        if (
            capture?.runId !== state.run._id ||
            capture.status !== "committed" ||
            !capture.storageId ||
            !capture.contentHash ||
            !state.data.captureIds.includes(capture._id)
        )
            throw executionError("source_reference_not_observed");
        refreshFrom = capture._id;
        source = await ctx.db.get(capture.sourceId);
    } else if (
        reference?.issuer === "operation" &&
        reference.item === "destination"
    ) {
        const requestId = ctx.db.normalizeId(
            "agentOperationRequests",
            reference.operationId,
        );
        const issuer = requestId ? await ctx.db.get(requestId) : null;
        if (
            issuer?.runId !== state.run._id ||
            issuer.missionId !== mission._id ||
            issuer.expectedGeneration !== mission.generation ||
            issuer.adoptedAt === undefined ||
            issuer.input.kind !== "read_in_context" ||
            issuer.outcome?.kind !== "success"
        )
            throw executionError("observed_destination_unavailable");
        const result: unknown = JSON.parse(issuer.outcome.valueJson);
        if (
            !validate(referencedContextResult, result, { db: ctx.db }) ||
            !result.observedDestinations?.some(
                (item) =>
                    item.acquisitionReference ===
                    documentaryReference({
                        issuer: "operation",
                        operationId: issuer._id,
                        item: "destination",
                        index: reference.index,
                    }),
            )
        )
            throw executionError("observed_destination_unavailable");
        const destination = await sourcesObservedDestination(
            ctx,
            state,
            result.captureId,
            reference.index,
        );
        observed = destination;
        source = await ctx.db
            .query("sources")
            .withIndex("by_run_and_url", (q) =>
                q
                    .eq("runId", state.run._id)
                    .eq("canonicalUrl", destination.url),
            )
            .unique();
    }
    if (
        (!observed && source?.runId !== state.run._id) ||
        (source && source.runId !== state.run._id)
    )
        throw executionError("source_reference_not_observed");
    if (
        source &&
        (await readPreparationSourceDecision(ctx.db, {
            runId: state.run._id,
            corpusRevisionId: state.revision._id,
            sourceId: source._id,
        })) === "rejected"
    )
        throw executionError("source_rejected");
    const canonicalUrl = observed?.url ?? source?.canonicalUrl;
    if (!canonicalUrl) throw executionError("source_reference_not_observed");
    const isSec = source?.origin === "sec";
    const normalizerVersion = `${isSec ? SEC_NORMALIZER_VERSION : EXA_NORMALIZER_VERSION}+${QUALIFICATION_NORMALIZER_VERSION}`;
    const requestInputHash = acquisitionIdentity(
        canonicalUrl,
        company.cik,
        isSec ? SEC_RETRIEVAL_VERSION : EXA_RETRIEVAL_VERSION,
        normalizerVersion,
        refreshFrom,
    );
    return {
        ...state,
        source,
        observed,
        normalizerVersion,
        pin: {
            kind: "documentary_v1",
            scope: {
                kind: "sources",
                preparationId: state.preparation._id,
                needsRevision: state.data.needsRevision,
            },
            target: { kind: "acquisition", canonicalUrl, requestInputHash },
        } as const,
    };
}

export async function requireSourcesAcquisitionRequest(
    ctx: QueryCtx,
    request: Doc<"agentOperationRequests"> | null,
    expectedGeneration: number,
) {
    if (
        !request?.missionId ||
        request.input.kind !== "acquire_document" ||
        !operationHasStarted(request) ||
        request.expectedGeneration !== expectedGeneration ||
        request.pin?.kind !== "documentary_v1" ||
        request.pin.scope.kind !== "sources"
    )
        throw executionError("operation_not_dispatched");
    const { mission } = await requireMissionAuthority(
        ctx,
        request.missionId,
        expectedGeneration,
    );
    const target = await resolveSourcesAcquisition(
        ctx,
        mission,
        request.input.reference,
    );
    if (
        request.runId !== target.run._id ||
        stableStringify(request.pin) !== stableStringify(target.pin)
    )
        throw executionError("sources_version_conflict");
    return target;
}

/** An operation-owned attachment remains protected while its admitted worker can still use it. */
export async function activeDocumentaryCaptureOwner(
    ctx: QueryCtx,
    capture: Doc<"sourceCaptures">,
) {
    if (!capture.operationRequestId) return false;
    const request = await ctx.db.get(capture.operationRequestId);
    if (
        !request?.missionId ||
        request.runId !== capture.runId ||
        request.expectedGeneration !== capture.executionGeneration ||
        !operationHasStarted(request)
    )
        return false;
    const mission = await ctx.db.get(request.missionId);
    if (
        !mission ||
        mission.generation !== request.expectedGeneration ||
        mission.deadlineAt <= Date.now() ||
        ["blocked", "cancelled", "completed"].includes(mission.status)
    )
        return false;
    if (mission.conversationTurnId) {
        const turn = await ctx.db.get(mission.conversationTurnId);
        return (
            turn?.status === "active" &&
            turn.missionId === mission._id &&
            turn.instructionVersion === request.instructionVersion
        );
    }
    const run = await ctx.db.get(capture.runId);
    return (
        run?.executionStatus === "running" &&
        run.executionGeneration === request.expectedGeneration
    );
}

/** A Start handoff exposes committed framing captures without granting evidence membership. */
export async function reusableFramingCaptureIds(
    ctx: QueryCtx,
    run: Doc<"researchRuns">,
    corpusRevisionId: Id<"corpusRevisions">,
) {
    if (!run.fixedFramingRevisionId || run.researchStartedAt === undefined)
        return [];
    const result: Id<"sourceCaptures">[] = [];
    const committed = ctx.db
        .query("sourceCaptures")
        .withIndex("by_run_and_status", (q) =>
            q.eq("runId", run._id).eq("status", "committed"),
        );
    for await (const capture of committed) {
        if (
            capture.protocol !== "documentary_v1" ||
            capture.corpusRevisionId !== corpusRevisionId ||
            !capture.storageId ||
            !capture.contentHash ||
            !capture.document ||
            capture.preparationId !== undefined ||
            capture.updatedAt > run.researchStartedAt
        )
            continue;
        const source = await ctx.db.get(capture.sourceId);
        if (
            source?.runId === run._id &&
            (await ctx.db.system.get("_storage", capture.storageId)) &&
            (await readPreparationSourceDecision(ctx.db, {
                runId: run._id,
                corpusRevisionId,
                sourceId: capture.sourceId,
            })) !== "rejected"
        )
            result.push(capture._id);
    }
    return result;
}

export function canonicalFramingUrl(value: string) {
    try {
        const url = new URL(value);
        if (
            url.protocol !== "https:" ||
            url.username ||
            url.password ||
            (url.port && url.port !== "443")
        )
            return undefined;
        url.hash = "";
        return url.toString();
    } catch {
        return undefined;
    }
}

export function confirmedFramingFiling(canonicalUrl: string, cik: string) {
    const url = new URL(canonicalUrl);
    const cleanCik = cik.replace(/^0+/u, "");
    const filing =
        /^\/Archives\/edgar\/data\/(\d+)\/(\d{18})\/[^/]+\.(?:htm|html|txt)$/u.exec(
            url.pathname,
        );
    return url.hostname === "www.sec.gov" &&
        filing?.[1] === cleanCik &&
        filing[2] &&
        !url.search
        ? { cik: cleanCik, accession: filing[2] }
        : undefined;
}

export function framingMessageUrls(text: string) {
    return [
        ...new Set(
            (text.match(/https:\/\/[^\s<>()[\]{}"']+/giu) ?? []).flatMap(
                (link) => {
                    const url = canonicalFramingUrl(
                        link.replace(/[.,;!?]+$/u, ""),
                    );
                    return url ? [url] : [];
                },
            ),
        ),
    ];
}

export function messageSuppliesFramingUrl(text: string, canonicalUrl: string) {
    return framingMessageUrls(text).includes(canonicalUrl);
}

/** Resolve only a lead actually returned by the selected, adopted discovery. */
export async function observedFramingCandidate(
    ctx: QueryCtx,
    searchId: Id<"agentOperationRequests">,
    index: number,
    cause: Parameters<typeof framingObservationRefusal>[1],
) {
    const search = await ctx.db.get(searchId);
    const refusal = framingObservationRefusal(search, cause);
    if (refusal) throw executionError(refusal);
    if (
        search?.input.kind !== "search_public_context" ||
        search.outcome?.kind !== "success"
    )
        throw executionError("source_reference_not_observed");
    const result: unknown = JSON.parse(search.outcome.valueJson);
    if (
        !validate(publicSearchOutcomeValidator, result) ||
        result.searchId !== search._id
    )
        throw executionError("source_reference_not_observed");
    if (!Number.isSafeInteger(index) || index < 0 || !result.candidates[index])
        throw executionError("source_candidate_invalid");
    return result.candidates[index];
}

type CompleteTurnInstructions = NonNullable<
    Awaited<ReturnType<typeof conversationInstructions>>
>;

/** Binds a conversation reading to its current draft or to the fixed material view. */
export async function workbenchDocumentaryContext<
    Wording extends
        | CompleteTurnInstructions
        | AnalystTurnWording = CompleteTurnInstructions,
>(
    ctx: QueryCtx,
    mission: Doc<"agentMissions">,
    instructionTexts?: Map<Id<"agentMessageDeliveries">, string>,
    preparedWording?: Wording,
) {
    const run = await ctx.db.get(mission.runId);
    if (mission.definitionId !== "workbench_v1")
        throw executionError("operation_not_allowed");
    if (!run?.activeCorpusRevisionId)
        throw executionError("documentary_material_unavailable");
    const company = mergeRunCompanyMetadata(
        run.companySnapshot,
        run.companyId ? await ctx.db.get(run.companyId) : null,
    );
    if (!company) throw executionError("documentary_material_unavailable");
    const corpusRevisionId = run.activeCorpusRevisionId;
    const revision = await ctx.db.get(corpusRevisionId);
    if (revision?.runId !== run._id)
        throw executionError("capture_identity_conflict");
    const framing =
        run.lifecycleState === "framing" &&
        run.researchStartedAt === undefined &&
        run.currentFramingRevisionId;
    const preparation =
        !framing &&
        run.sourcesProtocol === "sources_mission_v1" &&
        run.sourcePreparationId
            ? await ctx.db.get(run.sourcePreparationId)
            : null;
    if (
        !framing &&
        !run.fixedFramingRevisionId &&
        (run.sourcesProtocol === "sources_mission_v1"
            ? !preparation
            : revision.status !== "approved")
    )
        throw executionError("documentary_material_unavailable");
    if (
        preparation &&
        (preparation.runId !== run._id ||
            preparation.corpusRevisionId !== corpusRevisionId)
    )
        throw executionError("capture_identity_conflict");
    if (
        !framing &&
        run.sourcesProtocol !== "sources_mission_v1" &&
        revision.status !== "approved"
    )
        throw executionError("documentary_material_unavailable");
    const instructions =
        preparedWording ??
        (await conversationInstructions(ctx, mission, instructionTexts));
    const turn = instructions ? await ctx.db.get(instructions.turnId) : null;
    if (
        !instructions ||
        turn?.responseControl?.correction?.instructionVersion ===
            instructions.instructionVersion ||
        (framing &&
            instructions.messages.some((message) =>
                "preservesFraming" in message
                    ? message.preservesFraming
                    : explicitFramingPreservation(message.text),
            ))
    )
        throw executionError("instruction_not_authorized");
    return {
        run,
        instructions,
        mission,
        company,
        corpusRevisionId,
        preparation,
        scope: framing
            ? { kind: "framing" as const, revisionId: framing }
            : {
                  kind: "workbench_read" as const,
                  corpusRevisionId,
                  ...(preparation ? { preparationId: preparation._id } : {}),
              },
    };
}

export async function documentaryMaterialContext<
    Wording extends
        | CompleteTurnInstructions
        | AnalystTurnWording = CompleteTurnInstructions,
>(
    ctx: QueryCtx,
    mission: Doc<"agentMissions">,
    instructionTexts?: Map<Id<"agentMessageDeliveries">, string>,
    preparedWording?: Wording,
) {
    if (mission.definitionId === "workbench_v1")
        return workbenchDocumentaryContext(
            ctx,
            mission,
            instructionTexts,
            preparedWording,
        );
    const scope = missionScope(mission);
    if (scope.kind === "sources_v1") {
        const view = await requireSourcesPreparation(ctx, scope.preparationId);
        if (view.run._id !== mission.runId)
            throw executionError("sources_scope_invalid");
        return {
            run: view.run,
            mission,
            corpusRevisionId: view.revision._id,
            preparation: view.preparation,
            scope: {
                kind: "sources" as const,
                preparationId: view.preparation._id,
                needsRevision: view.data.needsRevision,
            },
        };
    }
    if (scope.kind !== "saved_material_inspection_v1")
        throw executionError("operation_not_allowed");
    const run = await ctx.db.get(mission.runId);
    if (!run) throw executionError("not_authorized");
    const revision = await requireSavedMaterialScope(ctx, mission, run);
    return {
        run,
        mission,
        corpusRevisionId: revision._id,
        preparation: null,
        scope: { kind: "inspection" as const, corpusRevisionId: revision._id },
    };
}

export async function documentaryCaptureAvailable(
    ctx: QueryCtx,
    view: Omit<
        Awaited<ReturnType<typeof documentaryMaterialContext>>,
        "instructions"
    >,
    capture: Doc<"sourceCaptures">,
) {
    if (
        capture.status !== "committed" ||
        capture.runId !== view.run._id ||
        !capture.storageId ||
        !capture.contentHash
    )
        return false;
    if (view.scope.kind === "framing")
        return (
            capture.protocol === "documentary_v1" &&
            capture.corpusRevisionId === view.corpusRevisionId
        );
    const decision = await readPreparationSourceDecision(ctx.db, {
        runId: view.run._id,
        corpusRevisionId: view.corpusRevisionId,
        sourceId: capture.sourceId,
    });
    if (decision === "rejected") return false;
    if (
        view.scope.kind === "workbench_read" &&
        capture.retainedImport &&
        view.run.sourcesProtocol === "sources_mission_v1"
    )
        return true;
    if (
        view.scope.kind === "sources" ||
        (view.scope.kind === "workbench_read" &&
            view.run.sourcesProtocol === "sources_mission_v1")
    )
        return (
            view.preparation?.sourcesMission?.captureIds.includes(
                capture._id,
            ) ?? false
        );
    const approved = await ctx.runQuery(
        internal.sourceRetrieval.approvedCaptureForMission,
        {
            missionId: view.mission._id,
            expectedGeneration: view.mission.generation,
            sourceId: capture.sourceId,
        },
    );
    return (
        approved.status === "available" && approved.capture._id === capture._id
    );
}

/** Historical text was already acquired for the dossier. Current approval and source restrictions still apply. */
export async function retainedDocumentAvailable(
    ctx: QueryCtx,
    view: Omit<
        Awaited<ReturnType<typeof documentaryMaterialContext>>,
        "instructions"
    >,
    canonicalUrl: string,
) {
    const source = await ctx.db
        .query("sources")
        .withIndex("by_run_and_url", (q) =>
            q.eq("runId", view.run._id).eq("canonicalUrl", canonicalUrl),
        )
        .first();
    if (view.scope.kind === "framing") return { source };
    if (
        view.scope.kind === "inspection" ||
        (view.scope.kind === "workbench_read" &&
            view.run.sourcesProtocol !== "sources_mission_v1")
    )
        return null;
    if (
        source &&
        (await readPreparationSourceDecision(ctx.db, {
            runId: view.run._id,
            corpusRevisionId: view.corpusRevisionId,
            sourceId: source._id,
        })) === "rejected"
    )
        return null;
    return { source };
}

/** Resolve an acquisition from active instructions before any source mutation or network access. */
export async function resolveFramingAcquisition(
    ctx: QueryCtx,
    mission: Doc<"agentMissions">,
    token: string,
) {
    const frame = await workbenchDocumentaryContext(ctx, mission);
    const { run, instructions, company, scope, corpusRevisionId } = frame;
    if (scope.kind !== "framing") throw executionError("framing_fixed");
    const parsed = parseDocumentaryReference(token);
    let canonicalUrl: string | undefined;
    let messageId: Id<"agentMessageDeliveries"> | undefined;
    let refresh: Doc<"sources"> | null = null;
    let refreshFrom: Id<"sourceCaptures"> | undefined;
    let candidate:
        | Awaited<ReturnType<typeof observedFramingCandidate>>
        | undefined;
    if (parsed?.issuer === "operation" && parsed.item === "candidate") {
        const searchId = ctx.db.normalizeId(
            "agentOperationRequests",
            parsed.operationId,
        );
        const search = searchId ? await ctx.db.get(searchId) : null;
        if (search?.input.kind !== "search_public_context")
            throw executionError("source_reference_not_observed");
        messageId = search.input.messageId;
        candidate = await observedFramingCandidate(
            ctx,
            search._id,
            parsed.index,
            {
                runId: run._id,
                missionId: mission._id,
                instructionVersion: instructions.instructionVersion,
                messageId,
            },
        );
        canonicalUrl = canonicalFramingUrl(candidate.url);
    } else if (parsed?.issuer === "capture_refresh") {
        const cause = parsed.conversationCause;
        const captureId = ctx.db.normalizeId(
            "sourceCaptures",
            parsed.captureId,
        );
        const capture = captureId ? await ctx.db.get(captureId) : null;
        if (
            !cause ||
            cause.instructionVersion !== instructions.instructionVersion ||
            !capture ||
            !(await documentaryCaptureAvailable(ctx, frame, capture))
        )
            throw executionError("source_reference_not_observed");
        refresh = await ctx.db.get(capture.sourceId);
        if (
            refresh?.runId !== run._id ||
            refresh.canonicalUrl !== capture.requestedUrl
        )
            throw executionError("source_reference_not_observed");
        messageId = cause.messageId;
        canonicalUrl = canonicalFramingUrl(refresh.canonicalUrl);
        refreshFrom = capture._id;
    } else if (parsed?.issuer === "analyst_url") {
        messageId = parsed.messageId;
        canonicalUrl = canonicalFramingUrl(parsed.url);
    } else if (!parsed) {
        canonicalUrl = canonicalFramingUrl(token);
        if (instructions.messages.length === 1)
            messageId = instructions.messages[0]?.messageId;
    }
    const message = instructions.messages.find(
        (entry) => entry.messageId === messageId,
    );
    if (
        !canonicalUrl ||
        !message ||
        explicitResearchCommand(message.text) ||
        (!candidate &&
            !refresh &&
            !messageSuppliesFramingUrl(message.text, canonicalUrl))
    )
        throw executionError("source_reference_not_observed");

    const confirmedSec = confirmedFramingFiling(canonicalUrl, company.cik);
    const origin: Doc<"sources">["origin"] = confirmedSec
        ? "sec"
        : candidate || refresh?.origin === "exa"
          ? "exa"
          : "analyst_url";
    const retrievalVersion =
        origin === "sec"
            ? SEC_RETRIEVAL_VERSION
            : origin === "exa"
              ? EXA_RETRIEVAL_VERSION
              : PINNED_PUBLIC_RETRIEVAL_VERSION;
    const normalizerVersion = `${origin === "exa" ? EXA_NORMALIZER_VERSION : SEC_NORMALIZER_VERSION}+${QUALIFICATION_NORMALIZER_VERSION}`;
    const requestInputHash = acquisitionIdentity(
        canonicalUrl,
        company.cik,
        retrievalVersion,
        normalizerVersion,
        refreshFrom,
    );
    return {
        run,
        corpusRevisionId,
        pin: {
            kind: "documentary_v1",
            scope: {
                ...scope,
                cause: {
                    messageId: message.messageId,
                    instructionVersion: instructions.instructionVersion,
                },
            },
            target: { kind: "acquisition", canonicalUrl, requestInputHash },
        } as const,
        reference: {
            url: canonicalUrl,
            publishedAt:
                candidate?.publishedAt === undefined
                    ? undefined
                    : Date.parse(candidate.publishedAt),
            confirmedSec,
        },
        title:
            candidate?.title ??
            refresh?.title ??
            new URL(canonicalUrl).hostname,
        selectedCandidate: origin === "exa",
        origin,
        retrievalVersion,
        normalizerVersion,
    };
}

export async function requireFramingAcquisitionRequest(
    ctx: QueryCtx,
    requestId: Id<"agentOperationRequests">,
    expectedGeneration: number,
) {
    const request = await ctx.db.get(requestId);
    if (
        !request?.missionId ||
        request.input.kind !== "acquire_document" ||
        !operationHasStarted(request) ||
        request.expectedGeneration !== expectedGeneration
    )
        throw executionError("request_unavailable");
    const { mission } = await requireMissionAuthority(
        ctx,
        request.missionId,
        expectedGeneration,
    );
    const target = await resolveFramingAcquisition(
        ctx,
        mission,
        request.input.reference,
    );
    if (
        request.runId !== target.run._id ||
        request.instructionVersion !==
            target.pin.scope.cause.instructionVersion ||
        stableStringify(request.pin) !== stableStringify(target.pin)
    )
        throw executionError("version_conflict");
    return { ...target, mission, request };
}

/** The approved-corpus prerequisite belongs to inspection, never to every kind of agent. */
export async function requireSavedMaterialScope(
    ctx: QueryCtx,
    mission: Doc<"agentMissions">,
    run?: Doc<"researchRuns">,
) {
    const scope = missionScope(mission);
    if (
        scope.kind !== "saved_material_inspection_v1" &&
        scope.kind !== "workbench_v1" &&
        scope.kind !== "sources_v1"
    )
        throw executionError("operation_not_allowed");
    const owner = run ?? (await ctx.db.get(mission.runId));
    const corpusRevisionId =
        scope.kind === "saved_material_inspection_v1"
            ? scope.corpusRevisionId
            : owner?.activeCorpusRevisionId;
    const revision = corpusRevisionId
        ? await ctx.db.get(corpusRevisionId)
        : null;
    if (
        revision?.runId !== mission.runId ||
        (revision.status !== "approved" &&
            !(
                owner?.sourcesProtocol === "sources_mission_v1" &&
                scope.kind !== "saved_material_inspection_v1"
            )) ||
        owner?.activeCorpusRevisionId !== revision._id
    )
        throw executionError("corpus_not_approved");
    return revision;
}
