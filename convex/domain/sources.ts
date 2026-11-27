import type { Doc, Id } from "@convex/_generated/dataModel";
import type { MutationCtx, QueryCtx } from "@convex/_generated/server";
import {
    requireRunAuthority,
    requireSettlementAuthority,
} from "@convex/execution/authority";
import { executionError, executionFailureCode } from "@convex/execution/errors";
import { operationHistoryReference } from "@convex/execution/journal";
import { missionObjectiveKey } from "@convex/execution/missionData";
import {
    CONVEX_MAX_DOCUMENT_BYTES,
    DOCUMENTARY_SEARCH_QUERY_MAX_CHARS,
    MAX_OPERATION_RESULT_BYTES,
    MAX_POLICY_REASON_CODE_CHARS,
    SOURCES_ENVELOPE_MAX_ACQUISITIONS,
    SOURCES_ENVELOPE_MAX_COUNT,
    SOURCES_HANDOFF_BASE_READ_RESERVE_BYTES,
    SOURCES_HANDOFF_READ_CAPACITY,
    SOURCES_MAX_EVIDENCE_REFERENCES,
    SOURCES_MAX_QUALIFICATION_CONTRIBUTIONS,
    SOURCES_WORK_ENTRY_CAPACITY,
} from "@convex/resourcePolicy";
import { getConvexSize, getDocumentSize, type Infer } from "convex/values";
import { validate } from "convex-helpers/validators";
import { agentName } from "./agentIdentities";
import { reusableFramingCaptureIds } from "./documentaryAccess";
import { readResearchContext } from "./researchContext";
import {
    type CoveragePreset,
    MAX_RESEARCH_PLAN_QUESTIONS,
} from "./researchPlan";
import type { ResearchState } from "./researchStateContracts";
import { captureAvailability } from "./sourceCaptureState";
import { sha256Hex, stableStringify } from "./sourcePassages";
import {
    assertPreparationExecutionFence,
    assertPreparationObservationFence,
    assertPreparationSettlementFence,
    preparationBudgetBlock,
    readPreparationBudget,
    readPreparationLimits,
} from "./sourcePreparationAuthority";
import { SourceReviewReads } from "./sourceReviewReads";
import {
    controlledDocumentaryUses,
    documentaryFindingFor,
} from "./sourceSelectionPolicy";
import {
    type authorizedDiscovery,
    type DocumentaryContribution,
    type DocumentaryContributionTally,
    type documentaryAssessmentAuthorValidator,
    documentaryExplanation,
    type materializedQualificationInput,
    type preparedMaterialValidator,
    retainedDocumentaryControl,
    SOURCES_PROTOCOL,
    type SourceCaptureIdentity,
    type SourceDocumentState,
    type SourcesPreparation,
    type SourcesPreparationProgress,
    type sourcesCompletionValidator,
    type sourcesCoverage,
    sourcesEnvelopeValidator,
} from "./sourcesContracts";
import {
    admittedDocumentaryReading,
    documentaryContributionEvidenceAvailable,
} from "./sourceUsage";
import { isDocumentaryResearchPhase } from "./transitions";
import type { sourcesPhaseValidator } from "./validators";

/** A missing or malformed envelope disables this protocol; historical defaults are not activation consent. */
export function sourcesEnvelope() {
    let value: unknown;
    try {
        value = JSON.parse(process.env.SOURCES_MISSION_ENVELOPE ?? "null");
    } catch {
        throw executionError("sources_configuration_unavailable");
    }
    if (
        !validate(sourcesEnvelopeValidator, value) ||
        Object.entries(value).some(
            ([key, count]) =>
                key !== "version" &&
                (!Number.isSafeInteger(count) ||
                    count < 1 ||
                    count > SOURCES_ENVELOPE_MAX_COUNT),
        ) ||
        value.acquisitions > SOURCES_ENVELOPE_MAX_ACQUISITIONS
    )
        throw executionError("sources_configuration_unavailable");
    return value;
}

/** Ordinary starts require explicit Sources activation; a disabled flag or invalid envelope blocks them instead of falling back. */
export function activatedSourcesEnvelope() {
    if (process.env.SOURCES_MISSION_ENABLED !== "true") return undefined;
    try {
        return sourcesEnvelope();
    } catch {
        return undefined;
    }
}

/** Execution admits paid work before the deadline; observation retains results during a pause; settlement hands off existing material at any time. */
export async function requireSourcesPreparation(
    ctx: Pick<QueryCtx, "db">,
    preparationId: Id<"sourceSelectionProposalRebuilds">,
    mode: "execution" | "observation" | "settlement" = "execution",
) {
    const { preparation, run, revision } =
        mode === "observation"
            ? await assertPreparationObservationFence(ctx.db, { preparationId })
            : mode === "settlement"
              ? await assertPreparationSettlementFence(ctx.db, {
                    preparationId,
                })
              : await assertPreparationExecutionFence(ctx.db, {
                    preparationId,
                    now: Date.now(),
                });
    if (!preparation.sourcesMission || run.sourcesProtocol !== SOURCES_PROTOCOL)
        throw executionError("sources_scope_invalid");
    return { preparation, run, revision, data: preparation.sourcesMission };
}

export const SOURCES_RESOURCE_LIMIT_CODES = {
    searches: "sources_discovery_limit",
    acquisitions: "sources_acquisition_limit",
    controls: "sources_control_limit",
    work: "sources_work_limit",
} as const;

/** The same preparation counters govern reservation and explain current capacity. */
export function sourcesResourceStatus(data: SourcesPreparation) {
    const capacity = (
        resource: keyof typeof SOURCES_RESOURCE_LIMIT_CODES,
        used: number,
        limit: number,
    ) => ({
        used,
        limit,
        blockCode:
            used >= limit ? SOURCES_RESOURCE_LIMIT_CODES[resource] : null,
    });
    return {
        searches: {
            ...capacity(
                "searches",
                data.searches,
                data.phase === "initial"
                    ? data.envelope.initialSearches
                    : data.envelope.complementSearches,
            ),
            operation: "discover_sources_for_need" as const,
        },
        acquisitions: {
            ...capacity(
                "acquisitions",
                data.acquisitions,
                data.envelope.acquisitions,
            ),
            operation: "make_source_consultable" as const,
        },
        controls: {
            ...capacity("controls", data.controls, data.envelope.controls),
            operations: [
                "submit_documentary_qualification",
                "request_documentary_check",
            ],
        },
        work: capacity("work", data.work.length, SOURCES_WORK_ENTRY_CAPACITY),
    };
}

export { sourcesPhaseValidator } from "./validators";
export type SourcesPhase = Infer<typeof sourcesPhaseValidator>;

export type SourcesSettlementCause =
    | "decision"
    | "allowance_exhausted"
    | "outcome_unknown"
    | "window_ended"
    | "execution_interrupted";

/** Explains why documentary work stopped on an unfinished need, naming the Sources Agent consistently. */
export function sourcesSettlementNote(cause: SourcesSettlementCause): string {
    const actor = `The ${agentName("sources")}`;
    switch (cause) {
        case "decision":
            return `${actor} stopped here because you chose to use what was prepared.`;
        case "allowance_exhausted":
            return `${actor} stopped here because the dossier's searches, retrievals or checks were used up.`;
        case "outcome_unknown":
            return `${actor} stopped here because the outcome of its last check is unknown.`;
        case "window_ended":
            return `${actor} stopped here because its time window ended.`;
        case "execution_interrupted":
            return `${actor} stopped here because of a technical interruption. Retained material remains available.`;
    }
}

/** Display outcome of a recorded modern handoff, without reading its mission or history. */
export function settledSourcesPhase(
    preparation:
        | (Pick<Doc<"sourceSelectionProposalRebuilds">, "status"> &
              Partial<
                  Pick<Doc<"sourceSelectionProposalRebuilds">, "sourcesMission">
              >)
        | null,
):
    | "completed"
    | "completed_with_limits"
    | "ended_without_material"
    | undefined {
    const result = preparation?.sourcesMission?.result;
    if (!preparation || !result || preparation.status === "started")
        return undefined;
    if (!result.documents.length || result.outcome === "blocked")
        return "ended_without_material";
    return result.outcome === "partial" ? "completed_with_limits" : "completed";
}

/** The single reading of Sources progress for the workspace and Workbench. A settled preparation keeps its outcome when later work starts or fails; a limit never reads as interruption once material is handed off. */
export function sourcesPreparationPhase(
    run: Pick<
        Doc<"researchRuns">,
        | "lifecycleState"
        | "executionStatus"
        | "pauseReason"
        | "completionOutcome"
    >,
    preparation:
        | (Pick<Doc<"sourceSelectionProposalRebuilds">, "status"> &
              Partial<
                  Pick<Doc<"sourceSelectionProposalRebuilds">, "sourcesMission">
              >)
        | null,
    mission: Pick<Doc<"agentMissions">, "status" | "blockCode"> | null,
): SourcesPhase {
    if (run.completionOutcome === "insufficient_public_evidence")
        return "insufficient_evidence";
    if (run.lifecycleState === "framing") return "waiting";
    const modernHandoff = settledSourcesPhase(preparation);
    if (modernHandoff) return modernHandoff;
    const settled =
        preparation &&
        preparation.status !== "started" &&
        (!!preparation.sourcesMission?.result ||
            run.lifecycleState === "sources_prepared" ||
            mission?.status === "completed");
    if (settled)
        return preparation.status === "complete"
            ? "completed"
            : preparation.status === "blocked"
              ? "ended_without_material"
              : "completed_with_limits";
    if (mission?.status === "completed" && !preparation?.sourcesMission)
        return "completed";
    // A later analytical stage, including its failure, does not rewrite documentary preparation.
    if (
        !isDocumentaryResearchPhase(run.lifecycleState) &&
        run.lifecycleState !== "sources_prepared"
    )
        return "completed";
    if (run.pauseReason === "sources_time_limit") return "time_limit";
    if (run.executionStatus === "failed") return "failed";
    if (run.lifecycleState === "sources_prepared") return "waiting";
    if (
        run.executionStatus === "cancelled" ||
        run.pauseReason === "execution_interrupted"
    )
        return "interrupted";
    if (
        mission &&
        ["blocked", "failed", "cancelled"].includes(mission.status) &&
        mission.blockCode !== "execution_time_limit"
    )
        return "interrupted";
    if (
        run.lifecycleState === "awaiting_source_review" &&
        preparation?.status !== "started"
    )
        return preparation?.status === "blocked"
            ? "ended_without_material"
            : preparation?.status === "partial"
              ? "completed_with_limits"
              : "completed";
    if (run.pauseReason === "analyst") return "paused";
    if (preparation?.status === "started" && mission?.status === "completed")
        return "waiting";
    if (run.executionStatus === "running") return "collecting";
    return "waiting";
}

/** A time-limited preparation is worth another window only while its envelope, registered work and model budget still admit work and no settlement was requested. */
export async function sourcesContinuationAvailable(
    ctx: Pick<QueryCtx, "db">,
    run: Doc<"researchRuns">,
    preparation: Doc<"sourceSelectionProposalRebuilds">,
) {
    const data = preparation.sourcesMission;
    if (
        !data ||
        data.result ||
        preparation.status !== "started" ||
        preparation.settlementRequestedAt !== undefined ||
        run.sourcePreparationId !== preparation._id
    )
        return false;
    const status = sourcesResourceStatus(data);
    if (
        status.work.blockCode ||
        [status.searches, status.acquisitions, status.controls].every(
            (resource) => resource.blockCode,
        )
    )
        return false;
    return !preparationBudgetBlock(
        await readPreparationBudget(ctx.db, run, preparation),
        readPreparationLimits(preparation),
    );
}

/** One need for common context and one per framed question; Start checks the same list against the envelope. */
export function initialDocumentaryNeeds(
    scope: string | undefined,
    questions: readonly { id: string; text: string }[],
) {
    return [
        {
            id: "common-context",
            version: 1,
            information: `Document the company and studied activity within this scope: ${scope ?? "company context"}`,
            questionIds: [] as string[],
            commonContext: true,
        },
        ...questions.map((question) => ({
            id: `question:${question.id}`,
            version: 1,
            information: question.text,
            questionIds: [question.id],
            commonContext: false,
        })),
    ];
}

/** Framed questions the envelope can prepare beside the shared needs, within the research plan's own question bound. */
export function documentaryQuestionCapacity(envelope: { maxNeeds: number }) {
    return Math.min(
        envelope.maxNeeds - initialDocumentaryNeeds(undefined, []).length,
        MAX_RESEARCH_PLAN_QUESTIONS,
    );
}

/** The system constructs the shared brief once; conversation is never its storage authority. */
export async function initializeSources(
    ctx: MutationCtx,
    preparationId: Id<"sourceSelectionProposalRebuilds">,
    envelope: SourcesPreparation["envelope"],
) {
    const { preparation, run } = await assertPreparationExecutionFence(ctx.db, {
        preparationId,
        now: Date.now(),
    });
    if (run.sourcesProtocol !== SOURCES_PROTOCOL)
        throw executionError("sources_scope_invalid");
    if (preparation.sourcesMission) return preparation.sourcesMission;
    const research = await readResearchContext(ctx, run);
    const needs = initialDocumentaryNeeds(
        research.scope ?? run.researchAngle,
        research.framing?.content.questions ?? [],
    );
    if (needs.length > envelope.maxNeeds)
        throw executionError("sources_need_capacity");
    const data: SourcesPreparation = {
        protocol: SOURCES_PROTOCOL,
        phase: "initial",
        needsRevision: 1,
        needs,
        envelope,
        ...(run.sourcesCoveragePolicyVersion && run.coveragePreset
            ? {
                  coveragePolicy: {
                      version: run.sourcesCoveragePolicyVersion,
                      preset: run.coveragePreset,
                  },
              }
            : {}),
        searches: 0,
        acquisitions: 0,
        controls: 0,
        restrictedContributions: [],
        captureIds: await reusableFramingCaptureIds(
            ctx,
            run,
            preparation.corpusRevisionId,
        ),
        qualifications: [],
        work: [],
    };
    await ctx.db.patch(preparationId, { sourcesMission: data });
    return data;
}

const presetFocus = {
    balanced: "mixed",
    first_party_depth: "official",
    independent_scrutiny: "independent",
} as const;

const discoveryOrientation = {
    mixed: "Seek official material and independent sources that can challenge it.",
    official: "Prioritize relevant issuer and regulatory publications.",
    independent: "Prioritize independent material that can test the account.",
};

/** Coverage priorities have the same meaning during framing and documentary discovery. */
export function coveragePresetGuidance(preset?: CoveragePreset) {
    return preset
        ? discoveryOrientation[presetFocus[preset]]
        : "Coverage priority is unknown for this historical dossier.";
}

/** Resolve the exact provider input before reserving shared search capacity. */
export function authorizeDocumentaryDiscovery(
    preset: CoveragePreset | undefined,
    input: Infer<typeof authorizedDiscovery>,
): Infer<typeof authorizedDiscovery> {
    const focus = preset ? (input.focus ?? presetFocus[preset]) : undefined;
    const query = focus
        ? `${input.query.trim()}
${discoveryOrientation[focus]}`
        : input.query;
    if (
        !input.query.trim() ||
        query.length > DOCUMENTARY_SEARCH_QUERY_MAX_CHARS
    )
        throw executionError("discovery_query_invalid", [
            {
                path: "query",
                expected: `Use a nonblank query that fits within ${DOCUMENTARY_SEARCH_QUERY_MAX_CHARS} characters including the selected search orientation.`,
            },
        ]);
    return { query, ...(focus ? { focus } : {}) };
}

/** Reconstruct an entire qualification while preserving independently identified contributions. */
export function reconstructQualification(
    input: Infer<typeof materializedQualificationInput>,
    previous: Extract<
        Doc<"aiTaskResults">["output"],
        { kind: "documentary_qualification" }
    > | null,
    data: SourcesPreparation,
    requestKey: string,
) {
    if (
        input.changes.length < 1 ||
        input.changes.length > SOURCES_MAX_QUALIFICATION_CONTRIBUTIONS
    )
        throw executionError("qualification_invalid", [
            {
                path: "changes",
                expected: `Supply 1–${SOURCES_MAX_QUALIFICATION_CONTRIBUTIONS} contribution changes for this capture; no contribution from this submission was adopted.`,
            },
        ]);
    if (previous?.captureId && previous.captureId !== input.captureId)
        throw executionError("qualification_invalid");
    const contributions: DocumentaryContribution[] = previous
        ? previous.contributions.map((c) => ({ ...c }))
        : [];
    const changed = new Set<string>();
    for (const [index, change] of input.changes.entries()) {
        if (
            change.contributionId !== undefined &&
            !change.contributionId.trim()
        )
            throw executionError("qualification_invalid", [
                {
                    path: `changes[${index}].contributionId`,
                    expected:
                        "Omit contributionId for a new contribution; supply a nonblank observed identity for a correction.",
                },
            ]);
        const id = change.contributionId ?? sha256Hex(`${requestKey}:${index}`);
        const existing = contributions.findIndex((c) => c.id === id);
        if (
            changed.has(id) ||
            (change.contributionId !== undefined &&
                (existing < 0 ||
                    contributions[existing]?.version !==
                        change.expectedVersion)) ||
            (change.contributionId === undefined &&
                change.expectedVersion !== undefined)
        )
            throw executionError("qualification_version_conflict");
        const c = change.contribution;
        if (
            !c.statement.trim() ||
            c.statement.length > 4000 ||
            c.needIds.length < 1 ||
            c.needIds.some(
                (id) => !data.needs.some((need) => need.id === id),
            ) ||
            !c.evidence.length ||
            c.evidence.length > SOURCES_MAX_EVIDENCE_REFERENCES ||
            c.evidence.some(
                (q) =>
                    !q.quotation.trim() ||
                    q.quotation.length > 6000 ||
                    !Number.isSafeInteger(q.passageOrder) ||
                    q.passageOrder < 0,
            )
        )
            throw executionError("qualification_invalid");
        if (!c.evidence.some((q) => q.captureId === input.captureId))
            throw executionError("qualification_invalid", [
                {
                    path: `changes[${index}].contribution.evidence`,
                    expected:
                        "At least one exact evidence reference from the submission's primary captureId; submit contributions supported only by another capture separately.",
                },
            ]);
        const prior = contributions[existing];
        if (prior) {
            const { id: _id, version: _version, ...priorContent } = prior;
            if (stableStringify(priorContent) === stableStringify(c)) {
                changed.add(id);
                continue;
            }
        }
        const next = {
            ...c,
            id,
            version:
                existing < 0 ? 1 : (contributions[existing]?.version ?? 0) + 1,
        };
        if (existing < 0) contributions.push(next);
        else contributions[existing] = next;
        changed.add(id);
    }
    if (contributions.length > SOURCES_MAX_QUALIFICATION_CONTRIBUTIONS)
        throw executionError("qualification_capacity", [
            {
                path: "changes",
                expected: `The resulting qualification may contain at most ${SOURCES_MAX_QUALIFICATION_CONTRIBUTIONS} contributions; correct an observed contribution or submit material for another capture separately.`,
            },
        ]);
    return contributions;
}

/** Phase admission for additional instructions; execution and request-specific capacity still gate treatment. */
export function sourcesInstructionTreatment(
    preparation: Pick<
        Doc<"sourceSelectionProposalRebuilds">,
        "status" | "sourcesMission"
    > | null,
) {
    const data = preparation?.sourcesMission;
    if (preparation?.status !== "started" || !data || data.result)
        return {
            status: "closed" as const,
            description:
                "This preparation is not accepting additional documentary requests. Existing material remains available for inspection. Recording a request does not authorize further preparation.",
        };
    if (data.needs.length >= data.envelope.maxNeeds)
        return {
            status: "at_capacity" as const,
            description:
                "This preparation has reached its documentary need limit. Additional requests cannot enlarge it or start another documentary phase. Existing material remains available for inspection.",
        };
    return {
        status: "open" as const,
        description:
            "Additional needs may join the current preparation, subject to framing, authority, execution and capacity checks. Registration is not completed treatment and cannot start another documentary phase.",
    };
}

export async function readSourcesMission(
    ctx: QueryCtx,
    run: Doc<"researchRuns">,
) {
    const preparationId = run.sourcePreparationId;
    if (!preparationId || run.sourcesProtocol !== "sources_mission_v1")
        return null;
    const mission = await ctx.db
        .query("agentMissions")
        .withIndex("by_run_and_objective_key", (q) =>
            q
                .eq("runId", run._id)
                .eq(
                    "objectiveKey",
                    missionObjectiveKey({ kind: "sources_v1", preparationId }),
                ),
        )
        .order("desc")
        .first();
    if (
        mission &&
        (!("scope" in mission) ||
            mission.scope.kind !== "sources_v1" ||
            mission.scope.preparationId !== preparationId)
    )
        throw executionError("mission_contract_invalid");
    return mission;
}

/** Required conversational state stays bounded; exact source material remains available through saved-material reads. */
export function summarizeSourcesPreparation(
    preparation: Doc<"sourceSelectionProposalRebuilds">,
    observation?: ResearchState["sources"],
) {
    const data = preparation.sourcesMission;
    if (!data) return null;
    const preview = (value: string | undefined, limit: number) =>
        value ? Array.from(value).slice(0, limit).join("") : null;
    return {
        preparationId: preparation._id,
        executionStop: observation?.executionStop ?? null,
        needsRevision: data.needsRevision,
        phase: data.phase,
        detailsHash: sha256Hex(
            stableStringify({
                needs: data.needs,
                material: data.result ?? null,
                restrictions: data.restrictedContributions,
            }),
        ),
        needCount: data.needs.length,
        needReferences: data.needs.map(({ id, version }) => ({ id, version })),
        settledNeedIds: data.result?.needs.map(({ needId }) => needId) ?? [],
        instructionTreatment: sourcesInstructionTreatment(preparation),
        needsPreviewComplete: data.needs.length <= 8,
        needs: data.needs.slice(0, 8).map((need) => {
            const result = data.result?.needs.find((n) => n.needId === need.id);
            return {
                id: need.id,
                version: need.version,
                informationPreview: preview(need.information, 128),
                contributionCount: result?.contributions.length ?? 0,
                unfinishedCount: result?.unfinished.length ?? 0,
                gapPreview: preview(result?.gap, 160),
                gapPreviewComplete:
                    !result?.gap || Array.from(result.gap).length <= 160,
                detailOperation: "consult_prepared_material",
            };
        }),
        work: {
            registered: data.work.length,
            searches: data.searches,
            acquisitions: data.acquisitions,
            controls: data.controls,
        },
        allowance: sourcesResourceStatus(data),
        documentaryAssessment:
            projectPreparedMaterial(preparation)?.documentaryAssessment ?? null,
        restrictionCount: data.restrictedContributions.length,
        result: data.result
            ? {
                  outcome: data.result.outcome,
                  documentCount: data.result.documents.length,
                  documents: data.result.documents.map((document) => ({
                      sourceId: document.sourceId,
                      title:
                          observation?.retainedDocuments.find(
                              (entry) => entry.sourceId === document.sourceId,
                          )?.title ?? null,
                      captureId: document.captureId,
                      contentHash: document.contentHash,
                      qualificationTaskId: document.qualificationTaskId,
                      qualificationVersion: document.qualificationVersion,
                      contributionCount: document.contributions.length,
                  })),
              }
            : null,
        inspection:
            "Use saved-material search and contextual reading for exact passages and current contribution permissions. Previews are incomplete status, not evidence.",
        nextCapability: "investigation_unavailable",
    };
}

type CoverageSearch = NonNullable<
    Infer<typeof preparedMaterialValidator>["coverageSearches"]
>[number];

async function observeCoverageSearch(
    reads: SourceReviewReads,
    requestId: Id<"agentOperationRequests">,
): Promise<CoverageSearch> {
    const request = await reads.request(requestId);
    if (
        request?.status === "completed" &&
        request.adoptedAt !== undefined &&
        request.outcome?.kind === "success" &&
        !request.adoptionRefusalCode
    )
        return { requestId, outcome: "performed" };
    const reasonCode =
        request?.adoptionRefusalCode ??
        (request?.outcome && "code" in request.outcome
            ? request.outcome.code
            : undefined) ??
        (request?.status === "unknown"
            ? "operation_outcome_unknown"
            : undefined);
    return {
        requestId,
        outcome: "unfinished",
        ...(reasonCode && reasonCode.length <= MAX_POLICY_REASON_CODE_CHARS
            ? { reasonCode }
            : {}),
    };
}

/** A settled preparation reports the snapshot it handed off even if a receipt arrives later. */
export async function readSourcesCoverage(
    ctx: QueryCtx,
    preparation: Doc<"sourceSelectionProposalRebuilds">,
    reads = new SourceReviewReads(
        ctx.db,
        preparation.runId,
        SOURCES_HANDOFF_READ_CAPACITY,
    ),
): Promise<Infer<typeof sourcesCoverage> | undefined> {
    const data = preparation.sourcesMission;
    const policy = data?.result
        ? data.result.coveragePolicy
        : data?.coveragePolicy;
    if (!data || !policy) return undefined;
    const searches = new Map(data.work.map((work) => [work.requestId, work]));
    const observations = data.result
        ? (data.result.coverageSearches ?? [])
        : await Promise.all(
              data.work.flatMap((work) =>
                  work.discovery
                      ? [observeCoverageSearch(reads, work.requestId)]
                      : [],
              ),
          );
    const author = data.result?.documentaryAssessment?.author;
    return {
        policy,
        assessments:
            author?.type === "agent"
                ? (data.result?.needs ?? []).flatMap((need) =>
                      need.gap && need.coverageReadings?.length
                          ? [
                                {
                                    needId: need.needId,
                                    statement: need.gap,
                                    author,
                                    readings: need.coverageReadings,
                                },
                            ]
                          : [],
                  )
                : [],
        searches: observations.flatMap((observation) => {
            const work = searches.get(observation.requestId);
            return work?.discovery
                ? [{ ...observation, ...work.discovery, needIds: work.needIds }]
                : [];
        }),
    };
}

/** Shared inspection payload; authorization is enforced by each public or mission entrypoint. */
export function projectPreparedMaterial(
    preparation: Doc<"sourceSelectionProposalRebuilds">,
) {
    const data = preparation.sourcesMission;
    return data
        ? {
              preparationId: preparation._id,
              needs: data.needs,
              material: data.result ?? null,
              documentaryAssessment: data.result
                  ? (data.result.documentaryAssessment ?? {
                        author: { type: "unrecorded" as const },
                        verification: "not_semantically_reviewed" as const,
                    })
                  : null,
              restrictions: data.restrictedContributions,
              nextCapability: "investigation_unavailable" as const,
          }
        : null;
}

/** Reads one complete need without hydrating captures or silently trimming its limitations. */
export async function readPreparedNeed(
    ctx: QueryCtx,
    run: Doc<"researchRuns">,
    needId: string,
) {
    const preparation = run.sourcePreparationId
        ? await ctx.db.get(run.sourcePreparationId)
        : null;
    if (!preparation?.sourcesMission || preparation.runId !== run._id)
        return {
            kind: "unavailable" as const,
            code: "prepared_material_unavailable",
        };
    const prepared = projectPreparedMaterial(preparation);
    if (!prepared?.material)
        return {
            kind: "unavailable" as const,
            code: "prepared_material_unavailable",
        };
    const need = prepared.needs.find((entry) => entry.id === needId);
    const outcome = prepared.material.needs.find(
        (entry) => entry.needId === needId,
    );
    if (!need || !outcome)
        return {
            kind: "unavailable" as const,
            code: "documentary_need_unavailable",
        };
    const qualifications = new Set(
        outcome.contributions.map((entry) => entry.qualificationTaskId),
    );
    const restrictedVersions = new Set<string>();
    const reads = new SourceReviewReads(
        ctx.db,
        run._id,
        SOURCES_HANDOFF_READ_CAPACITY,
    );
    if (prepared.restrictions.length) {
        for (const taskId of preparation.sourcesMission?.qualifications ?? []) {
            const task = await reads.task(taskId);
            if (
                task?.runId !== run._id ||
                task.output.kind !== "documentary_qualification" ||
                task.output.preparationId !== preparation._id
            )
                throw executionError("qualification_invalid");
            for (const contribution of task.output.contributions)
                if (contribution.needIds.includes(needId))
                    restrictedVersions.add(
                        JSON.stringify([contribution.id, contribution.version]),
                    );
        }
    }
    const value = {
        preparationId: prepared.preparationId,
        needsRevision: prepared.material.needsRevision,
        ...(prepared.documentaryAssessment
            ? { documentaryAssessment: prepared.documentaryAssessment }
            : {}),
        need,
        outcome,
        controlledContributions: (
            await controlledSourcesContributions(ctx, preparation, reads)
        )
            .map((qualification) => ({
                ...qualification,
                contributions: qualification.contributions
                    .filter((contribution) =>
                        contribution.needIds.includes(needId),
                    )
                    .map((contribution) => ({
                        ...contribution,
                        permittedUse:
                            contribution.needs[needId] ?? ("blocked" as const),
                        objections: contribution.objections.filter(
                            (objection) =>
                                objection.needIds.includes(null) ||
                                objection.needIds.includes(needId),
                        ),
                        useStatus:
                            contribution.needs[needId] &&
                            contribution.needs[needId] !== "blocked"
                                ? ("support_with_restrictions" as const)
                                : ("inspection_only" as const),
                    })),
            }))
            .filter((qualification) => qualification.contributions.length),
        documents: prepared.material.documents.filter((document) =>
            qualifications.has(document.qualificationTaskId),
        ),
        restrictions: prepared.restrictions.filter(
            (restriction) =>
                (restriction.needId === undefined ||
                    restriction.needId === needId) &&
                restrictedVersions.has(
                    JSON.stringify([
                        restriction.contributionId,
                        restriction.version,
                    ]),
                ),
        ),
        nextCapability: prepared.nextCapability,
    };
    if (
        new TextEncoder().encode(JSON.stringify(value)).length >
        MAX_OPERATION_RESULT_BYTES
    )
        return {
            kind: "unavailable" as const,
            code: "operation_result_capacity",
        };
    return {
        kind: "available" as const,
        value,
        pin: {
            kind: "prepared_material" as const,
            preparationId: prepared.preparationId,
            hash: sha256Hex(stableStringify(value)),
        },
    };
}

/** Preparation-owned work must settle before terminal handoff; unknown observations cannot adopt new material. */
export async function readEngagedSourcesWork(
    reads: SourceReviewReads,
    preparationId: Id<"sourceSelectionProposalRebuilds">,
) {
    const blockers = await Promise.all(
        (["running", "waiting"] as const).map((status) =>
            reads.firstPreparationRequest(preparationId, status),
        ),
    );
    return blockers.filter((request) => request !== null);
}

/** Current task outcomes and complete controlled contributions survive qualitative compaction. */
export async function sourcesTaskObservations(
    ctx: QueryCtx,
    preparation: Doc<"sourceSelectionProposalRebuilds">,
    reads = new SourceReviewReads(
        ctx.db,
        preparation.runId,
        SOURCES_HANDOFF_READ_CAPACITY,
    ),
) {
    const { sourcesMission: data } = preparation;
    if (!data) throw executionError("sources_mission_unavailable");
    const workOutcomes = await Promise.all(
        data.work.map(async (work) => {
            const request = await reads.request(work.requestId);
            return {
                requestId: work.requestId,
                status: request?.status ?? "unavailable",
                outcome: request?.outcome
                    ? {
                          kind: request.outcome.kind,
                          ...("code" in request.outcome
                              ? { code: request.outcome.code }
                              : {}),
                      }
                    : null,
                adopted:
                    request?.status === "completed" &&
                    request.outcome?.kind === "success" &&
                    !request.adoptionRefusalCode,
            };
        }),
    );
    const contributionObservations = await controlledSourcesContributions(
        ctx,
        preparation,
        reads,
    );
    return { workOutcomes, contributionObservations };
}

/** One documentary projection serves native state, targeted consultation and advisory review. Exact quotations remain capture-bound reads. */
export async function controlledSourcesContributions(
    ctx: QueryCtx,
    preparation: Doc<"sourceSelectionProposalRebuilds">,
    reads = new SourceReviewReads(
        ctx.db,
        preparation.runId,
        SOURCES_HANDOFF_READ_CAPACITY,
    ),
) {
    const { runId, sourcesMission: data } = preparation;
    if (!data) throw executionError("sources_mission_unavailable");
    return Promise.all(
        data.qualifications.map(async (taskId) => {
            const task = await reads.task(taskId);
            if (
                !task ||
                task.runId !== runId ||
                task.output.kind !== "documentary_qualification" ||
                task.output.preparationId !== preparation._id
            )
                throw executionError("qualification_invalid");
            const qualification = task.output;
            const controlTask = await reads.task(qualification.controlTaskId);
            if (
                controlTask?.runId !== runId ||
                controlTask.output.kind !== "documentary_control"
            )
                throw executionError("documentary_control_unavailable");
            const control = retainedDocumentaryControl(controlTask.output);
            const historicalExamination =
                controlTask.output.examination.state === "not_examined"
                    ? controlTask.output.examination
                    : null;
            const capture = await reads.capture(qualification.captureId);
            if (
                !capture ||
                capture.runId !== runId ||
                capture.contentHash !== qualification.contentHash
            )
                throw executionError("capture_unavailable");
            const sourceDecision = await reads.decision(
                preparation.corpusRevisionId,
                capture.sourceId,
                true,
            );
            return {
                taskId,
                sourceId: capture.sourceId,
                sourceDecision,
                captureId: qualification.captureId,
                contentHash: qualification.contentHash,
                version: qualification.version,
                controlTaskId: qualification.controlTaskId,
                limitations: [],
                ...(control
                    ? { objectionCount: control.objections.length }
                    : {}),
                ...(historicalExamination
                    ? { examination: historicalExamination }
                    : {}),
                contributions: qualification.contributions.map(
                    ({ evidence, ...contribution }) => {
                        const { permittedUse, needs } =
                            controlledDocumentaryUses(
                                contribution,
                                sourceDecision === "rejected" ? null : control,
                                data.restrictedContributions,
                            );
                        const finding = documentaryFindingFor(
                            control,
                            contribution.id,
                        );
                        const objections =
                            control?.objections.flatMap((objection) => {
                                const needIds = objection.targets.flatMap(
                                    (target) =>
                                        target.contributionId ===
                                        contribution.id
                                            ? [target.needId]
                                            : [],
                                );
                                if (!needIds.length) return [];
                                const reason = documentaryExplanation(
                                    objection.diagnostic,
                                );
                                const diagnosticPreview =
                                    reason === null
                                        ? null
                                        : Array.from(reason)
                                              .slice(0, 96)
                                              .join("");
                                return [
                                    {
                                        needIds,
                                        maximumUse: objection.maximumUse,
                                        diagnosticPreview,
                                        diagnosticComplete:
                                            diagnosticPreview === reason,
                                    },
                                ];
                            }) ?? [];
                        return {
                            ...contribution,
                            evidence: evidence.map(
                                ({ captureId, passageOrder }) => ({
                                    captureId,
                                    passageOrder,
                                }),
                            ),
                            permittedUse,
                            needs,
                            objections,
                            useStatus:
                                permittedUse === "blocked"
                                    ? ("inspection_only" as const)
                                    : ("support_with_restrictions" as const),
                            finding: finding
                                ? {
                                      contributionId: contribution.id,
                                      conclusion: finding.conclusion,
                                      diagnostic: documentaryExplanation(
                                          finding.diagnostic,
                                      ),
                                      reportedUse: finding.permittedUse,
                                  }
                                : null,
                            restrictions: data.restrictedContributions.filter(
                                (restriction) =>
                                    restriction.contributionId ===
                                    contribution.id,
                            ),
                        };
                    },
                ),
                contributionCount: qualification.contributions.length,
            };
        }),
    );
}

export const SOURCES_READING_REFERENCE_LIMIT = 32;

/** Reads the bounded admitted reading window once for both detailed handles and compact counts. */
export async function sourcesReadingReferenceWindow(
    ctx: QueryCtx,
    mission: Doc<"agentMissions">,
    data: SourcesPreparation,
    reads?: SourceReviewReads,
) {
    if (!data.captureIds.length)
        return { references: [], referencesComplete: true };
    const limit = SOURCES_READING_REFERENCE_LIMIT;
    const pages = reads
        ? await reads.readingRequests(mission._id, limit)
        : await Promise.all(
              (["search_available_material", "read_in_context"] as const).map(
                  (kind) =>
                      ctx.db
                          .query("agentOperationRequests")
                          .withIndex("by_mission_and_input_kind", (q) =>
                              q
                                  .eq("missionId", mission._id)
                                  .eq("input.kind", kind),
                          )
                          .order("desc")
                          .take(limit + 1),
              ),
          );
    const references = pages
        .flat()
        .sort(
            (a, b) =>
                b._creationTime - a._creationTime || b._id.localeCompare(a._id),
        )
        .flatMap((request) => {
            const material = admittedDocumentaryReading(
                request,
                { runId: mission.runId, missionId: mission._id },
                data,
            );
            return material
                ? [
                      {
                          readRequestId: request._id,
                          kind: material.kind,
                          sourceId: material.sourceId,
                          captureId: material.captureId,
                          contentHash: material.contentHash,
                          passageOrders: material.passages.map(
                              (p) => p.passageOrder,
                          ),
                      },
                  ]
                : [];
        });
    return {
        references: references.slice(0, limit),
        referencesComplete:
            references.length <= limit &&
            pages.every((page) => page.length <= limit),
    };
}

/** Current evidence handles remain available when Pi compacts its conversation history. */
export async function sourcesReadingReferences(
    ctx: QueryCtx,
    mission: Doc<"agentMissions">,
    data: SourcesPreparation,
    reads?: SourceReviewReads,
) {
    const { references, referencesComplete } =
        await sourcesReadingReferenceWindow(ctx, mission, data, reads);
    return {
        readingReferences: await Promise.all(
            references.map(async (reference) => ({
                ...reference,
                historyReference: await operationHistoryReference(
                    ctx,
                    reference.readRequestId,
                ),
            })),
        ),
        readingReferencesComplete: referencesComplete,
    };
}

/** Reserved controls hold completion capacity until their proposal is retained or cannot be adopted. */
export async function hasEngagedSourcesControl(
    reads: SourceReviewReads,
    data: SourcesPreparation,
) {
    for (const work of data.work) {
        if (
            work.kind !== "submit_documentary_qualification" &&
            work.kind !== "request_documentary_check"
        )
            continue;
        const request = await reads.request(work.requestId);
        if (request && ["running", "waiting"].includes(request.status))
            return true;
    }
    return false;
}

/** Preserves handoff format and dependency capacity before qualifications, controls or needs enlarge the preparation. */
export async function assertSourcesCompletionCapacity(
    reads: SourceReviewReads,
    preparation: Doc<"sourceSelectionProposalRebuilds">,
    data: SourcesPreparation,
    qualification: {
        input: Infer<typeof materializedQualificationInput>;
        contributions: DocumentaryContribution[];
        contentHash: string;
    } | null,
    requestId: Id<"agentOperationRequests">,
    additionalPreparationBytes = 0,
) {
    const needOutcomes = data.needs.map((need) => ({
        needId: need.id,
        unfinished: [],
        workRequestIds: data.work
            .filter((work) => work.needIds.includes(need.id))
            .map((work) => work.requestId),
    }));
    let bytes =
        getDocumentSize({
            ...preparation,
            sourcesMission: { ...data, result: undefined },
        }) +
        additionalPreparationBytes +
        64 * 1024;
    bytes += getDocumentSize({
        needs: needOutcomes.map((need) => ({ ...need, contributions: [] })),
    });
    if (data.coveragePolicy) {
        // Convex IDs share the deployment's encoding. Use an existing ID to size the two reference fields.
        const readingReference = {
            sourceId: preparation._id,
            captureId: preparation._id,
            passageOrder: 0,
        };
        const coverageReadings = Array.from(
            { length: SOURCES_MAX_EVIDENCE_REFERENCES },
            () => readingReference,
        );
        bytes += data.needs.length * getConvexSize({ coverageReadings });
        bytes += getDocumentSize({
            coveragePolicy: data.coveragePolicy,
            coverageSearches: data.work.flatMap((work) =>
                work.discovery
                    ? [
                          {
                              requestId: work.requestId,
                              outcome: "unfinished",
                              reasonCode: "x".repeat(
                                  MAX_POLICY_REASON_CODE_CHARS,
                              ),
                          },
                      ]
                    : [],
            ),
        });
    }
    if (bytes > CONVEX_MAX_DOCUMENT_BYTES)
        throw executionError("sources_result_capacity");
    const count = (
        taskKey: string,
        sourceId: Id<"sources">,
        captureId: Id<"sourceCaptures">,
        hash: string,
        version: number,
        items: DocumentaryContribution[],
    ) => {
        bytes += getDocumentSize({
            sourceId,
            captureId,
            contentHash: hash,
            qualificationTaskId: taskKey,
            qualificationVersion: version,
            contributions: items.map((c) => ({ id: c.id, version: c.version })),
        });
        for (const item of items)
            bytes +=
                getDocumentSize({
                    qualificationTaskId: taskKey,
                    contributionId: item.id,
                    version: item.version,
                }) * item.needIds.length;
        if (bytes > CONVEX_MAX_DOCUMENT_BYTES)
            throw executionError("sources_result_capacity");
    };
    for (const id of data.qualifications) {
        const task = await reads.task(id);
        if (qualification && task?.sourceId === qualification.input.sourceId)
            continue;
        if (!task?.sourceId || task.output.kind !== "documentary_qualification")
            throw executionError("qualification_invalid");
        const primaryCapture = await reads.capture(task.output.captureId);
        if (
            primaryCapture &&
            (await reads.decision(
                preparation.corpusRevisionId,
                primaryCapture.sourceId,
            )) === "rejected"
        )
            continue;
        count(
            task._id,
            task.sourceId,
            task.output.captureId,
            task.output.contentHash,
            task.output.version,
            task.output.contributions,
        );
        const control = await reads.task(task.output.controlTaskId);
        if (control?.output.kind !== "documentary_control")
            throw executionError("documentary_control_unavailable");
        await reads.prefetchPassages(
            preparation.corpusRevisionId,
            task.output.contributions.flatMap((c) => c.evidence),
        );
        // Existing unusable contributions are excluded at completion; capacity planning must preserve independent work.
        for (const contribution of task.output.contributions)
            await documentaryContributionEvidenceAvailable(
                reads,
                preparation.runId,
                preparation.corpusRevisionId,
                contribution,
            );
    }
    // The operation's 64-byte logical key is a conservative identity allowance until the task is persisted.
    const contributions = qualification?.contributions ?? [];
    if (qualification)
        count(
            "x".repeat(64),
            qualification.input.sourceId,
            qualification.input.captureId,
            qualification.contentHash,
            1,
            contributions,
        );
    await reads.prefetchPassages(
        preparation.corpusRevisionId,
        contributions.flatMap((c) => c.evidence),
    );
    for (const contribution of contributions)
        if (
            !(await documentaryContributionEvidenceAvailable(
                reads,
                preparation.runId,
                preparation.corpusRevisionId,
                contribution,
            ))
        )
            throw executionError("documentary_quote_invalid");
    let pendingReceiptBytes = SOURCES_HANDOFF_BASE_READ_RESERVE_BYTES;
    for (const work of data.work) {
        const request = await reads.request(work.requestId);
        if (request && request.status !== "completed")
            pendingReceiptBytes += 64 * 1024;
    }
    await reads.request(requestId);
    // The qualification is known; its future control is bounded by the storage document limit.
    reads.requireCapacity(
        (qualification
            ? getDocumentSize({ contributions }) +
              1024 +
              CONVEX_MAX_DOCUMENT_BYTES
            : 0) + pendingReceiptBytes,
        8,
    );
}

/** Validates accounting and distinguishes new work from omissions in the admitted context. */
export function sourcesCompletionAccounting(
    data: SourcesPreparation,
    response: Infer<typeof sourcesCompletionValidator>,
    admittedWork: readonly Pick<
        SourcesPreparation["work"][number],
        "requestId"
    >[] = data.work,
) {
    const issues: { path: string; expected: string; code: string }[] = [];
    const add = (path: string, expected: string, code: string) =>
        issues.push({ path, expected, code });
    if (response.needsRevision !== data.needsRevision)
        add(
            "needsRevision",
            `Current revision ${data.needsRevision}.`,
            "sources_needs_unaccounted",
        );
    const actual = response.needs.map((need) => need.needId);
    if (
        response.needs.length !== data.needs.length ||
        new Set(actual).size !== data.needs.length ||
        data.needs.some((need) => !actual.includes(need.id))
    )
        add(
            "needs",
            `Exactly one outcome for each of the ${data.needs.length} current IDs in activeWork.needs; do not duplicate or invent an ID.`,
            "sources_needs_unaccounted",
        );
    if (response.needs.length > data.envelope.maxNeeds)
        throw executionError(
            "sources_needs_unaccounted",
            issues.map(({ path, expected }) => ({ path, expected })),
        );
    const missing = new Set<Id<"agentOperationRequests">>();
    for (const [index, outcome] of response.needs.entries()) {
        const path = `needs[${index}]`;
        if (!data.needs.some((need) => need.id === outcome.needId))
            add(
                `${path}.needId`,
                "Copy an ID from the current needs.",
                "sources_need_invalid",
            );
        if (outcome.unfinished.some((text) => !text.trim()))
            add(
                `${path}.unfinished`,
                "Nonempty explanations of work not completed; omit blank entries.",
                "sources_need_invalid",
            );
        if (outcome.gap !== undefined && !outcome.gap.trim())
            add(
                `${path}.gap`,
                "A nonempty examined documentary gap, or omit gap.",
                "sources_need_invalid",
            );
        if (
            new Set(outcome.workRequestIds).size !==
            outcome.workRequestIds.length
        )
            add(
                `${path}.workRequestIds`,
                "Each exact request ID once per need.",
                "sources_work_unaccounted",
            );
        const omitted = data.work.filter(
            (work) =>
                work.needIds.includes(outcome.needId) &&
                !outcome.workRequestIds.includes(work.requestId),
        );
        for (const work of omitted) missing.add(work.requestId);
        const known = omitted.filter((work) =>
            admittedWork.some(
                (admitted) => admitted.requestId === work.requestId,
            ),
        );
        if (known.length)
            add(
                `${path}.workRequestIds`,
                `Include all ${known.length} omitted work references for this need from activeWork.work. Preserve failed or unknown work as unfinished.`,
                "sources_work_unaccounted",
            );
    }
    return { issues, stale: missing.size > 0 };
}

/** Completion resolves persisted work and current restrictions; it never adopts model-authored source membership. */
export async function completeSources(
    ctx: MutationCtx,
    preparationId: Id<"sourceSelectionProposalRebuilds">,
    response: Infer<typeof sourcesCompletionValidator>,
    sharedReads?: SourceReviewReads,
    assessmentAuthor?: Infer<typeof documentaryAssessmentAuthorValidator>,
) {
    const prepared = await prepareSourcesMaterial(
        ctx,
        preparationId,
        response,
        sharedReads,
        assessmentAuthor,
    );
    await prepared.adopt(ctx);
    return prepared.material;
}

/** Computes material without publishing it; completion builds a fresh candidate before adopting it. */
export async function prepareSourcesMaterial(
    ctx: QueryCtx,
    preparationId: Id<"sourceSelectionProposalRebuilds">,
    response: Infer<typeof sourcesCompletionValidator>,
    sharedReads?: SourceReviewReads,
    assessmentAuthor?: Infer<typeof documentaryAssessmentAuthorValidator>,
) {
    const settlement = assessmentAuthor?.type === "system";
    const { preparation, run, data } = await requireSourcesPreparation(
        ctx,
        preparationId,
        settlement ? "settlement" : "execution",
    );
    if (settlement)
        await requireSettlementAuthority(ctx, run._id, run.executionGeneration);
    else {
        await requireRunAuthority(ctx, run._id, run.executionGeneration);
        const blocked = preparationBudgetBlock(
            await readPreparationBudget(ctx.db, run, preparation),
            readPreparationLimits(preparation),
        );
        if (blocked) throw executionError(blocked);
        if ((run.executionHarnessDeadlineAt ?? Infinity) <= Date.now())
            throw executionError("execution_deadline");
    }
    const accounting = sourcesCompletionAccounting(data, response);
    const coveredNeeds = new Map<
        string,
        Infer<
            typeof import("./sourcesContracts").preparedContributionReferenceValidator
        >[]
    >();
    const documents: Infer<
        typeof import("./sourcesContracts").preparedDocumentValidator
    >[] = [];
    const reads =
        sharedReads ??
        new SourceReviewReads(ctx.db, run._id, SOURCES_HANDOFF_READ_CAPACITY);
    for (const taskId of data.qualifications) {
        const task = await reads.task(taskId);
        if (
            task?.output.kind !== "documentary_qualification" ||
            task.runId !== run._id
        )
            throw executionError("qualification_invalid");
        const q = task.output;
        const capture = await reads.capture(q.captureId);
        if (
            capture?.status !== "committed" ||
            capture.contentHash !== q.contentHash ||
            !capture.storageId ||
            !(await reads.artifact(capture.storageId))
        )
            throw executionError("capture_unavailable");
        if (
            (await reads.decision(
                preparation.corpusRevisionId,
                capture.sourceId,
            )) === "rejected"
        )
            continue;
        const control = await reads.task(q.controlTaskId);
        if (control?.output.kind !== "documentary_control")
            throw executionError("documentary_control_unavailable");
        const permitted = [];
        await reads.prefetchPassages(
            preparation.corpusRevisionId,
            q.contributions.flatMap((c) => c.evidence),
        );
        const examination = retainedDocumentaryControl(control.output);
        for (const contribution of q.contributions) {
            const uses = controlledDocumentaryUses(
                contribution,
                examination,
                data.restrictedContributions,
            );
            if (
                uses.permittedUse === "blocked" ||
                !(await documentaryContributionEvidenceAvailable(
                    reads,
                    run._id,
                    preparation.corpusRevisionId,
                    contribution,
                ))
            )
                continue;
            permitted.push(contribution);
            for (const id of contribution.needIds) {
                if (uses.needs[id] === "blocked") continue;
                const references = coveredNeeds.get(id) ?? [];
                references.push({
                    qualificationTaskId: task._id,
                    contributionId: contribution.id,
                    version: contribution.version,
                });
                coveredNeeds.set(id, references);
            }
        }
        if (permitted.length)
            documents.push({
                sourceId: capture.sourceId,
                captureId: capture._id,
                contentHash: q.contentHash,
                qualificationTaskId: task._id,
                qualificationVersion: q.version,
                contributions: permitted.map(({ id, version }) => ({
                    id,
                    version,
                })),
            });
    }
    const coverageReadings = new Map<
        string,
        NonNullable<
            Infer<
                typeof preparedMaterialValidator
            >["needs"][number]["coverageReadings"]
        >
    >();
    const issues = [...accounting.issues];
    const invalid = (
        outcome: (typeof response.needs)[number],
        code: string,
        expected: string,
    ) =>
        issues.push({
            path: `needs[${response.needs.indexOf(outcome)}]`,
            expected,
            code,
        });
    for (const outcome of response.needs) {
        const work = data.work.filter((w) =>
            w.needIds.includes(outcome.needId),
        );
        let examinedNeed = false;
        const readings: NonNullable<
            Infer<
                typeof preparedMaterialValidator
            >["needs"][number]["coverageReadings"]
        > = [];
        for (const requestId of outcome.workRequestIds) {
            const request = await reads.request(requestId);
            if (!work.some((w) => w.requestId === requestId)) {
                const pin = request?.pin;
                const readingBelongsToPreparation =
                    pin?.kind === "saved_material_inspection_v1"
                        ? !!pin.expectedCaptureId &&
                          data.captureIds.includes(pin.expectedCaptureId)
                        : pin?.kind === "documentary_v1" &&
                          pin.scope.kind === "sources" &&
                          pin.scope.preparationId === preparationId &&
                          !!request?.missionId &&
                          !!admittedDocumentaryReading(request, request, data);
                if (
                    !request ||
                    !["search_available_material", "read_in_context"].includes(
                        request.input.kind,
                    ) ||
                    !readingBelongsToPreparation
                )
                    invalid(
                        outcome,
                        "sources_work_invalid",
                        "Use only work belonging to this need and preparation, or exact saved-material reads within its retained captures.",
                    );
                if (request?.missionId) {
                    const owner = await ctx.db.get(request.missionId);
                    if (
                        !owner ||
                        !("scope" in owner) ||
                        owner.scope.kind !== "sources_v1" ||
                        owner.scope.preparationId !== preparationId
                    )
                        invalid(
                            outcome,
                            "sources_work_invalid",
                            "Use only work belonging to this need and preparation, or exact saved-material reads within its retained captures.",
                        );
                } else if (request?.actor !== "system")
                    invalid(
                        outcome,
                        "sources_work_invalid",
                        "Use only work belonging to this need and preparation, or exact saved-material reads within its retained captures.",
                    );
            }
            if (
                outcome.gap &&
                assessmentAuthor?.type === "agent" &&
                request?.input.kind === "read_in_context"
            ) {
                let read: ReturnType<typeof admittedDocumentaryReading>;
                try {
                    read = admittedDocumentaryReading(
                        request,
                        {
                            runId: run._id,
                            missionId: assessmentAuthor.missionId,
                        },
                        data,
                    );
                } catch (error) {
                    if (
                        executionFailureCode(error) !==
                        "documentary_quote_invalid"
                    )
                        throw error;
                    invalid(
                        outcome,
                        "documentary_quote_invalid",
                        "Use an adopted contextual reading matching its immutable capture. Recover a valid reading or record unfinished work instead of a gap.",
                    );
                    continue;
                }
                const passage = read?.passages[0];
                if (read && passage) {
                    examinedNeed = true;
                    if (
                        data.coveragePolicy &&
                        readings.length < SOURCES_MAX_EVIDENCE_REFERENCES &&
                        !readings.some(
                            (entry) =>
                                entry.captureId === read.captureId &&
                                entry.passageOrder === passage.passageOrder,
                        )
                    )
                        readings.push({
                            sourceId: read.sourceId,
                            captureId: read.captureId,
                            passageOrder: passage.passageOrder,
                        });
                }
            }
            if (!request || request.runId !== run._id)
                invalid(
                    outcome,
                    "sources_work_invalid",
                    "Use only work belonging to this need and preparation, or exact saved-material reads within its retained captures.",
                );
            if (
                request?.status !== "completed" ||
                request.outcome?.kind !== "success"
            ) {
                if (!outcome.unfinished.length)
                    invalid(
                        outcome,
                        "sources_work_unfinished",
                        "Explain unfinished work explicitly; unperformed, failed or unknown work is not a documentary gap.",
                    );
            } else if (
                [
                    "discover_sources_for_need",
                    "search_available_material",
                ].includes(request?.input.kind ?? "") &&
                request &&
                "query" in request.input &&
                request.input.query.trim().length > 0
            )
                examinedNeed = true;
        }
        if (
            !coveredNeeds.has(outcome.needId) &&
            !outcome.gap &&
            !outcome.unfinished.length
        )
            invalid(
                outcome,
                "sources_need_unresolved",
                "Provide usable controlled material, a supported examined gap, or an explicit unfinished explanation.",
            );
        if (readings.length) coverageReadings.set(outcome.needId, readings);
        if (outcome.gap && !examinedNeed)
            invalid(
                outcome,
                "documentary_gap_not_examined",
                "Omit gap unless a successful nonblank discovery/search or an adopted contextual reading examined this need. Scope the gap to the examined material; otherwise record unfinished work.",
            );
        if (!outcome.workRequestIds.length && !outcome.unfinished.length)
            invalid(
                outcome,
                "sources_work_unfinished",
                "Explain unfinished work explicitly; unperformed, failed or unknown work is not a documentary gap.",
            );
    }
    if (issues.length) {
        // Share repeated explanations while retaining every affected path within the correction budget.
        const grouped = new Map<string, Set<string>>();
        for (const { path, expected } of issues) {
            const paths = grouped.get(expected) ?? new Set<string>();
            paths.add(path);
            grouped.set(expected, paths);
        }
        throw executionError(issues[0]?.code ?? "sources_completion_invalid", [
            ...[...grouped].map(([expected, paths]) => ({
                path: [...paths].join(", "),
                expected,
            })),
            {
                path: "needs",
                expected: `Outcome indexes identify these need IDs: ${JSON.stringify(response.needs.slice(0, 8).map((outcome) => outcome.needId.slice(0, 32)))}${response.needs.length > 8 ? ` ... (+${response.needs.length - 8} more)` : ""}`,
            },
        ]);
    }
    const result: Infer<
        typeof import("./sourcesContracts").preparedMaterialValidator
    > = {
        version: 1 as const,
        needsRevision: data.needsRevision,
        outcome: response.needs.some((n) => n.unfinished.length)
            ? documents.length
                ? "partial"
                : "blocked"
            : "complete",
        documents,
        needs: response.needs.map((need) => ({
            ...need,
            contributions: coveredNeeds.get(need.needId) ?? [],
            ...(coverageReadings.has(need.needId)
                ? { coverageReadings: coverageReadings.get(need.needId) }
                : {}),
        })),
        ...(assessmentAuthor
            ? {
                  documentaryAssessment: {
                      author: assessmentAuthor,
                      verification: "not_semantically_reviewed" as const,
                  },
              }
            : {}),
        ...(data.coveragePolicy
            ? {
                  coveragePolicy: data.coveragePolicy,
                  coverageSearches: await Promise.all(
                      data.work.flatMap((work) =>
                          work.discovery
                              ? [observeCoverageSearch(reads, work.requestId)]
                              : [],
                      ),
                  ),
              }
            : {}),
        retentionAuthority: "system_mandate" as const,
        policyVersion: SOURCES_PROTOCOL as typeof SOURCES_PROTOCOL,
    };
    if (
        getDocumentSize({
            ...preparation,
            sourcesMission: { ...data, result },
        }) > CONVEX_MAX_DOCUMENT_BYTES
    )
        throw executionError("sources_result_capacity");
    return {
        material: result,
        async adopt(writer: MutationCtx) {
            await writer.db.patch(preparationId, {
                sourcesMission: { ...data, result },
            });
        },
    };
}

type ControlledSourceQualification = Awaited<
    ReturnType<typeof controlledSourcesContributions>
>[number];
/** The latest qualification per source; earlier versions stay with their owners. */
export function latestSourceQualifications(
    controlled: readonly ControlledSourceQualification[],
) {
    const bySource = new Map<Id<"sources">, ControlledSourceQualification>();
    for (const qualification of controlled) {
        const current = bySource.get(qualification.sourceId);
        if (!current || current.version < qualification.version)
            bySource.set(qualification.sourceId, qualification);
    }
    return bySource;
}

/** Counts effective permissions independently from the control's evidentiary conclusions. */
export function tallyDocumentaryContributions(
    contributions: ControlledSourceQualification["contributions"],
): DocumentaryContributionTally {
    const into: DocumentaryContributionTally = {
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
        effectiveUses: {
            documentary: 0,
            attributed_argument_only: 0,
            context_only: 0,
            blocked: 0,
        },
        inspectionOnly: 0,
    };
    for (const contribution of contributions) {
        into.total++;
        into.kinds[contribution.kind]++;
        const found = contribution.finding?.conclusion;
        if (found === "supported") into.supported++;
        else if (found === "documentary_conflict") into.conflict++;
        else if (found === "not_established") into.notEstablished++;
        else into.unchecked++;
        if (contribution.restrictions.length) into.restricted++;
        into.effectiveUses[contribution.permittedUse]++;
        if (contribution.permittedUse === "blocked") into.inspectionOnly++;
    }
    return into;
}

/** Qualification belongs to one saved representation; retention separately describes the frozen handoff. */
export function projectSourceDocumentState(input: {
    preparationId: Id<"sourceSelectionProposalRebuilds">;
    sourceId: Id<"sources">;
    capture: SourceCaptureIdentity | null;
    result: SourcesPreparation["result"] | undefined;
    decision: ControlledSourceQualification["sourceDecision"] | null;
    qualifications: readonly ControlledSourceQualification[];
}): SourceDocumentState {
    const {
        preparationId,
        sourceId,
        capture,
        result,
        decision,
        qualifications,
    } = input;
    const retained = result?.documents.find(
        (document) => document.sourceId === sourceId,
    );
    const qualification = latestSourceQualifications(
        qualifications.filter(
            (item) =>
                item.sourceId === sourceId &&
                capture?.contentHash !== null &&
                item.captureId === capture?.captureId &&
                item.contentHash === capture?.contentHash,
        ),
    ).get(sourceId);
    return {
        preparationId,
        capture,
        membership:
            decision === "rejected"
                ? "excluded"
                : !result
                  ? "pending"
                  : retained
                    ? "retained"
                    : "not_retained",
        retainedSnapshot:
            retained && result
                ? {
                      needsRevision: result.needsRevision,
                      captureId: retained.captureId,
                      contentHash: retained.contentHash,
                      qualificationTaskId: retained.qualificationTaskId,
                      qualificationVersion: retained.qualificationVersion,
                  }
                : null,
        qualification: qualification
            ? {
                  status: "recorded",
                  taskId: qualification.taskId,
                  version: qualification.version,
                  captureId: qualification.captureId,
                  contentHash: qualification.contentHash,
              }
            : { status: "not_recorded" },
        contextOnly:
            !!qualification?.contributions.some(
                (item) => item.permittedUse === "context_only",
            ) &&
            qualification.contributions.every(
                (item) =>
                    item.permittedUse === "context_only" ||
                    item.permittedUse === "blocked",
            ),
        contributions: qualification
            ? tallyDocumentaryContributions(qualification.contributions)
            : null,
        limitations: qualification?.limitations ?? [],
    };
}

/** Compact ongoing preparation progress derived from current capture, qualification and reading owners without hydrating passages. */
export async function projectSourcesPreparationProgress(
    ctx: QueryCtx,
    args: {
        preparation: Doc<"sourceSelectionProposalRebuilds">;
        mission: Doc<"agentMissions"> | null;
        reads?: SourceReviewReads;
        controlled?: ControlledSourceQualification[];
        readings?: SourcesPreparationProgress["readings"];
    },
): Promise<SourcesPreparationProgress> {
    const { preparation, mission } = args;
    const data = preparation.sourcesMission;
    if (!data) throw executionError("sources_mission_unavailable");
    const reads =
        args.reads ??
        new SourceReviewReads(
            ctx.db,
            preparation.runId,
            SOURCES_HANDOFF_READ_CAPACITY,
        );
    const controlled =
        args.controlled ??
        (await controlledSourcesContributions(ctx, preparation, reads));

    const admittedCaptureIds = new Set(data.captureIds);
    const admittedCaptures = await Promise.all(
        data.captureIds.map(async (captureId) => {
            const capture = await reads.capture(captureId);
            if (!capture || capture.runId !== preparation.runId)
                throw executionError("capture_unavailable");
            return capture;
        }),
    );

    const latestCommittedBySource = new Map<
        Id<"sources">,
        Doc<"sourceCaptures">
    >();
    const sourceIds = new Set<Id<"sources">>();
    for (const capture of admittedCaptures) {
        sourceIds.add(capture.sourceId);
        if (capture.status !== "committed") continue;
        const previous = latestCommittedBySource.get(capture.sourceId);
        if (
            !previous ||
            capture.updatedAt > previous.updatedAt ||
            (capture.updatedAt === previous.updatedAt &&
                (capture._creationTime > previous._creationTime ||
                    (capture._creationTime === previous._creationTime &&
                        capture._id > previous._id)))
        )
            latestCommittedBySource.set(capture.sourceId, capture);
    }
    for (const work of data.work)
        if (work.sourceId) sourceIds.add(work.sourceId);
    for (const qualification of controlled)
        sourceIds.add(qualification.sourceId);
    for (const document of data.result?.documents ?? [])
        sourceIds.add(document.sourceId);

    const captures: SourcesPreparationProgress["captures"] = {
        full: 0,
        partial: 0,
        unknown: 0,
        capturing: 0,
        unavailable: 0,
        notCaptured: 0,
    };
    const effectiveUses: SourcesPreparationProgress["qualifications"]["effectiveUses"] =
        {
            documentary: 0,
            attributed_argument_only: 0,
            context_only: 0,
            blocked: 0,
        };
    let recordedSources = 0;

    const pendingCaptureStates = new Map(
        await Promise.all(
            [...sourceIds]
                .filter((id) => !latestCommittedBySource.has(id))
                .map(
                    async (id) =>
                        [
                            id,
                            await reads.captureState(id, admittedCaptureIds),
                        ] as const,
                ),
        ),
    );
    for (const sourceId of sourceIds) {
        const committed = latestCommittedBySource.get(sourceId) ?? null;
        let state: {
            committed: Doc<"sourceCaptures"> | null;
            capturing: boolean;
            unavailable: boolean;
        };
        if (committed) {
            state = { committed, capturing: false, unavailable: false };
        } else {
            const observed = pendingCaptureStates.get(sourceId);
            if (!observed) throw executionError("capture_unavailable");
            state = observed;
        }
        const availability = captureAvailability(state);
        if (availability === "not_captured") captures.notCaptured++;
        else captures[availability]++;

        const docState = projectSourceDocumentState({
            preparationId: preparation._id,
            sourceId,
            capture: state.committed
                ? {
                      captureId: state.committed._id,
                      contentHash: state.committed.contentHash ?? null,
                  }
                : null,
            result: data.result,
            decision:
                controlled.find((item) => item.sourceId === sourceId)
                    ?.sourceDecision ?? null,
            qualifications: controlled,
        });
        if (
            docState.qualification.status === "recorded" &&
            docState.contributions
        ) {
            recordedSources++;
            effectiveUses.documentary +=
                docState.contributions.effectiveUses.documentary;
            effectiveUses.attributed_argument_only +=
                docState.contributions.effectiveUses.attributed_argument_only;
            effectiveUses.context_only +=
                docState.contributions.effectiveUses.context_only;
            effectiveUses.blocked +=
                docState.contributions.effectiveUses.blocked;
        }
    }

    let readings: SourcesPreparationProgress["readings"];
    if (args.readings) {
        readings = args.readings;
    } else if (mission) {
        const window = await sourcesReadingReferenceWindow(
            ctx,
            mission,
            data,
            reads,
        );
        readings = {
            visibleReferenceCount: window.references.length,
            referencesComplete: window.referencesComplete,
        };
    } else {
        readings = { visibleReferenceCount: 0, referencesComplete: true };
    }

    return {
        version: 1,
        handoff: data.result ? "settled" : "pending",
        captures,
        qualifications: {
            recordedSources,
            effectiveUses,
        },
        readings,
    };
}
