import type { Doc, Id } from "@convex/_generated/dataModel";
import type { MutationCtx, QueryCtx } from "@convex/_generated/server";
import { requireRunAuthority } from "@convex/execution/authority";
import { executionError } from "@convex/execution/errors";
import { MAX_OPERATION_RESULT_BYTES } from "@convex/resourceLimits";
import { getDocumentSize, type Infer } from "convex/values";
import { validate } from "convex-helpers/validators";
import { readResearchContext } from "./researchContext";
import { sha256Hex, stableStringify } from "./sourcePassages";
import {
    assertPreparationExecutionFence,
    assertPreparationObservationFence,
    preparationBudgetBlock,
    readPreparationBudget,
    readPreparationLimits,
} from "./sourcePreparationAuthority";
import { SourceReviewReads } from "./sourceReviewReads";
import { controlledDocumentaryUse } from "./sourceSelectionPolicy";
import {
    type DocumentaryContribution,
    type qualificationSubmissionInput,
    SOURCES_PROTOCOL,
    type SourcesPreparation,
    type sourcesCompletionValidator,
    sourcesEnvelopeValidator,
} from "./sourcesContracts";
import { documentaryContributionEvidenceAvailable } from "./sourceUsage";

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
                (!Number.isSafeInteger(count) || count < 1 || count > 160),
        ) ||
        value.acquisitions > 60
    )
        throw executionError("sources_configuration_unavailable");
    return value;
}

export async function requireSourcesPreparation(
    ctx: Pick<QueryCtx, "db">,
    preparationId: Id<"sourceSelectionProposalRebuilds">,
    observation = false,
) {
    const { preparation, run, revision } = observation
        ? await assertPreparationObservationFence(ctx.db, { preparationId })
        : await assertPreparationExecutionFence(ctx.db, {
              preparationId,
              now: Date.now(),
          });
    if (!preparation.sourcesMission || run.sourcesProtocol !== SOURCES_PROTOCOL)
        throw executionError("sources_scope_invalid");
    return { preparation, run, revision, data: preparation.sourcesMission };
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
    const needs = [
        {
            id: "common-context",
            version: 1,
            information: `Document the company and studied activity within this scope: ${research.scope ?? run.researchAngle ?? "company context"}`,
            questionIds: [] as string[],
            commonContext: true,
        },
        ...(research.framing?.content.questions ?? []).map((question) => ({
            id: `question:${question.id}`,
            version: 1,
            information: question.text,
            questionIds: [question.id],
            commonContext: false,
        })),
    ];
    if (needs.length > envelope.maxNeeds)
        throw executionError("sources_need_capacity");
    const data: SourcesPreparation = {
        protocol: SOURCES_PROTOCOL,
        phase: "initial",
        needsRevision: 1,
        needs,
        envelope,
        searches: 0,
        acquisitions: 0,
        controls: 0,
        restrictedContributions: [],
        captureIds: [],
        qualifications: [],
        work: [],
    };
    await ctx.db.patch(preparationId, { sourcesMission: data });
    return data;
}

/** Reconstruct an entire qualification while preserving independently identified contributions. */
export function reconstructQualification(
    input: Infer<typeof qualificationSubmissionInput>,
    previous: Extract<
        Doc<"aiTaskResults">["output"],
        { kind: "documentary_qualification" }
    > | null,
    data: SourcesPreparation,
    requestKey: string,
) {
    if (
        input.changes.length < 1 ||
        input.changes.length > 15 ||
        (previous?.captureId && previous.captureId !== input.captureId)
    )
        throw executionError("qualification_invalid");
    const contributions: DocumentaryContribution[] = previous
        ? previous.contributions.map((c) => ({ ...c }))
        : [];
    const changed = new Set<string>();
    for (const [index, change] of input.changes.entries()) {
        const id = change.contributionId ?? sha256Hex(`${requestKey}:${index}`);
        const existing = contributions.findIndex((c) => c.id === id);
        if (
            changed.has(id) ||
            (change.contributionId &&
                (existing < 0 ||
                    contributions[existing]?.version !==
                        change.expectedVersion)) ||
            (!change.contributionId && change.expectedVersion !== undefined)
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
            c.evidence.length > 8 ||
            !c.evidence.some((q) => q.captureId === input.captureId) ||
            c.evidence.some(
                (q) =>
                    !q.quotation.trim() ||
                    q.quotation.length > 6000 ||
                    !Number.isSafeInteger(q.passageOrder) ||
                    q.passageOrder < 0,
            )
        )
            throw executionError("qualification_invalid");
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
    if (contributions.length > 15)
        throw executionError("qualification_capacity");
    return contributions;
}

/** Leaves room under Convex's transaction ceilings for authority, preparation and lifecycle reads. */
export const SOURCES_HANDOFF_READ_CAPACITY = {
    bytes: 10 * 1024 * 1024,
    ranges: 3072,
} as const;

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
                "This preparation cannot treat additional documentary instructions. Recording a request cannot reopen it or start another documentary phase. Existing material remains available for inspection.",
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

/** Required conversational state stays bounded; exact source material remains available through saved-material reads. */
export function summarizeSourcesPreparation(
    preparation: Doc<"sourceSelectionProposalRebuilds">,
) {
    const data = preparation.sourcesMission;
    if (!data) return null;
    const preview = (value: string | undefined, limit: number) =>
        value ? Array.from(value).slice(0, limit).join("") : null;
    return {
        preparationId: preparation._id,
        needsRevision: data.needsRevision,
        phase: data.phase,
        needCount: data.needs.length,
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
            };
        }),
        work: {
            registered: data.work.length,
            searches: data.searches,
            acquisitions: data.acquisitions,
            controls: data.controls,
        },
        restrictionCount: data.restrictedContributions.length,
        result: data.result
            ? {
                  outcome: data.result.outcome,
                  documentCount: data.result.documents.length,
                  documents: data.result.documents.map((document) => ({
                      sourceId: document.sourceId,
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
        input: Infer<typeof qualificationSubmissionInput>;
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
    // Keep room for a short gap or unfinished-work explanation for each need.
    const responseBytes = new TextEncoder().encode(
        stableStringify({
            kind: "complete",
            needsRevision: data.needsRevision,
            needs: needOutcomes,
        }),
    ).byteLength;
    if (responseBytes + data.needs.length * 256 > MAX_OPERATION_RESULT_BYTES)
        throw executionError("sources_response_capacity");
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
    if (bytes > 1_048_576) throw executionError("sources_result_capacity");
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
        if (bytes > 1_048_576) throw executionError("sources_result_capacity");
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
    let pendingReceiptBytes = 64 * 1024;
    for (const work of data.work) {
        const request = await reads.request(work.requestId);
        if (request && request.status !== "completed")
            pendingReceiptBytes += 64 * 1024;
    }
    await reads.request(requestId);
    // The qualification is known; its future control is bounded by the storage document limit.
    reads.requireCapacity(
        (qualification
            ? getDocumentSize({ contributions }) + 1024 + 1_048_576
            : 0) + pendingReceiptBytes,
        8,
    );
}

/** Validates accounting and distinguishes new work from omissions in the admitted context. */
export function sourcesCompletionFreshness(
    data: SourcesPreparation,
    response: Infer<typeof sourcesCompletionValidator>,
    admittedWork: SourcesPreparation["work"] = data.work,
): "current" | "stale" {
    if (
        response.needsRevision !== data.needsRevision ||
        response.needs.length !== data.needs.length ||
        new Set(response.needs.map((need) => need.needId)).size !==
            data.needs.length
    )
        throw executionError("sources_needs_unaccounted");
    const missing = new Set<Id<"agentOperationRequests">>();
    for (const outcome of response.needs) {
        if (
            !data.needs.some((need) => need.id === outcome.needId) ||
            outcome.unfinished.some((text) => !text.trim()) ||
            (outcome.gap !== undefined && !outcome.gap.trim())
        )
            throw executionError("sources_need_invalid");
        if (
            new Set(outcome.workRequestIds).size !==
            outcome.workRequestIds.length
        )
            throw executionError("sources_work_unaccounted");
        for (const work of data.work)
            if (
                work.needIds.includes(outcome.needId) &&
                !outcome.workRequestIds.includes(work.requestId)
            )
                missing.add(work.requestId);
    }
    if (admittedWork.some((work) => missing.has(work.requestId)))
        throw executionError("sources_work_unaccounted");
    return missing.size ? "stale" : "current";
}

/** Completion resolves persisted work and current restrictions; it never adopts model-authored source membership. */
export async function completeSources(
    ctx: MutationCtx,
    preparationId: Id<"sourceSelectionProposalRebuilds">,
    response: Infer<typeof sourcesCompletionValidator>,
    sharedReads?: SourceReviewReads,
) {
    const { preparation, run, data } = await requireSourcesPreparation(
        ctx,
        preparationId,
    );
    await requireRunAuthority(ctx, run._id, run.executionGeneration);
    const blocked = preparationBudgetBlock(
        await readPreparationBudget(ctx.db, run, preparation),
        readPreparationLimits(preparation),
    );
    if (blocked) throw executionError(blocked);
    if ((run.executionHarnessDeadlineAt ?? Infinity) <= Date.now())
        throw executionError("execution_deadline");
    sourcesCompletionFreshness(data, response);
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
        for (const contribution of q.contributions)
            if (
                controlledDocumentaryUse(
                    contribution,
                    control.output.kind === "documentary_control"
                        ? control.output.control
                        : null,
                    data.restrictedContributions,
                ) !== "blocked" &&
                (await documentaryContributionEvidenceAvailable(
                    reads,
                    run._id,
                    preparation.corpusRevisionId,
                    contribution,
                ))
            )
                permitted.push(contribution);
        for (const contribution of permitted)
            for (const id of contribution.needIds) {
                const references = coveredNeeds.get(id) ?? [];
                references.push({
                    qualificationTaskId: task._id,
                    contributionId: contribution.id,
                    version: contribution.version,
                });
                coveredNeeds.set(id, references);
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
    for (const outcome of response.needs) {
        const work = data.work.filter((w) =>
            w.needIds.includes(outcome.needId),
        );
        let completedSearch = false;
        for (const requestId of outcome.workRequestIds) {
            const request = await reads.request(requestId);
            if (!work.some((w) => w.requestId === requestId)) {
                if (
                    !request ||
                    !["search_available_material", "read_in_context"].includes(
                        request.input.kind,
                    ) ||
                    request.pin?.kind !== "saved_material_inspection_v1" ||
                    !request.pin.expectedCaptureId ||
                    !data.captureIds.includes(request.pin.expectedCaptureId)
                )
                    throw executionError("sources_work_invalid");
                if (request.missionId) {
                    const owner = await ctx.db.get(request.missionId);
                    if (
                        !owner ||
                        !("scope" in owner) ||
                        owner.scope.kind !== "sources_v1" ||
                        owner.scope.preparationId !== preparationId
                    )
                        throw executionError("sources_work_invalid");
                } else if (request.actor !== "system")
                    throw executionError("sources_work_invalid");
            }
            if (!request || request.runId !== run._id)
                throw executionError("sources_work_invalid");
            if (
                request.status !== "completed" ||
                request.outcome?.kind !== "success"
            ) {
                if (!outcome.unfinished.length)
                    throw executionError("sources_work_unfinished");
            } else if (
                [
                    "discover_sources_for_need",
                    "search_available_material",
                ].includes(request.input.kind) &&
                "query" in request.input &&
                request.input.query.trim().length > 0
            )
                completedSearch = true;
        }
        if (
            !coveredNeeds.has(outcome.needId) &&
            !outcome.gap &&
            !outcome.unfinished.length
        )
            throw executionError("sources_need_unresolved");
        if (outcome.gap && !completedSearch)
            throw executionError("documentary_gap_not_examined");
        if (!outcome.workRequestIds.length && !outcome.unfinished.length)
            throw executionError("sources_work_unfinished");
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
        })),
        retentionAuthority: "system_mandate" as const,
        policyVersion: SOURCES_PROTOCOL as typeof SOURCES_PROTOCOL,
    };
    if (
        getDocumentSize({
            ...preparation,
            sourcesMission: { ...data, result },
        }) > 1_048_576
    )
        throw executionError("sources_result_capacity");
    await ctx.db.patch(preparationId, { sourcesMission: { ...data, result } });
    return result;
}
