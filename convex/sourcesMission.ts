import { internal } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import {
    internalMutation,
    internalQuery,
    type MutationCtx,
    type QueryCtx,
    query,
} from "@convex/_generated/server";
import { readSourceCandidateCapacity } from "@convex/domain/sourceCandidateCapacity";
import { sha256Hex, stableStringify } from "@convex/domain/sourcePassages";
import {
    readPreparationConcurrency,
    readPreparationSourceDecision,
} from "@convex/domain/sourcePreparationAuthority";
import { SourceReviewReads } from "@convex/domain/sourceReviewReads";
import {
    controlledDocumentaryUse,
    documentaryPermittedUses,
} from "@convex/domain/sourceSelectionPolicy";
import {
    assertSourcesCompletionCapacity,
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
    documentaryContributionValidator,
    documentaryControlValidator,
    documentaryNeedValidator,
    documentaryStatusValidator,
    documentarySubmissionValue,
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
import { getAgentDefinition } from "@convex/execution/agentCatalog";
import type { AuditActor } from "@convex/execution/approvalContracts";
import {
    requireDossierAuthority,
    requireMissionObservationAuthority,
    requireRunAuthority,
    requireSettlementAuthority,
} from "@convex/execution/authority";
import { executionError } from "@convex/execution/errors";
import { recordContextObservation } from "@convex/execution/journal";
import { registerOperationWaitEvent } from "@convex/execution/operations";
import {
    notifyResearchControlWaits,
    recordResearchObservation,
    suspendInterruptedResearch,
} from "@convex/execution/researchControl";
import { requireQualificationResultDeadline } from "@convex/providerCalls";
import {
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
};
async function workContext(
    ctx: QueryCtx,
    args: {
        requestId: Id<"agentOperationRequests">;
        expectedGeneration: number;
    },
    observation = false,
) {
    const request = await ctx.db.get(args.requestId);
    if (
        request?.status !== "running" ||
        request.expectedGeneration !== args.expectedGeneration ||
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
    return { ...state, request, input: request.input as SourcesOperation };
}

const proposalReturn = v.object({
    needContext: v.array(documentaryNeedValidator),
    preparation: schema.doc("sourceSelectionProposalRebuilds"),
    input: sourcesOperationValidator,
    contributions: v.array(documentaryContributionValidator),
    inputHash: v.string(),
    sourceId: v.optional(v.id("sources")),
    discoveryLimit: v.optional(v.number()),
});
export const reserve = internalMutation({
    args: workArgs,
    returns: proposalReturn,
    handler: async (
        ctx,
        args,
    ): Promise<import("convex/values").Infer<typeof proposalReturn>> => {
        const { preparation, run, data, input, request } = await workContext(
            ctx,
            args,
        );
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
                : [input.needId];
        if (needIds.some((id) => !data.needs.some((n) => n.id === id)))
            throw executionError("documentary_need_unknown");
        if (data.work.some((w) => w.requestId === request._id))
            throw executionError("operation_outcome_unknown");
        if (
            input.kind === "submit_documentary_qualification" ||
            input.kind === "request_documentary_check"
        ) {
            if (await hasEngagedSourcesControl(reads, data))
                throw executionError("documentary_control_in_progress");
        }
        if (input.kind === "make_source_consultable") {
            const acquisitions = await Promise.all(
                data.work
                    .filter((w) => w.kind === "make_source_consultable")
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
                : input.kind === "make_source_consultable"
                  ? "acquisitions"
                  : "controls";
        const resources = sourcesResourceStatus(data);
        const block = resources[field].blockCode ?? resources.work.blockCode;
        if (block) throw executionError(block);
        if (
            input.kind === "discover_sources_for_need" &&
            (!input.query.trim() || input.query.length > 512)
        )
            throw executionError("discovery_query_invalid");
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
        let sourceId = "sourceId" in input ? input.sourceId : undefined;
        if (input.kind === "make_source_consultable") {
            if (
                input.sourceId &&
                (input.observedCaptureId !== undefined ||
                    input.observedLinkIndex !== undefined)
            )
                throw executionError("acquisition_target_invalid");
            if (!input.sourceId) {
                if (
                    !input.observedCaptureId ||
                    !data.captureIds.includes(input.observedCaptureId) ||
                    !Number.isSafeInteger(input.observedLinkIndex) ||
                    (input.observedLinkIndex ?? -1) < 0
                )
                    throw executionError("observed_destination_unavailable");
                const origin = await ctx.db.get(input.observedCaptureId);
                const observed =
                    origin?.observedDestinations?.[
                        input.observedLinkIndex ?? -1
                    ];
                if (!observed || origin?.runId !== run._id)
                    throw executionError("observed_destination_unavailable");
                await ctx.runMutation(
                    internal.sourceDiscovery.persistCandidates,
                    {
                        runId: run._id,
                        corpusRevisionId: preparation.corpusRevisionId,
                        executionGeneration: args.expectedGeneration,
                        operationKey: `observed:${request._id}`,
                        candidates: [
                            {
                                canonicalUrl: observed.url,
                                title: observed.url,
                                origin: "exa",
                                category: "observed_destination",
                                providerReference: `capture:${origin._id}:link:${input.observedLinkIndex}`,
                            },
                        ],
                    },
                );
                const candidate = await ctx.db
                    .query("sources")
                    .withIndex("by_run_and_url", (q) =>
                        q.eq("runId", run._id).eq("canonicalUrl", observed.url),
                    )
                    .unique();
                if (!candidate) throw executionError("source_candidate_limit");
                sourceId = candidate._id;
            }
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
                        contribution.statement !== input.proposition
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
        const nextData = {
            ...data,
            [field]: data[field] + 1,
            work: [
                ...data.work,
                {
                    requestId: request._id,
                    kind: input.kind,
                    needIds,
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
        const inputHash = sha256Hex(
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
                contributions,
                needs: data.needs.filter((n) =>
                    contributions.some((c) => c.needIds.includes(n.id)),
                ),
            }),
        );
        await ctx.db.patch(preparation._id, {
            sourcesMission: nextData,
        });
        return {
            preparation,
            input,
            contributions,
            inputHash,
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

export const retainControl = internalMutation({
    args: {
        ...workArgs,
        inputHash: v.string(),
        contributions: v.array(documentaryContributionValidator),
        control: documentaryControlValidator,
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
                call.inputHash !== args.inputHash ||
                call.status !== "succeeded" ||
                call.operation !== "source_documentary_control")
        )
            throw executionError("documentary_control_unavailable");
        if (call) await requireQualificationResultDeadline(ctx, call);
        if (
            args.control.findings.length !== args.contributions.length ||
            new Set(args.control.findings.map((f) => f.contributionId)).size !==
                args.contributions.length ||
            args.contributions.some(
                (c) =>
                    !args.control.findings.some(
                        (f) => f.contributionId === c.id,
                    ),
            )
        )
            throw executionError("documentary_control_invalid");
        for (const contribution of args.contributions) {
            const index = args.control.findings.findIndex(
                (finding) => finding.contributionId === contribution.id,
            );
            const finding = args.control.findings[index];
            const permitted = documentaryPermittedUses(contribution.kind);
            if (
                finding &&
                !permitted.some((use) => use === finding.permittedUse)
            )
                throw executionError("documentary_control_invalid", [
                    {
                        path: `control.findings[${index}].permittedUse`,
                        expected: `Contribution ${contribution.id} (${contribution.kind}) permits only ${permitted.join(", ")}. No qualification was adopted.`,
                    },
                ]);
        }
        const sourceId = "sourceId" in input ? input.sourceId : undefined;
        if (!sourceId) throw executionError("documentary_control_invalid");
        const reads = new SourceReviewReads(
            ctx.db,
            run._id,
            SOURCES_HANDOFF_READ_CAPACITY,
        );
        const result = async (taskId: Id<"aiTaskResults">) => {
            const current = await ctx.db.get(preparation._id);
            if (!current?.sourcesMission)
                throw executionError("sources_mission_unavailable");
            const qualifications =
                input.kind === "submit_documentary_qualification"
                    ? [taskId]
                    : input.kind === "request_documentary_check"
                      ? [
                            ...new Set(
                                input.targets?.map(
                                    (target) => target.qualificationTaskId,
                                ) ?? [],
                            ),
                        ]
                      : [];
            const projected = await controlledSourcesContributions(
                ctx,
                {
                    ...current,
                    sourcesMission: {
                        ...current.sourcesMission,
                        qualifications,
                    },
                },
                reads,
            );
            return {
                taskId,
                control: args.control,
                effectiveContributions: projected.flatMap((qualification) =>
                    qualification.contributions.map((contribution) => ({
                        id: contribution.id,
                        version: contribution.version,
                        permittedUse: contribution.permittedUse,
                        useStatus: contribution.useStatus,
                        diagnostic:
                            contribution.finding?.diagnostic ??
                            "No supported control finding is available.",
                    })),
                ),
            };
        };
        const existing = await ctx.db
            .query("aiTaskResults")
            .withIndex("by_run_and_task_type_and_input_hash", (q) =>
                q
                    .eq("runId", run._id)
                    .eq("taskType", "documentary_control")
                    .eq("inputHash", args.inputHash),
            )
            .unique();
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
            schemaVersion: "documentary-control-v1",
            adapterVersion: "one-shot-v1",
            inputHash: args.inputHash,
            providerCallId: call?._id,
            createdAt: Date.now(),
        };
        const controlTaskId =
            existing?._id ??
            (await ctx.db.insert("aiTaskResults", {
                ...base,
                taskType: "documentary_control",
                output: {
                    kind: "documentary_control",
                    preparationId: preparation._id,
                    evidence: args.contributions.flatMap((c) => c.evidence),
                    inputHash: args.inputHash,
                    control: args.control,
                },
            }));
        if (input.kind === "request_documentary_check") {
            const restrictions = (input.targets ?? []).flatMap((target) => {
                const finding = args.control.findings.find(
                    (item) => item.contributionId === target.contributionId,
                );
                if (
                    !finding ||
                    (finding.conclusion === "supported" &&
                        finding.permittedUse === "documentary")
                )
                    return [];
                return [
                    {
                        ...target,
                        controlTaskId,
                        permittedUse:
                            finding.conclusion === "supported"
                                ? finding.permittedUse
                                : ("blocked" as const),
                    },
                ];
            });
            if (restrictions.length)
                await ctx.db.patch(preparation._id, {
                    sourcesMission: {
                        ...data,
                        restrictedContributions: [
                            ...data.restrictedContributions,
                            ...restrictions,
                        ],
                    },
                });
            await recordContextObservation(ctx, run._id, {
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
            return result(controlTaskId);
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
            stableStringify(previous.output.contributions) ===
                stableStringify(reconstructed)
        )
            return result(previous._id);
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
        await recordContextObservation(ctx, run._id, {
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
        return result(taskId);
    },
});

export const retainCapture = internalMutation({
    args: { ...workArgs, captureId: v.id("sourceCaptures") },
    returns: v.null(),
    handler: async (ctx, args): Promise<null> => {
        const { preparation, data, run, input } = await workContext(ctx, args);
        const capture = await ctx.db.get(args.captureId);
        if (
            !capture ||
            input.kind !== "make_source_consultable" ||
            capture.sourceId !==
                data.work.find((w) => w.requestId === args.requestId)
                    ?.sourceId ||
            capture.runId !== run._id ||
            capture.status !== "committed"
        )
            throw executionError("capture_identity_conflict");
        if (!data.captureIds.includes(capture._id))
            await ctx.db.patch(preparation._id, {
                sourcesMission: {
                    ...data,
                    captureIds: [...data.captureIds, capture._id],
                },
            });
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
        const requestKey = `sources:${args.preparationId}`;
        const previous = await ctx.db
            .query("agentMissions")
            .withIndex("by_run_and_request_key", (q) =>
                q.eq("runId", run._id).eq("requestKey", requestKey),
            )
            .unique();
        if (previous?.completionEventId)
            return {
                missionId: previous._id,
                eventId: previous.completionEventId,
            };
        const eventId = await workflow.createEvent(ctx, {
            name: requestKey,
            workflowId: args.workflowId,
        });
        const missionId: Id<"agentMissions"> = await ctx.runMutation(
            internal.execution.missions.start,
            {
                runId: run._id,
                expectedGeneration: args.expectedGeneration,
                definitionId: "sources_v1",
                scope: {
                    kind: "sources_v1",
                    preparationId: args.preparationId,
                },
                requestKey,
                completionEventId: eventId,
            },
        );
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
        await ctx.runMutation(internal.researchRuns.transition, {
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
        let qualification: Doc<"aiTaskResults"> | null = null;
        for (const id of [
            ...(preparation?.sourcesMission?.qualifications ?? []),
        ].reverse()) {
            const task = await ctx.db.get(id);
            if (task?.sourceId === args.sourceId) {
                qualification = task;
                break;
            }
        }
        const control =
            qualification?.output.kind === "documentary_qualification"
                ? await ctx.db.get(qualification.output.controlTaskId)
                : null;
        const restrictions =
            preparation?.sourcesMission?.restrictedContributions ?? [];
        const preview = (text: string, length: number) =>
            Array.from(text).slice(0, length).join("");
        const capture = allowed.capture;
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
                representationCompleteness: capture.representationCompleteness,
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
            qualification:
                qualification?.output.kind === "documentary_qualification" &&
                control?.output.kind === "documentary_control"
                    ? {
                          taskId: qualification._id,
                          version: qualification.output.version,
                          controlTaskId: control._id,
                          coherence: control.output.control.coherence,
                          limitationsCount:
                              control.output.control.limitations.length,
                          contributions: qualification.output.contributions.map(
                              (contribution) => {
                                  const finding =
                                      control.output.kind ===
                                      "documentary_control"
                                          ? control.output.control.findings.find(
                                                (f) =>
                                                    f.contributionId ===
                                                    contribution.id,
                                            )
                                          : undefined;
                                  const diagnostic =
                                      finding?.diagnostic ??
                                      "No documentary control is available.";
                                  const diagnosticPreview = preview(
                                      diagnostic,
                                      96,
                                  );
                                  return {
                                      id: contribution.id,
                                      version: contribution.version,
                                      permittedUse: controlledDocumentaryUse(
                                          contribution,
                                          control.output.kind ===
                                              "documentary_control"
                                              ? control.output.control
                                              : null,
                                          restrictions,
                                      ),
                                      diagnosticPreview,
                                      diagnosticComplete:
                                          diagnosticPreview === diagnostic,
                                      restrictionCount: restrictions.filter(
                                          (r) =>
                                              r.contributionId ===
                                                  contribution.id &&
                                              r.version ===
                                                  contribution.version,
                                      ).length,
                                  };
                              },
                          ),
                      }
                    : null,
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
            task.output.preparationId === preparation._id
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
