import { internal } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import {
    internalMutation,
    type MutationCtx,
    type QueryCtx,
} from "@convex/_generated/server";
import {
    isOneShotPreparationOperation,
    preparationBudgetBlock,
    readPreparationBudget,
    readPreparationLimits,
    sourcePreparationError,
} from "@convex/domain/sourcePreparationAuthority";
import {
    preparationModelOutputLimit,
    resolveReasoningPreference,
} from "@convex/integrations/modelCapacity";
import {
    readWorkbenchQualification,
    readWorkbenchQualificationDeadline,
} from "@convex/qualificationAccess";
import {
    assertQualificationAllowance,
    patchQualificationReceipt,
    qualificationCategory,
    qualificationModelReservationUsd,
    updateQualificationUsage,
} from "@convex/qualificationUsage";
import {
    BILLING_LOOKUP_LEASE_MS as BILLING_LEASE_MS,
    MAX_PREPARATION_DIAGNOSTIC_BYTES,
    MAX_SOURCES_QUALIFICATION_RECEIPTS,
    MODEL_SETTLEMENT_GRACE_MS,
    IO_PROVIDER_LEASE_MS as PROVIDER_LEASE_MS,
    SOURCE_EMBEDDING_PROVIDER_LEASE_MS,
} from "@convex/resourcePolicy";
import { type Infer, v } from "convex/values";
import { publicationControl, requireMissionAuthority } from "./authority";
import { executionError } from "./errors";
import { admittedInputHash } from "./journalReads";
import { requirePiDispatchLease } from "./piSession";
import {
    missionModelAttemptValidator,
    type providerAttemptValidator,
    providerCallsTable,
    recordAttemptResultValidator,
} from "./providerReceiptValidators";
export async function requireBrowserQualification(
    ctx: QueryCtx,
    run: Doc<"researchRuns">,
) {
    if (run.purpose !== "browser_test") return null;
    const qualification = await readWorkbenchQualification(ctx, run);
    const control = await ctx.db
        .query("paidWorkControls")
        .withIndex("by_key", (q) => q.eq("key", "global"))
        .unique();
    if (!qualification || control?.enabled === false)
        throw sourcePreparationError("paid_work_disabled");
    return qualification;
}

/** The same qualification authority is required at reservation and immediately before external dispatch. */
export async function requireQualifiedBrowserMission(
    ctx: QueryCtx,
    run: Doc<"researchRuns">,
    mission: Doc<"agentMissions"> | null,
    preparationId?: Id<"sourceSelectionProposalRebuilds">,
) {
    const qualification = await requireBrowserQualification(ctx, run);
    if (!qualification) return null;
    const sourcesModelRevisionId =
        qualification.sourcesModelRevisionId ?? qualification.modelRevisionId;
    if (mission) {
        if (
            mission.runId !== run._id ||
            mission.modelRevisionId !==
                (mission.definitionId === "sources_v1"
                    ? sourcesModelRevisionId
                    : qualification.modelRevisionId) ||
            !(
                qualification.sourcesLot
                    ? ["workbench_v1", "workbench_v2", "sources_v1"]
                    : ["workbench_v1"]
            ).includes(mission.definitionId)
        )
            throw sourcePreparationError("paid_work_disabled");
    } else {
        const preparation = preparationId
            ? await ctx.db.get(preparationId)
            : null;
        if (
            !qualification.sourcesLot ||
            !preparation?.sourcesMission ||
            preparation.runId !== run._id ||
            preparation.modelRevisionId !== sourcesModelRevisionId
        )
            throw sourcePreparationError("paid_work_disabled");
    }
    if (qualification.reasoningSelection) {
        const role =
            !mission || mission.definitionId === "sources_v1"
                ? "sources"
                : "workbench";
        const model = await ctx.db.get(
            role === "sources"
                ? sourcesModelRevisionId
                : qualification.modelRevisionId,
        );
        if (
            !model ||
            (mission?.reasoningEffort ?? model.reasoningEffort) !==
                resolveReasoningPreference(
                    model.descriptor,
                    qualification.reasoningSelection[role],
                )
        )
            throw sourcePreparationError("paid_work_disabled");
    }
    return qualification;
}

/** Factual response identity survives an interrupted stream without settling its outcome. */
export const observeGeneration = internalMutation({
    args: {
        invocationId: v.id("agentInvocations"),
        generationId: v.optional(v.string()),
        httpStatus: v.optional(v.number()),
        requestId: v.optional(v.string()),
        diagnostic: providerCallsTable.validator.fields.transportDiagnostic,
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        const call = await invocationCall(ctx, args.invocationId);
        if (
            (args.generationId !== undefined &&
                !/^[\w.:-]{1,256}$/.test(args.generationId)) ||
            (args.requestId !== undefined &&
                !/^[\w.:-]{1,256}$/.test(args.requestId)) ||
            (args.httpStatus !== undefined &&
                (!Number.isInteger(args.httpStatus) ||
                    args.httpStatus < 100 ||
                    args.httpStatus > 599)) ||
            (args.generationId === undefined &&
                args.httpStatus === undefined &&
                args.requestId === undefined &&
                args.diagnostic === undefined)
        )
            throw new Error("Invalid provider observation");
        if (call.providerObservation?.generationId && args.generationId) {
            if (call.providerObservation.generationId !== args.generationId)
                throw new Error("Provider generation identity changed");
        }
        await patchQualificationReceipt(ctx, call, {
            providerObservation: {
                ...call.providerObservation,
                ...(args.generationId
                    ? { generationId: args.generationId }
                    : {}),
                ...(args.httpStatus !== undefined
                    ? { httpStatus: args.httpStatus }
                    : {}),
                ...(args.requestId ? { requestId: args.requestId } : {}),
                observedAt: call.providerObservation?.observedAt ?? Date.now(),
            },
            ...(args.diagnostic
                ? {
                      transportDiagnostic:
                          call.transportDiagnostic ?? args.diagnostic,
                  }
                : {}),
        });
        if (
            args.generationId &&
            !call.providerObservation?.generationId &&
            call.operationEpoch !== undefined
        )
            await ctx.runMutation(
                internal.execution.providerCallReceipts.requestBilling,
                {
                    invocationId: args.invocationId,
                },
            );
        return null;
    },
});

export async function invocationCall(
    ctx: QueryCtx | MutationCtx,
    invocationId: Id<"agentInvocations">,
) {
    const invocation = await ctx.db.get(invocationId);
    const call = invocation?.providerCallId
        ? await ctx.db.get(invocation.providerCallId)
        : null;
    const request = await ctx.db
        .query("agentInvocationPayloads")
        .withIndex("by_invocation_and_part", (q) =>
            q.eq("invocationId", invocationId).eq("part", "request"),
        )
        .unique();
    if (
        !call ||
        !invocation ||
        invocation.provenance !== "live" ||
        request?.state !== "complete" ||
        call.service !== "model" ||
        call.invocationId !== invocation._id ||
        call.inputHash !==
            (invocation.preparationInputHash ??
                admittedInputHash(invocation)) ||
        (invocation.preparationInputHash !== undefined &&
            (invocation.missionId !== undefined ||
                !call.preparationId ||
                call.operationKey !== invocation.taskKey ||
                call.corpusRevisionId !== invocation.corpusRevisionId)) ||
        call.executionGeneration !== invocation.generation ||
        call.missionId !== invocation.missionId ||
        call.runId !== invocation.runId
    )
        throw new Error("Invalid provider observation");
    return call;
}

export function reportedCostSettlement(
    call: Doc<"providerCalls">,
    cost: number | undefined,
    observation?: Pick<
        Infer<typeof providerAttemptValidator>,
        "status" | "dispatchOutcome"
    >,
) {
    if (cost !== undefined && (!Number.isFinite(cost) || cost < 0))
        throw new Error("Invalid provider cost");
    if (
        cost !== undefined &&
        call.reportedCost !== undefined &&
        Math.abs(call.reportedCost - cost) > 1e-12
    ) {
        return {
            reportedCost: call.reportedCost,
            billing: {
                state: "conflict" as const,
                reason: "amount_conflict" as const,
                attempt: call.billing?.attempt ?? 0,
                updatedAt: Date.now(),
            },
        };
    }
    return {
        reportedCost: call.reportedCost ?? cost,
        reportedCostFinal:
            call.reportedCostFinal === true ||
            (cost !== undefined &&
                observation !== undefined &&
                observation.status !== "partial" &&
                (observation.dispatchOutcome === "response_received" ||
                    observation.status === "succeeded")),
    };
}

export function hasUnresolvedStructuredTermination(call: Doc<"providerCalls">) {
    return (
        call.service === "model" &&
        isOneShotPreparationOperation(call.operation) &&
        call.providerObservation?.termination === undefined
    );
}

/** Only the original admitted call can request accounting; this grants no execution authority. */
export const requestBilling = internalMutation({
    args: { invocationId: v.id("agentInvocations") },
    returns: v.null(),
    handler: async (ctx, args) => {
        if ((await publicationControl(ctx))?.held) return null;
        const invocation = await ctx.db.get(args.invocationId);
        if (!invocation?.providerCallId) return null;
        const call = await ctx.db.get(invocation.providerCallId);
        if (
            !call?.providerObservation?.generationId ||
            call.billing ||
            (!hasUnresolvedStructuredTermination(call) &&
                (call.reportedCost !== undefined ||
                    call.status === "succeeded"))
        )
            return null;
        await invocationCall(ctx, args.invocationId);
        const wakeId = await ctx.scheduler.runAfter(
            5000,
            internal.integrations.openRouterGeneration.reconcile,
            { providerCallId: call._id, attempt: 1 },
        );
        await patchQualificationReceipt(ctx, call, {
            billing: {
                state: "pending",
                attempt: 0,
                updatedAt: Date.now(),
                retryAt: Date.now() + BILLING_LEASE_MS,
                wakeId,
            },
        });
        return null;
    },
});

export function providerLeaseDurationMs(
    service: "sec" | "exa" | "url_metadata" | "pdf" | "model",
    operation: string,
    remainingAuthorityMs?: number,
): number {
    if (service === "model") {
        if (operation === "source_embedding")
            return SOURCE_EMBEDDING_PROVIDER_LEASE_MS;
        if (
            remainingAuthorityMs === undefined ||
            !Number.isSafeInteger(remainingAuthorityMs) ||
            remainingAuthorityMs <= 0
        )
            throw sourcePreparationError("execution_deadline");
        return remainingAuthorityMs + MODEL_SETTLEMENT_GRACE_MS;
    }
    if (
        service === "exa" &&
        (operation === "get_contents" || operation === "framing_context_read")
    ) {
        return PROVIDER_LEASE_MS.exaContents;
    }
    if (service === "exa" && operation === "resolve_company_website") {
        return PROVIDER_LEASE_MS.companyWebsite;
    }
    return PROVIDER_LEASE_MS[service];
}

type ProviderAttempt = Infer<typeof providerAttemptValidator>;
type ProviderAttemptResult = Infer<typeof recordAttemptResultValidator>;
type Qualification = Awaited<ReturnType<typeof requireQualifiedBrowserMission>>;

export function requireProviderDiagnostic(args: ProviderAttempt) {
    if (
        args.diagnostic &&
        (args.diagnostic.reason.length > 100 ||
            new TextEncoder().encode(args.diagnostic.output ?? "").length >
                MAX_PREPARATION_DIAGNOSTIC_BYTES ||
            !Number.isSafeInteger(args.diagnostic.originalBytes) ||
            args.diagnostic.originalBytes < 0)
    )
        throw new Error("Invalid provider output diagnostic");
}

export async function reserveModelAttempt(
    ctx: MutationCtx,
    run: Doc<"researchRuns">,
    mission: Doc<"agentMissions"> | null,
    preparation: Doc<"sourceSelectionProposalRebuilds"> | null,
) {
    const budget = await readPreparationBudget(
        ctx.db,
        run,
        preparation ?? undefined,
    );
    const blocked = preparationBudgetBlock(
        budget,
        mission?.modelLimits ?? readPreparationLimits(preparation ?? undefined),
    );
    if (blocked) throw sourcePreparationError(blocked);
    if (preparation)
        await ctx.db.patch(preparation._id, {
            modelAttemptCount: (preparation.modelAttemptCount ?? 0) + 1,
            modelLimits: readPreparationLimits(preparation),
        });
    await ctx.db.patch(run._id, {
        sourceQualificationAttemptCount: budget.dispatches + 1,
        sourcePreparationBudget: {
            ...budget,
            reserved: budget.reserved + 1,
            dispatches: budget.dispatches + 1,
        },
    });
}

export async function qualificationInvocationCapacity(
    ctx: QueryCtx,
    invocationId: Id<"agentInvocations">,
) {
    const invocation = await ctx.db.get(invocationId);
    const mission = invocation?.missionId
        ? await ctx.db.get(invocation.missionId)
        : null;
    const model = mission?.modelRevisionId
        ? await ctx.db.get(mission.modelRevisionId)
        : null;
    if (!model) throw sourcePreparationError("missing_configuration");
    const capacity = {
        contextWindow: model.descriptor.contextWindow,
        maxTokens: preparationModelOutputLimit({
            model: model.model,
            descriptor: model.descriptor,
        }),
    };
    if (invocation?.generationBackend?.id === "pi-durable") {
        const request = await ctx.db
            .query("agentInvocationPayloads")
            .withIndex("by_invocation_and_part", (q) =>
                q.eq("invocationId", invocation._id).eq("part", "request"),
            )
            .unique();
        const output = request?.effectiveMaxOutputTokens;
        if (
            request?.state !== "complete" ||
            typeof output !== "number" ||
            !Number.isSafeInteger(output) ||
            output < 1 ||
            output > model.descriptor.maxTokens
        )
            throw sourcePreparationError("invalid_model_output_limit");
        capacity.maxTokens = output;
    }
    return capacity;
}

export async function assertProviderQualificationAllowance(
    ctx: MutationCtx,
    args: ProviderAttempt,
    qualification: NonNullable<Qualification>,
    qualificationReservationUsd: number,
    modelReservationUsd: number,
    now: number,
) {
    if (qualification.scenarios && args.runId) {
        const run = await ctx.db.get(args.runId);
        if (!run?.browserTestContextId)
            throw sourcePreparationError("paid_work_disabled");
        await assertQualificationAllowance(
            ctx,
            run.browserTestContextId,
            args.runId,
            args,
            qualificationReservationUsd,
        );
    } else {
        const calls = (
            await Promise.all(
                (qualification.sourcesLot ?? [qualification.runId]).map(
                    (runId) =>
                        ctx.db
                            .query("providerCalls")
                            .withIndex("by_run", (q) => q.eq("runId", runId))
                            .take(MAX_SOURCES_QUALIFICATION_RECEIPTS + 1),
                ),
            )
        ).flat();
        const reserved = calls.reduce(
            (sum, call) =>
                sum +
                Math.max(
                    call.qualificationReservationUsd ??
                        (call.service === "model" ? modelReservationUsd : 0),
                    call.reportedCost ?? 0,
                ),
            0,
        );
        const kind = qualificationCategory(args);
        const perDossierLimit = {
            model: 20,
            search: 2,
            acquisition: 6,
            technical: 64,
        }[kind];
        const lotLimit = {
            model: Math.min(40, qualification.maximumRequests ?? 40),
            search: qualification.maximumSearchAttempts ?? 4,
            acquisition: qualification.maximumAcquisitions ?? 12,
            technical: 128,
        }[kind];
        if (
            (qualification.sourcesLot
                ? calls.length >= MAX_SOURCES_QUALIFICATION_RECEIPTS ||
                  calls.filter(
                      (call) =>
                          call.runId === args.runId &&
                          qualificationCategory(call) === kind,
                  ).length >= perDossierLimit ||
                  calls.filter((call) => qualificationCategory(call) === kind)
                      .length >= lotLimit ||
                  calls.some(
                      (call) =>
                          call.dispatchOutcome === "unknown" ||
                          (call.status === "started" &&
                              (call.leaseExpiresAt ?? 0) <= now),
                  )
                : calls.length >=
                  (qualification.maximumRequests ?? Infinity)) ||
            reserved + qualificationReservationUsd >
                qualification.maximumCostUsd ||
            calls.some(
                (call) =>
                    call.reportedCost !== undefined &&
                    call.reportedCost > (call.qualificationReservationUsd ?? 0),
            )
        )
            throw sourcePreparationError("qualification_budget_exhausted");
    }
}

export async function insertProviderReceipt(
    ctx: MutationCtx,
    args: ProviderAttempt,
    admission: {
        now: number;
        qualification: Qualification;
        qualificationReservationUsd?: number;
        reservedMaxOutputTokens?: number;
        structuredOutputPolicy?: Doc<"providerCalls">["structuredOutputPolicy"];
        recoveryOfProviderCallId?: Id<"providerCalls">;
        remainingModelAuthorityMs?: number;
    },
): Promise<ProviderAttemptResult> {
    const {
        now,
        qualification,
        qualificationReservationUsd,
        reservedMaxOutputTokens,
        structuredOutputPolicy,
        recoveryOfProviderCallId,
        remainingModelAuthorityMs,
    } = admission;
    const qualificationContextId =
        qualification?.scenarios && args.runId
            ? (await ctx.db.get(args.runId))?.browserTestContextId
            : undefined;
    const providerCallId = await ctx.db.insert("providerCalls", {
        reservedMaxOutputTokens,
        modelContextWindowTokens: args.modelContextWindowTokens,
        qualificationReservationUsd,
        qualificationContextId,
        costAccountingPolicy: qualification?.costAccountingPolicy,
        operationRequestId: args.operationRequestId,
        missionId: args.missionId,
        invocationId: args.invocationId,
        operationEpoch: args.operationEpoch,
        ...(structuredOutputPolicy ? { structuredOutputPolicy } : {}),
        inputHash: args.inputHash,
        searchQuery: args.searchQuery,
        runId: args.runId,
        corpusRevisionId: args.corpusRevisionId,
        preparationId: args.preparationId,
        sourceId: args.sourceId,
        executionGeneration: args.executionGeneration,
        workflowVersion: args.workflowVersion,
        stepKey: args.stepKey,
        service: args.service,
        operation: args.operation,
        operationKey: args.operationKey,
        status: "started",
        attempt: args.attempt,
        recoveryOfProviderCallId,
        leaseExpiresAt:
            now +
            providerLeaseDurationMs(
                args.service,
                args.operation,
                remainingModelAuthorityMs,
            ),
        usage:
            args.operation === "source_embedding"
                ? { reservedInputBytes: args.embeddingInputBytes }
                : undefined,
        createdAt: now,
    });
    if (qualificationContextId) {
        const call = await ctx.db.get(providerCallId);
        if (!call) throw new Error("Missing provider receipt");
        await updateQualificationUsage(ctx, null, call);
    }
    if (args.invocationId && !args.operationRequestId)
        await ctx.db.patch(args.invocationId, { providerCallId });
    return {
        ...(remainingModelAuthorityMs === undefined
            ? {}
            : { deadlineAt: now + remainingModelAuthorityMs }),
        providerCallId,
        shouldExecute: true,
        status: "started" as const,
    };
}

export async function existingProviderAttempt(
    ctx: MutationCtx,
    args: ProviderAttempt,
    existing: Doc<"providerCalls">,
    now: number,
): Promise<ProviderAttemptResult> {
    if (
        existing.status === "started" &&
        existing.leaseExpiresAt !== undefined &&
        existing.leaseExpiresAt <= now
    ) {
        if (args.preparationId || args.missionId) {
            await patchQualificationReceipt(ctx, existing, {
                status: "failed",
                errorCode: "attempt_outcome_unknown",
                retryable: false,
                completedAt: now,
            });
            return {
                providerCallId: existing._id,
                shouldExecute: false,
                status: "failed" as const,
                errorCode: "attempt_outcome_unknown",
            };
        }
        const leaseExpiresAt =
            now + providerLeaseDurationMs(args.service, args.operation);
        await ctx.db.patch(existing._id, {
            leaseExpiresAt,
            createdAt: now,
        });
        return {
            providerCallId: existing._id,
            shouldExecute: true,
            status: "started" as const,
        };
    }
    return {
        providerCallId: existing._id,
        shouldExecute: false,
        status: existing.status,
        ...(args.service === "model"
            ? {
                  errorCode: existing.errorCode,
                  retryable: existing.retryable,
              }
            : {}),
    };
}

/** Admit a native model dispatch and its reservation in the same writer transaction. */
export async function reserveMissionModelAttempt(
    ctx: MutationCtx,
    args: ProviderAttempt,
): Promise<ProviderAttemptResult> {
    const now = Date.now();
    if ((await publicationControl(ctx))?.held)
        throw sourcePreparationError("provider_publication_held");
    if (args.termination)
        throw sourcePreparationError("attempt_identity_conflict");
    const run = args.runId ? await ctx.db.get(args.runId) : null;
    const mission = args.missionId ? await ctx.db.get(args.missionId) : null;
    const invocation = args.invocationId
        ? await ctx.db.get(args.invocationId)
        : null;
    const qualification =
        run &&
        (await requireQualifiedBrowserMission(
            ctx,
            run,
            mission,
            args.preparationId,
        ));
    if (
        qualification?.sourcesLot &&
        !["agent_reasoning", "agent_compaction"].includes(args.operation)
    )
        throw sourcePreparationError("paid_work_disabled");
    requireProviderDiagnostic(args);
    if (
        args.status !== "started" ||
        args.service !== "model" ||
        args.operationRequestId ||
        args.preparationId ||
        !mission ||
        !invocation ||
        invocation.provenance !== "live" ||
        invocation.missionId !== mission._id ||
        invocation.runId !== args.runId ||
        mission.runId !== args.runId ||
        invocation.corpusRevisionId !== args.corpusRevisionId ||
        invocation.generation !== args.executionGeneration ||
        mission.definitionVersion !== args.workflowVersion ||
        args.operation !==
            (invocation.purpose === "compaction"
                ? "agent_compaction"
                : "agent_reasoning") ||
        args.stepKey !== args.operation ||
        args.attempt !== 1 ||
        args.inputHash !== admittedInputHash(invocation) ||
        args.operationKey !==
            `mission:${mission._id}:invocation:${invocation._id}:attempt:1`
    )
        throw sourcePreparationError("qualification_attempt_invalid");
    await requireMissionAuthority(ctx, mission._id, invocation.generation);
    await requirePiDispatchLease(
        ctx,
        mission,
        invocation.generation,
        args.piLease,
    );
    const paidWork = await ctx.db
        .query("paidWorkControls")
        .withIndex("by_key", (q) => q.eq("key", "global"))
        .unique();
    if (paidWork?.enabled === false)
        throw sourcePreparationError("paid_work_disabled");
    const matches = await ctx.db
        .query("providerCalls")
        .withIndex("by_operation_key", (q) =>
            q.eq("operationKey", args.operationKey),
        )
        .collect();
    const existing = matches.find(
        (call) =>
            call.service === args.service &&
            call.operation === args.operation &&
            call.attempt === args.attempt &&
            call.runId === args.runId,
    );
    if (existing) return existingProviderAttempt(ctx, args, existing, now);
    if (!run) throw sourcePreparationError("stale_execution");
    await reserveModelAttempt(ctx, run, mission, null);
    let qualificationReservationUsd: number | undefined;
    if (qualification) {
        const capacity = await qualificationInvocationCapacity(
            ctx,
            invocation._id,
        );
        qualificationReservationUsd =
            qualificationModelReservationUsd(capacity);
        await assertProviderQualificationAllowance(
            ctx,
            args,
            qualification,
            qualificationReservationUsd,
            qualificationReservationUsd,
            now,
        );
    }
    return insertProviderReceipt(ctx, args, {
        now,
        qualification,
        qualificationReservationUsd,
        remainingModelAuthorityMs:
            Math.min(
                mission.deadlineAt,
                qualification?.deadlineAt ?? Infinity,
            ) - now,
    });
}

export const recordMissionModelAttempt = internalMutation({
    args: missionModelAttemptValidator.fields,
    returns: recordAttemptResultValidator,
    handler: reserveMissionModelAttempt,
});
export async function requireQualificationResultDeadline(
    ctx: QueryCtx,
    receipt: Doc<"providerCalls">,
) {
    if (receipt.qualificationReservationUsd === undefined) return;
    const run = receipt.runId ? await ctx.db.get(receipt.runId) : null;
    const deadlineAt = run
        ? await readWorkbenchQualificationDeadline(ctx, run)
        : undefined;
    if (deadlineAt === undefined) throw executionError("not_authorized");
    if (deadlineAt <= Date.now()) throw executionError("execution_deadline");
}
