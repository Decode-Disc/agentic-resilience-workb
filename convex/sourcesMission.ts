import { internal } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import {
    internalMutation,
    internalQuery,
    type MutationCtx,
    type QueryCtx,
    query,
} from "@convex/_generated/server";
import {
    requireSourcesAcquisitionRequest,
    sourcesObservedDestination,
} from "@convex/domain/documentaryAccess";
import { requireDocumentaryMaterialRequest } from "@convex/domain/savedMaterial";
import {
    acquireDocumentRequest,
    supportsScopedDocumentaryExamination,
} from "@convex/domain/savedMaterialOperations";
import { readSourceCandidateCapacity } from "@convex/domain/sourceCandidateCapacity";
import { sha256Hex, stableStringify } from "@convex/domain/sourcePassages";
import {
    readPreparationConcurrency,
    readPreparationSourceDecision,
} from "@convex/domain/sourcePreparationAuthority";
import { SourceReviewReads } from "@convex/domain/sourceReviewReads";
import {
    controlledDocumentaryUses,
    documentaryControlIssue,
} from "@convex/domain/sourceSelectionPolicy";
import {
    assertSourcesCompletionCapacity,
    authorizeDocumentaryDiscovery,
    controlledSourcesContributions,
    hasEngagedSourcesControl,
    initializeSources,
    projectPreparedMaterial,
    readEngagedSourcesWork,
    readPreparedNeed,
    readSourcesMission,
    reconstructQualification,
    requireSourcesPreparation,
    type SourcesSettlementCause,
    sourcesContinuationAvailable,
    sourcesResourceStatus,
    sourcesSettlementNote,
} from "@convex/domain/sources";
import {
    authorizedDiscovery,
    captureExaminationValidator,
    documentaryContributionValidator,
    documentaryControlV2Validator,
    documentaryNeedValidator,
    documentaryStatusValidator,
    documentarySubmissionResult,
    documentarySubmissionValue,
    documentaryUseOrder,
    preparedMaterialInspectionValidator,
    preparedNeedInspectionValidator,
    type SourcesOperation,
    sourcesEnvelopeValidator,
    sourcesOperationValidator,
} from "@convex/domain/sourcesContracts";
import {
    documentaryQuotationMatches,
    materializeDocumentaryEvidence,
} from "@convex/domain/sourceUsage";
import {
    isResumableResearchPause,
    isSourcesSettlementPause,
    supportsResearchControl,
} from "@convex/domain/transitions";
import {
    hasWaitingWorkbenchInstructions,
    processWorkbenchInstructions,
} from "@convex/domain/workbenchInstructions";
import {
    getAgentDefinition,
    getNativeOperation,
} from "@convex/execution/agentCatalog";
import type { AuditActor } from "@convex/execution/approvalContracts";
import {
    requireDossierAuthority,
    requireMissionObservationAuthority,
    requireRunAuthority,
    requireSettlementAuthority,
} from "@convex/execution/authority";
import { executionError, executionFailureCode } from "@convex/execution/errors";
import {
    operationHasStarted,
    operationOutcomeValidator,
    ownsScheduledEpoch,
} from "@convex/execution/executionProtocol";
import { recordContextObservation } from "@convex/execution/journal";
import { missionObjectiveKey } from "@convex/execution/missionData";
import { operationSuccess } from "@convex/execution/operationResults";
import { registerOperationWaitEvent } from "@convex/execution/operations";
import {
    notifyResearchControlWaits,
    recordResearchObservation,
    suspendInterruptedResearch,
} from "@convex/execution/researchControl";
import {
    completeRetainedText,
    retainedTextRange,
    verifyRetainedText,
} from "@convex/execution/retainedText";
import { requireQualificationResultDeadline } from "@convex/providerCalls";
import { transitionResearchRun } from "@convex/researchRuns";
import {
    CONVEX_MAX_DOCUMENT_BYTES,
    MAX_OPERATION_RESULT_BYTES,
    SOURCES_HANDOFF_READ_CAPACITY,
    SOURCES_MAX_EVIDENCE_REFERENCES,
} from "@convex/resourcePolicy";
import {
    simulatedDocumentaryControl,
    sourcesSimulationEnabled,
} from "@convex/sourcesSimulation";
import { getDocumentSize, v } from "convex/values";
import { validate } from "convex-helpers/validators";
import { requireWorkspaceRun } from "./runWorkspace";
import schema from "./schema";

export const claim = internalMutation({
    args: {
        runId: v.id("researchRuns"),
        corpusRevisionId: v.id("corpusRevisions"),
        expectedGeneration: v.number(),
        envelope: sourcesEnvelopeValidator,
    },
    returns: v.id("sourceSelectionProposalRebuilds"),
    handler: async (
        ctx,
        args,
    ): Promise<Id<"sourceSelectionProposalRebuilds">> => {
        await requireRunAuthority(ctx, args.runId, args.expectedGeneration);
        const id = await ctx.runMutation(
            internal.sourcePreparation.claimForDiscovery,
            {
                runId: args.runId,
                corpusRevisionId: args.corpusRevisionId,
                expectedExecutionGeneration: args.expectedGeneration,
            },
        );
        await initializeSources(ctx, id, args.envelope);
        await ctx.scheduler.runAfter(
            0,
            internal.workbench.processInstructions,
            { runId: args.runId },
        );
        return id;
    },
});

export const inspect = internalQuery({
    args: { runId: v.id("researchRuns") },
    returns: v.union(schema.doc("sourceSelectionProposalRebuilds"), v.null()),
    handler: async (
        ctx,
        args,
    ): Promise<Doc<"sourceSelectionProposalRebuilds"> | null> => {
        const { run } = await requireDossierAuthority(ctx, args.runId);
        return run.sourcePreparationId
            ? ctx.db.get(run.sourcePreparationId)
            : null;
    },
});

const workArgs = {
    requestId: v.id("agentOperationRequests"),
    expectedGeneration: v.number(),
    epoch: v.optional(v.number()),
};
async function workContext(
    ctx: QueryCtx,
    args: {
        requestId: Id<"agentOperationRequests">;
        expectedGeneration: number;
        epoch?: number;
        recoveryAdoption?: true;
    },
    observation = false,
) {
    const request = await ctx.db.get(args.requestId);
    const fencedAdoption =
        args.recoveryAdoption &&
        request?.scheduledExecution?.phase === "waiting_provider" &&
        request.scheduledExecution.epoch === args.epoch &&
        (request.adoptionGeneration ?? request.expectedGeneration) ===
            args.expectedGeneration;
    if (
        request?.scheduledExecution &&
        !fencedAdoption &&
        (args.epoch === undefined ||
            !ownsScheduledEpoch(request, args.expectedGeneration, args.epoch) ||
            request.scheduledExecution.phase !== "running")
    )
        throw executionError("stale_execution");
    if (request?.input.kind === "acquire_document") {
        const target = await requireSourcesAcquisitionRequest(
            ctx,
            request,
            args.expectedGeneration,
        );
        return {
            ...target,
            request,
            input: request.input,
            acquisition: target,
        };
    }
    if (
        !request ||
        (!fencedAdoption &&
            (!operationHasStarted(request) ||
                (request.scheduledExecution?.dispatchGeneration ??
                    request.expectedGeneration) !== args.expectedGeneration)) ||
        request.pin?.kind !== "sources_v1" ||
        !validate(sourcesOperationValidator, request.input)
    )
        throw executionError("operation_not_dispatched");
    const state = await requireSourcesPreparation(
        ctx,
        request.pin.preparationId,
        observation ? "observation" : "execution",
    );
    if (observation && request.missionId)
        await requireMissionObservationAuthority(
            ctx,
            request.missionId,
            args.expectedGeneration,
        );
    else if (
        observation &&
        state.run.agentExecutionVersion === 3 &&
        isResumableResearchPause(state.run) &&
        state.run.executionGeneration === args.expectedGeneration + 1
    )
        await requireDossierAuthority(ctx, state.run._id);
    else await requireRunAuthority(ctx, state.run._id, args.expectedGeneration);
    if (
        request.runId !== state.run._id ||
        request.pin.needsRevision > state.data.needsRevision
    )
        throw executionError("sources_version_conflict");
    return {
        ...state,
        request,
        input: request.input as SourcesOperation,
        acquisition: undefined,
    };
}

const proposalReturn = v.object({
    scheduledRecovery: v.optional(v.literal("structured_model_v1")),
    originalExaminationJson: v.optional(v.string()),
    needContext: v.array(documentaryNeedValidator),
    preparation: schema.doc("sourceSelectionProposalRebuilds"),
    input: v.union(sourcesOperationValidator, acquireDocumentRequest),
    contributions: v.array(documentaryContributionValidator),
    inputHash: v.string(),
    sourceId: v.optional(v.id("sources")),
    discoveryLimit: v.optional(v.number()),
    discovery: v.optional(authorizedDiscovery),
});
export const reserve = internalMutation({
    args: workArgs,
    returns: proposalReturn,
    handler: async (
        ctx,
        args,
    ): Promise<import("convex/values").Infer<typeof proposalReturn>> => {
        const {
            preparation,
            run,
            revision,
            data,
            input,
            request,
            acquisition,
        } = await workContext(ctx, args);
        if (data.result) throw executionError("preparation_completed");
        const reads = new SourceReviewReads(
            ctx.db,
            run._id,
            SOURCES_HANDOFF_READ_CAPACITY,
        );
        const needIds =
            input.kind === "submit_documentary_qualification"
                ? [
                      ...new Set(
                          input.changes.flatMap((c) => c.contribution.needIds),
                      ),
                  ]
                : input.kind === "acquire_document"
                  ? []
                  : [input.needId];
        if (needIds.some((id) => !data.needs.some((n) => n.id === id)))
            throw executionError("documentary_need_unknown");
        const scheduled = request.scheduledExecution;
        const firstInvocationId =
            scheduled?.phase === "running"
                ? scheduled.firstInvocationId
                : undefined;
        const priorWork = data.work.find((w) => w.requestId === request._id);
        if (priorWork && !firstInvocationId)
            throw executionError("operation_outcome_unknown");
        if (
            input.kind === "submit_documentary_qualification" ||
            input.kind === "request_documentary_check"
        ) {
            if (
                await hasEngagedSourcesControl(
                    reads,
                    priorWork
                        ? {
                              ...data,
                              work: data.work.filter(
                                  (w) => w.requestId !== request._id,
                              ),
                          }
                        : data,
                )
            )
                throw executionError("documentary_control_in_progress");
        }
        const acquires =
            input.kind === "make_source_consultable" ||
            input.kind === "acquire_document";
        if (acquires) {
            const acquisitions = await Promise.all(
                data.work
                    .filter(
                        (w) =>
                            w.kind === "make_source_consultable" ||
                            w.kind === "acquire_document",
                    )
                    .map((w) => ctx.db.get(w.requestId)),
            );
            if (
                acquisitions.filter(
                    (r) =>
                        r &&
                        ["running", "waiting", "unknown"].includes(r.status),
                ).length >= readPreparationConcurrency(preparation)
            )
                throw executionError("preparation_concurrency_limit");
        }
        const field =
            input.kind === "discover_sources_for_need"
                ? "searches"
                : acquires
                  ? "acquisitions"
                  : "controls";
        const resources = sourcesResourceStatus(data);
        const block = resources[field].blockCode ?? resources.work.blockCode;
        if (block && !priorWork) throw executionError(block);
        const discovery =
            input.kind === "discover_sources_for_need"
                ? authorizeDocumentaryDiscovery(
                      data.coveragePolicy?.preset,
                      input,
                  )
                : undefined;
        const capacity =
            input.kind === "discover_sources_for_need"
                ? await readSourceCandidateCapacity(
                      ctx.db,
                      run._id,
                      data.phase === "initial"
                          ? "initial_discovery"
                          : "dossier",
                  )
                : null;
        if (capacity?.remaining === 0)
            throw executionError("source_candidate_limit");
        let sourceId =
            acquisition?.source?._id ??
            ("sourceId" in input ? input.sourceId : undefined);
        let observed = acquisition?.observed;
        if (input.kind === "make_source_consultable") {
            if (
                input.sourceId &&
                (input.observedCaptureId !== undefined ||
                    input.observedLinkIndex !== undefined)
            )
                throw executionError("acquisition_target_invalid");
            if (!input.sourceId)
                observed = await sourcesObservedDestination(
                    ctx,
                    { run, revision, preparation, data },
                    input.observedCaptureId,
                    input.observedLinkIndex,
                );
        }
        if (!sourceId && observed) {
            const { url, providerReference } = observed;
            await ctx.runMutation(internal.sourceDiscovery.persistCandidates, {
                runId: run._id,
                corpusRevisionId: preparation.corpusRevisionId,
                executionGeneration: args.expectedGeneration,
                operationKey: `observed:${request._id}`,
                candidates: [
                    {
                        canonicalUrl: url,
                        title: url,
                        origin: "exa",
                        category: "observed_destination",
                        providerReference,
                    },
                ],
            });
            const candidate = await ctx.db
                .query("sources")
                .withIndex("by_run_and_url", (q) =>
                    q.eq("runId", run._id).eq("canonicalUrl", url),
                )
                .unique();
            if (!candidate) throw executionError("source_candidate_limit");
            sourceId = candidate._id;
        }
        if (
            sourceId &&
            (await readPreparationSourceDecision(ctx.db, {
                runId: run._id,
                corpusRevisionId: preparation.corpusRevisionId,
                sourceId,
            })) === "rejected"
        )
            throw executionError("source_rejected");
        let contributions: import("@convex/domain/sourcesContracts").DocumentaryContribution[] =
            [];
        let proposedQualification: Parameters<
            typeof assertSourcesCompletionCapacity
        >[3] = null;
        if (input.kind === "submit_documentary_qualification") {
            const current = await Promise.all(
                data.qualifications.map((id) => reads.task(id)),
            );
            const previous = current.find(
                (task) => task?.sourceId === input.sourceId,
            );
            if (
                (previous?._id ?? null) !== input.expectedTaskId ||
                (previous &&
                    previous.output.kind !== "documentary_qualification")
            )
                throw executionError("qualification_version_conflict");
            const capture = await reads.capture(input.captureId);
            if (
                !capture ||
                capture.sourceId !== input.sourceId ||
                capture.runId !== run._id ||
                capture.status !== "committed"
            )
                throw executionError("capture_unavailable");
            const materialized = {
                ...input,
                changes: await Promise.all(
                    input.changes.map(async (change, index) => ({
                        ...change,
                        contribution: {
                            ...change.contribution,
                            evidence: await materializeDocumentaryEvidence(
                                reads,
                                request,
                                data,
                                change.contribution.evidence,
                                `changes[${index}].contribution.evidence`,
                            ),
                        },
                    })),
                ),
            };
            contributions = reconstructQualification(
                materialized,
                previous?.output.kind === "documentary_qualification"
                    ? previous.output
                    : null,
                data,
                request.logicalKey,
            );
            proposedQualification = {
                input: materialized,
                contributions,
                contentHash: capture.contentHash ?? "",
            };
        } else if (input.kind === "request_documentary_check") {
            if (
                !input.proposition.trim() ||
                input.proposition.length > 4000 ||
                !input.evidence.length ||
                input.evidence.length > SOURCES_MAX_EVIDENCE_REFERENCES
            )
                throw executionError("documentary_check_invalid");
            const evidence = await materializeDocumentaryEvidence(
                reads,
                request,
                data,
                input.evidence,
            );
            contributions = [
                {
                    id: "target",
                    version: 1,
                    needIds,
                    statement: input.proposition,
                    period: "as referenced",
                    modality: "documentary check",
                    attribution: "as referenced",
                    kind: "context",
                    evidence,
                },
            ];
            if (input.targets?.length) {
                if (input.targets.length > 15)
                    throw executionError("documentary_check_invalid");
                contributions = [];
                for (const target of input.targets) {
                    const task = await ctx.db.get(target.qualificationTaskId);
                    const contribution =
                        task?.output.kind === "documentary_qualification"
                            ? task.output.contributions.find(
                                  (c) =>
                                      c.id === target.contributionId &&
                                      c.version === target.version,
                              )
                            : null;
                    if (
                        !contribution ||
                        task?.runId !== run._id ||
                        contribution.statement !== input.proposition ||
                        (target.needId !== undefined &&
                            (target.needId !== input.needId ||
                                !contribution.needIds.includes(target.needId)))
                    )
                        throw executionError("documentary_target_invalid");
                    contributions.push({
                        ...contribution,
                        evidence,
                    });
                }
            }
        }
        const evidence = contributions.flatMap((c) => c.evidence);
        for (const quote of evidence) {
            const capture = await reads.capture(quote.captureId);
            if (
                !capture ||
                capture.runId !== run._id ||
                !data.captureIds.includes(capture._id) ||
                capture.status !== "committed" ||
                !capture.contentHash ||
                (await reads.decision(
                    preparation.corpusRevisionId,
                    capture.sourceId,
                )) === "rejected"
            )
                throw executionError("capture_unavailable");
            const passage = await reads.passage(
                preparation.corpusRevisionId,
                capture._id,
                quote.passageOrder,
            );
            if (
                !documentaryQuotationMatches(
                    passage,
                    capture.contentHash,
                    quote.quotation,
                )
            )
                throw executionError("documentary_quote_invalid");
        }
        const restrictionBytes =
            input.kind === "request_documentary_check"
                ? (input.targets ?? []).reduce(
                      (bytes, target) =>
                          bytes +
                          getDocumentSize({
                              ...target,
                              controlTaskId: "x".repeat(64),
                              permittedUse: "attributed_argument_only",
                          }),
                      0,
                  )
                : 0;
        const nextData = priorWork
            ? data
            : {
                  ...data,
                  [field]: data[field] + 1,
                  work: [
                      ...data.work,
                      {
                          requestId: request._id,
                          kind: input.kind,
                          needIds,
                          ...(discovery ? { discovery } : {}),
                          ...(sourceId ? { sourceId } : {}),
                      },
                  ],
              };
        await assertSourcesCompletionCapacity(
            reads,
            preparation,
            nextData,
            proposedQualification,
            request._id,
            restrictionBytes,
        );
        const inputHash =
            acquisition?.pin.target.requestInputHash ??
            sha256Hex(
                stableStringify({
                    protocol: data.protocol,
                    preparationId: preparation._id,
                    purpose: input.kind,
                    ...([
                        "discover_sources_for_need",
                        "make_source_consultable",
                    ].includes(input.kind)
                        ? { input }
                        : {}),
                    ...(discovery?.focus ? { discovery } : {}),
                    ...(input.kind === "submit_documentary_qualification" ||
                    input.kind === "request_documentary_check"
                        ? {
                              controlVersion: 2,
                              restrictions:
                                  input.kind === "request_documentary_check"
                                      ? (input.targets ?? [])
                                      : [],
                          }
                        : {}),
                    contributions,
                    needs: data.needs.filter((n) =>
                        contributions.some((c) => c.needIds.includes(n.id)),
                    ),
                }),
            );
        let originalExaminationJson: string | undefined;
        if (firstInvocationId) {
            const original = await ctx.db.get(firstInvocationId);
            if (
                original?.preparationInputHash !== inputHash ||
                !priorWork ||
                !original.inputJson ||
                sha256Hex(original.inputJson) !== original.inputContentHash
            )
                throw executionError("version_conflict");
            originalExaminationJson = original.inputJson;
        } else
            await ctx.db.patch(preparation._id, { sourcesMission: nextData });
        const mission = request.missionId
            ? await ctx.db.get(request.missionId)
            : null;
        const definition = mission
            ? getAgentDefinition(
                  mission.definitionId,
                  mission.definitionVersion,
              )
            : null;
        const operation =
            definition?.operations[input.kind] ??
            getNativeOperation(input.kind);
        return {
            preparation,
            originalExaminationJson,
            ...(operation?.effectKind === "durable_effect" &&
            operation.scheduledAction &&
            operation.scheduledRecovery
                ? { scheduledRecovery: operation.scheduledRecovery }
                : {}),
            input,
            contributions,
            inputHash,
            ...(discovery ? { discovery } : {}),
            needContext: data.needs.filter((n) =>
                contributions.some((c) => c.needIds.includes(n.id)),
            ),
            ...(sourceId ? { sourceId } : {}),
            ...(capacity
                ? { discoveryLimit: Math.min(4, capacity.remaining) }
                : {}),
        };
    },
});

export const assertActive = internalQuery({
    args: workArgs,
    returns: v.union(v.null(), v.object({ discoveryLimit: v.number() })),
    handler: async (ctx, args) => {
        const { run, data, input } = await workContext(ctx, args);
        if (input.kind === "discover_sources_for_need") {
            const capacity = await readSourceCandidateCapacity(
                ctx.db,
                run._id,
                data.phase === "initial" ? "initial_discovery" : "dossier",
            );
            if (!capacity.remaining)
                throw executionError("source_candidate_limit");
            return { discoveryLimit: Math.min(4, capacity.remaining) };
        }
        return null;
    },
});

async function documentaryControlReceipt(
    ctx: QueryCtx,
    preparationId: Id<"sourceSelectionProposalRebuilds">,
    input:
        | { kind: "submit_documentary_qualification" }
        | Pick<
              Extract<SourcesOperation, { kind: "request_documentary_check" }>,
              "kind" | "targets"
          >,
    taskId: Id<"aiTaskResults">,
    reference: Id<"agentExecutionEvents">,
    objectionCount: number,
): Promise<import("convex/values").Infer<typeof documentarySubmissionValue>> {
    const current = await ctx.db.get(preparationId);
    if (!current?.sourcesMission)
        throw executionError("sources_mission_unavailable");
    const qualifications =
        input.kind === "submit_documentary_qualification"
            ? [taskId]
            : [
                  ...new Set(
                      input.targets?.map(
                          (target) => target.qualificationTaskId,
                      ) ?? [],
                  ),
              ];
    const projected = await controlledSourcesContributions(ctx, {
        ...current,
        sourcesMission: {
            ...current.sourcesMission,
            qualifications,
        },
    });
    const contributions = projected.flatMap(
        (qualification) => qualification.contributions,
    );
    const needOrder = [
        ...new Set(contributions.flatMap(({ needs }) => Object.keys(needs))),
    ].sort();
    const receipt = {
        taskId,
        controlVersion: 2 as const,
        reference,
        objectionCount,
        needOrder,
        effectiveContributions: contributions.map(
            ({ id, version, permittedUse, needs }) => ({
                id,
                version,
                permittedUse,
                usesByNeed: needOrder.map((need) => needs[need] ?? null),
            }),
        ),
    };
    if (
        new TextEncoder().encode(JSON.stringify(receipt)).length >
        MAX_OPERATION_RESULT_BYTES
    )
        throw executionError("sources_result_capacity");
    return receipt;
}

async function retainedControlTask(
    ctx: QueryCtx,
    runId: Id<"researchRuns">,
    taskType: "documentary_control" | "documentary_qualification",
    inputHash: string,
) {
    return ctx.db
        .query("aiTaskResults")
        .withIndex("by_run_and_task_type_and_input_hash", (q) =>
            q
                .eq("runId", runId)
                .eq("taskType", taskType)
                .eq("inputHash", inputHash),
        )
        .unique();
}

export const retainControl = internalMutation({
    args: {
        ...workArgs,
        inputHash: v.string(),
        contributions: v.array(documentaryContributionValidator),
        control: documentaryControlV2Validator,
        recoveryAdoption: v.optional(v.literal(true)),
        providerCallId: v.optional(v.id("providerCalls")),
    },
    returns: documentarySubmissionValue,
    handler: async (
        ctx,
        args,
    ): Promise<
        import("convex/values").Infer<typeof documentarySubmissionValue>
    > => {
        const { preparation, run, data, input, request } = await workContext(
            ctx,
            args,
            true,
        );
        const simulation = await sourcesSimulationEnabled(ctx, run._id);
        const call = args.providerCallId
            ? await ctx.db.get(args.providerCallId)
            : null;
        if (
            simulation &&
            (args.providerCallId ||
                stableStringify(args.control) !==
                    stableStringify(
                        simulatedDocumentaryControl(args.contributions),
                    ))
        )
            throw executionError("documentary_control_unavailable");
        if (
            !simulation &&
            (!call ||
                call.runId !== run._id ||
                call.preparationId !== preparation._id ||
                (request.scheduledExecution &&
                    call.operationRequestId === request._id &&
                    call.operationEpoch !== args.epoch) ||
                call.inputHash !== args.inputHash ||
                call.status !== "succeeded" ||
                call.operation !== "source_documentary_control")
        )
            throw executionError("documentary_control_unavailable");
        if (call) await requireQualificationResultDeadline(ctx, call);
        const issue = documentaryControlIssue(args.contributions, args.control);
        if (issue)
            throw executionError("documentary_control_invalid", [
                { path: "control", expected: issue },
            ]);
        const sourceId = "sourceId" in input ? input.sourceId : undefined;
        if (!sourceId) throw executionError("documentary_control_invalid");
        const reads = new SourceReviewReads(
            ctx.db,
            run._id,
            SOURCES_HANDOFF_READ_CAPACITY,
        );
        if (
            input.kind !== "submit_documentary_qualification" &&
            input.kind !== "request_documentary_check"
        )
            throw executionError("documentary_control_invalid");
        const existing = await retainedControlTask(
            ctx,
            run._id,
            "documentary_control",
            args.inputHash,
        );
        const result = (
            taskId: Id<"aiTaskResults">,
            reference: Id<"agentExecutionEvents">,
        ) =>
            documentaryControlReceipt(
                ctx,
                preparation._id,
                input,
                taskId,
                reference,
                args.control.objections.length,
            );
        const base = {
            runId: run._id,
            corpusRevisionId: preparation.corpusRevisionId,
            sourceId,
            executionMode: simulation
                ? ("showcase" as const)
                : ("live" as const),
            ...(simulation
                ? { fixtureId: "sources-simulation", fixtureVersion: "1" }
                : {}),
            schemaVersion: "documentary-control-v2",
            adapterVersion: "one-shot-v1",
            inputHash: args.inputHash,
            ...(call ? { providerCallId: call._id } : {}),
            createdAt: Date.now(),
        };
        const output = {
            kind: "documentary_control" as const,
            preparationId: preparation._id,
            evidence: args.contributions.flatMap((c) => c.evidence),
            inputHash: args.inputHash,
            examination: {
                state: "examined" as const,
                contractVersion: 2 as const,
                control: args.control,
            },
        };
        if (
            existing &&
            (existing.output.kind !== "documentary_control" ||
                stableStringify(existing.output) !== stableStringify(output) ||
                existing.providerCallId !== call?._id)
        )
            throw executionError("documentary_control_invalid");
        const controlRecord = {
            ...base,
            taskType: "documentary_control" as const,
            output,
        };
        if (getDocumentSize(controlRecord) > CONVEX_MAX_DOCUMENT_BYTES)
            throw executionError("sources_result_capacity");
        const controlTaskId =
            existing?._id ??
            (await ctx.db.insert("aiTaskResults", controlRecord));
        if (input.kind === "request_documentary_check") {
            const restrictions = (input.targets ?? []).flatMap((target) => {
                const contribution = args.contributions.find(
                    (item) => item.id === target.contributionId,
                );
                if (!contribution)
                    throw executionError("documentary_target_invalid");
                const uses = controlledDocumentaryUses(
                    contribution,
                    args.control,
                );
                const rootUse = uses.permittedUse;
                const scopes =
                    target.needId !== undefined
                        ? [target.needId]
                        : [undefined, ...contribution.needIds];
                return scopes.flatMap((needId) => {
                    const use =
                        needId === undefined
                            ? rootUse
                            : (uses.needs[needId] ?? "blocked");
                    if (
                        use === "documentary" ||
                        (target.needId === undefined &&
                            needId !== undefined &&
                            use === rootUse)
                    )
                        return [];
                    return [
                        {
                            ...target,
                            ...(needId !== undefined ? { needId } : {}),
                            controlTaskId,
                            permittedUse: use,
                        },
                    ];
                });
            });
            if (restrictions.length)
                await ctx.db.patch(preparation._id, {
                    sourcesMission: {
                        ...data,
                        restrictedContributions: [
                            ...data.restrictedContributions,
                            ...restrictions.filter(
                                (restriction) =>
                                    !data.restrictedContributions.some(
                                        (prior) =>
                                            prior.controlTaskId ===
                                                restriction.controlTaskId &&
                                            prior.contributionId ===
                                                restriction.contributionId &&
                                            prior.version ===
                                                restriction.version &&
                                            prior.needId === restriction.needId,
                                    ),
                            ),
                        ],
                    },
                });
            const reference = await recordContextObservation(ctx, run._id, {
                key: `documentary-restrictions:${controlTaskId}`,
                topic: "documentary",
                actor: { type: "system" },
                value: {
                    event: "contributions_restricted",
                    preparationId: preparation._id,
                    controlTaskId,
                    restrictions,
                    control: args.control,
                },
            });
            return result(controlTaskId, reference);
        }
        if (input.kind !== "submit_documentary_qualification")
            throw executionError("documentary_control_invalid");
        const capture = await ctx.db.get(input.captureId);
        if (!capture?.contentHash) throw executionError("capture_unavailable");
        const previous = input.expectedTaskId
            ? await ctx.db.get(input.expectedTaskId)
            : null;
        const reconstructed = reconstructQualification(
            {
                ...input,
                changes: await Promise.all(
                    input.changes.map(async (change, index) => ({
                        ...change,
                        contribution: {
                            ...change.contribution,
                            evidence: await materializeDocumentaryEvidence(
                                reads,
                                request,
                                data,
                                change.contribution.evidence,
                                `changes[${index}].contribution.evidence`,
                            ),
                        },
                    })),
                ),
            },
            previous?.output.kind === "documentary_qualification"
                ? previous.output
                : null,
            data,
            (await ctx.db.get(args.requestId))?.logicalKey ?? "",
        );
        if (
            stableStringify(reconstructed) !==
            stableStringify(args.contributions)
        )
            throw executionError("qualification_version_conflict");
        const current = await Promise.all(
            data.qualifications.map((id) => ctx.db.get(id)),
        );
        if (
            (current.find((task) => task?.sourceId === sourceId)?._id ??
                null) !== input.expectedTaskId
        )
            throw executionError("qualification_version_conflict");
        if (
            previous?.output.kind === "documentary_qualification" &&
            previous.output.controlTaskId === controlTaskId &&
            stableStringify(previous.output.contributions) ===
                stableStringify(reconstructed)
        ) {
            const observation = await ctx.db
                .query("agentExecutionEvents")
                .withIndex("by_run_and_context_key", (q) =>
                    q
                        .eq("runId", run._id)
                        .eq(
                            "contextObservation.key",
                            `documentary-qualification:${previous._id}`,
                        ),
                )
                .unique();
            if (!observation)
                throw executionError("documentary_control_unavailable");
            return result(previous._id, observation._id);
        }
        const taskId = await ctx.db.insert("aiTaskResults", {
            ...base,
            schemaVersion: "documentary-qualification-v1",
            sourceCaptureId: capture._id,
            taskType: "documentary_qualification",
            output: {
                kind: "documentary_qualification",
                preparationId: preparation._id,
                captureId: capture._id,
                contentHash: capture.contentHash,
                version:
                    previous?.output.kind === "documentary_qualification"
                        ? previous.output.version + 1
                        : 1,
                ...(previous ? { previousTaskId: previous._id } : {}),
                contributions: reconstructed,
                controlTaskId,
            },
        });
        await ctx.db.patch(preparation._id, {
            sourcesMission: {
                ...data,
                qualifications: [
                    ...data.qualifications.filter(
                        (id) => id !== input.expectedTaskId,
                    ),
                    taskId,
                ],
            },
        });
        const reference = await recordContextObservation(ctx, run._id, {
            key: `documentary-qualification:${taskId}`,
            topic: "documentary",
            actor: { type: "system" },
            value: {
                event: "contributions_qualified",
                preparationId: preparation._id,
                taskId,
                captureId: capture._id,
                contentHash: capture.contentHash,
                contributions: reconstructed,
                controlTaskId,
                control: args.control,
            },
        });
        return result(taskId, reference);
    },
});

/** Resolves factual control or a validated one-shot commit before the operation is marked unknown. */
export const recoverScheduledControl = internalMutation({
    args: workArgs,
    returns: v.union(operationOutcomeValidator, v.null()),
    handler: async (
        ctx,
        args,
    ): Promise<
        import("convex/values").Infer<typeof operationOutcomeValidator> | null
    > => {
        const request = await ctx.db.get(args.requestId);
        if (
            !request?.runId ||
            request.pin?.kind !== "sources_v1" ||
            (request.input.kind !== "submit_documentary_qualification" &&
                request.input.kind !== "request_documentary_check")
        )
            return null;
        const call = await ctx.db
            .query("providerCalls")
            .withIndex("by_operation_request_and_attempt", (q) =>
                q.eq("operationRequestId", request._id),
            )
            .order("desc")
            .first();
        const preparationId = request.pin.preparationId;
        const runId = request.runId;
        if (
            !call?.inputHash ||
            !call.invocationId ||
            call.service !== "model" ||
            call.operation !== "source_documentary_control" ||
            call.status !== "succeeded" ||
            call.preparationId !== preparationId ||
            call.runId !== request.runId ||
            (request.scheduledExecution &&
                (call.operationEpoch !== request.scheduledExecution.epoch ||
                    call.executionGeneration !==
                        request.scheduledExecution.dispatchGeneration))
        )
            return null;
        const outcome = (
            receipt: import("convex/values").Infer<
                typeof documentarySubmissionValue
            >,
        ) =>
            operationSuccess(documentarySubmissionResult, receipt, {
                progressKeys: [sha256Hex(`control:${call.inputHash}`)],
            });
        const control = await retainedControlTask(
            ctx,
            request.runId,
            "documentary_control",
            call.inputHash,
        );
        if (
            control?.output.kind === "documentary_control" &&
            control.output.examination.state === "examined" &&
            control.providerCallId === call._id
        ) {
            const check = request.input.kind === "request_documentary_check";
            const task = check
                ? control
                : await retainedControlTask(
                      ctx,
                      request.runId,
                      "documentary_qualification",
                      call.inputHash,
                  );
            if (
                task &&
                (check ||
                    (task.output.kind === "documentary_qualification" &&
                        task.output.controlTaskId === control._id))
            ) {
                const key = check
                    ? `documentary-restrictions:${task._id}`
                    : `documentary-qualification:${task._id}`;
                const event = await ctx.db
                    .query("agentExecutionEvents")
                    .withIndex("by_run_and_context_key", (q) =>
                        q.eq("runId", runId).eq("contextObservation.key", key),
                    )
                    .unique();
                if (event?.contextObservation)
                    return outcome(
                        await documentaryControlReceipt(
                            ctx,
                            preparationId,
                            request.input,
                            task._id,
                            event._id,
                            control.output.examination.control.objections
                                .length,
                        ),
                    );
            }
        }
        const invocation = await ctx.db.get(call.invocationId);
        if (
            !invocation ||
            invocation.providerCallId !== call._id ||
            invocation.preparationInputHash !== call.inputHash ||
            invocation.generation !== call.executionGeneration
        )
            return null;
        if (invocation.status === "blocked" && invocation.blockCode)
            return { kind: "unavailable", code: invocation.blockCode };
        if (invocation.status !== "returned" || !invocation.inputJson)
            return null;
        const run = await ctx.db.get(runId);
        if (
            run?.executionStatus !== "running" ||
            run.executionGeneration !== args.expectedGeneration ||
            run.researchPauseRequested
        )
            return null;
        let output = invocation.outputJson;
        if (invocation.outputTextId) {
            const text = await completeRetainedText(
                ctx,
                invocation.outputTextId,
            );
            output = verifyRetainedText(
                text,
                await retainedTextRange(ctx, text, 0, text.characters),
            );
        }
        if (!output) return null;
        const observed: unknown = JSON.parse(output);
        const original: unknown = JSON.parse(invocation.inputJson);
        if (
            !validate(
                v.object({
                    status: v.literal("succeeded"),
                    result: documentaryControlV2Validator,
                }),
                observed,
            ) ||
            !validate(
                v.object({
                    contributions: v.array(documentaryContributionValidator),
                }),
                original,
                { allowUnknownFields: true },
            )
        )
            return null;
        try {
            return outcome(
                await ctx.runMutation(internal.sourcesMission.retainControl, {
                    ...args,
                    ...(request.scheduledExecution?.phase === "waiting_provider"
                        ? { recoveryAdoption: true as const }
                        : {}),
                    inputHash: call.inputHash,
                    contributions: original.contributions,
                    control: observed.result,
                    providerCallId: call._id,
                }),
            );
        } catch (error) {
            const code = executionFailureCode(error);
            if (!code) throw error;
            return { kind: "refused", code };
        }
    },
});

async function appendAvailableCapture(
    ctx: MutationCtx,
    preparation: Doc<"sourceSelectionProposalRebuilds">,
    data: NonNullable<Doc<"sourceSelectionProposalRebuilds">["sourcesMission"]>,
    captureId: Id<"sourceCaptures">,
) {
    if (!data.captureIds.includes(captureId))
        await ctx.db.patch(preparation._id, {
            sourcesMission: {
                ...data,
                captureIds: [...data.captureIds, captureId],
            },
        });
}

export const retainCapture = internalMutation({
    args: { ...workArgs, captureId: v.id("sourceCaptures") },
    returns: v.null(),
    handler: async (ctx, args): Promise<null> => {
        const { preparation, data, run, input, acquisition } =
            await workContext(ctx, args);
        const capture = await ctx.db.get(args.captureId);
        if (
            !capture ||
            (input.kind !== "make_source_consultable" &&
                input.kind !== "acquire_document") ||
            capture.sourceId !==
                data.work.find((w) => w.requestId === args.requestId)
                    ?.sourceId ||
            capture.runId !== run._id ||
            capture.status !== "committed" ||
            (acquisition &&
                capture.requestInputHash !==
                    acquisition.pin.target.requestInputHash)
        )
            throw executionError("capture_identity_conflict");
        await appendAvailableCapture(ctx, preparation, data, capture._id);
        return null;
    },
});

export const retainImportedCapture = internalMutation({
    args: {
        requestId: v.id("agentOperationRequests"),
        expectedGeneration: v.number(),
        captureId: v.id("sourceCaptures"),
    },
    returns: v.null(),
    async handler(ctx, args): Promise<null> {
        const request = await ctx.db.get(args.requestId);
        if (
            request?.pin?.kind !== "documentary_v1" ||
            request.pin.scope.kind !== "sources"
        )
            return null;
        const material = await requireDocumentaryMaterialRequest(ctx, args);
        if (
            !("retained" in material) ||
            material.capture?._id !== args.captureId
        )
            throw executionError("capture_identity_conflict");
        if (material.pin.scope.kind !== "sources") return null;
        const { preparation, data } = await requireSourcesPreparation(
            ctx,
            material.pin.scope.preparationId,
        );
        await appendAvailableCapture(ctx, preparation, data, args.captureId);
        return null;
    },
});

import { completeSources } from "@convex/domain/sources";
import {
    type EventId,
    vEventId,
    vWorkflowId,
    type WorkflowId,
} from "@convex-dev/workflow";
import { workflow } from "./workflow";

export const start = internalMutation({
    args: {
        preparationId: v.id("sourceSelectionProposalRebuilds"),
        expectedGeneration: v.number(),
        workflowId: vWorkflowId,
    },
    returns: v.object({
        missionId: v.id("agentMissions"),
        eventId: vEventId(),
    }),
    handler: async (
        ctx,
        args,
    ): Promise<{ missionId: Id<"agentMissions">; eventId: EventId }> => {
        const { run } = await requireSourcesPreparation(
            ctx,
            args.preparationId,
        );
        if (
            run.executionGeneration !== args.expectedGeneration ||
            run.workflowId !== args.workflowId
        )
            throw executionError("stale_execution");
        const scope = {
            kind: "sources_v1" as const,
            preparationId: args.preparationId,
        };
        const requestKey = missionObjectiveKey(scope);
        const previous = await ctx.db
            .query("agentMissions")
            .withIndex("by_run_and_request_key", (q) =>
                q.eq("runId", run._id).eq("requestKey", requestKey),
            )
            .unique();
        const retainedEventId = previous?.completionEventId;
        const eventId =
            retainedEventId ??
            (await workflow.createEvent(ctx, {
                name: requestKey,
                workflowId: args.workflowId,
            }));
        const missionId: Id<"agentMissions"> = await ctx.runMutation(
            internal.execution.missions.start,
            {
                runId: run._id,
                expectedGeneration: args.expectedGeneration,
                definitionId: scope.kind,
                scope,
                requestKey,
                completionEventId: eventId,
            },
        );
        if (retainedEventId) return { missionId, eventId };
        await ctx.runMutation(internal.execution.missions.resume, {
            missionId,
            expectedGeneration: args.expectedGeneration,
            simulation: await sourcesSimulationEnabled(ctx, run._id),
        });
        const pinned = await ctx.db.get(missionId);
        if (pinned?.modelRevisionId)
            await ctx.db.patch(args.preparationId, {
                modelRevisionId: pinned.modelRevisionId,
            });
        return { missionId, eventId };
    },
});

export const reattach = internalMutation({
    args: {
        preparationId: v.id("sourceSelectionProposalRebuilds"),
        workflowId: v.string(),
    },
    returns: v.object({
        missionId: v.id("agentMissions"),
        eventId: vEventId(),
    }),
    handler: async (
        ctx,
        args,
    ): Promise<{ missionId: Id<"agentMissions">; eventId: EventId }> => {
        const { run } = await requireSourcesPreparation(
            ctx,
            args.preparationId,
            "settlement",
        );
        if (run.workflowId !== args.workflowId)
            throw executionError("stale_execution");
        // Continuation renews the generation, but the recovery workflow retains its completion binding.
        await requireSettlementAuthority(ctx, run._id, run.executionGeneration);
        const mission = await readSourcesMission(ctx, run);
        if (
            !mission ||
            !("scope" in mission) ||
            mission.scope.kind !== "sources_v1" ||
            mission.scope.preparationId !== args.preparationId
        )
            throw executionError("sources_mission_unavailable");
        const eventId = await workflow.createEvent(ctx, {
            name: `sources:${args.preparationId}:reattach:${run.executionGeneration}`,
            workflowId: args.workflowId as WorkflowId,
        });
        await ctx.runMutation(
            internal.execution.missions.rebindCompletionEvent,
            {
                missionId: mission._id,
                eventId,
                expectedGeneration: run.executionGeneration,
            },
        );
        return { missionId: mission._id, eventId };
    },
});

export const finish = internalMutation({
    args: {
        preparationId: v.id("sourceSelectionProposalRebuilds"),
        missionId: v.id("agentMissions"),
        expectedGeneration: v.number(),
    },
    returns: v.union(
        v.null(),
        v.object({
            kind: v.literal("waiting"),
            eventId: v.optional(vEventId()),
        }),
    ),
    handler: async (
        ctx,
        args,
    ): Promise<null | { kind: "waiting"; eventId?: EventId }> => {
        const { preparation, run } = await requireSourcesPreparation(
            ctx,
            args.preparationId,
            "settlement",
        );
        await requireSettlementAuthority(ctx, run._id, args.expectedGeneration);
        const mission = await ctx.db.get(args.missionId);
        if (
            !mission ||
            mission.runId !== run._id ||
            !("scope" in mission) ||
            mission.scope.kind !== "sources_v1" ||
            mission.scope.preparationId !== preparation._id ||
            !["completed", "blocked"].includes(mission.status)
        )
            throw executionError("sources_mission_incomplete");
        const reads = new SourceReviewReads(
            ctx.db,
            run._id,
            SOURCES_HANDOFF_READ_CAPACITY,
        );
        const [engaged] = await readEngagedSourcesWork(reads, preparation._id);
        if (engaged) {
            if (!run.workflowId) return { kind: "waiting" };
            const eventId = await registerOperationWaitEvent(ctx, {
                requestId: engaged._id,
                workflowId: run.workflowId as WorkflowId,
                expectedGeneration: args.expectedGeneration,
            });
            return { kind: "waiting", ...(eventId ? { eventId } : {}) };
        }
        if (
            mission.status === "blocked" &&
            mission.blockCode !== "operation_outcome_unknown" &&
            run.startMode === "framed" &&
            supportsResearchControl(run) &&
            !(
                ["execution_deadline", "operation_outcome_unknown"].includes(
                    mission.blockCode ?? "",
                ) &&
                preparation.deadlineAt !== undefined &&
                preparation.deadlineAt <= Date.now()
            ) &&
            preparation.settlementRequestedAt === undefined &&
            (await sourcesContinuationAvailable(ctx, run, preparation))
        ) {
            if (await suspendInterruptedResearch(ctx, mission))
                return { kind: "waiting" };
            throw executionError("sources_mission_incomplete");
        }
        await processWorkbenchInstructions(ctx, { runId: run._id }, reads);
        // Settlement cannot wait for instructions when no authorized continuation remains.
        if (
            preparation.settlementRequestedAt === undefined &&
            (await sourcesContinuationAvailable(ctx, run, preparation)) &&
            (await hasWaitingWorkbenchInstructions(ctx, run._id))
        )
            return { kind: "waiting" };
        const current = await requireSourcesPreparation(
            ctx,
            preparation._id,
            "settlement",
        );
        const settlementCause: SourcesSettlementCause | null = current.data
            .result
            ? null
            : current.preparation.settlementRequestedAt !== undefined
              ? "decision"
              : !(await sourcesContinuationAvailable(
                      ctx,
                      current.run,
                      current.preparation,
                  ))
                ? "allowance_exhausted"
                : mission.blockCode === "operation_outcome_unknown"
                  ? "outcome_unknown"
                  : current.preparation.deadlineAt !== undefined &&
                      current.preparation.deadlineAt <= Date.now()
                    ? "window_ended"
                    : "execution_interrupted";
        const settlementNote = settlementCause
            ? sourcesSettlementNote(settlementCause)
            : "";
        const material =
            current.data.result ??
            (await completeSources(
                ctx,
                preparation._id,
                {
                    kind: "complete",
                    needsRevision: current.data.needsRevision,
                    needs: current.data.needs.map((need) => ({
                        needId: need.id,
                        unfinished: [settlementNote],
                        workRequestIds: current.data.work
                            .filter((w) => w.needIds.includes(need.id))
                            .map((w) => w.requestId),
                    })),
                },
                reads,
                { type: "system" },
            ));
        await ctx.db.patch(preparation._id, {
            status: material.outcome,
            completedAt: Date.now(),
        });
        await transitionResearchRun(ctx, {
            runId: run._id,
            expectedExecutionGeneration: args.expectedGeneration,
            lifecycleState: "sources_prepared",
            executionStatus: "idle",
            stepKey: "sources_prepared",
        });
        await recordContextObservation(ctx, run._id, {
            key: `sources-handoff:${preparation._id}:${material.needsRevision}`,
            topic: "documentary",
            actor: { type: "system" },
            value: {
                event: "sources_prepared",
                preparationId: preparation._id,
                outcome: material.outcome,
                material,
                allowance: sourcesResourceStatus(current.data),
            },
        });
        return null;
    },
});

export async function sourcesSettlementBlock(
    ctx: QueryCtx,
    run: Doc<"researchRuns">,
): Promise<string | null> {
    if (!isSourcesSettlementPause(run) || !run.sourcePreparationId)
        return "stale_execution";
    const preparation = await ctx.db.get(run.sourcePreparationId);
    if (
        preparation?.status !== "started" ||
        preparation.settlementRequestedAt !== undefined
    )
        return "stale_execution";
    return null;
}

export async function requestSourcesSettlement(
    ctx: MutationCtx,
    { run, actor }: { run: Doc<"researchRuns">; actor: AuditActor },
): Promise<void> {
    const block = await sourcesSettlementBlock(ctx, run);
    if (block) throw executionError(block);
    if (!run.sourcePreparationId) throw executionError("stale_execution");
    let eventActor: NonNullable<Doc<"agentExecutionEvents">["actor"]> = {
        type: "system",
    };
    if (actor.type === "visitor") {
        const visitorId = ctx.db.normalizeId("visitors", actor.visitorId);
        if (!visitorId) throw executionError("not_authorized");
        eventActor = { type: "visitor", visitorId };
    }
    const mission = await readSourcesMission(ctx, run);
    await ctx.db.patch(run.sourcePreparationId, {
        settlementRequestedAt: Date.now(),
    });
    if (mission?.status === "blocked") {
        // Settlement eligibility comes from the recorded decision; preserve the actual stop reason.
        await ctx.runMutation(internal.execution.handoffs.finishChild, {
            missionId: mission._id,
        });
    }
    await notifyResearchControlWaits(ctx, run._id);
    await recordResearchObservation(
        ctx,
        run._id,
        "sources_settlement_requested",
        eventActor,
    );
}

async function activeCaptureQualification(
    ctx: QueryCtx,
    runId: Id<"researchRuns">,
    captureId: Id<"sourceCaptures">,
    preparation: Doc<"sourceSelectionProposalRebuilds"> | null,
) {
    if (!preparation?.sourcesMission) return null;
    const data = preparation.sourcesMission;
    const reads = new SourceReviewReads(
        ctx.db,
        runId,
        SOURCES_HANDOFF_READ_CAPACITY,
    );
    const task = await reads.latestDocumentaryQualification(
        preparation._id,
        captureId,
    );
    if (!task || !data.qualifications.includes(task._id)) return null;
    const [qualification] = await controlledSourcesContributions(
        ctx,
        {
            ...preparation,
            sourcesMission: { ...data, qualifications: [task._id] },
        },
        reads,
    );
    if (!qualification) return null;
    const {
        taskId,
        version,
        controlTaskId,
        objectionCount = 0,
        contributions,
        examination,
    } = qualification;
    return {
        identity: { taskId, version, captureId, controlTaskId, objectionCount },
        contributions,
        historical: examination && {
            state: "not_examined" as const,
            originalReference: examination.originalReference,
        },
    };
}

async function captureExamination(
    ctx: QueryCtx,
    runId: Id<"researchRuns">,
    captureId: Id<"sourceCaptures">,
    preparation: Doc<"sourceSelectionProposalRebuilds"> | null,
): Promise<import("convex/values").Infer<typeof captureExaminationValidator>> {
    const qualification = await activeCaptureQualification(
        ctx,
        runId,
        captureId,
        preparation,
    );
    if (!qualification) return { state: "not_examined" };
    const { identity, historical } = qualification;
    if (historical) return historical;
    const needOrder = [
        ...new Set(
            qualification.contributions.flatMap(({ needs }) =>
                Object.keys(needs),
            ),
        ),
    ].sort();
    const needIndexes = new Map(needOrder.map((need, index) => [need, index]));
    const event = await ctx.db
        .query("agentExecutionEvents")
        .withIndex("by_run_and_context_key", (q) =>
            q
                .eq("runId", runId)
                .eq(
                    "contextObservation.key",
                    `documentary-qualification:${identity.taskId}`,
                ),
        )
        .unique();
    return {
        state: "examined",
        qualification: {
            ...identity,
            needOrder,
            useOrder: [...documentaryUseOrder],
            reference: event?._id,
            contributions: qualification.contributions.map(
                ({ id, version, permittedUse, needs, objections }) => ({
                    id,
                    version,
                    permittedUse,
                    usesByNeed: needOrder.map((need) => {
                        const use = needs[need];
                        return use === undefined
                            ? null
                            : documentaryUseOrder.indexOf(use);
                    }),
                    objections: objections.map(({ needIds, ...objection }) => ({
                        ...objection,
                        needIndexes: needIds.map((need) => {
                            if (need === null) return null;
                            const index = needIndexes.get(need);
                            if (index === undefined)
                                throw executionError(
                                    "documentary_control_invalid",
                                );
                            return index;
                        }),
                    })),
                }),
            ),
        },
    };
}

/** Supplies the same examination projection through a capture-bound reading. */
export const inspectCaptureExamination = internalQuery({
    args: {
        requestId: v.id("agentOperationRequests"),
        expectedGeneration: v.number(),
    },
    returns: v.union(captureExaminationValidator, v.null()),
    handler: async (
        ctx,
        args,
    ): Promise<
        import("convex/values").Infer<typeof captureExaminationValidator> | null
    > => {
        const admitted = await requireDocumentaryMaterialRequest(ctx, args);
        if (
            !admitted.mission ||
            !supportsScopedDocumentaryExamination(
                admitted.mission.definitionId,
                admitted.mission.definitionVersion,
            ) ||
            !admitted.capture
        )
            return null;
        const { run } = await requireDossierAuthority(
            ctx,
            admitted.capture.runId,
        );
        const preparation = run.sourcePreparationId
            ? await ctx.db.get(run.sourcePreparationId)
            : null;
        return captureExamination(
            ctx,
            run._id,
            admitted.capture._id,
            preparation,
        );
    },
});

export const materialStatus = internalQuery({
    args: {
        runId: v.optional(v.id("researchRuns")),
        missionId: v.optional(v.id("agentMissions")),
        expectedGeneration: v.number(),
        sourceId: v.id("sources"),
    },
    returns: v.union(v.null(), documentaryStatusValidator),
    handler: async (
        ctx,
        args,
    ): Promise<
        import("convex/values").Infer<typeof documentaryStatusValidator> | null
    > => {
        const mission = args.missionId
            ? await ctx.db.get(args.missionId)
            : null;
        const runId = mission?.runId ?? args.runId;
        if (!runId) throw executionError("not_authorized");
        const { run } = await requireDossierAuthority(ctx, runId);
        if (run.sourcesProtocol !== "sources_mission_v1") return null;
        const allowed = await ctx.runQuery(
            internal.sourceRetrieval.approvedCaptureForMission,
            args,
        );
        if (allowed.status !== "available")
            throw executionError("capture_unavailable");
        const preparation = run.sourcePreparationId
            ? await ctx.db.get(run.sourcePreparationId)
            : null;
        const preview = (text: string, length: number) =>
            Array.from(text).slice(0, length).join("");
        const capture = allowed.capture;
        const qualification = await activeCaptureQualification(
            ctx,
            run._id,
            capture._id,
            preparation,
        );
        const acquisitionAvailable =
            !mission ||
            !!getAgentDefinition(
                mission.definitionId,
                mission.definitionVersion,
            ).operations.make_source_consultable;
        return {
            capture: {
                _id: capture._id,
                contentHash: capture.contentHash ?? "",
                readingCompleteness: capture.readingCompleteness,
                captureOmittedPassageCount: capture.omittedPassageCount ?? null,
                representationCompleteness:
                    capture.representationCompleteness === "unknown"
                        ? undefined
                        : capture.representationCompleteness,
                observedDestinationCount:
                    capture.observedDestinations?.length ?? 0,
            },
            ...(acquisitionAvailable
                ? {
                      observedDestinations: (
                          capture.observedDestinations ?? []
                      ).map((link, index) => ({
                          index,
                          urlPreview: preview(link.url, 80),
                          originPreview: preview(link.originText, 16),
                      })),
                  }
                : {}),
            examination: qualification
                ? (qualification.historical ?? {
                      state: "examined",
                      qualification: {
                          ...qualification.identity,
                          contributions: qualification.contributions.map(
                              ({
                                  id,
                                  version,
                                  permittedUse,
                                  needs,
                                  objections,
                              }) => ({
                                  id,
                                  version,
                                  permittedUse,
                                  needs,
                                  objections,
                              }),
                          ),
                      },
                  })
                : { state: "not_examined" },
            qualification: null,
        };
    },
});

export const cachedControl = internalQuery({
    args: { ...workArgs, inputHash: v.string() },
    returns: v.union(schema.doc("aiTaskResults"), v.null()),
    handler: async (ctx, args): Promise<Doc<"aiTaskResults"> | null> => {
        const { run, preparation } = await workContext(ctx, args);
        const task = await ctx.db
            .query("aiTaskResults")
            .withIndex("by_run_and_task_type_and_input_hash", (q) =>
                q
                    .eq("runId", run._id)
                    .eq("taskType", "documentary_control")
                    .eq("inputHash", args.inputHash),
            )
            .unique();
        return task?.output.kind === "documentary_control" &&
            task.output.preparationId === preparation._id &&
            task.output.examination.state === "examined"
            ? task
            : null;
    },
});

/** Analyst-owned inspection of the versioned handoff; membership never implies human approval. */
export const getPreparedMaterial = query({
    args: { runId: v.id("researchRuns") },
    returns: v.union(v.null(), preparedMaterialInspectionValidator),
    handler: async (ctx, args) => {
        await requireWorkspaceRun(ctx, args.runId);
        const { run } = await requireDossierAuthority(ctx, args.runId);
        const preparation = run.sourcePreparationId
            ? await ctx.db.get(run.sourcePreparationId)
            : null;
        if (!preparation) return null;
        if (preparation.runId !== run._id)
            throw executionError("not_authorized");
        return projectPreparedMaterial(preparation);
    },
});

export const inspectPreparedNeed = internalQuery({
    args: {
        requestId: v.id("agentOperationRequests"),
        expectedGeneration: v.number(),
    },
    returns: v.union(
        v.object({
            kind: v.literal("available"),
            value: preparedNeedInspectionValidator,
        }),
        v.object({ kind: v.literal("unavailable"), code: v.string() }),
    ),
    handler: async (ctx, args) => {
        const request = await ctx.db.get(args.requestId);
        if (
            request?.status !== "running" ||
            !request.runId ||
            request.expectedGeneration !== args.expectedGeneration ||
            request.input.kind !== "consult_prepared_material" ||
            request.pin?.kind !== "prepared_material"
        )
            throw executionError("operation_not_dispatched");
        const { run } = request.missionId
            ? await requireMissionObservationAuthority(
                  ctx,
                  request.missionId,
                  args.expectedGeneration,
              )
            : await requireDossierAuthority(ctx, request.runId);
        if (
            run._id !== request.runId ||
            (!request.missionId &&
                run.executionGeneration !== args.expectedGeneration)
        )
            throw executionError("stale_execution");
        const result = await readPreparedNeed(ctx, run, request.input.needId);
        if (result.kind === "unavailable") return result;
        if (
            result.pin.preparationId !== request.pin.preparationId ||
            result.pin.hash !== request.pin.hash
        )
            return {
                kind: "unavailable" as const,
                code: "prepared_material_version_conflict",
            };
        return { kind: "available" as const, value: result.value };
    },
});
